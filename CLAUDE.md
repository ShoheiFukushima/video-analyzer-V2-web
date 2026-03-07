# Video Analyzer V2 Web - Claude開発者向けガイド

**プロジェクトバージョン**: 2.2.0
**最終更新**: 2026年2月5日
**ステータス**: 本番運用中

---

## ⚠️ 重要：ストレージはCloudflare R2

**Vercel Blobは使用しない**。2GB動画対応のため**Cloudflare R2**に移行済み。
- コード内の`@vercel/blob`参照は旧仕様（技術スタック表は更新予定）
- 新規実装は必ずR2クライアント（`src/lib/r2.ts`等）を使用すること

---

## 📌 プロジェクト概要

### 目的
動画ファイルをアップロードし、AI（OpenAI Whisper + Google Gemini Vision）を使用して音声文字起こしとOCRを実行し、シーン単位でスクリーンショット・テキストを統合したExcelレポートを生成するウェブアプリケーション。

### ターゲットユーザー
- 動画コンテンツ制作者
- メディア分析者
- 字幕・ドキュメント作成者
- マーケティング・リサーチャー

### 主要機能（V2.1.0時点）
- **Whisper AI音声文字起こし**: タイムスタンプ付き高精度テキスト化（VAD最適化で40-60%コスト削減）
- **Gemini Vision OCR**: 動画フレームからのテキスト抽出（日本語・英語対応）
- **シーン検出**: マルチパスFFmpegアルゴリズム（閾値: 0.025, 0.055, 0.085）
- **ROI（Region of Interest）検出** (2025-11-14追加): テロップ・字幕変化の検出（オプション機能、下段15%領域対応）
- **理想的Excelフォーマット（V2.1）**: 5列レイアウト（Scene #, Timecode, Screenshot, OCR Text, NA Text）
- **自動Blobクリーンアップ**: 容量制限対策（ソース動画・結果の自動削除）
- **Clerk認証**: セキュアなユーザー認証
- **RLS（Row Level Security）**: ユーザーIDベースのアクセス制御

### 対応動画形式
- MP4, MOV, AVI, MKV, WebM
- 縦・横向き対応（スマートフォン動画含む）
- 最大4K解像度
- 最大ファイルサイズ: 500MB
- ステレオ/モノラル音声
- 音声なし動画（OCRのみ）

---

## 🏗️ 技術スタック（V2.1.0）

### フロントエンド（Vercel）
| 技術 | バージョン | 用途 |
|------|-----------|------|
| **Next.js** | 14.2.0 | Reactフレームワーク（App Router） |
| **React** | 18.3.0 | UIライブラリ |
| **TypeScript** | 5.5.0 | 型安全性 |
| **Tailwind CSS** | 3.4.0 | スタイリング |
| **Clerk** | 5.0.0 | 認証 |
| **@vercel/blob** | 0.23.0 | ファイルストレージ |
| **@tanstack/react-query** | 5.0.0 | データフェッチング・キャッシング |
| **axios** | 1.7.0 | HTTPクライアント |
| **lucide-react** | 0.400.0 | アイコン |

### バックエンド（Google Cloud Run）
| 技術 | バージョン | 用途 |
|------|-----------|------|
| **Node.js** | 20.x (本番) / 24.10.0 (ローカル) | ランタイム |
| **Express.js** | 4.x | APIサーバー |
| **TypeScript** | 5.3.3 | 型安全性 |
| **FFmpeg** | 7.1 (Static) | 動画・音声処理 |
| **OpenAI Whisper API** | whisper-1 | 音声文字起こし |
| **Google Gemini Vision** | gemini-2.5-flash | OCR |
| **ExcelJS** | 4.4.0 | Excelレポート生成 |
| **@supabase/supabase-js** | 2.38.0 | データベースクライアント |
| **silero-vad-node** | 最新 | 音声活動検出（VAD） |
| **@vercel/blob** | 2.0.0 | ファイルストレージ |

### インフラストラクチャ
| サービス | プロバイダー | 用途 | リージョン/プラン |
|---------|------------|------|----------------|
| フロントエンドホスティング | Vercel | Next.jsアプリ配信・CDN | Auto（グローバルCDN） |
| バックエンドコンテナ | Google Cloud Run | Dockerコンテナ実行 | マルチリージョン（6リージョン） |
| ファイルストレージ | Cloudflare R2 | 動画・Excel一時保存 | Free Tier |
| データベース | Supabase | PostgreSQL（ステータス管理） | Free Tier |
| 認証 | Clerk | ユーザー認証・セッション管理 | Development |
| DNS | さくらインターネット | ドメイン管理 | - |

### ドメイン・DNS設定（2026年2月11日追加）

| 項目 | 値 |
|------|-----|
| **本番ドメイン** | `https://video.function-eight.com/` |
| **親ドメイン** | `function-eight.com` |
| **DNS管理** | さくらインターネット |
| **SSL** | Vercel自動発行 |

### Cloud Run マルチリージョン構成（2026年2月11日追加）

**デプロイ済みリージョン（6リージョン）**:
| リージョン | 場所 | 主なユーザー |
|-----------|------|-------------|
| `asia-northeast1` | 東京 | 日本 |
| `asia-southeast1` | シンガポール | 東南アジア |
| `australia-southeast1` | シドニー | オーストラリア |
| `europe-west1` | ベルギー | ヨーロッパ |
| `southamerica-east1` | サンパウロ | 南米 |
| `us-central1` | アイオワ | 北米 |

