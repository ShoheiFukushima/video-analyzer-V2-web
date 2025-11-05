import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isValidVercelBlobUrl } from "@/lib/blob-url-validator";

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

    const { uploadId, blobUrl, fileName, dataConsent } = body;

    // Validate required fields
    if (!uploadId || !blobUrl) {
      return NextResponse.json(
        {
          error: "Invalid request",
          message: "Missing required fields: uploadId, blobUrl",
        },
        { status: 400 }
      );
    }

    // Security: Validate blob URL format with strict hostname checking (SSRF protection)
    if (!isValidVercelBlobUrl(blobUrl)) {
      return NextResponse.json(
        {
          error: "Invalid request",
          message: "Invalid Vercel Blob Storage URL. Must be HTTPS from vercel-storage.com domain"
        },
        { status: 400 }
      );
    }

    // Use localhost for development, production URL for deployment
    const cloudRunUrl = process.env.NODE_ENV === 'development'
      ? process.env.CLOUD_RUN_URL || 'http://localhost:8080'
      : process.env.CLOUD_RUN_URL;

    // Always require WORKER_SECRET from environment (no defaults for security)
    const workerSecret = process.env.WORKER_SECRET;

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

    // Call worker (local or production) - MUST await to ensure request is sent
    const workerResponse = await fetch(`${cloudRunUrl}/process`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${workerSecret}`,
      },
      body: JSON.stringify({
        uploadId,
        blobUrl,
        fileName,
        dataConsent: dataConsent || false,
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
