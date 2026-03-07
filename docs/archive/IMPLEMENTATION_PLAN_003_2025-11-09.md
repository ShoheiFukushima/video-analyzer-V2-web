# Implementation Plan #003: Progress Update Enhancement

**作成日**: 2025年11月9日
**担当**: Claude Code (Sequential Thinking MCP)
**ステータス**: 実装準備完了
**関連**: FFMPEG_INVESTIGATION_002_2025-11-09.md

---

## 📋 概要

### 目的
動画ダウンロード中の進捗表示を改善し、ユーザーに「処理が進行中」であることを明確に伝える。

### 現状の問題
```
00:00 - "Downloading... 10%" ← ダウンロード開始
01:00 - "Downloading... 10%" ← 変化なし（フリーズしたように見える）
02:00 - "Downloading... 10%"
03:00 - "Downloading... 10%"
04:00 - "Downloading... 10%"
05:00 - "Downloading... 20%" ← 突然ジャンプ
```

### 期待される改善後
```
00:00 - "Downloading... 10%" ← ダウンロード開始
01:00 - "Downloading... 12%" ← 滑らかに進行
02:00 - "Downloading... 14%"
03:00 - "Downloading... 16%"
04:00 - "Downloading... 18%"
05:00 - "Downloading... 20%" ← 完了
```

---

## 🎯 実装フェーズ

### Phase 1: 細かい進捗更新（即時実装）⭐
- **優先度**: P1（高）
- **工数**: 1-2時間
- **リスク**: 低
- **UX改善**: 高

### Phase 2: 動的タイムアウト（将来実装）
- **優先度**: P2（中）
- **工数**: 2-3時間
- **リスク**: 中

### Phase 3: リトライ機構（オプショナル）
- **優先度**: P3（低）
- **工数**: 3-4時間
- **リスク**: 中-高
- **判断基準**: 本番環境でのダウンロード失敗率を計測後

---

## 🛠️ Phase 1: 詳細実装ガイド

### ステップ1: 関数シグネチャの変更

**ファイル**: `cloud-run-worker/src/services/videoProcessor.ts`

**現在の関数** (行377付近):
```typescript
async function downloadFile(url: string, dest: string) {
  console.log(`[downloadFile] Starting download from: ${url.substring(0, 100)}...`);

  const LOG_INTERVAL = 10 * 1024 * 1024; // 10MB
  let downloadedBytes = 0;
  let lastLoggedBytes = 0;

  const response = await axios.get(url, {
    responseType: 'stream',
    timeout: 300000,
    maxContentLength: 500 * 1024 * 1024,
    maxBodyLength: 500 * 1024 * 1024
  });

  const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
  // ... 以下略
}
```

**新しい関数シグネチャ**:
```typescript
async function downloadFile(
  url: string,
  dest: string,
  uploadId?: string,
  progressRange: { start: number; end: number } = { start: 10, end: 20 }
) {
  console.log(`[downloadFile] Starting download from: ${url.substring(0, 100)}...`);

  const LOG_INTERVAL = 10 * 1024 * 1024; // 10MB
  let downloadedBytes = 0;
  let lastLoggedBytes = 0;

  // 🆕 進捗更新用の変数
  const PROGRESS_UPDATE_THRESHOLD = 0.02; // 2%ごとに更新
  let lastProgressUpdate = 0;

  const response = await axios.get(url, {
    responseType: 'stream',
    timeout: 300000,
    maxContentLength: 500 * 1024 * 1024,
    maxBodyLength: 500 * 1024 * 1024
  });

  const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
  // ... 次のステップへ
}
```

---

### ステップ2: data イベントハンドラーの変更

**現在のコード** (行400-420付近):
```typescript
response.data.on('data', (chunk: Buffer) => {
  downloadedBytes += chunk.length;
  writer.write(chunk);

  // 既存のコンソールログ（10MBごと）
  if (totalBytes > 0 && downloadedBytes - lastLoggedBytes >= LOG_INTERVAL) {
    const percent = ((downloadedBytes / totalBytes) * 100).toFixed(1);
    const downloadedMB = (downloadedBytes / (1024 * 1024)).toFixed(1);
    const totalMB = (totalBytes / (1024 * 1024)).toFixed(1);

    console.log(`[downloadFile] Progress: ${percent}% (${downloadedMB}MB / ${totalMB}MB)`);
    lastLoggedBytes = downloadedBytes;
  }
});
```

