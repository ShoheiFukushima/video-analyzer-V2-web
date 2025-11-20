#!/usr/bin/env tsx
/**
 * 統合ヘルスチェックスクリプト
 *
 * Cloud RunとVercelの稼働状態を定期的に監視し、
 * 異常があれば通知を送信します。
 *
 * 使用方法:
 *   npx tsx monitoring/health-check.ts
 *
 * Cronジョブ設定例（5分ごと）:
 *   (crontab -e で以下を追加)
 *   [asterisk]/5 * * * * cd /path/to/project && npx tsx monitoring/health-check.ts >> /tmp/health-check.log 2>&1
 */

// 環境変数から設定を読み込み
const CLOUD_RUN_URL = process.env.CLOUD_RUN_URL || 'https://video-analyzer-worker-820467345033.us-central1.run.app';
const VERCEL_URL = process.env.VERCEL_URL || 'https://video-analyzer-v2-web.vercel.app';
const WORKER_SECRET = process.env.WORKER_SECRET || '';
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || '';
const TIMEOUT_MS = 10000; // 10秒

interface HealthCheckResult {
  service: string;
  url: string;
  status: 'healthy' | 'degraded' | 'down';
  statusCode?: number;
  responseTime: number;
  message: string;
  timestamp: string;
}

/**
 * HTTPSリクエストを実行（fetch APIを使用）
 */
async function makeRequest(url: string): Promise<{ statusCode: number; responseTime: number; body: string }> {
  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(url, {
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const body = await response.text();
    const responseTime = Date.now() - startTime;

    return {
      statusCode: response.status,
      responseTime,
      body,
    };
  } catch (error: any) {
    const responseTime = Date.now() - startTime;
    throw { error, responseTime };
  }
}

/**
 * Cloud Runヘルスチェック
 */
async function checkCloudRun(): Promise<HealthCheckResult> {
  const url = `${CLOUD_RUN_URL}/health`;
  const timestamp = new Date().toISOString();

  try {
    const { statusCode, responseTime, body } = await makeRequest(url);

    if (statusCode === 200) {
      return {
        service: 'Cloud Run Worker',
        url,
        status: 'healthy',
        statusCode,
        responseTime,
        message: `OK - Response time: ${responseTime}ms`,
        timestamp,
      };
    } else if (statusCode >= 500) {
      return {
        service: 'Cloud Run Worker',
        url,
        status: 'down',
        statusCode,
        responseTime,
        message: `Server Error (${statusCode}) - Response time: ${responseTime}ms`,
        timestamp,
      };
    } else {
      return {
        service: 'Cloud Run Worker',
        url,
        status: 'degraded',
        statusCode,
        responseTime,
        message: `Unexpected status (${statusCode}) - Response time: ${responseTime}ms`,
        timestamp,
      };
    }
  } catch (err: any) {
    return {
      service: 'Cloud Run Worker',
      url,
      status: 'down',
      responseTime: err.responseTime || TIMEOUT_MS,
      message: `Error: ${err.error?.message || 'Unknown error'}`,
      timestamp,
    };
  }
}

/**
 * Vercelヘルスチェック
 */
async function checkVercel(): Promise<HealthCheckResult> {
  const url = `${VERCEL_URL}/api/health`;
  const timestamp = new Date().toISOString();

  try {
    const { statusCode, responseTime, body } = await makeRequest(url);

    if (statusCode === 200) {
      return {
        service: 'Vercel Frontend',
        url,
        status: 'healthy',
        statusCode,
        responseTime,
        message: `OK - Response time: ${responseTime}ms`,
        timestamp,
      };
    } else if (statusCode >= 500) {
      return {
        service: 'Vercel Frontend',
        url,
        status: 'down',
        statusCode,
        responseTime,
        message: `Server Error (${statusCode}) - Response time: ${responseTime}ms`,
        timestamp,
      };
    } else {
      return {
        service: 'Vercel Frontend',
        url,
        status: 'degraded',
        statusCode,
        responseTime,
        message: `Unexpected status (${statusCode}) - Response time: ${responseTime}ms`,
        timestamp,
      };
    }
  } catch (err: any) {
    return {
      service: 'Vercel Frontend',
      url,
      status: 'down',
      responseTime: err.responseTime || TIMEOUT_MS,
      message: `Error: ${err.error?.message || 'Unknown error'}`,
      timestamp,
    };
  }
}

/**
 * Slack通知を送信
 */
async function sendSlackNotification(results: HealthCheckResult[]): Promise<void> {
  if (!SLACK_WEBHOOK_URL) {
    console.log('ℹ️  SLACK_WEBHOOK_URL not configured. Skipping notification.');
    return;
  }

  const failedChecks = results.filter(r => r.status === 'down');
  const degradedChecks = results.filter(r => r.status === 'degraded');

  if (failedChecks.length === 0 && degradedChecks.length === 0) {
    return; // 正常な場合は通知しない
  }

  const color = failedChecks.length > 0 ? '#FF0000' : '#FFA500';
  const title = failedChecks.length > 0 ? '🚨 サービスダウン検知' : '⚠️ サービス劣化検知';

  const fields = results.map(r => ({
    title: r.service,
    value: `Status: ${r.status}\n${r.message}`,
    short: true,
  }));

  const payload = {
    attachments: [
      {
        color,
        title,
        fields,
        footer: 'Video Analyzer Health Check',
        ts: Math.floor(Date.now() / 1000),
      },
    ],
  };

  try {
    const response = await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error('Failed to send Slack notification:', response.statusText);
    }
  } catch (error) {
    console.error('Error sending Slack notification:', error);
  }
}

/**
 * メイン処理
 */
async function main() {
  console.log('========================================');
  console.log('Video Analyzer - Health Check');
  console.log(`Time: ${new Date().toISOString()}`);
  console.log('========================================\n');

  // 並列でヘルスチェック実行
  const [cloudRunResult, vercelResult] = await Promise.all([
    checkCloudRun(),
    checkVercel(),
  ]);

  const results = [cloudRunResult, vercelResult];

  // 結果を表示
  results.forEach(result => {
    const statusEmoji = result.status === 'healthy' ? '✅' : result.status === 'degraded' ? '⚠️' : '❌';
    console.log(`${statusEmoji} ${result.service}`);
    console.log(`   URL: ${result.url}`);
    console.log(`   Status: ${result.status}`);
    console.log(`   ${result.message}`);
    console.log('');
  });

  // 通知送信
  await sendSlackNotification(results);

  // 終了コード設定（異常があれば1を返す）
  const hasFailure = results.some(r => r.status === 'down' || r.status === 'degraded');
  process.exit(hasFailure ? 1 : 0);
}

// スクリプト実行
main().catch(error => {
  console.error('Health check failed:', error);
  process.exit(1);
});
