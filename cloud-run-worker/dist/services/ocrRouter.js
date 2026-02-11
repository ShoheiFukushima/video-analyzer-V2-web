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
import pLimit from 'p-limit';
import { createGeminiProvider } from './providers/geminiProvider.js';
import { createMistralProvider } from './providers/mistralProvider.js';
import { createGLMProvider } from './providers/glmProvider.js';
import { createOpenAIProvider } from './providers/openaiProvider.js';
// ============================================================
// Default Configuration
// ============================================================
const DEFAULT_CONFIG = {
    enableMultiProvider: true,
    maxTotalParallel: 30,
    enableFallback: true,
    distributionStrategy: 'load-balanced',
    autoParallelBoostThreshold: 3600, // 1 hour
    parallelBoostMultiplier: 2, // Double parallelism for long videos
};
// ============================================================
// OCR Router Implementation
// ============================================================
/**
 * OCR Router for multi-provider processing
 */
export class OCRRouter {
    constructor(config = {}) {
        this.providers = [];
        this.roundRobinIndex = 0;
        this.isLongVideo = false;
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.initializeProviders();
        console.log(`[OCRRouter] Initialized with ${this.providers.length} providers:`);
        this.providers.forEach((p) => {
            console.log(`  - ${p.name}: priority=${p.priority}, enabled=${p.enabled}`);
        });
        console.log(`[OCRRouter] Strategy: ${this.config.distributionStrategy}`);
        console.log(`[OCRRouter] Auto parallel boost: videos > ${this.config.autoParallelBoostThreshold}s`);
    }
    /**
     * Initialize available providers
     * Priority order: Gemini (1) > Mistral (2) > GLM (3) > OpenAI (4)
     */
    initializeProviders() {
        // Try to create each provider
        const gemini = createGeminiProvider();
        const mistral = createMistralProvider();
        const glm = createGLMProvider();
        const openai = createOpenAIProvider();
        // Collect all non-null providers
        const candidates = [];
        if (gemini)
            candidates.push(gemini);
        if (mistral)
            candidates.push(mistral);
        if (glm)
            candidates.push(glm);
        if (openai)
            candidates.push(openai);
        // Filter enabled providers and sort by priority
        const enabledProviders = candidates.filter((p) => p.enabled);
        enabledProviders.sort((a, b) => a.priority - b.priority);
        this.providers.push(...enabledProviders);
        if (this.providers.length === 0) {
            console.warn('[OCRRouter] No OCR providers available! OCR will fail.');
        }
    }
    /**
     * Configure for long video processing (1h+)
     * Automatically increases parallelism for better performance
     */
    setVideoDuration(durationSeconds) {
        this.isLongVideo = durationSeconds > this.config.autoParallelBoostThreshold;
        if (this.isLongVideo) {
            console.log(`[OCRRouter] Long video detected (${(durationSeconds / 60).toFixed(1)} min). ` +
                `Enabling parallel boost (${this.config.parallelBoostMultiplier}x)`);
        }
    }
    /**
     * Get the effective parallel limit
     */
    getEffectiveParallelLimit() {
        const baseLimit = this.config.maxTotalParallel;
        return this.isLongVideo ? baseLimit * this.config.parallelBoostMultiplier : baseLimit;
    }
    /**
     * Get all available providers (enabled and not rate-limited)
     */
    getAvailableProviders() {
        return this.providers.filter((p) => p.isAvailable());
    }
    /**
     * Select the best provider for the next request
     */
    selectProvider() {
        const available = this.getAvailableProviders();
        if (available.length === 0)
            return null;
        switch (this.config.distributionStrategy) {
            case 'round-robin':
                return this.selectRoundRobin(available);
            case 'priority':
                return available[0]; // Already sorted by priority
            case 'load-balanced':
                return this.selectLoadBalanced(available);
            default:
                return available[0];
        }
    }
    /**
     * Round-robin provider selection
     */
    selectRoundRobin(available) {
        this.roundRobinIndex = (this.roundRobinIndex + 1) % available.length;
        return available[this.roundRobinIndex];
    }
    /**
     * Load-balanced provider selection
     * Prefers providers with lower current load and faster response times
     */
    selectLoadBalanced(available) {
        // Score each provider based on current stats
        const scored = available.map((p) => {
            const stats = p.getStats();
            // Lower score = better
            // Factors: failure rate, avg processing time, current availability
            const failureRate = stats.totalRequests > 0 ? stats.failedRequests / stats.totalRequests : 0;
            const score = failureRate * 100 + stats.avgProcessingTimeMs / 100 + p.priority * 10;
            return { provider: p, score };
        });
        // Sort by score (ascending) and return the best
        scored.sort((a, b) => a.score - b.score);
        return scored[0].provider;
    }
    /**
     * Process a single image with fallback
     */
    async processWithFallback(imageBuffer) {
        const errors = [];
        // Try each available provider in order
        for (const provider of this.getAvailableProviders()) {
            try {
                return await provider.performOCR(imageBuffer);
            }
            catch (error) {
                const err = error instanceof Error ? error : new Error(String(error));
                errors.push(err);
                console.warn(`[OCRRouter] ${provider.name} failed: ${err.message}`);
                if (!this.config.enableFallback) {
                    throw err;
                }
                // Continue to next provider
            }
        }
        // All providers failed
        throw new Error(`All OCR providers failed. Errors: ${errors.map((e) => e.message).join('; ')}`);
    }
    /**
     * Process multiple images in parallel with intelligent distribution
     *
     * Distributes work across all available providers for maximum throughput.
     */
    async processParallel(tasks) {
        const startTime = Date.now();
        const effectiveParallel = this.getEffectiveParallelLimit();
        const limit = pLimit(effectiveParallel);
        console.log(`[OCRRouter] Processing ${tasks.length} images in parallel ` +
            `(limit: ${effectiveParallel}, providers: ${this.providers.length})`);
        const providerUsage = {};
        const results = [];
        let successCount = 0;
        let failureCount = 0;
        // Process all tasks with rate limiting
        const promises = tasks.map((task) => limit(async () => {
            const provider = this.selectProvider();
            if (!provider) {
                console.warn(`[OCRRouter] No provider available for task ${task.id}`);
                failureCount++;
                return {
                    text: '',
                    confidence: 0,
                    provider: 'none',
                    processingTimeMs: 0,
                };
            }
            try {
                // Track provider usage
                providerUsage[provider.name] = (providerUsage[provider.name] || 0) + 1;
                const result = await provider.performOCR(task.imageBuffer);
                successCount++;
                return result;
            }
            catch (error) {
                // Try fallback if enabled
                if (this.config.enableFallback) {
                    try {
                        const result = await this.processWithFallback(task.imageBuffer);
                        providerUsage[result.provider] = (providerUsage[result.provider] || 0) + 1;
                        successCount++;
                        return result;
                    }
                    catch {
                        // Fallback also failed
                    }
                }
                failureCount++;
                console.error(`[OCRRouter] Task ${task.id} failed: ${error instanceof Error ? error.message : String(error)}`);
                return {
                    text: '',
                    confidence: 0,
                    provider: provider.name,
                    processingTimeMs: 0,
                };
            }
        }));
        const allResults = await Promise.all(promises);
        results.push(...allResults);
        const processingTimeMs = Date.now() - startTime;
        // Log summary
        console.log(`[OCRRouter] Batch complete: ${successCount}/${tasks.length} succeeded ` +
            `in ${(processingTimeMs / 1000).toFixed(2)}s`);
        console.log(`[OCRRouter] Provider usage:`, providerUsage);
        return {
            results,
            stats: {
                totalProcessed: tasks.length,
                successCount,
                failureCount,
                processingTimeMs,
                providerUsage,
            },
        };
    }
    /**
     * Get statistics from all providers
     */
    getAllProviderStats() {
        const stats = {};
        for (const provider of this.providers) {
            stats[provider.name] = provider.getStats();
        }
        return stats;
    }
    /**
     * Check if any provider is available
     */
    hasAvailableProvider() {
        return this.getAvailableProviders().length > 0;
    }
    /**
     * Get the count of available providers
     */
    getAvailableProviderCount() {
        return this.getAvailableProviders().length;
    }
    /**
     * Log router status
     */
    logStatus() {
        console.log('[OCRRouter] Status:');
        console.log(`  Providers: ${this.providers.length}`);
        console.log(`  Available: ${this.getAvailableProviders().length}`);
        console.log(`  Long video mode: ${this.isLongVideo}`);
        console.log(`  Effective parallel limit: ${this.getEffectiveParallelLimit()}`);
        const stats = this.getAllProviderStats();
        for (const [name, stat] of Object.entries(stats)) {
            console.log(`  [${name}] requests=${stat.totalRequests}, ` +
                `success=${stat.successfulRequests}, ` +
                `failed=${stat.failedRequests}, ` +
                `avgTime=${stat.avgProcessingTimeMs.toFixed(0)}ms, ` +
                `available=${stat.isAvailable}`);
        }
    }
}
// ============================================================
// Singleton Instance
// ============================================================
let routerInstance = null;
/**
 * Get or create the OCR router singleton
 */
export function getOCRRouter(config) {
    if (!routerInstance) {
        routerInstance = new OCRRouter(config);
    }
    return routerInstance;
}
/**
 * Reset the OCR router (for testing)
 */
export function resetOCRRouter() {
    routerInstance = null;
}
// ============================================================
// Convenience Functions
// ============================================================
/**
 * Process a single image with the default router
 */
export async function performOCR(imageBuffer) {
    const router = getOCRRouter();
    return router.processWithFallback(imageBuffer);
}
/**
 * Process multiple images in parallel with the default router
 */
export async function performBatchOCR(images, videoDurationSeconds) {
    const router = getOCRRouter();
    // Set video duration for automatic parallel boost
    if (videoDurationSeconds !== undefined) {
        router.setVideoDuration(videoDurationSeconds);
    }
    const tasks = images.map((buffer, index) => ({
        id: index,
        imageBuffer: buffer,
    }));
    return router.processParallel(tasks);
}
//# sourceMappingURL=ocrRouter.js.map