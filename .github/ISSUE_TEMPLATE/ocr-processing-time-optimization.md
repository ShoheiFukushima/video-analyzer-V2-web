# Issue #2: OCR処理時間の最適化

## 優先度
🟡 **中** - パフォーマンスとユーザー体験の向上

## ステータス
🔴 **未対応**

## 問題の概要

現在のOCR処理パイプラインは、Gemini Vision APIへの逐次的なリクエストにより、シーン数に比例して処理時間が増加します。10分の動画（約30シーン）で約90秒の処理時間がかかり、ユーザー体験に影響を与えています。

### 現在のパフォーマンス

**実測値**:
```
10分の動画（30シーン想定）:
  - シーン検出: 20秒
  - OCR処理: 60秒（30シーン × 2秒/シーン）
  - その他処理: 10秒
  - 合計: 約90秒
```

**処理時間の内訳**:
| ステップ | 時間 | 割合 |
|---------|------|------|
| シーン検出（FFmpeg） | 20秒 | 22% |
| OCR処理（Gemini API） | 60秒 | 67% |
| フィルタリング | <1秒 | 1% |
| Excel生成 | 5秒 | 6% |
| その他 | 4秒 | 4% |

**ボトルネック**: OCR処理が全体の67%を占める

### 期待される改善

**目標**:
- **短期目標**: 処理時間を30-50%削減（90秒 → 45-60秒）
- **中期目標**: 処理時間を50-70%削減（90秒 → 27-45秒）
- **長期目標**: リアルタイム処理（動画時間とほぼ同じ処理時間）

---

## 根本原因の分析

### 技術的詳細

**ファイル**: `cloud-run-worker/src/services/pipeline.ts:109-193`

#### 現在の実装（逐次処理）

```typescript
async function performSceneBasedOCR(scenes: Scene[]): Promise<SceneWithOCR[]> {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const scenesWithOCR: SceneWithOCR[] = [];

  // ← ボトルネック: 逐次処理（for loop）
  for (const scene of scenes) {
    if (!scene.screenshotPath) {
      scenesWithOCR.push({ ...scene, ocrText: '', ocrConfidence: 0 });
      continue;
    }

    try {
      const imageBuffer = fs.readFileSync(scene.screenshotPath);
      const base64Image = imageBuffer.toString('base64');

      // ← APIコール（2秒/リクエスト）
      const result = await model.generateContent([
        prompt,
        { inlineData: { mimeType: 'image/png', data: base64Image } }
      ]);

      const responseText = result.response.text();
      // ... JSON解析 ...

      scenesWithOCR.push({
        ...scene,
        ocrText: ocrResult.text || '',
        ocrConfidence: ocrResult.confidence || 0
      });

      console.log(`  ✓ Scene ${scene.sceneNumber}: OCR complete (${ocrResult.text.length} chars)`);

    } catch (error) {
      console.error(`  ✗ Scene ${scene.sceneNumber}: OCR failed`);
      scenesWithOCR.push({ ...scene, ocrText: '', ocrConfidence: 0 });
    }
  }

  return scenesWithOCR;
}
```

**問題点**:
1. **逐次処理**: 各シーンを順番に処理（並列化不可）
2. **API待機時間**: 各リクエストで2秒待機
3. **ネットワークレイテンシ**: APIリクエスト毎のオーバーヘッド
4. **最適化の余地なし**: キャッシング、バッチ処理なし

---

## 提案された解決策

### アプローチ1: 並列OCR処理（短期）⭐

**概念**: 複数のOCRリクエストを並列実行

#### 技術設計

