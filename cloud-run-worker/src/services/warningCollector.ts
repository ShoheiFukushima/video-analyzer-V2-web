/**
 * Warning Collector
 *
 * Collects non-fatal warnings during video processing pipeline.
 * Warnings are stored in metadata and displayed to users in the UI and Excel output.
 *
 * @author Claude Code (Anthropic)
 * @since 2026-02-19
 */

export class WarningCollector {
  private readonly warnings: string[] = [];

  /**
   * Add a warning message
   */
  add(message: string): void {
    this.warnings.push(message);
    console.warn(`[WarningCollector] ${message}`);
  }

  /**
   * Add a warning only if condition is true
   */
  addIf(condition: boolean, message: string): void {
    if (condition) {
      this.add(message);
    }
  }

  /**
   * Get all collected warnings
   */
  getWarnings(): string[] {
    return [...this.warnings];
  }

  /**
   * Check if any warnings have been collected
   */
  hasWarnings(): boolean {
    return this.warnings.length > 0;
  }

  /**
   * Get the number of collected warnings
   */
  get count(): number {
    return this.warnings.length;
  }
}
