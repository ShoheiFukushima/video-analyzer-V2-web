#!/usr/bin/env tsx
/**
 * カスタムメトリクス送信スクリプト
 *
 * Vercel Blob容量などのカスタムメトリクスをCloud Monitoringに送信します。
 * 定期的に実行してメトリクスを収集・送信することで、
 * GCPダッシュボードで統合的に監視できます。
 *
 * 使用方法:
 *   npx tsx monitoring/custom-metrics.ts
 *
 * Cronジョブ設定例（1時間ごと）:
 *   0 * * * * cd /path/to/project && npx tsx monitoring/custom-metrics.ts >> /tmp/custom-metrics.log 2>&1
 *
 * 必要な環境変数:
 *   BLOB_READ_WRITE_TOKEN - Vercel Blob APIトークン
 *   GOOGLE_CLOUD_PROJECT - GCPプロジェクトID（デフォルト: video-analyzer-worker）
 */

import { list } from '@vercel/blob';
import https from 'https';

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'video-analyzer-worker';
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN || '';

interface MetricPoint {
  interval: {
    endTime: string;
  };
  value: {
    int64Value?: string;
    doubleValue?: number;
  };
}

interface TimeSeriesData {
  metric: {
    type: string;
    labels?: Record<string, string>;
  };
  resource: {
    type: string;
    labels: Record<string, string>;
  };
  metricKind: 'GAUGE' | 'DELTA' | 'CUMULATIVE';
  valueType: 'INT64' | 'DOUBLE' | 'BOOL';
  points: MetricPoint[];
}

/**
 * Cloud Monitoring APIにメトリクスを送信
 */
async function sendMetricToCloudMonitoring(timeSeries: TimeSeriesData): Promise<void> {
  // 注意: このサンプルではREST APIを直接呼び出していますが、
  // 本番環境では @google-cloud/monitoring ライブラリの使用を推奨します。
  //
  // インストール:
  //   npm install @google-cloud/monitoring
  //
  // 使用例:
  //   import { MetricServiceClient } from '@google-cloud/monitoring';
  //   const client = new MetricServiceClient();
  //   await client.createTimeSeries({
  //     name: `projects/${PROJECT_ID}`,
  //     timeSeries: [timeSeries],
  //   });

  console.log('📊 Metric送信:', JSON.stringify(timeSeries, null, 2));
  console.log('ℹ️  実際の送信には @google-cloud/monitoring ライブラリを使用してください');
}

/**
 * Vercel Blob容量を取得
 */
async function getVercelBlobUsage(): Promise<number> {
  if (!BLOB_TOKEN) {
    console.warn('⚠️  BLOB_READ_WRITE_TOKEN が設定されていません');
    return 0;
  }

  try {
    const { blobs } = await list({ token: BLOB_TOKEN });
    const totalSize = blobs.reduce((sum, blob) => sum + blob.size, 0);
    console.log(`✅ Vercel Blob使用量: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
    return totalSize;
  } catch (error) {
    console.error('❌ Vercel Blob容量取得エラー:', error);
    return 0;
  }
}

/**
 * Supabaseステータス数を取得
 */
async function getSupabaseJobStats(): Promise<{ total: number; completed: number; failed: number; processing: number }> {
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.warn('⚠️  Supabase環境変数が設定されていません');
    return { total: 0, completed: 0, failed: 0, processing: 0 };
  }

  try {
    // Supabase REST APIでジョブステータスを取得
    const response = await fetch(`${SUPABASE_URL}/rest/v1/video_jobs?select=status`, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Supabase API error: ${response.statusText}`);
    }

    const jobs = await response.json() as Array<{ status: string }>;

    const stats = {
      total: jobs.length,
      completed: jobs.filter(j => j.status === 'completed').length,
      failed: jobs.filter(j => j.status === 'failed').length,
      processing: jobs.filter(j => j.status === 'processing').length,
    };

    console.log('✅ Supabaseジョブ統計:', stats);
    return stats;
  } catch (error) {
    console.error('❌ Supabaseジョブ統計取得エラー:', error);
    return { total: 0, completed: 0, failed: 0, processing: 0 };
  }
}

/**
 * メイン処理
 */
async function main() {
  console.log('========================================');
  console.log('Custom Metrics Collection');
  console.log(`Time: ${new Date().toISOString()}`);
  console.log('========================================\n');

  const timestamp = new Date().toISOString();

  // 1. Vercel Blob容量メトリクス
  const blobUsage = await getVercelBlobUsage();
  const blobMetric: TimeSeriesData = {
    metric: {
      type: 'custom.googleapis.com/vercel_blob/storage_bytes',
      labels: {
        project: 'video-analyzer',
      },
    },
    resource: {
      type: 'global',
      labels: {
        project_id: PROJECT_ID,
      },
    },
    metricKind: 'GAUGE',
    valueType: 'INT64',
    points: [
      {
        interval: {
          endTime: timestamp,
        },
        value: {
          int64Value: blobUsage.toString(),
        },
      },
    ],
  };

  await sendMetricToCloudMonitoring(blobMetric);

  // 2. Supabaseジョブ統計メトリクス
  const jobStats = await getSupabaseJobStats();

  const jobMetrics = [
    {
      label: 'total',
      value: jobStats.total,
    },
    {
      label: 'completed',
      value: jobStats.completed,
    },
    {
      label: 'failed',
      value: jobStats.failed,
    },
    {
      label: 'processing',
      value: jobStats.processing,
    },
  ];

  for (const { label, value } of jobMetrics) {
    const metric: TimeSeriesData = {
      metric: {
        type: 'custom.googleapis.com/video_jobs/count',
        labels: {
          status: label,
        },
      },
      resource: {
        type: 'global',
        labels: {
          project_id: PROJECT_ID,
        },
      },
      metricKind: 'GAUGE',
      valueType: 'INT64',
      points: [
        {
          interval: {
            endTime: timestamp,
          },
          value: {
            int64Value: value.toString(),
          },
        },
      ],
    };

    await sendMetricToCloudMonitoring(metric);
  }

  console.log('\n✅ カスタムメトリクス収集完了');
}

// スクリプト実行
main().catch(error => {
  console.error('Custom metrics collection failed:', error);
  process.exit(1);
});