**並列処理の実装**:
```typescript
interface OCRConcurrencyConfig {
  maxConcurrency: number;      // 最大同時リクエスト数
  retryAttempts: number;       // リトライ回数
  retryDelay: number;          // リトライ間隔（ms）
  timeout: number;             // タイムアウト（ms）
}

const DEFAULT_CONCURRENCY_CONFIG: OCRConcurrencyConfig = {
  maxConcurrency: 5,    // Gemini APIのレート制限に基づく
  retryAttempts: 3,
  retryDelay: 1000,
  timeout: 30000        // 30秒
};

async function performSceneBasedOCRParallel(
  scenes: Scene[],
  config: OCRConcurrencyConfig = DEFAULT_CONCURRENCY_CONFIG
): Promise<SceneWithOCR[]> {
  console.log(`🚀 Starting parallel OCR with concurrency=${config.maxConcurrency}...`);

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  // バッチを作成（最大同時実行数で分割）
  const batches: Scene[][] = [];
  for (let i = 0; i < scenes.length; i += config.maxConcurrency) {
    batches.push(scenes.slice(i, i + config.maxConcurrency));
  }

  const allResults: SceneWithOCR[] = [];

  // 各バッチを並列処理
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    console.log(`  📦 Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} scenes)...`);

    // バッチ内のシーンを並列処理
    const batchPromises = batch.map(scene =>
      performOCRWithRetry(scene, model, config)
    );

    const batchResults = await Promise.allSettled(batchPromises);

    // 結果を処理
    batchResults.forEach((result, index) => {
      const scene = batch[index];

      if (result.status === 'fulfilled') {
        allResults.push(result.value);
        console.log(`  ✓ Scene ${scene.sceneNumber}: OCR complete`);
      } else {
        console.error(`  ✗ Scene ${scene.sceneNumber}: OCR failed - ${result.reason}`);
        allResults.push({
          ...scene,
          ocrText: '',
          ocrConfidence: 0
        });
      }
    });
  }

  // シーン番号順にソート
  allResults.sort((a, b) => a.sceneNumber - b.sceneNumber);

  console.log(`  ✓ Parallel OCR complete: ${allResults.filter(s => s.ocrText).length}/${scenes.length} scenes with text`);

  return allResults;
}
```

**リトライロジック**:
```typescript
async function performOCRWithRetry(
  scene: Scene,
  model: any,
  config: OCRConcurrencyConfig
): Promise<SceneWithOCR> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= config.retryAttempts; attempt++) {
    try {
      // タイムアウト付きOCR実行
      const result = await Promise.race([
        performSingleOCR(scene, model),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('OCR timeout')), config.timeout)
        )
      ]);

      return result;

    } catch (error) {
      lastError = error as Error;
      console.warn(`  ⚠️ Scene ${scene.sceneNumber}: Attempt ${attempt}/${config.retryAttempts} failed - ${lastError.message}`);

      if (attempt < config.retryAttempts) {
        // 指数バックオフ
        const delay = config.retryDelay * Math.pow(2, attempt - 1);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  // 全てのリトライが失敗
  throw lastError || new Error('OCR failed after all retries');
}

async function performSingleOCR(
  scene: Scene,
  model: any
): Promise<SceneWithOCR> {
  if (!scene.screenshotPath) {
    return { ...scene, ocrText: '', ocrConfidence: 0 };
  }

  const imageBuffer = fs.readFileSync(scene.screenshotPath);
  const base64Image = imageBuffer.toString('base64');

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

  const result = await model.generateContent([
    prompt,
    { inlineData: { mimeType: 'image/png', data: base64Image } }
  ]);

  const responseText = result.response.text();

  // JSON解析
  let ocrResult: { text: string; confidence: number };
  try {
    const jsonText = responseText.replace(/```json\n?|\n?```/g, '').trim();
    ocrResult = JSON.parse(jsonText);
  } catch {
    ocrResult = { text: responseText, confidence: 0.5 };
  }

  return {
    ...scene,
    ocrText: ocrResult.text || '',
    ocrConfidence: ocrResult.confidence || 0
  };
}
```

#### レート制限への対応

**Gemini APIのレート制限**:
- Free tier: 15 RPM (Requests Per Minute)
- Paid tier: 60-1000 RPM（プランによる）

