/**
 * OCR Router
 *
 * Manages multiple OCR providers with intelligent routing, fallback,
 * and load distribution for high-speed parallel OCR processing.
 *
 * Features:
 * - Multi-provider load balancing
 * - Automatic failover on provider errors
 * - Priority-based routing
 * - Parallel batch processing with distribution
 * - Long video (1h+) automatic parallel optimization
 *
 * @author Claude Code (Anthropic)
 * @since 2026-02-08
 */
import { OCRResult, OCRProviderStats } from './ocrProviderInterface.js';
/**
 * OCR Router configuration
 */
export interface OCRRouterConfig {
    /** Enable multi-provider routing */
    enableMultiProvider: boolean;
    /** Maximum total parallel requests across all providers */
    maxTotalParallel: number;
    /** Retry with next provider on failure */
    enableFallback: boolean;
    /** Distribution strategy: 'round-robin' | 'priority' | 'load-balanced' */
    distributionStrategy: 'round-robin' | 'priority' | 'load-balanced';
    /** Auto-enable parallel boost for videos > 1 hour */
    autoParallelBoostThreshold: number;
    /** Parallel boost multiplier for long videos */
    parallelBoostMultiplier: number;
}
/**
 * Batch processing result
 */
export interface BatchOCRResult {
    results: OCRResult[];
    stats: {
        totalProcessed: number;
        successCount: number;
        failureCount: number;
        processingTimeMs: number;
        providerUsage: Record<string, number>;
    };
}
/**
 * Image with metadata for batch processing
 */
export interface ImageTask {
    id: number;
    imageBuffer: Buffer;
    metadata?: Record<string, unknown>;
}
/**
 * OCR Router for multi-provider processing
 */
export declare class OCRRouter {
    private readonly config;
    private readonly providers;
    private roundRobinIndex;
    private isLongVideo;
    constructor(config?: Partial<OCRRouterConfig>);
    /**
     * Initialize available providers
     * Priority order: Gemini (1) > Mistral (2) > GLM (3)
     * Note: OpenAI excluded — unreliable for OCR (rate limits, empty responses)
     */
    private initializeProviders;
    /**
     * Configure for long video processing (1h+)
     * Automatically increases parallelism for better performance
     */
    setVideoDuration(durationSeconds: number): void;
    /**
     * Get the effective parallel limit
     */
    private getEffectiveParallelLimit;
    /**
     * Get all available providers (enabled and not rate-limited)
     */
    private getAvailableProviders;
    /**
     * Select the best provider for the next request
     */
    private selectProvider;
    /**
     * Round-robin provider selection
     */
    private selectRoundRobin;
    /**
     * Load-balanced provider selection
     * Prefers providers with lower current load and faster response times
     */
    private selectLoadBalanced;
    /**
     * Process a single image with fallback
     */
    processWithFallback(imageBuffer: Buffer): Promise<OCRResult>;
    /**
     * Process multiple images in parallel with intelligent distribution
     *
     * Distributes work across all available providers for maximum throughput.
     */
    processParallel(tasks: ImageTask[]): Promise<BatchOCRResult>;
    /**
     * Get statistics from all providers
     */
    getAllProviderStats(): Record<string, OCRProviderStats>;
    /**
     * Check if any provider is available
     */
    hasAvailableProvider(): boolean;
    /**
     * Get the count of available providers
     */
    getAvailableProviderCount(): number;
    /**
     * Log router status
     */
    logStatus(): void;
}
/**
 * Get or create the OCR router singleton
 */
export declare function getOCRRouter(config?: Partial<OCRRouterConfig>): OCRRouter;
/**
 * Reset the OCR router (for testing)
 */
export declare function resetOCRRouter(): void;
/**
 * Process a single image with the default router
 */
export declare function performOCR(imageBuffer: Buffer): Promise<OCRResult>;
/**
 * Process multiple images in parallel with the default router
 */
export declare function performBatchOCR(images: Buffer[], videoDurationSeconds?: number): Promise<BatchOCRResult>;
//# sourceMappingURL=ocrRouter.d.ts.map