**新しいコード**:
```typescript
response.data.on('data', (chunk: Buffer) => {
  downloadedBytes += chunk.length;
  writer.write(chunk);

  // 既存のコンソールログ（10MBごと）
  if (totalBytes > 0 && downloadedBytes - lastLoggedBytes >= LOG_INTERVAL) {
    const percent = ((downloadedBytes / totalBytes) * 100).toFixed(1);
    const downloadedMB = (downloadedBytes / (1024 * 1024)).toFixed(1);
    const totalMB = (totalBytes / (1024 * 1024)).toFixed(1);

    console.log(`[downloadFile] Progress: ${percent}% (${downloadedMB}MB / ${totalMB}MB)`);
    lastLoggedBytes = downloadedBytes;
  }

  // 🆕 Supabase進捗更新（2%ごと）
  if (uploadId && totalBytes > 0) {
    const downloadProgress = downloadedBytes / totalBytes; // 0.0 - 1.0

    // 2%以上進捗した場合のみ更新
    if (downloadProgress - lastProgressUpdate >= PROGRESS_UPDATE_THRESHOLD) {
      const range = progressRange.end - progressRange.start;
      const overallProgress = progressRange.start + (downloadProgress * range);

      // Fire-and-forget（非ブロッキング）でSupabase更新
      safeUpdateStatus(uploadId, {
        progress: Math.floor(overallProgress),
        stage: 'downloading'
      }).catch((err) => {
        // エラーがあってもダウンロードは継続
        console.error(`[${uploadId}] Progress update failed (non-fatal):`, err);
      });

      lastProgressUpdate = downloadProgress;
    }
  }
});
```

**コメント解説**:
```typescript
// downloadProgress = 0.5（50%ダウンロード済み）の場合
// range = 20 - 10 = 10（進捗範囲）
// overallProgress = 10 + (0.5 * 10) = 15
// Math.floor(15) = 15 → 「15%」と表示される

// downloadProgress = 0.0（開始直後）の場合
// overallProgress = 10 + (0.0 * 10) = 10 → 「10%」

// downloadProgress = 1.0（完了）の場合
// overallProgress = 10 + (1.0 * 10) = 20 → 「20%」
```

---

### ステップ3: 呼び出し側の変更

**ファイル**: `cloud-run-worker/src/services/videoProcessor.ts`

**現在のコード** (行91-96付近):
```typescript
// Step 1: Download video
await safeUpdateStatus(uploadId, { status: 'downloading', progress: 10, stage: 'downloading' });

await timeStep(uploadId, 'Download Video', async () => {
  await downloadFile(blobUrl, videoPath);
});
```

**新しいコード**:
```typescript
// Step 1: Download video
await safeUpdateStatus(uploadId, { status: 'downloading', progress: 10, stage: 'downloading' });

await timeStep(uploadId, 'Download Video', async () => {
  await downloadFile(blobUrl, videoPath, uploadId, { start: 10, end: 20 });
});
```

**注意**: `uploadId` と進捗範囲 `{ start: 10, end: 20 }` を渡すだけ。

---

### ステップ4: 型定義の追加（TypeScript）

**ファイル**: `cloud-run-worker/src/services/videoProcessor.ts` (ファイル上部)

**追加する型定義**:
```typescript
/**
 * 進捗範囲の型定義
 * @property start - 進捗の開始パーセンテージ（例: 10）
 * @property end - 進捗の終了パーセンテージ（例: 20）
 */
interface ProgressRange {
  start: number;
  end: number;
}
```

