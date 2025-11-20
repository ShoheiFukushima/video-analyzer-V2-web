/**
 * Security Utilities
 *
 * Common security functions for file path validation
 * and other security-related operations.
 */
/**
 * Validate file path to prevent path traversal attacks
 *
 * Ensures that file paths are within the allowed temporary directory.
 * This prevents malicious users from accessing or modifying files
 * outside the application's working directory.
 *
 * @param filePath - Path to validate
 * @throws Error if path is outside allowed directory
 *
 * @example
 * ```typescript
 * // Valid path (within /tmp)
 * validateFilePath('/tmp/video.mp4'); // ✓ No error
 *
 * // Invalid path (outside /tmp)
 * validateFilePath('/etc/passwd'); // ✗ Throws error
 * validateFilePath('../../../etc/passwd'); // ✗ Throws error
 * ```
 */
export declare function validateFilePath(filePath: string): void;
//# sourceMappingURL=security.d.ts.map