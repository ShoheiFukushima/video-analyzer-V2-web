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
import { formatTimecode } from '../utils/timecode.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import { promises as fsPromises } from 'fs';
import path from 'path';
import os from 'os';
import pLimit from 'p-limit';
import { RateLimiter } from './rateLimiter.js';
import { ProgressReporter } from './progressReporter.js';
import { runLuminanceDetection } from './luminanceDetector.js';
import { processStabilizationPoints } from './textStabilityDetector.js';
import { updateStatus } from './statusManager.js';
/**
 * Main pipeline execution
 * @param videoPath - Path to video file
 * @param projectTitle - Project/video title
 * @param transcription - Transcription from whisperService
 * @param uploadId - Optional upload ID for progress tracking
 * @param detectionMode - Detection mode ('standard' or 'enhanced')
 * @returns Path to generated Excel file
 */
export async function executeIdealPipeline(videoPath, projectTitle, transcription, uploadId, detectionMode = 'standard') {
    console.log('🎬 Starting Ideal Pipeline Execution');
    console.log(`  📹 Video: ${videoPath}`);
    console.log(`  🎙️ Transcription: ${transcription.length} segments`);
    console.log(`  🎯 Detection Mode: ${detectionMode}`);
    // Step 1: Extract video metadata
    console.log('\n📐 Step 1: Extracting video metadata...');
    const videoMetadata = await getVideoMetadata(videoPath);
    // Step 2: Scene detection and frame extraction
    console.log('\n🎞️ Step 2: Scene detection and frame extraction...');
    let scenes = await extractScenesWithFrames(videoPath);
    console.log(`  ✓ Detected ${scenes.length} scenes`);
    // Enhanced mode statistics
    let luminanceTransitionsDetected = 0;
    let textStabilizationPoints = 0;
    // Enhanced mode: Additional detection for fade/dissolve transitions
    if (detectionMode === 'enhanced') {
        console.log('\n🔦 Step 2.5: Enhanced Mode - Luminance-based detection...');
        if (uploadId) {
            await updateStatus(uploadId, {
                status: 'processing',
                progress: 55,
                stage: 'luminance_detection'
            }).catch(err => console.warn('Failed to update status:', err));
        }
        try {
            // Step 2.5a: Run luminance detection
            const luminanceResults = await runLuminanceDetection(videoPath);
            luminanceTransitionsDetected = luminanceResults.stabilizationPoints.length;
            console.log(`  ✓ Found ${luminanceResults.whiteIntervals.length} white screen intervals`);
            console.log(`  ✓ Found ${luminanceResults.blackIntervals.length} black screen intervals`);
            console.log(`  ✓ Found ${luminanceTransitionsDetected} stabilization points`);
            // Step 2.5b: Process text stabilization if stabilization points were found
            if (luminanceResults.stabilizationPoints.length > 0) {
                if (uploadId) {
                    await updateStatus(uploadId, {
                        status: 'processing',
                        progress: 58,
                        stage: 'text_stabilization'
                    }).catch(err => console.warn('Failed to update status:', err));
                }
                // Create temporary directory for stabilization frames
                const stabTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stab-frames-'));
                try {
                    const textResults = await processStabilizationPoints(videoPath, luminanceResults.stabilizationPoints, stabTempDir);
                    textStabilizationPoints = textResults.length;
                    console.log(`  ✓ Found ${textStabilizationPoints} text stabilization points`);
                    // Step 2.5c: Merge text stabilization results with existing scenes
                    if (textResults.length > 0) {
                        scenes = mergeEnhancedDetectionResults(scenes, textResults);
                        console.log(`  ✓ Merged enhanced detection: ${scenes.length} total scenes`);
                    }
                }
                finally {
                    // Cleanup temporary frames
                    try {
                        fs.rmSync(stabTempDir, { recursive: true, force: true });
                    }
                    catch (e) {
                        console.warn('  ⚠️ Failed to cleanup stabilization frames:', e);
                    }
                }
            }
        }
        catch (enhancedError) {
            // Enhanced mode errors are non-fatal - continue with standard detection
            console.warn('\n⚠️ Enhanced mode detection failed, continuing with standard results:');
            console.warn(`  Error: ${enhancedError instanceof Error ? enhancedError.message : String(enhancedError)}`);
        }
    }
    // Step 3: Perform OCR on each scene frame
    console.log('\n🔍 Step 3: Performing OCR on scene frames...');
    const scenesWithRawOCR = await performSceneBasedOCR(scenes, uploadId);
    // Step 3.5: Filter out persistent overlays (logos, watermarks)
    console.log('\n🧹 Step 3.5: Filtering persistent overlays...');
    const scenesWithFilteredOverlays = filterPersistentOverlays(scenesWithRawOCR);
    // Step 3.6: Remove consecutive duplicate OCR text
    console.log('\n🔄 Step 3.6: Removing consecutive duplicate OCR text...');
    const scenesWithOCR = removeConsecutiveDuplicateOCR(scenesWithFilteredOverlays);
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
        videoMetadata,
        // Enhanced mode statistics (only populated if detectionMode === 'enhanced')
        luminanceTransitionsDetected: detectionMode === 'enhanced' ? luminanceTransitionsDetected : undefined,
        textStabilizationPoints: detectionMode === 'enhanced' ? textStabilizationPoints : undefined
    };
    console.log('\n✅ Ideal Pipeline Execution Complete');
    console.log(`  📊 Excel file: ${excelPath}`);
    console.log(`  📈 Statistics:`, stats);
    // Cleanup frames
    await cleanupFrames(scenes);
    return { excelPath, stats };
}
/**
 * Perform OCR on each scene's frame using Gemini Vision with parallel processing
 * @param scenes - Array of scenes to process
 * @param uploadId - Optional upload ID for progress tracking
 * @returns Array of scenes with OCR results
 */
