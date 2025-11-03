# Issue #3: OCR信頼度スコアの実装

## 優先度
🟢 **低-中** - 品質管理と将来的な機能拡張

## ステータス
🔴 **未対応**

## 問題の概要

現在のOCR実装では、Gemini Vision APIが信頼度スコアを返さないため、全てのOCR結果に固定値（0.85または0.5）が設定されています。これにより、OCR結果の品質評価が困難で、ユーザーは誤検出や低品質なテキストを判別できません。

### 現在の実装

**ファイル**: `cloud-run-worker/src/services/pipeline.ts:169-170`

```typescript
scenesWithOCR.push({
  ...scene,
  ocrText: ocrResult.text || '',
  ocrConfidence: ocrResult.confidence || 0  // ← Geminiは信頼度を返さない
});
```

**フォールバック値**:
```typescript
// ocrService.ts:149
confidence: 0.85  // 固定値
```

### 問題点

1. **品質評価不可**: OCR結果の信頼性を判定できない
2. **誤検出の見逃し**: 低品質なテキストがそのままExcelに出力される
3. **ユーザー警告なし**: ユーザーは結果を盲目的に信頼せざるを得ない
4. **フィルタリング不可**: 信頼度に基づく自動フィルタリングができない

### 影響範囲
- ✗ OCR結果の品質が不明
- ✗ 誤検出（ノイズ、アーティファクト）を排除できない
- ✗ ユーザーが手動で精査する必要がある
- ✗ 将来的な機械学習改善の基盤がない

---

## 提案された解決策

### アプローチ1: ヒューリスティックベースの信頼度推定（短期）⭐

**概念**: テキストの特徴から信頼度を推定

#### 技術設計

**信頼度推定アルゴリズム**:

