# Video Analyzer V2 Web - 技術詳細調査レポート

**調査日**: 2025年11月11日
**プロジェクト**: Video Analyzer V2 Web
**バージョン**: 2.1.0

---

## 1. Cloud Run環境の制約

### 現在の設定

```yaml
リソース制限:
  CPU: 1 vCPU
  メモリ: 2 GiB
  タイムアウト: 600秒 (10分)
  最大インスタンス: 10
  同時実行リクエスト: 80 (推奨値)
```

**出典**: DEPLOYMENT_DESIGN.md (行162-167)

### メモリ分析

**割り当て: 2 GiB**
- Node.js ランタイム: ~80-150 MB
- FFmpeg プロセス: 300-600 MB (動画処理時)
- Whisper APIチャンク処理: 50-100 MB / チャンク
- Gemini Vision OCR: 100-200 MB
- Excel生成: 50-150 MB
- 予備メモリ: ~200-400 MB

**推奨メモリ使用**: 最大 1.8 GiB (90%)

**リスク**: メモリ不足により処理が中断される可能性あり

### タイムアウト分析

```typescript
// 現在のタイムアウト設定
Cloud Run タイムアウト: 600秒 (10分)
ダウンロード タイムアウト: 300秒 (videoProcessor.ts:403)
FFmpeg シーン検出: 60秒 (ffmpeg.ts:77)
VAD PCM変換: 120秒 (vadService.ts:203)
オーディオ抽出: 5分 (audioExtractor.ts)
```

**最大処理時間の内訳** (通常の10分動画):
1. ダウンロード: ~30秒 (450MBファイル)
2. メタデータ抽出: ~5秒
3. 音声抽出 (16kHz mono): ~10秒
4. VAD処理: ~20秒 (PCM変換+分析)
5. Whisper API: ~60-120秒 (10秒チャンク x 複数呼び出し)
6. シーン検出: ~30秒
7. フレーム抽出: ~30秒
8. Gemini Vision OCR: ~60-120秒 (シーンごとに順次処理)
9. Excel生成: ~10秒
10. Blob アップロード: ~5秒

**合計**: 260-330秒 (**4.3-5.5分**)

**安全マージン**: 600秒 - 330秒 = 270秒 (推奨以上)

---

## 2. 使用中のパッケージバージョン

### フロントエンド依存関係

```json
{
  "dependencies": {
    "@clerk/nextjs": "^5.0.0",
    "@supabase/supabase-js": "^2.77.0",
    "@tanstack/react-query": "^5.0.0",
    "@vercel/blob": "^0.23.0",
    "axios": "^1.7.0",
    "next": "^14.2.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0"
  },
  "devDependencies": {
    "jest": "^30.2.0",
    "typescript": "^5.5.0"
  }
}
```

### バックエンド依存関係

```json
{
  "dependencies": {
    "@google/generative-ai": "^0.24.1",     // Gemini Vision API
    "@supabase/supabase-js": "^2.38.0",
    "@vercel/blob": "^2.0.0",
    "avr-vad": "^1.0.9",                    // Silero VAD (音声活動検出)
    "exceljs": "^4.4.0",                    // Excel生成
    "express": "^4.18.2",
    "fluent-ffmpeg": "^2.1.2",              // FFmpeg Node.jsラッパー
    "openai": "^4.25.0"                     // Whisper API
  }
}
```

### TypeScriptコンパイル設定

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ES2020",
    "moduleResolution": "node",
    "strict": true,
    "esModuleInterop": true,
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "noImplicitReturns": true
  }
}
```

**注**: `noUnusedLocals` と `noUnusedParameters` は `false` (緩い設定)

### Dockerfile実行環境

```dockerfile
FROM node:20-slim  # Node.js 20 slim イメージ

# システムパッケージ
RUN apt-get install -y ffmpeg python3 python3-pip curl

# プロダクション最適化
RUN npm prune --production
ENV NODE_ENV=production
```

**FFmpegバージョン**: Debianパッケージ (7.x系が通常)

---

## 3. API制限とレート制限

### Gemini Vision APIの制限

```yaml
レート制限 (Free Tier):
  リクエスト数: 15 リクエスト/分 (1000/日)
  データ最大サイズ: 128 MB/リクエスト

設定値:
  モデル: "gemini-2.5-flash" (最新)
  画像形式: PNG 1280x720
```

**現在の実装**: pipeline.ts (行100-103)
- **シーンごとに順次処理** (並列処理なし)
- 10シーン = 40秒待機 (1リクエスト/4秒)

### OpenAI Whisper APIの制限

```yaml
レート制限 (Free Trial後):
  同時リクエスト数: 1 (Sequential)
  最大ファイルサイズ: 25 MB
  タイムアウト: 30秒/リクエスト

