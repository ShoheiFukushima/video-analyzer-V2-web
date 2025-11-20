# Phase 1 ユーザーテストガイド

**日時**: 2025年11月9日
**テスト対象**: ダウンロード進捗の細かい更新（10% → 12% → 14% → 16% → 18% → 20%）
**リビジョン**: video-analyzer-worker-00003-pzx

---

## 🎯 テスト目的

Phase 1実装後、動画ダウンロード中の進捗が滑らかに更新されることを確認する。

### Before（リビジョン 00002まで）
```
00:00 - "Downloading... 10%" ← 5分間変化なし（フリーズしたように見える）
05:00 - "Downloading... 20%" ← 突然ジャンプ
```

### After（リビジョン 00003）期待される動作
```
00:00 - "Downloading... 10%" ← ダウンロード開始
01:00 - "Downloading... 12%" ← 2%刻みで滑らかに更新
02:00 - "Downloading... 14%"
03:00 - "Downloading... 16%"
04:00 - "Downloading... 18%"
05:00 - "Downloading... 20%" ← 完了
```

---

## 📝 テスト手順

### ステップ1: フロントエンドにアクセス

**本番URL**:
- プライマリ: `https://video-analyzer-v2.vercel.app`（推定）
- または最新デプロイ: Vercel Dashboardで確認

**確認事項**:
- ✅ ページが正常に表示される
- ✅ ログインできる（Clerk認証）

---

### ステップ2: テスト動画を準備

**推奨サイズ**: 100MB - 200MB

**理由**:
- 小さすぎる（10MB）: 進捗更新が1-2回しか発生しない
- 大きすぎる（500MB）: テストに時間がかかる
- 100-200MB: 3-4回の進捗更新、約1-2分で完了

**動画形式**: MP4, MOV, AVI, MKV, WebM（いずれでも可）

**サンプル動画がない場合**:
```bash
# 100MBのダミー動画を生成（ffmpegが必要）
ffmpeg -f lavfi -i testsrc=duration=60:size=1280x720:rate=30 \
  -vcodec libx264 -crf 18 \
  test_100mb.mp4
```

---

### ステップ3: 動画をアップロード

1. **ファイル選択**
   - 「Choose File」または「ファイルを選択」ボタンをクリック
   - 準備した動画を選択

2. **アップロード開始**
   - 「Upload」または「アップロード」ボタンをクリック
   - Blob Storageへのアップロードが開始される

3. **処理開始確認**
   - 進捗バーまたは進捗表示が出現
   - 「Processing...」または「処理中...」と表示される

---

### ステップ4: 進捗を観察

**注目ポイント**:

#### ✅ 期待される動作
- 進捗が「10%」から開始
- **約15-30秒ごとに2%ずつ増加**（100MB動画の場合）
- 10% → 12% → 14% → 16% → 18% → 20%
- 進捗が**滑らか**に動く（停止しているように見えない）

#### ❌ 問題がある動作
- 進捗が10%から1分以上動かない
- 進捗が10%から突然20%にジャンプ
- 進捗が逆行する（例: 16% → 14%）
- 進捗が20%を超える

---

### ステップ5: 結果を確認

**処理完了の確認**:
- ✅ 「Download Result」または「結果をダウンロード」ボタンが表示される
- ✅ Excelファイルがダウンロードできる
- ✅ Excelファイルに動画分析結果が含まれている

---

## 📊 テスト結果の記録

### 記録すべき情報

#### 1. 動画情報
```
ファイル名: _____________________
ファイルサイズ: _____ MB
形式: _____
```

#### 2. 進捗の推移（タイムスタンプ付き）
```
時刻        | 進捗
-----------|------
__:__:__   | 10%
__:__:__   | 12%
__:__:__   | 14%
__:__:__   | 16%
__:__:__   | 18%
__:__:__   | 20%
```

#### 3. 観察された動作
```
□ 進捗が滑らかに動いた
□ 進捗が停止した（___%で__秒間）
□ 進捗がジャンプした（___% → ___%）
□ 進捗が逆行した（___% → ___%）
□ エラーが発生した（エラーメッセージ: ____________）
□ その他: ________________________________
```