**動的レート制限調整**:
```typescript
class RateLimiter {
  private requestTimes: number[] = [];
  private maxRequestsPerMinute: number;

  constructor(maxRequestsPerMinute: number = 15) {
    this.maxRequestsPerMinute = maxRequestsPerMinute;
  }

  async waitIfNeeded(): Promise<void> {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    // 1分以内のリクエストをフィルタ
    this.requestTimes = this.requestTimes.filter(t => t > oneMinuteAgo);

    if (this.requestTimes.length >= this.maxRequestsPerMinute) {
      // レート制限に達した場合、待機
      const oldestRequest = this.requestTimes[0];
      const waitTime = oldestRequest + 60000 - now;

      if (waitTime > 0) {
        console.log(`  ⏳ Rate limit reached, waiting ${waitTime}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }

    this.requestTimes.push(now);
  }
}

// 使用例
const rateLimiter = new RateLimiter(15); // 15 RPM

async function performOCRWithRateLimit(scene: Scene, model: any): Promise<SceneWithOCR> {
  await rateLimiter.waitIfNeeded();
  return performSingleOCR(scene, model);
}
```

#### パフォーマンス予測

**並列度による処理時間の比較**:

| 並列度 | 30シーンの処理時間 | 改善率 |
|-------|-----------------|-------|
| 1（現状） | 60秒 | 0% |
| 3 | 20秒 | 67% |
| 5 | 12秒 | 80% |
| 10 | 6秒 | 90% |

**推奨**: 並列度5（Gemini Free tierのレート制限内で最大効率）

#### メリット
- ✅ 処理時間が大幅に短縮（60秒 → 12秒、80%削減）
- ✅ Gemini APIのレート制限に対応
- ✅ エラー時のリトライ機能
- ✅ タイムアウト保護

#### デメリット
- ⚠️ レート制限に注意が必要
- ⚠️ メモリ使用量の増加（同時に複数のBase64画像を保持）
- ⚠️ エラーハンドリングが複雑化

---

### アプローチ2: 画像解像度の最適化（短期）

**概念**: OCR精度を維持しつつ画像サイズを削減

#### 技術設計

**現在の解像度**: 1280x720 (0.92MP)

**最適化戦略**:
```typescript
interface ImageOptimizationConfig {
  width: number;
  height: number;
  quality: number;      // JPEG品質（1-100）
  format: 'png' | 'jpg' | 'webp';
}

const RESOLUTION_PRESETS = {
  high: { width: 1280, height: 720, quality: 95, format: 'png' },      // 現状
  medium: { width: 960, height: 540, quality: 90, format: 'jpg' },     // 推奨
  low: { width: 640, height: 360, quality: 85, format: 'jpg' }         // 高速
};

async function extractFrameWithOptimization(
  videoPath: string,
  timestamp: number,
  outputPath: string,
  config: ImageOptimizationConfig = RESOLUTION_PRESETS.medium
): Promise<void> {
  return new Promise((resolve, reject) => {
    let ffmpegCommand = ffmpeg(videoPath)
      .seekInput(timestamp)
      .frames(1)
      .size(`${config.width}x${config.height}`);

    // フォーマット別の最適化
    if (config.format === 'jpg') {
      ffmpegCommand = ffmpegCommand.outputOptions([
        `-q:v ${Math.round((100 - config.quality) / 3.125)}` // FFmpeg quality scale
      ]);
    } else if (config.format === 'webp') {
      ffmpegCommand = ffmpegCommand.outputOptions([
        `-quality ${config.quality}`
      ]);
    }

    ffmpegCommand
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .run();
  });
}
```

**Base64サイズの比較**:

| 解像度 | 形式 | ファイルサイズ | Base64サイズ | 転送時間* |
|-------|-----|-------------|------------|----------|
| 1280x720 | PNG | ~800KB | ~1.1MB | ~110ms |
| 960x540 | JPG | ~200KB | ~270KB | ~27ms |
| 640x360 | JPG | ~100KB | ~135KB | ~14ms |

*転送時間: 10Mbps接続を想定

**OCR精度への影響テスト**:
```typescript
interface OCRAccuracyTest {
  resolution: string;
  correctCharacters: number;
  totalCharacters: number;
  accuracy: number;
}