```typescript
interface ConfidenceFactors {
  textLength: number;           // テキスト長（0-1正規化）
  characterDiversity: number;   // 文字の多様性
  containsKnownWords: number;   // 既知の単語を含む度合い
  hasStructure: number;         // 構造的なテキストか（改行、句読点）
  languageConsistency: number;  // 言語の一貫性（日本語/英語混在度）
  symbolRatio: number;          // 記号の割合
}

class OCRConfidenceEstimator {
  /**
   * テキストの特徴から信頼度を推定
   * @param text - OCRで抽出されたテキスト
   * @returns 信頼度スコア（0-1）
   */
  estimateConfidence(text: string): number {
    if (!text || text.trim().length === 0) {
      return 0;
    }

    const factors = this.calculateFactors(text);
    const confidence = this.aggregateFactors(factors);

    return confidence;
  }

  /**
   * テキストの特徴を計算
   */
  private calculateFactors(text: string): ConfidenceFactors {
    return {
      textLength: this.calculateTextLengthScore(text),
      characterDiversity: this.calculateCharacterDiversity(text),
      containsKnownWords: this.calculateKnownWordScore(text),
      hasStructure: this.calculateStructureScore(text),
      languageConsistency: this.calculateLanguageConsistency(text),
      symbolRatio: this.calculateSymbolRatio(text)
    };
  }

  /**
   * テキスト長スコア（適度な長さが高スコア）
   */
  private calculateTextLengthScore(text: string): number {
    const length = text.trim().length;

    if (length === 0) return 0;
    if (length < 3) return 0.3;        // 短すぎる（ノイズの可能性）
    if (length < 10) return 0.6;       // やや短い
    if (length < 100) return 1.0;      // 適切
    if (length < 500) return 0.9;      // やや長い
    return 0.7;                         // 非常に長い（誤検出の可能性）
  }

  /**
   * 文字の多様性（同じ文字の繰り返しは低スコア）
   */
  private calculateCharacterDiversity(text: string): number {
    const uniqueChars = new Set(text).size;
    const totalChars = text.length;

    if (totalChars === 0) return 0;

    const diversity = uniqueChars / totalChars;

    // 多様性が高いほど高スコア（ただし上限あり）
    return Math.min(diversity * 2, 1.0);
  }

  /**
   * 既知の単語を含むスコア
   */
  private calculateKnownWordScore(text: string): number {
    // 日本語の一般的な単語リスト
    const japaneseCommonWords = [
      '病院', '会社', '株式', '住所', '電話', '番号', 'TEL', 'FAX',
      '営業', '時間', '定休', '日', '月', '火', '水', '木', '金', '土',
      '案内', 'お知らせ', 'ご注意', 'について', 'ください'
    ];

    // 英語の一般的な単語リスト
    const englishCommonWords = [
      'the', 'and', 'or', 'is', 'are', 'at', 'in', 'on',
      'company', 'hospital', 'address', 'phone', 'email',
      'hours', 'open', 'closed', 'notice', 'information'
    ];

    const allCommonWords = [...japaneseCommonWords, ...englishCommonWords];

    let matchCount = 0;
    for (const word of allCommonWords) {
      if (text.includes(word)) {
        matchCount++;
      }
    }

    // 既知単語の出現数に基づくスコア
    return Math.min(matchCount / 3, 1.0);
  }

  /**
   * テキスト構造スコア（改行、句読点など）
   */
  private calculateStructureScore(text: string): number {
    let score = 0.5; // ベーススコア

    // 改行がある（構造的）
    if (text.includes('\n')) score += 0.2;

    // 句読点がある
    if (/[。、！？,.!?]/.test(text)) score += 0.2;

    // スペースで区切られている
    if (/\s/.test(text)) score += 0.1;

    return Math.min(score, 1.0);
  }

  /**
   * 言語の一貫性スコア
   */
  private calculateLanguageConsistency(text: string): number {
    const hasJapanese = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(text);
    const hasEnglish = /[a-zA-Z]/.test(text);
    const hasNumbers = /[0-9]/.test(text);

    // 日本語または英語が主体であれば高スコア
    if (hasJapanese || hasEnglish) return 1.0;

    // 数字のみは中程度
    if (hasNumbers) return 0.6;

    // 記号のみは低スコア
    return 0.3;
  }

  /**
   * 記号の割合（記号が多すぎると低スコア）
   */
  private calculateSymbolRatio(text: string): number {
    const symbolCount = (text.match(/[^\w\s\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/g) || []).length;
    const totalChars = text.length;

    if (totalChars === 0) return 0;

    const symbolRatio = symbolCount / totalChars;

    // 記号が少ないほど高スコア
    if (symbolRatio < 0.1) return 1.0;      // 記号10%未満: 良好
    if (symbolRatio < 0.3) return 0.7;      // 記号30%未満: 許容
    if (symbolRatio < 0.5) return 0.4;      // 記号50%未満: 疑わしい
    return 0.1;                              // 記号50%以上: ノイズの可能性
  }

  /**
   * 各要素を重み付けして集約
   */
  private aggregateFactors(factors: ConfidenceFactors): number {
    const weights = {
      textLength: 0.15,
      characterDiversity: 0.15,
      containsKnownWords: 0.25,
      hasStructure: 0.15,
      languageConsistency: 0.20,
      symbolRatio: 0.10
    };

    const weightedSum =
      factors.textLength * weights.textLength +
      factors.characterDiversity * weights.characterDiversity +
      factors.containsKnownWords * weights.containsKnownWords +
      factors.hasStructure * weights.hasStructure +
      factors.languageConsistency * weights.languageConsistency +
      factors.symbolRatio * weights.symbolRatio;

    // 0-1の範囲に正規化
    return Math.max(0, Math.min(1, weightedSum));
  }

  /**
   * デバッグ情報を出力
   */
  explainConfidence(text: string): { confidence: number; factors: ConfidenceFactors } {
    const factors = this.calculateFactors(text);
    const confidence = this.aggregateFactors(factors);

    return { confidence, factors };
  }
}
```

