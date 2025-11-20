import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://gcwdkjyyhmqtrxvmvnvn.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdjd2Rranl5aG1xdHJ4dm12bnZuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTIxNjMyMCwiZXhwIjoyMDc2NzkyMzIwfQ.chszvywZufu_6q-sEgvNhJQGCQt5hIKgEEyh8I9XBUw';

const supabase = createClient(supabaseUrl, supabaseKey);

const uploadId = 'upload_1762676696348_02isnsw0l';

console.log(`Checking details for: ${uploadId}\n`);

const { data, error } = await supabase
  .from('processing_status')
  .select('*')
  .eq('upload_id', uploadId)
  .single();

if (error) {
  console.error('Error:', error);
  process.exit(1);
}

console.log('Full record:');
console.log(JSON.stringify(data, null, 2));

// 時間経過を計算
const started = new Date(data.started_at);
const updated = new Date(data.updated_at);
const now = new Date();

const elapsedSinceStart = ((now - started) / 1000 / 60).toFixed(2);
const elapsedSinceUpdate = ((now - updated) / 1000 / 60).toFixed(2);

console.log(`\n--- Time Analysis ---`);
console.log(`Started: ${data.started_at} (${elapsedSinceStart} minutes ago)`);
console.log(`Last Updated: ${data.updated_at} (${elapsedSinceUpdate} minutes ago)`);
console.log(`Current Status: ${data.status}`);
console.log(`Current Progress: ${data.progress}%`);
console.log(`Current Stage: ${data.stage}`);

if (elapsedSinceUpdate > 5) {
  console.log(`\n⚠️  WARNING: No update for ${elapsedSinceUpdate} minutes - processing may be stuck!`);
}
