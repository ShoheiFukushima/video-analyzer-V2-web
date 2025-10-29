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
