/**
 * Text Stability Detector
 *
 * Detects when text becomes stable (fully visible and readable) in video frames.
 * Used in Enhanced mode to capture text after dissolve/fade animations complete.
 *
 * Features:
 * - Extracts multiple frames around stabilization points
 * - Runs OCR on each frame to detect text appearance
 * - Identifies the first frame where text is stable (2 consecutive frames with same text)
 * - Classifies content as TEXT vs OBJECT for weighted scoring
 *
 * @module textStabilityDetector
 */
import ffmpeg from 'fluent-ffmpeg';
import { promises as fs } from 'fs';
import path from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { RateLimiter } from './rateLimiter.js';
// ========================================
// Constants
// ========================================
const DEFAULT_CONFIG = {
    frameInterval: 0.1, // 100ms
    framesToCheck: 5, // 5 frames over 500ms
    stabilityThreshold: 2 // 2 consecutive frames
};
// ========================================
// Frame Extraction
// ========================================
/**
 * Extract multiple frames around a stabilization point
 *
 * @param videoPath - Path to video file
 * @param stabilizationPoint - The stabilization point to analyze
 * @param outputDir - Directory to save extracted frames
 * @param config - Configuration options
 * @returns Array of extracted frame paths with timestamps
 */
export async function extractStabilizationFrames(videoPath, stabilizationPoint, outputDir, config = {}) {
    const fullConfig = { ...DEFAULT_CONFIG, ...config };
    const frames = [];
    // Start slightly before the stabilization point to catch the transition
    const startTime = Math.max(0, stabilizationPoint.timestamp - fullConfig.frameInterval);
    for (let i = 0; i < fullConfig.framesToCheck; i++) {
        const timestamp = startTime + (i * fullConfig.frameInterval);
        const framePath = path.join(outputDir, `stab-${stabilizationPoint.timestamp.toFixed(2)}-f${i}.png`);
        await extractSingleFrame(videoPath, timestamp, framePath);
        frames.push({
            timestamp,
            path: framePath
        });
    }
    return frames;
}
/**
 * Extract a single frame at a specific timestamp
 */
function extractSingleFrame(videoPath, timestamp, outputPath) {
    return new Promise((resolve, reject) => {
        ffmpeg(videoPath)
            .seekInput(timestamp)
            .frames(1)
            .outputOptions(['-vf', 'unsharp=5:5:1.0:5:5:0.0', '-pix_fmt', 'rgb24'])
            .output(outputPath)
            .on('end', () => resolve())
            .on('error', reject)
            .run();
    });
}
// ========================================
// OCR Processing
// ========================================
/**
 * Perform OCR on multiple frames to detect text stabilization
 *
 * @param frames - Array of frame paths with timestamps
 * @param model - Gemini generative model
 * @param rateLimiter - Rate limiter for API calls
 * @returns Array of OCR results for each frame
 */
export async function performFrameOCR(frames, model, rateLimiter) {
    const results = [];
    for (const frame of frames) {
        await rateLimiter.acquire();
        try {
            const imageBuffer = await fs.readFile(frame.path);
            const base64Image = imageBuffer.toString('base64');
            // Simplified OCR prompt for stability detection
            const prompt = `Extract visible text from this video frame.
Return JSON only: {"text": "extracted text", "confidence": 0.95}
Focus on subtitles, titles, and captions. Ignore logos and background text.
If no text visible, return: {"text": "", "confidence": 0}`;
            const result = await model.generateContent([
                prompt,
                { inlineData: { mimeType: 'image/png', data: base64Image } }
            ]);
            const responseText = result.response.text();
            const jsonText = responseText.replace(/```json\n?|\n?```/g, '').trim();
            try {
                const parsed = JSON.parse(jsonText);
                results.push({
                    timestamp: frame.timestamp,
                    path: frame.path,
                    text: parsed.text || '',
                    confidence: parsed.confidence || 0
                });
            }
            catch {
                // JSON parsing failed
                results.push({
                    timestamp: frame.timestamp,
                    path: frame.path,
                    text: '',
                    confidence: 0
                });
            }
        }
        catch (error) {
            console.warn(`  OCR failed for frame at ${frame.timestamp}:`, error);
            results.push({
                timestamp: frame.timestamp,
                path: frame.path,
                text: '',
                confidence: 0
            });
        }
    }
    return results;
}
// ========================================
// Content Classification
// ========================================
/**
 * Classify content in a frame as TEXT or OBJECT
 *
 * @param framePath - Path to frame image
 * @param model - Gemini generative model
 * @param rateLimiter - Rate limiter for API calls
 * @returns Text classification result
 */