async function testOCRAccuracy(
  videoPath: string,
  groundTruth: string
): Promise<OCRAccuracyTest[]> {
  const results: OCRAccuracyTest[] = [];

  for (const [preset, config] of Object.entries(RESOLUTION_PRESETS)) {
    // フレーム抽出
    const framePath = `/tmp/test-frame-${preset}.${config.format}`;
    await extractFrameWithOptimization(videoPath, 5.0, framePath, config);

    // OCR実行
    const ocrResult = await performOCR(framePath);

    // 精度計算（Levenshtein distance）
    const accuracy = calculateAccuracy(ocrResult.text, groundTruth);

    results.push({
      resolution: preset,
      correctCharacters: accuracy.correct,
      totalCharacters: groundTruth.length,
      accuracy: accuracy.percentage
    });
  }

  return results;
}
```

#### メリット
- ✅ API転送時間の削減（110ms → 27ms、75%削減）
- ✅ メモリ使用量の削減
- ✅ ネットワーク帯域幅の節約

#### デメリット
- ⚠️ OCR精度への影響（要検証）
- ⚠️ 低解像度動画では効果が限定的

---

### アプローチ3: スマートフレーム選択（中期）

**概念**: 全シーンをOCR処理せず、テキストが含まれる可能性の高いフレームのみ処理

#### 技術設計

**Phase 1: 高速プリスキャン（軽量モデル）**
```typescript
interface FrameAnalysis {
  sceneNumber: number;
  hasTextLikelihood: number;  // 0-1の確率
  textDensity: number;         // 推定テキスト密度
  shouldProcessOCR: boolean;
}

async function preAnalyzeFrames(
  scenes: Scene[]
): Promise<FrameAnalysis[]> {
  const analyses: FrameAnalysis[] = [];

  // 軽量な画像分析（OpenCVやJimp使用）
  for (const scene of scenes) {
    if (!scene.screenshotPath) {
      analyses.push({
        sceneNumber: scene.sceneNumber,
        hasTextLikelihood: 0,
        textDensity: 0,
        shouldProcessOCR: false
      });
      continue;
    }

    // エッジ検出でテキストの存在を推定
    const hasTextLikelihood = await detectTextLikelihood(scene.screenshotPath);

    analyses.push({
      sceneNumber: scene.sceneNumber,
      hasTextLikelihood,
      textDensity: hasTextLikelihood,
      shouldProcessOCR: hasTextLikelihood > 0.3 // 閾値: 30%
    });
  }

  return analyses;
}

