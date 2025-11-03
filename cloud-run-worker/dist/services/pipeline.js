/**
 * Integrated Video Analysis Pipeline
 * FFmpeg Scene Detection → OCR → Narration Mapping → Excel Generation
 *
 * Implements the ideal workflow for V2:
 * 1. Scene detection with mid-point frame extraction
 * 2. OCR on each scene frame (Gemini Vision)
 * 3. Map narration to scenes based on timestamps
 * 4. Generate Excel with ideal format (Scene # | Timecode | Screenshot | OCR | NA Text)
 */
import { extractScenesWithFrames, getVideoMetadata, cleanupFrames } from './ffmpeg.js';
import { generateExcel, generateExcelFilename } from './excel-generator.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import { promises as fsPromises } from 'fs';
import path from 'path';
/**
 * Main pipeline execution
 * @param videoPath - Path to video file
 * @param projectTitle - Project/video title
 * @param transcription - Transcription from whisperService
 * @returns Path to generated Excel file
 */
export async function executeIdealPipeline(videoPath, projectTitle, transcription) {
    console.log('🎬 Starting Ideal Pipeline Execution');
    console.log(`  📹 Video: ${videoPath}`);
    console.log(`  🎙️ Transcription: ${transcription.length} segments`);
    // Step 1: Extract video metadata
    console.log('\n📐 Step 1: Extracting video metadata...');
    const videoMetadata = await getVideoMetadata(videoPath);
    // Step 2: Scene detection and frame extraction
    console.log('\n🎞️ Step 2: Scene detection and frame extraction...');
    const scenes = await extractScenesWithFrames(videoPath);
    console.log(`  ✓ Detected ${scenes.length} scenes`);
    // Step 3: Perform OCR on each scene frame
    console.log('\n🔍 Step 3: Performing OCR on scene frames...');
    const scenesWithRawOCR = await performSceneBasedOCR(scenes);
    // Step 3.5: Filter out persistent overlays (logos, watermarks)
    console.log('\n🧹 Step 3.5: Filtering persistent overlays...');
    const scenesWithOCR = filterPersistentOverlays(scenesWithRawOCR);
    // Step 4: Map transcription to scenes
    console.log('\n🎙️ Step 4: Mapping transcription to scenes...');
    const scenesWithNarration = mapTranscriptionToScenes(scenesWithOCR, transcription);
    // Step 5: Convert to Excel rows
    console.log('\n📝 Step 5: Converting to Excel rows...');
    const excelRows = convertScenesToExcelRows(scenesWithNarration);
    // Step 6: Generate Excel file
    console.log('\n📊 Step 6: Generating Excel file...');
    const excelFilename = generateExcelFilename(projectTitle);
    const excelPath = path.join('/tmp', excelFilename);
    const excelBuffer = await generateExcel({
        projectTitle,
        rows: excelRows,
        videoMetadata,
        includeStatistics: true
    });
    // Write Excel buffer to file
    await fsPromises.writeFile(excelPath, excelBuffer);
    // Step 7: Calculate statistics
    const stats = {
        totalScenes: scenes.length,
        scenesWithOCRText: excelRows.filter(r => r.ocrText && r.ocrText.trim().length > 0).length,
        scenesWithNarration: excelRows.filter(r => r.narrationText && r.narrationText.trim().length > 0).length,
        processingTimeMs: 0, // Set by caller
        videoMetadata
    };
    console.log('\n✅ Ideal Pipeline Execution Complete');
    console.log(`  📊 Excel file: ${excelPath}`);
    console.log(`  📈 Statistics:`, stats);
    // Cleanup frames
    await cleanupFrames(scenes);
    return { excelPath, stats };
}
/**
 * Perform OCR on each scene's frame using Gemini Vision
 */
