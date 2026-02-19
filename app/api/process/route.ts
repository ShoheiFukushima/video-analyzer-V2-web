import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { auth } from "@clerk/nextjs/server";
import { isValidR2Key, deleteObject } from "@/lib/r2-client";
import { getRetentionConfig } from "@/lib/quota";
import { createClient } from "@libsql/client";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Call Cloud Run worker with automatic failover to backup regions.
 * Tries primary URL first, then falls back to other regions on failure.
 */
async function callCloudRunWithFailover(
  primaryUrl: string,
  fallbackUrls: string[],
  payload: object,
  workerSecret: string,
  uploadId: string
): Promise<{ usedUrl: string; failedUrls: string[] }> {
  const allUrls = [primaryUrl, ...fallbackUrls];
  const failedUrls: string[] = [];

  for (let i = 0; i < allUrls.length; i++) {
    const url = allUrls[i];
    const isPrimary = i === 0;

    try {
      console.log(`[${uploadId}] ${isPrimary ? 'Primary' : 'Fallback'} attempt: ${url}`);

      const response = await fetch(`${url}/process`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${workerSecret}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(25000),
      });

      if (response.ok || response.status === 202) {
        if (!isPrimary) {
          console.log(`[${uploadId}] Failover successful: ${url} (failed: ${failedUrls.join(', ')})`);
        }
        return { usedUrl: url, failedUrls };
      }

      const status = response.status;
      console.warn(`[${uploadId}] ${url} returned ${status}, trying next...`);
      failedUrls.push(`${url}:${status}`);

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`[${uploadId}] ${url} failed: ${errorMsg}, trying next...`);
      failedUrls.push(`${url}:${errorMsg}`);
    }
  }

  throw new Error(`All Cloud Run regions failed: ${failedUrls.join(', ')}`);
}

/**
 * Run retention cleanup in the background.
 * Deletes oldest uploads when user exceeds quota. Failures are logged but not propagated.
 */