async function detectTextLikelihood(imagePath: string): Promise<number> {
  // シンプルなエッジ検出アルゴリズム
  // Cannyエッジ検出 → 水平線の密度 → テキスト確率

  const image = await loadImage(imagePath);
  const edges = detectEdges(image);
  const horizontalLines = countHorizontalLines(edges);

  // テキストは水平線が多い特徴がある
  const likelihood = Math.min(horizontalLines / 1000, 1.0);

  return likelihood;
}
```

**Phase 2: 選択的OCR処理**
```typescript
async function performSelectiveOCR(
  scenes: Scene[]
): Promise<SceneWithOCR[]> {
  // プリスキャン
  const analyses = await preAnalyzeFrames(scenes);

  const scenesToProcess = scenes.filter((scene, index) =>
    analyses[index].shouldProcessOCR
  );

  console.log(`  📊 Pre-analysis: ${scenesToProcess.length}/${scenes.length} scenes selected for OCR (${((scenesToProcess.length / scenes.length) * 100).toFixed(0)}%)`);

  // 選択されたシーンのみOCR処理
  const processedScenes = await performSceneBasedOCRParallel(scenesToProcess);

  // 結果をマージ
  const allResults = scenes.map((scene, index) => {
    if (analyses[index].shouldProcessOCR) {
      return processedScenes.find(s => s.sceneNumber === scene.sceneNumber)!;
    } else {
      return { ...scene, ocrText: '', ocrConfidence: 0 };
    }
  });

  return allResults;
}
```

#### メリット
- ✅ 処理するシーン数を削減（推定: 50-70%削減）
- ✅ 不要なAPI呼び出しを削減（コスト削減）
- ✅ 全体的な処理時間の短縮

#### デメリット
- ⚠️ テキスト検出の誤判定リスク（false negative）
- ⚠️ プリスキャンの実装コストが高い
- ⚠️ 追加のライブラリ依存（OpenCV、Jimp）

---

### アプローチ4: キャッシング機構（長期）

**概念**: 同じ動画の再処理時にOCR結果を再利用

#### 技術設計

```typescript
interface OCRCache {
  videoHash: string;          // 動画ファイルのハッシュ
  sceneNumber: number;
  timestamp: number;
  ocrText: string;
  ocrConfidence: number;
  createdAt: Date;
}

class OCRCacheService {
  private cache: Map<string, OCRCache>;

  constructor() {
    this.cache = new Map();
  }

  // 動画のハッシュを計算（MD5またはSHA256）
  async getVideoHash(videoPath: string): Promise<string> {
    const crypto = require('crypto');
    const fileBuffer = fs.readFileSync(videoPath);
    const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    return hash.substring(0, 16); // 短縮ハッシュ
  }

  // キャッシュキーの生成
  getCacheKey(videoHash: string, sceneNumber: number): string {
    return `${videoHash}:${sceneNumber}`;
  }

  // キャッシュから取得
  get(videoHash: string, sceneNumber: number): OCRCache | null {
    const key = this.getCacheKey(videoHash, sceneNumber);
    return this.cache.get(key) || null;
  }

  // キャッシュに保存
  set(videoHash: string, sceneNumber: number, ocrResult: OCRCache): void {
    const key = this.getCacheKey(videoHash, sceneNumber);
    this.cache.set(key, ocrResult);
  }

  // キャッシュをクリア（古いエントリを削除）
  cleanup(maxAge: number = 86400000): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.createdAt.getTime() > maxAge) {
        this.cache.delete(key);
      }
    }
  }
}

// 使用例
const ocrCache = new OCRCacheService();

