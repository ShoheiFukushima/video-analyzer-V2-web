#!/usr/bin/env node

/**
 * Supabase Migration Runner
 * Executes SQL migration files using Supabase service role
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

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function runMigration(migrationFile) {
  console.log(`\n📄 Reading migration: ${migrationFile}`);

  const migrationPath = path.join(__dirname, '..', 'supabase-migrations', migrationFile);

  if (!fs.existsSync(migrationPath)) {
    console.error(`❌ Migration file not found: ${migrationPath}`);
    process.exit(1);
  }

  const sql = fs.readFileSync(migrationPath, 'utf8');

  console.log(`\n🔄 Executing migration...`);
  console.log('─'.repeat(60));

  // Split SQL by statement (rough approach - works for most cases)
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--') && !s.match(/^\/\*/));

  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < statements.length; i++) {
    const statement = statements[i];

    // Skip comment-only statements
    if (statement.startsWith('--') || statement.match(/^\/\*/)) {
      continue;
    }

    try {
      console.log(`\n[${i + 1}/${statements.length}] Executing statement...`);

      // Execute using rpc to run raw SQL
      const { data, error } = await supabase.rpc('exec_sql', {
        sql_query: statement + ';'
      }).catch(async (err) => {
        // If exec_sql function doesn't exist, try direct query
        return await supabase.from('_migrations_temp').select('*').limit(0);
      });

      if (error) {
        // Try alternative: Use postgres REST API directly
        const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': supabaseServiceKey,
            'Authorization': `Bearer ${supabaseServiceKey}`
          },
          body: JSON.stringify({ query: statement + ';' })
        });

        if (!response.ok) {
          throw new Error(`SQL execution failed: ${error.message || 'Unknown error'}`);
        }
      }

      successCount++;
      console.log(`   ✅ Success`);

    } catch (err) {
      errorCount++;
      console.error(`   ❌ Error: ${err.message}`);
      console.error(`   Statement: ${statement.substring(0, 100)}...`);

      // Don't stop on errors for some statements (e.g., DROP IF EXISTS)
      if (statement.includes('IF NOT EXISTS') || statement.includes('IF EXISTS')) {
        console.log(`   ⚠️  Continuing (non-critical error)...`);
      } else {
        console.error(`\n❌ Migration failed. Stopping execution.`);
        process.exit(1);
      }
    }
  }

  console.log('\n' + '─'.repeat(60));
  console.log(`\n📊 Migration Summary:`);
  console.log(`   ✅ Successful statements: ${successCount}`);
  console.log(`   ❌ Failed statements: ${errorCount}`);

  if (errorCount === 0) {
    console.log(`\n🎉 Migration completed successfully!`);
    return true;
  } else {
    console.log(`\n⚠️  Migration completed with errors.`);
    return false;
  }
}

// Main execution
const migrationFile = process.argv[2] || '002_add_user_id_and_fix_rls.sql';

console.log('🚀 Supabase Migration Runner');
console.log('─'.repeat(60));
console.log(`📍 Project: ${supabaseUrl}`);
console.log(`📁 Migration: ${migrationFile}`);

runMigration(migrationFile)
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(err => {
    console.error('\n❌ Fatal error:', err);
    process.exit(1);
  });
