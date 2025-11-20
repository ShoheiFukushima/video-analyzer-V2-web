# PaddleOCR セルフホスト実装計画

**ドキュメントステータス**: 📋 **計画段階（実装未着手）**
**作成日**: 2025年11月16日
**最終更新**: 2025年11月16日
**承認状況**: ⏳ **ユーザー承認待ち**

---

## ⚠️ 重要: 実装開始条件

**このドキュメントは実装計画のみを記載しています。実装は以下の条件を満たした場合のみ開始します：**

1. ✅ **ユーザーからの明示的な実装GO指示**
2. ✅ **A/Bテスト戦略の承認**
3. ✅ **リソース確保の確認**（開発時間、予算）

**実装開始までの状態**: このドキュメントは「提案」であり、「実行済み」ではありません。

---

## 🎯 プロジェクト概要

**目的**: Gemini Vision APIの代替として、PaddleOCRをCloud Runにセルフホストし、完全無料（実行時間課金のみ）でOCR機能を提供する
**期待効果**: 年間コスト削減 約¥228,000、精度向上（日本語特化）
**実装アプローチ**: A/Bテストによる段階的検証・移行

---

## 📊 エグゼクティブサマリー

### 現状の問題
- **Gemini Vision APIコスト**: 月10万画像処理で約¥21,000（年間¥252,000）
- **OCR精度問題**: JSONパース失敗、日本語テキスト検出の不安定性
- **外部APIへの依存**: レート制限、サービス停止リスク

### 解決策
- **PaddleOCRセルフホスト**: Cloud Runに専用コンテナデプロイ
- **完全無料**: APIコストゼロ（Cloud Run実行時間課金約¥2,000/月のみ）
- **高精度**: Baidu開発、日本語・中国語に特化、小さい文字も高精度

### ROI（投資対効果）
- **初期実装時間**: 1-2日（Dockerコンテナ化、API実装、テスト）
- **月間コスト削減**: ¥19,000（¥21,000 → ¥2,000）
- **年間コスト削減**: ¥228,000
- **投資回収期間**: 即時（実装完了と同時にコスト削減開始）

---

## 🏗️ システムアーキテクチャ

### 現在のアーキテクチャ（Gemini Vision）

```
[Video Analyzer Worker (Cloud Run)]
          ↓
   [Gemini Vision API (外部)]
     - REST API呼び出し
     - Base64画像送信
     - JSON/自然言語レスポンス受信
     - コスト: ¥212/1000画像
```

### 新しいアーキテクチャ（PaddleOCR）

```
[Video Analyzer Worker (Cloud Run)]
          ↓ 内部HTTP呼び出し
[PaddleOCR Service (Cloud Run)]
   - 専用Dockerコンテナ
   - PaddleOCR Python実装
   - FastAPI REST API
   - コスト: 実行時間課金のみ
```

### マイクロサービス設計

**サービス分離の理由**:
1. **独立スケーリング**: OCR処理の負荷に応じて個別にスケール
2. **言語分離**: Node.js (Video Analyzer) と Python (PaddleOCR) を分離
3. **再利用性**: 他のプロジェクトでもPaddleOCR Serviceを再利用可能
4. **障害分離**: OCRサービスの障害が本体に影響しない

---

## 🛠️ 実装ステップ

### Phase 1: PaddleOCR Serviceの構築（Day 1）

#### 1-1: Dockerコンテナ作成

**ディレクトリ構造**:
```
video-analyzer-V2-web/
├── paddleocr-service/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── main.py
│   ├── ocr_service.py
│   ├── .dockerignore
│   ├── .gcloudignore
│   └── README.md
```

**Dockerfile**:
```dockerfile
FROM python:3.11-slim

# Install system dependencies for PaddleOCR
RUN apt-get update && apt-get install -y \
    libgomp1 \
    libglib2.0-0 \
    libsm6 \
    libxrender1 \
    libxext6 \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy requirements
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Expose port
EXPOSE 8080

# Run FastAPI server
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
```

**requirements.txt**:
```
fastapi==0.109.0
uvicorn[standard]==0.27.0
paddleocr==2.7.0.3
paddlepaddle==2.6.0
Pillow==10.2.0
pydantic==2.5.3
python-multipart==0.0.6
```