**重要**: コード変更時は**全リージョンにデプロイ**が必要（Artifact Registry経由で同一イメージを展開）。

### Cloud Run リソース設定（2026年2月5日更新）
| 項目 | 値 | 説明 |
|-----|-----|------|
| **CPU** | 4 vCPU | FFmpeg処理に最適化 |
| **メモリ** | 4 GB | CPU に合わせて増加 |
| **同時実行数** | 1 | 動画処理は1リクエストずつ |
| **CPUスロットリング** | 無効 | 常時CPUを割り当て |
| **実行環境** | gen2 | Linux VM（gVisorではない） |
| **タイムアウト** | 600秒 | 10分 |
| **最大インスタンス** | 10 | スケーリング上限 |

**重要**: gen2実行環境を使用することで、FFmpeg/ffprobeのハング問題を回避。

---

## 🎯 アーキテクチャの要点

### システム構成
```
[ユーザー]
    ↓ HTTPS
[Next.js Frontend (Vercel)]
    ↓ Clerk認証
[API Routes]
    ↓ WORKER_SECRET認証
[Cloud Run Worker (GCP)]
    ↓ Service Role Key
[Supabase Database] + [Vercel Blob Storage]
```

### データフロー（簡易版）
1. **アップロード**: ユーザー → Vercel Blob → 処理開始リクエスト
2. **処理**: Cloud Run Worker → 動画ダウンロード → FFmpeg → Whisper/Gemini → Excel生成
3. **クリーンアップ**: ソース動画削除（ダウンロード直後）
4. **ダウンロード**: ユーザー → Supabase（Blob URL取得） → Vercel Blob → Excel削除（ダウンロード直後）

### 処理パイプライン
1. **動画ダウンロード** (0-10%)
2. **メタデータ抽出** (10-20%)
3. **音声検出** (20-30%)
4. **VAD + Whisper処理** (30-50%)
5. **シーン検出 + OCR + Excel生成** (50-90%)
6. **結果アップロード** (90-100%)

---

## ⚠️ 開発時の重要な注意事項

### 🚫 絶対に触らないもの

#### 1. 正常に動作している認証設定
- **Clerk設定**: 認証フローが確立済み
- **WORKER_SECRET**: フロントエンド ⇔ Cloud Run Worker間の認証キー
- **Supabase RLS**: ユーザーIDベースのアクセス制御（IDOR修正済み）

#### 2. Vercel Blob自動削除機能
**場所**:
- `cloud-run-worker/src/services/videoProcessor.ts:videoProcessor.ts:212-217` (ソース動画削除)
- `app/api/download/[uploadId]/route.ts:route.ts:56-66` (Excel削除)

**理由**: Vercel Blob Hobby プランの1GB制限対策として実装済み。削除すると容量超過エラーが発生する。

#### 3. VAD（音声活動検出）の設定
**パラメータ**:
- `maxChunkDuration`: 10秒（Whisper最適化）
- `minSpeechDuration`: 0.25秒
- `sensitivity`: 0.5

**理由**: 40-60%のWhisper APIコスト削減を実現。変更するとコストが大幅に増加する可能性がある。

#### 4. シーン検出の閾値
**フルフレーム検出閾値**: `[0.025, 0.055, 0.085]`（マルチパス方式）
**ROI検出閾値**: `[0.01, 0.015]`（より敏感に設定、テロップ変化検出用）

**理由**: 広範囲のテストで最適化済み。変更すると誤検出が増える可能性がある。

**注**: 2025年11月14日のROI検出実装により、シーン検出が2段階に分かれました:
- フルフレーム検出: カメラワーク、シーン変化を検出
- ROI検出（オプション）: 画面下段15%領域のテロップ・字幕変化を検出

#### 5. Vercel Blob APIエンドポイント（重要）
**正しいエンドポイント**: `https://blob.vercel-storage.com`

**間違ったエンドポイント（使用禁止）**:
- ❌ `https://blob.vercelusercontent.com` - **DNSエラー（ENOTFOUND）の原因**
- ❌ `https://vercel-storage.com` - 認証エラーの原因

**影響範囲**:
- `cloud-run-worker/src/services/blobUploader.ts` - Excel結果ファイルのアップロード
- 本番環境では必ずエラーを投げる（フォールバックを使用しない）

**バリデーション**:
```typescript
// ✅ 正しい実装
const blobApiUrl = 'https://blob.vercel-storage.com';

// Production環境ではフォールバックを使用しない
if (process.env.NODE_ENV === 'production') {
  throw new Error('Failed to upload to Vercel Blob');
}
```

**過去の問題**:
- **2025年11月11日**: 間違ったエンドポイント（`blob.vercelusercontent.com`）により、本番環境でダウンロードリンクが表示されない問題が発生
- **根本原因**: DNSエラー（ENOTFOUND）→ フォールバック機構が本番環境で誤って作動 → data URI保存 → ダウンロード不可

**チェックポイント**:
- [ ] エンドポイントが `blob.vercel-storage.com` であることを確認
- [ ] 本番環境でフォールバック機構が無効化されていることを確認
- [ ] アップロード失敗時にエラーログが出力されることを確認

### ⚡ よくある問題と対処法

#### 問題1: `CLOUD_RUN_URL`に改行文字が混入
**症状**: `/api/process`で処理が開始されない

