import path from 'path';
import fs from 'fs';
import OpenAI from 'openai';
import { processAudioWithVAD, extractAudioChunk, cleanupVADFiles } from './vadService.js';
/**
 * VAD + Whisper Integration Pipeline
 *
 * Optimizes Whisper API costs by:
 * 1. Detecting voice segments with VAD
 * 2. Extracting only voice portions
 * 3. Processing them with Whisper
 * 4. Combining results with accurate timestamps
 *
 * Benefits:
 * - 40-60% cost reduction vs processing full audio
 * - No hallucination on silent portions
 * - Better accuracy with 10-second chunks
 */
// Validate API key at module initialization
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY || OPENAI_API_KEY.trim() === '') {
    throw new Error('OPENAI_API_KEY environment variable is not set. ' +
        'Please configure it in .env file or environment variables.');
}
const openai = new OpenAI({
    apiKey: OPENAI_API_KEY,
});
/**
 * Process audio file through VAD + Whisper pipeline
 *
 * @param audioPath - Path to full audio file (16kHz mono MP3)
 * @param uploadId - Upload ID for logging
 * @returns Transcription segments with VAD statistics
 *
 * @example
 * ```typescript
 * const result = await processAudioWithVADAndWhisper(
 *   '/tmp/audio.mp3',
 *   'upload-123'
 * );
 * console.log(`Processed ${result.vadStats.chunksProcessed} chunks`);
 * console.log(`Cost savings: ${result.vadStats.estimatedSavings.toFixed(1)}%`);
 * ```
 */
export async function processAudioWithVADAndWhisper(audioPath, uploadId) {
    console.log(`[${uploadId}] Starting VAD + Whisper pipeline`);
    const chunksDir = path.join(path.dirname(audioPath), 'vad-chunks');
    try {
        // Step 1: VAD processing
        console.log(`[${uploadId}] Step 1: Voice Activity Detection`);
        const vadResult = await processAudioWithVAD(audioPath, chunksDir, {
            maxChunkDuration: 10, // 10-second chunks for Whisper
            minSpeechDuration: 0.25, // Filter out very short segments
            sensitivity: 0.5, // Balanced sensitivity
        });
        if (vadResult.audioChunks.length === 0) {
            console.log(`[${uploadId}] No voice detected, returning empty transcription`);
            return {
                segments: [],
                vadStats: {
                    totalDuration: vadResult.totalDuration,
                    voiceDuration: vadResult.totalVoiceDuration,
                    voiceRatio: vadResult.voiceRatio,
                    estimatedSavings: vadResult.estimatedSavings,
                    chunksProcessed: 0,
                },
                whisperStats: {
                    totalCalls: 0,
                    totalAudioProcessed: 0,
                    estimatedCost: 0,
                },
            };
        }
        // Step 2: Extract audio chunks
        console.log(`[${uploadId}] Step 2: Extracting ${vadResult.audioChunks.length} audio chunks`);
        await extractAllAudioChunks(audioPath, vadResult.audioChunks);
        // Step 3: Transcribe each chunk with Whisper
        console.log(`[${uploadId}] Step 3: Transcribing chunks with Whisper`);
        const segments = [];
        let totalWhisperCalls = 0;
        for (const chunk of vadResult.audioChunks) {
            console.log(`[${uploadId}]   Processing chunk ${chunk.chunkIndex + 1}/${vadResult.audioChunks.length}`);
            const chunkSegments = await transcribeAudioChunk(chunk, uploadId);
            // Adjust timestamps to absolute time
            for (const segment of chunkSegments) {
                segments.push({
                    ...segment,
                    timestamp: chunk.startTime + segment.timestamp, // Add chunk offset
                    chunkIndex: chunk.chunkIndex,
                });
            }
            totalWhisperCalls++;
        }
        // Calculate Whisper statistics
        const totalAudioProcessed = vadResult.totalVoiceDuration;
        const estimatedCost = (totalAudioProcessed / 60) * 0.006; // $0.006/minute
        console.log(`[${uploadId}] ✓ Pipeline complete`);
        console.log(`[${uploadId}]   Voice ratio: ${(vadResult.voiceRatio * 100).toFixed(1)}%`);
        console.log(`[${uploadId}]   Whisper calls: ${totalWhisperCalls}`);
        console.log(`[${uploadId}]   Cost: $${estimatedCost.toFixed(4)}`);
        console.log(`[${uploadId}]   Savings: ${vadResult.estimatedSavings.toFixed(1)}%`);
        return {
            segments,
            vadStats: {
                totalDuration: vadResult.totalDuration,
                voiceDuration: vadResult.totalVoiceDuration,
                voiceRatio: vadResult.voiceRatio,
                estimatedSavings: vadResult.estimatedSavings,
                chunksProcessed: vadResult.audioChunks.length,
            },
            whisperStats: {
                totalCalls: totalWhisperCalls,
                totalAudioProcessed,
                estimatedCost,
            },
        };
    }
    finally {
        // Cleanup temporary chunk files
        await cleanupVADFiles(chunksDir);
    }
}
/**
 * Extract all audio chunks from original file
 *
 * @param audioPath - Original audio file
 * @param chunks - Chunk metadata from VAD
 */
