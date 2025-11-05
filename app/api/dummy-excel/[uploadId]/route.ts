/**
 * DEPRECATED: This endpoint is disabled due to security vulnerabilities in xlsx package.
 * Use the actual /api/download/[uploadId] endpoint instead, which uses exceljs in Cloud Run Worker.
 *
 * Security Note: xlsx package was removed due to high-severity vulnerabilities:
 * - Prototype Pollution (GHSA-4r6h-8v6p-xvw6)
 * - Regular Expression Denial of Service (GHSA-5pgg-2g8v-p4x9)
 */

import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
// import * as XLSX from 'xlsx'; // REMOVED: Security vulnerability

export async function GET(
  request: Request,
  { params }: { params: { uploadId: string } }
) {
  try {
    // Verify authentication - Required for all environments
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'You must be logged in to download reports' },
        { status: 401 }
      );
    }

    const { uploadId } = params;

    // Create a dummy workbook with multiple sheets
    const workbook = XLSX.utils.book_new();

    // Sheet 1: Summary
    const summaryData = [
      ['Video Analysis Report'],
      [''],
      ['Upload ID', uploadId],
      ['Processing Date', new Date().toISOString()],
      ['Video Duration (seconds)', 120.5],
      ['Total Segments', 8],
      ['OCR Frames Detected', 12],
      ['Transcription Characters', 2543],
    ];

    const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');

    // Sheet 2: Transcription
    const transcriptionData = [
      ['Timestamp (s)', 'Duration (s)', 'Text', 'Confidence'],
      [0, 5.2, 'Welcome to the video analysis service', '0.95'],
      [5.2, 4.3, 'This tool provides AI-powered transcription and OCR', '0.92'],
      [9.5, 5.1, 'Results are compiled into comprehensive Excel reports', '0.94'],
      [14.6, 3.8, 'Supporting multiple video formats and languages', '0.93'],
      [18.4, 4.2, 'With production-ready quality and reliability', '0.96'],
      [22.6, 3.9, 'Deploy to any cloud platform or on-premise', '0.91'],
      [26.5, 4.4, 'Fully automated processing pipeline', '0.94'],
      [30.9, 3.6, 'Contact us for more information', '0.95'],
    ];

    const transcriptionSheet = XLSX.utils.aoa_to_sheet(transcriptionData);
    transcriptionSheet['!cols'] = [
      { wch: 15 },
      { wch: 12 },
      { wch: 50 },
      { wch: 12 },
    ];
    XLSX.utils.book_append_sheet(workbook, transcriptionSheet, 'Transcription');

    // Sheet 3: OCR Results
    const ocrData = [
      ['Timestamp (s)', 'Frame #', 'Text', 'Confidence'],
      [1.2, 1, 'Video Analyzer V2', '0.98'],
      [5.8, 15, 'AI-Powered Platform', '0.96'],
      [10.3, 26, 'Transcription & OCR', '0.94'],
      [15.1, 38, 'Multiple Languages', '0.92'],
      [20.5, 52, 'Fast Processing', '0.95'],
      [25.8, 65, 'High Accuracy', '0.97'],
      [31.2, 79, 'Cloud Ready', '0.93'],
      [38.5, 97, 'Enterprise Grade', '0.96'],
      [45.2, 114, 'For More Details', '0.91'],
      [51.8, 131, 'Visit Our Website', '0.94'],
      [58.3, 147, 'Support 24/7', '0.95'],
      [65.1, 164, 'Thank You', '0.98'],
    ];

    const ocrSheet = XLSX.utils.aoa_to_sheet(ocrData);
    ocrSheet['!cols'] = [
      { wch: 15 },
      { wch: 10 },
      { wch: 50 },
      { wch: 12 },
    ];
    XLSX.utils.book_append_sheet(workbook, ocrSheet, 'OCR Results');

    // Sheet 4: Combined Analysis
    const combinedData: any[] = [
      ['Timestamp (s)', 'Type', 'Content', 'Confidence', 'Duration (s)'],
    ];

    // Mix transcription and OCR data
    combinedData.push([0, 'Speech', 'Welcome to the video analysis service', '0.95', 5.2]);
    combinedData.push([1.2, 'Text (OCR)', 'Video Analyzer V2', '0.98', '-']);
    combinedData.push([5.2, 'Speech', 'This tool provides AI-powered transcription and OCR', '0.92', 4.3]);
    combinedData.push([5.8, 'Text (OCR)', 'AI-Powered Platform', '0.96', '-']);
    combinedData.push([9.5, 'Speech', 'Results are compiled into comprehensive Excel reports', '0.94', 5.1]);
    combinedData.push([10.3, 'Text (OCR)', 'Transcription & OCR', '0.94', '-']);

    const combinedSheet = XLSX.utils.aoa_to_sheet(combinedData);
    combinedSheet['!cols'] = [
      { wch: 15 },
      { wch: 12 },
      { wch: 50 },
      { wch: 12 },
      { wch: 12 },
    ];
    XLSX.utils.book_append_sheet(workbook, combinedSheet, 'Full Analysis');

    // Generate Excel file
    const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });

    // Return as downloadable file
    return new NextResponse(excelBuffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="video-analysis-${uploadId}.xlsx"`,
      },
    });
  } catch (error) {
    console.error('Dummy Excel generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate Excel file' },
      { status: 500 }
    );
  }
}