**対処**:
```bash
# Vercel環境変数を確認
vercel env pull .env.vercel
cat .env.vercel | grep CLOUD_RUN_URL

# 改行除去して再設定
vercel env rm CLOUD_RUN_URL production
vercel env add CLOUD_RUN_URL production
# → 改行なしのURLを入力
```

#### 問題2: `GEMINI_API_KEY`未設定
**症状**: OCRテキストが全て空文字列

**対処**:
```bash
# Cloud Run環境変数確認
gcloud run services describe video-analyzer-worker \
  --region us-central1 \
  --format="value(spec.template.spec.containers[0].env)" | grep GEMINI

# 未設定の場合は追加
gcloud run services update video-analyzer-worker \
  --region us-central1 \
  --update-env-vars "GEMINI_API_KEY=${GEMINI_API_KEY}"
```

#### 問題3: Vercel Blob容量オーバー
**症状**: `Storage quota exceeded for Hobby plan (1GB maximum)`

**対処**:
```bash
# 手動クリーンアップ（緊急時）
npx dotenv -e .env.local tsx scripts/cleanup-blob-storage.ts delete-all

# 自動削除機能が動作しているか確認
# → videoProcessor.ts (ソース動画) と download API (Excel) のログ確認
```

#### 問題4: 処理が完了しない
**症状**: ステータスが`processing`のまま、特定の進捗で停止

**原因**:
- Cloud Runタイムアウト（600秒超過）
- Whisper APIレート制限
- Gemini APIレート制限

**対処**:
```bash
# ログ確認（エラー箇所特定）
gcloud run services logs read video-analyzer-worker \
  --region us-central1 \
  --filter "textPayload:upload_1730678901234_abc123xyz" \
  --limit 200

# Supabaseステータス確認
# → Supabase Dashboard → Table Editor → processing_status
```

#### 問題5: ダウンロードタイムアウト（60秒）
**修正日**: 2025年11月6日
**症状**: 大容量動画（400MB超）のダウンロード失敗

**修正内容**:
```typescript
// cloud-run-worker/src/services/videoProcessor.ts
timeout: 300000, // 5分（以前: 60秒）
maxContentLength: 500 * 1024 * 1024, // 500MB
maxBodyLength: 500 * 1024 * 1024
```

**現在は修正済み**: タイムアウトが5分（300秒）に延長されている。

---

## 🎯 ROI（Region of Interest）検出

### 概要
ROI検出は、動画の特定領域（画面下段など）に特化したシーン検出機能です。テロップや字幕の変化を高精度に検出することで、従来のフルフレーム検出では見逃していた変化をキャッチします。

### 有効化方法

#### Cloud Run環境変数に追加
```bash
# 環境変数設定
export ROI_DETECTION_ENABLED=true

# Cloud Runにデプロイ
gcloud run services update video-analyzer-worker \
  --region us-central1 \
  --update-env-vars "ROI_DETECTION_ENABLED=true"
```

**デフォルト**: `false`（無効） - 既存の動作に影響なし

### 動作モード

#### ROI無効（デフォルト）
- フルフレーム検出のみ実行
- 従来通りの動作（後方互換性）
- `SceneCut.source`フィールドなし

#### ROI有効
- フルフレーム検出 + ROI検出を並行実行
- 検出結果をマージ（重複削除: 100ms以内）
- `SceneCut.source`フィールドで検出元を追跡

### 検出ソース分類

| ソース | 意味 | 検出理由 |
|--------|------|----------|
| `full_frame` | フルフレーム検出のみ | シーン変化、カメラワーク |
| `roi_bottom` | ROI検出のみ（下段15%） | テロップ・字幕変化 |
| `both` | 両方で検出 | シーン変化 + テロップ変化 |

### Phase 2実装（4領域対応）- 2025年11月14日完了

**対応領域**: 4領域すべて
1. **下段15%**: `iw:ih*0.15:0:ih*0.85` - 字幕・テロップ（閾値: `[0.01, 0.015]`）
2. **中央15%**: `iw:ih*0.15:0:ih*0.425` - メインテキスト（閾値: `[0.01, 0.015]`）
3. **左上10%**: `iw*0.25:ih*0.1:0:0` - ロゴ・ブランディング（閾値: `[0.015, 0.02]`）
4. **右上10%**: `iw*0.25:ih*0.1:iw*0.75:0` - タイムスタンプ・メタデータ（閾値: `[0.015, 0.02]`）

**カバレッジ**: 95%+の動画（ほぼすべてのテキストオーバーレイを検出）

**想定用途**:
- テレビ番組のテロップ（下段）
- YouTubeの字幕（下段）
- プレゼンテーション動画のスライド（中央）
- ニュース番組のテキスト（下段・左上・右上）
- ロゴ・ブランディング表示（左上）
- タイムスタンプ・メタデータ（右上）

### ログ出力例

```
📊 ROI Detection Results Summary:
   Total scene cuts: 47
   🎬 Full-frame detection: 12 (camera work, scene changes)
   🎯 ROI detection: 28 (subtitle/text changes)
   🔗 Both detected: 7 (scene change + text change)

   First 10 scene cuts:
   🎬  1) 2.5s (scene_change)
   🎯  2) 5.8s (subtitle_change)
   🎯  3) 8.2s (subtitle_change)
   🔗  4) 15.0s (both)
   🎬  5) 18.3s (scene_change)
   🎯  6) 22.1s (subtitle_change)
   🎯  7) 25.7s (subtitle_change)
   🎬  8) 30.5s (scene_change)
   🎯  9) 33.9s (subtitle_change)
   🎯 10) 37.2s (subtitle_change)
   ... and 37 more cuts
```

