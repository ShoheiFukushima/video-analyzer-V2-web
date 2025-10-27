/**
 * Hybrid Excel Export Service (V1 + V2)
 * Combines Gemini Vision OCR (V1) with Whisper Transcription (V2)
 * Format: Scene #, Timecode, Screenshot (embedded), OCR Text, Whisper Audio Text
 */
import ExcelJS from 'exceljs';
import { promises as fs } from 'fs';
// Excel layout constants
const EXCEL_IMAGE_WIDTH_PX = 320;
const DEFAULT_ASPECT_RATIO = 16 / 9;
const PIXELS_PER_CHARACTER_WIDTH = 7;
const POINTS_PER_PIXEL = 0.75;
// Whisper confidence threshold (segments below this will be filtered out)
const MIN_CONFIDENCE_THRESHOLD = 0.5;
export async function generateExcel(transcription, metadata, outputPath, fileName, hybridData) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Video Analyzer Web (Hybrid Mode)';
    workbook.created = new Date();
    workbook.modified = new Date();
    // If hybrid data is provided, create V1+V2 hybrid sheet
    if (hybridData && hybridData.frames.length > 0) {
        await addHybridSheet(workbook, hybridData, transcription, metadata);
    }
    else {
        // Fallback to V2 format if no frames
        addTranscriptionSheet(workbook, transcription);
    }
    // Add statistics sheet
    addMetadataSheet(workbook, transcription, metadata, fileName, hybridData);
    // Save to file
    await workbook.xlsx.writeFile(outputPath);
}
/**
 * Add hybrid sheet with screenshots, OCR, and Whisper transcription
 */
async function addHybridSheet(workbook, hybridData, transcription, metadata) {
    const worksheet = workbook.addWorksheet('Hybrid Analysis', {
        views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }]
    });
    // Calculate image dimensions
    const aspectRatio = metadata.aspectRatio || DEFAULT_ASPECT_RATIO;
    const imageWidth = EXCEL_IMAGE_WIDTH_PX;
    const imageHeight = Math.round(imageWidth / aspectRatio);
    const columnWidth = Math.ceil(imageWidth / PIXELS_PER_CHARACTER_WIDTH);
    const rowHeight = Math.round(imageHeight * POINTS_PER_PIXEL);
    console.log(`  📐 Image dimensions: ${imageWidth}x${imageHeight}px (aspect ratio: ${aspectRatio.toFixed(2)}:1)`);
    console.log(`  📏 Column width: ${columnWidth} characters (${imageWidth}px)`);
    console.log(`  📏 Row height: ${rowHeight} points (${imageHeight}px)`);
    // Define columns
    worksheet.columns = [
        { header: 'Scene #', key: 'scene', width: 10 },
        { header: 'Timecode', key: 'timecode', width: 12 },
        { header: 'Screenshot', key: 'screenshot', width: columnWidth },
        { header: 'OCR Text (Gemini Vision)', key: 'ocrText', width: 40 },
        { header: 'Audio Text (Whisper)', key: 'audioText', width: 40 }
    ];
    // Style header row
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
    headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4A90E2' }
    };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    headerRow.height = 25;
    // Add data rows
    for (let i = 0; i < hybridData.frames.length; i++) {
        const frame = hybridData.frames[i];
        const ocrResult = hybridData.ocrResults[i];
        // Find all Whisper segments between this frame and the next frame
        const audioText = findWhisperSegmentsForTime(transcription, hybridData.frames, i, metadata.duration);
        const rowNumber = frame.sceneNumber + 1; // +1 for header
        // Add row data
        const row = worksheet.addRow({
            scene: frame.sceneNumber,
            timecode: frame.timecode,
            screenshot: '',
            ocrText: ocrResult?.text || '(no text detected)',
            audioText: audioText || '音声なし'
        });
        // Set row height
        row.height = rowHeight;
        // Alternate row colors
        if ((frame.sceneNumber - 1) % 2 === 0) {
            row.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFF5F5F5' }
            };
        }
        // Center align scene and timecode
        row.getCell('scene').alignment = { horizontal: 'center', vertical: 'middle' };
        row.getCell('timecode').alignment = { horizontal: 'center', vertical: 'middle' };
        // Wrap text in text columns
        row.getCell('ocrText').alignment = { wrapText: true, vertical: 'top' };
        row.getCell('audioText').alignment = { wrapText: true, vertical: 'top' };
        // Style text cells
        if (ocrResult?.text) {
            row.getCell('ocrText').font = { bold: false };
        }
        else {
            row.getCell('ocrText').font = { italic: true, color: { argb: 'FF999999' } };
        }
        // Apply gray italic style to "音声なし" or empty audio text
        if (audioText && audioText !== '音声なし') {
            row.getCell('audioText').font = { bold: false };
        }
        else {
            row.getCell('audioText').font = { italic: true, color: { argb: 'FF999999' } };
        }
        // Embed screenshot
        try {
            const imageBuffer = await fs.readFile(frame.filename);
            // Type assertion needed: ExcelJS defines its own Buffer type incompatible with Node.js Buffer
            const imageId = workbook.addImage({
                buffer: imageBuffer,
                extension: 'jpeg'
            });
            const cellWidthPx = columnWidth * PIXELS_PER_CHARACTER_WIDTH;
            const cellHeightPx = rowHeight / POINTS_PER_PIXEL;
            const offsetX = Math.max(0, (cellWidthPx - imageWidth) / 2);
            const offsetY = Math.max(0, (cellHeightPx - imageHeight) / 2);
            worksheet.addImage(imageId, {
                tl: {
                    col: 2,
                    row: rowNumber - 1,
                    colOff: Math.round(offsetX * 9525),
                    rowOff: Math.round(offsetY * 9525)
                },
                ext: { width: imageWidth, height: imageHeight },
                editAs: 'oneCell'
            });
            console.log(`  ✓ Embedded screenshot for Scene ${frame.sceneNumber}`);
        }
        catch (error) {
            console.error(`  ⚠️ Failed to embed screenshot for Scene ${frame.sceneNumber}:`, error);
            row.getCell('screenshot').value = '(image unavailable)';
        }
        // Re-enforce height after image embedding
        row.height = rowHeight;
    }
    // Add borders to all cells
    worksheet.eachRow({ includeEmpty: false }, (row) => {
        row.eachCell((cell) => {
            cell.border = {
                top: { style: 'thin', color: { argb: 'FFD3D3D3' } },
                left: { style: 'thin', color: { argb: 'FFD3D3D3' } },
                bottom: { style: 'thin', color: { argb: 'FFD3D3D3' } },
                right: { style: 'thin', color: { argb: 'FFD3D3D3' } }
            };
        });
    });
}
/**
 * Find all Whisper segments between current frame and next frame
 * Returns "音声なし" if no audio detected by VAD
 * Filters out low-confidence segments (< 0.5)
 */
