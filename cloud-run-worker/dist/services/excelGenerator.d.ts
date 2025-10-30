interface TranscriptionSegment {
    timestamp: number;
    duration: number;
    text: string;
    confidence: number;
}
interface OCRResult {
    timestamp: number;
    frameIndex: number;
    text: string;
    confidence: number;
}
interface AnalysisResult {
    duration: number;
    segmentCount: number;
    ocrResults: OCRResult[];
    transcription: TranscriptionSegment[];
    scenes: Array<{
        timestamp: number;
        description: string;
    }>;
}
export declare const generateExcelReport: (outputPath: string, fileName: string, analysis: AnalysisResult) => Promise<void>;
export {};
//# sourceMappingURL=excelGenerator.d.ts.map