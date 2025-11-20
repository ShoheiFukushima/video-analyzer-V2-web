/**
 * Unit Tests for Error Tracking Service
 *
 * Tests the structured error logging functionality for Cloud Monitoring.
 */
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { logCriticalError, logWarning } from '../../services/errorTracking.js';
describe('Error Tracking Service', () => {
    // Store original console methods
    let originalConsoleError;
    let originalConsoleWarn;
    let originalNodeEnv;
    // Mock console methods
    let consoleErrorMock;
    let consoleWarnMock;
    beforeEach(() => {
        // Save originals
        originalConsoleError = console.error;
        originalConsoleWarn = console.warn;
        originalNodeEnv = process.env.NODE_ENV;
        // Create mocks
        consoleErrorMock = jest.fn();
        consoleWarnMock = jest.fn();
        // Replace console methods
        console.error = consoleErrorMock;
        console.warn = consoleWarnMock;
    });
    afterEach(() => {
        // Restore originals
        console.error = originalConsoleError;
        console.warn = originalConsoleWarn;
        process.env.NODE_ENV = originalNodeEnv;
        // Clear all mocks
        jest.clearAllMocks();
    });
    describe('logCriticalError', () => {
        describe('with Error object', () => {
            it('should log structured JSON with error details', () => {
                const testError = new Error('Test error message');
                const context = {
                    uploadId: 'upload_123',
                    operation: 'video-download',
                    stage: 'download',
                };
                logCriticalError(testError, context);
                // Verify console.error was called
                expect(consoleErrorMock).toHaveBeenCalled();
                // Get the first call argument (structured JSON)
                const firstCall = consoleErrorMock.mock.calls[0];
                const loggedJson = firstCall[0];
                // Parse and verify JSON structure
                const parsed = JSON.parse(loggedJson);
                expect(parsed).toEqual(expect.objectContaining({
                    severity: 'ERROR',
                    message: 'CRITICAL_ERROR',
                    error: expect.objectContaining({
                        message: 'Test error message',
                        stack: expect.stringContaining('Test error message'),
                        name: 'Error',
                    }),
                    context: {
                        uploadId: 'upload_123',
                        operation: 'video-download',
                        stage: 'download',
                    },
                    timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
                }));
            });
            it('should include error stack trace', () => {
                const testError = new Error('Stack trace test');
                const context = { uploadId: 'upload_456' };
                logCriticalError(testError, context);
                const loggedJson = consoleErrorMock.mock.calls[0][0];
                const parsed = JSON.parse(loggedJson);
                expect(parsed.error.stack).toBeDefined();
                expect(parsed.error.stack).toContain('Stack trace test');
            });
            it('should preserve custom error names', () => {
                class CustomError extends Error {
                    constructor(message) {
                        super(message);
                        this.name = 'CustomError';
                    }
                }
                const customError = new CustomError('Custom error message');
                const context = { operation: 'test' };
                logCriticalError(customError, context);
                const loggedJson = consoleErrorMock.mock.calls[0][0];
                const parsed = JSON.parse(loggedJson);
                expect(parsed.error.name).toBe('CustomError');
                expect(parsed.error.message).toBe('Custom error message');
            });
            it('should handle errors with additional context properties', () => {
                const testError = new Error('Error with context');
                const context = {
                    uploadId: 'upload_789',
                    blobUrl: 'https://example.com/blob/test.mp4',
                    operation: 'ffmpeg-processing',
                    stage: 'scene-detection',
                    customField: 'custom value',
                    nestedObject: { key: 'value' },
                };
                logCriticalError(testError, context);
                const loggedJson = consoleErrorMock.mock.calls[0][0];
                const parsed = JSON.parse(loggedJson);
                expect(parsed.context).toEqual(context);
                expect(parsed.context.customField).toBe('custom value');
                expect(parsed.context.nestedObject).toEqual({ key: 'value' });
            });
        });
        describe('with unknown error (non-Error object)', () => {
            it('should handle string errors', () => {
                const stringError = 'Something went wrong';
                const context = { uploadId: 'upload_string' };
                logCriticalError(stringError, context);
                const loggedJson = consoleErrorMock.mock.calls[0][0];
                const parsed = JSON.parse(loggedJson);
                expect(parsed.error.message).toBe('Something went wrong');
                expect(parsed.error.name).toBe('UnknownError');
                expect(parsed.error.stack).toBeUndefined();
            });
            it('should handle number errors', () => {
                const numberError = 404;
                const context = { operation: 'http-request' };
                logCriticalError(numberError, context);
                const loggedJson = consoleErrorMock.mock.calls[0][0];
                const parsed = JSON.parse(loggedJson);
                expect(parsed.error.message).toBe('404');
                expect(parsed.error.name).toBe('UnknownError');
                expect(parsed.error.stack).toBeUndefined();
            });
            it('should handle object errors', () => {
                const objectError = { code: 'ERR_NETWORK', details: 'Connection failed' };
                const context = { stage: 'network' };
                logCriticalError(objectError, context);
                const loggedJson = consoleErrorMock.mock.calls[0][0];
                const parsed = JSON.parse(loggedJson);
                expect(parsed.error.message).toBe('[object Object]');
                expect(parsed.error.name).toBe('UnknownError');
                expect(parsed.error.stack).toBeUndefined();
            });
            it('should handle null and undefined errors', () => {
                // Set production mode to avoid development logs interfering with test
                process.env.NODE_ENV = 'production';
                const context = { uploadId: 'upload_null' };
                // Test null error
                logCriticalError(null, context);
                let loggedJson = consoleErrorMock.mock.calls[0][0];
                let parsed = JSON.parse(loggedJson);
                expect(parsed.error.message).toBe('null');
                expect(parsed.error.name).toBe('UnknownError');
                // Clear mock for next test
                jest.clearAllMocks();
                // Test undefined error
                logCriticalError(undefined, context);
                loggedJson = consoleErrorMock.mock.calls[0][0];
                parsed = JSON.parse(loggedJson);
                expect(parsed.error.message).toBe('undefined');
                expect(parsed.error.name).toBe('UnknownError');
            });
        });
        describe('development mode behavior', () => {
            it('should log human-readable format in development mode', () => {
                process.env.NODE_ENV = 'development';
                const testError = new Error('Dev mode error');
                const context = { uploadId: 'upload_dev' };
                logCriticalError(testError, context);
                // Should have 4 calls: JSON + 3 development logs
                expect(consoleErrorMock).toHaveBeenCalledTimes(4);
                // Verify development logs
                expect(consoleErrorMock).toHaveBeenNthCalledWith(2, '[CRITICAL ERROR]', 'Dev mode error');
                expect(consoleErrorMock).toHaveBeenNthCalledWith(3, 'Context:', context);
                expect(consoleErrorMock).toHaveBeenNthCalledWith(4, 'Stack:', expect.stringContaining('Dev mode error'));
            });
            it('should log human-readable format when NODE_ENV is not set', () => {
                delete process.env.NODE_ENV;
                const testError = new Error('No env error');
                const context = { uploadId: 'upload_noenv' };
                logCriticalError(testError, context);
                // Should have 4 calls (same as development)
                expect(consoleErrorMock).toHaveBeenCalledTimes(4);
            });
            it('should skip human-readable logs in production mode', () => {
                process.env.NODE_ENV = 'production';
                const testError = new Error('Prod mode error');
                const context = { uploadId: 'upload_prod' };
                logCriticalError(testError, context);
                // Should only have 1 call (JSON only)
                expect(consoleErrorMock).toHaveBeenCalledTimes(1);
                // Verify only JSON was logged
                const loggedJson = consoleErrorMock.mock.calls[0][0];
                expect(() => JSON.parse(loggedJson)).not.toThrow();
            });
            it('should not log stack trace for non-Error objects in development', () => {
                process.env.NODE_ENV = 'development';
                logCriticalError('String error', { uploadId: 'test' });
                // Should have 3 calls (JSON + error message + context, but no stack)
                expect(consoleErrorMock).toHaveBeenCalledTimes(3);
                expect(consoleErrorMock).toHaveBeenNthCalledWith(2, '[CRITICAL ERROR]', 'String error');
                expect(consoleErrorMock).toHaveBeenNthCalledWith(3, 'Context:', { uploadId: 'test' });
            });
        });
        describe('Cloud Monitoring compatibility', () => {
            it('should output valid JSON for Cloud Logging', () => {
                const testError = new Error('Cloud logging test');
                const context = {
                    uploadId: 'upload_cloud',
                    operation: 'test',
                };
                logCriticalError(testError, context);
                const loggedJson = consoleErrorMock.mock.calls[0][0];
                // Should be valid JSON
                expect(() => JSON.parse(loggedJson)).not.toThrow();
                const parsed = JSON.parse(loggedJson);
                // Verify required fields for Cloud Monitoring
                expect(parsed.severity).toBe('ERROR');
                expect(parsed.message).toBe('CRITICAL_ERROR');
                expect(parsed.timestamp).toBeDefined();
                expect(parsed.error).toBeDefined();
                expect(parsed.context).toBeDefined();
            });
            it('should use ISO 8601 timestamp format', () => {
                const testError = new Error('Timestamp test');
                const context = { uploadId: 'upload_time' };
                logCriticalError(testError, context);
                const loggedJson = consoleErrorMock.mock.calls[0][0];
                const parsed = JSON.parse(loggedJson);
                // Verify ISO 8601 format
                expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
                // Verify it's a valid date
                const date = new Date(parsed.timestamp);
                expect(date.toISOString()).toBe(parsed.timestamp);
            });
        });
    });
    describe('logWarning', () => {
        it('should log structured warning with context', () => {
            const message = 'Potential issue detected';
            const context = {
                uploadId: 'upload_warn',
                operation: 'scene-detection',
            };
            logWarning(message, context);
            // Verify console.warn was called
            expect(consoleWarnMock).toHaveBeenCalled();
            // Get the first call argument (structured JSON)
            const loggedJson = consoleWarnMock.mock.calls[0][0];
            const parsed = JSON.parse(loggedJson);
            expect(parsed).toEqual(expect.objectContaining({
                severity: 'WARNING',
                message: 'WARNING: Potential issue detected',
                context: {
                    uploadId: 'upload_warn',
                    operation: 'scene-detection',
                },
                timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
            }));
        });
        it('should handle empty context', () => {
            const message = 'Warning with no context';
            const context = {};
            logWarning(message, context);
            const loggedJson = consoleWarnMock.mock.calls[0][0];
            const parsed = JSON.parse(loggedJson);
            expect(parsed.context).toEqual({});
            expect(parsed.message).toBe('WARNING: Warning with no context');
        });
        it('should log human-readable format in development mode', () => {
            process.env.NODE_ENV = 'development';
            const message = 'Dev warning';
            const context = { uploadId: 'upload_dev_warn' };
            logWarning(message, context);
            // Should have 3 calls: JSON + 2 development logs
            expect(consoleWarnMock).toHaveBeenCalledTimes(3);
            expect(consoleWarnMock).toHaveBeenNthCalledWith(2, '[WARNING]', 'Dev warning');
            expect(consoleWarnMock).toHaveBeenNthCalledWith(3, 'Context:', context);
        });
        it('should skip human-readable logs in production mode', () => {
            process.env.NODE_ENV = 'production';
            const message = 'Prod warning';
            const context = { uploadId: 'upload_prod_warn' };
            logWarning(message, context);
            // Should only have 1 call (JSON only)
            expect(consoleWarnMock).toHaveBeenCalledTimes(1);
        });
        it('should output valid JSON for Cloud Logging', () => {
            const message = 'Cloud warning test';
            const context = { operation: 'test' };
            logWarning(message, context);
            const loggedJson = consoleWarnMock.mock.calls[0][0];
            // Should be valid JSON
            expect(() => JSON.parse(loggedJson)).not.toThrow();
            const parsed = JSON.parse(loggedJson);
            // Verify required fields
            expect(parsed.severity).toBe('WARNING');
            expect(parsed.message).toContain('WARNING:');
            expect(parsed.timestamp).toBeDefined();
            expect(parsed.context).toBeDefined();
        });
        it('should use ISO 8601 timestamp format', () => {
            const message = 'Timestamp warning';
            const context = { uploadId: 'upload_warn_time' };
            logWarning(message, context);
            const loggedJson = consoleWarnMock.mock.calls[0][0];
            const parsed = JSON.parse(loggedJson);
            // Verify ISO 8601 format
            expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
            // Verify it's a valid date
            const date = new Date(parsed.timestamp);
            expect(date.toISOString()).toBe(parsed.timestamp);
        });
        it('should handle special characters in message', () => {
            const message = 'Warning: "Special" chars & <symbols>';
            const context = { uploadId: 'upload_special' };
            logWarning(message, context);
            const loggedJson = consoleWarnMock.mock.calls[0][0];
            const parsed = JSON.parse(loggedJson);
            expect(parsed.message).toBe('WARNING: Warning: "Special" chars & <symbols>');
        });
        it('should handle context with complex data structures', () => {
            const message = 'Complex context warning';
            const context = {
                uploadId: 'upload_complex',
                metadata: {
                    nested: {
                        deep: {
                            value: 'test',
                        },
                    },
                },
                array: [1, 2, 3],
                boolean: true,
            };
            logWarning(message, context);
            const loggedJson = consoleWarnMock.mock.calls[0][0];
            const parsed = JSON.parse(loggedJson);
            expect(parsed.context).toEqual(context);
        });
    });
    describe('Edge cases and error handling', () => {
        it('should handle circular references gracefully in Error objects', () => {
            const testError = new Error('Circular reference test');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            testError.circular = testError;
            const context = { uploadId: 'upload_circular' };
            // Should not throw
            expect(() => logCriticalError(testError, context)).not.toThrow();
        });
        it('should handle very long error messages', () => {
            const longMessage = 'A'.repeat(10000);
            const testError = new Error(longMessage);
            const context = { uploadId: 'upload_long' };
            logCriticalError(testError, context);
            const loggedJson = consoleErrorMock.mock.calls[0][0];
            const parsed = JSON.parse(loggedJson);
            expect(parsed.error.message).toBe(longMessage);
        });
        it('should handle empty error message', () => {
            const testError = new Error('');
            const context = { uploadId: 'upload_empty' };
            logCriticalError(testError, context);
            const loggedJson = consoleErrorMock.mock.calls[0][0];
            const parsed = JSON.parse(loggedJson);
            expect(parsed.error.message).toBe('');
        });
        it('should handle empty warning message', () => {
            const message = '';
            const context = { uploadId: 'upload_empty_warn' };
            logWarning(message, context);
            const loggedJson = consoleWarnMock.mock.calls[0][0];
            const parsed = JSON.parse(loggedJson);
            expect(parsed.message).toBe('WARNING: ');
        });
    });
});
//# sourceMappingURL=errorTracking.test.js.map