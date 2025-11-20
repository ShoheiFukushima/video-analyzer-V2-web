# Phase 1 Monitoring Guide: Download Progress Updates

**作成日**: 2025年11月9日
**対象リビジョン**: video-analyzer-worker-00003-pzx 以降
**機能**: ダウンロード中の細かい進捗更新（10% → 12% → 14% → 16% → 18% → 20%）

---

## 📊 監視対象メトリクス

### 1. Progress Update Success Count
**メトリクス名**: `logging.googleapis.com/user/progress_update_success`

**説明**: Supabaseへの進捗更新が成功した回数

**期待値**:
- 小容量動画（10MB）: 1-2回
- 中容量動画（100MB）: 3-4回
- 大容量動画（445MB）: 5回

**確認方法**:
```bash
gcloud logging read 'resource.type="cloud_run_revision" textPayload=~"Progress update.*downloading" -textPayload:"failed"' \
  --limit=50 \
  --format="value(timestamp,textPayload)"
```

---

### 2. Progress Update Failure Count
**メトリクス名**: `logging.googleapis.com/user/progress_update_failure`

**説明**: Supabaseへの進捗更新が失敗した回数（非致命的エラー）

**期待値**: 0回（理想）、< 5%（許容範囲）

**確認方法**:
```bash
gcloud logging read 'resource.type="cloud_run_revision" textPayload:"Progress update failed (non-fatal)"' \
  --limit=50 \
  --format="value(timestamp,textPayload)"
```

**アラート**: 失敗率 > 10% で WARNING アラート発火

---

### 3. Download Duration
**メトリクス名**: `logging.googleapis.com/user/download_duration`

**説明**: 動画ダウンロードにかかった時間

**期待値**:
- 10MB: < 10秒
- 100MB: 60-70秒
- 445MB: 290-310秒

**ベースライン（Phase 1実装前）**:
- 100MB: 67秒
- 445MB: 297秒

**許容範囲**: ベースライン + 5%以内

**確認方法**:
```bash
gcloud logging read 'resource.type="cloud_run_revision" textPayload=~"\\[Download Video\\] Completed in"' \
  --limit=20 \
  --format="value(timestamp,textPayload)"
```

---

### 4. Progress Update Frequency
**メトリクス名**: `logging.googleapis.com/user/progress_update_frequency`

**説明**: 各進捗段階（10%, 12%, 14%, etc.）でのイベント発生回数

**期待値**:
- 10%: 全てのダウンロードで発生
- 12%: 100MB以上の動画で発生
- 14%: 200MB以上の動画で発生
- 16%: 300MB以上の動画で発生
- 18%: 400MB以上の動画で発生
- 20%: 全てのダウンロードで発生

---

## 🔍 ログクエリ集

### 特定uploadIdの進捗履歴
```bash
UPLOAD_ID="upload_1234567890_abcdefgh"

gcloud logging read \
  "resource.type=\"cloud_run_revision\" textPayload:\"${UPLOAD_ID}\" textPayload:\"downloading\"" \
  --format="value(timestamp,textPayload)" \
  --limit=100
```

**期待される出力例**:
```
2025-11-09T12:55:00.123Z [upload_123] Downloading... 10%
2025-11-09T12:56:00.456Z [upload_123] Downloading... 12%
2025-11-09T12:57:00.789Z [upload_123] Downloading... 14%
2025-11-09T12:58:01.012Z [upload_123] Downloading... 16%
2025-11-09T12:59:01.345Z [upload_123] Downloading... 18%
2025-11-09T13:00:01.678Z [upload_123] Downloading... 20%
```

---

### 進捗更新失敗の詳細
```bash
gcloud logging read \
  'resource.type="cloud_run_revision" textPayload:"Progress update failed"' \
  --format="json" \
  --limit=10 | jq '.[] | {timestamp, uploadId: .textPayload | capture("\\[(?<id>[^\\]]+)\\]").id, error: .textPayload}'
```

---

### ダウンロード速度分析
```bash
# ダウンロード完了ログを取得
gcloud logging read \
  'resource.type="cloud_run_revision" textPayload=~"Download complete: [0-9.]+MB"' \
  --format="value(timestamp,textPayload)" \
  --limit=50
```

