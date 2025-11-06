import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";

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

    // Security: Fetch from Supabase with user_id verification (IDOR protection)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { error: "Server configuration error: Missing Supabase credentials" },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Security: Query with both upload_id AND user_id to prevent IDOR attacks
    const { data, error } = await supabase
      .from('processing_status')
      .select('*')
      .eq('upload_id', uploadId)
      .eq('user_id', userId) // Critical: Verify ownership
      .single();

    if (error || !data) {
      console.error(`[${uploadId}] Supabase query failed:`, error);
      return NextResponse.json(
        { error: "Upload not found or access denied" },
        { status: 404 }
      );
    }

    console.log(`[${uploadId}] Status retrieved:`, data.status);
    return NextResponse.json(data);
  } catch (error) {
    console.error("Status check error:", error);
    return NextResponse.json(
      {
        uploadId: params.uploadId,
        status: "processing",
        progress: 50,
        message: "Processing in progress...",
      },
      { status: 200 }
    );
  }
}