/**
 * Extract text from Gemini's natural language response
 * Handles cases where Gemini doesn't return JSON
 */
function extractTextFromNaturalLanguage(response) {
    // Pattern 1: Common phrases followed by quoted text (English/Japanese quotes)
    // Matches: "contains: 'text'" / "shows: 'text'" / "text: 'text'" / "says: 'text'" / "reads: 'text'" / "displays: 'text'"
    const patterns = [
        /contains[:\s]+["']([^"']+)["']/gi,
        /shows[:\s]+["']([^"']+)["']/gi,
        /text[:\s]+["']([^"']+)["']/gi,
        /says[:\s]+["']([^"']+)["']/gi,
        /reads[:\s]+["']([^"']+)["']/gi,
        /displays[:\s]+["']([^"']+)["']/gi,
    ];
    // Try each pattern
    for (const pattern of patterns) {
        const matches = [...response.matchAll(pattern)];
        if (matches.length > 0 && matches[0][1]) {
            return matches[0][1].trim();
        }
    }
    // Pattern 2: Text enclosed in Japanese or English quotes
    const quotedPattern = /[「『"']([^」』"']{3,})[」』"']/g;
    const quotedMatches = [...response.matchAll(quotedPattern)];
    if (quotedMatches.length > 0) {
        return quotedMatches.map(m => m[1]).join('\n');
    }
    return '';
}
async function performSceneBasedOCR(scenes, uploadId) {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
    // Use latest stable model: gemini-2.5-flash (fast, supports Japanese text)
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    // Initialize parallel processing components
    const limit = pLimit(5); // Increased parallel degree to 5 for better performance
    const rateLimiter = new RateLimiter(30); // 30 requests per minute (2 seconds between requests)
    const progressReporter = uploadId ? new ProgressReporter(5) : null; // Report every 5%
    // Progress tracking
    let completedScenes = 0;
    const OCR_PROGRESS_START = 60;
    const OCR_PROGRESS_END = 85;
    const OCR_PROGRESS_RANGE = OCR_PROGRESS_END - OCR_PROGRESS_START;
    console.log(`  🚀 Starting parallel OCR processing (${scenes.length} scenes, parallel degree: 5)`);
    const startTime = Date.now();
    // Process all scenes in parallel with Promise.allSettled
    const results = await Promise.allSettled(scenes.map((scene, index) => limit(async () => {
        // Handle scenes without screenshots
        if (!scene.screenshotPath) {
            console.log(`  ⚠️ Scene ${scene.sceneNumber}: No screenshot, skipping OCR`);
            completedScenes++;
            return {
                ...scene,
                ocrText: '',
                ocrConfidence: 0
            };
        }
        // Retry configuration
        const MAX_RETRIES = 3;
        const INITIAL_BACKOFF_MS = 2000; // 2 seconds
        let lastError = null;
        // Retry loop for handling transient errors (503, 429)
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                // Apply rate limiting before each attempt
                await rateLimiter.acquire();
                // Read screenshot file
                const imageBuffer = fs.readFileSync(scene.screenshotPath);
                const base64Image = imageBuffer.toString('base64');
                // Gemini Vision OCR prompt - Specialized for video subtitles and captions
                const prompt = `You are an OCR system specialized for VIDEO SUBTITLES and CAPTIONS.

IMPORTANT: Focus ONLY on PRIMARY TEXT (subtitles, captions, main titles).
IGNORE background text, small product labels, logos, watermarks.

OUTPUT FORMAT:
Return ONLY a valid JSON object (no markdown, no additional text):
{
  "text": "extracted text (use \\n for line breaks)",
  "confidence": 0.95
}

PRIORITY ORDER (extract in this order):
1. **HIGHEST**: Subtitles/Captions in bottom 20% of screen (largest, most important)
2. **HIGH**: Main titles in center of screen (large, prominent)
3. **MEDIUM**: On-screen text overlays (medium size)
4. **IGNORE**: Small text (height < 3% of screen height)
5. **IGNORE**: Background text (signs, posters, product labels, logos)
6. **IGNORE**: Watermarks, copyright notices

TEXT SIZE RULES:
- Extract text ONLY if its height is at least 3% of screen height
- If text is too small or blurry, IGNORE it
- Focus on LARGE, CLEAR text that viewers are meant to read

REGION OF INTEREST:
- Prioritize bottom 20% of screen (subtitle area)
- Prioritize center 30% of screen (title area)
- Deprioritize edges and corners

SUPPORTED LANGUAGES:
- Japanese (kanji: 漢字, hiragana: ひらがな, katakana: カタカナ)
- English (A-Z, a-z)
- Numbers and symbols

IF NO PRIMARY TEXT (subtitles/titles) IS VISIBLE:
- Return: {"text": "", "confidence": 0}
- Do NOT extract background text just because "all text" was requested

CONFIDENCE SCORE:
- 0.9-1.0: Very clear primary text, high certainty
- 0.7-0.9: Readable primary text, medium certainty
- 0.5-0.7: Partially obscured primary text
- 0.0-0.5: Very unclear or no primary text

EXAMPLE GOOD OUTPUT:
{"text": "今日の天気は晴れ\\nToday's weather is sunny", "confidence": 0.92}

EXAMPLE BAD OUTPUT (DO NOT DO THIS):
{"text": "会社ロゴ\\n製品名ABC\\n©2023 Company\\n小さな注意書き\\nポスターの文字", "confidence": 0.85}`;
                // Call Gemini Vision API
                const result = await model.generateContent([
                    prompt,
                    { inlineData: { mimeType: 'image/png', data: base64Image } }
                ]);
                const responseText = result.response.text();
                // Log raw response for debugging (first 200 chars)
                console.log(`  [Scene ${scene.sceneNumber}] Gemini raw response: ${responseText.substring(0, 200)}`);
                // Parse JSON response with enhanced error handling
                let ocrResult;
                try {
                    // Remove markdown code blocks if present
                    const jsonText = responseText.replace(/```json\n?|\n?```/g, '').trim();
                    const parsed = JSON.parse(jsonText);
                    // Validate required fields
                    if (typeof parsed.text !== 'string') {
                        throw new Error('Missing or invalid "text" field in JSON response');
                    }
                    if (typeof parsed.confidence !== 'number' || parsed.confidence < 0 || parsed.confidence > 1) {
                        console.warn(`  [Scene ${scene.sceneNumber}] Invalid confidence value: ${parsed.confidence}, defaulting to 0.5`);
                        parsed.confidence = 0.5;
                    }
                    ocrResult = { text: parsed.text, confidence: parsed.confidence };
                }
                catch (parseError) {
                    // JSON parsing failed - log detailed error and try natural language extraction
                    console.warn(`  [Scene ${scene.sceneNumber}] JSON parse failed: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
                    console.warn(`  [Scene ${scene.sceneNumber}] Attempting natural language extraction...`);
                    const extractedText = extractTextFromNaturalLanguage(responseText);
                    if (extractedText) {
                        console.log(`  [Scene ${scene.sceneNumber}] Natural language extraction succeeded (${extractedText.length} chars)`);
                        ocrResult = { text: extractedText, confidence: 0.5 };
                    }
                    else {
                        console.warn(`  [Scene ${scene.sceneNumber}] Natural language extraction failed, using empty result`);
                        ocrResult = { text: '', confidence: 0 };
                    }
                }
                completedScenes++;
                // Report progress if reporter is available
                if (progressReporter && uploadId) {
                    const progress = Math.floor(OCR_PROGRESS_START + (completedScenes / scenes.length) * OCR_PROGRESS_RANGE);
                    await progressReporter.report(uploadId, progress, 'ocr_processing', `OCR: ${completedScenes}/${scenes.length} scenes completed`);
                }
                // Enhanced logging - success case
                const retryInfo = attempt > 0 ? ` (succeeded after ${attempt} retries)` : '';
                const textPreview = ocrResult.text.length > 0
                    ? ocrResult.text.substring(0, 50).replace(/\n/g, ' ')
                    : '(no text)';
                console.log(`  ✓ Scene ${scene.sceneNumber}: OCR complete ` +
                    `(text: ${ocrResult.text.length} chars, confidence: ${ocrResult.confidence.toFixed(2)})${retryInfo} ` +
                    `[${completedScenes}/${scenes.length}]`);
                // Log text preview if available
                if (ocrResult.text.length > 0) {
                    console.log(`    Preview: "${textPreview}${ocrResult.text.length > 50 ? '...' : ''}"`);
                }
                else {
                    console.log(`    (No text detected)`);
                }
                // Warn on low confidence
                if (ocrResult.confidence < 0.5 && ocrResult.text.length > 0) {
                    console.warn(`  ⚠️ Scene ${scene.sceneNumber}: Low confidence (${ocrResult.confidence.toFixed(2)})`);
                }
                return {
                    ...scene,
                    ocrText: ocrResult.text || '',
                    ocrConfidence: ocrResult.confidence || 0
                };
            }
            catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                // Check if error is retryable (503 Service Unavailable or 429 Rate Limit)
                const isRetryable = lastError.message.includes('503') ||
                    lastError.message.includes('429') ||
                    lastError.message.includes('overloaded') ||
                    lastError.message.includes('rate limit');
                // If not retryable or max retries reached, break
                if (!isRetryable || attempt >= MAX_RETRIES) {
                    console.error(`  ✗ Scene ${scene.sceneNumber}: OCR failed (attempt ${attempt + 1}/${MAX_RETRIES + 1})`);
                    console.error(`    Error: ${lastError.message}`);
                    // Log detailed error for debugging
                    if (lastError.message.includes('503')) {
                        console.error(`    ⚠️  Gemini API overloaded (503)`);
                    }
                    else if (lastError.message.includes('429')) {
                        console.error(`    ⚠️  Rate limit exceeded (429)`);
                    }
                    break;
                }
                // Calculate exponential backoff delay
                const backoffDelay = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
                console.warn(`  ⚠️  Scene ${scene.sceneNumber}: Temporary error (attempt ${attempt + 1}/${MAX_RETRIES + 1}), ` +
                    `retrying after ${backoffDelay}ms...`);
                console.warn(`    Reason: ${lastError.message.substring(0, 100)}`);
                // Wait before retrying
                await new Promise(resolve => setTimeout(resolve, backoffDelay));
            }
        }
        // All retries failed - increment counter and return empty result
        completedScenes++;
        return {
            ...scene,
            ocrText: '',
            ocrConfidence: 0
        };
    })));
    // Calculate and log performance metrics
    const duration = (Date.now() - startTime) / 1000;
    console.log(`  ✓ Parallel OCR completed in ${duration.toFixed(2)}s`);
    console.log(`  📊 Average: ${(duration / scenes.length).toFixed(2)}s per scene`);
    // Convert Promise.allSettled results to SceneWithOCR array
    const scenesWithOCR = results.map((result, index) => {
        if (result.status === 'fulfilled') {
            return result.value;
        }
        else {
            console.error(`  Scene ${scenes[index].sceneNumber} promise rejected:`, result.reason);
            return {
                ...scenes[index],
                ocrText: '',
                ocrConfidence: 0
            };
        }
    });
    // Final progress report
    if (progressReporter && uploadId) {
        await progressReporter.forceReport(uploadId, OCR_PROGRESS_END, 'ocr_completed', 'OCR processing completed');
    }
    console.log(`  ✓ OCR complete: ${scenesWithOCR.filter(s => s.ocrText).length}/${scenes.length} scenes with text`);
    return scenesWithOCR;
}
/**
 * Calculate dynamic threshold based on total scene count
 * Lower scene counts use stricter thresholds to prevent false positives
 *
 * @param totalScenes - Total number of scenes
 * @returns Threshold value (0-1)
 */
function calculateDynamicThreshold(totalScenes) {
    if (totalScenes < 20)
        return 0.8; // 80% (strict for small scene counts)
    if (totalScenes < 50)
        return 0.7; // 70%
    if (totalScenes < 100)
        return 0.6; // 60%
    return 0.5; // 50% (original threshold for large scene counts)
}
function filterPersistentOverlays(scenesWithOCR, options = {}) {
    // Use dynamic threshold if not explicitly specified
    const dynamicThreshold = calculateDynamicThreshold(scenesWithOCR.length);
    const { threshold = dynamicThreshold, minScenes = 3 } = options;
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
 * Remove consecutive duplicate OCR text with time-based consideration
 * Shows text only on first occurrence, hides on subsequent consecutive occurrences
 * BUT preserves text that displays continuously for 5+ seconds (likely important content)
 *
 * Example:
 *   Scene 1 (0-2s): "Company ABC" → Display (first occurrence)
 *   Scene 2 (2-3s): "Company ABC" → Hide (duplicate, <5s total)
 *   Scene 3 (3-7s): "Company ABC" → Display (5+ seconds total display = important)
 *   Scene 4 (7-9s): "New Product" → Display (new text)
 *   Scene 5 (9-11s): "New Product" → Hide (duplicate, <5s total)
 *
 * @param scenesWithOCR - Scenes with OCR text (after persistent overlay filtering)
 * @returns Scenes with consecutive duplicates removed
 */
function removeConsecutiveDuplicateOCR(scenesWithOCR) {
    if (scenesWithOCR.length === 0)
        return scenesWithOCR;
    console.log(`  📋 Processing ${scenesWithOCR.length} scenes for consecutive duplicate removal (time-based)`);
    let previousOCRText = ''; // Track previous scene's OCR text (normalized)
    let previousScene = null; // Track previous scene for time calculation
    let duplicateStartTime = 0; // Track when current duplicate sequence started
    let duplicateCount = 0;
    let firstOccurrences = 0;
    let preservedLongDuplicates = 0; // Track duplicates preserved due to 5+ second rule
    const duplicateRanges = []; // Track duplicate ranges for logging
    const LONG_DISPLAY_THRESHOLD = 5.0; // 5 seconds threshold
    const processedScenes = scenesWithOCR.map((scene, index) => {
        // Normalize OCR text for comparison (trim, remove extra whitespace)
        const currentOCRText = scene.ocrText
            .trim()
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .join('\n');
        // Check if current text is same as previous (consecutive duplicate)
        if (currentOCRText.length > 0 && currentOCRText === previousOCRText && previousScene) {
            // Calculate total display duration from first occurrence to current scene end
            const totalDisplayDuration = scene.endTime - duplicateStartTime;
            // If text has been displayed for 5+ seconds, preserve it (likely important)
            if (totalDisplayDuration >= LONG_DISPLAY_THRESHOLD) {
                preservedLongDuplicates++;
                console.log(`  ⏰ Scene ${scene.sceneNumber}: Preserving duplicate (${totalDisplayDuration.toFixed(1)}s >= ${LONG_DISPLAY_THRESHOLD}s)`);
                return scene; // Keep the text
            }
            // Otherwise, hide duplicate occurrence
            duplicateCount++;
            // Track duplicate range
            if (duplicateRanges.length === 0 || !duplicateRanges[duplicateRanges.length - 1].includes(`~${scene.sceneNumber}`)) {
                if (duplicateRanges.length > 0 && duplicateRanges[duplicateRanges.length - 1].endsWith(`${scene.sceneNumber - 1}`)) {
                    // Extend existing range
                    duplicateRanges[duplicateRanges.length - 1] = duplicateRanges[duplicateRanges.length - 1].replace(`~${scene.sceneNumber - 1}`, `~${scene.sceneNumber}`);
                }
                else {
                    // Start new range
                    duplicateRanges.push(`Scene ${scene.sceneNumber - 1}~${scene.sceneNumber}`);
                }
            }
            previousScene = scene; // Update previous scene for next iteration
            return {
                ...scene,
                ocrText: '' // Hide duplicate by setting to empty string
            };
        }
        else {
            // New text or empty text - keep it
            if (currentOCRText.length > 0) {
                firstOccurrences++;
                previousOCRText = currentOCRText; // Update previous text
                duplicateStartTime = scene.startTime; // Track start time of this new text
            }
            else {
                // Empty text - reset tracking (don't carry over to next scene)
                previousOCRText = '';
                duplicateStartTime = 0;
            }
            previousScene = scene; // Update previous scene
            return scene;
        }
    });
    // Log statistics
    console.log(`  ✓ Consecutive duplicate removal complete (time-based):`);
    console.log(`     - First occurrences (displayed): ${firstOccurrences}`);
    console.log(`     - Duplicates removed (hidden): ${duplicateCount}`);
    console.log(`     - Long duplicates preserved (5+s): ${preservedLongDuplicates}`);
    if (duplicateRanges.length > 0) {
        const samplesToShow = Math.min(5, duplicateRanges.length);
        console.log(`     - Duplicate ranges (first ${samplesToShow}):`);
        for (let i = 0; i < samplesToShow; i++) {
            console.log(`       • ${duplicateRanges[i]}`);
        }
        if (duplicateRanges.length > samplesToShow) {
            console.log(`       ... and ${duplicateRanges.length - samplesToShow} more`);
        }
    }
    const removalRate = scenesWithOCR.length > 0
        ? ((duplicateCount / scenesWithOCR.length) * 100).toFixed(1)
        : '0.0';
    console.log(`     - Removal rate: ${removalRate}% (${duplicateCount}/${scenesWithOCR.length} scenes)`);
    return processedScenes;
}
/**
 * Map transcription segments to scenes based on timestamps
 * Uses midpoint-based assignment to prevent duplicate narration across scenes
 */
function mapTranscriptionToScenes(scenesWithOCR, transcription) {
    // Track segment usage for duplicate detection
    const segmentUsage = new Map();
    const result = scenesWithOCR.map(scene => {
        // Find all transcription segments whose midpoint falls within this scene
        // This prevents the same narration from appearing in multiple scenes
        const overlappingSegments = transcription.filter(seg => {
            const segMidpoint = seg.timestamp + seg.duration / 2;
            const sceneStart = scene.startTime;
            const sceneEnd = scene.endTime;
            // Assign segment to scene if midpoint is within scene boundaries
            return segMidpoint >= sceneStart && segMidpoint < sceneEnd;
        });
        // Track usage for duplicate detection
        overlappingSegments.forEach(seg => {
            const segKey = `${seg.timestamp.toFixed(2)}-${seg.text.substring(0, 30)}`;
            if (!segmentUsage.has(segKey)) {
                segmentUsage.set(segKey, []);
            }
            segmentUsage.get(segKey).push(scene.sceneNumber);
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
    // Report duplicate usage (should be zero with midpoint-based assignment)
    let duplicateCount = 0;
    segmentUsage.forEach((sceneNumbers, segKey) => {
        if (sceneNumbers.length > 1) {
            duplicateCount++;
            if (duplicateCount <= 3) { // Show first 3 duplicates only
                console.warn(`[Narration] ⚠️ Duplicate detected in scenes ${sceneNumbers.join(', ')}: "${segKey}"`);
            }
        }
    });
    if (duplicateCount > 0) {
        console.warn(`[Narration] ⚠️ Total ${duplicateCount} narration segments appear in multiple scenes (unexpected with midpoint-based assignment)`);
    }
    else {
        console.log(`[Narration] ✓ No duplicate narration detected (midpoint-based assignment working correctly)`);
    }
    // Log narration coverage statistics
    const scenesWithNarration = result.filter(s => s.narrationText && s.narrationText.trim().length > 0).length;
    const narrationCoverage = ((scenesWithNarration / result.length) * 100).toFixed(1);
    console.log(`[Narration] ✓ Narration coverage: ${scenesWithNarration}/${result.length} scenes (${narrationCoverage}%)`);
    return result;
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
/**
 * Merge Enhanced mode detection results with standard scene detection
 *
 * This function:
 * 1. Creates new scenes from text stabilization results
 * 2. Filters out overlapping scenes (within 1 second of existing scenes)
 * 3. Merges and sorts by timestamp
 * 4. Re-numbers all scenes
 *
 * @param existingScenes - Scenes from standard detection
 * @param textResults - Text stabilization results from Enhanced mode
 * @returns Merged and sorted scenes
 */
function mergeEnhancedDetectionResults(existingScenes, textResults) {
    const OVERLAP_THRESHOLD = 1.0; // 1 second overlap threshold
    console.log(`  🔀 Merging ${existingScenes.length} standard scenes with ${textResults.length} enhanced results`);
    // Create new scenes from text stabilization results
    const enhancedScenes = textResults.map((result, index) => {
        // Find a reasonable end time (next scene start or +2 seconds)
        const nextResult = textResults[index + 1];
        const endTime = nextResult
            ? Math.min(nextResult.timestamp, result.timestamp + 2)
            : result.timestamp + 2;
        const startTime = result.timestamp;
        const midTime = (startTime + endTime) / 2;
        return {
            sceneNumber: 0, // Will be renumbered
            startTime,
            endTime,
            midTime,
            timecode: formatTimecode(startTime),
            screenshotPath: result.framePath, // Use the stabilized frame
        };
    });
    // Filter out enhanced scenes that overlap with existing scenes
    const nonOverlappingEnhancedScenes = enhancedScenes.filter(enhancedScene => {
        const overlaps = existingScenes.some(existingScene => {
            const timeDiff = Math.abs(enhancedScene.startTime - existingScene.startTime);
            return timeDiff < OVERLAP_THRESHOLD;
        });
        if (overlaps) {
            console.log(`    Skipping enhanced scene at ${enhancedScene.startTime.toFixed(2)}s (overlaps with existing)`);
        }
        return !overlaps;
    });
    console.log(`    Non-overlapping enhanced scenes: ${nonOverlappingEnhancedScenes.length}`);
    // Merge all scenes
    const mergedScenes = [...existingScenes, ...nonOverlappingEnhancedScenes];
    // Sort by start time
    mergedScenes.sort((a, b) => a.startTime - b.startTime);
    // Re-number scenes
    mergedScenes.forEach((scene, index) => {
        scene.sceneNumber = index + 1;
    });
    // Update end times and midTimes to be consistent (end = next scene start)
    for (let i = 0; i < mergedScenes.length - 1; i++) {
        mergedScenes[i].endTime = mergedScenes[i + 1].startTime;
        mergedScenes[i].midTime = (mergedScenes[i].startTime + mergedScenes[i].endTime) / 2;
    }
    console.log(`  ✓ Merged result: ${mergedScenes.length} total scenes`);
    return mergedScenes;
}
//# sourceMappingURL=pipeline.js.map