export async function classifyContent(framePath, model, rateLimiter) {
    await rateLimiter.acquire();
    try {
        const imageBuffer = await fs.readFile(framePath);
        const base64Image = imageBuffer.toString('base64');
        const prompt = `Analyze this video frame and classify the visible content.

TASK: Determine if the primary content is TEXT or OBJECT.

TEXT categories (score 0-1 for each):
- subtitle: Bottom-aligned text, typically Japanese/English captions
- title: Large centered text, presentation headers
- caption: Descriptive text overlays, labels

OBJECT categories (score 0-1 for each):
- logo: Brand logos, watermarks
- graphic: Charts, diagrams, illustrations, video content

Return JSON only:
{
  "type": "text" | "object" | "mixed",
  "confidence": 0.95,
  "categories": {
    "subtitle": 0.0,
    "title": 0.8,
    "caption": 0.1,
    "logo": 0.0,
    "graphic": 0.0
  }
}

RULES:
- "text" if subtitle + title + caption > 0.5
- "object" if logo + graphic > 0.5
- "mixed" if both are similar`;
        const result = await model.generateContent([
            prompt,
            { inlineData: { mimeType: 'image/png', data: base64Image } }
        ]);
        const responseText = result.response.text();
        const jsonText = responseText.replace(/```json\n?|\n?```/g, '').trim();
        try {
            const parsed = JSON.parse(jsonText);
            return {
                type: parsed.type || 'mixed',
                confidence: parsed.confidence || 0.5,
                categories: {
                    subtitle: parsed.categories?.subtitle || 0,
                    title: parsed.categories?.title || 0,
                    caption: parsed.categories?.caption || 0,
                    logo: parsed.categories?.logo || 0,
                    graphic: parsed.categories?.graphic || 0
                }
            };
        }
        catch {
            return {
                type: 'mixed',
                confidence: 0,
                categories: { subtitle: 0, title: 0, caption: 0, logo: 0, graphic: 0 }
            };
        }
    }
    catch (error) {
        console.warn('  Content classification failed:', error);
        return {
            type: 'mixed',
            confidence: 0,
            categories: { subtitle: 0, title: 0, caption: 0, logo: 0, graphic: 0 }
        };
    }
}
// ========================================
// Text Stability Detection
// ========================================
/**
 * Find the first stable text frame (2 consecutive frames with same text)
 *
 * @param ocrResults - OCR results for all frames
 * @returns The stable frame result or null if no stability found
 */
export function findStableTextFrame(ocrResults) {
    if (ocrResults.length < 2)
        return null;
    // Normalize text for comparison (trim, lowercase)
    const normalizeText = (text) => text.trim().toLowerCase().replace(/\s+/g, ' ');
    for (let i = 0; i < ocrResults.length - 1; i++) {
        const current = ocrResults[i];
        const next = ocrResults[i + 1];
        const currentNormalized = normalizeText(current.text);
        const nextNormalized = normalizeText(next.text);
        // Check for non-empty text that matches
        if (currentNormalized.length > 0 && currentNormalized === nextNormalized) {
            // Text is stable - return the first frame where it stabilized
            return current;
        }
    }
    // No stable text found - return the frame with the most text
    const frameWithMostText = ocrResults.reduce((best, current) => current.text.length > best.text.length ? current : best);
    return frameWithMostText.text.length > 0 ? frameWithMostText : null;
}
/**
 * Calculate final score based on text classification and stability
 *
 * @param classification - Content classification result
 * @param stabilityScore - Stability score (0-1)
 * @returns Final weighted score
 */