async function performSceneBasedOCR(scenes) {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
    // Use latest stable model: gemini-2.5-flash (fast, supports Japanese text)
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const scenesWithOCR = [];
    for (const scene of scenes) {
        if (!scene.screenshotPath) {
            console.log(`  ⚠️ Scene ${scene.sceneNumber}: No screenshot, skipping OCR`);
            scenesWithOCR.push({
                ...scene,
                ocrText: '',
                ocrConfidence: 0
            });
            continue;
        }
        try {
            // Read screenshot file
            const imageBuffer = fs.readFileSync(scene.screenshotPath);
            const base64Image = imageBuffer.toString('base64');
            // Gemini Vision OCR prompt
            const prompt = `Analyze this video frame and extract ALL visible text.

Please provide a JSON response with this structure:
{
  "text": "all extracted text concatenated",
  "confidence": 0.95
}

Focus on:
- Japanese text (kanji, hiragana, katakana)
- English text
- Numbers and symbols
- Screen overlays, titles, captions

Return empty string if no text detected.`;
            const result = await model.generateContent([
                prompt,
                { inlineData: { mimeType: 'image/png', data: base64Image } }
            ]);
            const responseText = result.response.text();
            // Parse JSON response
            let ocrResult;
            try {
                // Remove markdown code blocks if present
                const jsonText = responseText.replace(/```json\n?|\n?```/g, '').trim();
                ocrResult = JSON.parse(jsonText);
            }
            catch {
                // Fallback: use raw text
                ocrResult = { text: responseText, confidence: 0.5 };
            }
            scenesWithOCR.push({
                ...scene,
                ocrText: ocrResult.text || '',
                ocrConfidence: ocrResult.confidence || 0
            });
            console.log(`  ✓ Scene ${scene.sceneNumber}: OCR complete (${ocrResult.text.length} chars)`);
        }
        catch (error) {
            console.error(`  ✗ Scene ${scene.sceneNumber}: OCR failed`);
            if (error instanceof Error) {
                console.error(`    Error: ${error.message}`);
                console.error(`    Stack: ${error.stack?.split('\n')[0]}`);
            }
            else {
                console.error(`    Error:`, error);
            }
            scenesWithOCR.push({
                ...scene,
                ocrText: '',
                ocrConfidence: 0
            });
        }
    }
    console.log(`  ✓ OCR complete: ${scenesWithOCR.filter(s => s.ocrText).length}/${scenes.length} scenes with text`);
    return scenesWithOCR;
}
function filterPersistentOverlays(scenesWithOCR, options = {}) {
    const { threshold = 0.5, minScenes = 3 } = options;
    // Early return for empty array
    if (scenesWithOCR.length === 0)
        return scenesWithOCR;
    // Skip filtering for very small scene counts (insufficient data for statistical analysis)
    if (scenesWithOCR.length < minScenes) {
        console.log(`  ⚠️ Only ${scenesWithOCR.length} scenes detected. Skipping persistent overlay filter (minimum: ${minScenes} scenes required).`);
        return scenesWithOCR;
    }
    // Log filter configuration
    console.log(`  🔧 Filter config: threshold=${(threshold * 100).toFixed(0)}%, minScenes=${minScenes}`);
    // Step 1: Split each scene's OCR text into lines
    const allLines = scenesWithOCR.map(scene => scene.ocrText
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0));
    // Step 2: Count how many scenes each unique line appears in
    const lineFrequency = new Map();
    const totalScenes = scenesWithOCR.length;
    for (const lines of allLines) {
        const uniqueLines = new Set(lines); // Count each line once per scene
        for (const line of uniqueLines) {
            lineFrequency.set(line, (lineFrequency.get(line) || 0) + 1);
        }
    }
    // Step 3: Identify persistent lines (appear in >= threshold% of scenes)
    // Use float comparison for accurate threshold calculation
    const persistentThreshold = totalScenes * threshold;
    const persistentLines = new Set();
    for (const [line, count] of lineFrequency.entries()) {
        if (count >= persistentThreshold) {
            persistentLines.add(line);
        }
    }
    // Debug: Log all unique lines and their frequencies
    console.log(`  🔍 Debug: Analyzing ${lineFrequency.size} unique lines`);
    const sortedLines = Array.from(lineFrequency.entries()).sort((a, b) => b[1] - a[1]);
    console.log(`  📊 Top 10 most frequent lines:`);
    for (const [line, count] of sortedLines.slice(0, 10)) {
        const percentage = ((count / totalScenes) * 100).toFixed(0);
        console.log(`    [${count}/${totalScenes} = ${percentage}%] "${line.substring(0, 60)}${line.length > 60 ? '...' : ''}"`);
    }
    console.log(`  ✓ Detected ${persistentLines.size} persistent overlay lines (threshold: ≥${(threshold * 100).toFixed(0)}% of ${totalScenes} scenes)`);
    if (persistentLines.size > 0) {
        console.log(`  📌 Persistent lines:`);
        for (const line of persistentLines) {
            const count = lineFrequency.get(line) || 0;
            const percentage = ((count / totalScenes) * 100).toFixed(0);
            console.log(`    - "${line.substring(0, 50)}${line.length > 50 ? '...' : ''}" (${count}/${totalScenes} = ${percentage}%)`);
        }
    }
    // Step 4: Remove persistent lines from each scene
    const filteredScenes = scenesWithOCR.map(scene => {
        const lines = scene.ocrText
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0 && !persistentLines.has(line));
        const filteredText = lines.join('\n');
        return {
            ...scene,
            ocrText: filteredText
        };
    });
    const scenesWithTextBefore = scenesWithOCR.filter(s => s.ocrText.trim().length > 0).length;
    const scenesWithTextAfter = filteredScenes.filter(s => s.ocrText.trim().length > 0).length;
    console.log(`  ✓ Filtered: ${scenesWithTextBefore} → ${scenesWithTextAfter} scenes with unique text`);
    return filteredScenes;
}
/**
 * Map transcription segments to scenes based on timestamps
 * Aggregates all transcription text that overlaps with each scene
 */
function mapTranscriptionToScenes(scenesWithOCR, transcription) {
    return scenesWithOCR.map(scene => {
        // Find all transcription segments that overlap with this scene
        const overlappingSegments = transcription.filter(seg => {
            const segStart = seg.timestamp;
            const segEnd = seg.timestamp + seg.duration;
            const sceneStart = scene.startTime;
            const sceneEnd = scene.endTime;
            // Check if there's any overlap
            return segStart < sceneEnd && segEnd > sceneStart;
        });
        // Concatenate all overlapping transcription text
        const narrationText = overlappingSegments
            .map(seg => seg.text.trim())
            .filter(text => text.length > 0)
            .join(' ');
        return {
            ...scene,
            narrationText
        };
    });
}
/**
 * Convert scenes to Excel rows
 */
function convertScenesToExcelRows(scenes) {
    return scenes.map(scene => ({
        sceneNumber: scene.sceneNumber,
        timecode: scene.timecode,
        screenshotPath: scene.screenshotPath,
        ocrText: scene.ocrText || '',
        narrationText: scene.narrationText || ''
    }));
}
//# sourceMappingURL=pipeline.js.map