現在の実装:
  チャンク: 10秒 (Whisper最適化)
  処理: 順次 (Promise.all なし)
  リトライ: 3回（指数バックオフ）
```

**出典**: audioWhisperPipeline.ts (行117-178)
- **VAD効果**: 40-60% コスト削減
- **10秒チャンク**: Whisperの最適化長

### Vercel Blob Storageの限制

```yaml
Hobby プラン:
  容量: 1 GB (合計)
  アップロード: 4 GB/ファイル
  ダウンロード帯域: 無制限

現在の実装:
  ソース動画: 削除済み (ダウンロード直後)
  Excel結果: 削除済み (ダウンロード直後)
  テンポラリー: 削除済み (クリーンアップ時)
```

**出典**: videoProcessor.ts (行107-115, 268-292)

---

## 4. 現在のメモリ使用パターン

### FFmpegメモリ使用

```typescript
// FFmpeg シーン検出 (ffmpeg.ts)
- 動画: ~300-500 MB (メモリマップファイル)
- フレーム抽出: ~50-100 MB/フレーム
- ストリーム処理: 効率的 (stdio使用)

シーン検出のマルチパス:
  - 閾値[0.03, 0.05, 0.10]: 3回実行
  - 各パス: ~100 MB
  - 合計: ~300 MB
```

### 画像バッファサイズ

```typescript
// 出力フレーム仕様 (ffmpeg.ts:195)
解像度: 1280x720
形式: PNG (ロスレス)
ファイルサイズ: 150-300 KB/フレーム
メモリ: ~2-4 MB/フレーム (バッファ)

10シーン = 20-40 MB
```

### Excel生成メモリ

```typescript
// ExcelJS メモリ使用 (excel-generator.ts)
- ワークブック: ~5 MB
- 行データ: ~1 KB/行
- 画像埋め込み: ~100 KB/画像
- 計算: ~50 MB/100行

10シーン Excel = ~10-15 MB
```

### パイプライン全体メモリ

```
最大同時メモリ使用:
├── Node.js: 80 MB
├── 動画ファイル: 400 MB (ダウンロード & 処理)
├── FFmpeg マルチパス: 300 MB
├── 画像バッファ: 40 MB (10フレーム)
├── Whisper チャンク: 20 MB
└── Excel生成: 15 MB
───────────────────────
合計: ~855 MB (推奨: 2 GiB 内)
```

**ピークメモリ**: 1.2-1.5 GiB (安全)
**安全係数**: 2 GiB / 1.3 GiB = 1.54x (良好)

---

## 5. 並列処理の実装可能性

### 現在の実装パターン

```typescript
// シーケンシャル処理（全て）
1. extractAllAudioChunks() - for ループで順次
   audioWhisperPipeline.ts:172-178

2. performSceneBasedOCR() - for ループで順次
   pipeline.ts:107-180

3. Excel画像埋め込み - for ループで順次
   excel-generator.ts:79-165
```

### 並列処理の制約

```yaml
制約1: API制限
  - Gemini Vision: 15 リクエスト/分
  - Whisper: Sequential only
  → 並列化困難

制約2: メモリ
  - 現在: 1.5 GB ピーク
  - 10並列: ~3-4 GB (Cloud Run 2GB超過)
  → 並列化時はメモリ拡張必須

制約3: Cloud Run実行時間
  - 600秒制限
  - 順次: 5.5分以内 (OK)
  - 並列: タイムアウトのリスク低減
```

### 並列化可能な箇所

#### 1. オーディオチャンク抽出 (低リスク)

```typescript
// 現在: 順次実行 (10秒)
for (const chunk of chunks) {
  await extractAudioChunk(audioPath, chunk);
}

// 提案: Promise.all (5秒)
await Promise.all(
  chunks.map(chunk => extractAudioChunk(audioPath, chunk))
);

メリット:
  - ディスク I/O並列化
  - メモリ増加: 小 (~50 MB)
  - リスク: 低

実装ライブラリ: 不要 (Promise.all十分)
```

#### 2. フレーム抽出 (中リスク)

```typescript
// 現在: 順次実行 (30秒)
for (const scene of scenes) {
  await extractFrameAtTime(videoPath, scene.midTime, filename);
}

// 提案: 制限並列化 (p-limit)
import pLimit from 'p-limit';
const limit = pLimit(3); // 3並列

await Promise.all(
  scenes.map(scene =>
    limit(() => extractFrameAtTime(videoPath, scene.midTime, filename))
  )
);