### トラブルシューティング

#### 問題: ROI検出が有効にならない
**確認事項**:
```bash
# 環境変数確認
gcloud run services describe video-analyzer-worker \
  --region us-central1 \
  --format="value(spec.template.spec.containers[0].env)" | grep ROI

# 正しい値: ROI_DETECTION_ENABLED=true
```

**対処**:
```bash
# 環境変数を追加/更新
gcloud run services update video-analyzer-worker \
  --region us-central1 \
  --update-env-vars "ROI_DETECTION_ENABLED=true"
```

#### 問題: ログに検出結果サマリーが表示されない
**原因**: ROI検出が無効、またはシーン検出自体が失敗

**確認**:
```bash
# ログ確認
gcloud run services logs read video-analyzer-worker \
  --region us-central1 \
  --filter "textPayload:ROI Detection Results" \
  --limit 10
```

### 今後の拡張予定

#### Phase 2: 4領域対応
- 下段15%（字幕）
- 中央15%（メインテキスト）
- 左上10%（ロゴ）
- 右上10%（タイムスタンプ）

#### Phase 3: カスタム領域設定
- JSON設定ファイルでの領域定義
- 複数クロップフィルタの組み合わせ
- 動的閾値調整

#### Phase 4: 機械学習統合
- テキスト領域の自動検出
- OCR結果との連携
- コンテキストベースの閾値最適化

### 関連ファイル

**型定義**:
- `cloud-run-worker/src/types/excel.ts:excel.ts:69-124`

**コア実装**:
- `cloud-run-worker/src/services/ffmpeg.ts`（7つの新関数）

**テスト**:
- `/tmp/integration-test.mjs`（統合テスト）
- `/tmp/ffmpeg-crop-test.sh`（FFmpegクロップ検証）
- `/tmp/test-crop-validation.mjs`（構文検証）

---

## 📝 環境変数一覧

### フロントエンド（Vercel）
| 変数名 | 必須 | 説明 |
|-------|------|------|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | ✅ | Clerk公開鍵 |
| `CLERK_SECRET_KEY` | ✅ | Clerkシークレットキー |
| `BLOB_READ_WRITE_TOKEN` | ✅ | Vercel Blobトークン |
| `CLOUD_RUN_URL` | ✅ | Cloud Run Worker URL（**改行なし確認**） |
| `WORKER_SECRET` | ✅ | Worker認証シークレット |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase URL |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Supabaseサービスロールキー |
| `NODE_ENV` | ✅ | 環境モード（`production` / `development`） |

### バックエンド（Cloud Run）
| 変数名 | 必須 | 説明 |
|-------|------|------|
| `BLOB_READ_WRITE_TOKEN` | ✅ | Vercel Blobトークン |
| `SUPABASE_URL` | ✅ | Supabase URL |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Supabaseサービスロールキー |
| `OPENAI_API_KEY` | ✅ | OpenAI APIキー（Whisper用、OCRフォールバック） |
| `GEMINI_API_KEY` | ✅ | Gemini APIキー（**OCR プライマリ**） |
| `WORKER_SECRET` | ✅ | Worker認証シークレット（Vercelと同じ値） |
| `NODE_ENV` | ✅ | `production`（本番環境） |
| `ROI_DETECTION_ENABLED` | ❌ | ROI検出有効化（`true` / `false`、デフォルト: `false`） |
| `PORT` | ❌ | ポート番号（デフォルト: 8080） |

### マルチプロバイダーOCR設定（2026-02-08追加）
| 変数名 | 必須 | 説明 |
|-------|------|------|
| `GEMINI_MAX_PARALLEL` | ❌ | Gemini並列度（デフォルト: 10） |
| `GEMINI_RATE_LIMIT` | ❌ | Geminiレート制限（デフォルト: 100 req/min） |
| `GEMINI_MODEL` | ❌ | Geminiモデル名（デフォルト: gemini-2.5-flash） |
| `MISTRAL_API_KEY` | ❌ | Mistral APIキー（セカンダリOCR） |
| `MISTRAL_MAX_PARALLEL` | ❌ | Mistral並列度（デフォルト: 10） |
| `MISTRAL_RATE_LIMIT` | ❌ | Mistralレート制限（デフォルト: 100 req/min） |
| `MISTRAL_MODEL` | ❌ | Mistralモデル名（デフォルト: pixtral-12b-2409） |
| `GLM_API_KEY` | ❌ | GLM (ZhipuAI) APIキー（セカンダリOCR） |
| `GLM_MAX_PARALLEL` | ❌ | GLM並列度（デフォルト: 10） |
| `GLM_RATE_LIMIT` | ❌ | GLMレート制限（デフォルト: 100 req/min） |
| `GLM_MODEL` | ❌ | GLMモデル名（デフォルト: glm-4v） |
| `OPENAI_MAX_PARALLEL` | ❌ | OpenAI OCR並列度（デフォルト: 10） |
| `OPENAI_RATE_LIMIT` | ❌ | OpenAI OCRレート制限（デフォルト: 100 req/min） |
| `OPENAI_MODEL` | ❌ | OpenAI OCRモデル名（デフォルト: gpt-4o-mini） |

**OCRプロバイダー優先順位**: Gemini (1) > Mistral (2) > GLM (3) > OpenAI (4)
**1時間以上の動画**: 自動的に並列度が2倍にブーストされます

---

