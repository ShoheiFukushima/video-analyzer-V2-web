interface OCRResult {
    timestamp: number;
    frameIndex: number;
    text: string;
    confidence: number;
}
export declare const extractFramesAndOCR: (videoPath: string, uploadId: string) => Promise<OCRResult[]>;
export declare const performOCROnImage: (imagePath: string, uploadId: string, frameIndex: number, timestamp: number) => Promise<OCRResult | null>;
export {};
//# sourceMappingURL=ocrService.d.ts.map