**使用例**:
```typescript
async function performOCRWithConfidence(
  scene: Scene,
  model: any
): Promise<SceneWithOCR> {
  // OCR実行
  const result = await performSingleOCR(scene, model);

  // 信頼度を推定
  const estimator = new OCRConfidenceEstimator();
  const confidence = estimator.estimateConfidence(result.ocrText);

  console.log(`  ✓ Scene ${scene.sceneNumber}: OCR complete (confidence: ${(confidence * 100).toFixed(0)}%)`);

  return {
    ...scene,
    ocrText: result.ocrText,
    ocrConfidence: confidence
  };
}
```

#### メリット
- ✅ 即座に実装可能（外部API不要）
- ✅ コストなし
- ✅ カスタマイズ可能
- ✅ デバッグ情報を取得可能

#### デメリット
- ⚠️ 真の信頼度ではなく推定値
- ⚠️ ヒューリスティックの調整が必要
- ⚠️ エッジケースでの精度に限界

---

### アプローチ2: セカンダリOCRエンジンとの比較検証（中期）

**概念**: 複数のOCRエンジンの結果を比較して信頼度を推定

#### 技術設計

**マルチエンジン検証**:
```typescript
interface OCREngineResult {
  engine: 'gemini' | 'tesseract' | 'google-vision';
  text: string;
  confidence?: number;
  processingTime: number;
}

class MultiEngineOCRValidator {
  /**
   * 複数エンジンでOCRを実行し、結果を検証
   */
  async performMultiEngineOCR(
    imagePath: string
  ): Promise<{ text: string; confidence: number }> {
    // 並列実行
    const [geminiResult, tesseractResult] = await Promise.allSettled([
      this.performGeminiOCR(imagePath),
      this.performTesseractOCR(imagePath)
    ]);

    // 結果の抽出
    const results: OCREngineResult[] = [];

    if (geminiResult.status === 'fulfilled') {
      results.push(geminiResult.value);
    }

    if (tesseractResult.status === 'fulfilled') {
      results.push(tesseractResult.value);
    }

    // 結果の比較と信頼度計算
    const { text, confidence } = this.compareResults(results);

    return { text, confidence };
  }

  /**
   * Gemini OCR
   */
  private async performGeminiOCR(imagePath: string): Promise<OCREngineResult> {
    const startTime = Date.now();
    // ... Gemini OCR実行 ...
    const text = 'Gemini result';

    return {
      engine: 'gemini',
      text,
      confidence: undefined, // Geminiは信頼度を返さない
      processingTime: Date.now() - startTime
    };
  }

  /**
   * Tesseract OCR（軽量、高速）
   */
  private async performTesseractOCR(imagePath: string): Promise<OCREngineResult> {
    const startTime = Date.now();

    // Tesseract.js使用（日本語+英語）
    const { createWorker } = require('tesseract.js');
    const worker = await createWorker('jpn+eng');

    const { data } = await worker.recognize(imagePath);
    await worker.terminate();

    return {
      engine: 'tesseract',
      text: data.text,
      confidence: data.confidence / 100, // 0-100 → 0-1
      processingTime: Date.now() - startTime
    };
  }

  /**
   * 結果を比較して最終テキストと信頼度を決定
   */
  private compareResults(
    results: OCREngineResult[]
  ): { text: string; confidence: number } {
    if (results.length === 0) {
      return { text: '', confidence: 0 };
    }

    if (results.length === 1) {
      return {
        text: results[0].text,
        confidence: results[0].confidence || 0.5
      };
    }

    // 2つ以上の結果がある場合
    const [result1, result2] = results;

    // テキストの類似度を計算（Levenshtein distance）
    const similarity = this.calculateSimilarity(result1.text, result2.text);

    // 類似度が高い → 高信頼度
    // 類似度が低い → 低信頼度（どちらかが誤検出）
    let confidence: number;

    if (similarity > 0.8) {
      // 非常に類似: 高信頼度
      confidence = 0.95;
    } else if (similarity > 0.6) {
      // やや類似: 中信頼度
      confidence = 0.75;
    } else if (similarity > 0.4) {
      // やや異なる: 低中信頼度
      confidence = 0.55;
    } else {
      // 大きく異なる: 低信頼度
      confidence = 0.35;
    }

    // Tesseractの信頼度が利用可能な場合は加味
    if (result2.confidence !== undefined) {
      confidence = (confidence + result2.confidence) / 2;
    }

    // より長いテキストを採用（Geminiの方が詳細な場合が多い）
    const text = result1.text.length >= result2.text.length
      ? result1.text
      : result2.text;

    return { text, confidence };
  }

  /**
   * Levenshtein距離を使用してテキストの類似度を計算
   */
  private calculateSimilarity(text1: string, text2: string): number {
    const distance = this.levenshteinDistance(text1, text2);
    const maxLength = Math.max(text1.length, text2.length);

    if (maxLength === 0) return 1.0;

    return 1 - distance / maxLength;
  }

  /**
   * Levenshtein距離の計算
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const m = str1.length;
    const n = str2.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (str1[i - 1] === str2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1];
        } else {
          dp[i][j] = Math.min(
            dp[i - 1][j] + 1,    // 削除
            dp[i][j - 1] + 1,    // 挿入
            dp[i - 1][j - 1] + 1 // 置換
          );
        }
      }
    }

    return dp[m][n];
  }
}
```

