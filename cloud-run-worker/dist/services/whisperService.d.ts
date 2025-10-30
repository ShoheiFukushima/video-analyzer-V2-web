interface TranscriptionSegment {
    timestamp: number;
    duration: number;
    text: string;
    confidence: number;
}
export declare const transcribeAudio: (audioPath: string, uploadId: string) => Promise<TranscriptionSegment[]>;
export {};
//# sourceMappingURL=whisperService.d.ts.map