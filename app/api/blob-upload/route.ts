import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<NextResponse> {
  try {
    // Verify authentication
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'You must be logged in to upload' },
        { status: 401 }
      );
    }

    const body = (await request.json()) as HandleUploadBody;

    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname: string) => {
        // Validate file type (must be video)
        const videoExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv'];
        const fileExtension = pathname.toLowerCase().split('.').pop();
        const isVideo = fileExtension && videoExtensions.includes(`.${fileExtension}`);

        if (!isVideo) {
          throw new Error('Only video files are allowed');
        }

        return {
          allowedContentTypes: [
            'video/mp4',
            'video/quicktime',
            'video/x-msvideo',
            'video/x-matroska',
            'video/webm',
            'video/x-flv',
          ],
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({
            userId,
            uploadedAt: new Date().toISOString(),
            fileName: pathname,
          }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        console.log('Upload completed:', blob.url);
        console.log('Payload:', tokenPayload);
        // TODO: Implement database persistence for upload metadata (Phase 2)
        // Example: await db.uploads.create({ userId, blobUrl: blob.url, metadata: tokenPayload })
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    console.error('Blob upload error:', error);
    return NextResponse.json(
      {
        error: 'Upload failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 400 }
    );
  }
}