#### パフォーマンスへの影響

**処理時間の増加**:
```
Gemini単体: 2秒/シーン
Gemini + Tesseract並列: 2.5秒/シーン（+25%）
```

**軽減策**:
- Tesseractは軽量なため影響は最小限
- 並列実行で時間増加を抑制
- 信頼度が低いシーンのみセカンダリチェック

#### メリット
- ✅ 客観的な信頼度評価
- ✅ クロスバリデーション
- ✅ 誤検出の検出精度向上

#### デメリット
- ⚠️ 処理時間の増加（+25%）
- ⚠️ 追加ライブラリ（Tesseract.js）
- ⚠️ メモリ使用量の増加

---

### アプローチ3: Google Cloud Vision APIの併用（長期）

**概念**: より高精度なOCR APIを併用して信頼度を取得

#### 技術設計

```typescript
interface VisionAPIResponse {
  text: string;
  confidence: number;
  boundingBoxes: BoundingBox[];
}

interface BoundingBox {
  text: string;
  confidence: number;
  vertices: { x: number; y: number }[];
}

class GoogleVisionOCRService {
  private client: any;

  constructor() {
    const vision = require('@google-cloud/vision');
    this.client = new vision.ImageAnnotatorClient();
  }

  /**
   * Google Cloud Vision APIでOCR実行
   */
  async performVisionOCR(imagePath: string): Promise<VisionAPIResponse> {
    const [result] = await this.client.textDetection(imagePath);
    const detections = result.textAnnotations;

    if (!detections || detections.length === 0) {
      return {
        text: '',
        confidence: 0,
        boundingBoxes: []
      };
    }

    // 最初の要素が全体テキスト
    const fullText = detections[0].description;
    const fullConfidence = detections[0].confidence || 0.9;

    // 個別の単語/行のバウンディングボックス
    const boundingBoxes: BoundingBox[] = detections.slice(1).map((detection: any) => ({
      text: detection.description,
      confidence: detection.confidence || 0.9,
      vertices: detection.boundingPoly.vertices
    }));

    return {
      text: fullText,
      confidence: fullConfidence,
      boundingBoxes
    };
  }

  /**
   * ハイブリッドOCR: Gemini + Vision API
   */
  async performHybridOCR(imagePath: string): Promise<SceneWithOCR> {
    // Gemini OCR（高速、低コスト）
    const geminiResult = await this.performGeminiOCR(imagePath);

    // 信頼度が低い場合のみVision APIを使用
    if (geminiResult.estimatedConfidence < 0.6) {
      console.log('  ⚠️ Low confidence detected, using Google Vision API for verification...');
      const visionResult = await this.performVisionOCR(imagePath);

      return {
        ...scene,
        ocrText: visionResult.text,
        ocrConfidence: visionResult.confidence
      };
    }

    return geminiResult;
  }
}
```

