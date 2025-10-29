import { put } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

export const runtime = "nodejs";
export const maxDuration = 300; // 5 minutes

export async function POST(request: NextRequest) {
  try {
    // Check Content-Length header early to catch too-large requests
    const contentLength = request.headers.get('content-length');
    const maxSizeBytes = 100 * 1024 * 1024; // 100MB for Vercel free tier safety

    if (contentLength && parseInt(contentLength) > maxSizeBytes) {
      return NextResponse.json(
        {
          error: "File size exceeds limit",
          message: `Maximum file size is ${maxSizeBytes / 1024 / 1024}MB. Received: ${Math.round(parseInt(contentLength) / 1024 / 1024)}MB`,
          code: "FILE_TOO_LARGE"
        },
        { status: 413 }
      );
    }

    // Check authentication
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File;
    const uploadId = formData.get("uploadId") as string;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!uploadId) {
      return NextResponse.json({ error: "No upload ID provided" }, { status: 400 });
    }

    // Validate file type
    if (!file.type.startsWith("video/")) {
      return NextResponse.json({ error: "File must be a video" }, { status: 400 });
    }

    // Validate file size (max 100MB for safety on Vercel free tier)
    const maxSize = 100 * 1024 * 1024;
    if (file.size > maxSize) {
      return NextResponse.json(
        {
          error: "File size exceeds limit",
          message: `Maximum file size is ${maxSize / 1024 / 1024}MB. Your file: ${Math.round(file.size / 1024 / 1024)}MB`,
          code: "FILE_TOO_LARGE"
        },
        { status: 413 }
      );
    }

    // Upload to Vercel Blob
    const blob = await put(`uploads/${uploadId}/${file.name}`, file, {
      access: "public",
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });

    return NextResponse.json({
      success: true,
      blobUrl: blob.url,
      uploadId,
    });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: "Upload failed", message: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
