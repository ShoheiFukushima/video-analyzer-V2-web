import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

export const runtime = 'nodejs';

export async function POST(request: Request) {
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

    // Call handleUpload with proper parameters
    const response = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname: string) => {
        // Validate file type (must be video)
        const videoExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv', '.mpg', '.mpeg'];
        const fileExtension = pathname.toLowerCase().split('.').pop();
        const isVideo = fileExtension && videoExtensions.includes(`.${fileExtension}`);

        if (!isVideo) {
          console.warn('Invalid file extension:', pathname);
          throw new Error('Only video files are allowed');
        }

        console.log('Generating token for:', pathname);

        // Return complete token configuration
        return {
          allowedContentTypes: [
            'video/mp4',
            'video/quicktime',
            'video/mov',
            'video/x-msvideo',
            'video/x-matroska',
            'video/webm',
            'video/x-flv',
            'video/mpeg',
            'application/octet-stream',
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

    // Return the response directly - do NOT wrap it again
    // handleUpload already returns a properly formatted NextResponse
    return response as unknown as Response;
  } catch (error) {
    console.error('Blob upload error:', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      {
        error: 'Upload failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 400 }
    );
  }
}