**期待される出力例**:
```
2025-11-09T13:00:15.123Z [downloadFile] Download complete: 445.2MB
2025-11-09T12:58:10.456Z [downloadFile] Download complete: 100.5MB
2025-11-09T12:55:05.789Z [downloadFile] Download complete: 10.2MB
```

---

## 📈 Supabase監視クエリ

### 進捗更新の時系列確認
```sql
SELECT
  upload_id,
  progress,
  stage,
  updated_at,
  extract(epoch from (updated_at - lag(updated_at) OVER (PARTITION BY upload_id ORDER BY updated_at))) as seconds_since_last_update
FROM processing_status
WHERE
  created_at > now() - interval '1 hour'
  AND stage = 'downloading'
ORDER BY upload_id, updated_at ASC;
```

**期待される結果**:
| upload_id | progress | stage | updated_at | seconds_since_last_update |
|-----------|----------|-------|------------|---------------------------|
| upload_123 | 10 | downloading | 2025-11-09 13:00:00 | NULL |
| upload_123 | 12 | downloading | 2025-11-09 13:01:00 | 60 |
| upload_123 | 14 | downloading | 2025-11-09 13:02:00 | 60 |
| upload_123 | 16 | downloading | 2025-11-09 13:03:00 | 60 |
| upload_123 | 18 | downloading | 2025-11-09 13:04:00 | 60 |
| upload_123 | 20 | downloading | 2025-11-09 13:05:00 | 60 |

---

### 進捗異常検出
```sql
-- 進捗が逆行している（例: 16% → 14%）
SELECT
  upload_id,
  progress,
  stage,
  updated_at,
  lag(progress) OVER (PARTITION BY upload_id ORDER BY updated_at) as prev_progress
FROM processing_status
WHERE created_at > now() - interval '24 hours'
HAVING progress < prev_progress;

-- 進捗が20%を超えている（ロジックエラー）
SELECT
  upload_id,
  progress,
  stage,
  updated_at
FROM processing_status
WHERE
  stage = 'downloading'
  AND progress > 20
  AND created_at > now() - interval '24 hours';

-- 進捗更新間隔が120秒以上（遅延の可能性）
SELECT
  upload_id,
  progress,
  stage,
  updated_at,
  extract(epoch from (updated_at - lag(updated_at) OVER (PARTITION BY upload_id ORDER BY updated_at))) as seconds_since_last_update
FROM processing_status
WHERE
  created_at > now() - interval '1 hour'
  AND stage = 'downloading'
HAVING seconds_since_last_update > 120;
```

---

## 🚨 アラート設定

### Alert 1: High Progress Update Failure Rate
**条件**: 進捗更新失敗率 > 10% が10分間継続

**重要度**: WARNING

**通知先**: （未設定、必要に応じて追加）

**対応手順**: `alert-progress-update-failure.yaml` 参照

---

## 📊 ダッシュボード

### Cloud Monitoring ダッシュボード

**推奨ウィジェット**:

1. **Progress Update Success Rate**
   - メトリクス: `progress_update_success` / (`progress_update_success` + `progress_update_failure`)
   - タイプ: Line Chart
   - 期待値: > 95%

2. **Download Duration Distribution**
   - メトリクス: `download_duration`
   - タイプ: Heatmap
   - 期待値: ほとんどが60-300秒の範囲

3. **Progress Update Events per Download**
   - メトリクス: `progress_update_frequency`
   - タイプ: Stacked Bar Chart
   - グループ化: progress_percent

4. **Failure Error Types**
   - メトリクス: `progress_update_failure`
   - タイプ: Pie Chart
   - グループ化: error_type

---

## 🧪 テストシナリオ

### シナリオ1: 正常動作確認
**目的**: Phase 1が正常に動作しているか確認

**手順**:
1. 100MBの動画をアップロード
2. Cloud Runログを監視
3. Supabase進捗テーブルを確認

**期待される結果**:
- ログに「Downloading... 10%」から「Downloading... 20%」まで表示
- Supabaseに6つのレコード（10, 12, 14, 16, 18, 20）
- 進捗更新間隔が約15-20秒

---

### シナリオ2: Supabase障害時の耐性確認
**目的**: Supabase更新が失敗してもダウンロードが継続されるか確認