**関数シグネチャの完全版**:
```typescript
/**
 * ファイルをダウンロードし、進捗をSupabaseに報告する
 *
 * @param url - ダウンロードするファイルのURL
 * @param dest - 保存先のファイルパス
 * @param uploadId - アップロードID（進捗更新に使用、オプショナル）
 * @param progressRange - 進捗範囲（デフォルト: 10-20%）
 * @returns Promise<void>
 *
 * @example
 * // ダウンロードのみ（進捗更新なし）
 * await downloadFile(url, '/tmp/video.mp4');
 *
 * @example
 * // 進捗更新あり（10% → 20%の範囲で更新）
 * await downloadFile(url, '/tmp/video.mp4', 'upload_123', { start: 10, end: 20 });
 */
async function downloadFile(
  url: string,
  dest: string,
  uploadId?: string,
  progressRange: ProgressRange = { start: 10, end: 20 }
): Promise<void> {
  // ... 実装
}
```

---

## 🧪 テスト計画

### テストケース1: 小容量ファイル（10MB）
**目的**: 基本動作確認

**手順**:
1. 10MBの動画をアップロード
2. 処理開始
3. ログとフロントエンドの進捗を確認

**期待される結果**:
```
[uploadId] ⏱️  [Download Video] Starting...
[downloadFile] Starting download from: https://...
[downloadFile] Progress: 100.0% (10.0MB / 10.0MB)
[uploadId] ✅ [Download Video] Completed in 7.5s
```

**進捗表示**:
- `10%` → `12%` → `20%`（素早く完了）

**評価基準**:
- ✅ ダウンロード完了
- ✅ 進捗が10% → 20%に到達
- ✅ エラーなし

---

### テストケース2: 中容量ファイル（100MB）
**目的**: 中間進捗の確認

**手順**:
1. 100MBの動画をアップロード
2. 処理開始
3. ログとフロントエンドの進捗を確認

**期待される結果**:
```
[uploadId] ⏱️  [Download Video] Starting...
[downloadFile] Starting download from: https://...
[downloadFile] Progress: 10.0% (10.0MB / 100.0MB)
[uploadId] Supabase progress updated: 11%
[downloadFile] Progress: 20.0% (20.0MB / 100.0MB)
[uploadId] Supabase progress updated: 12%
[downloadFile] Progress: 30.0% (30.0MB / 100.0MB)
[uploadId] Supabase progress updated: 13%
...
[downloadFile] Progress: 100.0% (100.0MB / 100.0MB)
[uploadId] Supabase progress updated: 20%
[uploadId] ✅ [Download Video] Completed in 67.2s
```

**進捗表示**:
- `10%` → `12%` → `14%` → `16%` → `18%` → `20%`

**評価基準**:
- ✅ 進捗が2%刻みで更新される
- ✅ UIが滑らかに動く
- ✅ ダウンロード速度に影響なし（67秒程度）

---

### テストケース3: 大容量ファイル（445MB）
**目的**: 実際のユースケースでの動作確認

**手順**:
1. 445MBの動画をアップロード
2. 処理開始
3. ログとフロントエンドの進捗を5分間監視

**期待される結果**:
```
[uploadId] ⏱️  [Download Video] Starting...
[downloadFile] Starting download from: https://...
[downloadFile] Progress: 2.2% (10.0MB / 445.0MB)
[uploadId] Supabase progress updated: 10%
[downloadFile] Progress: 4.5% (20.0MB / 445.0MB)
[uploadId] Supabase progress updated: 10%
[downloadFile] Progress: 6.7% (30.0MB / 445.0MB)
[uploadId] Supabase progress updated: 11%
...
[downloadFile] Progress: 100.0% (445.0MB / 445.0MB)
[uploadId] Supabase progress updated: 20%
[uploadId] ✅ [Download Video] Completed in 297.5s
```

**進捗表示**:
- `10%` → `10%`（~60秒）
- `11%` → `12%`（~60秒）
- `13%` → `14%`（~60秒）
- `15%` → `16%`（~60秒）
- `17%` → `18%`（~60秒）
- `20%`

**評価基準**:
- ✅ 約60秒ごとに進捗が1-2%増加
- ✅ タイムアウトなし（300秒以内に完了）
- ✅ ユーザーが「進行中」を認識できる

---

### テストケース4: Supabase更新失敗時の動作
**目的**: エラー耐性の確認

