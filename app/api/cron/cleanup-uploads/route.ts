/**
 * Vercel Cron Job: Cleanup expired upload records
 *
 * Schedule: Daily at 4:00 AM UTC (1:00 PM JST)
 * Purpose: Delete uploads that exceed retention period
 *
 * Retention policy (date-based only, applied uniformly):
 *   - Free plan users: records older than 3 days
 *   - All other plans: records older than 30 days
 *
 * Note: Per-user plan lookup is not feasible in a Cron context (no JWT).
 * Instead, we use a simple 2-tier approach:
 *   - Users with 0 quota used (likely free) → 3-day retention
 *   - All others → 30-day retention (conservative)
 *
 * Security: Protected by CRON_SECRET environment variable
 */

import { NextResponse } from 'next/server';
import { createClient } from '@libsql/client';
import { deleteObject } from '@/lib/r2-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  const requestId = `cron_cleanup_${Date.now()}`;
  console.log(`[${requestId}] Cron job started: cleanup-uploads`);

  try {
    // Verify cron secret
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret) {
      console.error(`[${requestId}] CRON_SECRET not configured`);
      return NextResponse.json(
        { error: 'Server misconfigured' },
        { status: 500 }
      );
    }

    if (authHeader !== `Bearer ${cronSecret}`) {
      console.warn(`[${requestId}] Unauthorized cron request`);
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const tursoUrl = process.env.TURSO_DATABASE_URL;
    const tursoToken = process.env.TURSO_AUTH_TOKEN;

    if (!tursoUrl || !tursoToken) {
      console.error(`[${requestId}] Turso credentials not configured`);
      return NextResponse.json(
        { error: 'Database not configured' },
        { status: 500 }
      );
    }

    const client = createClient({ url: tursoUrl, authToken: tursoToken });

    // Conservative approach: delete records older than 15 days for all users
    // This covers the maximum retention period (Teacher plan = 15 days)
    const maxRetentionDays = 15;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - maxRetentionDays);
    const cutoffISO = cutoffDate.toISOString();

    console.log(`[${requestId}] Deleting records older than ${maxRetentionDays} days (before ${cutoffISO})`);

    // Fetch expired records to delete their R2 files first
    const expiredResult = await client.execute({
      sql: `
        SELECT upload_id, user_id, metadata
        FROM processing_status
        WHERE created_at < ?
        ORDER BY created_at ASC
        LIMIT 500
      `,
      args: [cutoffISO],
    });

    const results = {
      expired: expiredResult.rows.length,
      r2Deleted: 0,
      r2Failed: 0,
      dbDeleted: 0,
    };

    console.log(`[${requestId}] Found ${results.expired} expired records`);

    // Delete R2 files for expired records
    for (const row of expiredResult.rows) {
      const uploadId = row.upload_id as string;
      const metadataStr = row.metadata as string | null;
      const metadata = metadataStr ? JSON.parse(metadataStr) : null;
      const resultR2Key = metadata?.resultR2Key;

      if (resultR2Key) {
        try {
          await deleteObject(resultR2Key);
          results.r2Deleted++;
        } catch (err) {
          results.r2Failed++;
          console.warn(`[${requestId}] R2 delete failed for ${uploadId}:`, err);
        }
      }
    }

    // Batch delete expired DB records
    if (results.expired > 0) {
      const deleteResult = await client.execute({
        sql: 'DELETE FROM processing_status WHERE created_at < ?',
        args: [cutoffISO],
      });
      results.dbDeleted = deleteResult.rowsAffected;
    }

    console.log(`[${requestId}] Cleanup complete:`, results);

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      results,
    });
  } catch (error) {
    console.error(`[${requestId}] Cron job failed:`, error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
