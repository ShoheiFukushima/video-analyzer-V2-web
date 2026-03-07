# OCR重複テキストフィルタリング問題

**日付**: 2025年10月31日
**ステータス**: 🔴 **未完了** (3回失敗)
**優先度**: 高
**担当**: Claude + ユーザー協調作業

---

## 問題の概要

OCRテキストの重複フィルタリング機能が期待通りに動作しない。全6シーンに「みらいリハビリテーション病院 MIRAI REHABILITATION HOSPITAL」が含まれているにも関わらず、頻度分析で全て `[1/6 = 17%]` と検出され、persistent overlay として削除されない。

### 期待される動作
- 複数シーンに共通して出現するテキスト（病院名、住所、ロゴなど）を検出
- 50%以上のシーンに出現するテキストを persistent overlay として削除
- 各シーン固有のテキストのみをExcelに出力

### 実際の動作
- 全ての行が `[1/6 = 17%]` と検出される
- persistent overlay が0個と判定される
- 重複テキストが削除されず、全てのOCRテキストがExcelに残る

---

## 現在の実装

### ファイル
- `src/services/pipeline.ts` (lines 109-270)

### OCR処理 (performSceneBasedOCR)
```typescript
// Gemini Vision API (gemini-2.5-flash)を使用
const prompt = `Analyze this video frame and extract ALL visible text.

Please provide a JSON response with this structure:
{
  "text": "all extracted text concatenated",
  "confidence": 0.95
}`;

const result = await model.generateContent([
  prompt,
  { inlineData: { mimeType: 'image/png', data: base64Image } }
]);

const responseText = result.response.text();
const jsonText = responseText.replace(/```json\n?|\n?```/g, '').trim();
const ocrResult = JSON.parse(jsonText);

return ocrResult.text; // ← このテキストが問題の可能性
```

### フィルタリング処理 (filterPersistentOverlays)
```typescript
function filterPersistentOverlays(scenesWithOCR: SceneWithOCR[]): SceneWithOCR[] {
  // Step 1: Split each scene's OCR text into lines
  const allLines: string[][] = scenesWithOCR.map(scene =>
    scene.ocrText
      .split('\n')  // ← 改行で分割（ここが効いていない）
      .map(line => line.trim())
      .filter(line => line.length > 0)
  );

  // Step 2: Count how many scenes each unique line appears in
  const lineFrequency = new Map<string, number>();
  for (const lines of allLines) {
    const uniqueLines = new Set(lines); // Count each line once per scene
    for (const line of uniqueLines) {
      lineFrequency.set(line, (lineFrequency.get(line) || 0) + 1);
    }
  }

  // Step 3: Identify persistent lines (appear in >= 50% of scenes)
  const persistentThreshold = Math.ceil(totalScenes * 0.5); // 3/6 scenes
  const persistentLines = new Set<string>();

  for (const [line, count] of lineFrequency.entries()) {
    if (count >= persistentThreshold) {
      persistentLines.add(line);
    }
  }

  // Step 4: Remove persistent lines from each scene
  const filteredScenes = scenesWithOCR.map(scene => {
    const lines = scene.ocrText
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && !persistentLines.has(line));

    return {
      ...scene,
      ocrText: lines.join('\n')
    };
  });

  return filteredScenes;
}
```

---

## デバッグ結果

### ログ出力 (2025-10-31 13:49 JST)
```
🧹 Step 3.5: Filtering persistent overlays...
  🔍 Debug: Analyzing 6 unique lines
  📊 Top 10 most frequent lines:
    [1/6 = 17%] "みらいリハビリテーション病院 MIRAI REHABILITATION HOSPITAL..."
    [1/6 = 17%] "みらいリハビリテーション病院 MIRAI REHABILITATION HOSPITAL 内科..."
    [1/6 = 17%] "みらいリハビリテーション病院 MIRAI REHABILITATION HOSPITAL 内科..."
    [1/6 = 17%] "M みらいリハビリテーション病院 MIRAI REHABILITATION HOSPITAL..."
    [1/6 = 17%] "みらいリハビリテーション病院 MIRAI REHABILITATION HOSPITAL 鹿児島..."
    [1/6 = 17%] "すべての人に明るいみらいを..."
  ✓ Detected 0 persistent overlay lines (threshold: 3/6 scenes, ≥50%)
  ✓ Filtered: 6 → 6 scenes with unique text
```

