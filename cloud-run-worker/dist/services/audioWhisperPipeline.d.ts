import type { TranscriptionSegment } from '../types/shared.js';
export interface PipelineResult {
    /** Transcription segments with timestamps */
    segments: TranscriptionSegment[];
    /** VAD processing statistics */
    vadStats: {
        totalDuration: number;
        voiceDuration: number;
        voiceRatio: number;
        estimatedSavings: number;
        chunksProcessed: number;
    };
    /** Whisper API call statistics */
    whisperStats: {
        totalCalls: number;
        totalAudioProcessed: number;
        estimatedCost: number;
    };
}
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
export declare function processAudioWithVADAndWhisper(audioPath: string, uploadId: string): Promise<PipelineResult>;
//# sourceMappingURL=audioWhisperPipeline.d.ts.map