**手順**:
1. Supabase接続を一時的に切断（環境変数を無効化）
2. 動画をアップロード
3. ダウンロードが継続されるか確認

**期待される結果**:
```
[uploadId] ⏱️  [Download Video] Starting...
[downloadFile] Starting download from: https://...
[downloadFile] Progress: 10.0% (10.0MB / 100.0MB)
[uploadId] Progress update failed (non-fatal): Error: Supabase connection error
[downloadFile] Progress: 20.0% (20.0MB / 100.0MB)
[uploadId] Progress update failed (non-fatal): Error: Supabase connection error
...
[downloadFile] Progress: 100.0% (100.0MB / 100.0MB)
[uploadId] ✅ [Download Video] Completed in 67.5s
```

**評価基準**:
- ✅ ダウンロードは継続（失敗しない）
- ✅ エラーログが出力される
- ✅ コンソールログは正常（10MBごと）

---

### テストケース5: 並行ダウンロードの競合テスト
**目的**: 複数ユーザーの同時処理で問題ないか確認

**手順**:
1. 3つの動画を同時にアップロード（各100MB）
2. 処理開始
3. それぞれのログと進捗を確認

**期待される結果**:
```
[upload_001] Supabase progress updated: 12%
[upload_002] Supabase progress updated: 14%
[upload_003] Supabase progress updated: 11%
[upload_001] Supabase progress updated: 14%
[upload_002] Supabase progress updated: 16%
...
```

**評価基準**:
- ✅ 各uploadIdが独立して更新される
- ✅ 進捗が混在しない（upload_001の進捗がupload_002に反映されない）
- ✅ パフォーマンス低下なし

---

## 🔍 監視とデバッグ

### Cloud Runログの確認

**リアルタイム監視**:
```bash
gcloud run services logs tail video-analyzer-worker \
  --region us-central1 \
  --format="table(timestamp,textPayload)"
```

**特定uploadIdのログフィルタ**:
```bash
gcloud run services logs read video-analyzer-worker \
  --region us-central1 \
  --filter "textPayload:upload_1234567890_abcdefgh" \
  --limit 200
```

**進捗更新のみ抽出**:
```bash
gcloud run services logs read video-analyzer-worker \
  --region us-central1 \
  --filter "textPayload:Supabase progress updated" \
  --limit 50
```

---

### Supabaseの進捗確認

**SQL（Supabase Dashboard → SQL Editor）**:
```sql
SELECT
  upload_id,
  progress,
  stage,
  updated_at,
  extract(epoch from (updated_at - lag(updated_at) OVER (PARTITION BY upload_id ORDER BY updated_at))) as seconds_since_last_update
FROM processing_status
WHERE upload_id = 'upload_1234567890_abcdefgh'
ORDER BY updated_at ASC;
```

**期待される結果**:
```
| upload_id             | progress | stage       | updated_at          | seconds_since_last_update |
|----------------------|----------|-------------|---------------------|---------------------------|
| upload_123...        | 10       | downloading | 2025-11-09 14:00:00 | NULL                      |
| upload_123...        | 11       | downloading | 2025-11-09 14:01:00 | 60                        |
| upload_123...        | 12       | downloading | 2025-11-09 14:02:00 | 60                        |
| upload_123...        | 14       | downloading | 2025-11-09 14:03:00 | 60                        |
| upload_123...        | 16       | downloading | 2025-11-09 14:04:00 | 60                        |
| upload_123...        | 20       | downloading | 2025-11-09 14:05:00 | 60                        |
```

**異常パターン**:
- `seconds_since_last_update` が120秒以上 → 更新が遅い
- `progress` が減少（例: 14% → 12%） → 競合条件エラー
- `progress` が20以上に増加 → ロジックエラー

---

## 📊 パフォーマンス測定

### ダウンロード速度への影響測定

**測定方法**:
1. Phase 1実装前のダウンロード時間を記録（ベースライン）
2. Phase 1実装後のダウンロード時間を記録
3. 差分を計算

**ベースライン（実装前）**:
```
100MB動画: 67秒（平均1.49MB/s）
445MB動画: 297秒（平均1.50MB/s）
```

