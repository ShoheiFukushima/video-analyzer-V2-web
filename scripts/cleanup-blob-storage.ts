#!/usr/bin/env tsx
/**
 * Vercel Blob Storage Cleanup Script
 *
 * Usage:
 *   # List all blobs
 *   npm run tsx scripts/cleanup-blob-storage.ts list
 *
 *   # Delete all blobs (with confirmation)
 *   npm run tsx scripts/cleanup-blob-storage.ts delete-all
 *
 *   # Delete blobs older than N days
 *   npm run tsx scripts/cleanup-blob-storage.ts delete-old --days 7
 */

import { list, del } from '@vercel/blob';
import * as readline from 'readline';
import * as dotenv from 'dotenv';

// Load environment variables from .env.local
dotenv.config({ path: '.env.local' });

const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

if (!BLOB_TOKEN) {
  console.error('❌ Error: BLOB_READ_WRITE_TOKEN environment variable is not set');
  console.error('   Please set it in .env.local or pass it as environment variable');
  process.exit(1);
}

interface BlobInfo {
  url: string;
  pathname: string;
  size: number;
  uploadedAt: Date;
}

/**
 * List all blobs in storage
 */
async function listAllBlobs(): Promise<BlobInfo[]> {
  try {
    console.log('🔍 Fetching blob list from Vercel Blob Storage...\n');

    const { blobs } = await list({
      token: BLOB_TOKEN,
    });

    const blobInfos: BlobInfo[] = blobs.map(blob => ({
      url: blob.url,
      pathname: blob.pathname,
      size: blob.size,
      uploadedAt: blob.uploadedAt,
    }));

    return blobInfos;
  } catch (error) {
    console.error('❌ Error listing blobs:', error);
    throw error;
  }
}

/**
 * Display blob statistics
 */
function displayStats(blobs: BlobInfo[]) {
  const totalSize = blobs.reduce((sum, blob) => sum + blob.size, 0);
  const totalSizeMB = (totalSize / 1024 / 1024).toFixed(2);
  const totalSizeGB = (totalSize / 1024 / 1024 / 1024).toFixed(2);

  console.log('📊 Storage Statistics:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Total Blobs:     ${blobs.length}`);
  console.log(`Total Size:      ${totalSizeMB} MB (${totalSizeGB} GB)`);
  console.log(`Quota (Hobby):   1024 MB (1.00 GB)`);
  console.log(`Usage:           ${((parseFloat(totalSizeGB) / 1.0) * 100).toFixed(1)}%`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

/**
 * Display blob list
 */
function displayBlobList(blobs: BlobInfo[]) {
  console.log('📁 Blob Files:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (blobs.length === 0) {
    console.log('   (No blobs found)');
  } else {
    blobs.forEach((blob, index) => {
      const sizeMB = (blob.size / 1024 / 1024).toFixed(2);
      const uploadedDate = new Date(blob.uploadedAt).toLocaleString('ja-JP', {
        timeZone: 'Asia/Tokyo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });

      console.log(`${index + 1}. ${blob.pathname}`);
      console.log(`   Size: ${sizeMB} MB`);
      console.log(`   Uploaded: ${uploadedDate}`);
      console.log(`   URL: ${blob.url}`);
      console.log('');
    });
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

/**
 * Confirm action with user input
 */
function askConfirmation(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${question} (yes/no): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y');
    });
  });
}

/**
 * Delete all blobs
 */
async function deleteAllBlobs(blobs: BlobInfo[]) {
  if (blobs.length === 0) {
    console.log('✅ No blobs to delete');
    return;
  }

  displayStats(blobs);
  displayBlobList(blobs);

  console.log('⚠️  WARNING: This will delete ALL blobs from storage!');
  const confirmed = await askConfirmation('Are you sure you want to proceed?');

  if (!confirmed) {
    console.log('❌ Operation cancelled');
    return;
  }

  console.log('\n🗑️  Deleting blobs...\n');
  let deleted = 0;
  let failed = 0;

  for (const blob of blobs) {
    try {
      await del(blob.url, { token: BLOB_TOKEN });
      console.log(`✅ Deleted: ${blob.pathname}`);
      deleted++;
    } catch (error) {
      console.error(`❌ Failed to delete: ${blob.pathname}`, error);
      failed++;
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✅ Deleted: ${deleted}`);
  console.log(`❌ Failed:  ${failed}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

/**
 * Delete blobs older than specified days
 */
async function deleteOldBlobs(blobs: BlobInfo[], days: number) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  const oldBlobs = blobs.filter(blob => {
    const uploadedAt = new Date(blob.uploadedAt);
    return uploadedAt < cutoffDate;
  });

  if (oldBlobs.length === 0) {
    console.log(`✅ No blobs older than ${days} days found`);
    return;
  }

  console.log(`🔍 Found ${oldBlobs.length} blob(s) older than ${days} days:\n`);
  displayBlobList(oldBlobs);

  const confirmed = await askConfirmation('Delete these blobs?');

  if (!confirmed) {
    console.log('❌ Operation cancelled');
    return;
  }

  console.log('\n🗑️  Deleting old blobs...\n');
  let deleted = 0;
  let failed = 0;

  for (const blob of oldBlobs) {
    try {
      await del(blob.url, { token: BLOB_TOKEN });
      console.log(`✅ Deleted: ${blob.pathname}`);
      deleted++;
    } catch (error) {
      console.error(`❌ Failed to delete: ${blob.pathname}`, error);
      failed++;
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✅ Deleted: ${deleted}`);
  console.log(`❌ Failed:  ${failed}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'list';

  try {
    const blobs = await listAllBlobs();

    switch (command) {
      case 'list':
        displayStats(blobs);
        displayBlobList(blobs);
        break;

      case 'delete-all':
        await deleteAllBlobs(blobs);
        break;

      case 'delete-old':
        const daysArg = args.find(arg => arg.startsWith('--days='));
        const days = daysArg ? parseInt(daysArg.split('=')[1], 10) : 7;

        if (isNaN(days) || days < 1) {
          console.error('❌ Invalid --days parameter. Must be a positive number.');
          process.exit(1);
        }

        await deleteOldBlobs(blobs, days);
        break;

      default:
        console.error(`❌ Unknown command: ${command}`);
        console.log('\nUsage:');
        console.log('  npm run tsx scripts/cleanup-blob-storage.ts list');
        console.log('  npm run tsx scripts/cleanup-blob-storage.ts delete-all');
        console.log('  npm run tsx scripts/cleanup-blob-storage.ts delete-old --days=7');
        process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();
