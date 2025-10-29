import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: { uploadId: string } }
) {
  try {
    // Check authentication
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { uploadId } = params;

    // Development mode: return demo data with simulated progress
    if (process.env.NODE_ENV === "development") {
      const uploadTime = parseInt(uploadId.split("_")[1] || "0");
      const elapsedSeconds = (Date.now() - uploadTime) / 1000;

      // Simulate processing progression: 40-60 seconds for full processing
      if (elapsedSeconds < 40) {
        return NextResponse.json({
          uploadId,
          status: "processing",
          progress: Math.min(80, Math.floor((elapsedSeconds / 40) * 80)),
          message: `Processing: ${Math.floor((elapsedSeconds / 40) * 100)}% complete`,
        });
      } else {
        // After 40 seconds, return completed status with demo result
        return NextResponse.json({
          uploadId,
          status: "completed",
          progress: 100,
          message: "Processing completed!",
          resultUrl: `https://example.com/results/${uploadId}.xlsx`,
          metadata: {
            duration: 145.5,
            segmentCount: 12,
            ocrResultCount: 48,
          },
        });
      }
    }

    const cloudRunUrl = process.env.CLOUD_RUN_URL;
    const workerSecret = process.env.WORKER_SECRET;

    if (!cloudRunUrl || !workerSecret) {
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500 }
      );
    }

    // Query Cloud Run Worker status endpoint (with timeout)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

    try {
      const response = await fetch(`${cloudRunUrl}/status/${uploadId}`, {
        headers: {
          Authorization: `Bearer ${workerSecret}`,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status === 404) {
          return NextResponse.json(
            { status: "pending", uploadId },
            { status: 200 }
          );
        }
        throw new Error("Status check failed");
      }

      const data = await response.json();
      return NextResponse.json(data);
    } catch (fetchError) {
      clearTimeout(timeoutId);

      if (fetchError instanceof Error && fetchError.name === "AbortError") {
        console.warn(`Cloud Run timeout for ${uploadId}, returning pending status`);
        return NextResponse.json({
          uploadId,
          status: "processing",
          progress: 50,
          message: "Processing in progress...",
        });
      }
      throw fetchError;
    }
  } catch (error) {
    console.error("Status check error:", error);
    return NextResponse.json(
      {
        uploadId: params.uploadId,
        status: "processing",
        progress: 50,
        message: "Processing in progress...",
      },
      { status: 200 }
    );
  }
}
