import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { uploadId, blobUrl, fileName, dataConsent } = body;

    if (!uploadId || !blobUrl) {
      return NextResponse.json(
        { error: "Missing required fields: uploadId, blobUrl" },
        { status: 400 }
      );
    }

    const cloudRunUrl = process.env.CLOUD_RUN_URL;
    const workerSecret = process.env.WORKER_SECRET;

    if (!cloudRunUrl || !workerSecret) {
      return NextResponse.json(
        { error: "Server configuration error: Cloud Run URL or Worker Secret not set" },
        { status: 500 }
      );
    }

    // Call Cloud Run Worker
    const response = await fetch(`${cloudRunUrl}/process`, {
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
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || "Processing request failed");
    }

    const data = await response.json();

    return NextResponse.json({
      success: true,
      uploadId,
      message: "Processing started successfully",
      data,
    });
  } catch (error) {
    console.error("Process error:", error);
    return NextResponse.json(
      {
        error: "Processing failed",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
