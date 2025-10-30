import * as XLSX from 'xlsx';

interface TranscriptionSegment {
  timestamp: number;
  duration: number;
  text: string;
  confidence: number;
}

interface OCRResult {
  timestamp: number;
  frameIndex: number;
  text: string;
  confidence: number;
}

interface AnalysisResult {
  duration: number;
  segmentCount: number;
  ocrResults: OCRResult[];
  transcription: TranscriptionSegment[];
  scenes: Array<{ timestamp: number; description: string }>;
}

export const generateExcelReport = async (
  outputPath: string,
  fileName: string,
  analysis: AnalysisResult
) => {
  // Create workbook
  const workbook = XLSX.utils.book_new();

  // Sheet 1: Summary
  const summaryData = [
    ['Video Analysis Report'],
    [''],
    ['File Name', fileName],
    ['Processing Date', new Date().toISOString()],
    ['Duration (seconds)', analysis.duration],
    ['Total Segments', analysis.segmentCount],
    ['OCR Results', analysis.ocrResults.length],
    ['Transcription Length', analysis.transcription.reduce((sum, seg) => sum + seg.text.length, 0)],
  ];

  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');

  // Sheet 2: Transcription
  const transcriptionHeaders = ['Timestamp (s)', 'Duration (s)', 'Text', 'Confidence'];
  const transcriptionData = analysis.transcription.map(seg => [
    seg.timestamp.toFixed(2),
    seg.duration.toFixed(2),
    seg.text,
    (seg.confidence * 100).toFixed(1) + '%'
  ]);

  const transcriptionSheet = XLSX.utils.aoa_to_sheet([
    transcriptionHeaders,
    ...transcriptionData
  ]);

  // Set column widths for transcription sheet
  transcriptionSheet['!cols'] = [
    { wch: 15 },  // Timestamp
    { wch: 12 },  // Duration
    { wch: 50 },  // Text
    { wch: 12 }   // Confidence
  ];

  XLSX.utils.book_append_sheet(workbook, transcriptionSheet, 'Transcription');

  // Sheet 3: OCR Results
  const ocrHeaders = ['Timestamp (s)', 'Frame #', 'Text', 'Confidence'];
  const ocrData = analysis.ocrResults.map(result => [
    result.timestamp.toFixed(2),
    result.frameIndex,
    result.text,
    (result.confidence * 100).toFixed(1) + '%'
  ]);

  const ocrSheet = XLSX.utils.aoa_to_sheet([
    ocrHeaders,
    ...ocrData
  ]);

  // Set column widths for OCR sheet
  ocrSheet['!cols'] = [
    { wch: 15 },  // Timestamp
    { wch: 10 },  // Frame #
    { wch: 50 },  // Text
    { wch: 12 }   // Confidence
  ];

  XLSX.utils.book_append_sheet(workbook, ocrSheet, 'OCR Results');

  // Sheet 4: Combined Analysis
  const combinedHeaders = [
    'Timestamp (s)',
    'Type',
    'Content',
    'Confidence',
    'Duration (s)'
  ];

  const combinedData: any[] = [];

  // Add all transcription segments
  for (const seg of analysis.transcription) {
    combinedData.push([
      seg.timestamp.toFixed(2),
      'Speech',
      seg.text,
      (seg.confidence * 100).toFixed(1) + '%',
      seg.duration.toFixed(2)
    ]);
  }

  // Add OCR results
  for (const ocr of analysis.ocrResults) {
    combinedData.push([
      ocr.timestamp.toFixed(2),
      'Text (OCR)',
      ocr.text,
      (ocr.confidence * 100).toFixed(1) + '%',
      '-'
    ]);
  }

  // Sort by timestamp
  combinedData.sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]));

  const combinedSheet = XLSX.utils.aoa_to_sheet([
    combinedHeaders,
    ...combinedData
  ]);

  // Set column widths
  combinedSheet['!cols'] = [
    { wch: 15 },  // Timestamp
    { wch: 12 },  // Type
    { wch: 50 },  // Content
    { wch: 12 },  // Confidence
    { wch: 12 }   // Duration
  ];

  XLSX.utils.book_append_sheet(workbook, combinedSheet, 'Full Analysis');

  // Sheet 5: Metadata
  const metadataData = [
    ['Metadata'],
    [''],
    ['Processing Information'],
    ['Report Generated', new Date().toISOString()],
    ['Video File', fileName],
    ['Total Duration', formatTime(analysis.duration)],
    [''],
    ['Statistics'],
    ['Total Speech Segments', analysis.segmentCount],
    ['Total OCR Frames', analysis.ocrResults.length],
    ['Unique Words (Transcription)', new Set(
      analysis.transcription.flatMap(seg => seg.text.toLowerCase().split(/\s+/))
    ).size],
    ['Unique Words (OCR)', new Set(
      analysis.ocrResults.flatMap(ocr => ocr.text.toLowerCase().split(/\s+/))
    ).size],
    [''],
    ['Average Confidence'],
    ['Transcription', (
      (analysis.transcription.reduce((sum, seg) => sum + seg.confidence, 0) / analysis.transcription.length) * 100
    ).toFixed(1) + '%'],
    ['OCR', (
      (analysis.ocrResults.reduce((sum, ocr) => sum + ocr.confidence, 0) / analysis.ocrResults.length) * 100
    ).toFixed(1) + '%'],
  ];

  const metadataSheet = XLSX.utils.aoa_to_sheet(metadataData);
  metadataSheet['!cols'] = [
    { wch: 30 },
    { wch: 50 }
  ];

  XLSX.utils.book_append_sheet(workbook, metadataSheet, 'Metadata');

  // Write file
  XLSX.writeFile(workbook, outputPath);

  console.log(`Excel report generated: ${outputPath}`);
};

function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = (seconds % 60).toFixed(2);

  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  } else {
    return `${secs}s`;
  }
}
