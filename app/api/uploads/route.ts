/**
 * GET /api/uploads - List user's upload history
 *
 * Returns all uploads for the authenticated user with their status
 */

import { NextResponse } from 'next/server';
import { getTursoClient } from '@/lib/turso';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface UploadRecord {
  uploadId: string;
  status: string;
  progress: number;
  stage: string | null;
  fileName: string | null;
  resultR2Key: string | null;
  createdAt: string;
  updatedAt: string;
  errorMessage: string | null;
}

export async function GET() {
  try {
    const { client, userId } = await getTursoClient();

    // Get all uploads for this user, ordered by most recent first
    const result = await client.execute({
      sql: `
        SELECT
          upload_id,
          status,
          progress,
          current_step,
          file_name,
          result_r2_key,
          metadata,
          created_at,
          updated_at,
          error_message
        FROM processing_status
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT 50
      `,
      args: [userId],
    });

    const uploads: UploadRecord[] = result.rows.map((row) => {
      // Parse metadata to get resultR2Key if not in dedicated column
      const metadata = row.metadata ? JSON.parse(row.metadata as string) : null;
      const resultR2Key = (row.result_r2_key as string | null) || metadata?.resultR2Key || null;

      return {
        uploadId: row.upload_id as string,
        status: row.status as string,
        progress: (row.progress as number) || 0,
        stage: row.current_step as string | null,
        fileName: (row.file_name as string | null) || metadata?.fileName || null,
        resultR2Key,
        createdAt: row.created_at as string,
        updatedAt: row.updated_at as string,
        errorMessage: row.error_message as string | null,
      };
    });

    return NextResponse.json({
      uploads,
      count: uploads.length,
    });
  } catch (error) {
    // Handle authentication errors
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    console.error('[/api/uploads] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch uploads' },
      { status: 500 }
    );
  }
}
