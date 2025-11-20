#!/usr/bin/env node

/**
 * Supabase Migration Runner - Direct SQL Execution
 * Uses Supabase SQL queries to execute migrations
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase credentials in .env.local');
  console.error('   Required: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

async function executeSqlStatements(sql) {
  console.log('\n🔄 Executing migration via Supabase client...\n');

  // Strategy: Execute individual DDL/DML statements
  const statements = [
    // Step 1: Add user_id column
    {
      name: 'Add user_id column',
      sql: `ALTER TABLE public.processing_status ADD COLUMN IF NOT EXISTS user_id TEXT;`
    },
    // Step 2: Create index on user_id
    {
      name: 'Create index on user_id',
      sql: `CREATE INDEX IF NOT EXISTS idx_processing_status_user_id ON public.processing_status(user_id);`
    },
    // Step 3: Create composite index
    {
      name: 'Create composite index (user_id, upload_id)',
      sql: `CREATE INDEX IF NOT EXISTS idx_processing_status_user_upload ON public.processing_status(user_id, upload_id);`
    },
    // Step 4: Drop old policy
    {
      name: 'Drop old RLS policy',
      sql: `DROP POLICY IF EXISTS "Authenticated users can read processing_status" ON public.processing_status;`
    },
    // Step 5: Create new RLS policy
    {
      name: 'Create new RLS policy',
      sql: `CREATE POLICY "Users can only read their own uploads" ON public.processing_status FOR SELECT TO authenticated USING (user_id = current_setting('request.jwt.claims', true)::json->>'sub');`
    },
    // Step 6: Add comment
    {
      name: 'Add column comment',
      sql: `COMMENT ON COLUMN public.processing_status.user_id IS 'Clerk user ID (sub claim from JWT) - ensures users can only access their own uploads';`
    }
  ];

  let successCount = 0;
  let errorCount = 0;

  for (const { name, sql } of statements) {
    try {
      console.log(`📝 ${name}...`);

      // Use .rpc() with a custom function, or execute directly via REST
      // Note: This requires creating a custom function in Supabase first
      // Alternative: Use raw HTTP request to Supabase REST API

      // Since we can't execute raw SQL directly via JS client,
      // we need to use the query method with a workaround
      const { error } = await supabase.from('processing_status').select('upload_id').limit(0);

      // This approach won't work for DDL. We need to output SQL for manual execution
      console.log(`   ⚠️  Cannot execute DDL via Supabase JS client`);
      console.log(`   SQL: ${sql.substring(0, 80)}...`);
      errorCount++;

    } catch (err) {
      console.error(`   ❌ Error: ${err.message}`);
      errorCount++;
    }
  }

  return errorCount === 0;
}

async function main() {
  console.log('🚀 Supabase Migration - Manual SQL Output');
  console.log('═'.repeat(70));
  console.log(`📍 Project: ${supabaseUrl}`);
  console.log('═'.repeat(70));

  const migrationPath = path.join(__dirname, '..', 'supabase-migrations', '002_add_user_id_and_fix_rls.sql');
  const sql = fs.readFileSync(migrationPath, 'utf8');

  console.log('\n⚠️  Note: Supabase JS client cannot execute DDL statements directly.');
  console.log('   The SQL must be executed manually in Supabase SQL Editor.\n');

  console.log('📋 Please copy and paste the following SQL into Supabase Dashboard:');
  console.log('   https://supabase.com/dashboard/project/gcwdkjyyhmqtrxvmvnvn/sql/new\n');
  console.log('─'.repeat(70));
  console.log(sql);
  console.log('─'.repeat(70));

  console.log('\n✅ After executing the SQL in Supabase Dashboard, verify with:');
  console.log('   SELECT * FROM pg_policies WHERE tablename = \'processing_status\';');
  console.log('   \\d processing_status  (to see the new user_id column)\n');
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
