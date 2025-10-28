import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync } from 'fs';
import { readFile, writeFile, unlink } from 'fs/promises';
import path from 'path';
import OpenAI from 'openai';
import { put } from '@vercel/blob';
import { createClient } from '@supabase/supabase-js';
import { generateExcel } from './excel-export-hybrid.js';
import { extractMetadata, extractFrames, cleanupFrames, detectAudioActivity } from './ffmpeg.js';
import { createGeminiVisionService } from './gemini-vision.js';
const execAsync = promisify(exec);
const TMP_DIR = '/tmp/video-analyzer';
// Ensure tmp directory exists
if (!existsSync(TMP_DIR)) {
    mkdirSync(TMP_DIR, { recursive: true });
}
export async function handleProcessing(request) {
    const startTime = Date.now();
    const videoPath = path.join(TMP_DIR, `${request.uploadId}_video.mp4`);
    const audioPath = path.join(TMP_DIR, `${request.uploadId}_audio.wav`);
    let excelPath = '';
    let frames = [];
    try {
        console.log(`[${request.uploadId}] Step 1: Downloading video from Blob...`);
        // Download video from Vercel Blob
        const videoBuffer = await downloadFromBlob(request.blobUrl);
        await writeFile(videoPath, videoBuffer);
        console.log(`[${request.uploadId}] ✓ Video downloaded (${videoBuffer.length} bytes)`);
        // Extract video metadata
        console.log(`[${request.uploadId}] Step 2: Extracting metadata...`);
        const metadata = await extractMetadata(videoPath);
        console.log(`[${request.uploadId}] ✓ Metadata: ${metadata.duration.toFixed(1)}s, ${metadata.resolution}`);
        // Voice Activity Detection (VAD) - Check BEFORE audio extraction
        console.log(`[${request.uploadId}] Step 3: Running Voice Activity Detection (VAD)...`);
        const hasAudio = await detectAudioActivity(videoPath);
        console.log(`[${request.uploadId}] ${hasAudio ? '✓ Audio detected' : '⚠️ No audio detected'}`);
        // Extract audio (only if audio is detected)
        if (hasAudio) {
            console.log(`[${request.uploadId}] Step 4: Extracting audio...`);
            await extractAudio(videoPath, audioPath);
            console.log(`[${request.uploadId}] ✓ Audio extracted`);
        }
        else {
            console.log(`[${request.uploadId}] Step 4: Skipping audio extraction (no audio detected)`);
        }
        // Extract frames for Gemini Vision OCR
        console.log(`[${request.uploadId}] Step 5: Extracting frames (scene detection)...`);
        frames = await extractFrames(videoPath);
        console.log(`[${request.uploadId}] ✓ Extracted ${frames.length} frames`);
        // Process with Whisper API (only if audio is detected)
        let transcription;
        if (hasAudio) {
            console.log(`[${request.uploadId}] Step 6: Processing with Whisper API...`);
            transcription = await processWithWhisper(audioPath);
            console.log(`[${request.uploadId}] ✓ Transcription complete (${transcription.segments?.length || 0} segments)`);
        }
        else {
            console.log(`[${request.uploadId}] Step 6: Skipping Whisper API (no audio detected)`);
            transcription = {
                text: '',
                language: 'ja',
                segments: [],
                duration: metadata.duration,
                hasAudio: false, // Flag for Excel generation
            };
            console.log(`[${request.uploadId}] ✓ Generated empty transcription`);
        }
        // Process with Gemini Vision OCR
        console.log(`[${request.uploadId}] Step 7: Processing with Gemini Vision OCR...`);
        const ocrResults = await processWithGeminiVision(frames, request.uploadId);
        console.log(`[${request.uploadId}] ✓ OCR complete (${ocrResults.length} frames processed)`);
        // Generate Excel with both Whisper and Gemini Vision results
        console.log(`[${request.uploadId}] Step 8: Generating hybrid Excel (Whisper + Gemini Vision)...`);
        excelPath = path.join(TMP_DIR, `${request.uploadId}_output.xlsx`);
        await generateExcel(transcription, metadata, excelPath, request.fileName, { frames, ocrResults });
        console.log(`[${request.uploadId}] ✓ Excel generated`);
        // Upload result to Vercel Blob
        console.log(`[${request.uploadId}] Step 9: Uploading result...`);
        const excelBuffer = await readFile(excelPath);
        const resultUrl = await uploadToBlob(excelBuffer, request.uploadId);
        console.log(`[${request.uploadId}] ✓ Result uploaded to Blob`);
        // Save analytics to Supabase (if consent & available)
        if (request.dataConsent && process.env.SUPABASE_URL) {
            console.log(`[${request.uploadId}] Step 10: Saving analytics...`);
            await saveAnalytics({
                uploadId: request.uploadId,
                fileName: request.fileName,
                metadata,
                transcription,
                ocrResults,
                plan: request.plan,
            });
            console.log(`[${request.uploadId}] ✓ Analytics saved`);
        }
        const processingDuration = (Date.now() - startTime) / 1000;
        return {
            resultUrl,
            processingDuration,
            metadata: {
                duration: metadata.duration,
                resolution: metadata.resolution,
                codec: metadata.codec,
                segmentCount: transcription.segments?.length || 0,
                frameCount: frames.length,
                ocrResultCount: ocrResults.length,
            },
        };
    }
    finally {
        // Cleanup temporary files
        console.log(`[${request.uploadId}] Cleaning up...`);
        try {
            if (existsSync(videoPath))
                await unlink(videoPath);
            if (existsSync(audioPath))
                await unlink(audioPath);
            if (existsSync(excelPath))
                await unlink(excelPath);
            // Clean up extracted frames
            if (frames.length > 0)
                await cleanupFrames(frames);
        }
        catch (e) {
            console.warn(`[${request.uploadId}] Cleanup warning:`, e);
        }
    }
}
async function downloadFromBlob(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000); // 120秒タイムアウト
    try {
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        if (!response.ok) {
            throw new Error(`Failed to download from Blob: ${response.statusText}`);
        }
        return Buffer.from(await response.arrayBuffer());
    }
    catch (error) {
        clearTimeout(timeout);
        if (error instanceof Error && error.name === 'AbortError') {
            throw new Error('Download timeout (120s)');
        }
        throw error;
    }
}
async function extractAudio(videoPath, audioPath) {
    // エラーログを保持するため 2>/dev/null を削除
    const command = `ffmpeg -i "${videoPath}" -vn -acodec pcm_s16le -ar 16000 -ac 1 "${audioPath}" -y`;
    try {
        const { stdout, stderr } = await execAsync(command);
        // FFmpegの出力をログ
        console.log('🔍 DEBUG - FFmpeg audio extraction:');
        if (stderr) {
            // FFmpegは主にstderrに出力する
            const durationMatch = stderr.match(/Duration: (\d{2}):(\d{2}):(\d{2}\.\d{2})/);
            const audioMatch = stderr.match(/Stream #\d+:\d+.*Audio: (.+)/);
            if (durationMatch) {
                console.log(`  Duration: ${durationMatch[0]}`);
            }
            if (audioMatch) {
                console.log(`  Audio stream: ${audioMatch[0]}`);
            }
            else {
                console.warn('  ⚠️ No audio stream detected in stderr');
            }
        }
        // 抽出された音声ファイルのサイズと長さを確認
        const { stat } = await import('fs/promises');
        const audioStats = await stat(audioPath);
        console.log(`  Audio file size: ${(audioStats.size / 1024).toFixed(2)} KB`);
        if (audioStats.size < 1000) {
            throw new Error(`Audio file too small (${audioStats.size} bytes) - video may not contain audio track`);
        }
        // 音声の実際の長さを確認
        const probeCommand = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`;
        const { stdout: durationOutput } = await execAsync(probeCommand);
        const audioDuration = parseFloat(durationOutput.trim());
        console.log(`  Audio duration: ${audioDuration.toFixed(2)}s`);
        if (audioDuration < 0.1) {
            throw new Error(`Audio duration too short (${audioDuration}s) - may be silent or corrupted`);
        }
    }
    catch (error) {
        console.error('❌ Audio extraction error:', error);
        throw new Error(`Audio extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}
async function processWithWhisper(audioPath) {
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });
    try {
        const audioBuffer = await readFile(audioPath);
        const audioBlob = new Blob([audioBuffer], { type: 'audio/wav' });
        // For OpenAI API, we need to pass the file properly
        const file = new File([audioBlob], 'audio.wav', { type: 'audio/wav' });
        const transcript = await openai.audio.transcriptions.create({
            file,
            model: 'whisper-1',
            language: 'ja', // Japanese default
            response_format: 'verbose_json',
        });
        // DEBUG: Whisper APIの応答を詳細にログ出力
        console.log('🔍 DEBUG - Whisper API Response:');
        console.log('  Text:', transcript.text);
        console.log('  Language:', transcript.language);
        console.log('  Duration:', transcript.duration);
        console.log('  Segments count:', transcript.segments?.length || 0);
        // セグメントの詳細ログ
        if (transcript.segments && transcript.segments.length > 0) {
            console.log('  First segment:', JSON.stringify(transcript.segments[0], null, 2));
            if (transcript.segments.length > 1) {
                console.log('  Second segment:', JSON.stringify(transcript.segments[1], null, 2));
            }
            if (transcript.segments.length > 2) {
                console.log(`  ... (${transcript.segments.length - 2} more segments)`);
            }
        }
        else {
            console.warn('  ⚠️ WARNING: No segments in Whisper response!');
        }
        console.log('  Full response keys:', Object.keys(transcript));
        // 警告: セグメント数が異常に少ない場合
        if (transcript.segments && transcript.segments.length === 1) {
            console.warn('⚠️ WARNING: Only 1 segment detected!');
            console.warn('  Possible causes:');
            console.warn('  - Audio is very short or mostly silent');
            console.warn('  - Audio quality is poor');
            console.warn('  - Language detection failed');
            console.warn(`  - Detected text: "${transcript.text}"`);
        }
        // エラー: セグメントが全くない場合
        if (!transcript.segments || transcript.segments.length === 0) {
            throw new Error('Whisper API returned no segments - audio may be silent or invalid');
        }
        return {
            text: transcript.text,
            language: transcript.language,
            segments: transcript.segments || [],
            duration: transcript.duration || 0,
        };
    }
    catch (error) {
        console.error('❌ Whisper API error:', error);
        // OpenAI APIの具体的なエラーを分類
        if (error instanceof Error) {
            if (error.message.includes('Invalid file format')) {
                throw new Error('Whisper API: Invalid audio format - ensure WAV format is correct');
            }
            else if (error.message.includes('File too large')) {
                throw new Error('Whisper API: Audio file exceeds 25MB limit');
            }
            else if (error.message.includes('rate_limit')) {
                throw new Error('Whisper API: Rate limit exceeded - please try again later');
            }
        }
        throw new Error(`Whisper API failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}
async function processWithGeminiVision(frames, uploadId) {
    const results = [];
    // Check if Gemini API key is configured
    if (!process.env.GEMINI_API_KEY) {
        console.warn(`[${uploadId}] ⚠️ GEMINI_API_KEY not configured, skipping Gemini Vision OCR`);
        // Return empty results for each frame
        return frames.map(frame => ({
            timecode: frame.timecode,
            text: '',
            confidence: 0,
            method: 'gemini-vision-skipped'
        }));
    }
    let geminiService = null;
    try {
        console.log(`[${uploadId}]   🔧 Initializing Gemini 2.0 Flash Vision...`);
        geminiService = await createGeminiVisionService();
        if (!geminiService) {
            console.warn(`[${uploadId}]   ⚠️ Failed to initialize Gemini Vision, skipping OCR`);
            return frames.map(frame => ({
                timecode: frame.timecode,
                text: '',
                confidence: 0,
                method: 'gemini-vision-failed'
            }));
        }
        console.log(`[${uploadId}]   ✅ Gemini Vision ready`);
        console.log(`[${uploadId}]   📋 Processing ${frames.length} frames...`);
        // Process all frames
        for (let i = 0; i < frames.length; i++) {
            const frame = frames[i];
            try {
                const ocrResult = await geminiService.detectText(frame.filename, frame.timecode);
                if (ocrResult.text.trim().length > 0) {
                    console.log(`[${uploadId}]     ✅ [${frame.timecode}] Text detected (${(ocrResult.confidence * 100).toFixed(1)}%)`);
                    console.log(`[${uploadId}]        Preview: ${ocrResult.text.substring(0, 60)}...`);
                }
                else {
                    console.log(`[${uploadId}]     ⚪ [${frame.timecode}] No text detected`);
                }
                results.push(ocrResult);
            }
            catch (error) {
                console.error(`[${uploadId}]     ❌ Error processing frame ${i + 1}:`, error.message);
                results.push({
                    timecode: frame.timecode,
                    text: '',
                    confidence: 0,
                    method: 'gemini-vision-error'
                });
            }
            // Progress indicator
            if ((i + 1) % 5 === 0 || i === frames.length - 1) {
                const progress = ((i + 1) / frames.length * 100).toFixed(1);
                console.log(`[${uploadId}]     ⏳ Progress: ${i + 1}/${frames.length} frames (${progress}%)`);
            }
        }
        // Calculate statistics
        const framesWithText = results.filter(r => r.text.trim().length > 0).length;
        const avgConfidence = results.length > 0
            ? results.reduce((sum, r) => sum + r.confidence, 0) / results.length
            : 0;
        console.log(`[${uploadId}]   ✅ OCR Summary:`);
        console.log(`[${uploadId}]      Total Frames: ${frames.length}`);
        console.log(`[${uploadId}]      Frames with Text: ${framesWithText} (${(framesWithText / frames.length * 100).toFixed(1)}%)`);
        console.log(`[${uploadId}]      Average Confidence: ${(avgConfidence * 100).toFixed(1)}%`);
    }
    finally {
        if (geminiService) {
            await geminiService.close();
        }
    }
    return results;
}
async function uploadToBlob(buffer, uploadId) {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
        throw new Error('BLOB_READ_WRITE_TOKEN not configured');
    }
    const { url } = await put(`results/${uploadId}/output.xlsx`, buffer, {
        access: 'public',
        token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    return url;
}
async function saveAnalytics(data) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
        console.warn('Supabase not configured, skipping analytics save');
        return;
    }
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { error } = await supabase.from('video_analytics').insert([{
            upload_id: data.uploadId,
            file_name_hash: hashString(data.fileName),
            file_size: data.metadata.fileSize || 0,
            duration: data.metadata.duration || 0,
            resolution: data.metadata.resolution || '',
            codec: data.metadata.codec || '',
            bitrate: data.metadata.bitrate || 0,
            whisper_accuracy: 0.95, // Placeholder
            segment_count: data.transcription.segments?.length || 0,
            uploaded_at: new Date().toISOString(),
            data_consent: true,
            platform: 'cloud-run',
        }]);
    if (error) {
        console.warn('Analytics save failed:', error);
        // Don't throw - analytics is optional
    }
}
function hashString(str) {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(str).digest('hex');
}
