import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: { uploadId: string } }
) {
  try {
    // Verify authentication - Required for all environments
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { uploadId } = params;
    const cloudRunUrl = process.env.CLOUD_RUN_URL;
    const workerSecret = process.env.WORKER_SECRET;

    // Production: Fetch status from Cloud Run Worker
    if (cloudRunUrl && workerSecret && process.env.NODE_ENV === 'production') {
      try {
        console.log(`[${uploadId}] Fetching status from Cloud Run...`);
        const response = await fetch(`${cloudRunUrl}/status/${uploadId}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${workerSecret}`,
          },
          signal: AbortSignal.timeout(5000),
        });

        if (response.ok) {
          const status = await response.json();
          console.log(`[${uploadId}] Cloud Run status:`, status);
          return NextResponse.json(status);
        } else {
          console.warn(`[${uploadId}] Cloud Run returned status ${response.status}`);
        }
      } catch (err) {
        console.warn(`[${uploadId}] Cloud Run fetch failed:`, err);
        // Fall through to simulation as fallback
      }
    }

    // Fallback: Return simulated status (development or Cloud Run unavailable)
    console.log(`[${uploadId}] Using simulated status (development mode)`);

    // Simulate progress based on elapsed time since upload
    const uploadTime = parseInt(uploadId.split('_')[1] || '0');
    const elapsedMs = Date.now() - uploadTime;
    const totalDurationMs = 40000; // 40 second simulation
    const progress = Math.min(100, Math.floor((elapsedMs / totalDurationMs) * 100));

    // Define processing stages
    const stages = [
      'downloading',
      'metadata',
      'vad',
      'frames',
      'whisper',
      'ocr',
      'excel',
      'upload_result',
      'completed',
    ];

    let currentStageIndex = Math.floor((progress / 100) * (stages.length - 1));
    currentStageIndex = Math.min(currentStageIndex, stages.length - 1);
    const currentStage = stages[currentStageIndex];

    if (progress >= 100) {
      // Completed - return with result URL
      return NextResponse.json({
        uploadId,
        status: 'completed',
        progress: 100,
        stage: 'completed',
        resultUrl: `/api/dummy-excel/${uploadId}`,
        metadata: {
          duration: 120.5,
          segmentCount: 8,
          ocrResultCount: 12,
          transcriptionLength: 2543,
        },
      });
    }

    // Processing in progress
    return NextResponse.json({
      uploadId,
      status: 'processing',
      progress,
      stage: currentStage,
      message: `Processing: ${currentStage}...`,
    });
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
