import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isValidR2Key } from "@/lib/r2-client";

export const runtime = "nodejs";
export const maxDuration = 30; // 30 second timeout for processing request

/**
 * Call Cloud Run worker with automatic failover to backup regions
 * Tries primary URL first, then falls back to other regions on failure
 */
async function callCloudRunWithFailover(
  primaryUrl: string,
  fallbackUrls: string[],
  payload: object,
  workerSecret: string,
  uploadId: string
): Promise<{ response: Response; usedUrl: string; failedUrls: string[] }> {
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
        signal: AbortSignal.timeout(25000), // 25s timeout (Cloud Run cold start can take 10-20s)
      });

      if (response.ok || response.status === 202) {
        if (!isPrimary) {
          console.log(`[${uploadId}] Failover successful: ${url} (failed: ${failedUrls.join(', ')})`);
        }
        return { response, usedUrl: url, failedUrls };
      }

      // Non-OK response - try next URL
      const status = response.status;
      console.warn(`[${uploadId}] ${url} returned ${status}, trying next...`);
      failedUrls.push(`${url}:${status}`);

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`[${uploadId}] ${url} failed: ${errorMsg}, trying next...`);
      failedUrls.push(`${url}:${errorMsg}`);
    }
  }

  // All URLs failed
  throw new Error(`All Cloud Run regions failed: ${failedUrls.join(', ')}`);
}

export async function POST(request: NextRequest) {
  try {
    // Check authentication - Required for all environments
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized", message: "You must be logged in to process videos" },
        { status: 401 }
      );
    }

    // Validate request body
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

    // Validate required fields
    if (!uploadId || !r2Key) {
      return NextResponse.json(
        {
          error: "Invalid request",
          message: "Missing required fields: uploadId, r2Key",
        },
        { status: 400 }
      );
    }

    // Validate detectionMode (default to 'standard' if not provided or invalid)
    const validModes = ['standard', 'enhanced'];
    const mode = validModes.includes(detectionMode) ? detectionMode : 'standard';

    // Security: Validate R2 key format (SSRF protection)
    if (!isValidR2Key(r2Key)) {
      return NextResponse.json(
        {
          error: "Invalid request",
          message: "Invalid R2 key format"
        },
        { status: 400 }
      );
    }

    // Security: Verify that the R2 key belongs to this user
    if (!r2Key.includes(`/${userId}/`)) {
      console.warn(`[${uploadId}] User ${userId} attempted to use r2Key: ${r2Key}`);
      return NextResponse.json(
        {
          error: "Forbidden",
          message: "You do not have permission to process this file"
        },
        { status: 403 }
      );
    }

    // Always require WORKER_SECRET from environment (no defaults for security)
    const workerSecret = process.env.WORKER_SECRET?.trim();

    // Get Cloud Run URL - prioritize geo-routed URL from middleware
    const geoRoutedUrl = request.headers.get('x-target-cloud-run');
    const fallbackUrlsHeader = request.headers.get('x-fallback-cloud-run');
    const geoCountry = request.headers.get('x-geo-country');
    const geoRegion = request.headers.get('x-geo-region');

    // Fallback to environment variable if geo-routing not available
    const primaryCloudRunUrl = process.env.NODE_ENV === 'development'
      ? process.env.CLOUD_RUN_URL?.trim() || 'http://localhost:8080'
      : geoRoutedUrl || process.env.CLOUD_RUN_URL?.trim();

    // Parse fallback URLs
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

    // Log geo-routing info
    if (geoCountry) {
      console.log(`[${uploadId}] Geo-routing: country=${geoCountry}, region=${geoRegion}`);
    }
    console.log(`[${uploadId}] Primary URL: ${primaryCloudRunUrl}`);
    if (fallbackUrls.length > 0) {
      console.log(`[${uploadId}] Fallback URLs: ${fallbackUrls.join(', ')}`);
    }
    console.log(`[${uploadId}] Detection mode: ${mode}`);

    // Prepare payload
    const payload = {
      uploadId,
      r2Key,
      fileName,
      userId, // Security: Pass userId to Worker for IDOR protection
      dataConsent: dataConsent || false,
      detectionMode: mode, // Detection mode: 'standard' or 'enhanced'
    };

    // Call worker with failover support
    // Worker returns 202 immediately; do NOT await response.json()
    // because the response body stream stays open for keep-alive.
    const { response: workerResponse, usedUrl, failedUrls } = await callCloudRunWithFailover(
      primaryCloudRunUrl,
      fallbackUrls,
      payload,
      workerSecret,
      uploadId
    );

    console.log(`[${uploadId}] Worker accepted request (${workerResponse.status}) from ${usedUrl}`);

    // Return immediately - processing happens in background on Cloud Run
    return NextResponse.json({
      success: true,
      uploadId,
      message: "Video processing started successfully",
      status: "processing",
      detectionMode: mode,
      region: geoRegion || 'default',
      failedRegions: failedUrls.length > 0 ? failedUrls : undefined,
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