## 🔄 最近の主要な変更

### 2026年2月8日: マルチプロバイダーOCR高速化
**目的**: OCR処理の高速化とフォールバック機能追加

**実装内容**:
- マルチプロバイダーOCRルーター実装
- 対応プロバイダー: Gemini (primary), Mistral, GLM, OpenAI (fallback)
- 自動フォールバック機能（プロバイダー障害時）
- 1時間以上の動画で自動並列ブースト（2倍）
- load-balanced分散戦略

**期待される効果**:
| 処理 | 改善前 | 改善後 |
|-----|--------|-------|
| 100シーンOCR | ~3分30秒 | ~30秒-1分 |
| レート制限耐性 | 単一プロバイダー依存 | 自動フォールバック |
| 1時間動画 | 標準並列度 | 2倍並列ブースト |

**影響ファイル**:
- `cloud-run-worker/src/services/ocrRouter.ts`: OCRルーター（新規）
- `cloud-run-worker/src/services/ocrProviderInterface.ts`: プロバイダーインターフェース（新規）
- `cloud-run-worker/src/services/providers/`: 各プロバイダー実装
- `cloud-run-worker/src/services/pipeline.ts`: OCRルーター統合

---

### 2026年2月5日: Cloud Run パフォーマンス大幅改善
**目的**: 処理速度の大幅な向上（10-50倍の高速化）

**問題**:
- 20MB/15秒の動画処理に約18分かかっていた（期待値: 1-3分）
- R2ダウンロード: 201秒（0.10 MB/s）
- FFmpeg操作が極端に遅い
- 音声チャンク抽出がタイムアウト

**根本原因**:
1. **CPU不足**: 1 vCPUではFFmpegに不十分
2. **CPUスロットリング**: リクエスト間でCPUが抑制
3. **gVisor環境**: gen1環境ではFFmpegがハングしやすい
4. **fluent-ffmpeg**: `.run()`メソッドがgVisorで問題を起こす

**解決策**:

#### 1. Cloud Run リソース設定更新
```bash
gcloud run services update video-analyzer-worker \
  --region us-central1 \
  --cpu 4 \
  --memory 4Gi \
  --concurrency 1 \
  --no-cpu-throttling \
  --execution-environment gen2
```

| 設定 | 変更前 | 変更後 |
|-----|-------|-------|
| CPU | 1 vCPU | 4 vCPU |
| メモリ | 2 GB | 4 GB |
| 同時実行数 | 160 | 1 |
| CPUスロットリング | 有効 | **無効** |
| 実行環境 | gen1 (gVisor) | **gen2** (Linux VM) |

#### 2. audioExtractor.ts を spawn ベースに書き換え
`fluent-ffmpeg`の`.run()`メソッドはgVisor環境でハングする可能性があるため、
`spawn`を直接使用するように書き換え。

**書き換えた関数**:
- `extractAudioForWhisper()` - 音声抽出
- `preprocessAudioForVAD()` - VAD前処理
- `extractAudioChunk()` - チャンク抽出
- `splitAudioIntoChunks()` - 事前分割
- `getAudioMetadata()` - メタデータ取得

**実装パターン**:
```typescript
// gVisor互換環境変数
function getGVisorEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    FONTCONFIG_PATH: '',
    FONTCONFIG_FILE: '/dev/null',
    FC_DEBUG: '0',
    HOME: '/tmp',
    XDG_CACHE_HOME: '/tmp',
    XDG_CONFIG_HOME: '/tmp',
    FFREPORT: '',
    AV_LOG_FORCE_NOCOLOR: '1',
  };
}

// spawn + アクティビティウォッチドッグ
const proc = spawn('ffmpeg', args, {
  env: getGVisorEnv(),
  stdio: ['ignore', 'pipe', 'pipe'],
});

// 60秒間出力がなければプロセスをkill
const activityInterval = setInterval(() => {
  if (Date.now() - lastActivityTime > 60000) {
    proc.kill('SIGKILL');
  }
}, 10000);
```

**期待される効果**:
| 処理 | 改善前 | 改善後（予想） |
|-----|--------|--------------|
| R2ダウンロード (20MB) | 201秒 | 5-20秒 |
| メタデータ抽出 | 59秒 | 1-5秒 |
| 音声抽出 | 277秒 | 10-30秒 |
| **合計** | ~18分 | **1-3分** |

**影響ファイル**:
- `cloud-run-worker/src/services/audioExtractor.ts`: spawn ベースに書き換え
- Cloud Run サービス設定

---

### 2025年11月14日: ROI（Region of Interest）検出実装
**目的**: テロップ・字幕変化の高精度検出

**問題**:
- 従来のシーン検出は全画面を対象としており、テロップ変化を見逃す場合があった
- ユーザーから「テロップが3回出現するが1回しか検出されない」という報告

**解決策**:
- ROI検出機能を実装（MVP: 画面下段15%領域）
- フルフレーム検出とROI検出を並行実行し、結果をマージ
- 検出ソースをトラッキング（`full_frame`, `roi_bottom`, `both`）

**実装内容**:
- 新しい型定義: `ROIRegion`, `ROIConfig`
- `SceneCut`型に`source`と`detectionReason`フィールド追加
- 7つの新関数実装:
  - `loadROIConfigFromEnv()`: 環境変数からROI設定を読み込み
  - `validateCropFilter()`: FFmpegクロップ構文の検証
  - `mergeCutsWithSource()`: 検出結果のマージとソース追跡
  - `deduplicateCuts()`: 100ms以内の重複削除
  - `detectROICuts()`: ROI領域のシーン検出
  - `runSceneDetectionWithCrop()`: クロップフィルタ適用版FFmpeg実行
  - `logROIDetectionResults()`: 検出結果の詳細ログ出力