function findWhisperSegmentsForTime(transcription, frames, currentFrameIndex, videoDuration) {
    // Check if VAD detected no audio
    if (transcription.hasAudio === false) {
        return '音声なし';
    }
    if (!transcription.segments || transcription.segments.length === 0) {
        return '音声なし';
    }
    const currentFrame = frames[currentFrameIndex];
    const startTime = currentFrame.timestamp;
    // End time is the next frame's timestamp, or video duration for last frame
    const endTime = currentFrameIndex < frames.length - 1
        ? frames[currentFrameIndex + 1].timestamp
        : videoDuration;
    // Find all segments that overlap with this scene's time range
    // Filter out low-confidence segments
    const matchingSegments = transcription.segments.filter(seg => {
        const confidence = seg.no_speech_prob !== undefined ? (1 - seg.no_speech_prob) : 1;
        // Check if segment overlaps with [startTime, endTime)
        const segmentOverlaps = seg.start < endTime && seg.end > startTime;
        return segmentOverlaps && confidence >= MIN_CONFIDENCE_THRESHOLD;
    });
    if (matchingSegments.length === 0) {
        return '';
    }
    // Join all matching segments' text
    return matchingSegments.map(seg => seg.text.trim()).join(' ');
}
/**
 * Add V2-style transcription sheet (fallback if no frames)
 * Filters out low-confidence segments (< 0.5)
 */