### Excel出力の実際
全6シーンに以下のテキストが含まれている:
- Scene 1: `みらいリハビリテーション病院 MIRAI REHABILITATION HOSPITAL MIRAI REHABILITATION HOSPITAL 川島ハウス 止まれ 鹿児島市下荒田丁目1番25号`
- Scene 2: `みらいリハビリテーション病院 MIRAI REHABILITATION HOSPITAL 内科・脳神経内科 循環器内科・消化器内科 呼吸器内科・腫瘍内科・緩和ケア内科 泌尿器科・心療内科 MIRAI REHABILITATION HOS. INFORMATION 鹿児島市下荒田丁目1番25号`
- Scene 3-6: 同様に「みらいリハビリテーション病院」を含む

### 重要な観察
- **6つの一意の行 = 各シーンが1つの長い行として扱われている**
- Excelでは複数行に見えるが、これはセル内の自動改行（折り返し表示）
- Geminiが改行文字 `\n` を返していない可能性が高い

---

## 根本原因の分析

### 仮説1: Gemini APIがスペース区切りで返している ⭐ **最有力**
- Geminiが複数のテキスト要素をスペースで連結
- 改行文字 `\n` を含めていない
- `split('\n')` が効かず、各シーンが1つの長い文字列として扱われる

**証拠**:
- デバッグログで「6 unique lines」（各シーンが1行）
- 全ての行が [1/6 = 17%]（1シーンにのみ出現）
- 同じテキストが複数シーンに出現しているのに検出されない

### 仮説2: 微妙なテキストの違い
- スペースの数、全角/半角の違い
- Exact string matchが失敗
- しかし、デバッグログを見ると各行が完全に異なるため、これは副次的

### 仮説3: 処理順序の問題
- フィルタリング処理自体は正常に実行されている（ログから確認）
- フィルタリング結果もExcelに反映されている（6 → 6 scenes）
- この仮説は否定される

---

## 提案された解決策

### アプローチ1: Token-based Matching
**概念**: 行ベースではなく、単語/フレーズレベルで重複検出

```typescript
// 単語レベルで頻度を計算
const wordFrequency = new Map<string, number>();
for (const scene of scenesWithOCR) {
  const words = scene.ocrText.split(/\s+/); // スペースで分割
  const uniqueWords = new Set(words);
  for (const word of uniqueWords) {
    if (word.length > 2) { // 短い単語は除外
      wordFrequency.set(word, (wordFrequency.get(word) || 0) + 1);
    }
  }
}

// 頻出単語を特定
const persistentWords = Array.from(wordFrequency.entries())
  .filter(([_, count]) => count >= threshold)
  .map(([word, _]) => word);

// フィルタリング
filteredText = text.split(/\s+/)
  .filter(word => !persistentWords.includes(word))
  .join(' ');
```

**メリット**:
- テキストフォーマットに依存しない
- 部分一致も検出できる
- 単語単位で削除可能

**デメリット**:
- フレーズ全体ではなく単語単位の削除
- コンテキストが失われる可能性

---

### アプローチ2: Substring Inclusion Matching ⭐ **推奨**
**概念**: 共通する長い文字列パターンを検出して削除

```typescript
// Step 1: 全シーンから候補フレーズを抽出
// 最小長のフレーズ（例: 10文字以上）を候補とする
const candidatePhrases = new Set<string>();
for (const scene of scenesWithOCR) {
  const text = scene.ocrText;
  // N-gram approach: 10文字以上の連続文字列を候補に
  for (let i = 0; i < text.length - 10; i++) {
    for (let len = 10; len <= 50; len++) {
      if (i + len <= text.length) {
        candidatePhrases.add(text.substring(i, i + len));
      }
    }
  }
}

// Step 2: 各フレーズが何シーンに出現するかカウント
const phraseFrequency = new Map<string, number>();
for (const phrase of candidatePhrases) {
  let count = 0;
  for (const scene of scenesWithOCR) {
    if (scene.ocrText.includes(phrase)) {
      count++;
    }
  }
  phraseFrequency.set(phrase, count);
}

// Step 3: 50%以上のシーンに出現する最長フレーズを選択
const persistentPhrases = Array.from(phraseFrequency.entries())
  .filter(([_, count]) => count >= threshold)
  .sort((a, b) => b[0].length - a[0].length) // 長い順
  .slice(0, 10) // 上位10個
  .map(([phrase, _]) => phrase);

// Step 4: フレーズを削除
const filteredScenes = scenesWithOCR.map(scene => {
  let filteredText = scene.ocrText;
  for (const phrase of persistentPhrases) {
    filteredText = filteredText.replace(new RegExp(phrase, 'g'), '');
  }
  return { ...scene, ocrText: filteredText.trim() };
});
```

