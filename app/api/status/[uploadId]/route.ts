import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@libsql/client";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: { uploadId: string } }
) {
  try {
    // Security: Verify authentication
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { uploadId } = params;

    // Security: Fetch from Turso with user_id verification (IDOR protection)
    const tursoUrl = process.env.TURSO_DATABASE_URL;
    const tursoToken = process.env.TURSO_AUTH_TOKEN;

    if (!tursoUrl || !tursoToken) {
      return NextResponse.json(
        { error: "Server configuration error: Missing Turso credentials" },
        { status: 500 }
      );
    }

    const client = createClient({
      url: tursoUrl,
      authToken: tursoToken,
    });

    // Security: Query with both upload_id AND user_id to prevent IDOR attacks
    const result = await client.execute({
      sql: 'SELECT * FROM processing_status WHERE upload_id = ? AND user_id = ?',
      args: [uploadId, userId],
    });

    if (result.rows.length === 0) {
      console.error(`[${uploadId}] Turso query returned no results`);
      return NextResponse.json(
        { error: "Upload not found or access denied" },
        { status: 404 }
      );
    }

    const row = result.rows[0];
    console.log(`[${uploadId}] Status retrieved:`, row.status);

    // Parse metadata JSON (may contain phase data)
    const metadata = row.metadata ? JSON.parse(row.metadata as string) : null;

    // Extract phase data from metadata (stored by updatePhaseProgress)
    const phaseData = metadata ? {
      phase: metadata.phase,
      phaseProgress: metadata.phaseProgress,
      phaseStatus: metadata.phaseStatus,
      estimatedTimeRemaining: metadata.estimatedTimeRemaining,
      subTask: metadata.subTask,
    } : {};

    // Map Turso columns to camelCase for frontend consistency
    // Column mapping: current_step → stage, error_message → error, created_at → startedAt
    const mappedData = {
      uploadId: row.upload_id as string,
      userId: row.user_id as string,
      status: row.status as string,
      progress: row.progress as number,
      stage: row.current_step as string | null, // Map current_step → stage
      startedAt: row.created_at as string, // Map created_at → startedAt
      updatedAt: row.updated_at as string,
      resultUrl: row.result_url as string | null,
      metadata: metadata,
      error: row.error_message as string | null, // Map error_message → error
      // 3-Phase UI data (extracted from metadata)
      ...phaseData,
    };

    return NextResponse.json(mappedData);
  } catch (error) {
    console.error("Status check error:", error);

    // 認証エラー
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Turso接続エラーやその他のエラー
    return NextResponse.json(
      {
        error: "Status check failed",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
