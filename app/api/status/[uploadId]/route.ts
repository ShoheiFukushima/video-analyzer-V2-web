import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: { uploadId: string } }
) {
  try {
    // Verify authentication - Required for all environments
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { uploadId } = params;

    // Use localhost for development, production URL for deployment
    const cloudRunUrl = process.env.NODE_ENV === 'development'
      ? process.env.CLOUD_RUN_URL || 'http://localhost:8080'
      : process.env.CLOUD_RUN_URL;

    const workerSecret = process.env.WORKER_SECRET;

    // Fetch status from Worker (local or production)
    if (!cloudRunUrl || !workerSecret) {
      return NextResponse.json(
        { error: "Server configuration error: Missing CLOUD_RUN_URL or WORKER_SECRET" },
        { status: 500 }
      );
    }

    console.log(`[${uploadId}] Fetching status from Worker...`);
    const response = await fetch(`${cloudRunUrl}/status/${uploadId}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${workerSecret}`,
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      console.error(`[${uploadId}] Worker returned status ${response.status}`);
      return NextResponse.json(
        { error: "Failed to fetch status from Worker" },
        { status: response.status }
      );
    }

    const status = await response.json();
    console.log(`[${uploadId}] Worker status:`, status);
    return NextResponse.json(status);
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
