import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

export const runtime = "nodejs";
export const maxDuration = 60; // 1 minute (just for metadata logging)

/**
 * This endpoint now just receives confirmation that client-side upload succeeded.
 * The actual file upload happens directly from the client to Vercel Blob,
 * bypassing the 413 (Content Too Large) error that occurred with large files.
 */
export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { uploadId, blobUrl } = body;

    if (!uploadId || !blobUrl) {
      return NextResponse.json(
        { error: "Missing uploadId or blobUrl" },
        { status: 400 }
      );
    }

    // Validate that blobUrl is actually from Vercel Blob
    if (!blobUrl.includes('blob.vercelusercontent.com')) {
      return NextResponse.json(
        { error: "Invalid blob URL" },
        { status: 400 }
      );
    }

    // TODO: Log upload metadata if needed
    console.log(`Upload confirmed: ${uploadId} -> ${blobUrl}`);

    return NextResponse.json({
      success: true,
      blobUrl,
      uploadId,
    });
  } catch (error) {
    console.error("Upload confirmation error:", error);
    return NextResponse.json(
      { error: "Upload confirmation failed", message: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
