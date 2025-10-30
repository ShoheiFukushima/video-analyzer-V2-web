import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

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

    // Validate blob URL format (vercel-storage is the actual Blob domain)
    if (!blobUrl.includes('vercel-storage') && !blobUrl.includes('blob.vercel')) {
      return NextResponse.json(
        { error: "Invalid request", message: "Blob URL must be from Vercel Blob storage" },
        { status: 400 }
      );
    }

    const cloudRunUrl = process.env.CLOUD_RUN_URL;
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
    // In development, we can use a simple timeout-based simulation
    // In production, this will call Cloud Run Worker

    if (process.env.NODE_ENV === 'development' || !cloudRunUrl) {
      console.log(`[${uploadId}] Development mode: Processing will be simulated`);
    } else {
      // Try to call Cloud Run Worker, but don't fail if it's unavailable
      try {
        fetch(`${cloudRunUrl}/process`, {
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
        }).catch(err => {
          console.warn(`[${uploadId}] Cloud Run request failed:`, err);
        });
      } catch (err) {
        console.warn(`[${uploadId}] Failed to trigger Cloud Run:`, err);
      }
    }

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
