/**
 * Excel Generator Service
 * Generate Excel file with ideal format: Scene # | Timecode | Screenshot | OCR Text | NA Text
 * Based on V1's proven image embedding implementation
 *
 * Adapted from V1 for V2 architecture with narration text support
 */
import ExcelJS from 'exceljs';
import { promises as fs } from 'fs';
// Excel layout constants
const EXCEL_IMAGE_WIDTH_PX = 320; // Target image width in pixels
const DEFAULT_ASPECT_RATIO = 16 / 9; // Default 16:9 aspect ratio (1280x720)
// Unit conversion constants (ExcelJS specific)
const PIXELS_PER_CHARACTER_WIDTH = 7; // 1 character width ≈ 7px (Calibri 11pt, 96 DPI)
const POINTS_PER_PIXEL = 0.75; // 96 DPI: 1px = 0.75pt
/**
 * Generate Excel file with OCR results, narration, and embedded screenshots
 * Format: Scene # | Timecode | Screenshot | OCR Text | NA Text
 *
 * @param options - Excel generation options
 * @returns Excel file as Buffer
 */
export async function generateExcel(options) {
    const { projectTitle, rows, videoMetadata, includeStatistics = false } = options;
    console.log(`📊 Generating Excel file: ${projectTitle} (${rows.length} scenes)`);
    // Calculate image dimensions based on video metadata
    const aspectRatio = videoMetadata.aspectRatio || DEFAULT_ASPECT_RATIO;
    const imageWidth = EXCEL_IMAGE_WIDTH_PX;
    const imageHeight = Math.round(imageWidth / aspectRatio);
    // Calculate Excel units for perfect cell-image fit
    const columnWidth = Math.ceil(imageWidth / PIXELS_PER_CHARACTER_WIDTH);
    const rowHeight = Math.round(imageHeight * POINTS_PER_PIXEL);
    console.log(`  📐 Image dimensions: ${imageWidth}x${imageHeight}px (aspect ratio: ${aspectRatio.toFixed(2)}:1)`);
    console.log(`  📏 Column width: ${columnWidth} characters (${imageWidth}px)`);
    console.log(`  📏 Row height: ${rowHeight} points (${imageHeight}px)`);
    const workbook = new ExcelJS.Workbook();
    // Set workbook properties
    workbook.creator = 'Video Analyzer V2';
    workbook.created = new Date();
    workbook.modified = new Date();
    // Create main worksheet
    const worksheet = workbook.addWorksheet('Video Analysis', {
        views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }] // Freeze header row
    });
    // Define columns with V2 format (5 columns)
    worksheet.columns = [
        { header: 'Scene #', key: 'scene', width: 10 },
        { header: 'Timecode', key: 'timecode', width: 12 },
        { header: 'Screenshot', key: 'screenshot', width: columnWidth },
        { header: 'OCR Text', key: 'ocrText', width: 40 },
        { header: 'NA Text', key: 'naText', width: 40 } // Narration text column
    ];
    // Style the header row
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
    headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4A90E2' }
    };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    headerRow.height = 25;
    // Add data rows with embedded screenshots
    for (const excelRow of rows) {
        const rowNumber = excelRow.sceneNumber + 1; // +1 for header row
        // Add row data (without screenshot initially)
        const row = worksheet.addRow({
            scene: { formula: 'ROW()-1' }, // Auto-renumbering formula (works even if rows are deleted)
            timecode: excelRow.timecode,
            screenshot: '', // Placeholder, will embed image
            ocrText: excelRow.ocrText || '(no text detected)',
            naText: excelRow.narrationText || '(no narration)'
        });
        // Set row height based on calculated image dimensions
        // Maintains video's original aspect ratio (e.g., 16:9 for 1280x720)
        row.height = rowHeight;
        // Alternate row colors
        if ((excelRow.sceneNumber - 1) % 2 === 0) {
            row.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFF5F5F5' }
            };
        }
        // Highlight rows with OCR text detected
        if (excelRow.ocrText) {
            row.getCell('ocrText').font = { bold: false };
        }
        else {
            row.getCell('ocrText').font = { italic: true, color: { argb: 'FF999999' } };
        }
        // Highlight rows with narration detected
        if (excelRow.narrationText) {
            row.getCell('naText').font = { bold: false };
        }
        else {
            row.getCell('naText').font = { italic: true, color: { argb: 'FF999999' } };
        }
        // Center align scene number and timecode
        row.getCell('scene').alignment = { horizontal: 'center', vertical: 'middle' };
        row.getCell('timecode').alignment = { horizontal: 'center', vertical: 'middle' };
        // Wrap text in OCR and NA columns
        row.getCell('ocrText').alignment = { wrapText: true, vertical: 'top' };
        row.getCell('naText').alignment = { wrapText: true, vertical: 'top' };
        // Embed screenshot image
        try {
            const imageBuffer = await fs.readFile(excelRow.screenshotPath);
            const imageId = workbook.addImage({
                // @ts-ignore - ExcelJS buffer type compatibility issue with Node.js fs.readFile
                buffer: imageBuffer,
                extension: 'png'
            });
            // Add image to cell (column C = screenshot column, 0-indexed)
            // Center the image within the cell both horizontally and vertically
            // Calculate cell dimensions in pixels
            const cellWidthPx = columnWidth * PIXELS_PER_CHARACTER_WIDTH;
            const cellHeightPx = rowHeight / POINTS_PER_PIXEL;
            // Calculate offset to center the image
            const offsetX = Math.max(0, (cellWidthPx - imageWidth) / 2);
            const offsetY = Math.max(0, (cellHeightPx - imageHeight) / 2);
            worksheet.addImage(imageId, {
                tl: {
                    col: 2, // Column C (0-indexed)
                    row: rowNumber - 1, // Current row (0-indexed)
                    colOff: Math.round(offsetX * 9525), // Horizontal offset in EMUs
                    rowOff: Math.round(offsetY * 9525) // Vertical offset in EMUs
                }, // Type assertion: ExcelJS supports colOff/rowOff but types are incomplete
                ext: { width: imageWidth, height: imageHeight }, // Aspect ratio from video metadata
                editAs: 'oneCell'
            });
            console.log(`  ✓ Embedded screenshot for Scene ${excelRow.sceneNumber}`);
        }
        catch (error) {
            console.error(`  ⚠️ Failed to embed screenshot for Scene ${excelRow.sceneNumber}:`, error);
            row.getCell('screenshot').value = '(image unavailable)';
        }
        // Re-enforce height after image embedding (fixes ExcelJS auto-adjustment)
        row.height = rowHeight;
    }
    // Add border to all cells
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
    // Add statistics sheet if requested
    if (includeStatistics) {
        await addStatisticsSheet(workbook, rows, videoMetadata);
    }
    // Generate Excel file buffer
    const arrayBuffer = await workbook.xlsx.writeBuffer();
    const buffer = Buffer.from(arrayBuffer);
    console.log(`✅ Excel file generated (${(buffer.length / 1024).toFixed(1)} KB)`);
    return buffer;
}
/**
 * Add statistics worksheet to workbook
 */
