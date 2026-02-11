import path from 'path';
import fs from 'fs';
import OpenAI from 'openai';
import pLimit from 'p-limit';
import { processAudioWithVAD, extractAudioChunk, cleanupVADFiles } from './vadService.js';
import { splitAudioIntoChunks, cleanupPreChunks, getAudioMetadata } from './audioExtractor.js';
import { getVADConfig, WHISPER_COST, DEFAULT_PRE_CHUNK_CONFIG } from '../config/vad.js';
import { addCompletedAudioChunks, WHISPER_CHECKPOINT_INTERVAL, } from './checkpointService.js';
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
 * @param checkpoint - Optional checkpoint for resumable processing
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
export async function processAudioWithVADAndWhisper(audioPath, uploadId, checkpoint) {
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
        // 3. Transcribe chunks with Whisper (with checkpoint support)
        const segments = await transcribeChunksWithWhisper(vadResult.audioChunks, uploadId, 5, // concurrency
        checkpoint);
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
 * For long audio files (>10 minutes), splits audio into 5-minute chunks
 * before VAD processing to prevent "Maximum call stack size exceeded" errors.
 *
 * @param audioPath - Path to audio file
 * @param chunksDir - Directory for temporary chunks
 * @param uploadId - Upload ID for logging
 * @returns VAD processing result
 */
async function runVADDetection(audioPath, chunksDir, uploadId) {
    console.log(`[${uploadId}] Step 1: Voice Activity Detection`);
    // Get audio duration to check if pre-chunking is needed
    let audioDuration;
    try {
        const metadata = await getAudioMetadata(audioPath);
        audioDuration = metadata.duration;
        console.log(`[${uploadId}] Audio duration: ${audioDuration.toFixed(1)}s (${(audioDuration / 60).toFixed(1)} minutes)`);
    }
    catch (error) {
        console.warn(`[${uploadId}] Could not get audio duration, proceeding without pre-chunking`);
        // Fallback: process without pre-chunking
        return await processAudioWithVAD(audioPath, chunksDir, getVADConfig());
    }
    // Check if pre-chunking is needed (audio > 10 minutes)
    if (!DEFAULT_PRE_CHUNK_CONFIG.enabled || audioDuration < DEFAULT_PRE_CHUNK_CONFIG.minDurationForChunking) {
        console.log(`[${uploadId}] Pre-chunking not needed, processing full audio`);
        return await processAudioWithVAD(audioPath, chunksDir, getVADConfig());
    }
    // Pre-chunk the audio for long files
    console.log(`[${uploadId}] ═══════════════════════════════════════`);
    console.log(`[${uploadId}] 🔀 PRE-CHUNKING MODE ACTIVATED`);
    console.log(`[${uploadId}] ═══════════════════════════════════════`);
    console.log(`[${uploadId}] Audio is ${(audioDuration / 60).toFixed(1)} minutes (>${(DEFAULT_PRE_CHUNK_CONFIG.minDurationForChunking / 60).toFixed(0)} min threshold)`);
    console.log(`[${uploadId}] Will split into ${DEFAULT_PRE_CHUNK_CONFIG.chunkDuration / 60}-minute chunks`);
    const preChunksDir = path.join(path.dirname(audioPath), 'pre-chunks');
    try {
        // Split audio into 5-minute chunks
        const preChunks = await splitAudioIntoChunks(audioPath, preChunksDir, audioDuration, DEFAULT_PRE_CHUNK_CONFIG);
        if (preChunks.length === 0) {
            console.log(`[${uploadId}] Pre-chunking returned 0 chunks, falling back to full audio`);
            return await processAudioWithVAD(audioPath, chunksDir, getVADConfig());
        }
        console.log(`[${uploadId}] Created ${preChunks.length} pre-chunks, processing each with VAD...`);
        // Process each pre-chunk with VAD and collect results
        const vadResults = [];
        for (const preChunk of preChunks) {
            console.log(`[${uploadId}] Processing pre-chunk ${preChunk.index + 1}/${preChunks.length} (${preChunk.startTime.toFixed(1)}s - ${preChunk.endTime.toFixed(1)}s)`);
            // Create separate output dir for each pre-chunk's VAD chunks
            const preChunkVADDir = path.join(chunksDir, `prechunk-${preChunk.index}`);
            const result = await processAudioWithVAD(preChunk.filePath, preChunkVADDir, getVADConfig());
            vadResults.push({
                result,
                offset: preChunk.startTime,
            });
        }
        // Merge VAD results with proper timestamp adjustment
        const mergedResult = mergeVADResults(vadResults, audioDuration, uploadId);
        console.log(`[${uploadId}] ═══════════════════════════════════════`);
        console.log(`[${uploadId}] ✓ PRE-CHUNKING COMPLETE`);
        console.log(`[${uploadId}] ═══════════════════════════════════════`);
        console.log(`[${uploadId}] Pre-chunks processed: ${preChunks.length}`);
        console.log(`[${uploadId}] Total voice segments: ${mergedResult.voiceSegments.length}`);
        console.log(`[${uploadId}] Total audio chunks: ${mergedResult.audioChunks.length}`);
        return mergedResult;
    }
    finally {
        // Cleanup pre-chunk files
        await cleanupPreChunks(preChunksDir);
    }
}
/**
 * Merge VAD results from multiple pre-chunks into a single result
 *
 * Applies timestamp offsets and removes duplicate segments at chunk boundaries.
 *
 * @param vadResults - Array of VAD results with their time offsets
 * @param totalDuration - Total audio duration in seconds
 * @param uploadId - Upload ID for logging
 * @returns Merged VAD result with adjusted timestamps
 */
function mergeVADResults(vadResults, totalDuration, uploadId) {
    console.log(`[${uploadId}] Merging ${vadResults.length} VAD results...`);
    const allVoiceSegments = [];
    const allAudioChunks = [];
    let totalVoiceDuration = 0;
    // Track chunk index across all pre-chunks
    let globalChunkIndex = 0;
    for (const { result, offset } of vadResults) {
        // Adjust voice segment timestamps
        for (const segment of result.voiceSegments) {
            allVoiceSegments.push({
                ...segment,
                startTime: segment.startTime + offset,
                endTime: segment.endTime + offset,
            });
        }
        // Adjust audio chunk timestamps and indices
        for (const chunk of result.audioChunks) {
            allAudioChunks.push({
                ...chunk,
                chunkIndex: globalChunkIndex,
                startTime: chunk.startTime + offset,
                endTime: chunk.endTime + offset,
                voiceSegments: chunk.voiceSegments.map(seg => ({
                    ...seg,
                    startTime: seg.startTime + offset,
                    endTime: seg.endTime + offset,
                })),
            });
            globalChunkIndex++;
        }
        totalVoiceDuration += result.totalVoiceDuration;
    }
    // Remove duplicate segments at chunk boundaries (within 100ms overlap window)
    const deduplicatedSegments = deduplicateSegments(allVoiceSegments, 0.1);
    const deduplicatedChunks = deduplicateChunks(allAudioChunks, 0.1);
    console.log(`[${uploadId}] After deduplication: ${deduplicatedSegments.length} segments, ${deduplicatedChunks.length} chunks`);
    // Calculate merged statistics
    const voiceRatio = totalDuration > 0 ? totalVoiceDuration / totalDuration : 0;
    const fullAudioCost = (totalDuration / 60) * WHISPER_COST.PER_MINUTE;
    const vadAudioCost = (totalVoiceDuration / 60) * WHISPER_COST.PER_MINUTE;
    const estimatedSavings = fullAudioCost > 0 ? ((fullAudioCost - vadAudioCost) / fullAudioCost) * 100 : 0;
    return {
        totalDuration,
        totalVoiceDuration,
        voiceSegments: deduplicatedSegments,
        audioChunks: deduplicatedChunks,
        voiceRatio,
        estimatedSavings,
    };
}
/**
 * Remove duplicate voice segments at chunk boundaries
 *
 * @param segments - All voice segments from all pre-chunks
 * @param threshold - Time threshold in seconds for considering segments as duplicates
 * @returns Deduplicated voice segments
 */
function deduplicateSegments(segments, threshold) {
    if (segments.length === 0)
        return [];
    // Sort by start time
    const sorted = [...segments].sort((a, b) => a.startTime - b.startTime);
    const result = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
        const current = sorted[i];
        const last = result[result.length - 1];
        // Check if this segment overlaps with the previous one
        if (current.startTime - last.endTime > threshold) {
            // No overlap, add as new segment
            result.push(current);
        }
        else if (current.endTime > last.endTime) {
            // Overlapping, extend the previous segment
            last.endTime = current.endTime;
            last.duration = last.endTime - last.startTime;
        }
        // Otherwise, current is completely contained in last, skip it
    }
    return result;
}
/**
 * Remove duplicate audio chunks at chunk boundaries
 *
 * @param chunks - All audio chunks from all pre-chunks
 * @param threshold - Time threshold in seconds for considering chunks as duplicates
 * @returns Deduplicated audio chunks with re-indexed chunk numbers
 */
