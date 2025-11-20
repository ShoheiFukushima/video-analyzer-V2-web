// Test Cloud Run /process endpoint directly

const CLOUD_RUN_URL = 'https://video-analyzer-worker-820467345033.us-central1.run.app';
const WORKER_SECRET = '4MeGFIt36xoh1GdGLu9jnYLVX90BuzJqGrytHGjeNMw=';

const testPayload = {
  uploadId: 'test_upload_' + Date.now(),
  blobUrl: 'https://test.vercel-storage.com/test.mp4',
  fileName: 'test.mp4',
  userId: 'test_user_123',
  dataConsent: false
};

console.log('Testing Cloud Run /process endpoint...');
console.log('URL:', CLOUD_RUN_URL);
console.log('Payload:', JSON.stringify(testPayload, null, 2));

try {
  const response = await fetch(`${CLOUD_RUN_URL}/process`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${WORKER_SECRET}`
    },
    body: JSON.stringify(testPayload)
  });

  console.log('\nResponse Status:', response.status);
  console.log('Response Headers:', Object.fromEntries(response.headers.entries()));

  const text = await response.text();
  console.log('\nResponse Body:', text);

  if (response.ok) {
    console.log('\n✅ Cloud Run endpoint is accessible and responding');
  } else {
    console.log('\n❌ Cloud Run endpoint returned error');
  }
} catch (error) {
  console.error('\n❌ Error calling Cloud Run:', error);
}
