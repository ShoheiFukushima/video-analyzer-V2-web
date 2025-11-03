# Issue #1: OCR Persistent Overlay フィルタリングの修正

## 優先度
🔴 **高** - ユーザー体験に直接影響

## ステータス
🔴 **未対応**

## 問題の概要

OCR処理において、全シーンに共通して出現するテキスト（ロゴ、ウォーターマーク、常設UI要素など）を自動削除する「Persistent Overlay フィルタリング」機能が正常に動作していません。

### 期待される動作
- 複数シーン（50%以上）に共通して出現するテキストを自動検出
- Persistent overlayとして識別されたテキストを全シーンから削除
- 各シーン固有のテキストのみをExcel出力に含める

### 実際の動作
- 全てのOCRテキストが個別の行として判定される（各行の頻度が17%程度）
- Persistent overlay が0個と判定される
- 重複テキストが削除されず、全てのOCRテキストがExcel出力に残る

### 影響範囲
- ✗ Excel出力に不要なテキスト（病院名、ロゴ、住所など）が全シーンに重複表示
- ✗ ユーザーが手動でExcelを編集する必要がある
- ✗ 出力品質の低下

---

## 根本原因の分析

### 技術的詳細

**ファイル**: `cloud-run-worker/src/services/pipeline.ts:199-270`

**問題の核心**:
Gemini Vision APIが改行文字（`\n`）を返さず、各シーンのOCRテキストが1つの長い文字列として処理されるため、行ベースのフィルタリングロジックが機能しない。

#### 現在の実装

```typescript
// Step 1: テキストを行分割（改行で分割）
const allLines: string[][] = scenesWithOCR.map(scene =>
  scene.ocrText
    .split('\n')  // ← Geminiが改行を返さないため、これが効かない
    .map(line => line.trim())
    .filter(line => line.length > 0)
);

// Step 2: 行頻度をカウント
const lineFrequency = new Map<string, number>();
for (const lines of allLines) {
  const uniqueLines = new Set(lines);
  for (const line of uniqueLines) {
    lineFrequency.set(line, (lineFrequency.get(line) || 0) + 1);
  }
}

// Step 3: 50%以上のシーンに出現する行を特定
const persistentThreshold = Math.ceil(totalScenes * 0.5);
const persistentLines = new Set<string>();
for (const [line, count] of lineFrequency.entries()) {
  if (count >= persistentThreshold) {
    persistentLines.add(line);
  }
}
```

#### デバッグログの証拠

```
🧹 Step 3.5: Filtering persistent overlays...
  🔍 Debug: Analyzing 6 unique lines
  📊 Top 10 most frequent lines:
    [1/6 = 17%] "みらいリハビリテーション病院 MIRAI REHABILITATION HOSPITAL..."
    [1/6 = 17%] "みらいリハビリテーション病院 MIRAI REHABILITATION HOSPITAL 内科..."
    [1/6 = 17%] "みらいリハビリテーション病院 MIRAI REHABILITATION HOSPITAL 内科..."
    [1/6 = 17%] "M みらいリハビリテーション病院 MIRAI REHABILITATION HOSPITAL..."
  ✓ Detected 0 persistent overlay lines (threshold: 3/6 scenes, ≥50%)
  ✓ Filtered: 6 → 6 scenes with unique text
```

**観察**:
- 6つの一意の行 = 各シーンが1つの長い文字列として扱われている
- 全ての行が `[1/6 = 17%]`（1シーンにのみ出現）
- 実際には「みらいリハビリテーション病院」が全6シーンに含まれているが検出されない

---

## 提案された解決策

### アプローチ1: Substring Inclusion Matching（推奨）⭐

**概念**: 共通する長い文字列パターンを検出して削除

#### 技術設計

**ステップ1: 候補フレーズの抽出**
```typescript
interface PhraseCandidate {
  phrase: string;
  minLength: number;  // 最小フレーズ長（デフォルト: 8文字）
  maxLength: number;  // 最大フレーズ長（デフォルト: 100文字）
}

function extractCandidatePhrases(
  scenesWithOCR: SceneWithOCR[],
  config: {
    minLength: number;    // 8文字以上
    maxLength: number;    // 100文字以下
    maxCandidates: number; // 最大候補数（パフォーマンス制限）
  } = { minLength: 8, maxLength: 100, maxCandidates: 10000 }
): Set<string> {
  const candidatePhrases = new Set<string>();

  for (const scene of scenesWithOCR) {
    const text = scene.ocrText;

    // スライディングウィンドウでN-gram抽出
    for (let len = config.minLength; len <= Math.min(config.maxLength, text.length); len++) {
      for (let i = 0; i <= text.length - len; i++) {
        const phrase = text.substring(i, i + len).trim();

        // 空白だけのフレーズは除外
        if (phrase.length >= config.minLength && !/^\s+$/.test(phrase)) {
          candidatePhrases.add(phrase);
        }

        // パフォーマンス制限
        if (candidatePhrases.size >= config.maxCandidates) {
          break;
        }
      }
    }
  }

  return candidatePhrases;
}
```