#### コスト分析

**Google Cloud Vision API価格**:
- 0-1000リクエスト/月: $1.50/1000リクエスト
- 1001-5,000,000リクエスト/月: $1.50/1000リクエスト

**ハイブリッドアプローチのコスト**:
```
30シーンの動画:
  - Gemini使用: 30シーン × $0.001 = $0.03
  - 低信頼度シーン (推定20%): 6シーン × $0.0015 = $0.009
  - 合計: $0.039/動画
```

#### メリット
- ✅ 高精度な信頼度スコア
- ✅ バウンディングボックス情報の取得
- ✅ Googleの実績あるOCRエンジン

#### デメリット
- ⚠️ 追加コスト（1動画あたり+$0.009）
- ⚠️ 処理時間の増加（+1秒/シーン）
- ⚠️ APIキーとクレデンシャルの管理

---

## 信頼度スコアの活用

### 1. Excel出力での視覚化

```typescript
// Excel生成時に信頼度で色分け
function applyConfidenceFormatting(
  cell: ExcelJS.Cell,
  confidence: number
): void {
  if (confidence >= 0.8) {
    // 高信頼度: 緑色の背景
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFD4EDDA' } // 薄い緑
    };
  } else if (confidence >= 0.5) {
    // 中信頼度: 黄色の背景
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFF3CD' } // 薄い黄色
    };
  } else {
    // 低信頼度: 赤色の背景
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF8D7DA' } // 薄い赤
    };
  }

  // 信頼度をコメントとして追加
  cell.note = `OCR Confidence: ${(confidence * 100).toFixed(0)}%`;
}
```

### 2. 低信頼度テキストの自動フィルタリング

```typescript
interface FilterConfig {
  minConfidence: number;    // 最小信頼度閾値（デフォルト: 0.3）
  replaceWithWarning: boolean; // 警告メッセージに置き換えるか
}

function filterLowConfidenceText(
  scenes: SceneWithOCR[],
  config: FilterConfig = { minConfidence: 0.3, replaceWithWarning: true }
): SceneWithOCR[] {
  return scenes.map(scene => {
    if (scene.ocrConfidence < config.minConfidence) {
      console.log(`  ⚠️ Scene ${scene.sceneNumber}: Low confidence (${(scene.ocrConfidence * 100).toFixed(0)}%), filtering...`);

      return {
        ...scene,
        ocrText: config.replaceWithWarning
          ? `[Low confidence OCR result: "${scene.ocrText}"]`
          : '',
        ocrConfidence: scene.ocrConfidence
      };
    }

    return scene;
  });
}
```

### 3. 統計シートへの信頼度情報追加

```typescript
interface ConfidenceStatistics {
  averageConfidence: number;
  highConfidenceScenes: number;  // >=0.8
  mediumConfidenceScenes: number; // 0.5-0.8
  lowConfidenceScenes: number;    // <0.5
  confidenceDistribution: { range: string; count: number }[];
}

function calculateConfidenceStatistics(
  scenes: SceneWithOCR[]
): ConfidenceStatistics {
  const confidences = scenes.map(s => s.ocrConfidence);
  const totalScenes = scenes.length;

  const highConfidence = confidences.filter(c => c >= 0.8).length;
  const mediumConfidence = confidences.filter(c => c >= 0.5 && c < 0.8).length;
  const lowConfidence = confidences.filter(c => c < 0.5).length;

  const averageConfidence = confidences.reduce((sum, c) => sum + c, 0) / totalScenes;

  return {
    averageConfidence,
    highConfidenceScenes: highConfidence,
    mediumConfidenceScenes: mediumConfidence,
    lowConfidenceScenes: lowConfidence,
    confidenceDistribution: [
      { range: '0.0-0.2', count: confidences.filter(c => c < 0.2).length },
      { range: '0.2-0.4', count: confidences.filter(c => c >= 0.2 && c < 0.4).length },
      { range: '0.4-0.6', count: confidences.filter(c => c >= 0.4 && c < 0.6).length },
      { range: '0.6-0.8', count: confidences.filter(c => c >= 0.6 && c < 0.8).length },
      { range: '0.8-1.0', count: confidences.filter(c => c >= 0.8).length }
    ]
  };
}
```

