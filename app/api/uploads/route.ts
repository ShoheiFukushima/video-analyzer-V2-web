/**
 * GET /api/uploads - List user's upload history
 *
 * Returns all uploads for the authenticated user with their status
 */

import { NextResponse } from 'next/server';
import { getTursoClient } from '@/lib/turso';
import { getRetentionConfig } from '@/lib/quota';

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
          result_url,
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
      // Parse metadata to get additional info
      const metadata = row.metadata ? JSON.parse(row.metadata as string) : null;
      const resultR2Key = metadata?.resultR2Key || null;

      return {
        uploadId: row.upload_id as string,
        status: row.status as string,
        progress: (row.progress as number) || 0,
        stage: row.current_step as string | null,
        fileName: metadata?.fileName || null,
        resultR2Key,
        createdAt: row.created_at as string,
        updatedAt: row.updated_at as string,
        errorMessage: row.error_message as string | null,
      };
    });

    // Attempt to get user's plan type for retention info
    let planType = 'free';
    try {
      const saasUrl = process.env.NEXT_PUBLIC_SAAS_PLATFORM_URL || 'http://localhost:3000';
      const { getToken } = await (await import('@clerk/nextjs/server')).auth();
      const token = await getToken();
      if (token) {
        const quotaRes = await fetch(`${saasUrl}/api/quota/check`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (quotaRes.ok) {
          const quotaData = await quotaRes.json();
          planType = quotaData.plan_type || 'free';
        }
      }
    } catch {
      // Fallback to free plan retention if quota check fails
    }

    const retention = getRetentionConfig(planType);

    return NextResponse.json({
      uploads,
      count: uploads.length,
      retention: {
        maxItems: retention.maxItems,
        maxDays: retention.maxDays,
        planType,
      },
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
