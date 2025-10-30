/**
 * E2E Test for Ideal Excel Output Pipeline
 * Demonstrates the complete workflow: Scene Detection → OCR → Narration → Excel
 *
 * Usage:
 *   npm run build
 *   node dist/test-ideal-pipeline.js <video-path>
 *
 * Example:
 *   node dist/test-ideal-pipeline.js /path/to/test-video.mp4
 */

import { executeIdealPipeline } from './services/pipeline.js';
import { promises as fs } from 'fs';
import path from 'path';

/**
 * Mock OCR results for testing
 * In production, these would come from ocrService.ts
 */
function generateMockOCRResults(sceneCount: number): Array<{
  timestamp: number;
  frameIndex: number;
  text: string;
  confidence: number;
}> {
  const results = [];
  for (let i = 0; i < sceneCount; i++) {
    const timestamp = i * 10; // Every 10 seconds
    results.push({
      timestamp,
      frameIndex: i,
      text: i % 3 === 0 ? `テストテキスト ${i + 1}` : '', // Some frames have text
      confidence: 0.95
    });
  }
  return results;
}

/**
 * Mock transcription segments for testing
 * In production, these would come from whisperService.ts
 */
function generateMockTranscription(duration: number): Array<{
  timestamp: number;
  duration: number;
  text: string;
  confidence: number;
}> {
  const segments = [];
  for (let i = 0; i < Math.floor(duration / 15); i++) {
    const timestamp = i * 15;
    segments.push({
      timestamp,
      duration: 10,
      text: `ナレーションセグメント ${i + 1}: これはテスト用の音声テキストです。`,
      confidence: 0.92
    });
  }
  return segments;
}

/**
 * Main test function
 */
async function runTest() {
  console.log('🧪 E2E Test: Ideal Excel Output Pipeline\n');

  // Get video path from command line args
  const videoPath = process.argv[2];

  if (!videoPath) {
    console.error('❌ Error: Video path required');
    console.log('\nUsage:');
    console.log('  npm run build');
    console.log('  node dist/test-ideal-pipeline.js <video-path>');
    console.log('\nExample:');
    console.log('  node dist/test-ideal-pipeline.js /path/to/test-video.mp4');
    process.exit(1);
  }

  // Check if video file exists
  try {
    await fs.access(videoPath);
  } catch (error) {
    console.error(`❌ Error: Video file not found: ${videoPath}`);
    process.exit(1);
  }

  console.log(`📹 Video file: ${videoPath}`);
  console.log(`📁 Working directory: ${process.cwd()}\n`);

  try {
    const startTime = Date.now();

    // Generate mock data for testing
    // In production, these would be real OCR and transcription results
    console.log('🎭 Generating mock OCR and transcription data...');
    const mockOCR = generateMockOCRResults(10); // 10 scenes worth of OCR
    const mockTranscription = generateMockTranscription(100); // 100 seconds of transcription

    console.log(`  ✓ Mock OCR: ${mockOCR.length} results`);
    console.log(`  ✓ Mock Transcription: ${mockTranscription.length} segments\n`);

    // Execute the ideal pipeline
    const projectTitle = path.basename(videoPath, path.extname(videoPath));
    const result = await executeIdealPipeline(
      videoPath,
      projectTitle,
      mockOCR,
      mockTranscription
    );

    const processingTime = Date.now() - startTime;

    // Display results
    console.log('\n✅ Test Complete!\n');
    console.log('📊 Results:');
    console.log(`  Excel file: ${result.excelPath}`);
    console.log(`  Processing time: ${(processingTime / 1000).toFixed(2)}s`);
    console.log('\n📈 Statistics:');
    console.log(`  Total scenes: ${result.stats.totalScenes}`);
    console.log(`  Scenes with OCR text: ${result.stats.scenesWithOCRText}`);
    console.log(`  Scenes with narration: ${result.stats.scenesWithNarration}`);
    console.log(`  OCR coverage: ${((result.stats.scenesWithOCRText / result.stats.totalScenes) * 100).toFixed(1)}%`);
    console.log(`  Narration coverage: ${((result.stats.scenesWithNarration / result.stats.totalScenes) * 100).toFixed(1)}%`);

    if (result.stats.videoMetadata) {
      console.log('\n📐 Video Metadata:');
      console.log(`  Resolution: ${result.stats.videoMetadata.width}x${result.stats.videoMetadata.height}`);
      console.log(`  Aspect ratio: ${result.stats.videoMetadata.aspectRatio.toFixed(2)}:1`);
      console.log(`  Duration: ${result.stats.videoMetadata.duration}s`);
    }

    console.log('\n✨ Excel file generated successfully!');
    console.log('📝 Open the file to verify the ideal format:');
    console.log('   Scene # | Timecode | Screenshot | OCR Text | NA Text\n');

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    if (error instanceof Error) {
      console.error('Error details:', error.message);
      if (error.stack) {
        console.error('Stack trace:', error.stack);
      }
    }
    process.exit(1);
  }
}

// Run the test
runTest();
