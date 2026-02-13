import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@libsql/client";
import { generateDownloadUrl, deleteObject } from "@/lib/r2-client";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: { uploadId: string } }
) {
  try {
    // Verify authentication
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { uploadId } = params;

    if (process.env.NODE_ENV === 'development') {
      // Development mode: Download from Worker
      const cloudRunUrl = process.env.CLOUD_RUN_URL?.trim() || 'http://localhost:8080';
      const workerSecret = process.env.WORKER_SECRET?.trim();

      if (!workerSecret) {
        return NextResponse.json(
          { error: "Server configuration error: Missing WORKER_SECRET" },
          { status: 500 }
        );
      }

      console.log(`[${uploadId}] [DEV] Downloading result from Worker...`);

      // Fetch file from Worker with authentication
      const response = await fetch(`${cloudRunUrl}/result/${uploadId}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${workerSecret}`,
        },
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        console.error(`[${uploadId}] Worker returned status ${response.status}`);
        return NextResponse.json(
          { error: "Failed to download result from Worker" },
          { status: response.status }
        );
      }

      // Stream file to client
      const blob = await response.blob();
      const arrayBuffer = await blob.arrayBuffer();

      console.log(`[${uploadId}] [DEV] Download complete (${blob.size} bytes)`);

      return new NextResponse(arrayBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="result_${uploadId}.xlsx"`,
          'Content-Length': blob.size.toString(),
        },
      });

    } else {
      // Production mode: Download from R2 via metadata
      const tursoUrl = process.env.TURSO_DATABASE_URL;
      const tursoToken = process.env.TURSO_AUTH_TOKEN;

      if (!tursoUrl || !tursoToken) {
        return NextResponse.json(
          { error: "Server configuration error: Missing Turso credentials" },
          { status: 500 }
        );
      }

      console.log(`[${uploadId}] [PROD] Fetching metadata from Turso...`);

      const client = createClient({
        url: tursoUrl,
        authToken: tursoToken,
      });

      // Security: Get status with user_id verification to prevent IDOR attacks
      const result = await client.execute({
        sql: 'SELECT metadata FROM processing_status WHERE upload_id = ? AND user_id = ?',
        args: [uploadId, userId],
      });

      if (result.rows.length === 0) {
        console.error(`[${uploadId}] Failed to fetch metadata: No rows found`);
        return NextResponse.json(
          { error: "Upload not found or access denied" },
          { status: 404 }
        );
      }

      const metadataStr = result.rows[0].metadata as string | null;
      const metadata = metadataStr ? JSON.parse(metadataStr) : null;
      const resultR2Key = metadata?.resultR2Key;

      if (!resultR2Key) {
        console.error(`[${uploadId}] No resultR2Key found in metadata`);
        return NextResponse.json(
          { error: "Result file not available" },
          { status: 404 }
        );
      }

      // Security: Verify that the R2 key belongs to this user
      if (!resultR2Key.includes(`/${userId}/`)) {
        console.warn(`[${uploadId}] User ${userId} attempted to access R2 key: ${resultR2Key}`);
        return NextResponse.json(
          { error: "Forbidden" },
          { status: 403 }
        );
      }

      console.log(`[${uploadId}] [PROD] Generating R2 presigned download URL...`);

      // Generate presigned download URL from R2
      // ResponseContentDisposition is already set in generateDownloadUrl (lib/r2-client.ts)
      const downloadUrl = await generateDownloadUrl(resultR2Key, 3600, `result_${uploadId}.xlsx`);

      console.log(`[${uploadId}] [PROD] Returning presigned URL for direct R2 download`);

      // Return presigned URL as JSON - client downloads directly from R2
      // This eliminates Vercel memory buffering and 60s timeout for large files
      return NextResponse.json({ downloadUrl });
    }

  } catch (error) {
    console.error("Download endpoint error:", error);

    const errorMessage =
      error instanceof Error ? error.message : "An unexpected error occurred";

    return NextResponse.json(
      {
        error: "Internal server error",
        message: errorMessage,
      },
      { status: 500 }
    );
  }
}