**main.py** (FastAPI アプリケーション):
```python
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional
import base64
import io
from PIL import Image
from ocr_service import PaddleOCRService

app = FastAPI(
    title="PaddleOCR Service",
    description="High-accuracy OCR service using PaddleOCR (Japanese/Chinese/English)",
    version="1.0.0"
)

# Initialize PaddleOCR service
ocr_service = PaddleOCRService(
    lang='japan',  # Japanese language model
    use_angle_cls=True,  # Enable text rotation detection
    use_gpu=False  # CPU mode (Cloud Run doesn't have GPU)
)

class OCRRequest(BaseModel):
    image_base64: str  # Base64 encoded image
    confidence_threshold: Optional[float] = 0.5  # Minimum confidence to include text

class OCRResponse(BaseModel):
    text: str  # Extracted text (concatenated with \n)
    confidence: float  # Average confidence score (0-1)
    details: list  # Detailed results per detected text box

@app.get("/")
async def root():
    return {"status": "ok", "service": "PaddleOCR", "version": "1.0.0"}

@app.get("/health")
async def health():
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat()}

@app.post("/ocr", response_model=OCRResponse)
async def perform_ocr(request: OCRRequest):
    """
    Perform OCR on base64 encoded image

    Request:
    {
      "image_base64": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...",
      "confidence_threshold": 0.5
    }

    Response:
    {
      "text": "今日の天気は晴れ\\nToday's weather is sunny",
      "confidence": 0.92,
      "details": [
        {"text": "今日の天気は晴れ", "confidence": 0.95, "bbox": [[10, 20], [100, 20], [100, 40], [10, 40]]},
        {"text": "Today's weather is sunny", "confidence": 0.89, "bbox": [[10, 50], [150, 50], [150, 70], [10, 70]]}
      ]
    }
    """
    try:
        # Decode base64 image
        image_data = base64.b64decode(request.image_base64.split(',')[-1])
        image = Image.open(io.BytesIO(image_data))

        # Perform OCR
        result = ocr_service.perform_ocr(
            image,
            confidence_threshold=request.confidence_threshold
        )

        return JSONResponse(content=result)

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"OCR failed: {str(e)}")

@app.post("/ocr/upload", response_model=OCRResponse)
async def perform_ocr_upload(
    file: UploadFile = File(...),
    confidence_threshold: float = 0.5
):
    """
    Perform OCR on uploaded image file

    Multipart form data:
    - file: image file (PNG, JPG, JPEG)
    - confidence_threshold: 0.5 (optional)
    """
    try:
        # Read uploaded file
        image_data = await file.read()
        image = Image.open(io.BytesIO(image_data))

        # Perform OCR
        result = ocr_service.perform_ocr(
            image,
            confidence_threshold=confidence_threshold
        )

        return JSONResponse(content=result)

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"OCR failed: {str(e)}")
```

**ocr_service.py** (PaddleOCR ビジネスロジック):
```python
from paddleocr import PaddleOCR
from PIL import Image
import numpy as np
from typing import Dict, List, Any

class PaddleOCRService:
    def __init__(self, lang='japan', use_angle_cls=True, use_gpu=False):
        """
        Initialize PaddleOCR service

        Args:
            lang: Language model ('japan', 'en', 'chinese_cht', etc.)
            use_angle_cls: Enable text rotation detection
            use_gpu: Use GPU acceleration (False for Cloud Run)
        """
        self.ocr = PaddleOCR(
            lang=lang,
            use_angle_cls=use_angle_cls,
            use_gpu=use_gpu,
            show_log=False  # Suppress PaddleOCR logs
        )

    def perform_ocr(
        self,
        image: Image.Image,
        confidence_threshold: float = 0.5
    ) -> Dict[str, Any]:
        """
        Perform OCR on PIL Image

        Args:
            image: PIL Image object
            confidence_threshold: Minimum confidence to include text (0-1)

        Returns:
            {
              "text": "extracted text",
              "confidence": 0.92,
              "details": [{"text": "...", "confidence": 0.95, "bbox": [...]}, ...]
            }
        """
        # Convert PIL Image to numpy array
        img_array = np.array(image)

        # Perform OCR
        results = self.ocr.ocr(img_array, cls=True)

        # Parse results
        extracted_texts = []
        confidences = []
        details = []

        if results and results[0]:
            for line in results[0]:
                bbox, (text, confidence) = line

                # Filter by confidence threshold
                if confidence >= confidence_threshold:
                    extracted_texts.append(text)
                    confidences.append(confidence)
                    details.append({
                        "text": text,
                        "confidence": round(confidence, 3),
                        "bbox": bbox
                    })

        # Calculate average confidence
        avg_confidence = sum(confidences) / len(confidences) if confidences else 0

        # Concatenate text with newlines
        concatenated_text = '\n'.join(extracted_texts)

        return {
            "text": concatenated_text,
            "confidence": round(avg_confidence, 3),
            "details": details
        }
```

#### 1-2: ローカルテスト

```bash
# ディレクトリ作成
mkdir paddleocr-service
cd paddleocr-service

# ファイル作成（上記コード）
# ...

# Dockerビルド
docker build -t paddleocr-service .

# ローカル実行
docker run -p 8080:8080 paddleocr-service

# テスト
curl http://localhost:8080/health
# → {"status":"ok","timestamp":"2025-11-16T12:00:00.000000"}

# OCRテスト（Base64エンコードされた画像）
curl -X POST http://localhost:8080/ocr \
  -H "Content-Type: application/json" \
  -d '{"image_base64": "data:image/png;base64,iVBORw0KGgoAAAA..."}'
```

