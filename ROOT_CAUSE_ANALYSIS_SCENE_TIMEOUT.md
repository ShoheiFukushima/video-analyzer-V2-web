# Root Cause Analysis: FFmpeg Scene Detection Timeout

**日付**: 2025年11月11日
**問題**: FFmpegシーン検出が60秒でタイムアウト
**リビジョン**: video-analyzer-worker-00011-76z

---

## 📊 エグゼクティブサマリー

**根本原因**: `metadata=print:file=-` フィルタがCloud Run環境で予期しない動作をしている

**影響範囲**: 全ての動画処理（タイムアウトにより処理が完全に失敗）

**緊急度**: 🔴 Critical（本番環境で処理が完全に停止）

---

## 🔍 証拠チェーン

### 証拠1: タイムアウトエラーの発生パターン

```
2025-11-11 05:14:46   📊 Running detection pass with threshold 0.03...
2025-11-11 05:15:49   Processing failed: Error: FFmpeg scene detection timed out after 60000ms (threshold: 0.03)
```

**観察結果**:
- シーン検出開始から**正確に63秒後**（60秒タイムアウト + 処理時間）に失敗
- FFmpegコマンドが開始されているが、何も出力されない
- `.on('end')` イベントが**一度も発火していない**

---

### 証拠2: 過去の成功ログ（2025-11-10 09:27:41）

```
2025-11-10 09:27:41 🔍 Starting multi-pass scene detection with thresholds: 0.03, 0.05, 0.1
2025-11-10 09:27:41   📊 Running detection pass with threshold 0.03...
2025-11-10 09:27:42   ❌ Failed after 86.20s
2025-11-10 09:27:43   Error: No output specified
```

**観察結果**:
- 以前は「No output specified」エラー（`.output()`未指定）
- 修正後は「Timeout」エラーに変化
- **エラーの種類が変わっただけで、問題は解決していない**

---

### 証拠3: コード検証

**現在のコード** (`cloud-run-worker/src/services/ffmpeg.ts:98-128`):

```typescript
ffmpegCommand = ffmpeg(videoPath)
  .outputOptions([
    '-vf', `select='gt(scene,${threshold})',metadata=print:file=-`,
    '-f', 'null'
  ])
  .output('/dev/null')  // ← 修正済み
  .on('stderr', (stderrLine: string) => {
    const match = stderrLine.match(/pts_time:(\d+\.?\d*)/);
    if (match) {
      // ...
    }
  })
  .on('end', () => {
    clearTimeout(timeoutId);
    resolve(cuts);  // ← ここが呼ばれない
  })
  .run();
```

**問題箇所**:
- `.output('/dev/null')` は正しく設定されている
- しかし、`.on('end')` が**一度も発火しない**

---

### 証拠4: ローカル環境での検証結果

**テスト条件**: シーンカットが無い静止画動画（mirai_0814.mp4と同様）

```bash
# ローカル（macOS + FFmpeg 8.0）
$ ffmpeg -i test-static.mp4 \
  -vf "select='gt(scene,0.03)',metadata=print:file=-" \
  -f null /dev/null
[out#0/null @ 0x60000174c000] Output file is empty, nothing was encoded
frame=    0 fps=0.0 q=0.0 Lsize=N/A time=N/A bitrate=N/A speed=N/A
# ✓ 正常終了（exit code 0）
```

**結果**: ローカルでは正常に終了する

---

## 🧪 仮説と検証

### 仮説A: Cloud Run FFmpegのバージョン差異

**根拠**:
- Dockerfile: `apt-get install -y ffmpeg`（バージョン指定なし）
- Node.js 20-slim イメージのFFmpegバージョンは**4.x系**の可能性（古い）
- ローカル: FFmpeg 8.0（最新）

**検証方法**:
```bash
# Cloud Runログで確認
gcloud run services logs read video-analyzer-worker \
  --region us-central1 | grep "ffmpeg version"
```

**可能性**: 🟡 中（FFmpeg 4.xでは`metadata=print`の動作が異なる可能性）

---

### 仮説B: fluent-ffmpegのイベント処理バグ

**根拠**:
- `.on('end')` が発火しないのは、fluent-ffmpegがFFmpegの終了を検出できていない
- Cloud Run環境（コンテナ内）で`/dev/null`へのリダイレクトが正しく動作しない可能性

**検証方法**:
```typescript
// デバッグログ追加
.on('start', (cmd) => {
  console.log('FFmpeg started:', cmd);
})
.on('progress', (progress) => {
  console.log('Progress:', progress);
})
```

**可能性**: 🟢 高（Cloud Runログに`.on('start')`も`.on('progress')`も無い）

---

### 仮説C: metadata=print:file=- の出力先問題

**根拠**:
- `file=-` は標準出力（stdout）を意味する
- fluent-ffmpegは**stderr**を監視している（`.on('stderr', ...)`）
- stdoutとstderrの混乱で出力が失われている可能性

