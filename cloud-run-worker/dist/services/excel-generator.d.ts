/**
 * Excel Generator Service
 * Generate Excel file with ideal format: Scene # | Timecode | Screenshot | OCR Text | NA Text
 * Based on V1's proven image embedding implementation
 *
 * Adapted from V1 for V2 architecture with narration text support
 */
import { ExcelGenerationOptions } from '../types/excel';
/**
 * Generate Excel file with OCR results, narration, and embedded screenshots
 * Format: Scene # | Timecode | Screenshot | OCR Text | NA Text
 *
 * @param options - Excel generation options
 * @returns Excel file as Buffer
 */
export declare function generateExcel(options: ExcelGenerationOptions): Promise<Buffer>;
/**
 * Generate filename for Excel export
 * @param projectTitle - Project title
 * @returns Sanitized filename with timestamp
 */
export declare function generateExcelFilename(projectTitle: string): string;
//# sourceMappingURL=excel-generator.d.ts.map