**設定方法**:
```bash
# Cloud Run環境変数に追加
export ROI_DETECTION_ENABLED=true

# デプロイ時
gcloud run services update video-analyzer-worker \
  --region us-central1 \
  --update-env-vars "ROI_DETECTION_ENABLED=true"
```

**後方互換性**:
- デフォルトは`false`（無効）
- 有効化しない限り既存の動作に影響なし

**今後の拡張予定**:
- Phase 2: 4領域対応（下段、中央、左上、右上）
- Phase 3: カスタム領域設定

**影響ファイル**:
- `cloud-run-worker/src/types/excel.ts`: 型定義追加
- `cloud-run-worker/src/services/ffmpeg.ts`: コア実装
- `CLAUDE.md`: ドキュメント更新

### 2025年11月6日: ダウンロード進捗ログ修正
**問題**: 進捗ログが出力されない（10MBの倍数チェックがほぼ発火しない）

**修正内容**:
```typescript
// 以前: 10MBの倍数ちょうどの時だけログ
if (totalBytes > 0 && downloadedBytes % (10 * 1024 * 1024) === 0) {
  console.log(`Progress: ...`);
}

// 現在: 最後のログから10MB以上ダウンロードされたらログ
let lastLoggedBytes = 0;
if (totalBytes > 0 && downloadedBytes - lastLoggedBytes >= LOG_INTERVAL) {
  console.log(`Progress: ${percent}% (${downloadedMB}MB / ${totalMB}MB)`);
  lastLoggedBytes = downloadedBytes;
}
```

**影響**: ダウンロード進捗の可視化、デバッグ容易性向上

### 2025年11月6日: ダウンロードタイムアウト延長
**問題**: 大容量動画（445MB）のダウンロードが60秒でタイムアウト

**修正内容**: 60秒 → 300秒（5分）に延長

**影響ファイル**: `cloud-run-worker/src/services/videoProcessor.ts:videoProcessor.ts:167-169`

### 2025年11月4日: セキュリティ修正（IDOR脆弱性）
**問題**: 他ユーザーの処理ステータスが閲覧可能

**修正内容**:
- `processing_status`テーブルに`user_id`カラム追加
- RLS（Row Level Security）ポリシー有効化

**マイグレーション**: `supabase-migrations/002_add_user_id_and_fix_rls.sql`

### 2025年11月3日: 永続オーバーレイフィルタ改善
**問題**: 少数シーンでの統計的不安定性

**修正内容**:
- 最小シーン数チェック追加（デフォルト: 3）
- 設定可能な閾値（`threshold`, `minScenes`）

### 2025年11月3日: `/api/process`のawait追加
**問題**: 処理開始リクエストが送信されない（非同期エラー）

**修正内容**: `fetch()`に`await`追加

### 2025年11月2日: モニタリング実装
**追加内容**:
- 6つのアラートポリシー（エラーレート、レイテンシー、リソース使用率など）
- 3つのログベースメトリクス
- Cloud Monitoringダッシュボード
- 自動ヘルスチェックスクリプト

**ディレクトリ**: `monitoring/`

### 2025年11月1日: Blob自動クリーンアップ実装
**目的**: Vercel Blob容量制限（Hobby: 1GB）対策

**実装箇所**:
1. ソース動画削除（ダウンロード完了直後）
2. Excel結果削除（ダウンロード直後）
3. Cronジョブ（毎日3:00 AM、7日以上経過したBlobを削除）

### 2025年10月30日: Excel形式大幅改善（V2.1）
**以前（V2.0）**:
- 4シート構成: "Summary", "Transcription", "OCR Results", "Full Analysis"
- 固定間隔フレーム抽出

**現在（V2.1）**:
- 2シート構成: "Video Analysis"（5列）, "Statistics"
- シーンベースレイアウト
- 中間点スクリーンショット抽出
- 画像埋め込み（アスペクト比保持）

---

## 🚀 デプロイ手順

### フロントエンド（Vercel）

**本番URL**: `https://video.function-eight.com/`
**Vercel URL**: `https://video-analyzer-v2-web.vercel.app`

```bash
# 自動デプロイ（mainブランチにプッシュ）
git add .
git commit -m "feat: Add new feature"
git push origin main

# 手動デプロイ（git push の自動デプロイが失敗した場合はこちらを使用）
vercel --prod
```

**注意**: `git push` による自動デプロイが `Error` になることがある（2026-02-18確認）。その場合は `vercel --prod` で手動デプロイすれば成功する。

### Backend (Cloud Run) — Multi-Region Parallel Deploy

**Recommended**: Use `deploy-worker.sh` which builds the image once and deploys to all 6 regions in parallel.

```bash
# Type-check before deploy
cd cloud-run-worker && ./node_modules/.bin/tsc --noEmit && cd ..

# Deploy to ALL 6 regions (build once → parallel deploy)
./scripts/deploy-worker.sh

# Deploy to a SINGLE region (for testing)
./scripts/deploy-worker.sh us-central1
```

**How it works**:
1. `gcloud builds submit` builds the Docker image once → pushes to Artifact Registry (`us-central1`)
2. `gcloud run deploy --image` deploys the same image to all 6 regions in parallel (background processes)
3. Health checks verify all deployments
4. Old `--source .` approach is no longer used (it rebuilt the image per region)