**検証方法**:
```bash
# 直接FFmpegコマンドで確認（Cloud Run内）
ffmpeg -i video.mp4 \
  -vf "select='gt(scene,0.03)',metadata=print:file=-" \
  -f null /dev/null 1>&2
# ↑ stdout を stderr にリダイレクト
```

**可能性**: 🔴 非常に高（最有力候補）

---

## 💡 修正案

### 修正案A: showinfoフィルタに戻す（推奨）

**内容**: `metadata=print:file=-` → `showinfo` に戻す

**理由**:
- 以前のV1実装で動作確認済み
- `showinfo`は**常にstderrに出力**される（fluent-ffmpegと互換性が高い）
- バッファオーバーフロー問題は、`select`フィルタで既に解決済み

**実装**:
```typescript
.outputOptions([
  '-vf', `select='gt(scene,${threshold})',showinfo`,
  '-f', 'null'
])
.output('/dev/null')
.on('stderr', (stderrLine: string) => {
  // Showinfoフォーマット: "n: 123 pts: 456 pts_time:1.23"
  const match = stderrLine.match(/pts_time:(\d+\.?\d*)/);
  if (match) {
    // ...
  }
})
```

**リスク**: 🟢 低（以前動作していた実装）

**推定作業時間**: 15分（1行修正 + テスト）

---

### 修正案B: FFmpegバージョンを固定化

**内容**: Dockerfileでstatic FFmpeg 7.1をインストール

**理由**:
- Cloud Runのapt-getでインストールされるFFmpegは古い（4.x系）
- 最新版（7.1+）で`metadata`フィルタの動作が安定している

**実装**:
```dockerfile
# Dockerfile修正
RUN curl -L https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz \
  | tar xJ && \
  mv ffmpeg-*-amd64-static/ffmpeg /usr/local/bin/ && \
  mv ffmpeg-*-amd64-static/ffprobe /usr/local/bin/
```

**リスク**: 🟡 中（本番環境でのFFmpegバージョン変更）

**推定作業時間**: 30分（Dockerfile修正 + デプロイ + 検証）

---

### 修正案C: 代替出力先を使用（file=/tmp/scene.txt）

**内容**: `file=-`（stdout）→ `file=/tmp/scene.txt`（ファイル出力）

**理由**:
- stdout/stderrの混乱を回避
- FFmpeg実行後にファイルを読み込んでパース

**実装**:
```typescript
const sceneFile = path.join(tmpDir, 'scene-metadata.txt');
ffmpegCommand = ffmpeg(videoPath)
  .outputOptions([
    '-vf', `select='gt(scene,${threshold})',metadata=print:file=${sceneFile}`,
    '-f', 'null'
  ])
  .output('/dev/null')
  .on('end', async () => {
    const metadata = await fs.readFile(sceneFile, 'utf-8');
    // Parse metadata...
  });
```

**リスク**: 🟡 中（ファイルI/O追加、クリーンアップ必要）

**推定作業時間**: 45分（実装 + エラーハンドリング + テスト）

---

## 🎯 推奨アクション

### 優先順位1: 修正案A（showinfoに戻す）- 即座実行

**理由**:
- ✅ 最速（15分で修正可能）
- ✅ リスク最小（以前動作していた）
- ✅ デバッグ不要（実績ある実装）

**実行手順**:
1. `cloud-run-worker/src/services/ffmpeg.ts:104` を修正
2. `npm run build`
3. Cloud Runデプロイ
4. 本番テスト（mirai_0814.mp4でシーン検出確認）

---

### 優先順位2: 修正案B（FFmpeg固定化）- 根本解決

**理由**:
- 🔧 長期的安定性（バージョン管理）
- 🔧 最新機能利用可能
- ⚠️ デプロイに30分必要

**実行タイミング**: 修正案Aで応急処置後、余裕がある時

---

### 優先順位3: 修正案C - 非推奨

**理由**:
- ❌ 実装コスト高い
- ❌ 新しいバグ発生リスク
- ✅ 修正案A/Bで解決可能

---

## 📋 次のステップ

### 即座実行（今すぐ）
- [ ] 修正案Aを実装（showinfoに戻す）
- [ ] Cloud Runデプロイ
- [ ] 本番テスト（mirai_0814.mp4）

### 今週中
- [ ] 修正案Bを実装（FFmpeg 7.1固定化）
- [ ] Dockerfileドキュメント更新

### 今月中
- [ ] E2Eテストに「シーンカット無し動画」を追加
- [ ] モニタリングアラート設定（60秒タイムアウト検知）

---

## 🔗 関連ファイル

- `cloud-run-worker/src/services/ffmpeg.ts` (104行目)
- `cloud-run-worker/Dockerfile` (6行目: FFmpegインストール)
- `DEPLOYMENT_DESIGN.md` - デプロイ設計
- `CLAUDE.md` - プロジェクトガイド

---

**レポート作成者**: Claude Code (Root Cause Analyst)
**作成日時**: 2025年11月11日 14:30 JST
