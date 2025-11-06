import { NextResponse } from 'next/server';
import { list, del } from '@vercel/blob';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Vercel Cron Job: Cleanup old blobs
 *
 * Schedule: Daily at 3:00 AM UTC (12:00 PM JST)
 * Purpose: Delete blobs older than 24 hours to prevent storage quota exhaustion
 *
 * Security: Protected by CRON_SECRET environment variable
 */
export async function GET(request: Request) {
  const requestId = `cron_${Date.now()}`;
  console.log(`[${requestId}] Cron job started: cleanup-blobs`);

  try {
    // Verify cron secret for security
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

    // Get blob token
    const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
    if (!blobToken) {
      console.error(`[${requestId}] BLOB_READ_WRITE_TOKEN not configured`);
      return NextResponse.json(
        { error: 'Blob token not configured' },
        { status: 500 }
      );
    }

    // List all blobs
    console.log(`[${requestId}] Fetching blob list...`);
    const { blobs } = await list({ token: blobToken });

    // Filter blobs older than 24 hours
    const cutoffDate = new Date();
    cutoffDate.setHours(cutoffDate.getHours() - 24);

    const oldBlobs = blobs.filter(blob => {
      const uploadedAt = new Date(blob.uploadedAt);
      return uploadedAt < cutoffDate;
    });

    console.log(`[${requestId}] Found ${blobs.length} total blobs, ${oldBlobs.length} older than 24h`);

    // Delete old blobs
    const results = {
      total: blobs.length,
      checked: blobs.length,
      deleted: 0,
      failed: 0,
      errors: [] as string[],
    };

    for (const blob of oldBlobs) {
      try {
        await del(blob.url, { token: blobToken });
        results.deleted++;
        console.log(`[${requestId}]  Deleted: ${blob.pathname} (${blob.size} bytes, uploaded ${blob.uploadedAt})`);
      } catch (error) {
        results.failed++;
        const errorMsg = error instanceof Error ? error.message : String(error);
        results.errors.push(`${blob.pathname}: ${errorMsg}`);
        console.error(`[${requestId}] L Failed to delete ${blob.pathname}:`, error);
      }
    }

    // Log summary
    console.log(`[${requestId}] Cleanup complete:`, {
      total: results.total,
      deleted: results.deleted,
      failed: results.failed,
    });

    // Return results
    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      results,
    });

  } catch (error) {
    console.error(`[${requestId}] Cron job failed:`, error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    return NextResponse.json(
      {
        success: false,
        error: errorMessage,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
