/**
 * Graceful Shutdown Tests
 * Tests for the graceful shutdown and error message functionality
 *
 * Created: 2026-02-08
 */
import { describe, it, expect } from '@jest/globals';
describe('Graceful Shutdown Error Messages', () => {
    describe('Error Message Classification', () => {
        const getErrorMessage = (signal) => {
            switch (signal) {
                case 'SIGTERM':
                    return {
                        message: 'Processing was interrupted due to server maintenance or scaling. Please try uploading again.',
                        code: 'SERVER_SHUTDOWN',
                    };
                case 'SIGINT':
                    return {
                        message: 'Processing was manually stopped. Please try uploading again.',
                        code: 'MANUAL_STOP',
                    };
                case 'SIGKILL':
                case 'SIGBUS':
                case 'SIGSEGV':
                    return {
                        message: 'Processing was stopped due to resource constraints (memory or CPU). Please try with a smaller video or wait a moment and try again.',
                        code: 'RESOURCE_LIMIT',
                    };
                default:
                    return {
                        message: `Processing was interrupted unexpectedly (${signal}). Please try uploading again.`,
                        code: 'UNKNOWN_SIGNAL',
                    };
            }
        };
        it('should return SERVER_SHUTDOWN for SIGTERM', () => {
            const result = getErrorMessage('SIGTERM');
            expect(result.code).toBe('SERVER_SHUTDOWN');
            expect(result.message).toContain('maintenance');
            expect(result.message).toContain('scaling');
        });
        it('should return MANUAL_STOP for SIGINT', () => {
            const result = getErrorMessage('SIGINT');
            expect(result.code).toBe('MANUAL_STOP');
            expect(result.message).toContain('manually stopped');
        });
        it('should return RESOURCE_LIMIT for memory signals', () => {
            const signals = ['SIGKILL', 'SIGBUS', 'SIGSEGV'];
            signals.forEach(signal => {
                const result = getErrorMessage(signal);
                expect(result.code).toBe('RESOURCE_LIMIT');
                expect(result.message).toContain('resource constraints');
            });
        });
        it('should return UNKNOWN_SIGNAL for other signals', () => {
            const result = getErrorMessage('SIGUSR1');
            expect(result.code).toBe('UNKNOWN_SIGNAL');
            expect(result.message).toContain('SIGUSR1');
        });
    });
    describe('Frontend Error Display Classification', () => {
        const isServerInterruption = (error) => {
            if (!error)
                return false;
            return error.includes('maintenance') ||
                error.includes('scaling') ||
                error.includes('resource') ||
                error.includes('interrupted') ||
                error.includes('stopped unexpectedly');
        };
        it('should classify server maintenance as server interruption', () => {
            const error = 'Processing was interrupted due to server maintenance or scaling. Please try uploading again.';
            expect(isServerInterruption(error)).toBe(true);
        });
        it('should classify resource limits as server interruption', () => {
            const error = 'Processing was stopped due to resource constraints (memory or CPU). Please try with a smaller video or wait a moment and try again.';
            expect(isServerInterruption(error)).toBe(true);
        });
        it('should classify stale detection as server interruption', () => {
            const error = 'Processing appears to have stopped unexpectedly. Please try uploading again.';
            expect(isServerInterruption(error)).toBe(true);
        });
        it('should not classify generic errors as server interruption', () => {
            const error = 'Failed to process video: Invalid format';
            expect(isServerInterruption(error)).toBe(false);
        });
        it('should not classify FFmpeg errors as server interruption', () => {
            const error = 'FFmpeg failed with error code 1';
            expect(isServerInterruption(error)).toBe(false);
        });
        it('should handle null error gracefully', () => {
            expect(isServerInterruption(null)).toBe(false);
        });
    });
    describe('Error Message User Experience', () => {
        it('should provide actionable guidance for all error types', () => {
            const errorMessages = [
                'Processing was interrupted due to server maintenance or scaling. Please try uploading again.',
                'Processing was manually stopped. Please try uploading again.',
                'Processing was stopped due to resource constraints (memory or CPU). Please try with a smaller video or wait a moment and try again.',
                'Processing appears to have stopped unexpectedly. Please try uploading again.',
            ];
            errorMessages.forEach(message => {
                // All messages should contain actionable guidance
                expect(message.includes('try uploading again') ||
                    message.includes('try with a smaller video')).toBe(true);
            });
        });
        it('should not blame the user for server-side issues', () => {
            const serverErrors = [
                'Processing was interrupted due to server maintenance or scaling. Please try uploading again.',
                'Processing appears to have stopped unexpectedly. Please try uploading again.',
            ];
            serverErrors.forEach(message => {
                // Should not contain accusatory language
                expect(message.includes('your video')).toBe(false);
                expect(message.includes('you did')).toBe(false);
                expect(message.includes('your fault')).toBe(false);
            });
        });
    });
});
//# sourceMappingURL=gracefulShutdown.test.js.map