#### 1-3: Cloud Runデプロイ

```bash
# GCPプロジェクト設定
gcloud config set project video-analyzer-v2

# Cloud Runデプロイ
gcloud run deploy paddleocr-service \
  --source . \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --memory 2Gi \
  --cpu 2 \
  --timeout 300 \
  --max-instances 10 \
  --min-instances 0

# デプロイURL取得（例: https://paddleocr-service-XXXXX.run.app）
```

---

### Phase 2: Video Analyzer Workerの統合（Day 2）

#### 2-1: 環境変数追加

```bash
# Cloud Run環境変数に追加
gcloud run services update video-analyzer-worker \
  --region us-central1 \
  --update-env-vars "PADDLEOCR_SERVICE_URL=https://paddleocr-service-XXXXX.run.app"
```

#### 2-2: PaddleOCRクライアント実装

**新規ファイル**: `cloud-run-worker/src/services/paddleocrClient.ts`

```typescript
import axios from 'axios';

export interface PaddleOCRRequest {
  image_base64: string;
  confidence_threshold?: number;
}

export interface PaddleOCRResponse {
  text: string;
  confidence: number;
  details: Array<{
    text: string;
    confidence: number;
    bbox: number[][];
  }>;
}

export class PaddleOCRClient {
  private serviceUrl: string;

  constructor(serviceUrl?: string) {
    this.serviceUrl = serviceUrl || process.env.PADDLEOCR_SERVICE_URL || '';
    if (!this.serviceUrl) {
      throw new Error('PADDLEOCR_SERVICE_URL environment variable is not set');
    }
  }

  /**
   * Perform OCR on image using PaddleOCR service
   * @param imageBuffer - Image buffer (PNG/JPG)
   * @param confidenceThreshold - Minimum confidence (0-1)
   * @returns OCR result
   */
  async performOCR(
    imageBuffer: Buffer,
    confidenceThreshold: number = 0.5
  ): Promise<PaddleOCRResponse> {
    try {
      // Convert buffer to base64
      const base64Image = `data:image/png;base64,${imageBuffer.toString('base64')}`;

      // Call PaddleOCR service
      const response = await axios.post<PaddleOCRResponse>(
        `${this.serviceUrl}/ocr`,
        {
          image_base64: base64Image,
          confidence_threshold: confidenceThreshold
        },
        {
          timeout: 30000, // 30 seconds
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`PaddleOCR service error: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Health check for PaddleOCR service
   * @returns true if healthy, false otherwise
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await axios.get(`${this.serviceUrl}/health`, {
        timeout: 5000
      });
      return response.status === 200 && response.data.status === 'ok';
    } catch (error) {
      return false;
    }
  }
}
```

#### 2-3: pipeline.tsの修正（Gemini → PaddleOCR切り替え）

**修正箇所**: `cloud-run-worker/src/services/pipeline.ts`

```typescript
// 既存のGemini imports
import { GoogleGenerativeAI } from '@google/generative-ai';

// 新規追加: PaddleOCR client
import { PaddleOCRClient } from './paddleocrClient.js';

// 環境変数で切り替え
const USE_PADDLEOCR = process.env.USE_PADDLEOCR === 'true';

async function performSceneBasedOCR(scenes: Scene[], uploadId?: string): Promise<SceneWithOCR[]> {
  // Choose OCR engine based on environment variable
  if (USE_PADDLEOCR) {
    console.log('🔧 Using PaddleOCR for scene-based OCR');
    return performSceneBasedOCRWithPaddle(scenes, uploadId);
  } else {
    console.log('🔧 Using Gemini Vision for scene-based OCR');
    return performSceneBasedOCRWithGemini(scenes, uploadId);
  }
}

// Rename existing function
async function performSceneBasedOCRWithGemini(scenes: Scene[], uploadId?: string): Promise<SceneWithOCR[]> {
  // ... existing Gemini implementation ...
}