async function runRetentionCleanup(
  uploadId: string,
  userId: string,
  tursoUrl: string,
  tursoToken: string
): Promise<void> {
  const retention = getRetentionConfig('free');
  const dbClient = createClient({ url: tursoUrl, authToken: tursoToken });

  const countResult = await dbClient.execute({
    sql: 'SELECT COUNT(*) as cnt FROM processing_status WHERE user_id = ?',
    args: [userId],
  });
  const currentCount = (countResult.rows[0]?.cnt as number) || 0;

  if (currentCount >= retention.maxItems) {
    const deleteCount = currentCount - retention.maxItems + 1;
    const oldestResult = await dbClient.execute({
      sql: `
        SELECT upload_id, metadata
        FROM processing_status
        WHERE user_id = ?
        ORDER BY created_at ASC
        LIMIT ?
      `,
      args: [userId, deleteCount],
    });

    for (const row of oldestResult.rows) {
      const oldUploadId = row.upload_id as string;
      const metadataStr = row.metadata as string | null;
      const metadata = metadataStr ? JSON.parse(metadataStr) : null;
      const oldR2Key = metadata?.resultR2Key;

      if (oldR2Key) {
        try {
          await deleteObject(oldR2Key);
        } catch {
          // R2 file may already be gone
        }
      }

      await dbClient.execute({
        sql: 'DELETE FROM processing_status WHERE upload_id = ? AND user_id = ?',
        args: [oldUploadId, userId],
      });
      console.log(`[${uploadId}] Auto-deleted oldest upload ${oldUploadId}`);
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    // --- Phase 1: Authentication ---
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized", message: "You must be logged in to process videos" },
        { status: 401 }
      );
    }

    // --- Phase 2: Validate request body ---
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid request", message: "Request body must be valid JSON" },
        { status: 400 }
      );
    }

    const { uploadId, r2Key, fileName, dataConsent, detectionMode } = body;

    if (!uploadId || !r2Key) {
      return NextResponse.json(
        {
          error: "Invalid request",
          message: "Missing required fields: uploadId, r2Key",
        },
        { status: 400 }
      );
    }

    const validModes = ['standard', 'enhanced', 'reverse_engineer'];
    const mode = validModes.includes(detectionMode) ? detectionMode : 'reverse_engineer';

    if (!isValidR2Key(r2Key)) {
      return NextResponse.json(
        { error: "Invalid request", message: "Invalid R2 key format" },
        { status: 400 }
      );
    }

    if (!r2Key.includes(`/${userId}/`)) {
      console.warn(`[${uploadId}] User ${userId} attempted to use r2Key: ${r2Key}`);
      return NextResponse.json(
        { error: "Forbidden", message: "You do not have permission to process this file" },
        { status: 403 }
      );
    }

    // --- Phase 3: Validate server configuration ---
    const workerSecret = process.env.WORKER_SECRET?.trim();
    const geoRoutedUrl = request.headers.get('x-target-cloud-run');
    const fallbackUrlsHeader = request.headers.get('x-fallback-cloud-run');
    const geoCountry = request.headers.get('x-geo-country');
    const geoRegion = request.headers.get('x-geo-region');

    const primaryCloudRunUrl = process.env.NODE_ENV === 'development'
      ? process.env.CLOUD_RUN_URL?.trim() || 'http://localhost:8080'
      : geoRoutedUrl || process.env.CLOUD_RUN_URL?.trim();

    const fallbackUrls = fallbackUrlsHeader
      ? fallbackUrlsHeader.split(',').filter(Boolean)
      : [];

    if (!primaryCloudRunUrl || !workerSecret) {
      console.error("Missing environment variables: CLOUD_RUN_URL or WORKER_SECRET");
      return NextResponse.json(
        {
          error: "Server configuration error",
          message: "Video processing service is not properly configured",
        },
        { status: 500 }
      );
    }

    // --- Phase 4: Initialize status in Turso (synchronous, must succeed) ---
    const tursoUrl = process.env.TURSO_DATABASE_URL;
    const tursoToken = process.env.TURSO_AUTH_TOKEN;

    if (!tursoUrl || !tursoToken) {
      console.error("Missing Turso environment variables");
      return NextResponse.json(
        {
          error: "Server configuration error",
          message: "Database is not properly configured",
        },
        { status: 500 }
      );
    }

    try {
      const dbClient = createClient({ url: tursoUrl, authToken: tursoToken });
      await dbClient.execute({
        sql: `INSERT INTO processing_status (upload_id, user_id, status, progress, current_step, created_at, updated_at, metadata)
              VALUES (?, ?, 'processing', 0, 'Initiating...', datetime('now'), datetime('now'), ?)
              ON CONFLICT(upload_id) DO UPDATE SET
                status = 'processing',
                progress = 0,
                current_step = 'Initiating...',
                error_message = NULL,
                updated_at = datetime('now')`,
        args: [uploadId, userId, JSON.stringify({ fileName, detectionMode: mode })],
      });
    } catch (initError) {
      console.error(`[${uploadId}] Failed to initialize status in Turso:`, initError);
      return NextResponse.json(
        {
          error: "Internal server error",
          message: "Failed to initialize processing status. Please try again.",
        },
        { status: 500 }
      );
    }

    // --- Phase 5: Return response immediately (fire-and-forget) ---
    // Log routing info
    if (geoCountry) {
      console.log(`[${uploadId}] Geo-routing: country=${geoCountry}, region=${geoRegion}`);
    }
    console.log(`[${uploadId}] Primary URL: ${primaryCloudRunUrl}`);
    if (fallbackUrls.length > 0) {
      console.log(`[${uploadId}] Fallback URLs: ${fallbackUrls.join(', ')}`);
    }
    console.log(`[${uploadId}] Detection mode: ${mode}`);

    const payload = {
      uploadId,
      r2Key,
      fileName,
      userId,
      dataConsent: dataConsent || false,
      detectionMode: mode,
    };

    // Background: Cloud Run call (kept alive via waitUntil)
    // waitUntil ensures Vercel doesn't kill the function before this completes
    waitUntil(
      callCloudRunWithFailover(primaryCloudRunUrl, fallbackUrls, payload, workerSecret, uploadId)
        .then(({ usedUrl }) => {
          console.log(`[${uploadId}] Worker accepted request from ${usedUrl}`);
        })
        .catch(async (error) => {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          console.error(`[${uploadId}] Background Cloud Run call failed:`, errorMsg);
          try {
            const dbClient = createClient({ url: tursoUrl, authToken: tursoToken });
            await dbClient.execute({
              sql: `UPDATE processing_status
                    SET status = 'error', error_message = ?, updated_at = datetime('now')
                    WHERE upload_id = ?`,
              args: [errorMsg, uploadId],
            });
          } catch (dbError) {
            console.error(`[${uploadId}] Failed to update error status in Turso:`, dbError);
          }
        })
    );

    // Background: Retention cleanup (kept alive via waitUntil)
    waitUntil(
      runRetentionCleanup(uploadId, userId, tursoUrl, tursoToken)
        .catch((retentionError) => {
          console.warn(`[${uploadId}] Retention cleanup failed (non-blocking):`, retentionError);
        })
    );

    return NextResponse.json({
      success: true,
      uploadId,
      message: "Video processing started successfully",
      status: "processing",
      detectionMode: mode,
      region: geoRegion || 'default',
    });
  } catch (error) {
    console.error("Process endpoint error:", error);

    const errorMessage =
      error instanceof Error ? error.message : "An unexpected error occurred";

    return NextResponse.json(
      {
        error: "Internal server error",
        message: "An unexpected error occurred while starting processing. Please try again.",
        details: errorMessage,
      },
      { status: 500 }
    );
  }
}
