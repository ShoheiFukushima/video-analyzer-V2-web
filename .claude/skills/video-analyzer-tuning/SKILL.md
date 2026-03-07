---
name: video-analyzer-tuning
description: Video Analyzer V2 のシーン検出・音声処理・OCR の本番チューニング設定を保護するスキル。検出閾値、VADパラメータ、Vercel/Cloud Run 設定の変更時にトリガーされる。キーワード: シーン検出、閾値、threshold、DEFAULT_CONFIG、VAD、OCR、ffmpeg、scene detection、minSceneInterval、minSceneDuration
---

# Video Analyzer V2 - Tuning Guard

本番環境で検証済みのチューニング設定を保護し、意図しない変更を防ぐスキル。

## 絶対に変更してはいけない設定値

### 1. シーン検出 DEFAULT_CONFIG

**ファイル**: `cloud-run-worker/src/services/ffmpeg.ts`

```typescript
const DEFAULT_CONFIG: SceneDetectionConfig = {
  thresholds: [0.025, 0.055, 0.085],  // DO NOT CHANGE
  minSceneDuration: 0.5,               // DO NOT CHANGE
  minSceneInterval: 1.0,               // DO NOT CHANGE
  roi: undefined
};
```

| パラメータ | 値 | 変更禁止理由 |
|---|---|---|
| `thresholds` | `[0.025, 0.055, 0.085]` | 広範囲テストで最適化済み。上げるとシーンが半減する |
| `minSceneDuration` | `0.5` | 2.0にすると短いカットが全て除外される |
| `minSceneInterval` | `1.0` | 3.0にすると近接カットが全て除外される |

**過去の事故 (2026-02-19)**:
`[0.08, 0.15, 0.30]` / `2.0` / `3.0` に変更した結果、18シーン→9シーンに半減。
即座に元の値に戻して復旧。

### 2. 先頭フレーム強制追加

**ファイル**: `cloud-run-worker/src/services/ffmpeg.ts` (`detectSceneCuts` 関数内)

```typescript
const FIRST_FRAME_THRESHOLD = 0.5; // 0.5秒以内にカットがなければ 0.0s を追加
```

- FFmpegのシーン検出は「変化」しか検出しないため、動画の先頭(0.0s)は検出されない
- この強制追加により、1カット目が必ず含まれるようになる
- `filterCloseScenes` は先頭カットを常に保持するため、除外されない

### 3. ROI検出設定

**ファイル**: `cloud-run-worker/src/services/ffmpeg.ts`

```typescript
const DEFAULT_ROI_CONFIG: ROIConfig = {
  enabled: false,  // 環境変数 ROI_DETECTION_ENABLED=true で有効化
  regions: [
    { name: 'bottom_subtitle',  thresholds: [0.01, 0.015] },  // 下段15%
    { name: 'center_text',      thresholds: [0.01, 0.015] },  // 中央15%
    { name: 'top_left_logo',    thresholds: [0.015, 0.02] },  // 左上10%
    { name: 'top_right_info',   thresholds: [0.015, 0.02] },  // 右上10%
  ],
  deduplicationInterval: 0.1  // 100ms以内の重複除去
};
```

### 4. VAD (Voice Activity Detection) パラメータ

- `maxChunkDuration`: 10秒 (Whisper最適化)
- `minSpeechDuration`: 0.25秒
- `sensitivity`: 0.5
- **変更禁止理由**: 40-60%のWhisper APIコスト削減を実現

### 5. Vercel API 設定

**ファイル**: `app/api/process/route.ts`

```typescript
import { waitUntil } from "@vercel/functions";

// Cloud Run 呼び出しは必ず waitUntil で包む
waitUntil(callCloudRunWithFailover(...).then(...).catch(...));
```

- `waitUntil` を外すと、Vercel がレスポンス後に関数を kill し、Cloud Run にリクエストが届かない
- **過去の事故 (2026-02-19)**: フローティングプロミスにより処理が永久に stuck

### 6. Cloud Run リソース設定

```yaml
CPU: 4 vCPU          # FFmpeg処理に必要
Memory: 4 GB          # CPUに合わせて
Concurrency: 1        # 動画処理は1リクエストずつ
CPU Throttling: OFF   # 常時フルパワー
Execution Env: gen2   # gVisor(gen1)ではFFmpegがハング
Timeout: 3600s        # 1時間
```

### 7. Blob エンドポイント

- **正**: `https://blob.vercel-storage.com`
- **誤**: `https://blob.vercelusercontent.com` (ENOTFOUND)

## 変更時のチェックリスト

シーン検出関連のコードを変更する前に:

```markdown
□ DEFAULT_CONFIG の thresholds, minSceneDuration, minSceneInterval は元の値のままか？
□ 先頭フレーム強制追加ロジックは残っているか？
□ ROI閾値は変更していないか？
□ waitUntil が /api/process に含まれているか？
□ Cloud Run の gen2 + 4vCPU + no-cpu-throttling は維持されているか？
□ テスト動画で検出数が以前と同等か確認したか？
```

## デプロイ手順

### Cloud Run (全6リージョン)
```bash
cd cloud-run-worker && ./node_modules/.bin/tsc --noEmit && cd ..
./scripts/deploy-worker.sh
```

### Vercel (フロントエンド)
```bash
./node_modules/.bin/next build && vercel --prod
```

## トラブルシューティング

| 症状 | 原因の可能性 | 確認方法 |
|---|---|---|
| シーン数が半減 | DEFAULT_CONFIG の閾値変更 | `git diff -- cloud-run-worker/src/services/ffmpeg.ts` |
| 1カット目が検出されない | 先頭フレーム強制追加の削除 | `detectSceneCuts` 内の `FIRST_FRAME_THRESHOLD` を確認 |
| 処理が開始されない | `waitUntil` の欠落 | `app/api/process/route.ts` で import 確認 |
| FFmpegがハング | gen1環境 or CPUスロットリング | `gcloud run services describe` で execution-environment 確認 |
| OCRテキストが空 | GEMINI_API_KEY 未設定 | Cloud Run 環境変数確認 |