// New PaddleOCR implementation
async function performSceneBasedOCRWithPaddle(scenes: Scene[], uploadId?: string): Promise<SceneWithOCR[]> {
  const paddleClient = new PaddleOCRClient();

  // Health check
  const isHealthy = await paddleClient.healthCheck();
  if (!isHealthy) {
    console.error('⚠️ PaddleOCR service is not healthy, falling back to Gemini');
    return performSceneBasedOCRWithGemini(scenes, uploadId);
  }

  // Initialize parallel processing components
  const limit = pLimit(5);
  const rateLimiter = new RateLimiter(60); // 60 requests per minute (faster than Gemini)
  const progressReporter = uploadId ? new ProgressReporter(5) : null;

  let completedScenes = 0;
  const OCR_PROGRESS_START = 60;
  const OCR_PROGRESS_END = 85;
  const OCR_PROGRESS_RANGE = OCR_PROGRESS_END - OCR_PROGRESS_START;

  console.log(`  🚀 Starting parallel OCR processing with PaddleOCR (${scenes.length} scenes, parallel degree: 5)`);
  const startTime = Date.now();

  // Process all scenes in parallel
  const results = await Promise.allSettled(
    scenes.map((scene, index) =>
      limit(async () => {
        if (!scene.screenshotPath) {
          console.log(`  ⚠️ Scene ${scene.sceneNumber}: No screenshot, skipping OCR`);
          completedScenes++;
          return {
            ...scene,
            ocrText: '',
            ocrConfidence: 0
          };
        }

        const MAX_RETRIES = 3;
        const INITIAL_BACKOFF_MS = 1000; // 1 second (faster than Gemini)

        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          try {
            await rateLimiter.acquire();

            // Read screenshot file
            const imageBuffer = fs.readFileSync(scene.screenshotPath);

            // Call PaddleOCR service
            const ocrResult = await paddleClient.performOCR(imageBuffer, 0.5);

            completedScenes++;

            // Report progress
            if (progressReporter && uploadId) {
              const progress = Math.floor(
                OCR_PROGRESS_START + (completedScenes / scenes.length) * OCR_PROGRESS_RANGE
              );
              await progressReporter.report(
                uploadId,
                progress,
                'ocr_processing',
                `OCR: ${completedScenes}/${scenes.length} scenes completed`
              );
            }

            // Enhanced logging
            const retryInfo = attempt > 0 ? ` (succeeded after ${attempt} retries)` : '';
            const textPreview = ocrResult.text.length > 0
              ? ocrResult.text.substring(0, 50).replace(/\n/g, ' ')
              : '(no text)';

            console.log(
              `  ✓ Scene ${scene.sceneNumber}: OCR complete ` +
              `(text: ${ocrResult.text.length} chars, confidence: ${ocrResult.confidence.toFixed(2)})${retryInfo} ` +
              `[${completedScenes}/${scenes.length}]`
            );

            if (ocrResult.text.length > 0) {
              console.log(`    Preview: "${textPreview}${ocrResult.text.length > 50 ? '...' : ''}"`);
            } else {
              console.log(`    (No text detected)`);
            }

            if (ocrResult.confidence < 0.5 && ocrResult.text.length > 0) {
              console.warn(`  ⚠️ Scene ${scene.sceneNumber}: Low confidence (${ocrResult.confidence.toFixed(2)})`);
            }

            return {
              ...scene,
              ocrText: ocrResult.text || '',
              ocrConfidence: ocrResult.confidence || 0
            };

          } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));

            const isRetryable = lastError.message.includes('503') ||
                               lastError.message.includes('429') ||
                               lastError.message.includes('timeout');

            if (!isRetryable || attempt >= MAX_RETRIES) {
              console.error(`  ✗ Scene ${scene.sceneNumber}: OCR failed (attempt ${attempt + 1}/${MAX_RETRIES + 1})`);
              console.error(`    Error: ${lastError.message}`);
              break;
            }

            const backoffDelay = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
            console.warn(
              `  ⚠️  Scene ${scene.sceneNumber}: Temporary error (attempt ${attempt + 1}/${MAX_RETRIES + 1}), ` +
              `retrying after ${backoffDelay}ms...`
            );
            await new Promise(resolve => setTimeout(resolve, backoffDelay));
          }
        }

        completedScenes++;
        return {
          ...scene,
          ocrText: '',
          ocrConfidence: 0
        };
      })
    )
  );

  const duration = (Date.now() - startTime) / 1000;
  console.log(`  ✓ Parallel OCR completed in ${duration.toFixed(2)}s`);
  console.log(`  📊 Average: ${(duration / scenes.length).toFixed(2)}s per scene`);

  const scenesWithOCR: SceneWithOCR[] = results.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      console.error(`  Scene ${scenes[index].sceneNumber} promise rejected:`, result.reason);
      return {
        ...scenes[index],
        ocrText: '',
        ocrConfidence: 0
      };
    }
  });

  if (progressReporter && uploadId) {
    await progressReporter.forceReport(uploadId, OCR_PROGRESS_END, 'ocr_completed', 'OCR processing completed');
  }

  console.log(`  ✓ OCR complete: ${scenesWithOCR.filter(s => s.ocrText).length}/${scenes.length} scenes with text`);
  return scenesWithOCR;
}
```

---

## 🧪 A/Bテスト戦略（段階的検証）

### Phase 3: 段階的移行テスト

**基本方針**: 本番トラフィックに影響を与えないよう、慎重に段階的検証を実施

---

### Stage 1: 開発環境テスト（リスク: ゼロ）

**目的**: PaddleOCR基本動作確認
**期間**: 1日
**トラフィック**: 本番影響なし

**実施内容**:
```bash
# ローカル環境でPaddleOCRサービステスト
cd paddleocr-service
docker build -t paddleocr-service .
docker run -p 8080:8080 paddleocr-service