**Cloud Run settings** (configured in deploy script):
- `--cpu 4` / `--memory 4Gi`: FFmpeg processing
- `--concurrency 1`: One video per instance
- `--no-cpu-throttling` / `--execution-environment gen2`: Prevent FFmpeg hangs
- `--timeout 3600`: 1-hour max processing time

**Post-deploy verification**:
```bash
# Health check (any region)
curl https://video-analyzer-worker-820467345033.us-central1.run.app/health

# Logs
gcloud run services logs tail video-analyzer-worker --region us-central1
```

---

## 📚 参照ドキュメント

### プロジェクト内ドキュメント
- `README.md` - プロジェクト概要とセットアップ
- `CLAUDE.md` - **Claude開発者向けガイド（このファイル）**
- `SYSTEM_ARCHITECTURE_2025-11-04.md` - 詳細なシステムアーキテクチャ
- `API_DOCUMENTATION.md` - API仕様
- `DEPLOYMENT_DESIGN.md` - デプロイ設計
- `.claude/OCR_BEST_PRACTICES.md` - OCRベストプラクティス
- `docs/CLERK_EMAIL_AUTHENTICATION_GUIDE.md` - Clerk認証ガイド
- `docs/PROCESSING_STATUS_DISPLAY_GUIDE.md` - 処理ステータス表示ガイド
- `docs/archive/` - 過去のセッションハンドオフ・調査資料