**ステップ2: フレーズ頻度の計算**
```typescript
interface PhraseFrequency {
  phrase: string;
  count: number;        // 出現シーン数
  percentage: number;   // 出現率（0-100%）
  avgPosition: number;  // 平均出現位置（0-1）
}

function calculatePhraseFrequency(
  candidatePhrases: Set<string>,
  scenesWithOCR: SceneWithOCR[]
): Map<string, PhraseFrequency> {
  const totalScenes = scenesWithOCR.length;
  const phraseFrequency = new Map<string, PhraseFrequency>();

  for (const phrase of candidatePhrases) {
    let count = 0;
    let totalPosition = 0;

    for (const scene of scenesWithOCR) {
      const index = scene.ocrText.indexOf(phrase);
      if (index !== -1) {
        count++;
        // 正規化された位置（0-1）
        totalPosition += index / Math.max(scene.ocrText.length, 1);
      }
    }

    if (count > 0) {
      phraseFrequency.set(phrase, {
        phrase,
        count,
        percentage: (count / totalScenes) * 100,
        avgPosition: totalPosition / count
      });
    }
  }

  return phraseFrequency;
}
```

**ステップ3: Persistent phraseの選定**
```typescript
interface PersistentOverlayConfig {
  threshold: number;           // 閾値（0.5 = 50%）
  maxPhrases: number;          // 最大フレーズ数
  prioritizeLonger: boolean;   // 長いフレーズを優先
  excludeShortWords: boolean;  // 短い単語を除外
}

function selectPersistentPhrases(
  phraseFrequency: Map<string, PhraseFrequency>,
  config: PersistentOverlayConfig = {
    threshold: 0.5,
    maxPhrases: 20,
    prioritizeLonger: true,
    excludeShortWords: true
  }
): string[] {
  const totalScenes = Math.max(...Array.from(phraseFrequency.values()).map(p => p.count));
  const persistentThreshold = Math.ceil(totalScenes * config.threshold);

  // 閾値を超えるフレーズをフィルタ
  let persistentCandidates = Array.from(phraseFrequency.values())
    .filter(p => p.count >= persistentThreshold);

  // 短い単語を除外（オプション）
  if (config.excludeShortWords) {
    persistentCandidates = persistentCandidates.filter(p =>
      p.phrase.length >= 8 || /[^\x00-\x7F]/.test(p.phrase) // 日本語は短くてもOK
    );
  }

  // ソート: 長さ優先 → 頻度優先
  persistentCandidates.sort((a, b) => {
    if (config.prioritizeLonger) {
      // 長い順 → 頻度高い順
      return b.phrase.length !== a.phrase.length
        ? b.phrase.length - a.phrase.length
        : b.count - a.count;
    } else {
      // 頻度高い順 → 長い順
      return b.count !== a.count
        ? b.count - a.count
        : b.phrase.length - a.phrase.length;
    }
  });

  // 上位N個を選択
  const selectedPhrases = persistentCandidates
    .slice(0, config.maxPhrases)
    .map(p => p.phrase);

  // 重複フレーズの除去（長いフレーズが短いフレーズを含む場合）
  const deduplicatedPhrases: string[] = [];
  for (const phrase of selectedPhrases) {
    // 既に選択されたより長いフレーズに含まれているかチェック
    const isSubstring = deduplicatedPhrases.some(longer =>
      longer.length > phrase.length && longer.includes(phrase)
    );

    if (!isSubstring) {
      deduplicatedPhrases.push(phrase);
    }
  }

  return deduplicatedPhrases;
}
```

