import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

export const runtime = 'nodejs';

interface BlobUploadResponse {
  url: string;
  pathname: string;
  contentType: string;
  contentDisposition: string;
}

export async function POST(request: Request) {
  const requestId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  console.log(`[blob-upload][${requestId}] Request started`);

  try {
    // Verify authentication - Required for all environments
    let userId: string | null = null;

    try {
      const authResult = await auth();
      userId = authResult.userId || null;
      console.log(`[blob-upload][${requestId}] Auth verified:`, { userId });
    } catch (authError) {
      console.error(`[blob-upload][${requestId}] Auth error:`, authError);
      return NextResponse.json(
        { error: 'Unauthorized', message: 'You must be logged in' },
        { status: 401 }
      );
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'User not authenticated' },
        { status: 401 }
      );
    }

    // Parse request body
    let body: HandleUploadBody;
    try {
      body = (await request.json()) as HandleUploadBody;
      console.log(`[blob-upload][${requestId}] Body parsed`);
    } catch (parseError) {
      console.error(`[blob-upload][${requestId}] JSON parse failed:`, parseError);
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      );
    }

    // Check token
    const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
    if (!blobToken) {
      console.error(`[blob-upload][${requestId}] Missing BLOB_READ_WRITE_TOKEN`);
      return NextResponse.json(
        { error: 'Server misconfigured' },
        { status: 500 }
      );
    }

    // Call handleUpload
    console.log(`[blob-upload][${requestId}] Calling handleUpload`);

    const response = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname: string) => {
        console.log(`[blob-upload][${requestId}] Generating token for:`, pathname);

        // Validate video file
        const ext = pathname.split('.').pop()?.toLowerCase();
        const videoExts = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'mpg', 'mpeg'];

        if (!ext || !videoExts.includes(ext)) {
          throw new Error(`Invalid file type: ${ext}`);
        }

        return {
          allowedContentTypes: [
            'video/mp4',
            'video/quicktime',
            'video/x-msvideo',
            'video/x-matroska',
            'video/webm',
            'video/x-flv',
            'video/mpeg',
            'application/octet-stream',
          ],
          addRandomSuffix: true,
          maximumSizeInBytes: 500 * 1024 * 1024,
          tokenPayload: JSON.stringify({
            userId,
            uploadedAt: new Date().toISOString(),
            fileName: pathname,
          }),
        };
      },
      onUploadCompleted: async ({ blob }) => {
        console.log(`[blob-upload][${requestId}] Upload completed:`, blob.url);
      },
    });

    console.log(`[blob-upload][${requestId}] Success`);
    return NextResponse.json(response);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    const errorType = error instanceof Error ? error.constructor.name : typeof error;

    // Detailed error logging
    console.error(`[blob-upload][${requestId}] ERROR:`, {
      message: errorMsg,
      stack: errorStack,
      type: errorType,
      fullError: error,
    });

    return NextResponse.json(
      {
        error: 'Upload failed',
        message: errorMsg,
        requestId,
        type: errorType,
      },
      { status: 500 }
    );
  }
}
