import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { del } from "@vercel/blob";

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
      const cloudRunUrl = process.env.CLOUD_RUN_URL || 'http://localhost:8080';
      const workerSecret = process.env.WORKER_SECRET;

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
      // Production mode: Download from Vercel Blob via metadata
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

      if (!supabaseUrl || !supabaseServiceKey) {
        return NextResponse.json(
          { error: "Server configuration error: Missing Supabase credentials" },
          { status: 500 }
        );
      }

      console.log(`[${uploadId}] [PROD] Fetching metadata from Supabase...`);

      const supabase = createClient(supabaseUrl, supabaseServiceKey);

      // Security: Get status with user_id verification to prevent IDOR attacks
      const { data, error } = await supabase
        .from('processing_status')
        .select('metadata')
        .eq('upload_id', uploadId)
        .eq('user_id', userId) // Critical: Verify ownership
        .single();

      if (error || !data) {
        console.error(`[${uploadId}] Failed to fetch metadata:`, error);
        return NextResponse.json(
          { error: "Upload not found or access denied" },
          { status: 404 }
        );
      }

      const blobUrl = data.metadata?.blobUrl;

      if (!blobUrl) {
        console.error(`[${uploadId}] No blobUrl found in metadata`);
        return NextResponse.json(
          { error: "Result file not available" },
          { status: 404 }
        );
      }

      console.log(`[${uploadId}] [PROD] Downloading from Vercel Blob...`);

      // Download from Vercel Blob
      const response = await fetch(blobUrl, {
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        console.error(`[${uploadId}] Blob download failed: ${response.status}`);
        return NextResponse.json(
          { error: "Failed to download result from storage" },
          { status: response.status }
        );
      }

      // Stream file to client
      const blob = await response.blob();
      const arrayBuffer = await blob.arrayBuffer();

      // Delete result blob after downloading
      console.log(`[${uploadId}] [PROD] Deleting result blob...`);
      try {
        await del(blobUrl);
        console.log(`[${uploadId}] [PROD] Result blob deleted successfully`);
      } catch (error) {
        console.error(`[${uploadId}] Failed to delete result blob:`, error);
        // Don't fail the download if cleanup fails
      }

      console.log(`[${uploadId}] [PROD] Download complete (${blob.size} bytes)`);

      return new NextResponse(arrayBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="result_${uploadId}.xlsx"`,
          'Content-Length': blob.size.toString(),
        },
      });
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