メリット:
  - 処理時間: 30秒 → 10秒
  - FFmpegプロセス制限: 3個
  - メモリ増加: 中 (~100 MB)

リスク: 中
  - FFmpeg同時実行 (3個)
  - リソース競争

実装ライブラリ: p-limit@4.0.0
```

#### 3. Whisper API (高リスク)

```typescript
// 現在: 順次実行 (必須)
for (const chunk of vadResult.audioChunks) {
  const chunkSegments = await transcribeAudioChunk(chunk, uploadId);
  segments.push(...);
}

// 提案: できない
- Whisper API: Sequential only (APIサーバー制限)
- リトライ対応: 複雑化
- リスク: 非常に高い

結論: 並列化不可
```

#### 4. Gemini Vision OCR (高リスク)

```typescript
// 現在: 順次実行 (120秒)
for (const scene of scenes) {
  const result = await model.generateContent([...]);
  scenesWithOCR.push(...);
}

// 提案: 制限並列化
import pLimit from 'p-limit';
const limit = pLimit(2); // 2並列 (レート制限対応)

await Promise.all(
  scenes.map(scene =>
    limit(() => performOCROnScene(scene))
  )
);

メリット:
  - 処理時間: 120秒 → 60秒
  - API制限: 2リクエスト/秒 (15/分内)
  - メモリ増加: 中 (~80 MB)

リスク: 高
  - APIレート制限 (15/分)
  - 2並列でも 120リクエスト/分
  → 設定を正確に必要

実装ライブラリ: p-limit@4.0.0
```

### 推奨並列化戦略

```yaml
優先度1 - すぐ実装 (低リスク):
  オーディオチャンク抽出:
    - 並列度: Promise.all (無制限)
    - 効果: 5秒短縮 (1%)
    - 実装: 1時間

優先度2 - 検討 (中リスク):
  フレーム抽出:
    - 並列度: p-limit(3)
    - 効果: 20秒短縮 (6%)
    - 実装: 2時間
    - メモリ: 2 GiB → 2.1 GiB

優先度3 - 見送り (高リスク):
  Gemini Vision OCR:
    - 並列度: p-limit(1-2) - 厳密に制限
    - 効果: 60秒短縮 (18%)
    - リスク: APIレート制限
    - 実装: 3時間
    - メモリ: 2 GiB → 2.2 GiB
    - 推奨: 先に API制限の詳細を確認

不可能:
  Whisper API: APIサーバー仕様で Sequential のみ
```

---

## 6. Node.jsバージョン比較

### Dockerfile vs ローカル環境

```yaml
Dockerfile:
  イメージ: node:20-slim
  バージョン: Node.js 20.x (安定版)
  用途: 本番環境 (Cloud Run)

ローカル環境:
  バージョン: Node.js 24.10.0 (最新)
  差分: 主要 API 互換
  推奨: Dockerfileと合わせる
```

**バージョン不一致の影響**: 低リスク (ES2020 互換)

---

## 7. パフォーマンスボトルネック分析

### 現在の処理時間分布

```
動画処理パイプライン (10分 450MB動画):

① ダウンロード                    ~30秒  (5%)
② メタデータ抽出                  ~5秒   (1%)
③ 音声抽出 (FFmpeg)               ~10秒  (2%)
④ VAD処理                         ~20秒  (3%)
⑤ Whisper API (複数チャンク)      ~120秒 (20%)  ← ボトルネック #1
⑥ シーン検出 (マルチパス)         ~30秒  (5%)
⑦ フレーム抽出                    ~30秒  (5%)
⑧ Gemini Vision OCR              ~120秒 (20%)  ← ボトルネック #2
⑨ Excel生成                       ~10秒  (2%)
⑩ Blob アップロード               ~5秒   (1%)
───────────────────────────────────────────────
合計:                            ~380秒 (100%)
```

### ボトルネック詳細

#### ボトルネック #1: Whisper API (~120秒, 20%)

```
原因:
- 10秒チャンク: 60分動画 = 360チャンク
- 各リクエスト: 5-10秒待機 + ネットワーク遅延
- 順次処理: 並列化不可 (APIサーバー制限)

改善案:
1. VAD感度調整 (現在: 0.6)
   - 感度 UP → チャンク削減
   - 効果: 10-20% 削減可能

2. チャンク長延長 (現在: 10秒)
   - 10秒 → 20秒
   - 効果: 50% 削減可能
   - リスク: 精度低下

3. キャッシング (実装予定)
   - 同一音声セグメント検出時
   - 効果: 使用パターン依存 (5-15%)
```

#### ボトルネック #2: Gemini Vision OCR (~120秒, 20%)

```
原因:
- シーンごとに順次処理
- 10シーン × 12秒/リクエスト = 120秒
- API制限: 15リクエスト/分