### 外部ドキュメント
- [Next.js 14 ドキュメント](https://nextjs.org/docs)
- [Cloud Run ドキュメント](https://cloud.google.com/run/docs)
- [Vercel Blob ドキュメント](https://vercel.com/docs/storage/vercel-blob)
- [Supabase ドキュメント](https://supabase.com/docs)
- [OpenAI Whisper API](https://platform.openai.com/docs/api-reference/audio)
- [Google Gemini Vision API](https://ai.google.dev/docs/gemini_api_overview)

---

## 🛠️ 開発コマンド

### ローカル開発
```bash
# フロントエンド
npm run dev  # http://localhost:3000

# バックエンド（Cloud Run Worker）
cd cloud-run-worker
npm run dev  # http://localhost:8080
```

### ビルド
```bash
# フロントエンド
npm run build

# バックエンド
cd cloud-run-worker
npm run build
```

### テスト
```bash
# ユニットテスト
npm test

# E2Eテスト
npm run test:e2e

# 本番環境E2Eテスト
npx jest __tests__/api/production-e2e.test.ts
```

### ログ確認
```bash
# Cloud Run（リアルタイム）
gcloud run services logs tail video-analyzer-worker --region us-central1

# エラーのみ
gcloud run services logs read video-analyzer-worker \
  --region us-central1 \
  --filter "severity>=ERROR" \
  --limit 50

# 特定Upload IDのログ
gcloud run services logs read video-analyzer-worker \
  --region us-central1 \
  --filter "textPayload:upload_1730678901234_abc123xyz" \
  --limit 100
```

---

## 🔐 セキュリティ考慮事項

### 実装済みセキュリティ対策
- ✅ **Clerk認証**: セッションベース認証
- ✅ **WORKER_SECRET**: API間認証
- ✅ **RLS（Row Level Security）**: ユーザーIDベースのアクセス制御
- ✅ **IDOR修正**: 他ユーザーの処理ステータス閲覧不可
- ✅ **CSRF保護**: Clerk組み込み保護
- ✅ **SSRF保護**: Blob URL検証（`vercel-storage`含むか確認）

### 今後の改善予定
- ✅ **Secret Manager移行**: スクリプト実装完了（2025-11-07）- `scripts/migrate-to-secret-manager.sh`
  - 詳細: `DEPLOYMENT_DESIGN.md` の「Secret Manager移行ガイド」セクション参照
- ⏳ **APIキーローテーション**: Clerk, Blob, Supabase, WORKER_SECRET
- ⏳ **Git履歴クリーンアップ**: 機密情報削除

---

## 📊 パフォーマンス最適化

### 実装済み最適化
- **Cloud Run gen2 + 4 vCPU** (2026-02-05): 処理速度10-50倍向上
- **spawn ベース FFmpeg** (2026-02-05): gVisorハング問題回避
- **CPUスロットリング無効** (2026-02-05): 常時フルパワー
- **VAD使用**: Whisper APIコスト40-60%削減
- **チャンク処理**: 10秒単位でWhisper処理
- **マルチパス検出**: 高精度なシーン検出
- **React Query**: データフェッチング・キャッシング
- **R2並列ダウンロード**: 大容量ファイルの高速ダウンロード

### FFmpeg実装の注意点
**重要**: Cloud Run環境では`fluent-ffmpeg`の`.run()`メソッドがハングする可能性があります。

✅ **推奨**: `spawn`を直接使用
```typescript
import { spawn } from 'child_process';
const proc = spawn('ffmpeg', args, {
  env: getGVisorEnv(),
  stdio: ['ignore', 'pipe', 'pipe'],
});
```

❌ **非推奨**: `fluent-ffmpeg`の`.run()`
```typescript
ffmpeg(input).output(output).run(); // Cloud Runでハングする可能性
```

### 今後の最適化予定
- **Cloud CDN**: キャッシュ戦略実装
- **画像最適化**: Next.js Image最適化
- **並列処理**: Whisperチャンク並列化

---

## 💡 開発のベストプラクティス

### コミット規約
```bash
# コンベンショナルコミット形式
feat: Add new feature
fix: Fix bug
docs: Update documentation
test: Add tests
refactor: Refactor code
chore: Update dependencies
```

### ブランチ戦略
- `main`: 本番環境（保護ブランチ）
- `feature/*`: 新機能開発
- `fix/*`: バグ修正
- `docs/*`: ドキュメント更新

### プルリクエスト
1. `main`から新しいブランチを作成
2. 変更を実装
3. ローカルテスト実行
4. プルリクエスト作成
5. レビュー後にマージ

---

## 🤖 API自動化の活用

### 基本方針
**ユーザー要望**: 可能な限りAPI経由での自動化を優先し、手動UI操作を最小化する。

### Cloudflare API
Cloudflareの各種リソースは公式APIで管理可能。手動UI操作の代わりにAPIを使用することで、再現性と効率を向上できる。

#### 主要な機能
- **DNS管理**: CNAME/A/TXTレコードの追加・削除・更新
- **キャッシュ管理**: キャッシュパージ（全体/個別ファイル）
- **SSL/TLS設定**: 証明書管理、暗号化モード設定
- **権限管理**: APIトークンの作成・権限追加・削除

#### 実用例（このセッションで実施）
```bash
# Clerk DNS検証用のCNAMEレコード追加
curl -X POST "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "type": "CNAME",
    "name": "clerk.video-analyzer-v2.com",
    "content": "accounts.clerk.services",
    "ttl": 120,
    "proxied": false
  }'

# DNSレコードのTTL短縮（検証スピードアップ）
curl -X PATCH "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records/${RECORD_ID}" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{"ttl": 120}'

# キャッシュパージ（DNS変更反映促進）
curl -X POST "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/purge_cache" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{"purge_everything": true}'
```

#### APIトークン管理
```bash
# 新しいAPIトークンへの権限追加（既存トークンの編集）
# → Cloudflare Dashboard → My Profile → API Tokens → Edit
# 必要な権限: Zone.DNS (Edit), Zone.Cache Purge (Purge)
```

### Clerk API/Dashboard
Clerkのカスタムドメイン設定は一部API対応しているが、DNS検証トリガーなど一部の操作はDashboard経由が推奨される。

#### 主要な機能
- **カスタムドメイン設定**: DNS検証、SSL証明書自動発行
- **メール設定**: カスタムドメインからのメール送信設定
- **ユーザー管理**: API経由でのユーザー操作（CRUD）

#### 注意点
- **DNS検証トリガー**: Clerk Dashboardで「Verify」ボタンをクリックする必要がある（API未対応の可能性）
- **SSL証明書発行**: DNS検証完了後、自動的に発行される（通常24時間以内）
- **エラーハンドリング**: DNS検証失敗時は、TTL、プロキシ設定、レコード内容を確認

### 開発方針とベストプラクティス

#### API優先アプローチ
1. **調査**: 手動UI操作が必要な場合、まずAPI対応の可否を確認
2. **実装**: API対応している場合は、必ずAPI経由で実行
3. **ドキュメント化**: APIコマンドをスクリプト化し、再利用可能にする
4. **フォールバック**: API未対応の場合のみ、手動UI操作の手順を明記

#### セキュリティ考慮事項
- **最小権限の原則**: APIトークンには必要最小限の権限のみを付与
- **トークンローテーション**: 定期的にAPIトークンを再生成（推奨: 90日ごと）
- **作業完了後の無効化**: 一時的な権限が必要な場合、作業完了後すぐに削除
- **環境変数管理**: APIトークンは`.env`ファイルで管理（`.gitignore`で除外）

#### 実装例（推奨パターン）
```bash
# 環境変数ファイルの作成
cat > .env.cloudflare <<EOF
CF_API_TOKEN=your_token_here
ZONE_ID=your_zone_id_here
EOF

# スクリプトでの利用
source .env.cloudflare
./scripts/update-dns.sh
```

### 参考リソース
- [Cloudflare API Documentation](https://developers.cloudflare.com/api/)
- [Clerk API Documentation](https://clerk.com/docs/reference/backend-api)
- プロジェクト内スクリプト: `scripts/` ディレクトリ

---

## 🎛️ Agent Skills (プロジェクト固有)

### Video Analyzer Tuning Guard (`.claude/skills/video-analyzer-tuning/`)
シーン検出・音声処理の本番チューニング設定を保護。以下のキーワードでトリガー:
- シーン検出閾値 / threshold / DEFAULT_CONFIG
- minSceneInterval / minSceneDuration
- VAD パラメータ
- ffmpeg 設定変更
- `/api/process` の waitUntil

---

## 📞 サポート

### 問題が発生した場合
1. 本ドキュメントの「よくある問題と対処法」セクションを確認
2. `SYSTEM_ARCHITECTURE_2025-11-04.md`のトラブルシューティングセクションを参照
3. Cloud Runログを確認
4. Supabase Dashboardでステータス確認

### リソース
- **本番URL（推定）**: https://video-analyzer-v2.vercel.app
- **Cloud Run URL**: https://video-analyzer-worker-820467345033.us-central1.run.app
- **Supabase URL**: https://gcwdkjyyhmqtrxvmvnvn.supabase.co

---

**ドキュメントバージョン**: 2.2.0
**最終更新**: 2026年2月5日
**作成者**: Claude Code (Anthropic)
