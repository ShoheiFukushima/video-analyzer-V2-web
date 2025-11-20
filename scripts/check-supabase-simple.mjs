import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://gcwdkjyyhmqtrxvmvnvn.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdjd2Rranl5aG1xdHJ4dm12bnZuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTIxNjMyMCwiZXhwIjoyMDc2NzkyMzIwfQ.chszvywZufu_6q-sEgvNhJQGCQt5hIKgEEyh8I9XBUw';

const supabase = createClient(supabaseUrl, supabaseKey);

console.log('Checking processing_status table...\n');

// 最新5件のみ取得
const { data, error, count } = await supabase
  .from('processing_status')
  .select('upload_id, status, progress, stage, updated_at', { count: 'exact' })
  .order('updated_at', { ascending: false })
  .limit(5);

if (error) {
  console.error('Error:', error);
  process.exit(1);
}

console.log(`Total records in table: ${count}`);
console.log(`\nLatest 5 records:\n`);

data.forEach((record, idx) => {
  console.log(`${idx + 1}. ${record.upload_id}`);
  console.log(`   Status: ${record.status} | Progress: ${record.progress}% | Stage: ${record.stage || 'N/A'}`);
  console.log(`   Updated: ${record.updated_at}\n`);
});
