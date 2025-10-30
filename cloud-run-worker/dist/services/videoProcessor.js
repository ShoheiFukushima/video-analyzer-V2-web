import axios from 'axios';
import { initStatus, updateStatus, completeStatus, failStatus } from './statusManager.js';
import { generateExcelReport } from './excelGenerator.js';
import { transcribeAudio } from './whisperService.js';
import { extractFramesAndOCR } from './ocrService.js';
import { uploadResultFile } from './blobUploader.js';
import path from 'path';
import fs from 'fs';
import os from 'os';
export const processVideo = async (uploadId, blobUrl, fileName, dataConsent) => {
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
            // Step 2: Extract metadata and frames
            console.log(`[${uploadId}] Extracting metadata and frames...`);
            await updateStatus(uploadId, { status: 'processing', progress: 20, stage: 'metadata' });
            const metadata = await getVideoMetadata(videoPath);
            // Step 3: Detect voice activity and extract segments
            console.log(`[${uploadId}] Detecting voice activity...`);
            await updateStatus(uploadId, { status: 'processing', progress: 30, stage: 'vad' });
            // Step 4: Extract audio
            console.log(`[${uploadId}] Extracting audio...`);
            await updateStatus(uploadId, { status: 'processing', progress: 35, stage: 'audio' });
            const audioPath = path.join(tempDir, 'audio.mp3');
            await extractAudio(videoPath, audioPath);
            // Step 5: Extract frames for OCR
            console.log(`[${uploadId}] Extracting frames for OCR...`);
            await updateStatus(uploadId, { status: 'processing', progress: 40, stage: 'frames' });
            const framesDir = path.join(tempDir, 'frames');
            fs.mkdirSync(framesDir, { recursive: true });
            // Step 6: Transcribe with Whisper
            console.log(`[${uploadId}] Transcribing audio with Whisper...`);
            await updateStatus(uploadId, { status: 'processing', progress: 50, stage: 'whisper' });
            const transcription = await transcribeAudio(audioPath, uploadId);
            // Step 7: Perform OCR with Gemini Vision
            console.log(`[${uploadId}] Performing OCR with Gemini Vision...`);
            await updateStatus(uploadId, { status: 'processing', progress: 70, stage: 'ocr' });
            const ocrResults = await extractFramesAndOCR(videoPath, uploadId);
            // Step 8: Generate Excel report
            console.log(`[${uploadId}] Generating Excel report...`);
            await updateStatus(uploadId, { status: 'processing', progress: 85, stage: 'excel' });
            const analysisResult = {
                duration: metadata.duration,
                segmentCount: transcription.length,
                ocrResults: ocrResults,
                transcription: transcription,
                scenes: [] // Could add scene detection
            };
            const excelPath = path.join(tempDir, `${uploadId}_analysis.xlsx`);
            await generateExcelReport(excelPath, fileName, analysisResult);
            // Step 9: Upload result file
            console.log(`[${uploadId}] Uploading results...`);
            await updateStatus(uploadId, { status: 'processing', progress: 90, stage: 'upload_result' });
            const resultUrl = await uploadResultFile(excelPath, uploadId);
            // Complete
            console.log(`[${uploadId}] Processing completed!`);
            await completeStatus(uploadId, resultUrl, {
                duration: metadata.duration,
                segmentCount: analysisResult.segmentCount,
                ocrResultCount: analysisResult.ocrResults.length,
                transcriptionLength: analysisResult.transcription.reduce((sum, seg) => sum + seg.text.length, 0),
            });
        }
        finally {
            // Cleanup
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    }
    catch (error) {
        console.error(`[${uploadId}] Processing failed:`, error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        await failStatus(uploadId, errorMessage);
    }
};
async function downloadFile(url, dest) {
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
async function getVideoMetadata(videoPath) {
    // Simple metadata extraction using file stats
    // In production, use ffprobe for complete metadata
    const stats = fs.statSync(videoPath);
    return {
        duration: 0, // Would need ffprobe
        fileSize: stats.size,
        path: videoPath
    };
}
async function extractAudio(videoPath, audioPath) {
    // In production, use fluent-ffmpeg or similar
    // For now, create a dummy file for testing
    fs.writeFileSync(audioPath, Buffer.from('dummy audio'));
}
//# sourceMappingURL=videoProcessor.js.map