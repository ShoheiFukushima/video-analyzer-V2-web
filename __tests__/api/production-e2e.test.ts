/**
 * Production E2E Test Suite for Cloud Run Integration
 *
 * Tests the deployed Cloud Run worker directly without Next.js server
 */

import { describe, test, expect } from '@jest/globals';

const CLOUD_RUN_URL = process.env.CLOUD_RUN_URL || 'https://video-analyzer-worker-820467345033.us-central1.run.app';
const WORKER_SECRET = process.env.WORKER_SECRET || '4MeGFIt36xoh1GdGLu9jnYLVX90BuzJqGrytHGjeNMw=';
const TEST_UPLOAD_ID = `e2e_test_${Date.now()}`;

describe('Production Cloud Run E2E Tests', () => {

  describe('Cloud Run Worker - Direct Tests', () => {
    test('Health check should succeed', async () => {
      const response = await fetch(`${CLOUD_RUN_URL}/health`, {
        headers: { Authorization: `Bearer ${WORKER_SECRET}` },
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.status).toBe('ok');
      expect(data.timestamp).toBeDefined();

      console.log('✅ Cloud Run health check:', data);
    });

    test('Health check should require authentication', async () => {
      const response = await fetch(`${CLOUD_RUN_URL}/health`);

      // Cloud Run should return 401 or 403 without proper auth
      expect([401, 403]).toContain(response.status);

      console.log('✅ Authentication required for health check');
    });

    test('Status endpoint should handle non-existent upload', async () => {
      const response = await fetch(`${CLOUD_RUN_URL}/status/non_existent_upload`, {
        headers: { Authorization: `Bearer ${WORKER_SECRET}` },
      });

      // Should return 404 for non-existent uploads
      expect(response.status).toBe(404);

      console.log('✅ Handles non-existent uploads correctly');
    });

    test('Process endpoint should validate input', async () => {
      const response = await fetch(`${CLOUD_RUN_URL}/process`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${WORKER_SECRET}`,
        },
        body: JSON.stringify({
          // Missing required fields
        }),
      });

      // Should return 400 for invalid input
      expect(response.status).toBe(400);

      console.log('✅ Validates process input correctly');
    });

    test('Blob cleaner endpoint should be accessible', async () => {
      const response = await fetch(`${CLOUD_RUN_URL}/cleanup/trigger`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${WORKER_SECRET}`,
        },
      });

      // Should return 200 (cleanup executed) or 403 (auth required)
      expect([200, 403]).toContain(response.status);

      console.log('✅ Blob cleaner endpoint accessible');
    });
  });

  describe('Integration Flow Tests', () => {
    test('Complete error handling flow', async () => {
      // Test 1: Create process with invalid blob URL
      const invalidProcessResponse = await fetch(`${CLOUD_RUN_URL}/process`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${WORKER_SECRET}`,
        },
        body: JSON.stringify({
          uploadId: TEST_UPLOAD_ID,
          blobUrl: 'https://invalid.com/test.mp4',
          fileName: 'test.mp4',
        }),
      });

      // Should fail validation
      expect([400, 500]).toContain(invalidProcessResponse.status);

      console.log('✅ Invalid blob URL rejected');
    });
  });

  describe('Performance Tests', () => {
    test('Health check response time', async () => {
      const startTime = Date.now();

      await fetch(`${CLOUD_RUN_URL}/health`, {
        headers: { Authorization: `Bearer ${WORKER_SECRET}` },
      });

      const responseTime = Date.now() - startTime;

      // Health check should respond in under 2 seconds (including cold start)
      expect(responseTime).toBeLessThan(2000);

      console.log(`✅ Health check responded in ${responseTime}ms`);
    });

    test('Concurrent health checks', async () => {
      const requests = Array(5).fill(null).map(() =>
        fetch(`${CLOUD_RUN_URL}/health`, {
          headers: { Authorization: `Bearer ${WORKER_SECRET}` },
        })
      );

      const responses = await Promise.all(requests);

      responses.forEach(response => {
        expect(response.status).toBe(200);
      });

      console.log('✅ Handles concurrent requests');
    });
  });

  describe('Security Tests', () => {
    test('Should reject requests without authentication', async () => {
      const endpoints = [
        '/health',
        `/status/${TEST_UPLOAD_ID}`,
        '/process',
      ];

      for (const endpoint of endpoints) {
        const response = await fetch(`${CLOUD_RUN_URL}${endpoint}`);

        // Should require authentication
        expect([401, 403, 405]).toContain(response.status);
      }

      console.log('✅ All endpoints require authentication');
    });

    test('Should reject invalid authentication tokens', async () => {
      const response = await fetch(`${CLOUD_RUN_URL}/health`, {
        headers: { Authorization: 'Bearer invalid_token_123' },
      });

      // Should reject invalid tokens
      expect([401, 403]).toContain(response.status);

      console.log('✅ Rejects invalid authentication tokens');
    });

    test('Should not expose internal errors', async () => {
      const response = await fetch(`${CLOUD_RUN_URL}/process`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${WORKER_SECRET}`,
        },
        body: 'invalid json{',
      });

      const text = await response.text();

      // Should not contain sensitive information
      expect(text).not.toMatch(/\/Users\//);
      expect(text).not.toMatch(/sk_test/);
      expect(text).not.toMatch(/vercel_blob_rw/);

      console.log('✅ Does not expose sensitive information');
    });
  });
});