**メリット**:
- 文脈を保持
- 長いフレーズ（病院名など）を確実に削除
- 実装がシンプル

**デメリット**:
- N-gram生成でパフォーマンス低下の可能性
- 最適なフレーズ長の調整が必要

---

### アプローチ3: Geminiプロンプト改善
**概念**: Gemini APIに改行区切りでテキストを返させる

```typescript
const prompt = `Analyze this video frame and extract ALL visible text.

IMPORTANT:
- Return each text element on a SEPARATE LINE
- Use \\n to separate different text elements
- Preserve the reading order (top to bottom, left to right)

Example format:
{
  "text": "Text element 1\\nText element 2\\nText element 3",
  "confidence": 0.95
}

Focus on:
- Japanese text (kanji, hiragana, katakana)
- English text
- Numbers and symbols
- Screen overlays, titles, captions

Return empty string if no text detected.`;
```

**メリット**:
- 既存のフィルタリングロジックがそのまま使える
- 根本的な解決

**デメリット**:
- Geminiが指示に従うか不確実
- テスト＆検証が必要

---

### アプローチ4: TF-IDF風アプローチ
**概念**: 全シーンで頻出する単語の重みを下げる

- 実装が複雑
- オーバーキル
- **非推奨**

---

## 推奨アクション

### 短期的解決策（推奨順）

1. **アプローチ2: Substring Inclusion Matching**
   - 最もシンプルで効果的
   - すぐに実装可能
   - 「みらいリハビリテーション病院」のような長いフレーズを確実に検出

2. **アプローチ3: Geminiプロンプト改善**
   - 根本的な解決
   - 既存ロジックが活きる
   - ただし、Geminiの動作が不確実

3. **アプローチ1: Token-based Matching**
   - 汎用性が高い
   - ただし、単語単位の削除で情報が失われる可能性

### 長期的解決策

- Gemini API以外のOCRエンジンの検討（Tesseract.js、Google Cloud Vision API）
- OCR結果の構造化（bounding box情報の活用）
- ユーザー設定による persistent overlay の手動指定機能

---

## 次のステップ

1. ✅ デバッグログの追加（完了）
2. ✅ 問題の根本原因特定（完了）
3. 🔲 **アプローチ2の実装**
   - `filterPersistentOverlays()` 関数の書き換え
   - テスト＆検証
4. 🔲 ユーザーテスト
5. 🔲 必要に応じてアプローチ3の併用

---

## テスト動画情報

- **ファイル**: `mirai_0814.mp4`
- **シーン数**: 6
- **重複テキスト**: 「みらいリハビリテーション病院 MIRAI REHABILITATION HOSPITAL」（全6シーンに出現）
- **期待結果**: 上記テキストが全シーンから削除される

---

## 履歴

- **2025-10-31 12:00 JST**: 初回実装（行ベースマッチング）
- **2025-10-31 12:30 JST**: デバッグログ追加、問題再現（2回目）
- **2025-10-31 13:00 JST**: 問題再現（3回目）、Geminiへの相談を検討
- **2025-10-31 13:30 JST**: 根本原因分析、解決策検討、本ドキュメント作成

---

## 関連ファイル

- `src/services/pipeline.ts` (lines 109-270)
- `src/types/excel.ts`
- `/tmp/result_upload_1761884045298_fcpm79bdi.xlsx` (テスト結果)

---

## 備考

- 3回の実装試行で全て失敗
- ユーザーからの明示的な「他の視点が必要」との指示
- Claude単独では解決困難と判断
- Gemini/Codexへの相談を検討したが、Gemini CLIが利用不可
- Claude独自の分析に基づき解決策を提案

---

**ステータス**: 🔴 **未完了** - アプローチ2の実装待ち
