/**
 * /api/process route tests
 *
 * Fire-and-forget pattern: auth → validate → Turso init → 202 response
 * Cloud Run call and retention cleanup run in background (not awaited).
 */

// Polyfill Response.json for jsdom (required by NextResponse.json)
if (typeof Response.json !== 'function') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Response as any).json = function (data: unknown, init?: ResponseInit) {
    return new Response(JSON.stringify(data), {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(init?.headers || {}),
      },
    });
  };
}

// --- Mocks (must be defined before imports) ---

const mockAuth = jest.fn();
jest.mock('@clerk/nextjs/server', () => ({
  auth: () => mockAuth(),
}));

const mockIsValidR2Key = jest.fn();
const mockDeleteObject = jest.fn();
jest.mock('@/lib/r2-client', () => ({
  isValidR2Key: (key: string) => mockIsValidR2Key(key),
  deleteObject: (key: string) => mockDeleteObject(key),
}));

jest.mock('@/lib/quota', () => ({
  getRetentionConfig: () => ({ maxItems: 3, maxDays: 2 }),
}));

const mockExecute = jest.fn();
const mockCreateClient = jest.fn(() => ({ execute: mockExecute }));
jest.mock('@libsql/client', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

// --- Helpers ---

function buildRequest(body: object, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost:3000/api/process', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

const VALID_USER_ID = 'user_test123';
const VALID_UPLOAD_ID = 'upload_1700000000000_abc123def';
const VALID_R2_KEY = `uploads/${VALID_USER_ID}/${VALID_UPLOAD_ID}/video.mp4`;

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    uploadId: VALID_UPLOAD_ID,
    r2Key: VALID_R2_KEY,
    fileName: 'test.mp4',
    dataConsent: true,
    detectionMode: 'standard',
    ...overrides,
  };
}

function setEnvVars() {
  process.env.WORKER_SECRET = 'test-secret';
  process.env.CLOUD_RUN_URL = 'https://worker.run.app';
  process.env.TURSO_DATABASE_URL = 'libsql://test.turso.io';
  process.env.TURSO_AUTH_TOKEN = 'test-token';
  process.env.NODE_ENV = 'production';
}

// --- Import route handler (after mocks) ---
import { POST } from '@/app/api/process/route';
import { NextRequest } from 'next/server';

describe('/api/process POST', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    originalFetch = global.fetch;

    // Default: authenticated user
    mockAuth.mockResolvedValue({ userId: VALID_USER_ID });
    // Default: valid R2 key
    mockIsValidR2Key.mockReturnValue(true);
    // Default: Turso init succeeds
    mockExecute.mockResolvedValue({ rows: [] });
    // Default: Cloud Run returns 202
    global.fetch = jest.fn().mockResolvedValue(
      new Response(null, { status: 202 })
    );

    setEnvVars();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.WORKER_SECRET;
    delete process.env.CLOUD_RUN_URL;
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;
  });

  // --- Test 1: Unauthenticated → 401 ---
  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const req = new NextRequest(buildRequest(validBody()));
    const res = await POST(req);

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Unauthorized');
  });

  // --- Test 2: Invalid JSON body → 400 ---
  it('returns 400 for invalid JSON body', async () => {
    const req = new NextRequest(
      new Request('http://localhost:3000/api/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json{{{',
      })
    );
    const res = await POST(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.message).toContain('valid JSON');
  });

  // --- Test 3: Missing required fields → 400 ---
  it('returns 400 when required fields are missing', async () => {
    const req = new NextRequest(buildRequest({ fileName: 'test.mp4' }));
    const res = await POST(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.message).toContain('uploadId');
  });

  // --- Test 4: Invalid R2 key format → 400 ---
  it('returns 400 for invalid R2 key format', async () => {
    mockIsValidR2Key.mockReturnValue(false);

    const req = new NextRequest(buildRequest(validBody({ r2Key: '../../../etc/passwd' })));
    const res = await POST(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.message).toContain('R2 key');
  });

  // --- Test 5: R2 key belongs to another user → 403 ---
  it('returns 403 when R2 key belongs to another user', async () => {
    const otherUserKey = `uploads/user_other/${VALID_UPLOAD_ID}/video.mp4`;

    const req = new NextRequest(buildRequest(validBody({ r2Key: otherUserKey })));
    const res = await POST(req);

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe('Forbidden');
  });

  // --- Test 6: Missing environment variables → 500 ---
  it('returns 500 when WORKER_SECRET is missing', async () => {
    delete process.env.WORKER_SECRET;

    const req = new NextRequest(buildRequest(validBody()));
    const res = await POST(req);

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Server configuration error');
  });

  // --- Test 7: Turso init failure → 500 ---
  it('returns 500 when Turso status initialization fails', async () => {
    mockExecute.mockRejectedValueOnce(new Error('Turso connection failed'));

    const req = new NextRequest(buildRequest(validBody()));
    const res = await POST(req);

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.message).toContain('processing status');
  });

  // --- Test 8: Happy path — immediate response, background Cloud Run call ---
  it('returns 200 immediately and calls Cloud Run in background', async () => {
    const req = new NextRequest(buildRequest(validBody()));
    const res = await POST(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.uploadId).toBe(VALID_UPLOAD_ID);
    expect(json.status).toBe('processing');

    // Turso init was called (INSERT ... ON CONFLICT)
    expect(mockExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining('INSERT INTO processing_status'),
      })
    );

    // Cloud Run is called in background — wait for microtask queue to flush
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/process'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-secret',
        }),
      })
    );
  });

  // --- Test 9: Cloud Run failure → Turso status updated to 'error' ---
  it('updates Turso status to error when Cloud Run call fails', async () => {
    // First call: Turso init (succeeds)
    // Second call: Turso error update (succeeds)
    mockExecute
      .mockResolvedValueOnce({ rows: [] })   // init
      .mockResolvedValueOnce({ rows: [] });   // error update

    // Cloud Run fails
    global.fetch = jest.fn().mockRejectedValue(new Error('Connection refused'));

    const req = new NextRequest(buildRequest(validBody()));
    const res = await POST(req);

    // Response is still 200 (fire-and-forget)
    expect(res.status).toBe(200);

    // Wait for background promise to settle
    await new Promise(resolve => setTimeout(resolve, 100));

    // Turso should have been called to update status to 'error'
    const errorUpdateCall = mockExecute.mock.calls.find(
      (call) => typeof call[0]?.sql === 'string' && call[0].sql.includes("status = 'error'")
    );
    expect(errorUpdateCall).toBeDefined();
  });

  // --- Test 10: Retention cleanup failure does not affect response ---
  it('returns success even when retention cleanup fails', async () => {
    // init succeeds, then retention COUNT query fails
    mockExecute
      .mockResolvedValueOnce({ rows: [] })   // init
      .mockRejectedValueOnce(new Error('Retention query failed'));  // retention cleanup

    const req = new NextRequest(buildRequest(validBody()));
    const res = await POST(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });
});
