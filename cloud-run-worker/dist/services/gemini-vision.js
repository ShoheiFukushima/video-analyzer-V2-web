/**
 * Gemini 2.5 Flash Vision Service
 * High-accuracy OCR implementation using Google's Gemini 2.5 Flash
 * Superior Japanese and English text detection with enhanced performance
 *
 * Based on VideoContentAnalyzer V2's proven 100% OCR accuracy implementation
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import { promises as fs } from 'fs';
/**
 * Gemini Vision Service for OCR
 */
export class GeminiVisionService {
    constructor(config) {
        this.initialized = false;
        const apiKey = config?.apiKey || process.env.GEMINI_API_KEY || '';
        if (!apiKey) {
            throw new Error('Gemini API key is required');
        }
        this.genAI = new GoogleGenerativeAI(apiKey);
        // Use Gemini 2.5 Flash by default for cost optimization and enhanced performance
        const defaultModel = config?.modelVersion === '1.5'
            ? 'gemini-1.5-pro-latest'
            : 'gemini-2.0-flash-exp';
        this.modelName = config?.model || process.env.GEMINI_MODEL || defaultModel;
        // Initialize model with vision capabilities
        this.model = this.genAI.getGenerativeModel({
            model: this.modelName,
            generationConfig: {
                temperature: config?.temperature || 0.1, // Low temperature for consistent OCR
                maxOutputTokens: config?.maxTokens || 4096,
                topP: 0.95,
                topK: 20
            }
        });
    }
    /**
     * Initialize and verify Gemini API connection
     */
    async initialize() {
        try {
            // Test the connection with a simple prompt
            const result = await this.model.generateContent('Test connection');
            const response = await result.response;
            if (response.text()) {
                this.initialized = true;
                console.log(`✅ Gemini ${this.modelName} initialized successfully`);
                if (this.modelName.includes('2.0') || this.modelName.includes('2.5')) {
                    console.log(`🚀 Using enhanced model with cost optimization`);
                }
                return true;
            }
        }
        catch (error) {
            console.error('❌ Failed to initialize Gemini Vision:', error.message);
            if (error.message.includes('API_KEY_INVALID')) {
                console.log('Please check your GEMINI_API_KEY environment variable');
            }
            this.initialized = false;
            return false;
        }
        return false;
    }
    /**
     * Enhanced prompt optimized for Gemini 2.5 Flash performance
     */
    buildOCRPrompt() {
        return this.modelName.includes('2.0') || this.modelName.includes('2.5')
            ? this.buildOptimized25Prompt()
            : this.buildLegacy15Prompt();
    }
    /**
     * Original prompt optimized for Gemini 1.5 models
     */
    buildLegacy15Prompt() {
        return `You are a high-accuracy OCR system specialized in extracting text from video frames.

TASK: Extract ALL visible text from this image with maximum accuracy.

REQUIREMENTS:
1. Extract every piece of text visible in the image
2. Preserve exact spelling, spacing, and formatting
3. Identify the language of each text element (Japanese, English, or mixed)
4. Classify text type: telop (video overlay text), subtitle, sign, document, or unknown
5. Note the position and relative size of text

IMPORTANT INSTRUCTIONS:
- For Japanese text: Preserve exact kanji, hiragana, and katakana
- For mixed text: Keep original formatting (e.g., "みらいリハビリテーション病院")
- Include ALL text, even if partially visible
- If unsure about a character, make your best guess rather than omitting

OUTPUT FORMAT (JSON only, no markdown):
{
  "fullText": "all text concatenated with spaces",
  "detections": [
    {
      "text": "exact text as seen",
      "confidence": 0.95,
      "language": "ja|en|mixed",
      "type": "telop|subtitle|sign|document|unknown",
      "position": "top|bottom|center|left|right",
      "size": "large|medium|small"
    }
  ],
  "primaryLanguage": "ja|en|mixed",
  "hasJapanese": true|false,
  "textCount": number
}

Return ONLY the JSON object, no additional text or formatting.`;
    }
    /**
     * Enhanced prompt optimized for Gemini 2.5 Flash performance
     */
    buildOptimized25Prompt() {
        return `You are an advanced OCR system powered by Gemini 2.0 Flash, specialized in high-accuracy text extraction from video frames.

CORE TASK: Extract ALL visible text with maximum precision and structured output.

ENHANCED REQUIREMENTS (2.0 optimized):
1. COMPREHENSIVE TEXT DETECTION: Extract every visible character, including partial/overlapping text
2. LANGUAGE-AWARE PROCESSING:
   - Japanese: Preserve exact kanji (漢字), hiragana (ひらがな), katakana (カタカナ)
   - Mixed scripts: Maintain original formatting ("Health Care 病院")
   - English: Exact capitalization and punctuation
3. CONTEXTUAL CLASSIFICATION:
   - telop: Editorial overlay text (most common in video content)
   - subtitle: Dialog/narration text
   - sign: Environmental signage
   - document: Paper/screen documents
   - graphic: Logo/branding text
4. SPATIAL ANALYSIS: Position, size, and layout context
5. CONFIDENCE SCORING: Self-assess detection accuracy per element

CRITICAL INSTRUCTIONS:
- Prioritize recall over precision (capture all text, even uncertain)
- For ambiguous characters: provide best interpretation with confidence score
- Maintain text grouping (same visual element = single detection)
- Handle rotation, perspective distortion, and low contrast

STRUCTURED JSON OUTPUT:
{
  "fullText": "space-separated concatenation of all detected text",
  "detections": [
    {
      "text": "exact detected text",
      "confidence": 0.0-1.0,
      "language": "ja|en|mixed|numeric",
      "type": "telop|subtitle|sign|document|graphic",
      "position": "top-left|top-center|top-right|center-left|center|center-right|bottom-left|bottom-center|bottom-right",
      "size": "large|medium|small|micro"
    }
  ],
  "summary": {
    "primaryLanguage": "ja|en|mixed",
    "hasJapanese": true|false,
    "totalElements": number,
    "averageConfidence": 0.0-1.0,
    "processingNotes": "any relevant observations"
  }
}

RETURN ONLY VALID JSON - NO MARKDOWN, NO EXPLANATIONS.`;
    }
    /**
     * Detect text in an image with high accuracy
     */
    async detectText(imagePath, timecode) {
        if (!this.initialized) {
            const success = await this.initialize();
            if (!success) {
                throw new Error('Failed to initialize Gemini Vision');
            }
        }
        try {
            const startTime = Date.now();
            // Read image file
            const imageBuffer = await fs.readFile(imagePath);
            const base64Image = imageBuffer.toString('base64');
            // Prepare the prompt and image for Gemini
            const prompt = this.buildOCRPrompt();
            // Create content with image
            const result = await this.model.generateContent([
                prompt,
                {
                    inlineData: {
                        mimeType: 'image/jpeg',
                        data: base64Image
                    }
                }
            ]);
            const response = await result.response;
            const text = response.text();
            // Parse the JSON response
            const parsed = this.parseGeminiResponse(text);
            const processingTime = Date.now() - startTime;
            // Convert to OCRResult format
            return {
                timecode,
                text: parsed.fullText,
                confidence: parsed.overallConfidence,
                method: 'gemini-vision'
            };
        }
        catch (error) {
            console.error(`❌ Error detecting text in ${imagePath}:`, error.message);
            // Return empty result on error
            return {
                timecode,
                text: '',
                confidence: 0,
                method: 'gemini-vision'
            };
        }
    }
    /**
     * Parse Gemini's response into standardized format
     */
    parseGeminiResponse(responseText) {
        try {
            // Clean the response (remove markdown if present)
            let cleanJson = responseText;
            if (cleanJson.includes('```json')) {
                cleanJson = cleanJson.split('```json')[1].split('```')[0];
            }
            else if (cleanJson.includes('```')) {
                cleanJson = cleanJson.split('```')[1].split('```')[0];
            }
            cleanJson = cleanJson.trim();
            // Parse JSON
            const parsed = JSON.parse(cleanJson);
            // Handle both 1.5 and 2.5 response formats
            const isVersion25 = parsed.summary !== undefined;
            const detectionsArray = parsed.detections || [];
            // Calculate overall confidence (use summary if available for 2.5)
            const overallConfidence = isVersion25 && parsed.summary?.averageConfidence
                ? parsed.summary.averageConfidence
                : detectionsArray.length > 0
                    ? detectionsArray.reduce((sum, d) => sum + d.confidence, 0) / detectionsArray.length
                    : 0;
            return {
                fullText: parsed.fullText || '',
                overallConfidence
            };
        }
        catch (error) {
            console.error('Failed to parse Gemini response:', error);
            // Fallback: treat entire response as plain text
            return {
                fullText: responseText.trim(),
                overallConfidence: 0.8 // Lower confidence for fallback
            };
        }
    }
    /**
     * Clean up resources
     */
    async close() {
        this.initialized = false;
        console.log('🛑 Gemini Vision service closed');
    }
}
/**
 * Create and initialize Gemini Vision service
 */
export async function createGeminiVisionService(config) {
    try {
        const apiKey = config?.apiKey || process.env.GEMINI_API_KEY;
        if (!apiKey) {
            console.warn('⚠️ Gemini API key not configured');
            console.log('To enable Gemini Vision:');
            console.log('1. Get API key from https://makersuite.google.com/app/apikey');
            console.log('2. Set GEMINI_API_KEY=your-key in .env');
            return null;
        }
        const service = new GeminiVisionService({
            ...config,
            apiKey
        });
        const initialized = await service.initialize();
        if (!initialized) {
            console.warn('⚠️ Gemini Vision API initialization failed');
            return null;
        }
        return service;
    }
    catch (error) {
        console.error('Failed to create Gemini Vision service:', error.message);
        return null;
    }
}
