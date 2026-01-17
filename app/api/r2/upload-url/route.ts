import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { generateUploadUrl, generateVideoKey } from '@/lib/r2-client';
import { v4 as uuidv4 } from 'uuid';

const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2GB

const ALLOWED_VIDEO_TYPES = [
  'video/mp4',
  'video/quicktime', // .mov
  'video/x-msvideo', // .avi
  'video/x-matroska', // .mkv
  'video/webm',
];

export async function POST(request: NextRequest) {
  try {
    // Authentication check
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { fileName, contentType, fileSize } = body;

    // Validation
    if (!fileName || !contentType) {
      return NextResponse.json(
        { error: 'Missing required fields: fileName and contentType' },
        { status: 400 }
      );
    }

    // File type validation
    if (!ALLOWED_VIDEO_TYPES.includes(contentType)) {
      return NextResponse.json(
        { error: `Unsupported video format. Allowed: MP4, MOV, AVI, MKV, WebM` },
        { status: 400 }
      );
    }

    // File size validation
    if (fileSize && fileSize > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File size exceeds 2GB limit. Current: ${(fileSize / (1024 * 1024 * 1024)).toFixed(2)}GB` },
        { status: 400 }
      );
    }

    // Generate uploadId
    const uploadId = `upload_${Date.now()}_${uuidv4().slice(0, 12)}`;

    // Generate R2 key
    const key = generateVideoKey(userId, uploadId, fileName);

    // Generate presigned URL (15 minutes validity)
    const uploadUrl = await generateUploadUrl(key, contentType, 900);

    console.log(`[R2] Generated upload URL for user ${userId}, uploadId: ${uploadId}`);

    return NextResponse.json({
      uploadUrl,
      uploadId,
      r2Key: key,
      expiresIn: 900,
    });
  } catch (error) {
    console.error('Failed to generate upload URL:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