### 4. ユーザーへの警告表示

```typescript
// フロントエンドでの警告表示
interface ProcessingResult {
  excelUrl: string;
  confidenceStatistics: ConfidenceStatistics;
  warnings: string[];
}

function generateWarnings(stats: ConfidenceStatistics): string[] {
  const warnings: string[] = [];

  if (stats.averageConfidence < 0.6) {
    warnings.push('全体的なOCR信頼度が低いです。結果を確認してください。');
  }

  if (stats.lowConfidenceScenes > stats.highConfidenceScenes) {
    warnings.push('低信頼度のシーンが多く含まれています。手動での確認を推奨します。');
  }

  if (stats.averageConfidence < 0.3) {
    warnings.push('⚠️ 深刻: OCR精度が非常に低いです。動画の品質を確認してください。');
  }

  return warnings;
}
```

---

## 実装計画

### Phase 1: ヒューリスティックベース信頼度推定（短期）⭐

**タスク**:
1. `OCRConfidenceEstimator` クラスの実装
2. 信頼度推定ロジックの統合
3. 単体テストの作成
4. 精度検証

**ファイル変更**:
- `cloud-run-worker/src/services/confidence-estimator.ts` - 新規ファイル
- `cloud-run-worker/src/services/pipeline.ts` - 統合
- `cloud-run-worker/src/types/excel.ts` - 型定義追加

**推定工数**: 4-6時間

### Phase 2: Excel出力での信頼度表示（短期）

**タスク**:
1. セルの色分け機能の実装
2. 信頼度コメントの追加
3. 統計シートへの信頼度情報追加
4. 視覚的テスト

**ファイル変更**:
- `cloud-run-worker/src/services/excel-generator.ts` - フォーマット追加

**推定工数**: 3-4時間

### Phase 3: セカンダリOCRエンジン統合（中期）

**タスク**:
1. Tesseract.jsの統合
2. マルチエンジン検証ロジックの実装
3. 類似度計算の実装
4. パフォーマンステスト

**ファイル変更**:
- `cloud-run-worker/src/services/multi-engine-ocr.ts` - 新規ファイル
- `cloud-run-worker/src/services/pipeline.ts` - 統合
- `package.json` - 新依存関係（tesseract.js）

**推定工数**: 10-12時間

### Phase 4: Google Cloud Vision API統合（長期）

**タスク**:
1. Vision API認証設定
2. ハイブリッドOCRの実装
3. コスト最適化ロジック
4. 統合テスト

**ファイル変更**:
- `cloud-run-worker/src/services/vision-ocr.ts` - 新規ファイル
- `cloud-run-worker/src/services/pipeline.ts` - 統合
- `.env.example` - Vision API設定追加

**推定工数**: 12-16時間

**合計工数**: 29-38時間（段階的実装）

---

## テスト計画

### 単体テスト