async function extractAllAudioChunks(audioPath, chunks) {
    for (const chunk of chunks) {
        await extractAudioChunk(audioPath, chunk);
    }
}
/**
 * Transcribe a single audio chunk with Whisper (with retry logic)
 *
 * @param chunk - Audio chunk metadata
 * @param uploadId - Upload ID for logging
 * @returns Transcription segments (relative to chunk start)
 */
async function transcribeAudioChunk(chunk, uploadId) {
    const maxRetries = 3;
    const baseDelay = 1000; // 1 second
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            // Check if chunk file exists (abort on missing file)
            if (!fs.existsSync(chunk.filePath)) {
                console.error(`[${uploadId}] Chunk file not found: ${chunk.filePath}`);
                return []; // Abort, no retry for missing files
            }
            const audioBuffer = fs.readFileSync(chunk.filePath);
            const file = new File([audioBuffer], path.basename(chunk.filePath), { type: 'audio/mpeg' });
            // Call Whisper API
            const createParams = {
                file: file,
                model: 'whisper-1',
                language: 'ja', // Japanese
                response_format: 'verbose_json',
                temperature: 0,
            };
            const response = await openai.audio.transcriptions.create(createParams);
            const responseData = response;
            const segments = [];
            if (responseData.segments && Array.isArray(responseData.segments)) {
                for (const segment of responseData.segments) {
                    segments.push({
                        timestamp: segment.start || 0, // Relative to chunk start
                        duration: (segment.end || 0) - (segment.start || 0),
                        text: segment.text || '',
                        confidence: segment.confidence || 0.95,
                    });
                }
            }
            else if (responseData.text) {
                // Simple format: single segment
                segments.push({
                    timestamp: 0,
                    duration: chunk.duration,
                    text: responseData.text,
                    confidence: 0.95,
                });
            }
            // Success - return segments
            return segments;
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            // Check if it's a fatal error (don't retry)
            if (errorMessage.includes('API key') || errorMessage.includes('Invalid')) {
                console.error(`[${uploadId}] Fatal Whisper error (no retry): ${errorMessage}`);
                return []; // Abort
            }
            // Retry on temporary errors
            console.warn(`[${uploadId}] Whisper API attempt ${attempt}/${maxRetries} failed for chunk ${chunk.chunkIndex}:`, errorMessage);
            if (attempt < maxRetries) {
                // Exponential backoff: 1s, 2s, 4s
                const delay = baseDelay * Math.pow(2, attempt - 1);
                console.log(`[${uploadId}] Retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
            else {
                // Final attempt failed
                console.error(`[${uploadId}] All ${maxRetries} attempts failed for chunk ${chunk.chunkIndex}`);
                return [];
            }
        }
    }
    // Should never reach here, but TypeScript requires it
    return [];
}
//# sourceMappingURL=audioWhisperPipeline.js.map