# テスト画像でOCR実行
curl -X POST http://localhost:8080/ocr \
  -H "Content-Type: application/json" \
  -d '{"image_base64": "..."}'
```

**成功基準**:
- [ ] Dockerビルド成功
- [ ] OCRレスポンス取得成功
- [ ] 日本語テキスト正常抽出

---

### Stage 2: クローズドベータテスト（リスク: 極小）

**目的**: 実際の動画での精度・パフォーマンス検証
**期間**: 2-3日
**トラフィック**: テスト動画のみ（本番ユーザーに影響なし）

**実施内容**:
1. PaddleOCRサービスをCloud Runにデプロイ（本番環境とは独立）
2. テスト用Cloud Run Workerを起動（`USE_PADDLEOCR=true`）
3. 5本のテスト動画で検証

**テスト用動画セット**:
| # | 動画タイプ | テスト目的 | 期待検出率 |
|---|----------|----------|-----------|
| 1 | 日本語テロップ（下段字幕） | 日本語精度確認 | 95%+ |
| 2 | 英語タイトル（中央） | 英語精度確認 | 90%+ |
| 3 | 日英混在（YouTube形式） | 混在テキスト処理 | 90%+ |
| 4 | 小さいテキスト（4K→1080p） | 縮小画像精度 | 85%+ |
| 5 | 縦動画（TikTok形式） | アスペクト比対応 | 90%+ |

**比較指標**:
| 指標 | Gemini（現状） | PaddleOCR（目標） | 判定基準 |
|------|---------------|-----------------|---------|
| **検出率** | 85-90% | ≥90% | 同等以上 |
| **精度（正確性）** | 90% | ≥90% | 同等以上 |
| **処理時間/シーン** | 2-3秒 | ≤2秒 | 1.5倍以内 |
| **平均Confidence** | 0.7-0.8 | ≥0.7 | 同等以上 |
| **エラーレート** | 2-3% | ≤5% | 許容範囲内 |

**成功基準**:
- [ ] 5本すべてのテスト動画で検出率90%以上
- [ ] Geminiと同等以上の精度
- [ ] 処理時間がGeminiの1.5倍以内
- [ ] クリティカルエラーなし

**失敗時の対応**: この段階で失敗した場合、実装を中止し、原因分析後に再検討

---

### Stage 3: Shadow Traffic A/Bテスト（リスク: 小）

**目的**: 本番トラフィックでの精度・安定性検証（ユーザーには影響なし）
**期間**: 3-5日
**トラフィック**: 本番トラフィックの**ログのみ**（結果は破棄）

**実施方法**:
1. 本番Video Analyzer Workerで、Gemini **と** PaddleOCR **両方** を実行
2. ユーザーにはGeminiの結果のみを返す
3. PaddleOCRの結果はログに記録し、比較分析

**実装例**:
```typescript
// pipeline.ts の修正
async function performSceneBasedOCR(scenes: Scene[], uploadId?: string): Promise<SceneWithOCR[]> {
  const USE_SHADOW_AB_TEST = process.env.SHADOW_AB_TEST === 'true';

  if (USE_SHADOW_AB_TEST) {
    // A/Bテストモード: 両方実行
    const [geminiResults, paddleResults] = await Promise.all([
      performSceneBasedOCRWithGemini(scenes, uploadId),
      performSceneBasedOCRWithPaddle(scenes, uploadId)
    ]);

    // 比較ログ出力
    logABTestComparison(geminiResults, paddleResults);

    // ユーザーにはGeminiの結果のみを返す
    return geminiResults;
  } else {
    // 通常モード
    return performSceneBasedOCRWithGemini(scenes, uploadId);
  }
}
```

**比較分析内容**:
- 検出率の差異（シーン単位）
- Confidenceスコアの分布
- テキスト内容の一致率
- 処理時間の差異
- エラー発生頻度

**成功基準**:
- [ ] 本番動画100本以上で検証
- [ ] PaddleOCRの検出率がGeminiの95%以上
- [ ] PaddleOCRのエラーレート ≤ 5%
- [ ] 重大なバグ・クラッシュなし

**Go/No-Go判定**:
- **Go**: 上記成功基準すべてクリア → Stage 4へ進む
- **No-Go**: 1つでも失敗 → 原因分析・修正後、Stage 2からやり直し

---

### Stage 4: Canary Deployment（リスク: 中）

**目的**: 実際のユーザートラフィックでの動作確認
**期間**: 3-7日
**トラフィック**: 本番トラフィックの**10%**をPaddleOCRで処理

**実施方法**:
```bash
# 環境変数でトラフィック分割比率を設定
gcloud run services update video-analyzer-worker \
  --region us-central1 \
  --update-env-vars "USE_PADDLEOCR=true,PADDLEOCR_TRAFFIC_PERCENTAGE=10"