**ステップ4: フィルタリング実行**
```typescript
function filterPersistentOverlaysV2(
  scenesWithOCR: SceneWithOCR[]
): SceneWithOCR[] {
  if (scenesWithOCR.length === 0) return scenesWithOCR;

  console.log('🧹 Step 3.5: Filtering persistent overlays (V2)...');

  // Step 1: 候補フレーズ抽出
  const candidatePhrases = extractCandidatePhrases(scenesWithOCR);
  console.log(`  🔍 Extracted ${candidatePhrases.size} candidate phrases`);

  // Step 2: 頻度計算
  const phraseFrequency = calculatePhraseFrequency(candidatePhrases, scenesWithOCR);
  console.log(`  📊 Analyzed ${phraseFrequency.size} phrases with frequency data`);

  // Step 3: Persistent phrase選定
  const persistentPhrases = selectPersistentPhrases(phraseFrequency);
  console.log(`  ✓ Detected ${persistentPhrases.length} persistent overlay phrases`);

  if (persistentPhrases.length > 0) {
    console.log(`  📌 Persistent phrases:`);
    for (const phrase of persistentPhrases) {
      const freq = phraseFrequency.get(phrase)!;
      console.log(`    - "${phrase.substring(0, 50)}${phrase.length > 50 ? '...' : ''}" (${freq.count}/${scenesWithOCR.length} scenes, ${freq.percentage.toFixed(0)}%)`);
    }
  }

  // Step 4: フィルタリング実行
  const filteredScenes = scenesWithOCR.map(scene => {
    let filteredText = scene.ocrText;

    // 各persistent phraseを削除
    for (const phrase of persistentPhrases) {
      // グローバル置換（全出現箇所を削除）
      filteredText = filteredText.split(phrase).join('');
    }

    // 余分な空白を整理
    filteredText = filteredText
      .replace(/\s+/g, ' ')  // 連続する空白を1つに
      .trim();

    return {
      ...scene,
      ocrText: filteredText
    };
  });

  const scenesWithTextBefore = scenesWithOCR.filter(s => s.ocrText.trim().length > 0).length;
  const scenesWithTextAfter = filteredScenes.filter(s => s.ocrText.trim().length > 0).length;

  console.log(`  ✓ Filtered: ${scenesWithTextBefore} → ${scenesWithTextAfter} scenes with unique text`);

  return filteredScenes;
}
```

#### パフォーマンス最適化

**問題**: N-gram生成は計算量が多い（O(n²)）

**最適化戦略**:

1. **段階的フィルタリング**
```typescript
// まず長いフレーズ（50文字以上）を検出
const longPhrases = selectPersistentPhrases(phraseFrequency, {
  minLength: 50, maxLength: 200
});

// 次に中程度のフレーズ（20-50文字）を検出
const mediumPhrases = selectPersistentPhrases(phraseFrequency, {
  minLength: 20, maxLength: 50
});

// 最後に短いフレーズ（8-20文字）を検出
const shortPhrases = selectPersistentPhrases(phraseFrequency, {
  minLength: 8, maxLength: 20
});
```

2. **候補数の制限**
```typescript
const config = {
  maxCandidates: 10000,  // 最大10,000候補まで
  earlyTermination: true // 制限到達時に早期終了
};
```

3. **キャッシング**
```typescript
// フレーズ頻度をキャッシュ（同じ動画の再処理時に利用）
const phraseCache = new Map<string, PhraseFrequency>();
```

#### メリット
- ✅ 文脈を保持したままフィルタリング
- ✅ 長いフレーズ（病院名など）を確実に検出
- ✅ 改行の有無に依存しない
- ✅ Gemini APIのレスポンス形式に依存しない

#### デメリット
- ⚠️ N-gram生成の計算コスト（最適化で軽減）
- ⚠️ 最適なフレーズ長の調整が必要

---

### アプローチ2: Geminiプロンプト改善（補完的）

**概念**: Gemini APIに改行区切りでテキストを返させる

#### 技術設計

**改善されたプロンプト**:
```typescript
const improvedPrompt = `Analyze this video frame and extract ALL visible text.

CRITICAL INSTRUCTIONS:
1. Return each text element on a SEPARATE LINE
2. Use \\n (newline) to separate different text elements
3. Preserve the reading order (top to bottom, left to right)
4. Each line should represent ONE distinct text element or text block

Example JSON format:
{
  "text": "Text element 1\\nText element 2\\nText element 3\\nText element 4",
  "confidence": 0.95
}

For instance, if you see:
  - A title "Company Name"
  - An address "123 Main Street"
  - A phone number "555-1234"

Return:
{
  "text": "Company Name\\n123 Main Street\\n555-1234",
  "confidence": 0.95
}

Focus on:
- Japanese text (kanji, hiragana, katakana)
- English text
- Numbers and symbols
- Screen overlays, titles, captions

Return empty string if no text detected.`;
```