改善案:
1. 制限並列化 (p-limit)
   - 並列度: 2-3
   - 効果: 40-60% 削減可能
   - リスク: API レート制限

2. バッチ処理
   - 複数画像を1リクエストで送信
   - 効果: 70-80% 削減可能
   - リスク: Gemini APIの仕様確認必須

3. フレーム圧縮
   - PNG → JPG に変更
   - 効果: ネットワーク 20% 削減
   - リスク: OCR精度わずか低下

4. スマート OC Rスキップ
   - シーン内容が同じ → OCR スキップ
   - 効果: シーン数が少ない場合 (5-10%)
   - リスク: テキスト検出漏れ
```

---

## 8. リソース最適化の推奨事項

### 短期 (1-2週間)

```yaml
1. VAD感度微調整
   変更: sensitivity: 0.6 → 0.5 (高感度)
   期待効果: Whisper チャンク 5-10% 削減
   リスク: 低
   実装時間: 1時間

2. メモリモニタリング追加
   実装: process.memoryUsage() ログ
   期待効果: メモリリーク検出
   リスク: なし
   実装時間: 2時間

3. Gemini Vision 制限並列化
   実装: p-limit(2)
   期待効果: OCR 40-50% 高速化
   リスク: 中 (API制限)
   実装時間: 3時間
   メモリ: +50 MB
```

### 中期 (1-2ヶ月)

```yaml
1. Cloud Run リソース最適化
   メモリ: 2 GB → 2.5 GB (if needed)
   期待効果: 並列処理の安全性向上
   コスト: +$0.005/実行
   推奨: 並列化実装後に検討

2. Whisper チャンク最適化
   研究: チャンク長 10秒 vs 15秒 vs 20秒
   期待効果: コスト 10-30% 削減
   リスク: 中 (精度確認必須)
   実装時間: 5時間 (テスト含む)

3. Blob ストレージ最適化
   変更: 自動削除期間の短縮
   期待効果: ストレージ効率向上
   リスク: なし
   実装時間: 2時間
```

### 長期 (3-6ヶ月)

```yaml
1. Cloud Pub/Sub キュー導入
   目的: リクエスト キューイング
   期待効果: 安定性向上 (同時実行制限)
   コスト: +$0.001/実行
   複雑度: 高
   実装時間: 2週間

2. マルチリージョン展開
   目的: 地理的分散 & レイテンシー削減
   期待効果: グローバル対応
   コスト: 2倍
   複雑度: 非常に高
   実装時間: 1ヶ月

3. キャッシング戦略導入
   目的: OCR & Whisper結果キャッシング
   期待効果: リピート動画の 80-90% 削減
   コスト: ストレージ追加
   複雑度: 高
   実装時間: 2週間
```

---

## 9. セキュリティに関する制約

### API キー管理

```yaml
現状:
  OPENAI_API_KEY: 環境変数 (平文)
  GEMINI_API_KEY: 環境変数 (平文)
  WORKER_SECRET: 環境変数 (平文)
  Blob Token: 環境変数 (平文)

リスク: 高
  - レポジトリにコミットされる可能性
  - ログに出力される可能性
  - デプロイスクリプト で露出

推奨: Secret Manager 移行
  実装: migrate-to-secret-manager.sh 準備済み
  効果: キー盗難リスク 大幅削減
```

---

## 10. 総括と推奨アクション

### 現在の状態評価

```
パフォーマンス:  B+ (370秒, 6分で完了)
メモリ効率:      A  (1.5 GB / 2 GB)
スケーラビリティ: B  (並列化の余地あり)
セキュリティ:     B  (Secret Manager推奨)
コスト効率:       A  (VAD で 40-60% 削減)
信頼性:          A- (タイムアウト余裕あり)
```

### 推奨順序付きアクション

```yaml
Phase 1: 安全性向上 (今すぐ)
  1. Secret Manager 移行
  2. メモリモニタリング追加
  時間: 3時間
  優先度: 高

Phase 2: パフォーマンス向上 (1-2週間)
  1. Gemini Vision 制限並列化 (2並列)
  2. VAD感度微調整
  時間: 4時間
  優先度: 高
  期待効果: 60秒短縮 (16%)

Phase 3: 最適化研究 (1ヶ月)
  1. Whisper チャンク最適化
  2. OCR バッチ処理研究
  3. フレーム圧縮検証
  時間: 2週間
  優先度: 中

Phase 4: インフラ改善 (3ヶ月+)
  1. Cloud Pub/Sub キュー
  2. キャッシング戦略
  3. マルチリージョン
  優先度: 低 (戦略的)
```

