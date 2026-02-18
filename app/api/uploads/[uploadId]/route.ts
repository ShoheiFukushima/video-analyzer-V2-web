/**
 * DELETE /api/uploads/[uploadId] - Delete a single upload record and its R2 file
 *
 * Security: Verifies user ownership via user_id in WHERE clause (IDOR prevention)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTursoClient } from '@/lib/turso';
import { deleteObject } from '@/lib/r2-client';

export const runtime = 'nodejs';

export async function DELETE(
  request: NextRequest,
  { params }: { params: { uploadId: string } }
) {
  const { uploadId } = params;

  try {
    const { client, userId } = await getTursoClient();

    // Fetch the record with ownership verification
    const result = await client.execute({
      sql: 'SELECT metadata FROM processing_status WHERE upload_id = ? AND user_id = ?',
      args: [uploadId, userId],
    });

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Upload not found' },
        { status: 404 }
      );
    }

    // Delete R2 file if resultR2Key exists
    const metadataStr = result.rows[0].metadata as string | null;
    const metadata = metadataStr ? JSON.parse(metadataStr) : null;
    const resultR2Key = metadata?.resultR2Key;

    if (resultR2Key) {
      try {
        await deleteObject(resultR2Key);
        console.log(`[${uploadId}] R2 file deleted: ${resultR2Key}`);
      } catch (r2Error) {
        // Log but don't fail — R2 file may already be deleted
        console.warn(`[${uploadId}] R2 delete failed (may already be gone):`, r2Error);
      }
    }

    // Delete DB record
    await client.execute({
      sql: 'DELETE FROM processing_status WHERE upload_id = ? AND user_id = ?',
      args: [uploadId, userId],
    });

    console.log(`[${uploadId}] Upload record deleted by user ${userId}`);

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.error(`[${uploadId}] Delete failed:`, error);
    return NextResponse.json(
      { error: 'Failed to delete upload' },
      { status: 500 }
    );
  }
}
