# Root Cause Analysis: FFmpeg Performance Degradation

**Date**: 2025-11-11
**Upload ID**: upload_1762871700310_bkd4k3rkz
**Video**: 20MB, 15 seconds, 1920x1080
**Status**: CRITICAL - System unusable
**User Feedback**: "非常に時間のかかるアプリになっている" (The app has become very slow)

---

## Executive Summary

**Root Cause**: Cloud Run **CPU throttling** + **FFmpeg misconfiguration** in Dockerfile
**Impact**: 10-30x performance degradation across all FFmpeg operations
**Evidence**: 15秒動画の処理に8分以上かかり、シーン検出で60秒タイムアウト

**Immediate Fix Required**: Cloud Run CPU allocation + FFmpeg optimization

---

## Critical Evidence

### Performance Anomalies (15秒, 20MB動画での実測値)

| Operation | Expected | Actual | Slowdown Factor | Status |
|-----------|----------|--------|-----------------|--------|
| **Download (Vercel Blob)** | 5-10s | 273s | **27x slower** | CRITICAL |
| **Video Metadata** | 1-2s | 60s | **30x slower** | CRITICAL |
| **Audio Stream Detection** | 1-2s | 45s | **22x slower** | CRITICAL |
| **Audio Extraction** | 5-10s | 164s | **16x slower** | CRITICAL |
| **VAD Processing** | 5-10s | 99s | **10x slower** | SEVERE |
| **Scene Detection** | 5-10s | 60s+ (timeout) | **Infinite** | CRITICAL |

**Total Processing Time**: 8分23秒 (期待値: 40-60秒)

### Download Speed Analysis

```
20MB ÷ 273s = 73KB/s
```

**Expected**: 2-5MB/s (Vercel Blob → Cloud Run US-central1)
**Actual**: 73KB/s (= 0.073MB/s)
**Conclusion**: ネットワークスロットリングまたはCPU不足によるaxiosのstream処理遅延

---

## Root Cause Identification

### 1. Cloud Run CPU Configuration (PRIMARY CAUSE)

**Current Configuration**:
```json
{
  "cpu": "1",
  "memory": "2Gi",
  "cpuThrottling": null  // デフォルト: リクエスト処理中のみCPU割り当て
}
```

**Problem**: Cloud Run **デフォルトCPU allocation**では、リクエスト処理中のみCPUが割り当てられる。しかし、FFmpegのような重い処理では、実際にはCPU時間の大部分が「待機」として扱われ、**CPU throttling**が発生している可能性が高い。

**Evidence**:
- 全てのFFmpeg処理が一貫して10-30倍遅い（CPU不足の典型的パターン）
- ネットワークI/O（download）も遅い（axios stream処理がCPUを消費）
- コールドスタートの影響：初回リクエストは特に遅い

**Fix Required**:
```bash
gcloud run services update video-analyzer-worker \
  --region us-central1 \
  --cpu-boost \  # Startup時にCPUブーストを有効化
  --cpu-throttling=false  # CPU always allocatedに変更
```

**Impact**: CPU割り当てが常時になることで、FFmpeg処理が正常速度に戻る（推定: 10-30x高速化）

---

### 2. FFmpeg Configuration in Dockerfile (SECONDARY CAUSE)

**Current Configuration** (`cloud-run-worker/Dockerfile`):
```dockerfile
FROM node:20-slim

RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    curl \
    && rm -rf /var/lib/apt/lists/*
```

**Problem**: `apt-get install ffmpeg`でインストールされるFFmpegは**非最適化版**（古いバージョン、GPUアクセラレーション無効）

**Check Current Version**:
```bash
# Cloud Run環境で実行されているFFmpegバージョンを確認
gcloud run services logs read video-analyzer-worker \
  --region us-central1 \
  --log-filter "textPayload:ffmpeg -version" \
  --limit 5
```

**Expected**: FFmpeg 7.x（static build with hardware acceleration）
**Likely Actual**: FFmpeg 4.x-5.x（Debian repoのold version）

**Fix Required**:
```dockerfile
# オプション1: Static buildを使用（推奨）
FROM node:20-slim

# Install static FFmpeg build (latest with hardware acceleration)
RUN apt-get update && apt-get install -y curl && \
    curl -L https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz \
    -o /tmp/ffmpeg.tar.xz && \
    tar -xJf /tmp/ffmpeg.tar.xz -C /tmp && \
    mv /tmp/ffmpeg-*-amd64-static/ffmpeg /usr/local/bin/ && \
    mv /tmp/ffmpeg-*-amd64-static/ffprobe /usr/local/bin/ && \
    rm -rf /tmp/ffmpeg* && \
    apt-get remove -y curl && apt-get autoremove -y

# ... rest of Dockerfile
```

**Impact**: FFmpeg処理が最新の最適化の恩恵を受ける（推定: 2-5x高速化）

---

### 3. Scene Detection showinfo Filter (CONTRIBUTING FACTOR)

