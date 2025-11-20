import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://gcwdkjyyhmqtrxvmvnvn.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdjd2Rranl5aG1xdHJ4dm12bnZuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTIxNjMyMCwiZXhwIjoyMDc2NzkyMzIwfQ.chszvywZufu_6q-sEgvNhJQGCQt5hIKgEEyh8I9XBUw';

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function main() {
  console.log('Fetching latest processing status records...\n');

  const { data, error } = await supabase
    .from('processing_status')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(5);

  if (error) {
    console.error('Error:', error);
    process.exit(1);
  }

  console.log('Latest 5 records:\n');
  data.forEach((record, index) => {
    console.log(`--- Record ${index + 1} ---`);
    console.log(`Upload ID: ${record.upload_id}`);
    console.log(`Status: ${record.status}`);
    console.log(`Progress: ${record.progress}%`);
    console.log(`Stage: ${record.stage || 'N/A'}`);
    console.log(`Error: ${record.error || 'None'}`);
    console.log(`Updated At: ${record.updated_at}`);
    console.log(`User ID: ${record.user_id || 'N/A'}`);
    console.log('');
  });

  // Find processing records
  const processing = data.filter(r => r.status === 'processing');
  if (processing.length > 0) {
    console.log(`\n⚠️ Found ${processing.length} records in 'processing' state:`);
    processing.forEach(r => {
      console.log(`  - ${r.upload_id}: ${r.progress}% (Stage: ${r.stage || 'unknown'})`);
      console.log(`    Last update: ${r.updated_at}`);
    });
  }
}

main().catch(console.error);
