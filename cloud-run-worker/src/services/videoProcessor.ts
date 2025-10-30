import axios from 'axios';
import { initStatus, updateStatus, completeStatus, failStatus } from './statusManager.js';
import { executeIdealPipeline } from './pipeline.js';
import { getVideoMetadata } from './ffmpeg.js';
import { transcribeAudio } from './whisperService.js';
import { extractFramesAndOCR } from './ocrService.js';
import { uploadResultFile } from './blobUploader.js';
import path from 'path';
import fs from 'fs';
import os from 'os';

export const processVideo = async (
  uploadId: string,
  blobUrl: string,
  fileName: string,
  dataConsent: boolean
) => {
  try {
    console.log(`[${uploadId}] Starting video processing`);
    await initStatus(uploadId);

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-analyzer-'));
    const videoPath = path.join(tempDir, 'video.mp4');

    try {
      // Step 1: Download video
      console.log(`[${uploadId}] Downloading video from blob...`);
      await updateStatus(uploadId, { status: 'downloading', progress: 10, stage: 'downloading' });

      await downloadFile(blobUrl, videoPath);

      // Step 2: Extract video metadata
      console.log(`[${uploadId}] Extracting video metadata...`);
      await updateStatus(uploadId, { status: 'processing', progress: 20, stage: 'metadata' });

      const videoMetadata = await getVideoMetadata(videoPath);

      // Step 3: Extract audio
      console.log(`[${uploadId}] Extracting audio...`);
      await updateStatus(uploadId, { status: 'processing', progress: 30, stage: 'audio' });

      const audioPath = path.join(tempDir, 'audio.mp3');
      await extractAudio(videoPath, audioPath);

      // Step 4: Transcribe with Whisper
      console.log(`[${uploadId}] Transcribing audio with Whisper...`);
      await updateStatus(uploadId, { status: 'processing', progress: 45, stage: 'whisper' });

      const transcription = await transcribeAudio(audioPath, uploadId);

      // Step 5: Perform OCR with Gemini Vision
      console.log(`[${uploadId}] Performing OCR with Gemini Vision...`);
      await updateStatus(uploadId, { status: 'processing', progress: 60, stage: 'ocr' });

      const ocrResults = await extractFramesAndOCR(videoPath, uploadId);

      // Step 6: Execute ideal Excel pipeline (Scene detection + Excel generation)
      console.log(`[${uploadId}] Executing ideal Excel pipeline...`);
      await updateStatus(uploadId, { status: 'processing', progress: 75, stage: 'excel' });

      const pipelineResult = await executeIdealPipeline(
        videoPath,
        fileName,
        ocrResults,
        transcription
      );

      const excelPath = pipelineResult.excelPath;

      // Step 9: Upload result file
      console.log(`[${uploadId}] Uploading results...`);
      await updateStatus(uploadId, { status: 'processing', progress: 90, stage: 'upload_result' });

      const resultUrl = await uploadResultFile(excelPath, uploadId);

      // Complete
      console.log(`[${uploadId}] Processing completed!`);
      await completeStatus(uploadId, resultUrl, {
        duration: videoMetadata.duration,
        segmentCount: transcription.length,
        ocrResultCount: ocrResults.length,
        transcriptionLength: transcription.reduce((sum, seg) => sum + seg.text.length, 0),
        totalScenes: pipelineResult.stats.totalScenes,
        scenesWithOCR: pipelineResult.stats.scenesWithOCRText,
        scenesWithNarration: pipelineResult.stats.scenesWithNarration,
      });

    } finally {
      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    }

  } catch (error) {
    console.error(`[${uploadId}] Processing failed:`, error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    await failStatus(uploadId, errorMessage);
  }
};

async function downloadFile(url: string, dest: string) {
  const response = await axios.get(url, {
    responseType: 'stream',
    timeout: 60000
  });

  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    response.data.pipe(file);
    file.on('finish', () => {
      file.close();
      resolve(null);
    });
    file.on('error', reject);
  });
}

async function extractAudio(videoPath: string, audioPath: string) {
  // TODO: Implement real audio extraction using fluent-ffmpeg
  // For now, create a dummy file for testing
  fs.writeFileSync(audioPath, Buffer.from('dummy audio'));
}
