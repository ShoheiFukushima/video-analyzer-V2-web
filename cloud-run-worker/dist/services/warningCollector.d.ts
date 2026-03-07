/**
 * Warning Collector
 *
 * Collects non-fatal warnings during video processing pipeline.
 * Warnings are stored in metadata and displayed to users in the UI and Excel output.
 *
 * @author Claude Code (Anthropic)
 * @since 2026-02-19
 */
export declare class WarningCollector {
    private readonly warnings;
    /**
     * Add a warning message
     */
    add(message: string): void;
    /**
     * Add a warning only if condition is true
     */
    addIf(condition: boolean, message: string): void;
    /**
     * Get all collected warnings
     */
    getWarnings(): string[];
    /**
     * Check if any warnings have been collected
     */
    hasWarnings(): boolean;
    /**
     * Get the number of collected warnings
     */
    get count(): number;
}
//# sourceMappingURL=warningCollector.d.ts.map