function addTranscriptionSheet(workbook, transcription) {
    const worksheet = workbook.addWorksheet('Transcription');
    worksheet.columns = [
        { header: '開始時間', key: 'start', width: 12 },
        { header: '終了時間', key: 'end', width: 12 },
        { header: 'テキスト', key: 'text', width: 50 },
        { header: '信頼度', key: 'confidence', width: 10 },
    ];
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4472C4' },
    };
    if (transcription.segments && Array.isArray(transcription.segments)) {
        // Filter out low-confidence segments
        const highConfidenceSegments = transcription.segments.filter(segment => {
            const confidence = segment.no_speech_prob !== undefined ? (1 - segment.no_speech_prob) : 1;
            return confidence >= MIN_CONFIDENCE_THRESHOLD;
        });
        console.log(`  📊 Filtered transcription segments: ${highConfidenceSegments.length}/${transcription.segments.length} (removed ${transcription.segments.length - highConfidenceSegments.length} low-confidence segments)`);
        highConfidenceSegments.forEach((segment) => {
            const confidence = segment.no_speech_prob !== undefined ? (1 - segment.no_speech_prob) : 1;
            worksheet.addRow({
                start: formatTime(segment.start),
                end: formatTime(segment.end),
                text: segment.text.trim(),
                confidence: confidence.toFixed(2),
            });
        });
    }
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];
}
function addMetadataSheet(workbook, transcription, metadata, fileName, hybridData) {
    const worksheet = workbook.addWorksheet('Statistics');
    worksheet.mergeCells('A1:B1');
    const titleCell = worksheet.getCell('A1');
    titleCell.value = '動画分析統計 (Hybrid Mode)';
    titleCell.font = { bold: true, size: 14, color: { argb: 'FF4472C4' } };
    titleCell.alignment = { horizontal: 'centerContinuous', vertical: 'middle' };
    let row = 3;
    // File info
    addSection(worksheet, row, 'ファイル情報');
    row++;
    const videoInfo = [
        ['ファイル名', fileName],
        ['ファイルサイズ', formatBytes(metadata.fileSize)],
        ['動画長', formatDuration(metadata.duration)],
        ['解像度', metadata.resolution],
        ['コーデック', metadata.codec],
        ['ビットレート', formatBitrate(metadata.bitrate)],
        ['フレームレート', `${metadata.fps.toFixed(2)} fps`],
    ];
    videoInfo.forEach(([key, value]) => {
        worksheet.getCell(`A${row}`).value = key;
        worksheet.getCell(`B${row}`).value = value;
        worksheet.getCell(`A${row}`).font = { bold: true };
        row++;
    });
    row += 2;
    // Hybrid processing info
    if (hybridData && hybridData.frames.length > 0) {
        addSection(worksheet, row, 'Gemini Vision OCR結果');
        row++;
        const ocrWithText = hybridData.ocrResults.filter(r => r.text.trim().length > 0).length;
        const ocrInfo = [
            ['抽出フレーム数', hybridData.frames.length],
            ['テキスト検出フレーム', `${ocrWithText} (${(ocrWithText / hybridData.frames.length * 100).toFixed(1)}%)`],
            ['OCRモデル', 'Gemini 2.0 Flash'],
        ];
        ocrInfo.forEach(([key, value]) => {
            worksheet.getCell(`A${row}`).value = key;
            worksheet.getCell(`B${row}`).value = value;
            worksheet.getCell(`A${row}`).font = { bold: true };
            row++;
        });
        row += 2;
    }
    // Whisper transcription info
    addSection(worksheet, row, '音声認識結果 (Whisper)');
    row++;
    const segments = transcription.segments || [];
    const transcriptionInfo = [
        ['総テキスト長', `${transcription.text.length} 文字`],
        ['セグメント数', segments.length],
        ['言語', transcription.language || 'Japanese (推定)'],
    ];
    transcriptionInfo.forEach(([key, value]) => {
        worksheet.getCell(`A${row}`).value = key;
        worksheet.getCell(`B${row}`).value = value;
        worksheet.getCell(`A${row}`).font = { bold: true };
        row++;
    });
    row += 2;
    // Processing info
    addSection(worksheet, row, '処理情報');
    row++;
    const processingInfo = [
        ['処理日時', new Date().toLocaleString('ja-JP')],
        ['処理方式', 'Hybrid (Gemini Vision + Whisper)'],
        ['出力版', '3.0 (Hybrid)'],
    ];
    processingInfo.forEach(([key, value]) => {
        worksheet.getCell(`A${row}`).value = key;
        worksheet.getCell(`B${row}`).value = value;
        worksheet.getCell(`A${row}`).font = { bold: true };
        row++;
    });
    worksheet.getColumn('A').width = 20;
    worksheet.getColumn('B').width = 40;
}
function addSection(worksheet, row, title) {
    const cell = worksheet.getCell(`A${row}`);
    cell.value = title;
    cell.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
    cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF70AD47' },
    };
    worksheet.mergeCells(`A${row}:B${row}`);
    const borders = {
        top: { style: 'thin', color: { argb: 'FF000000' } },
        left: { style: 'thin', color: { argb: 'FF000000' } },
        bottom: { style: 'thin', color: { argb: 'FF000000' } },
        right: { style: 'thin', color: { argb: 'FF000000' } },
    };
    cell.border = borders;
}
function formatTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}
function formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
        return `${hours}時間${minutes}分`;
    }
    return `${minutes}分`;
}
function formatBytes(bytes) {
    if (bytes === 0)
        return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
function formatBitrate(bitrate) {
    if (bitrate === 0)
        return 'N/A';
    return (bitrate / 1000000).toFixed(2) + ' Mbps';
}
