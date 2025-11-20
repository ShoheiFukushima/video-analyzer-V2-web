# シーン検出とOCR処理 技術仕様書

**バージョン**: 2.1.0
**最終更新**: 2025年11月12日
**プロジェクト**: Video Analyzer V2 Web
**対象ファイル**: `cloud-run-worker/src/services/`

---

## 📋 目次

1. [システム概要](#1-システム概要)
2. [シーン検出の技術仕様](#2-シーン検出の技術仕様)
3. [スクリーンショット抽出](#3-スクリーンショット抽出)
4. [OCR処理（Gemini Vision）](#4-ocr処理gemini-vision)
5. [OCRテキストフィルタリング](#5-ocrテキストフィルタリング)
6. [Excel生成](#6-excel生成)
7. [パフォーマンス最適化](#7-パフォーマンス最適化)
8. [潜在的な問題点と対策](#8-潜在的な問題点と対策)

---

## 1. システム概要

### 1.1 処理フロー全体像

```
動画ファイル
    ↓
メタデータ抽出
    ↓
マルチパスシーン検出
    ↓
シーン範囲生成
    ↓
中間点スクリーンショット抽出
    ↓
並列OCR処理（Gemini Vision）
    ↓
永続オーバーレイフィルタリング
    ↓
連続重複除去
    ↓
Whisper文字起こしマッピング
    ↓
Excel生成（5列レイアウト）
    ↓
完成Excel
```

### 1.2 主要コンポーネント

| コンポーネント | ファイル | 主要機能 |
|--------------|---------|---------|
| **統合パイプライン** | `pipeline.ts` | シーン検出からExcel生成までの統合 |
| **FFmpegシーン検出** | `ffmpeg.ts` | マルチパス検出、フレーム抽出 |
| **OCR処理** | `pipeline.ts` | Gemini Vision API、並列処理 |
| **Excel生成** | `excel-generator.ts` | 画像埋め込み、5列レイアウト |
| **レート制限** | `rateLimiter.ts` | Gemini APIレート制限対策 |
| **進捗報告** | `progressReporter.ts` | Supabaseへの進捗更新 |

---

## 2. シーン検出の技術仕様

### 2.1 FFmpeg showinfo filterの使用

**実装場所**: `cloud-run-worker/src/services/ffmpeg.ts:137-167`

#### 2.1.1 FFmpegコマンド構成

```typescript
ffmpegCommand = ffmpeg(videoPath)
  .outputOptions([
    // showinfoフィルタを使用したシーン検出（Cloud Run互換）
    '-vf', `select='gt(scene,${threshold})',showinfo`,
    '-f', 'null'
  ])
  .output('/dev/null')  // ヌル出力（検出のみ）
```

**パラメータ解説**:
- `select='gt(scene,${threshold})'`: シーン変化スコアが閾値を超えるフレームのみ選択
- `showinfo`: 選択されたフレームのメタデータをstderrに出力
- `-f null`: 出力形式をnull（動画生成なし）
- `/dev/null`: 標準のFFmpeg出力先

#### 2.1.2 出力パース処理

```typescript
.on('stderr', (stderrLine: string) => {
  // FFmpeg出力からタイムスタンプを抽出
  // フォーマット: "frame:123 pts:12345 pts_time:12.345"
  const match = stderrLine.match(/pts_time:(\d+\.?\d*)/);
  if (match) {
    const timestamp = parseFloat(match[1]);
    cuts.push({
      timestamp: Math.floor(timestamp * 10) / 10, // 0.1秒精度に丸め
      confidence: threshold
    });
  }
})
```

**メリット**:
- ✅ Cloud Run環境で安定動作（stderr出力のため）
- ✅ バッファオーバーフローを防止（selectフィルタで必要なフレームのみ）
- ✅ タイムアウト設定による安全性（300秒制限）

### 2.2 マルチパス方式の詳細

**実装場所**: `ffmpeg.ts:29-33, 42-77`

#### 2.2.1 検出閾値（2025-11-12更新版）

```typescript
const DEFAULT_CONFIG: SceneDetectionConfig = {
  thresholds: [0.02, 0.05, 0.08], // バランス型マルチパス検出
  minSceneDuration: 0.8,           // 短時間シーンフィルタ（0.8秒以上）
  minSceneInterval: 2.0            // 最小シーン間隔（2秒以上）
};
```

**閾値選定理由**:

| 閾値 | 検出対象 | 特徴 |
|------|---------|------|
| **0.02** | 緩やかな変化（フェード、パン） | 高感度、誤検出リスク中 |
| **0.05** | 標準的なカット | 安定検出、V2デフォルト |
| **0.08** | 明確なカット | 低誤検出、見逃しリスク中 |

**以前の設定（2025-11-12以前）**:
```typescript
// 問題: 類似シーンの重複検出が多発
thresholds: [0.01, 0.02, 0.05], // 過剰検出
minSceneDuration: 0.5,          // 短すぎる
minSceneInterval: undefined     // 連続検出を制限なし
```

#### 2.2.2 マルチパス統合アルゴリズム

```typescript
async function detectSceneCuts(
  videoPath: string,
  config: SceneDetectionConfig
): Promise<SceneCut[]> {
  const allCuts = new Map<number, number>(); // timestamp → confidence

  for (const threshold of config.thresholds) {
    const cuts = await runSceneDetection(videoPath, threshold);

    // 最大信頼度で統合
    cuts.forEach(cut => {
      const existingConfidence = allCuts.get(cut.timestamp) || 0;
      allCuts.set(cut.timestamp, Math.max(existingConfidence, cut.confidence));
    });
  }

  // タイムスタンプでソート
  const mergedCuts = Array.from(allCuts.entries())
    .map(([timestamp, confidence]) => ({ timestamp, confidence }))
    .sort((a, b) => a.timestamp - b.timestamp);

  return mergedCuts;
}
```

**利点**:
- 複数閾値で相互補完（見逃し防止）
- 最大信頼度を保持（品質維持）
- タイムスタンプベースのユニーク化（重複排除）

### 2.3 重複フィルタリング（2025-11-12追加）

**実装場所**: `ffmpeg.ts:86-105`

#### 2.3.1 最小シーン間隔フィルタ

```typescript
function filterCloseScenes(cuts: SceneCut[], minInterval: number): SceneCut[] {
  if (cuts.length === 0) return cuts;

  const filteredCuts: SceneCut[] = [cuts[0]];
  let skippedCount = 0;

  for (let i = 1; i < cuts.length; i++) {
    const timeSinceLastCut = cuts[i].timestamp - filteredCuts[filteredCuts.length - 1].timestamp;

    if (timeSinceLastCut >= minInterval) {
      filteredCuts.push(cuts[i]);
    } else {
      skippedCount++;
      console.log(`⏭️  Skipping close scene cut at ${cuts[i].timestamp.toFixed(1)}s`);
    }
  }

  return filteredCuts;
}
```

**効果**:
- ✅ 連続類似シーン検出を防止
- ✅ OCR重複処理を削減（パフォーマンス向上）
- ✅ ユーザビリティ向上（意味のあるシーンのみ）

#### 2.3.2 最小シーン継続時間フィルタ

```typescript
// シーン範囲生成時に短時間シーンを除外
if (duration < config.minSceneDuration) {
  console.log(`⏭️  Skipping short scene (${duration.toFixed(2)}s)`);
  continue;  // シーン番号を消費せずスキップ
}
```

**効果**:
- ✅ 0.8秒未満のノイズシーンを除外
- ✅ シーン番号の連続性を保持（1, 2, 3...）
- ✅ 処理時間の削減

### 2.4 タイムアウト設定

**設定場所**: `cloud-run-worker/src/config/timeouts.ts:48`

```typescript
export const TIMEOUTS = {
  SCENE_DETECTION: 300000, // 5分（300秒）
};
```

**想定処理時間**:
- 300MB動画: 1-3分
- 安全マージン: 2倍（5分制限）
- Cloud Runリクエストタイムアウト: 600秒（10分）

---

## 3. スクリーンショット抽出

### 3.1 タイムスタンプ計算

**実装場所**: `ffmpeg.ts:178-217`

#### 3.1.1 中間点（Mid-point）計算

```typescript
async function generateSceneRanges(
  cuts: SceneCut[],
  videoDuration: number,
  config: SceneDetectionConfig
): Promise<Scene[]> {
  const scenes: Scene[] = [];
  let sceneNumber = 1;

  for (let i = 0; i < cuts.length; i++) {
    const startTime = cuts[i].timestamp;
    const endTime = i < cuts.length - 1 ? cuts[i + 1].timestamp : videoDuration;
    const duration = endTime - startTime;

    // 短時間シーンをスキップ
    if (duration < config.minSceneDuration) {
      continue;
    }

    // 中間点計算（50%位置）
    const midTime = (startTime + endTime) / 2;

    scenes.push({
      sceneNumber,
      startTime,  // シーン検出点A（前）
      endTime,    // シーン検出点B（後）
      midTime,    // 50%位置（スクリーンショット抽出点）
      timecode: formatTimecode(startTime)
    });

    sceneNumber++;
  }

  return scenes;
}
```

**中間点アプローチの利点**:
- ✅ シーン転換時のブラー回避
- ✅ 代表的なフレームの抽出
- ✅ 安定した画像品質

**例**:
```
シーン1: 0.0s - 5.2s → midTime = 2.6s
シーン2: 5.2s - 10.8s → midTime = 8.0s
シーン3: 10.8s - 15.0s → midTime = 12.9s
```

### 3.2 FFmpegフレーム抽出コマンド

**実装場所**: `ffmpeg.ts:225-240`

```typescript
async function extractFrameAtTime(
  videoPath: string,
  timestamp: number,
  outputPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .seekInput(timestamp)     // 指定タイムスタンプにシーク
      .frames(1)                // 1フレームのみ抽出
      .size('1280x720')         // OCR最適化サイズ
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .run();
  });
}
```

**パラメータ詳細**:
- `seekInput(timestamp)`: 高速シーク（キーフレーム経由）
- `frames(1)`: 1フレームのみ（効率的）
- `size('1280x720')`: OCR最適化（720p = 高速 + 高精度）

**出力形式**: PNG（可逆圧縮、OCR品質重視）

---

## 4. OCR処理（Gemini Vision）

### 4.1 API仕様

**実装場所**: `pipeline.ts:112-260`

#### 4.1.1 モデル選択

```typescript
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
```

**gemini-2.5-flash特性**:
- ⚡ 高速処理（OCR用途最適）
- 🇯🇵 日本語対応（漢字、ひらがな、カタカナ）
- 🌐 多言語対応（英語、記号、数字）
- 💰 コスト効率良好

### 4.2 リクエスト形式

#### 4.2.1 プロンプト設計

```typescript
const prompt = `Analyze this video frame and extract ALL visible text.

Please provide a JSON response with this structure:
{
  "text": "all extracted text concatenated",
  "confidence": 0.95
}

Focus on:
- Japanese text (kanji, hiragana, katakana)
- English text
- Numbers and symbols
- Screen overlays, titles, captions

Return empty string if no text detected.`;
```

**プロンプト設計原則**:
- ✅ JSON構造化出力（パース容易性）
- ✅ 多言語指定（漏れ防止）
- ✅ 信頼度スコア取得（品質評価）
- ✅ ゼロ検出ケース明示

#### 4.2.2 画像エンコーディング

```typescript
// スクリーンショット読み込み
const imageBuffer = fs.readFileSync(scene.screenshotPath);
const base64Image = imageBuffer.toString('base64');

// Gemini Vision API呼び出し
const result = await model.generateContent([
  prompt,
  {
    inlineData: {
      mimeType: 'image/png',
      data: base64Image
    }
  }
]);
```

**エンコーディング方式**: Base64（PNG → Base64文字列）

### 4.3 並列処理

**実装場所**: `pipeline.ts:118-132`

#### 4.3.1 並列度制御

```typescript
import pLimit from 'p-limit';

const limit = pLimit(3); // 並列度3

const results = await Promise.allSettled(
  scenes.map((scene, index) =>
    limit(async () => {
      // OCR処理...
    })
  )
);
```

**並列度3の根拠**:
- Gemini APIレート制限: 15リクエスト/分
- 1リクエスト平均時間: 4秒
- 並列度3 → 約12秒/3シーン → 5シーン/分 ✅
- 安全マージン: 約3倍の余裕

#### 4.3.2 Promise.allSettledによる耐障害性

```typescript
const results = await Promise.allSettled(...);

const scenesWithOCR: SceneWithOCR[] = results.map((result, index) => {
  if (result.status === 'fulfilled') {
    return result.value;
  } else {
    console.error(`Scene ${scenes[index].sceneNumber} promise rejected:`, result.reason);
    return {
      ...scenes[index],
      ocrText: '',
      ocrConfidence: 0
    };
  }
});
```

**利点**:
- ✅ 一部失敗でも処理継続
- ✅ エラーハンドリングの簡潔性
- ✅ 全体処理時間の予測可能性

### 4.4 レート制限対策

**実装場所**: `pipeline.ts:119, rateLimiter.ts`

#### 4.4.1 RateLimiterクラス

```typescript
export class RateLimiter {
  private lastRequestTime: number = 0;
  private readonly minInterval: number;

  constructor(requestsPerMinute: number) {
    this.minInterval = (60 * 1000) / requestsPerMinute;
  }

  async acquire(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < this.minInterval) {
      const delay = this.minInterval - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    this.lastRequestTime = Date.now();
  }
}
```

**使用例**:
```typescript
const rateLimiter = new RateLimiter(15); // 15リクエスト/分

await rateLimiter.acquire(); // 必要に応じて待機
const result = await model.generateContent(...);
```

**効果**:
- ✅ 429エラー（Rate Limit Exceeded）を防止
- ✅ 自動待機（ブロッキング方式）
- ✅ 統計ログ出力（デバッグ支援）

---

## 5. OCRテキストフィルタリング

### 5.1 永続オーバーレイフィルタリング

**実装場所**: `pipeline.ts:289-379`

#### 5.1.1 動的閾値計算

```typescript
function calculateDynamicThreshold(totalScenes: number): number {
  if (totalScenes < 20) return 0.8;  // 80%（少数シーン用）
  if (totalScenes < 50) return 0.7;  // 70%
  if (totalScenes < 100) return 0.6; // 60%
  return 0.5;                         // 50%（大量シーン用）
}
```

**閾値適応理由**:
- **少数シーン（<20）**: 厳格閾値（80%）→ 誤検出防止
- **中規模（20-50）**: 標準閾値（70%）→ バランス型
- **大規模（50+）**: 緩和閾値（50-60%）→ 統計的信頼性

**例**:
```
総シーン数: 15 → 閾値80% → 12シーン以上出現でオーバーレイ判定
総シーン数: 100 → 閾値50% → 50シーン以上出現でオーバーレイ判定
```

#### 5.1.2 行頻度カウント

```typescript
// 各シーンのOCRテキストを行に分割
const allLines: string[][] = scenesWithOCR.map(scene =>
  scene.ocrText
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
);

// 各ユニーク行が何シーンに出現するかカウント
const lineFrequency = new Map<string, number>();
for (const lines of allLines) {
  const uniqueLines = new Set(lines); // シーンごと1回だけカウント
  for (const line of uniqueLines) {
    lineFrequency.set(line, (lineFrequency.get(line) || 0) + 1);
  }
}
```

#### 5.1.3 永続行判定

```typescript
const persistentThreshold = totalScenes * threshold;
const persistentLines = new Set<string>();

for (const [line, count] of lineFrequency.entries()) {
  if (count >= persistentThreshold) {
    persistentLines.add(line);
  }
}
```

**具体例**:
```
総シーン数: 50
閾値: 70%（0.7）
永続閾値: 50 * 0.7 = 35シーン

行: "© 2024 Company ABC"
出現回数: 48シーン → 永続オーバーレイと判定 ✅

行: "限定セール開催中"
出現回数: 2シーン → ユニークテキスト ❌
```

### 5.2 連続重複除去

**実装場所**: `pipeline.ts:396-493`

#### 5.2.1 時間ベース重複判定

```typescript
function removeConsecutiveDuplicateOCR(scenesWithOCR: SceneWithOCR[]): SceneWithOCR[] {
  let previousOCRText = '';
  let duplicateStartTime = 0;
  const LONG_DISPLAY_THRESHOLD = 5.0; // 5秒閾値

  const processedScenes = scenesWithOCR.map((scene) => {
    const currentOCRText = scene.ocrText.trim();

    // 連続重複チェック
    if (currentOCRText === previousOCRText) {
      const totalDisplayDuration = scene.endTime - duplicateStartTime;

      // 5秒以上表示 → 重要コンテンツとして保持
      if (totalDisplayDuration >= LONG_DISPLAY_THRESHOLD) {
        return scene;  // テキストを保持
      }

      // それ以外 → 重複として非表示
      return { ...scene, ocrText: '' };
    } else {
      // 新規テキスト → 表示
      duplicateStartTime = scene.startTime;
      previousOCRText = currentOCRText;
      return scene;
    }
  });

  return processedScenes;
}
```

**ロジック詳細**:

| 条件 | 判定 | 処理 |
|------|------|------|
| 新規テキスト | - | 表示（初回出現） |
| 連続重複 + 累計5秒以上 | 重要 | 表示（長時間表示=重要） |
| 連続重複 + 累計5秒未満 | 一時的 | 非表示（冗長性削減） |

**具体例**:
```
シーン1 (0-2s): "Company ABC" → 表示（初回）
シーン2 (2-3s): "Company ABC" → 非表示（累計3秒<5秒）
シーン3 (3-7s): "Company ABC" → 表示（累計7秒≥5秒=重要）
シーン4 (7-9s): "New Product" → 表示（新規テキスト）
シーン5 (9-11s): "New Product" → 非表示（累計2秒<5秒）
```

---

## 6. Excel生成

### 6.1 5列レイアウト構成

**実装場所**: `excel-generator.ts:59-65`

```typescript
worksheet.columns = [
  { header: 'Scene #', key: 'scene', width: 10 },
  { header: 'Timecode', key: 'timecode', width: 12 },
  { header: 'Screenshot', key: 'screenshot', width: columnWidth },
  { header: 'OCR Text', key: 'ocrText', width: 40 },
  { header: 'NA Text', key: 'naText', width: 40 }
];
```

**列詳細**:

| 列名 | 幅 | データ型 | 説明 |
|------|-----|---------|------|
| **Scene #** | 10文字 | 数値 | シーン番号（1, 2, 3...） |
| **Timecode** | 12文字 | 文字列 | HH:MM:SS形式 |
| **Screenshot** | 動的 | 画像 | 埋め込みPNG（アスペクト比保持） |
| **OCR Text** | 40文字 | 文字列（折り返し） | Gemini Vision OCR結果 |
| **NA Text** | 40文字 | 文字列（折り返し） | Whisper文字起こし結果 |

### 6.2 画像埋め込み処理

#### 6.2.1 アスペクト比計算

**実装場所**: `excel-generator.ts:34-44`

```typescript
// 動画メタデータからアスペクト比取得
const aspectRatio = videoMetadata.aspectRatio || DEFAULT_ASPECT_RATIO;
const imageWidth = EXCEL_IMAGE_WIDTH_PX; // 320px（固定）
const imageHeight = Math.round(imageWidth / aspectRatio);

// Excel単位変換
const columnWidth = Math.ceil(imageWidth / PIXELS_PER_CHARACTER_WIDTH);
const rowHeight = Math.round(imageHeight * POINTS_PER_PIXEL);
```

**単位変換定数**:
```typescript
const PIXELS_PER_CHARACTER_WIDTH = 7;  // 1文字幅 ≈ 7px（Calibri 11pt、96 DPI）
const POINTS_PER_PIXEL = 0.75;         // 96 DPI: 1px = 0.75pt
```

**例（16:9動画）**:
```
アスペクト比: 1.777 (1280x720)
画像幅: 320px
画像高さ: 320 / 1.777 ≈ 180px
列幅: 320 / 7 ≈ 46文字
行高: 180 * 0.75 ≈ 135pt
```

#### 6.2.2 画像センタリング

**実装場所**: `excel-generator.ts:139-155`

```typescript
// セル寸法をピクセル換算
const cellWidthPx = columnWidth * PIXELS_PER_CHARACTER_WIDTH;
const cellHeightPx = rowHeight / POINTS_PER_PIXEL;

// センタリングオフセット計算
const offsetX = Math.max(0, (cellWidthPx - imageWidth) / 2);
const offsetY = Math.max(0, (cellHeightPx - imageHeight) / 2);

worksheet.addImage(imageId, {
  tl: {
    col: 2,                    // C列（0始まり）
    row: rowNumber - 1,        // 現在行（0始まり）
    colOff: Math.round(offsetX * 9525), // 水平オフセット（EMU単位）
    rowOff: Math.round(offsetY * 9525)  // 垂直オフセット（EMU単位）
  } as any,
  ext: { width: imageWidth, height: imageHeight },
  editAs: 'oneCell'
});
```

**EMU（English Metric Units）**:
- Excel内部単位（1インチ = 914,400 EMU）
- 1ピクセル（96 DPI）= 9,525 EMU
- センタリング精度: サブピクセル対応

---

## 7. パフォーマンス最適化

### 7.1 並列処理戦略

#### 7.1.1 OCR並列処理

**並列度**: 3（同時実行最大3シーン）

**性能計算**:
```
シーン数: 100
1シーン処理時間: 4秒（平均）
並列度3 → 実効処理時間: 100 / 3 * 4秒 ≈ 133秒（約2分）
逐次処理 → 100 * 4秒 = 400秒（約7分）
高速化率: 約3倍
```

**制約**:
- Gemini APIレート制限: 15リクエスト/分
- 並列度3 → 約12秒/3リクエスト → 安全範囲内

### 7.2 タイムアウト設定

**設定ファイル**: `config/timeouts.ts`

| 操作 | タイムアウト | 想定時間 | 安全マージン |
|------|------------|---------|------------|
| シーン検出 | 300秒（5分） | 1-3分 | 2倍 |
| 音声抽出 | 600秒（10分） | 1-5分 | 2倍 |
| 音声チャンク抽出 | 30秒 | 0.5-2秒 | 15倍 |
| PCM変換 | 120秒（2分） | 10-60秒 | 2倍 |
| メタデータ抽出 | 30秒 | 1-5秒 | 6倍 |

**戦略**: 想定時間の2倍以上のマージン確保

---

## 8. 潜在的な問題点と対策

### 8.1 シーン検出関連

#### 8.1.1 問題: 過剰検出（フェード、ズーム）

**症状**: フェードイン/アウト、ズーム時に誤検出

**対策**:
- ✅ 最小シーン間隔フィルタ（2秒）
- ✅ 最小シーン継続時間（0.8秒）
- ✅ マルチパス閾値調整（0.02, 0.05, 0.08）

**今後の改善**:
- フェード検出フィルタの追加
- 動きベクトル分析の導入

#### 8.1.2 問題: タイムアウト（大容量動画）

**症状**: 500MB+、30分+動画での処理タイムアウト

**対策**:
- ✅ タイムアウト延長（300秒）
- ✅ Cloud Runメモリ増量（2Gi）

**今後の改善**:
- 動画圧縮の事前適用
- チャンク分割処理

### 8.2 OCR処理関連

#### 8.2.1 問題: Gemini APIレート制限超過

**症状**: 429エラー（Too Many Requests）

**対策**:
- ✅ RateLimiterクラスの使用
- ✅ 並列度制限（3並列）

**今後の改善**:
- 指数バックオフリトライ
- 複数APIキーのローテーション

#### 8.2.2 問題: 日本語OCR精度不足

**症状**: 縦書き、手書き風フォント、低解像度での誤検出

**対策**:
- ✅ 高解像度フレーム抽出（1280x720）
- ✅ gemini-2.5-flash（日本語最適化モデル）

**限界**:
- 縦書きテキスト（Geminiは対応しているが精度低下）
- 極端に装飾的なフォント

---

## 9. まとめ

### 9.1 技術的強み

1. **マルチパス検出**: 高精度シーン検出（見逃し・誤検出の最小化）
2. **並列OCR処理**: 処理時間の大幅短縮（3倍高速化）
3. **インテリジェントフィルタリング**: 動的閾値、時間ベース重複除去
4. **アスペクト比保持**: Excel画像の完全再現
5. **レート制限対策**: 安定したAPI呼び出し

### 9.2 パラメータ一覧

| パラメータ | 値 | 理由 |
|-----------|-----|------|
| **シーン検出閾値** | [0.02, 0.05, 0.08] | バランス型検出 |
| **最小シーン間隔** | 2.0秒 | 類似シーン除外 |
| **最小シーン継続時間** | 0.8秒 | ノイズ除外 |
| **OCR並列度** | 3 | レート制限遵守 |
| **Gemini APIレート** | 15リクエスト/分 | API仕様準拠 |
| **画像幅** | 320px | OCR最適化 |
| **画像解像度** | 1280x720 | 品質と速度のバランス |
| **永続オーバーレイ閾値** | 動的（50-80%） | シーン数適応 |
| **重複保持閾値** | 5秒 | 重要コンテンツ保護 |
| **シーン検出タイムアウト** | 300秒 | 大容量動画対応 |

---

**ドキュメント完**

このドキュメントは、Video Analyzer V2 Webのシーン検出とOCR処理の完全な技術仕様を提供します。コード変更時は、本ドキュメントを更新してください。