#### 4. 総処理時間
```
開始時刻: __:__:__
完了時刻: __:__:__
総時間: __分__秒
```

---

## 🔍 バックエンド監視（技術者向け）

テスト実行中、以下のコマンドでバックエンドを監視できます。

### 1. リアルタイムログ監視
```bash
gcloud logging tail 'resource.type="cloud_run_revision" resource.labels.service_name="video-analyzer-worker"'
```

**期待されるログ**:
```
[upload_xxx] Starting video processing for user user_xxx
[upload_xxx] ⏱️  [Download Video] Starting...
[downloadFile] Starting download from: https://...
[downloadFile] Response received, content-length: 104857600
[downloadFile] Progress: 10.0% (10.0MB / 100.0MB)
[upload_xxx] Progress update: 12% (downloading)
[downloadFile] Progress: 20.0% (20.0MB / 100.0MB)
[upload_xxx] Progress update: 14% (downloading)
...
[downloadFile] Download complete: 100.0MB
[upload_xxx] ✅ [Download Video] Completed in 67.5s
```

---

### 2. Supabase進捗確認

**Supabase Dashboard → SQL Editor**:
```sql
SELECT
  upload_id,
  progress,
  stage,
  updated_at,
  extract(epoch from (updated_at - lag(updated_at) OVER (PARTITION BY upload_id ORDER BY updated_at))) as seconds_since_last_update
FROM processing_status
WHERE created_at > now() - interval '10 minutes'
ORDER BY upload_id, updated_at ASC;
```

**期待される結果**:
| upload_id | progress | stage | updated_at | seconds_since_last_update |
|-----------|----------|-------|------------|---------------------------|
| upload_xxx | 10 | downloading | 2025-11-09 14:00:00 | NULL |
| upload_xxx | 12 | downloading | 2025-11-09 14:00:15 | 15 |
| upload_xxx | 14 | downloading | 2025-11-09 14:00:30 | 15 |
| upload_xxx | 16 | downloading | 2025-11-09 14:00:45 | 15 |
| upload_xxx | 18 | downloading | 2025-11-09 14:01:00 | 15 |
| upload_xxx | 20 | downloading | 2025-11-09 14:01:15 | 15 |

---

## ✅ 成功基準

Phase 1のテストが成功と判断する基準：

### 必須条件
- [x] 進捗が10%から20%まで段階的に更新される
- [x] 進捗の更新間隔が均等（数十秒ごと）
- [x] 処理が正常に完了する
- [x] Excelファイルが正しくダウンロードできる

### 望ましい条件
- [x] 進捗更新失敗ログが0回
- [x] ダウンロード時間がベースライン（67秒@100MB）の±5%以内
- [x] ユーザーが「処理が進んでいる」と認識できる

---

## 🚨 問題が発生した場合

### 問題1: 進捗が10%から動かない
**対処**:
1. ブラウザのコンソールでエラー確認（F12 → Console）
2. Cloud Runログでエラー確認
3. リビジョンが00003であることを確認

### 問題2: 処理が失敗する
**対処**:
1. エラーメッセージをスクリーンショット
2. upload_idをメモ
3. Cloud Runログで該当upload_idを検索

### 問題3: 進捗が不正確（逆行、ジャンプ）
**対処**:
1. 現象をスクリーンショット
2. Supabaseで進捗履歴を確認
3. upload_idをメモして報告

---

## 📞 テスト後のフィードバック

テスト完了後、以下を報告してください：

1. **✅ テスト結果**: 成功 / 失敗 / 部分的成功
2. **📊 記録した情報**: 進捗推移、処理時間
3. **📸 スクリーンショット**: 進捗表示の様子（可能であれば）
4. **💬 ユーザー体験**:
   - 以前より分かりやすくなったか？
   - 「フリーズした」と感じなかったか？
   - 改善点はあるか？

---

**テスト準備完了！**
フロントエンドにアクセスして動画をアップロードしてください。
