import path from 'path';
import fs from 'fs';
import OpenAI from 'openai';
import { processAudioWithVAD, extractAudioChunk, cleanupVADFiles } from './vadService.js';
import { getVADConfig, WHISPER_COST } from '../config/vad.js';
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
        // 1. VAD processing
        const vadResult = await runVADDetection(audioPath, chunksDir, uploadId);
        if (vadResult.audioChunks.length === 0) {
            console.log(`[${uploadId}] ═══════════════════════════════════════`);
            console.log(`[${uploadId}] ⚠️  VAD FALLBACK TRIGGERED`);
            console.log(`[${uploadId}] ═══════════════════════════════════════`);
            console.log(`[${uploadId}] No voice segments detected by VAD`);
            console.log(`[${uploadId}] Possible causes:`);
            console.log(`[${uploadId}]   - BGM-only video (no narration)`);
            console.log(`[${uploadId}]   - Speech heavily buried under BGM`);
            console.log(`[${uploadId}]   - VAD sensitivity too conservative`);
            console.log(`[${uploadId}] `);
            console.log(`[${uploadId}] 🔄 FALLBACK: Processing full audio with Whisper`);
            console.log(`[${uploadId}]   Duration: ${vadResult.totalDuration.toFixed(1)}s`);
            console.log(`[${uploadId}]   Strategy: Fixed 30-second chunks`);
            console.log(`[${uploadId}] ═══════════════════════════════════════`);
            // Fallback: Create fixed-duration chunks from full audio (30 seconds)
            const fallbackChunks = await createFallbackChunks(audioPath, vadResult.totalDuration, chunksDir, uploadId);
            if (fallbackChunks.length === 0) {
                console.log(`[${uploadId}] ✗ Fallback failed: No audio to process (duration = 0)`);
                return buildEmptyResult(vadResult);
            }
            console.log(`[${uploadId}] Created ${fallbackChunks.length} fallback chunks (30s each)`);
            // Extract fallback audio chunks
            await extractAllAudioChunks(audioPath, fallbackChunks);
            // Process fallback chunks with Whisper
            const segments = await transcribeChunksWithWhisper(fallbackChunks, uploadId);
            // Calculate statistics (fallback mode)
            const stats = calculateFallbackStatistics(vadResult, fallbackChunks.length, vadResult.totalDuration);
            logFallbackCompletion(uploadId, stats);
            return {
                segments,
                ...stats,
            };
        }
        // 2. Extract audio chunks
        console.log(`[${uploadId}] Step 2: Extracting ${vadResult.audioChunks.length} audio chunks`);
        await extractAllAudioChunks(audioPath, vadResult.audioChunks);
        // 3. Transcribe chunks with Whisper
        const segments = await transcribeChunksWithWhisper(vadResult.audioChunks, uploadId);
        // 4. Calculate statistics
        const stats = calculatePipelineStatistics(vadResult, vadResult.audioChunks.length);
        // 5. Log completion
        logPipelineCompletion(uploadId, stats);
        return {
            segments,
            ...stats,
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
 * Run VAD detection on audio file
 *
 * @param audioPath - Path to audio file
 * @param chunksDir - Directory for temporary chunks
 * @param uploadId - Upload ID for logging
 * @returns VAD processing result
 */
async function runVADDetection(audioPath, chunksDir, uploadId) {
    console.log(`[${uploadId}] Step 1: Voice Activity Detection`);
    // Use centralized VAD configuration (fixes narration detection issue)
    // Reference: .serena/memories/narration_detection_issue_root_cause_2025-11-12.md
    return await processAudioWithVAD(audioPath, chunksDir, getVADConfig());
}
/**
 * Transcribe audio chunks with Whisper
 *
 * @param chunks - Audio chunks from VAD
 * @param uploadId - Upload ID for logging
 * @returns Transcription segments with absolute timestamps
 */
async function transcribeChunksWithWhisper(chunks, uploadId) {
    console.log(`[${uploadId}] Step 3: Transcribing chunks with Whisper`);
    const segments = [];
    for (const chunk of chunks) {
        console.log(`[${uploadId}]   Processing chunk ${chunk.chunkIndex + 1}/${chunks.length}`);
        const chunkSegments = await transcribeAudioChunk(chunk, uploadId);
        // Adjust timestamps to absolute time
        for (const segment of chunkSegments) {
            segments.push({
                ...segment,
                timestamp: chunk.startTime + segment.timestamp, // Add chunk offset
                chunkIndex: chunk.chunkIndex,
            });
        }
    }
    return segments;
}
/**
 * Calculate pipeline statistics (VAD + Whisper)
 *
 * @param vadResult - VAD processing result
 * @param totalWhisperCalls - Number of Whisper API calls
 * @returns Pipeline statistics
 */
function calculatePipelineStatistics(vadResult, totalWhisperCalls) {
    const totalAudioProcessed = vadResult.totalVoiceDuration;
    const estimatedCost = (totalAudioProcessed / 60) * WHISPER_COST.PER_MINUTE;
    return {
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
/**
 * Build empty pipeline result (no voice detected)
 *
 * @param vadResult - VAD result with no voice chunks
 * @returns Empty pipeline result
 */
function buildEmptyResult(vadResult) {
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
/**
 * Log pipeline completion statistics
 *
 * @param uploadId - Upload ID for logging
 * @param stats - Pipeline statistics
 */
function logPipelineCompletion(uploadId, stats) {
    console.log(`[${uploadId}] ✓ Pipeline complete`);
    console.log(`[${uploadId}]   Voice ratio: ${(stats.vadStats.voiceRatio * 100).toFixed(1)}%`);
    console.log(`[${uploadId}]   Whisper calls: ${stats.whisperStats.totalCalls}`);
    console.log(`[${uploadId}]   Cost: $${stats.whisperStats.estimatedCost.toFixed(4)}`);
    console.log(`[${uploadId}]   Savings: ${stats.vadStats.estimatedSavings.toFixed(1)}%`);
}
/**
 * Validate that the chunk file exists
 *
 * @param chunk - Audio chunk metadata
 * @param uploadId - Upload ID for logging
 * @returns True if file exists, false otherwise
 */
function validateChunkFile(chunk, uploadId) {
    if (!fs.existsSync(chunk.filePath)) {
        console.error(`[${uploadId}] Chunk file not found: ${chunk.filePath}`);
        return false;
    }
    return true;
}
/**
 * Prepare Whisper API request parameters
 *
 * @param chunk - Audio chunk metadata
 * @returns Whisper API request parameters
 */
function prepareWhisperRequest(chunk) {
    const audioBuffer = fs.readFileSync(chunk.filePath);
    const file = new File([audioBuffer], path.basename(chunk.filePath), { type: 'audio/mpeg' });
    return {
        file,
        model: 'whisper-1',
        language: 'ja', // Japanese
        response_format: 'verbose_json',
        temperature: 0,
    };
}
/**
 * Call Whisper API for transcription
 *
 * @param params - Whisper API request parameters
 * @returns Whisper API response
 */
async function callWhisperAPI(params) {
    const response = await openai.audio.transcriptions.create(params);
    return response;
}
/**
 * Parse Whisper API response into transcription segments
 *
 * @param responseData - Whisper API response
 * @param chunk - Audio chunk metadata
 * @returns Transcription segments (relative to chunk start)
 */
function parseWhisperResponse(responseData, chunk) {
    const segments = [];
    if (responseData.segments && Array.isArray(responseData.segments)) {
        // Detailed segments format
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
    return segments;
}
/**
 * Determine if a Whisper API error should trigger a retry
 *
 * @param error - Error object
 * @returns True if should retry, false for fatal errors
 */
function shouldRetry(error) {
    const errorMessage = error.message;
    // Fatal errors: API key issues, invalid requests
    return !(errorMessage.includes('API key') || errorMessage.includes('Invalid'));
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
            // 1. Validate chunk file exists
            if (!validateChunkFile(chunk, uploadId)) {
                return []; // Abort, no retry for missing files
            }
            // 2. Prepare Whisper API request
            const params = prepareWhisperRequest(chunk);
            // 3. Call Whisper API
            const responseData = await callWhisperAPI(params);
            // 4. Parse response into transcription segments
            return parseWhisperResponse(responseData, chunk);
        }
        catch (error) {
            const err = error;
            // Check if it's a fatal error (don't retry)
            if (!shouldRetry(err)) {
                console.error(`[${uploadId}] Fatal Whisper error (no retry): ${err.message}`);
                return []; // Abort
            }
            // Retry on temporary errors
            console.warn(`[${uploadId}] Whisper API attempt ${attempt}/${maxRetries} failed for chunk ${chunk.chunkIndex}:`, err.message);
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
/**
 * Create fallback audio chunks (fixed 30-second intervals)
 *
 * Used when VAD detects no voice segments (BGM-only videos, etc.)
 * Splits full audio into fixed-duration chunks for Whisper processing.
 *
 * @param audioPath - Path to full audio file
 * @param totalDuration - Total audio duration in seconds
 * @param chunksDir - Directory for chunk files
 * @param uploadId - Upload ID for logging
 * @returns Array of fixed-duration audio chunks
 */
async function createFallbackChunks(audioPath, totalDuration, chunksDir, uploadId) {
    const FALLBACK_CHUNK_DURATION = 30; // 30 seconds per chunk
    const chunks = [];
    if (totalDuration <= 0) {
        console.warn(`[${uploadId}] Total duration is 0, cannot create fallback chunks`);
        return chunks;
    }
    let currentTime = 0;
    let chunkIndex = 0;
    while (currentTime < totalDuration) {
        const chunkDuration = Math.min(FALLBACK_CHUNK_DURATION, totalDuration - currentTime);
        const chunkPath = path.join(chunksDir, `fallback-chunk-${chunkIndex.toString().padStart(4, '0')}.mp3`);
        chunks.push({
            chunkIndex,
            startTime: currentTime,
            endTime: currentTime + chunkDuration,
            duration: chunkDuration,
            filePath: chunkPath,
            voiceSegments: [], // No VAD segments in fallback mode
        });
        currentTime += chunkDuration;
        chunkIndex++;
    }
    console.log(`[${uploadId}] Created ${chunks.length} fallback chunks (30s fixed intervals)`);
    return chunks;
}
/**
 * Calculate pipeline statistics for fallback mode
 *
 * @param vadResult - VAD result (with 0 chunks detected)
 * @param totalWhisperCalls - Number of Whisper API calls (fallback chunks)
 * @param totalAudioProcessed - Total audio processed (full duration)
 * @returns Fallback statistics
 */
function calculateFallbackStatistics(vadResult, totalWhisperCalls, totalAudioProcessed) {
    const estimatedCost = (totalAudioProcessed / 60) * WHISPER_COST.PER_MINUTE;
    return {
        vadStats: {
            totalDuration: vadResult.totalDuration,
            voiceDuration: totalAudioProcessed, // Full audio processed in fallback
            voiceRatio: 1.0, // 100% (fallback assumes full audio is relevant)
            estimatedSavings: 0, // No savings in fallback mode
            chunksProcessed: totalWhisperCalls,
        },
        whisperStats: {
            totalCalls: totalWhisperCalls,
            totalAudioProcessed,
            estimatedCost,
        },
    };
}
/**
 * Log fallback completion statistics
 *
 * @param uploadId - Upload ID for logging
 * @param stats - Pipeline statistics (fallback mode)
 */
function logFallbackCompletion(uploadId, stats) {
    console.log(`[${uploadId}] ═══════════════════════════════════════`);
    console.log(`[${uploadId}] ✓ FALLBACK PIPELINE COMPLETE`);
    console.log(`[${uploadId}] ═══════════════════════════════════════`);
    console.log(`[${uploadId}]   Mode: Full audio transcription (VAD bypassed)`);
    console.log(`[${uploadId}]   Whisper calls: ${stats.whisperStats.totalCalls}`);
    console.log(`[${uploadId}]   Audio processed: ${stats.whisperStats.totalAudioProcessed.toFixed(1)}s (100%)`);
    console.log(`[${uploadId}]   Estimated cost: $${stats.whisperStats.estimatedCost.toFixed(4)}`);
    console.log(`[${uploadId}]   Cost savings: 0% (full audio processed)`);
    console.log(`[${uploadId}] ═══════════════════════════════════════`);
}
//# sourceMappingURL=audioWhisperPipeline.js.map