/**
 * LLM Cleansing Service
 *
 * Uses Gemini LLM to clean OCR/narration text:
 * - Fix OCR misrecognition (e.g., 0/O, 1/l confusion)
 * - Unify inconsistent representations of the same term
 * - Cross-reference OCR and narration for context-based correction
 * - Remove meaningless OCR noise
 *
 * Enabled via LLM_CLEANSING_ENABLED=true environment variable.
 * Graceful degradation: returns original data on failure.
 *
 * @since 2026-02-18
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
// ============================================================
// Configuration
// ============================================================
function loadConfig() {
    return {
        enabled: process.env.LLM_CLEANSING_ENABLED === 'true',
        model: process.env.LLM_CLEANSING_MODEL || 'gemini-2.0-flash',
        apiKey: process.env.GEMINI_API_KEY || '',
        chunkSize: 30,
        maxRetries: 3,
        initialDelayMs: 1000,
    };
}
// ============================================================
// Prompt
// ============================================================
const CLEANSING_PROMPT = `あなたはOCRテキストとナレーション（音声文字起こし）のクレンジング専門AIです。

以下のJSON配列を受け取ります。各要素はシーンの ocr（画面上テキスト）と narration（音声テキスト）を含みます。

## タスク
1. **OCRの誤認識修正**: 文字化け、文字の取り違え（0/O、1/l/I、ー/一 等）を文脈から修正
2. **表記揺れ統一**: 同じ単語・固有名詞の表記を統一（例: "サーバ" と "サーバー" → どちらかに統一）
3. **OCRノイズ除去**: 意味不明な文字列（ランダム記号の羅列、文字化けの残骸）は空文字 "" にする
4. **ナレーション修正**: OCRテキストを手がかりに、音声認識の誤りを修正（固有名詞のスペル修正など）
5. **文脈ベースの修正**: 前後のシーンのテキストも参考に、一貫性のある修正を行う

## ルール
- 元のテキストの意味を変えない
- 修正が不要なテキストはそのまま返す
- 空のテキストは空のまま返す
- 必ず入力と同じ数の要素を同じ順序で返す

## 出力形式
入力と同じ構造のJSON配列を返してください。sceneNumber, ocr, narration の3フィールドのみ。`;
// ============================================================
// Core
// ============================================================
/**
 * Run LLM cleansing on scene text data.
 * Returns original data unchanged if disabled or on failure.
 */
export async function cleanseScenesWithLLM(scenes) {
    const config = loadConfig();
    if (!config.enabled) {
        console.log('🧹 [LLM Cleansing] Disabled (LLM_CLEANSING_ENABLED != true)');
        return scenes.map(s => ({ ...s }));
    }
    if (!config.apiKey) {
        console.warn('🧹 [LLM Cleansing] No GEMINI_API_KEY — skipping');
        return scenes.map(s => ({ ...s }));
    }
    console.log(`🧹 [LLM Cleansing] Starting (${scenes.length} scenes, model: ${config.model})`);
    const startTime = Date.now();
    // Split into chunks for rate limit safety
    const chunks = [];
    for (let i = 0; i < scenes.length; i += config.chunkSize) {
        chunks.push(scenes.slice(i, i + config.chunkSize));
    }
    console.log(`  📦 Split into ${chunks.length} chunk(s) (${config.chunkSize} scenes/chunk)`);
    const allResults = [];
    for (let ci = 0; ci < chunks.length; ci++) {
        const chunk = chunks[ci];
        console.log(`  📡 Processing chunk ${ci + 1}/${chunks.length} (${chunk.length} scenes)...`);
        try {
            const cleansed = await processChunkWithRetry(chunk, config);
            allResults.push(...cleansed);
            console.log(`  ✓ Chunk ${ci + 1} complete`);
        }
        catch (err) {
            console.warn(`  ⚠️ Chunk ${ci + 1} failed — using original data: ${err}`);
            allResults.push(...chunk.map(s => ({ ...s })));
        }
    }
    // Log diff summary
    let modifiedOcr = 0;
    let modifiedNarration = 0;
    for (let i = 0; i < scenes.length; i++) {
        if (allResults[i].ocr !== scenes[i].ocr)
            modifiedOcr++;
        if (allResults[i].narration !== scenes[i].narration)
            modifiedNarration++;
    }
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`🧹 [LLM Cleansing] Done in ${elapsed}s`);
    console.log(`  📝 Modified: ${modifiedOcr} OCR texts, ${modifiedNarration} narration texts`);
    return allResults;
}
// ============================================================
// Internals
// ============================================================
async function processChunkWithRetry(chunk, config) {
    let lastError = null;
    for (let attempt = 0; attempt < config.maxRetries; attempt++) {
        try {
            return await callGemini(chunk, config);
        }
        catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
            if (attempt < config.maxRetries - 1) {
                const delay = config.initialDelayMs * Math.pow(2, attempt);
                console.warn(`    ⏳ Attempt ${attempt + 1} failed, retrying in ${delay}ms: ${lastError.message}`);
                await sleep(delay);
            }
        }
    }
    throw lastError || new Error('All retries exhausted');
}
async function callGemini(chunk, config) {
    const genAI = new GoogleGenerativeAI(config.apiKey);
    const model = genAI.getGenerativeModel({
        model: config.model,
        generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.1, // Low temperature for consistent, factual output
        },
    });
    // Prepare input: only send the fields we need
    const input = chunk.map(s => ({
        sceneNumber: s.sceneNumber,
        ocr: s.ocr,
        narration: s.narration,
    }));
    const prompt = `${CLEANSING_PROMPT}\n\n## 入力データ\n${JSON.stringify(input, null, 2)}`;
    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    // Parse response
    let parsed;
    try {
        parsed = JSON.parse(responseText);
    }
    catch {
        throw new Error(`Invalid JSON response: ${responseText.substring(0, 200)}`);
    }
    // Validate response structure
    if (!Array.isArray(parsed) || parsed.length !== chunk.length) {
        throw new Error(`Response length mismatch: expected ${chunk.length}, got ${Array.isArray(parsed) ? parsed.length : 'non-array'}`);
    }
    // Validate each element
    for (let i = 0; i < parsed.length; i++) {
        const item = parsed[i];
        if (typeof item.ocr !== 'string' || typeof item.narration !== 'string') {
            throw new Error(`Invalid item at index ${i}: missing ocr or narration string fields`);
        }
        // Ensure sceneNumber matches
        item.sceneNumber = chunk[i].sceneNumber;
    }
    return parsed;
}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
//# sourceMappingURL=llmCleansing.js.map