import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { generateDownloadUrl, isValidR2Key } from '@/lib/r2-client';

export async function POST(request: NextRequest) {
  try {
    // Authentication check
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { key, downloadFilename } = body;

    if (!key) {
      return NextResponse.json({ error: 'Missing R2 key' }, { status: 400 });
    }

    // Validate key format
    if (!isValidR2Key(key)) {
      return NextResponse.json({ error: 'Invalid R2 key format' }, { status: 400 });
    }

    // Security: Verify that the key belongs to this user
    if (!key.includes(`/${userId}/`)) {
      console.warn(`[R2] User ${userId} attempted to access key: ${key}`);
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Generate download URL (1 hour validity)
    const downloadUrl = await generateDownloadUrl(key, 3600, downloadFilename);

    console.log(`[R2] Generated download URL for user ${userId}, key: ${key}`);

    return NextResponse.json({
      downloadUrl,
      expiresIn: 3600,
    });
  } catch (error) {
    console.error('Failed to generate download URL:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