#### A/Bテスト計画

```typescript
interface OCRTestConfig {
  enableImprovedPrompt: boolean;
  testPercentage: number;  // A/Bテストの割合（0-100）
}

async function performOCRWithABTest(
  scene: Scene,
  config: OCRTestConfig
): Promise<OCRResult> {
  const useImprovedPrompt = config.enableImprovedPrompt &&
    (Math.random() * 100 < config.testPercentage);

  const prompt = useImprovedPrompt ? improvedPrompt : originalPrompt;

  // OCR実行
  const result = await performOCR(scene, prompt);

  // 結果をログ（分析用）
  console.log(`[OCR Test] Scene ${scene.sceneNumber}: Prompt=${useImprovedPrompt ? 'improved' : 'original'}, Lines=${result.text.split('\n').length}`);

  return result;
}
```

#### メリット
- ✅ 根本的な解決（改行が返れば既存ロジックがそのまま使える）
- ✅ パフォーマンスへの影響なし
- ✅ コードの複雑性増加なし

#### デメリット
- ⚠️ Geminiが指示に従うか不確実
- ⚠️ A/Bテストと検証が必要
- ⚠️ 将来のAPI変更で動作が変わる可能性

---

### アプローチ3: Token-based Matching（代替案）

**概念**: 単語/フレーズレベルで重複検出

#### 技術設計

```typescript
function tokenBasedFiltering(
  scenesWithOCR: SceneWithOCR[],
  config: {
    minTokenLength: number;      // 最小単語長（デフォルト: 3）
    threshold: number;            // 閾値（デフォルト: 0.5）
    tokenizeBy: 'word' | 'phrase'; // トークン化方法
  } = { minTokenLength: 3, threshold: 0.5, tokenizeBy: 'word' }
): SceneWithOCR[] {
  const totalScenes = scenesWithOCR.length;
  const tokenFrequency = new Map<string, number>();

  // Step 1: トークン化と頻度計算
  for (const scene of scenesWithOCR) {
    let tokens: string[];

    if (config.tokenizeBy === 'word') {
      // 単語レベル（スペース・記号で分割）
      tokens = scene.ocrText.split(/[\s\u3000]+/); // 半角・全角スペース
    } else {
      // フレーズレベル（2-3単語のN-gram）
      tokens = extractPhrases(scene.ocrText, 2, 3);
    }

    const uniqueTokens = new Set(tokens.filter(t => t.length >= config.minTokenLength));

    for (const token of uniqueTokens) {
      tokenFrequency.set(token, (tokenFrequency.get(token) || 0) + 1);
    }
  }

  // Step 2: Persistent tokenの特定
  const persistentThreshold = Math.ceil(totalScenes * config.threshold);
  const persistentTokens = new Set<string>();

  for (const [token, count] of tokenFrequency.entries()) {
    if (count >= persistentThreshold) {
      persistentTokens.add(token);
    }
  }

  console.log(`  ✓ Detected ${persistentTokens.size} persistent tokens`);

  // Step 3: フィルタリング
  return scenesWithOCR.map(scene => {
    const tokens = scene.ocrText.split(/[\s\u3000]+/);
    const filteredTokens = tokens.filter(token => !persistentTokens.has(token));

    return {
      ...scene,
      ocrText: filteredTokens.join(' ')
    };
  });
}
```

#### メリット
- ✅ シンプルな実装
- ✅ パフォーマンスが良い（O(n)）
- ✅ 汎用性が高い

#### デメリット
- ⚠️ 単語単位の削除で文脈が失われる
- ⚠️ 「みらいリハビリテーション病院」→「みらい」「リハビリテーション」「病院」が個別に削除され、他の文にも影響

---

## 実装計画

### Phase 1: Substring Inclusion Matching実装（推奨）

**タスク**:
1. `filterPersistentOverlaysV2()` 関数の実装
2. 既存の`filterPersistentOverlays()` をリネーム（`filterPersistentOverlaysV1_Legacy()`）
3. `pipeline.ts` で新関数を使用
4. 単体テストの作成

**ファイル変更**:
- `cloud-run-worker/src/services/pipeline.ts` - メインロジック
- `cloud-run-worker/src/services/persistent-overlay-filter.ts` - 新規ファイル（分離）
- `cloud-run-worker/src/types/excel.ts` - 型定義追加

**推定工数**: 4-6時間

### Phase 2: Geminiプロンプト改善とA/Bテスト

**タスク**:
1. 改善プロンプトの作成
2. A/Bテスト機能の実装
3. ログ収集と分析
4. 効果測定

