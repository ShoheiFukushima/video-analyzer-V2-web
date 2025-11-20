import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://gcwdkjyyhmqtrxvmvnvn.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdjd2Rranl5aG1xdHJ4dm12bnZuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTIxNjMyMCwiZXhwIjoyMDc2NzkyMzIwfQ.chszvywZufu_6q-sEgvNhJQGCQt5hIKgEEyh8I9XBUw';

const supabase = createClient(supabaseUrl, supabaseKey);

console.log('Querying processing_status table...\n');

const { data, error } = await supabase
  .from('processing_status')
  .select('*')
  .order('updated_at', { ascending: false })
  .limit(30);

if (error) {
  console.error('Error:', error);
  process.exit(1);
} else {
  console.log(`Found ${data.length} records:\n`);
  data.forEach((record, idx) => {
    console.log(`\n--- Record ${idx + 1} ---`);
    console.log(`Upload ID: ${record.upload_id}`);
    console.log(`Status: ${record.status}`);
    console.log(`Progress: ${record.progress}%`);
    console.log(`Stage: ${record.stage || 'N/A'}`);
    console.log(`Started: ${record.started_at}`);
    console.log(`Updated: ${record.updated_at}`);
    if (record.result_url) {
      console.log(`Result URL: ${record.result_url.substring(0, 80)}...`);
    }
    if (record.error) {
      console.log(`Error: ${record.error}`);
    }
    if (record.metadata) {
      console.log(`Metadata: ${JSON.stringify(record.metadata)}`);
    }
  });

  // 統計情報
  console.log('\n\n=== STATISTICS ===');
  const statusCounts = data.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});
  console.log('Status breakdown:', statusCounts);

  // 同じupload_idの重複確認
  const uploadIds = data.map(r => r.upload_id);
  const duplicates = uploadIds.filter((id, idx) => uploadIds.indexOf(id) !== idx);
  if (duplicates.length > 0) {
    console.log('\nDuplicate upload_ids found:', [...new Set(duplicates)]);
  } else {
    console.log('\nNo duplicate upload_ids found.');
  }

  // 最新の処理中レコード
  const processingRecords = data.filter(r => r.status === 'processing');
  if (processingRecords.length > 0) {
    console.log(`\n\n=== PROCESSING RECORDS (${processingRecords.length}) ===`);
    processingRecords.forEach(r => {
      console.log(`${r.upload_id}: ${r.progress}% - ${r.stage} (Updated: ${r.updated_at})`);
    });
  }
}
