import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

export const runtime = "nodejs";
export const maxDuration = 30; // 30 second timeout for processing request

export async function POST(request: NextRequest) {
  try {
    // Check authentication
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

    // Validate blob URL format
    if (!blobUrl.includes('blob.vercelusercontent.com') && !blobUrl.includes('vercel-blob')) {
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

    // Call Cloud Run Worker with timeout
    let response;
    try {
      response = await fetch(`${cloudRunUrl}/process`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${workerSecret}`,
        },
        body: JSON.stringify({
          uploadId,
          blobUrl,
          fileName,
          plan: "free", // Default plan
          dataConsent: dataConsent || false,
        }),
        signal: AbortSignal.timeout(25000), // 25 second timeout
      });
    } catch (fetchErr) {
      // Network or timeout error
      if (fetchErr instanceof Error) {
        if (fetchErr.name === 'AbortError') {
          console.error("Cloud Run request timeout:", uploadId);
          return NextResponse.json(
            {
              error: "Processing timeout",
              message: "Video processing service is slow. Your video is in the queue and will be processed soon.",
            },
            { status: 504 }
          );
        }
        if (fetchErr.message.includes('connection') || fetchErr.message.includes('ECONNREFUSED')) {
          console.error("Cloud Run connection error:", fetchErr.message);
          return NextResponse.json(
            {
              error: "Service unavailable",
              message: "Video processing service is temporarily unavailable. Please try again in a few moments.",
            },
            { status: 503 }
          );
        }
      }
      throw fetchErr;
    }

    // Handle Cloud Run response errors
    if (!response.ok) {
      let errorMessage = "Processing request failed";
      try {
        const errorData = await response.json();
        errorMessage = errorData.message || errorData.error || errorMessage;
      } catch {
        // Response wasn't JSON
        errorMessage = `Cloud Run error (${response.status}): ${response.statusText}`;
      }

      console.error(`Cloud Run error (${response.status}):`, errorMessage, "uploadId:", uploadId);

      // Determine appropriate HTTP status for client
      if (response.status === 429) {
        return NextResponse.json(
          {
            error: "Too many requests",
            message: "Processing queue is full. Please try again in a few minutes.",
          },
          { status: 429 }
        );
      }

      if (response.status >= 500) {
        return NextResponse.json(
          {
            error: "Processing service error",
            message: "Video processing service is experiencing issues. Please try again later.",
          },
          { status: 503 }
        );
      }

      return NextResponse.json(
        {
          error: "Processing failed",
          message: errorMessage,
        },
        { status: 400 }
      );
    }

    // Success
    const data = await response.json();

    return NextResponse.json({
      success: true,
      uploadId,
      message: "Video processing started successfully",
      data,
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