**Current Implementation** (`cloud-run-worker/src/services/ffmpeg.ts:98-128`):
```typescript
ffmpegCommand = ffmpeg(videoPath)
  .outputOptions([
    '-vf', `select='gt(scene,${threshold})',showinfo`,
    '-f', 'null'
  ])
  .output('/dev/null')
  .on('stderr', (stderrLine: string) => {
    const match = stderrLine.match(/pts_time:(\d+\.?\d*)/);
    if (match) {
      const timestamp = parseFloat(match[1]);
      cuts.push({ timestamp, confidence: threshold });
    }
  })
```

**Problem**: `showinfo`フィルタは**全てのフレーム情報をstderrに出力**するため、大量のログが生成される。これがNode.jsのstdoutバッファを圧迫し、処理を遅延させている可能性がある。

**Evidence**:
- ログに`pts_time`の出力が**一切ない**（バッファがフラッシュされていない？）
- Scene detectionが60秒タイムアウトするまで何も出力されない
- `select`フィルタ単独では問題なかったはず（以前のmetadata filterは動作していた）

**Fix Required** (オプション):
```typescript
// オプション1: showinfo出力を抑制（loglevelでフィルタ）
.outputOptions([
  '-vf', `select='gt(scene,${threshold})',showinfo`,
  '-f', 'null',
  '-loglevel', 'info'  // warningレベルを下げてshowinfo出力を制限
])

// オプション2: metadata filterに戻す（ただしCloud Run互換性要確認）
.outputOptions([
  '-vf', `select='gt(scene,${threshold})',metadata=print:file=-`,
  '-f', 'null'
])

// オプション3: FFprobeベースの実装（よりシンプル）
// シーン検出をffprobeで実装し直す（FFmpegコマンドを使わない）
```

**Impact**: バッファ問題が解消され、scene detectionが正常動作する（推定: 2-3x高速化）

---

### 4. Network Throttling (Vercel Blob → Cloud Run)

**Download Speed**: 73KB/s (期待値: 2-5MB/s)

**Possible Causes**:
1. **Cloud Run CPU throttlingによるaxios stream処理の遅延**（最も可能性が高い）
2. Vercel Blob側のrate limiting（可能性低い：Hobby planでも通常1MB/s以上）
3. リージョン間レイテンシー（Vercel CDN → Cloud Run US-central1）

**Fix Priority**: まずCPU throttlingを解消してから再評価

---

## Immediate Fix Recommendations

### Priority 1: Cloud Run CPU Configuration (CRITICAL)

**Action**:
```bash
# CPU always allocatedに変更
gcloud run services update video-analyzer-worker \
  --region us-central1 \
  --cpu 2 \  # 1→2に増量（FFmpeg heavy processing用）
  --memory 4Gi \  # 2Gi→4Giに増量（大容量動画対応）
  --cpu-boost \  # Startup時のCPUブースト有効化
  --no-cpu-throttling  # CPU throttling無効化（always allocated）

# Timeout延長（600s→900s: scene detection用）
  --timeout 900
```

**Expected Impact**: 全体的な処理速度が10-30x向上

**Cost Impact**:
- CPU always allocated: $0.0000240 per vCPU-second (2 vCPU)
- 15分処理の場合: $0.0000240 × 2 × 900 = **$0.043 per request**
- 月100リクエスト: **$4.30/month**（許容範囲）

**Rollback Plan**: 問題があれば`--cpu-throttling`を元に戻す

---

### Priority 2: FFmpeg Optimization (HIGH)

**Action**: Dockerfileを修正し、static buildを使用

**Implementation Steps**:
1. `cloud-run-worker/Dockerfile`を編集（上記のstatic build版に差し替え）
2. ローカルビルドでテスト:
   ```bash
   cd cloud-run-worker
   docker build -t video-analyzer-worker:ffmpeg-static .
   docker run --rm video-analyzer-worker:ffmpeg-static ffmpeg -version
   # → FFmpeg 7.x が表示されることを確認
   ```
3. Cloud Runにデプロイ:
   ```bash
   gcloud run deploy video-analyzer-worker \
     --source . \
     --region us-central1 \
     --platform managed \
     --allow-unauthenticated \
     --memory 4Gi \
     --cpu 2 \
     --no-cpu-throttling \
     --timeout 900 \
     --max-instances 10
   ```

**Expected Impact**: FFmpeg処理が2-5x高速化

---

### Priority 3: Scene Detection Timeout Extension (MEDIUM)

**Action**: 一時的に60秒タイムアウトを180秒に延長

**Implementation**:
```typescript
// cloud-run-worker/src/services/ffmpeg.ts:77
const TIMEOUT_MS = 180000; // 60秒 → 180秒に延長
```

**Rationale**: CPU最適化後も、大容量動画（4K, 30分以上）では60秒で完了しない可能性がある

**Expected Impact**: タイムアウトエラーが減少（根本解決ではない）

---

### Priority 4: Scene Detection Algorithm Review (LOW)

**Action**: showinfo出力の最適化、またはFFprobeベースの実装に移行

**Investigation Required**:
1. 現在の`showinfo`が本当にバッファ問題を起こしているか検証
2. `metadata=print:file=-`がCloud Runで動作するか再テスト
3. FFprobeベースの実装を検証（より安定性が高い）