async function addStatisticsSheet(workbook, rows, videoMetadata) {
    const statsSheet = workbook.addWorksheet('Statistics');
    statsSheet.columns = [
        { header: 'Metric', key: 'metric', width: 30 },
        { header: 'Value', key: 'value', width: 20 }
    ];
    // Style header
    const statsHeaderRow = statsSheet.getRow(1);
    statsHeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    statsHeaderRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF2ECC71' }
    };
    // Calculate statistics
    const totalScenes = rows.length;
    const scenesWithOCR = rows.filter(r => r.ocrText && r.ocrText.trim().length > 0).length;
    const scenesWithNarration = rows.filter(r => r.narrationText && r.narrationText.trim().length > 0).length;
    const ocrRate = ((scenesWithOCR / totalScenes) * 100).toFixed(1);
    const narrationRate = ((scenesWithNarration / totalScenes) * 100).toFixed(1);
    // Add statistics data
    statsSheet.addRow({ metric: 'Total Scenes', value: totalScenes });
    statsSheet.addRow({ metric: 'Scenes with OCR Text', value: scenesWithOCR });
    statsSheet.addRow({ metric: 'Scenes with Narration', value: scenesWithNarration });
    statsSheet.addRow({ metric: 'OCR Detection Rate', value: `${ocrRate}%` });
    statsSheet.addRow({ metric: 'Narration Coverage Rate', value: `${narrationRate}%` });
    statsSheet.addRow({ metric: '', value: '' }); // Separator
    // Video metadata
    statsSheet.addRow({ metric: 'Video Resolution', value: `${videoMetadata.width}x${videoMetadata.height}` });
    statsSheet.addRow({ metric: 'Aspect Ratio', value: `${videoMetadata.aspectRatio.toFixed(2)}:1` });
    statsSheet.addRow({ metric: 'Video Duration', value: `${videoMetadata.duration}s` });
    statsSheet.addRow({ metric: '', value: '' }); // Separator
    // Detection parameters (added: 2025-11-14)
    const detectionParamsHeader = statsSheet.addRow({ metric: 'Detection Parameters', value: '' });
    detectionParamsHeader.font = { bold: true };
    detectionParamsHeader.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFE4B5' } // Light orange
    };
    statsSheet.addRow({ metric: 'Scene Detection Thresholds', value: '0.025, 0.055, 0.085' });
    statsSheet.addRow({ metric: 'Min Scene Interval', value: '1.0s' });
    statsSheet.addRow({ metric: 'Min Scene Duration', value: '0.5s' });
    statsSheet.addRow({ metric: 'Screenshot Capture Position', value: '50% (mid-point)' });
    statsSheet.addRow({ metric: 'ROI Detection', value: 'Disabled (default)' });
    statsSheet.addRow({ metric: '', value: '' }); // Separator
    // Contact developer section
    const contactHeader = statsSheet.addRow({ metric: 'Need Adjustment?', value: '' });
    contactHeader.font = { bold: true };
    contactHeader.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF87CEEB' } // Sky blue
    };
    // Build email body with all statistics
    const emailBody = [
        'Video Analyzer V2 - Statistics Report',
        '',
        '=== SCENE STATISTICS ===',
        `Total Scenes: ${totalScenes}`,
        `Scenes with OCR Text: ${scenesWithOCR}`,
        `Scenes with Narration: ${scenesWithNarration}`,
        `OCR Detection Rate: ${ocrRate}%`,
        `Narration Coverage Rate: ${narrationRate}%`,
        '',
        '=== VIDEO METADATA ===',
        `Video Resolution: ${videoMetadata.width}x${videoMetadata.height}`,
        `Aspect Ratio: ${videoMetadata.aspectRatio.toFixed(2)}:1`,
        `Video Duration: ${videoMetadata.duration}s`,
        '',
        '=== DETECTION PARAMETERS ===',
        `Scene Detection Thresholds: 0.025, 0.055, 0.085`,
        `Min Scene Interval: 1.0s`,
        `Min Scene Duration: 0.5s`,
        `Screenshot Capture Position: 50% (mid-point)`,
        `ROI Detection: Disabled (default)`,
        '',
        '=== ADJUSTMENT REQUEST ===',
        'Please describe your issue or requested changes below:',
        '',
        '- Issue: ',
        '- Requested changes: ',
        ''
    ].join('%0A');
    const emailRow = statsSheet.addRow({
        metric: 'Contact Developer',
        value: {
            text: 'Click here to email developer',
            hyperlink: `mailto:syou430@gmail.com?subject=Video%20Analyzer%20Adjustment%20Request&body=${emailBody}`
        }
    });
    // Style the email link
    const emailCell = emailRow.getCell('value');
    emailCell.font = { color: { argb: 'FF0000FF' }, underline: true };
    // Add borders to stats
    statsSheet.eachRow((row) => {
        row.eachCell((cell) => {
            cell.border = {
                top: { style: 'thin', color: { argb: 'FFD3D3D3' } },
                left: { style: 'thin', color: { argb: 'FFD3D3D3' } },
                bottom: { style: 'thin', color: { argb: 'FFD3D3D3' } },
                right: { style: 'thin', color: { argb: 'FFD3D3D3' } }
            };
        });
    });
    console.log('  ✓ Added statistics sheet with detection parameters and contact button');
}
/**
 * Generate filename for Excel export
 * @param projectTitle - Project title
 * @returns Sanitized filename with timestamp
 */
export function generateExcelFilename(projectTitle) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const sanitized = projectTitle
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .substring(0, 50);
    return `${sanitized}_${timestamp}.xlsx`;
}
//# sourceMappingURL=excel-generator.js.map