```

**実装例**:
```typescript
async function performSceneBasedOCR(scenes: Scene[], uploadId?: string): Promise<SceneWithOCR[]> {
  const USE_PADDLEOCR = process.env.USE_PADDLEOCR === 'true';
  const TRAFFIC_PERCENTAGE = parseInt(process.env.PADDLEOCR_TRAFFIC_PERCENTAGE || '0');

  // トラフィック分割（ランダム）
  const usePaddle = USE_PADDLEOCR && (Math.random() * 100 < TRAFFIC_PERCENTAGE);

  if (usePaddle) {
    console.log('🔧 Using PaddleOCR (Canary traffic)');
    return performSceneBasedOCRWithPaddle(scenes, uploadId);
  } else {
    console.log('🔧 Using Gemini Vision (Stable traffic)');
    return performSceneBasedOCRWithGemini(scenes, uploadId);
  }
}
```

**監視項目**:
| 指標 | アラート閾値 | 対応 |
|------|-----------|------|
| エラーレート | > 10% | 即座にロールバック |
| 平均処理時間 | > Geminiの2倍 | トラフィック5%に削減 |
| ユーザークレーム | 1件以上 | 原因調査、必要に応じてロールバック |
| Cloud Runメモリ使用率 | > 90% | メモリ増強 |

**段階的トラフィック増加**:
- Day 1-2: 10%
- Day 3-4: 25%（問題なければ）
- Day 5-7: 50%（問題なければ）

**成功基準**:
- [ ] 7日間、上記アラート閾値を超えない
- [ ] ユーザークレームゼロ
- [ ] Geminiと同等のサービス品質

**Go/No-Go判定**:
- **Go**: 成功基準クリア → Stage 5へ進む
- **No-Go**: アラート発生 → トラフィック比率を下げるか、ロールバック

---

### Stage 5: 段階的完全移行（リスク: 中〜高）

**目的**: PaddleOCRへの完全移行
**期間**: 7-14日
**トラフィック**: 100%

**実施方法**:
```bash
# トラフィック比率を段階的に増加
gcloud run services update video-analyzer-worker \
  --region us-central1 \
  --update-env-vars "PADDLEOCR_TRAFFIC_PERCENTAGE=100"
```

**段階的増加スケジュール**:
| 期間 | トラフィック比率 | 監視強度 |
|------|---------------|---------|
| Day 1-3 | 75% | 1時間ごとにログ確認 |
| Day 4-7 | 100% | 4時間ごとにログ確認 |
| Day 8-14 | 100% | 1日1回ログ確認 |

**成功基準**:
- [ ] 14日間、重大なエラーなし
- [ ] 月間コスト削減を確認（¥19,000/月）
- [ ] ユーザー満足度維持（クレームなし）

**完全移行後の対応**:
- **2週間後**: Geminiコードを削除せず、フォールバック機能として残す
- **1ヶ月後**: Gemini完全廃止を検討（環境変数削除、コード削除）

---

### Stage 6: Gemini完全廃止（オプション）

**目的**: コード簡素化、メンテナンス負荷削減
**期間**: 実装1日
**前提条件**: Stage 5完了後、1ヶ月以上問題なし

**実施内容**:
1. `performSceneBasedOCRWithGemini`関数削除
2. `USE_PADDLEOCR`環境変数削除（PaddleOCRが標準に）
3. Gemini関連の依存関係削除（`@google/generative-ai`）
4. ドキュメント更新

**注意**: この段階は**オプション**です。フォールバック機能を残すことも検討してください。

---

### ロールバック準備（全Stage共通）

```bash
# 問題発生時: 即座にGeminiに戻す
gcloud run services update video-analyzer-worker \
  --region us-central1 \
  --update-env-vars "USE_PADDLEOCR=false"

# または: 前のリビジョンに戻す
gcloud run services update-traffic video-analyzer-worker \
  --to-revisions=PREVIOUS_REVISION=100 \
  --region us-central1