function deduplicateChunks(chunks, threshold) {
    if (chunks.length === 0)
        return [];
    // Sort by start time
    const sorted = [...chunks].sort((a, b) => a.startTime - b.startTime);
    const result = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
        const current = sorted[i];
        const last = result[result.length - 1];
        // Check if this chunk overlaps with the previous one
        if (current.startTime - last.endTime > threshold) {
            // No overlap, add as new chunk
            result.push(current);
        }
        // Otherwise, skip this chunk (it's a duplicate from overlap)
    }
    // Re-index chunks
    return result.map((chunk, index) => ({
        ...chunk,
        chunkIndex: index,
    }));
}
/**
 * Transcribe audio chunks with Whisper (parallel processing with checkpoint support)
 *
 * Uses pLimit to control concurrency and process multiple chunks simultaneously.
 * Default concurrency: 5 parallel Whisper API calls
 *
 * @param chunks - Audio chunks from VAD
 * @param uploadId - Upload ID for logging
 * @param concurrency - Number of parallel Whisper API calls (default: 5)
 * @param checkpoint - Optional checkpoint for resumable processing
 * @returns Transcription segments with absolute timestamps (sorted by time)
 */
async function transcribeChunksWithWhisper(chunks, uploadId, concurrency = 5, checkpoint) {
    // Check for already completed chunks from checkpoint
    const completedChunkIndices = new Set(checkpoint?.completedAudioChunks || []);
    const cachedSegments = checkpoint?.transcriptionSegments || [];
    // Filter out already completed chunks
    const chunksToProcess = chunks.filter(chunk => !completedChunkIndices.has(chunk.chunkIndex));
    if (completedChunkIndices.size > 0) {
        console.log(`[${uploadId}] ▶️ Resuming Whisper transcription`);
        console.log(`[${uploadId}]   - Already completed: ${completedChunkIndices.size}/${chunks.length} chunks`);
        console.log(`[${uploadId}]   - Cached segments: ${cachedSegments.length}`);
        console.log(`[${uploadId}]   - Remaining to process: ${chunksToProcess.length} chunks`);
    }
    console.log(`[${uploadId}] Step 3: Transcribing ${chunksToProcess.length} chunks with Whisper (${concurrency} parallel)`);
    const startTime = Date.now();
    const limit = pLimit(concurrency);
    // Track progress
    let completedChunks = completedChunkIndices.size;
    const totalChunks = chunks.length;
    // Accumulate new segments for checkpoint
    const newSegments = [];
    const newCompletedIndices = [];
    // Process remaining chunks in parallel with concurrency limit
    const chunkResults = await Promise.all(chunksToProcess.map(chunk => limit(async () => {
        const chunkSegments = await transcribeAudioChunk(chunk, uploadId);
        completedChunks++;
        const percent = ((completedChunks / totalChunks) * 100).toFixed(0);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`[${uploadId}]   Completed chunk ${chunk.chunkIndex + 1}/${totalChunks} (${percent}% in ${elapsed}s)`);
        // Return segments with adjusted timestamps
        const adjustedSegments = chunkSegments.map(segment => ({
            ...segment,
            timestamp: chunk.startTime + segment.timestamp, // Add chunk offset
            chunkIndex: chunk.chunkIndex,
        }));
        // Track for checkpoint
        newSegments.push(...adjustedSegments);
        newCompletedIndices.push(chunk.chunkIndex);
        // Save checkpoint every WHISPER_CHECKPOINT_INTERVAL chunks
        if (checkpoint && newCompletedIndices.length > 0 && newCompletedIndices.length % WHISPER_CHECKPOINT_INTERVAL === 0) {
            try {
                await addCompletedAudioChunks(uploadId, newCompletedIndices, newSegments);
                console.log(`[${uploadId}] 💾 Checkpoint saved: ${completedChunks}/${totalChunks} chunks`);
            }
            catch (err) {
                console.warn(`[${uploadId}] ⚠️ Failed to save checkpoint: ${err}`);
            }
        }
        return adjustedSegments;
    })));
    // Save final checkpoint for new chunks
    if (checkpoint && newCompletedIndices.length > 0) {
        try {
            await addCompletedAudioChunks(uploadId, newCompletedIndices, newSegments);
            console.log(`[${uploadId}] 💾 Final Whisper checkpoint saved: ${completedChunks}/${totalChunks} chunks`);
        }
        catch (err) {
            console.warn(`[${uploadId}] ⚠️ Failed to save final checkpoint: ${err}`);
        }
    }
    // Combine cached segments with new results
    const allNewSegments = chunkResults.flat();
    const allSegments = [...cachedSegments, ...allNewSegments].sort((a, b) => a.timestamp - b.timestamp);
    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[${uploadId}] ✓ Whisper parallel processing complete: ${allSegments.length} segments in ${totalDuration}s`);
    return allSegments;
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