**ファイル変更**:
- `cloud-run-worker/src/services/pipeline.ts` - プロンプト改善
- `cloud-run-worker/src/utils/ab-test.ts` - 新規ファイル（A/Bテスト）

**推定工数**: 2-3時間

### Phase 3: 統合テストと検証

**タスク**:
1. テスト動画での検証（`mirai_0814.mp4`など）
2. パフォーマンステスト
3. エッジケースのテスト
4. ドキュメント更新

**推定工数**: 2-3時間

**合計工数**: 8-12時間

---

## テスト計画

### 単体テスト

```typescript
describe('Persistent Overlay Filter V2', () => {
  it('should detect phrases appearing in 50%+ of scenes', () => {
    const scenes = [
      { ocrText: 'みらいリハビリテーション病院 住所A' },
      { ocrText: 'みらいリハビリテーション病院 住所B' },
      { ocrText: 'みらいリハビリテーション病院 住所C' },
      { ocrText: '別の病院名 住所D' }
    ];

    const result = filterPersistentOverlaysV2(scenes);

    // 「みらいリハビリテーション病院」が削除されている
    expect(result[0].ocrText).toContain('住所A');
    expect(result[0].ocrText).not.toContain('みらいリハビリテーション病院');
  });

  it('should keep unique text in each scene', () => {
    const scenes = [
      { ocrText: 'Common Logo Scene 1 Unique' },
      { ocrText: 'Common Logo Scene 2 Unique' },
      { ocrText: 'Common Logo Scene 3 Unique' }
    ];

    const result = filterPersistentOverlaysV2(scenes);

    expect(result[0].ocrText).toContain('Scene 1 Unique');
    expect(result[1].ocrText).toContain('Scene 2 Unique');
    expect(result[2].ocrText).toContain('Scene 3 Unique');
  });

  it('should handle empty OCR text', () => {
    const scenes = [
      { ocrText: '' },
      { ocrText: '  ' },
      { ocrText: 'Some text' }
    ];

    const result = filterPersistentOverlaysV2(scenes);

    expect(result[0].ocrText).toBe('');
    expect(result[1].ocrText).toBe('');
  });
});
```

### 統合テスト

**テストケース1: mirai_0814.mp4**
- 全6シーンに「みらいリハビリテーション病院」が含まれる
- 期待結果: 病院名が全シーンから削除される

**テストケース2: 短い動画（5シーン未満）**
- 閾値計算が正しく動作するか確認

**テストケース3: 長い動画（50シーン以上）**
- パフォーマンステスト（処理時間 < 5秒）

### パフォーマンステスト

```typescript
describe('Performance Tests', () => {
  it('should process 50 scenes in < 5 seconds', async () => {
    const scenes = generateMockScenes(50);

    const startTime = Date.now();
    const result = filterPersistentOverlaysV2(scenes);
    const endTime = Date.now();

    expect(endTime - startTime).toBeLessThan(5000);
  });

  it('should handle large text without memory issues', () => {
    const scenes = [
      { ocrText: 'x'.repeat(10000) }, // 10KB text
      { ocrText: 'x'.repeat(10000) },
      { ocrText: 'x'.repeat(10000) }
    ];

    expect(() => filterPersistentOverlaysV2(scenes)).not.toThrow();
  });
});
```

---

## 期待される効果

### ユーザー体験の改善
- ✅ Excel出力から不要なテキストが自動削除
- ✅ 手動編集の手間が削減（推定: 5-10分/動画）
- ✅ 出力品質の向上

### 技術的メリット
- ✅ 既存のバグが解消
- ✅ より堅牢なOCR処理
- ✅ 将来的なAPIの変更に対する耐性

### ビジネス価値
- ✅ ユーザー満足度の向上
- ✅ 手作業の削減による生産性向上
- ✅ 競合製品との差別化

---

## 参考資料

- 既存issue: `OCR_DUPLICATE_FILTER_ISSUE_2025-10-31.md`
- 実装ファイル: `cloud-run-worker/src/services/pipeline.ts:199-270`
- 型定義: `cloud-run-worker/src/types/excel.ts`

---

## 備考

- 既存のV1フィルタリングは後方互換性のために残す
- 環境変数で切り替え可能にする: `OCR_FILTER_VERSION=v2`
- ログレベルで詳細な診断情報を出力

---

**作成日**: 2025-11-03
**担当者**: 次のClaudeセッション
**優先度**: 高
**推定工数**: 8-12時間