```

---

## 💰 コスト分析

### 現状（Gemini Vision API）

| 項目 | 月間使用量 | 単価 | 月額コスト |
|------|-----------|------|-----------|
| Gemini API呼び出し | 100,000画像 | ¥212/1000画像 | ¥21,200 |
| Cloud Run実行時間 | 含む | - | ¥0 |
| **合計** | - | - | **¥21,200** |

### 新方式（PaddleOCR）

| 項目 | 月間使用量 | 単価 | 月額コスト |
|------|-----------|------|-----------|
| PaddleOCR API呼び出し | 100,000画像 | **¥0** | **¥0** |
| PaddleOCR Cloud Run実行時間 | 約500時間 | ¥4/時間 | ¥2,000 |
| Video Analyzer実行時間 | 変化なし | - | ¥0 |
| **合計** | - | - | **¥2,000** |

**年間コスト削減**: ¥21,200 × 12 - ¥2,000 × 12 = **¥230,400**

---

## 📈 パフォーマンス予測

### 処理時間比較

| OCRエンジン | 1画像あたり処理時間 | 100画像処理時間 | 並列度 |
|------------|------------------|---------------|-------|
| **Gemini Vision** | 2-3秒 | 200-300秒 | 5並列 |
| **PaddleOCR (CPU)** | 1-2秒 | 100-200秒 | 5並列 |
| **PaddleOCR (GPU)** | 0.5-1秒 | 50-100秒 | 10並列 |

**結論**: PaddleOCRの方が1.5-2倍高速（CPUモード）

### 精度比較（推定）

| OCRエンジン | 日本語精度 | 英語精度 | 小さい文字 | 曲がったテキスト |
|------------|-----------|---------|-----------|---------------|
| **Gemini Vision** | 85-90% | 95% | 80% | 85% |
| **PaddleOCR** | **90-95%** | 95% | **90%** | **95%** |

**結論**: PaddleOCRの方が日本語と特殊ケースに強い

---

## 🔒 セキュリティ考慮事項

### 1. 内部通信のみ（Cloud Run → Cloud Run）
- **HTTPS必須**: Cloud Run間通信はHTTPS強制
- **認証オプション**: Cloud Run IAMベースの認証も可能（現在は`--allow-unauthenticated`）

### 2. 機密データの扱い
- **画像データ**: Base64エンコードで転送、処理後すぐに破棄
- **ログ出力**: 画像データはログに出力しない

### 3. レート制限
- **DDos対策**: Cloud RunのConcurrency設定で同時実行数を制限
- **内部レート制限**: RateLimiter（60req/min）で負荷分散

---

## 🚨 リスクと対策

### リスク1: PaddleOCRサービスの障害
**対策**: Geminiへの自動フォールバック機能実装済み
```typescript
const isHealthy = await paddleClient.healthCheck();
if (!isHealthy) {
  console.error('⚠️ PaddleOCR service is not healthy, falling back to Gemini');
  return performSceneBasedOCRWithGemini(scenes, uploadId);
}
```

### リスク2: Cloud Run Cold Start（コールドスタート）
**影響**: 初回リクエストが10-15秒遅延
**対策**:
- `--min-instances 1`で常時1インスタンス起動（月額コスト+¥1,000）
- または、定期的なHealth Check Pingでインスタンス維持

### リスク3: メモリ不足
**影響**: 大容量画像（4K）処理時にOOM（Out of Memory）
**対策**:
- `--memory 2Gi`設定（現在と同じ）
- 画像リサイズ（1920x1080以下）は既に実装済み

### リスク4: 処理時間超過
**影響**: Cloud Run timeout（300秒）
**対策**:
- PaddleOCRの方が高速なため、リスクは低い
- タイムアウト設定は既存と同じ（300秒）

---

## 📝 マイルストーン

### Week 1: 開発・テスト
- **Day 1**: PaddleOCR Service構築・ローカルテスト・Cloud Runデプロイ
- **Day 2**: Video Analyzer統合・テスト動画検証
- **Day 3**: A/Bテスト・精度比較・パフォーマンス測定

### Week 2: 本番移行
- **Day 4-5**: Canary Deployment（10%トラフィック）
- **Day 6-7**: 本番移行（100%トラフィック）・24時間監視

### Week 3: 最適化
- **Day 8-10**: パフォーマンス最適化・ログ分析・ドキュメント作成

---

## 🎯 成功基準

### 必須条件（Go/No-Go）
- [ ] OCR検出率 ≥ 90%（Geminiと同等以上）
- [ ] 処理時間 ≤ Gemini（1.5倍以内）
- [ ] エラーレート ≤ 5%
- [ ] 月額コスト ≤ ¥3,000

### 理想条件
- [ ] OCR検出率 ≥ 95%
- [ ] 処理時間 ≤ Geminiの0.5倍（2倍高速）
- [ ] エラーレート ≤ 1%
- [ ] 月額コスト ≤ ¥2,000

---

## 📚 参考資料

### PaddleOCR公式ドキュメント
- GitHub: https://github.com/PaddlePaddle/PaddleOCR
- ドキュメント: https://paddlepaddle.github.io/PaddleOCR/
- 日本語モデル: https://github.com/PaddlePaddle/PaddleOCR/blob/release/2.7/doc/doc_en/models_list_en.md#3-multilingual-recognition-model

### Cloud Run ベストプラクティス
- 公式ドキュメント: https://cloud.google.com/run/docs/tips
- FastAPI + Cloud Run: https://cloud.google.com/run/docs/quickstarts/build-and-deploy/deploy-python-service

### 内部参照
- 現在の実装: `cloud-run-worker/src/services/pipeline.ts`
- FFmpeg設定: `cloud-run-worker/src/services/ffmpeg.ts`
- システムアーキテクチャ: `SYSTEM_ARCHITECTURE_2025-11-04.md`

---

## 🔄 意思決定フレームワーク

### 実装開始のための承認プロセス

**Step 1: このドキュメントのレビュー**
- [ ] ユーザーがこの実装計画を読み、理解する
- [ ] A/Bテスト戦略に同意する
- [ ] リスクと対策を理解する

**Step 2: 意思決定事項の確認**

以下の質問に対する回答を決定してください：

| 質問 | 選択肢 | 推奨 | 影響 |
|------|-------|------|------|
| **Q1**: PaddleOCRサービスに`--min-instances 1`を設定するか？ | Yes / No | **No**（初期はコスト優先） | +¥1,000/月、Cold Start回避 |
| **Q2**: GPU有効化するか？ | Yes / No | **No**（CPU十分高速） | +¥10,000/月、処理3倍高速 |
| **Q3**: Shadow A/Bテスト（Stage 3）を実施するか？ | Yes / No | **Yes**（リスク低減） | +3-5日、精度検証 |
| **Q4**: Gemini完全廃止のタイミングは？ | 1ヶ月後 / 3ヶ月後 / 廃止しない | **3ヶ月後**（安全重視） | フォールバック維持 |

**Step 3: 明示的な実装GO指示**

ユーザーが以下のいずれかの方法で承認を表明してください：

```
承認例1:
「PaddleOCR実装を開始してください。Q1=No, Q2=No, Q3=Yes, Q4=3ヶ月後で進めてください。」

