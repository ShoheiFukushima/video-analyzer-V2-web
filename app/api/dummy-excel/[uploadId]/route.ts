/**
 * DEPRECATED: This endpoint is disabled due to security vulnerabilities in xlsx package.
 * Use the actual /api/download/[uploadId] endpoint instead, which uses exceljs in Cloud Run Worker.
 *
 * Security Note: xlsx package was removed due to high-severity vulnerabilities:
 * - Prototype Pollution (GHSA-4r6h-8v6p-xvw6)
 * - Regular Expression Denial of Service (GHSA-5pgg-2g8v-p4x9)
 */

import { NextResponse } from 'next/server';

export async function GET(
  request: Request,
  { params }: { params: { uploadId: string } }
) {
  // This endpoint is permanently disabled for security reasons
  return NextResponse.json(
    {
      error: 'Endpoint disabled',
      message: 'This endpoint has been disabled due to security vulnerabilities. Please use /api/download/[uploadId] instead.',
      deprecated: true,
      alternative: `/api/download/${params.uploadId}`
    },
    { status: 410 } // 410 Gone
  );
}
