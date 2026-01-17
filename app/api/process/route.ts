import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isValidR2Key } from "@/lib/r2-client";

export const runtime = "nodejs";
export const maxDuration = 30; // 30 second timeout for processing request

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

    // Use localhost for development, production URL for deployment
    const cloudRunUrl = process.env.NODE_ENV === 'development'
      ? process.env.CLOUD_RUN_URL?.trim() || 'http://localhost:8080'
      : process.env.CLOUD_RUN_URL?.trim();

    // Always require WORKER_SECRET from environment (no defaults for security)
    const workerSecret = process.env.WORKER_SECRET?.trim();

    if (!cloudRunUrl || !workerSecret) {
      console.error("Missing environment variables: CLOUD_RUN_URL or WORKER_SECRET");
      return NextResponse.json(
        {
          error: "Server configuration error",
          message: "Video processing service is not properly configured",
        },
        { status: 500 }
      );
    }

    // MVP: Trigger processing asynchronously (without waiting for completion)
    // Works for both local development (localhost:8080) and production (Cloud Run)

    console.log(`[${uploadId}] Sending processing request to worker: ${cloudRunUrl}`);
    console.log(`[${uploadId}] Detection mode: ${mode}`);

    // Call worker (local or production) - MUST await to ensure request is sent
    const workerResponse = await fetch(`${cloudRunUrl}/process`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${workerSecret}`,
      },
      body: JSON.stringify({
        uploadId,
        r2Key,
        fileName,
        userId, // Security: Pass userId to Worker for IDOR protection
        dataConsent: dataConsent || false,
        detectionMode: mode, // Detection mode: 'standard' or 'enhanced'
      }),
      signal: AbortSignal.timeout(25000),
    });

    // Check if worker accepted the request
    if (!workerResponse.ok) {
      console.error(`[${uploadId}] Worker returned status ${workerResponse.status}`);
      const errorText = await workerResponse.text().catch(() => 'Unable to read error response');
      return NextResponse.json(
        {
          error: "Processing failed to start",
          message: `Worker service returned error: ${workerResponse.status}`,
          details: errorText,
        },
        { status: 502 }
      );
    }

    const workerData = await workerResponse.json().catch(() => ({}));
    console.log(`[${uploadId}] Worker accepted request:`, workerData);

    // Return immediately - processing happens in background
    return NextResponse.json({
      success: true,
      uploadId,
      message: "Video processing started successfully",
      status: "processing",
      detectionMode: mode,
    });
  } catch (error) {
    console.error("Process endpoint error:", error);

    const errorMessage =
      error instanceof Error ? error.message : "An unexpected error occurred";

    return NextResponse.json(
      {
        error: "Internal server error",
        message: "An unexpected error occurred while starting processing. Please try again.",
      },
      { status: 500 }
    );
  }
}