承認例2:
「PADDLEOCR_IMPLEMENTATION_PLAN.mdの内容で実装GOです。推奨設定で進めてください。」

承認例3:
「PaddleOCR実装スタートしてください。」
```

**Step 4: 実装開始**

承認後、以下の順序で実装を開始します：
1. Stage 1（開発環境テスト）
2. Stage 2（クローズドベータテスト）
3. Stage 3（Shadow A/Bテスト）- Q3=Yesの場合のみ
4. Stage 4（Canary Deployment）
5. Stage 5（段階的完全移行）
6. Stage 6（Gemini完全廃止）- Q4のタイミングで実施

---

## 📋 チェックリスト: 実装前の確認事項

### 技術的準備
- [ ] Cloud Run プロジェクト（video-analyzer-prod-1756704391）のクォータ確認
- [ ] Cloud Run料金アラート設定（月¥5,000超過時に通知）
- [ ] Supabaseストレージ容量確認（テスト動画保存用）
- [ ] ローカル開発環境にDocker環境あり

### リソース確保
- [ ] 実装時間の確保（Week 1: 3日間）
- [ ] テスト動画5本の準備
- [ ] モニタリング時間の確保（Week 2-3: 1日30分程度）

### リスク理解
- [ ] PaddleOCR障害時のGeminiフォールバック機能を理解
- [ ] ロールバック手順を理解
- [ ] 最悪ケースのシナリオを理解（全面ロールバック、Gemini継続使用）

---

## 🚨 実装中止条件

以下のいずれかに該当する場合、実装を中止し、Geminiに戻します：

1. **Stage 2で検出率85%未満**
2. **Stage 3でエラーレート10%超過**
3. **Stage 4でユーザークレーム2件以上**
4. **予算超過**（月額コスト¥5,000超過）
5. **ユーザーからの中止指示**

中止時の対応：
- 即座にGeminiに戻す（環境変数変更のみ、5分以内）
- 原因分析レポート作成
- 再実装の可否を判断

---

## 📞 サポート・質問

### 実装中の相談
実装中に不明点や問題が発生した場合、以下の情報を添えて相談してください：
- 現在のStage番号
- 発生した問題の詳細
- Cloud Runログの抜粋
- 期待される動作と実際の動作

### 参考リソース
- PaddleOCR公式ドキュメント: https://github.com/PaddlePaddle/PaddleOCR
- Cloud Run公式ドキュメント: https://cloud.google.com/run/docs
- 現在の実装: `cloud-run-worker/src/services/pipeline.ts`
- システムアーキテクチャ: `SYSTEM_ARCHITECTURE_2025-11-04.md`

---

## 🔄 次のステップ

### 現在の状態: 📋 **計画段階**

**ユーザーからの明示的な実装GO指示待ちです。**

### 承認後の実装スケジュール

| Week | Stage | 作業内容 | 成果物 |
|------|-------|---------|-------|
| Week 1 | Stage 1-2 | PaddleOCR Service構築・クローズドベータテスト | Dockerコンテナ、テストレポート |
| Week 2 | Stage 3-4 | Shadow A/Bテスト・Canary Deployment | A/B比較レポート、モニタリングダッシュボード |
| Week 3 | Stage 5 | 段階的完全移行 | 本番移行完了レポート |
| Month 3 | Stage 6 | Gemini完全廃止（オプション） | コード簡素化、ドキュメント更新 |

---

**ドキュメントバージョン**: 2.0
**最終更新**: 2025年11月16日
**作成者**: Claude Code (Anthropic)
**ステータス**: 📋 **実装承認待ち** ⏳
**次のアクション**: ユーザーからの明示的な実装GO指示
