import { list, del } from '@vercel/blob';

/**
 * Cleanup old files from Vercel Blob storage
 * Usage: npx tsx scripts/cleanup-blob-storage.ts
 */

async function cleanupBlobStorage() {
  try {
    console.log('Fetching all blobs from Vercel Blob storage...');

    const { blobs } = await list();

    console.log(`Found ${blobs.length} blobs`);
    console.log('\nBlobs sorted by upload time (oldest first):\n');

    // Sort by uploadedAt (oldest first)
    const sortedBlobs = blobs.sort((a, b) =>
      new Date(a.uploadedAt).getTime() - new Date(b.uploadedAt).getTime()
    );

    // Display all blobs with their details
    sortedBlobs.forEach((blob, index) => {
      const uploadDate = new Date(blob.uploadedAt);
      const sizeInMB = (blob.size / 1024 / 1024).toFixed(2);
      console.log(`${index + 1}. ${blob.pathname}`);
      console.log(`   Size: ${sizeInMB} MB`);
      console.log(`   Uploaded: ${uploadDate.toLocaleString()}`);
      console.log(`   URL: ${blob.url}`);
      console.log();
    });

    // Calculate total size
    const totalSize = blobs.reduce((sum, blob) => sum + blob.size, 0);
    const totalSizeInMB = (totalSize / 1024 / 1024).toFixed(2);
    console.log(`\nTotal storage used: ${totalSizeInMB} MB / 1024 MB (1 GB limit)`);

    // Ask user which files to delete
    console.log('\n--- DELETE OPTIONS ---');
    console.log('To delete specific files, run this script with blob URLs as arguments:');
    console.log('Example: npx tsx scripts/cleanup-blob-storage.ts delete <blob-url-1> <blob-url-2>');
    console.log('\nTo delete ALL files (dangerous!):');
    console.log('npx tsx scripts/cleanup-blob-storage.ts delete-all');

  } catch (error) {
    console.error('Error listing blobs:', error);
    process.exit(1);
  }
}

async function deleteBlobs(urls: string[]) {
  console.log(`Deleting ${urls.length} blob(s)...`);

  for (const url of urls) {
    try {
      await del(url);
      console.log(`✓ Deleted: ${url}`);
    } catch (error) {
      console.error(`✗ Failed to delete ${url}:`, error);
    }
  }

  console.log('\nDeletion complete!');
}

async function deleteAllBlobs() {
  try {
    console.log('⚠️  WARNING: Deleting ALL blobs from storage...');

    const { blobs } = await list();
    console.log(`Found ${blobs.length} blobs to delete`);

    for (const blob of blobs) {
      try {
        await del(blob.url);
        console.log(`✓ Deleted: ${blob.pathname}`);
      } catch (error) {
        console.error(`✗ Failed to delete ${blob.pathname}:`, error);
      }
    }

    console.log('\n✓ All blobs deleted!');
  } catch (error) {
    console.error('Error deleting all blobs:', error);
    process.exit(1);
  }
}

// Main execution
const args = process.argv.slice(2);

if (args.length === 0) {
  // List all blobs
  cleanupBlobStorage();
} else if (args[0] === 'delete-all') {
  // Delete all blobs
  deleteAllBlobs();
} else if (args[0] === 'delete') {
  // Delete specific blobs
  const urls = args.slice(1);
  if (urls.length === 0) {
    console.error('Error: No blob URLs provided');
    console.log('Usage: npx tsx scripts/cleanup-blob-storage.ts delete <blob-url-1> <blob-url-2> ...');
    process.exit(1);
  }
  deleteBlobs(urls);
} else {
  console.error('Invalid command');
  console.log('Usage:');
  console.log('  npx tsx scripts/cleanup-blob-storage.ts           # List all blobs');
  console.log('  npx tsx scripts/cleanup-blob-storage.ts delete <url>  # Delete specific blob(s)');
  console.log('  npx tsx scripts/cleanup-blob-storage.ts delete-all    # Delete all blobs');
  process.exit(1);
}