```typescript
describe('OCRConfidenceEstimator', () => {
  let estimator: OCRConfidenceEstimator;

  beforeEach(() => {
    estimator = new OCRConfidenceEstimator();
  });

  it('should return high confidence for well-formed Japanese text', () => {
    const text = 'みらいリハビリテーション病院\n鹿児島市下荒田1丁目1番25号';
    const confidence = estimator.estimateConfidence(text);

    expect(confidence).toBeGreaterThan(0.8);
  });

  it('should return low confidence for noisy text', () => {
    const text = '!!!@#$%^&*()';
    const confidence = estimator.estimateConfidence(text);

    expect(confidence).toBeLessThan(0.3);
  });

  it('should return medium confidence for short text', () => {
    const text = '病院';
    const confidence = estimator.estimateConfidence(text);

    expect(confidence).toBeGreaterThan(0.4);
    expect(confidence).toBeLessThan(0.8);
  });

  it('should return 0 confidence for empty text', () => {
    const confidence = estimator.estimateConfidence('');
    expect(confidence).toBe(0);
  });

  it('should explain confidence factors', () => {
    const text = 'みらいリハビリテーション病院';
    const { confidence, factors } = estimator.explainConfidence(text);

    expect(confidence).toBeGreaterThan(0);
    expect(factors.textLength).toBeDefined();
    expect(factors.languageConsistency).toBeDefined();
  });
});
```

### 統合テスト

```typescript
describe('Multi-Engine OCR Validation', () => {
  it('should return high confidence when engines agree', async () => {
    const imagePath = 'test-images/clear-text.png';
    const validator = new MultiEngineOCRValidator();

    const result = await validator.performMultiEngineOCR(imagePath);

    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it('should return low confidence when engines disagree', async () => {
    const imagePath = 'test-images/ambiguous-text.png';
    const validator = new MultiEngineOCRValidator();

    const result = await validator.performMultiEngineOCR(imagePath);

    expect(result.confidence).toBeLessThan(0.6);
  });
});
```

### E2Eテスト

```typescript
describe('Confidence Score End-to-End', () => {
  it('should process video with confidence scores', async () => {
    const videoPath = 'test-videos/sample.mp4';

    const result = await executeIdealPipeline(videoPath, 'Test', []);

    // 全てのシーンに信頼度スコアがある
    for (const scene of result.scenes) {
      expect(scene.ocrConfidence).toBeGreaterThanOrEqual(0);
      expect(scene.ocrConfidence).toBeLessThanOrEqual(1);
    }
  });

  it('should generate Excel with confidence colors', async () => {
    const excelBuffer = await generateExcel({
      projectTitle: 'Test',
      rows: mockRowsWithConfidence,
      videoMetadata: mockMetadata,
      includeStatistics: true
    });

    // Excelファイルが生成される
    expect(excelBuffer).toBeDefined();
    expect(excelBuffer.length).toBeGreaterThan(0);
  });
});
```

---

## 期待される効果

### ユーザー体験の向上
- ✅ OCR結果の品質を一目で判断可能
- ✅ 低品質なテキストに警告表示
- ✅ 手動確認が必要な箇所を即座に特定
- ✅ Excel出力の視覚的な改善

### 品質管理
- ✅ 誤検出の早期発見
- ✅ OCR精度のトラッキング
- ✅ 動画品質の問題を検出
- ✅ 改善施策の効果測定

### 将来的な拡張性
- ✅ 機械学習モデルの訓練データとして利用
- ✅ 信頼度ベースの自動フィルタリング
- ✅ API選択の自動最適化
- ✅ コスト最適化（低信頼度のみ高精度API使用）

---

## 参考資料

- Tesseract.js: https://github.com/naptha/tesseract.js
- Google Cloud Vision API: https://cloud.google.com/vision/docs/ocr
- Levenshtein distance: https://en.wikipedia.org/wiki/Levenshtein_distance

---

## 備考

- ヒューリスティックの重みは実データで調整が必要
- マルチエンジン検証は処理時間とのトレードオフ
- Vision APIは高コストのため選択的使用を推奨

---

**作成日**: 2025-11-03
**担当者**: 次のClaudeセッション
**優先度**: 低-中
**推定工数**: 29-38時間（段階的実装）