**手順**:
1. Supabase接続を一時的に切断（環境変数を無効化）
2. 動画をアップロード
3. ログを確認

**期待される結果**:
- 「Progress update failed (non-fatal)」エラーログ
- ダウンロードは完了する
- コンソールログ（10MBごと）は正常に出力

---

### シナリオ3: 大容量動画でのパフォーマンス確認
**目的**: 445MB動画で進捗更新がダウンロード速度に影響しないか確認

**手順**:
1. 445MBの動画をアップロード
2. ダウンロード時間を測定
3. ベースライン（297秒）と比較

**期待される結果**:
- ダウンロード時間: 297秒 ± 15秒（5%以内）
- 進捗更新: 5回（10% → 12% → 14% → 16% → 18% → 20%）
- 更新間隔: 約60秒

---

## 📝 トラブルシューティング

### 問題1: 進捗が10%から動かない
**症状**: フロントエンドで「Downloading... 10%」のまま

**原因**:
- Phase 1のコードが実行されていない（旧リビジョン）
- uploadIdがnullで渡されている
- Supabase接続エラー（全てのリクエストで失敗）

**調査**:
```bash
# 現在のリビジョン確認
gcloud run services describe video-analyzer-worker --region=us-central1 --format="value(status.traffic[0].revisionName)"

# uploadIdの確認
gcloud logging read 'textPayload:"Download Video"' --limit=5 --format="value(textPayload)"
```

**対処**:
- リビジョンが00003未満の場合 → 最新リビジョンにトラフィック切り替え
- uploadIdがnullの場合 → 呼び出し側の修正確認
- Supabase接続エラーの場合 → 環境変数・認証情報確認

---

### 問題2: 進捗更新失敗率が高い（> 10%）
**症状**: アラートが発火、ログに「Progress update failed」が多数

**原因**:
- Supabaseの一時的な障害
- データベース書き込みスロットリング
- ネットワーク遅延

**調査**:
```bash
# エラーログの詳細確認
gcloud logging read 'textPayload:"Progress update failed"' \
  --format="json" \
  --limit=20 | jq '.[] | .textPayload'
```

**対処**:
- Supabaseステータス確認: https://status.supabase.com/
- 一時的な障害の場合: 復旧を待つ（非致命的）
- 継続的な問題の場合: SUPABASE_SERVICE_ROLE_KEY 確認、スロットリング設定見直し

---

### 問題3: ダウンロード速度が低下した
**症状**: 100MB動画のダウンロードが70秒→75秒に増加

**原因**:
- Supabase更新のオーバーヘッド（想定外）
- ネットワーク遅延
- Cloud Runリソース不足

**調査**:
```bash
# ダウンロード時間の推移確認
gcloud logging read 'textPayload=~"\\[Download Video\\] Completed in"' \
  --limit=50 \
  --format="value(timestamp,textPayload)"
```

**対処**:
- 5%以内の増加 → 許容範囲（対処不要）
- 10%以上の増加 → Phase 1のロールバック検討
- 不規則な遅延 → ネットワーク問題の可能性（Cloud Run外部要因）

---

## 🔄 ロールバック手順

Phase 1に問題があり、ロールバックが必要な場合:

```bash
# リビジョン00002（Phase 1実装前）に戻す
gcloud run services update-traffic video-analyzer-worker \
  --to-revisions=video-analyzer-worker-00002-8dz=100 \
  --region=us-central1

# 確認
gcloud run services describe video-analyzer-worker \
  --region=us-central1 \
  --format="value(status.traffic[0].revisionName,status.traffic[0].percent)"
```

---

## 📚 関連ドキュメント

- **実装詳細**: `docs/IMPLEMENTATION_PLAN_003_2025-11-09.md`
- **根本原因分析**: `docs/FFMPEG_INVESTIGATION_002_2025-11-09.md`
- **変更ファイル**: `cloud-run-worker/src/services/videoProcessor.ts`
- **メトリクス定義**: `monitoring/log-metrics-phase1.yaml`
- **アラート設定**: `monitoring/alert-progress-update-failure.yaml`

---

**作成者**: Claude Code
**最終更新**: 2025年11月9日
**バージョン**: 1.0