**目標（実装後）**:
```
100MB動画: 68秒以内（1.47MB/s以上）
445MB動画: 305秒以内（1.46MB/s以上）
```

**許容範囲**: ベースラインの+5%以内

**測定スクリプト**:
```bash
#!/bin/bash
# measure-download-speed.sh

UPLOAD_ID=$1
START_TIME=$(date +%s)

# ダウンロード完了まで待機
while true; do
  STATUS=$(curl -s https://api.example.com/status/$UPLOAD_ID | jq -r '.stage')
  if [ "$STATUS" != "downloading" ]; then
    break
  fi
  sleep 1
done

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

echo "Download duration: ${DURATION}s"
```

---

## 🚨 ロールバック計画

### Phase 1のロールバック手順

**状況**: Phase 1実装後、以下の問題が発生
- ダウンロード速度が10%以上低下
- Supabase更新エラーが頻発
- 進捗が不正確（逆行、ジャンプ）

**手順**:

1. **関数シグネチャを元に戻す**:
```typescript
// 変更前に戻す
async function downloadFile(url: string, dest: string) {
  // ... 元のコード
}
```

2. **data イベントハンドラーを元に戻す**:
```typescript
response.data.on('data', (chunk: Buffer) => {
  downloadedBytes += chunk.length;
  writer.write(chunk);

  // 🆕 追加したSupabase更新コードを削除
  // if (uploadId && totalBytes > 0) { ... } ← この部分を削除

  // 既存のコンソールログのみ残す
  if (totalBytes > 0 && downloadedBytes - lastLoggedBytes >= LOG_INTERVAL) {
    // ... 既存のログ
  }
});
```

3. **呼び出し側を元に戻す**:
```typescript
// 元に戻す
await downloadFile(blobUrl, videoPath);
```

4. **テスト**:
```bash
# ローカルテスト
npm run test:download

# 本番デプロイ
gcloud run deploy video-analyzer-worker --source .
```

5. **検証**:
- ダウンロード速度がベースラインに戻ったか確認
- エラーログがないか確認

**所要時間**: 15-30分

---

## ✅ チェックリスト

### 実装前
- [ ] FFMPEG_INVESTIGATION_002_2025-11-09.md を読了
- [ ] Phase 1の設計を理解
- [ ] ローカル環境の準備完了
- [ ] ベースラインのダウンロード速度を測定

### 実装中
- [ ] 関数シグネチャ変更（ステップ1）
- [ ] data イベントハンドラー変更（ステップ2）
- [ ] 呼び出し側変更（ステップ3）
- [ ] 型定義追加（ステップ4）
- [ ] TypeScriptコンパイルエラーなし（`npm run build`）

### テスト
- [ ] テストケース1: 小容量ファイル（10MB）
- [ ] テストケース2: 中容量ファイル（100MB）
- [ ] テストケース3: 大容量ファイル（445MB）
- [ ] テストケース4: Supabase更新失敗時
- [ ] テストケース5: 並行ダウンロード

### デプロイ前
- [ ] Cloud Runログで動作確認
- [ ] Supabaseで進捗データ確認
- [ ] ダウンロード速度測定（ベースライン比較）
- [ ] エラーレート確認（目標: 0%）

### デプロイ後
- [ ] 本番環境でのテスト実行
- [ ] ユーザーフィードバック収集
- [ ] パフォーマンスメトリクス監視（7日間）
- [ ] ロールバック不要の確認

---

## 📚 参照

### ドキュメント
- `docs/FFMPEG_INVESTIGATION_002_2025-11-09.md` - 根本原因分析と実装計画
- `cloud-run-worker/src/services/videoProcessor.ts` - 実装対象ファイル
- `SESSION_HANDOFF_2025-11-06.md` - タイムアウト問題の詳細

### コード例
- Axios stream: https://axios-http.com/docs/res_schema
- Node.js Stream: https://nodejs.org/api/stream.html

---

**作成者**: Claude Code (Sequential Thinking MCP)
**レビュー状況**: 未レビュー（実装前）
**最終更新**: 2025年11月9日 14:30 JST（推定）
