import { handleUpload, type HandleUploadBody } from '@vercel/blob/next/api';
import { NextRequest } from 'next/server';
import { auth } from '@clerk/nextjs/server';

export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<Response> {
  // Verify authentication
  const { userId } = await auth();
  if (!userId) {
    return new Response('Unauthorized', { status: 401 });
  }

  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname: string) => {
        // Validate file type (must be video)
        if (!pathname.includes('uploads/')) {
          throw new Error('Invalid upload path');
        }

        // Only allow video files
        const videoExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv'];
        const isVideo = videoExtensions.some((ext) =>
          pathname.toLowerCase().endsWith(ext)
        );

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
          tokenPayload: JSON.stringify({ userId, uploadPath: pathname }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        console.log('Upload completed:', blob.url);
        console.log('Token payload:', tokenPayload);

        // Here you could save metadata to database if needed
        // await db.uploads.create({ userId, blobUrl: blob.url, ... })

        return {
          success: true,
          blobUrl: blob.url,
        };
      },
    });

    return jsonResponse;
  } catch (error) {
    console.error('Blob upload error:', error);
    return new Response(
      JSON.stringify({
        error: 'Upload failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 400, headers: { 'content-type': 'application/json' } }
    );
  }
}