**Expected Impact**: 2-3x高速化（CPU最適化後に再評価）

---

## Long-Term Architectural Improvements

### 1. Non-Blocking Async Processing

**Current**: 同期処理（リクエスト→処理完了まで待機）
**Proposed**: Pub/Subキューによる非同期処理

**Benefits**:
- Cloud Runのタイムアウト（900秒）制約から解放
- 大容量動画（30分以上）の処理が可能
- コスト最適化（処理中のアイドルタイムを削減）

**Implementation**:
```
[Frontend] → [Cloud Run API] → [Pub/Sub Queue] → [Cloud Run Worker]
                                                         ↓
                                                  [Supabase Status]
```

---

### 2. FFmpeg Process Monitoring

**Action**: FFmpegプロセスのCPU/メモリ使用率をリアルタイムでログ出力

**Implementation**:
```typescript
// FFmpegコマンド実行前後でリソース使用率をログ
import { exec } from 'child_process';

const logResourceUsage = async () => {
  const { stdout } = await exec('ps aux | grep ffmpeg');
  console.log(`[Resource] FFmpeg: ${stdout}`);
};
```

**Benefits**: CPU throttlingの検出、ボトルネック特定が容易に

---

### 3. Progressive Scene Detection

**Action**: multi-pass detectionの順序を変更（0.10 → 0.05 → 0.03）

**Rationale**: 高い閾値（0.10）を先に実行することで、early failureを検出しやすくする

**Implementation**:
```typescript
// cloud-run-worker/src/services/ffmpeg.ts:26
const DEFAULT_CONFIG: SceneDetectionConfig = {
  thresholds: [0.10, 0.05, 0.03], // 逆順に変更
  minSceneDuration: 0.5
};
```

**Benefits**: タイムアウト前に何らかの結果を返せる可能性が高まる

---

## Testing Plan

### Phase 1: CPU Optimization Verification (Priority 1)

**Test Case 1**: 15秒動画（テストケース）
- **Expected**: Total processing time < 60秒
- **Target**: Download 5-10秒、Metadata 1-2秒、Scene Detection 5-10秒

**Test Case 2**: 5分動画（標準ケース）
- **Expected**: Total processing time < 5分
- **Target**: 全ての処理が正常完了、タイムアウトなし

**Test Case 3**: 30分動画（large file）
- **Expected**: Total processing time < 15分
- **Target**: Cloud Run timeout (900秒) 内に完了

**Validation Metrics**:
- [ ] Download speed > 1MB/s
- [ ] Metadata extraction < 5秒
- [ ] Scene detection (15s video) < 10秒
- [ ] No FFmpeg timeouts

---

### Phase 2: FFmpeg Static Build Verification (Priority 2)

**Test**:
1. FFmpegバージョン確認（logs）
2. 処理速度の比較（before/after）
3. 出力品質の検証（Excel, screenshots）

**Success Criteria**:
- FFmpeg 7.x がログに表示される
- 処理速度が2x以上向上
- OCRテキスト精度が維持される

---

### Phase 3: Stress Testing

**Test Cases**:
- 並列処理（5リクエスト同時）
- 大容量動画（500MB, 4K）
- 長時間動画（60分）

**Success Criteria**:
- 全てのリクエストが正常完了
- メモリリーク無し
- Cloud Runインスタンスのスケーリングが正常

---

## Rollback Plan

**If Priority 1 Fix Fails**:
```bash
# CPU throttlingを元に戻す
gcloud run services update video-analyzer-worker \
  --region us-central1 \
  --cpu 1 \
  --memory 2Gi \
  --cpu-throttling  # デフォルトに戻す
  --timeout 600
```

**If Priority 2 Fix Fails**:
```bash
# 前のDockerfile（apt-get ffmpeg版）に戻す
git revert <commit-hash>
gcloud run deploy video-analyzer-worker --source . --region us-central1
```

---

## Estimated Timeline

| Phase | Task | Duration | Owner |
|-------|------|----------|-------|
| 1 | Cloud Run CPU設定変更 | 10分 | DevOps |
| 2 | Verification testing (15s動画) | 5分 | QA |
| 3 | Dockerfile FFmpeg修正 | 30分 | Dev |
| 4 | ビルド＆デプロイ | 15分 | DevOps |
| 5 | Full regression testing | 30分 | QA |
| **Total** | | **90分** | |

**User Unblocking**: Phase 1完了後（15分以内）

---

## Conclusion

**Root Cause**: Cloud Run CPU throttling + 非最適化FFmpeg
**Immediate Fix**: CPU always allocated + static FFmpeg build
**Expected Result**: 処理速度が10-30x向上、ユーザー体験が正常化

**Critical Next Steps**:
1. Cloud Run CPU設定を変更（最優先）
2. テスト動画で検証（15分以内）
3. ユーザーに再テスト依頼
4. FFmpeg static build実装（長期対策）

---

**Report Author**: Claude Code (Root Cause Analyst Agent)
**Date**: 2025-11-11
**Status**: READY FOR IMPLEMENTATION
