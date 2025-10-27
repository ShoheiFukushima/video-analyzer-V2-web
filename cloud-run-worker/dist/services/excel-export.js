import ExcelJS from 'exceljs';
export async function generateExcel(transcription, metadata, outputPath, fileName) {
    const workbook = new ExcelJS.Workbook();
    // Sheet 1: Transcription segments
    addTranscriptionSheet(workbook, transcription);
    // Sheet 2: Metadata & Statistics
    addMetadataSheet(workbook, transcription, metadata, fileName);
    // Save to file
    await workbook.xlsx.writeFile(outputPath);
}
function addTranscriptionSheet(workbook, transcription) {
    const worksheet = workbook.addWorksheet('Transcription');
    // Header
    worksheet.columns = [
        { header: '開始時間', key: 'start', width: 12 },
        { header: '終了時間', key: 'end', width: 12 },
        { header: 'テキスト', key: 'text', width: 50 },
        { header: '信頼度', key: 'confidence', width: 10 },
    ];
    // Style header
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4472C4' },
    };
    // Add data rows
    if (transcription.segments && Array.isArray(transcription.segments)) {
        transcription.segments.forEach((segment, index) => {
            worksheet.addRow({
                start: formatTime(segment.start),
                end: formatTime(segment.end),
                text: segment.text.trim(),
                confidence: segment.no_speech_prob ? (1 - segment.no_speech_prob).toFixed(2) : 'N/A',
            });
        });
    }
    // Auto-fit columns
    worksheet.columns.forEach((col) => {
        if (col.header === 'テキスト') {
            col.width = Math.min(100, Math.max(30, col.width || 50));
        }
    });
    // Freeze header
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];
}
function addMetadataSheet(workbook, transcription, metadata, fileName) {
    const worksheet = workbook.addWorksheet('Statistics');
    // Title
    worksheet.mergeCells('A1:B1');
    const titleCell = worksheet.getCell('A1');
    titleCell.value = '動画分析統計';
    titleCell.font = { bold: true, size: 14, color: { argb: 'FF4472C4' } };
    titleCell.alignment = { horizontal: 'centerContinuous', vertical: 'middle' };
    let row = 3;
    // Video Info Section
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
    // Transcription Info Section
    addSection(worksheet, row, '音声認識結果');
    row++;
    const segments = transcription.segments || [];
    const transcriptionInfo = [
        ['総テキスト長', `${transcription.text.length} 文字`],
        ['セグメント数', segments.length],
        ['言語', transcription.language || 'Japanese (推定)'],
        ['平均セグメント長', segments.length > 0 ? (transcription.text.length / segments.length).toFixed(0) + ' 文字' : 'N/A'],
    ];
    transcriptionInfo.forEach(([key, value]) => {
        worksheet.getCell(`A${row}`).value = key;
        worksheet.getCell(`B${row}`).value = value;
        worksheet.getCell(`A${row}`).font = { bold: true };
        row++;
    });
    row += 2;
    // Processing Info Section
    addSection(worksheet, row, '処理情報');
    row++;
    const processingInfo = [
        ['処理日時', new Date().toLocaleString('ja-JP')],
        ['処理方式', 'OpenAI Whisper API'],
        ['出力版', '2.0'],
    ];
    processingInfo.forEach(([key, value]) => {
        worksheet.getCell(`A${row}`).value = key;
        worksheet.getCell(`B${row}`).value = value;
        worksheet.getCell(`A${row}`).font = { bold: true };
        row++;
    });
    // Set column widths
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
    // Merge cells
    worksheet.mergeCells(`A${row}:B${row}`);
    // Add border
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