export function calculateFinalScore(classification, stabilityScore) {
    // Weight factors:
    // - Text: 0.6 (highest priority for text content)
    // - Stability: 0.3 (important that text is readable)
    // - Object: 0.1 (slight penalty for object content)
    const textScore = classification.categories.subtitle +
        classification.categories.title +
        classification.categories.caption;
    const objectScore = classification.categories.logo +
        classification.categories.graphic;
    // Normalize scores to 0-1 range
    const normalizedTextScore = Math.min(textScore, 1);
    const normalizedObjectScore = Math.min(objectScore, 1);
    // Calculate final score with weights
    const finalScore = (normalizedTextScore * 0.6) +
        (stabilityScore * 0.3) +
        ((1 - normalizedObjectScore) * 0.1);
    return Math.min(Math.max(finalScore, 0), 1);
}
// ========================================
// Main Detection Function
// ========================================
/**
 * Detect text stabilization at a given stabilization point
 *
 * @param videoPath - Path to video file
 * @param stabilizationPoint - The stabilization point to analyze
 * @param outputDir - Directory for temporary frames
 * @param model - Gemini generative model
 * @param rateLimiter - Rate limiter for API calls
 * @param config - Configuration options
 * @returns Stable text result or null if no text detected
 */
export async function detectTextStabilization(videoPath, stabilizationPoint, outputDir, model, rateLimiter, config = {}) {
    console.log(`  Analyzing stabilization point at ${stabilizationPoint.timestamp.toFixed(2)}s (${stabilizationPoint.type})`);
    // Step 1: Extract frames around the stabilization point
    const frames = await extractStabilizationFrames(videoPath, stabilizationPoint, outputDir, config);
    // Step 2: Perform OCR on all frames
    const ocrResults = await performFrameOCR(frames, model, rateLimiter);
    // Step 3: Find the stable text frame
    const stableFrame = findStableTextFrame(ocrResults);
    if (!stableFrame || stableFrame.text.length === 0) {
        // No text found - cleanup frames and return null
        await cleanupFrames(frames.map(f => f.path));
        return null;
    }
    // Step 4: Classify content type
    const classification = await classifyContent(stableFrame.path, model, rateLimiter);
    // Step 5: Calculate stability score (based on how many frames had the same text)
    const normalizedText = stableFrame.text.trim().toLowerCase();
    const matchingFrames = ocrResults.filter(r => r.text.trim().toLowerCase() === normalizedText).length;
    const stabilityScore = matchingFrames / ocrResults.length;
    // Step 6: Calculate final score
    const finalScore = calculateFinalScore(classification, stabilityScore);
    // Step 7: Cleanup non-stable frames
    const otherFramePaths = frames
        .filter(f => f.path !== stableFrame.path)
        .map(f => f.path);
    await cleanupFrames(otherFramePaths);
    console.log(`    Found stable text at ${stableFrame.timestamp.toFixed(2)}s:`);
    console.log(`      Text: "${stableFrame.text.substring(0, 50)}${stableFrame.text.length > 50 ? '...' : ''}"`);
    console.log(`      Type: ${classification.type}, Final Score: ${finalScore.toFixed(3)}`);
    return {
        timestamp: stableFrame.timestamp,
        text: stableFrame.text,
        classification,
        stabilityScore,
        framePath: stableFrame.path,
        finalScore,
        stabilizationPoint
    };
}
/**
 * Cleanup temporary frame files
 */
async function cleanupFrames(framePaths) {
    for (const framePath of framePaths) {
        try {
            await fs.unlink(framePath);
        }
        catch {
            // Ignore cleanup errors
        }
    }
}
/**
 * Process multiple stabilization points and return all text results
 *
 * @param videoPath - Path to video file
 * @param stabilizationPoints - Array of stabilization points to analyze
 * @param outputDir - Directory for temporary frames
 * @param config - Configuration options
 * @returns Array of stable text results
 */
export async function processStabilizationPoints(videoPath, stabilizationPoints, outputDir, config = {}) {
    console.log(`\n🔍 Processing ${stabilizationPoints.length} stabilization points...`);
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const rateLimiter = new RateLimiter(30); // 30 requests per minute
    const results = [];
    for (const point of stabilizationPoints) {
        const result = await detectTextStabilization(videoPath, point, outputDir, model, rateLimiter, config);
        if (result && result.classification.type === 'text') {
            results.push(result);
        }
    }
    console.log(`  Found ${results.length} text stabilization results`);
    return results;
}
//# sourceMappingURL=textStabilityDetector.js.map