async function performOCRWithCache(
  scene: Scene,
  videoPath: string,
  model: any
): Promise<SceneWithOCR> {
  const videoHash = await ocrCache.getVideoHash(videoPath);
  const cached = ocrCache.get(videoHash, scene.sceneNumber);

  if (cached) {
    console.log(`  💾 Scene ${scene.sceneNumber}: Using cached OCR result`);
    return { ...scene, ocrText: cached.ocrText, ocrConfidence: cached.ocrConfidence };
  }

  // キャッシュミス: OCR実行
  const result = await performSingleOCR(scene, model);

  // キャッシュに保存
  ocrCache.set(videoHash, scene.sceneNumber, {
    videoHash,
    sceneNumber: scene.sceneNumber,
    timestamp: scene.startTime,
    ocrText: result.ocrText,
    ocrConfidence: result.ocrConfidence,
    createdAt: new Date()
  });

  return result;
}
```

#### メリット
- ✅ 再処理時の高速化（キャッシュヒット時は即座に結果を返す）
- ✅ API呼び出しの削減（コスト削減）
- ✅ ユーザー体験の向上

#### デメリット
- ⚠️ ストレージ容量の消費
- ⚠️ キャッシュ管理の複雑性
- ⚠️ 初回処理には効果なし

---

## 実装計画

### Phase 1: 並列OCR処理（短期）⭐

**タスク**:
1. `performSceneBasedOCRParallel()` 関数の実装
2. レート制限機能の実装
3. リトライロジックの実装
4. 環境変数での並列度設定（`OCR_CONCURRENCY=5`）
5. パフォーマンステスト

**ファイル変更**:
- `cloud-run-worker/src/services/pipeline.ts` - 並列処理実装
- `cloud-run-worker/src/utils/rate-limiter.ts` - 新規ファイル
- `cloud-run-worker/src/config/ocr.ts` - 新規ファイル（設定）

**推定工数**: 6-8時間

### Phase 2: 画像解像度最適化（短期）

**タスク**:
1. 複数解像度でのOCR精度テスト
2. 最適解像度の決定
3. FFmpegフレーム抽出の更新
4. A/Bテスト実装

**ファイル変更**:
- `cloud-run-worker/src/services/ffmpeg.ts` - フレーム抽出最適化
- `cloud-run-worker/test/ocr-accuracy-test.ts` - 新規テスト

**推定工数**: 4-6時間

### Phase 3: スマートフレーム選択（中期）

**タスク**:
1. 画像分析ライブラリの選定（OpenCV.js、Jimp）
2. テキスト検出アルゴリズムの実装
3. 閾値の調整とテスト
4. 統合テスト

**ファイル変更**:
- `cloud-run-worker/src/services/frame-analyzer.ts` - 新規ファイル
- `cloud-run-worker/src/services/pipeline.ts` - 統合
- `package.json` - 新依存関係

**推定工数**: 12-16時間

### Phase 4: キャッシング機構（長期）

**タスク**:
1. キャッシュストレージの設計（Redis、Supabase）
2. キャッシュサービスの実装
3. キャッシュクリーンアップロジック
4. 統合テスト

**ファイル変更**:
- `cloud-run-worker/src/services/ocr-cache.ts` - 新規ファイル
- `cloud-run-worker/src/services/pipeline.ts` - キャッシュ統合

**推定工数**: 16-20時間

**合計工数**: 38-50時間（段階的実装）

---

## テスト計画

### パフォーマンステスト

```typescript
describe('OCR Performance Tests', () => {
  it('should process 30 scenes in parallel < 15 seconds', async () => {
    const scenes = generateMockScenes(30);

    const startTime = Date.now();
    const results = await performSceneBasedOCRParallel(scenes, {
      maxConcurrency: 5
    });
    const endTime = Date.now();

    const processingTime = endTime - startTime;
    console.log(`Processing time: ${processingTime}ms`);

    expect(processingTime).toBeLessThan(15000); // < 15秒
    expect(results).toHaveLength(30);
  });

  it('should handle rate limiting gracefully', async () => {
    const scenes = generateMockScenes(50); // レート制限を超える数

    const startTime = Date.now();
    await performSceneBasedOCRParallel(scenes, {
      maxConcurrency: 5
    });
    const endTime = Date.now();

    // レート制限による待機時間を含めても合理的な時間内
    expect(endTime - startTime).toBeLessThan(120000); // < 2分
  });

  it('should retry failed requests', async () => {
    const scene = mockScene(1);
    let attempts = 0;

    const mockModel = {
      generateContent: jest.fn(async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('API Error');
        }
        return { response: { text: () => '{"text":"Success","confidence":0.9}' } };
      })
    };

    const result = await performOCRWithRetry(scene, mockModel, {
      maxConcurrency: 1,
      retryAttempts: 3,
      retryDelay: 100,
      timeout: 5000
    });

    expect(attempts).toBe(3);
    expect(result.ocrText).toBe('Success');
  });
});
```

### 精度テスト

```typescript
describe('Resolution Optimization Tests', () => {
  it('should maintain >95% accuracy at 960x540', async () => {
    const testCases = [
      { video: 'test-video-1.mp4', groundTruth: 'Expected Text 1' },
      { video: 'test-video-2.mp4', groundTruth: 'Expected Text 2' }
    ];

    for (const testCase of testCases) {
      const results = await testOCRAccuracy(testCase.video, testCase.groundTruth);
      const mediumResAccuracy = results.find(r => r.resolution === 'medium')!;

      expect(mediumResAccuracy.accuracy).toBeGreaterThan(95);
    }
  });
});
```

### 統合テスト

```typescript
describe('End-to-End Performance Tests', () => {
  it('should process 10-minute video in < 60 seconds', async () => {
    const videoPath = 'test-videos/10min-sample.mp4';

    const startTime = Date.now();
    const result = await executeIdealPipeline(videoPath, 'Test Project', []);
    const endTime = Date.now();

    const totalTime = (endTime - startTime) / 1000;
    console.log(`Total processing time: ${totalTime}s`);

    expect(totalTime).toBeLessThan(60);
  });
});
```

---

## 期待される効果

### パフォーマンス改善

**短期（Phase 1 + 2）**:
```
並列処理（5並列）: 60秒 → 12秒（80%削減）
解像度最適化: 転送時間 110ms → 27ms（75%削減/シーン）
合計改善: 90秒 → 35秒（61%削減）
```

**中期（Phase 3）**:
```
スマートフレーム選択: 処理シーン数 50%削減
合計改善: 35秒 → 18秒（80%削減 vs 現状）
```

**長期（Phase 4）**:
```
キャッシング: 再処理時 90秒 → 5秒（94%削減）
```

### ユーザー体験の向上
- ✅ 待機時間の大幅削減
- ✅ リアルタイムに近い処理速度
- ✅ ストレスフリーな操作感

### コスト削減
- ✅ API呼び出し数の削減（スマートフレーム選択）
- ✅ ネットワーク帯域幅の節約
- ✅ Cloud Runの実行時間削減

---

## モニタリングと分析

### パフォーマンスメトリクス

```typescript
interface PerformanceMetrics {
  totalProcessingTime: number;      // 総処理時間（ms）
  ocrProcessingTime: number;        // OCR処理時間（ms）
  sceneDetectionTime: number;       // シーン検出時間（ms）
  averageOCRTimePerScene: number;   // 平均OCR時間/シーン（ms）
  concurrencyLevel: number;         // 並列度
  cacheHitRate?: number;            // キャッシュヒット率（0-1）
  apiCallCount: number;             // API呼び出し回数
}

