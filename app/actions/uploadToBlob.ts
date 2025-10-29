"use server";

import { put } from "@vercel/blob";

export interface BlobUploadResult {
  success: boolean;
  url?: string;
  error?: string;
  message?: string;
}

/**
 * Server Action to upload file to Vercel Blob
 * This runs on the server, so it has access to BLOB_READ_WRITE_TOKEN
 */
export async function uploadToBlob(
  file: Blob,
  fileName: string,
  uploadId: string
): Promise<BlobUploadResult> {
  try {
    // Validate inputs
    if (!file) {
      return {
        success: false,
        error: "No file provided",
        message: "Please select a video file",
      };
    }

    if (!fileName) {
      return {
        success: false,
        error: "No file name",
        message: "File name is required",
      };
    }

    if (!uploadId) {
      return {
        success: false,
        error: "No upload ID",
        message: "Upload ID is required",
      };
    }

    // Validate token
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) {
      console.error("BLOB_READ_WRITE_TOKEN not configured");
      return {
        success: false,
        error: "Server configuration error",
        message: "Blob storage is not properly configured",
      };
    }

    // Upload to Vercel Blob
    const blob = await put(`uploads/${uploadId}/${fileName}`, file, {
      access: "public",
      token,
    });

    return {
      success: true,
      url: blob.url,
      message: "File uploaded successfully",
    };
  } catch (error) {
    console.error("Blob upload error:", error);

    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    // Classify error
    if (errorMessage.includes("413") || errorMessage.includes("too large")) {
      return {
        success: false,
        error: "File too large",
        message: `File is too large for Blob storage. Maximum: 500MB`,
      };
    }

    if (errorMessage.includes("timeout") || errorMessage.includes("ETIMEDOUT")) {
      return {
        success: false,
        error: "Upload timeout",
        message: "Upload took too long. Please try again with a smaller file or better internet.",
      };
    }

    if (errorMessage.includes("network") || errorMessage.includes("ECONNREFUSED")) {
      return {
        success: false,
        error: "Network error",
        message: "Network connection failed. Please check your internet and try again.",
      };
    }

    return {
      success: false,
      error: "Upload failed",
      message: `Upload failed: ${errorMessage}`,
    };
  }
}