function logPerformanceMetrics(metrics: PerformanceMetrics): void {
  console.log('\n📊 Performance Metrics:');
  console.log(`  Total time: ${(metrics.totalProcessingTime / 1000).toFixed(2)}s`);
  console.log(`  OCR time: ${(metrics.ocrProcessingTime / 1000).toFixed(2)}s (${((metrics.ocrProcessingTime / metrics.totalProcessingTime) * 100).toFixed(0)}%)`);
  console.log(`  Avg OCR/scene: ${metrics.averageOCRTimePerScene.toFixed(0)}ms`);
  console.log(`  Concurrency: ${metrics.concurrencyLevel}`);
  console.log(`  API calls: ${metrics.apiCallCount}`);

  if (metrics.cacheHitRate !== undefined) {
    console.log(`  Cache hit rate: ${(metrics.cacheHitRate * 100).toFixed(0)}%`);
  }
}
```

---

## 参考資料

- FFmpeg並列処理: https://trac.ffmpeg.org/wiki/EncodingForStreamingSites
- Gemini APIレート制限: https://ai.google.dev/gemini-api/docs/quota
- Node.js並列処理ベストプラクティス: https://nodejs.org/api/async_hooks.html

---

## 備考

- 並列度はGemini APIのプランに応じて調整が必要
- レート制限エラーが頻発する場合は並列度を下げる
- 画像解像度の最適化は事前に精度テストを実施

---

**作成日**: 2025-11-03
**担当者**: 次のClaudeセッション
**優先度**: 中
**推定工数**: 38-50時間（段階的実装）
