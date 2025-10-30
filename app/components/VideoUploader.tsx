"use client";

import { useState, useRef } from "react";
import { Upload, X, Film } from "lucide-react";
import { upload } from "@vercel/blob/client";

interface VideoUploaderProps {
  onUploadSuccess: (uploadId: string) => void;
  disabled?: boolean;
}

export function VideoUploader({ onUploadSuccess, disabled }: VideoUploaderProps) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dataConsent, setDataConsent] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    // Validate file type
    if (!selectedFile.type.startsWith("video/")) {
      setError("Please select a valid video file");
      return;
    }

    // Validate file size (max 500MB)
    const maxSize = 500 * 1024 * 1024; // 500MB
    if (selectedFile.size > maxSize) {
      setError("File size exceeds 500MB limit");
      return;
    }

    setFile(selectedFile);
    setError(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && droppedFile.type.startsWith("video/")) {
      setFile(droppedFile);
      setError(null);
    }
  };

  /**
   * Classify error and provide user-friendly message with retry guidance
   */
  const getErrorMessage = (error: unknown): { message: string; retryable: boolean } => {
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();

      // Network errors
      if (msg.includes('network') || msg.includes('fetch') || msg.includes('connection')) {
        return {
          message: 'Network connection lost. Please check your internet and try again.',
          retryable: true,
        };
      }

      // Timeout errors
      if (msg.includes('timeout') || msg.includes('timed out')) {
        return {
          message: 'Upload took too long. Your internet may be slow. Try again with a smaller file.',
          retryable: true,
        };
      }

      // Authentication errors
      if (msg.includes('unauthorized') || msg.includes('401')) {
        return {
          message: 'Authentication failed. Please sign in again.',
          retryable: false,
        };
      }

      // File size errors
      if (msg.includes('size') || msg.includes('too large') || msg.includes('413')) {
        return {
          message: `File is too large. Maximum: 500MB. Your file: ${(file?.size ?? 0 / 1024 / 1024).toFixed(0)}MB`,
          retryable: false,
        };
      }

      // Processing errors
      if (msg.includes('processing') || msg.includes('process')) {
        return {
          message: 'Failed to start video processing. The server may be busy. Try again in a moment.',
          retryable: true,
        };
      }

      // Blob upload errors
      if (msg.includes('blob') || msg.includes('upload')) {
        return {
          message: 'Failed to upload video to storage. Please check your connection and try again.',
          retryable: true,
        };
      }

      // Generic error with original message
      return {
        message: `Upload failed: ${error.message}`,
        retryable: true,
      };
    }

    return {
      message: 'An unexpected error occurred. Please try again.',
      retryable: true,
    };
  };

  const handleUpload = async () => {
    if (!file) return;

    setUploading(true);
    setProgress(0);
    setError(null);

    try {
      const uploadId = `upload_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Step 1: Upload to Vercel Blob via client-side upload
      // Uses token from server for security, uploads directly to Vercel Blob
      let blobUrl: string;
      try {
        setProgress(25); // Show upload starting

        console.log('[VideoUploader] Starting blob upload...', {
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type
        });

        const newBlob = await upload(file.name, file, {
          access: 'public',
          handleUploadUrl: '/api/blob-upload',
        });

        console.log('[VideoUploader] Blob upload successful:', { url: newBlob.url });
        blobUrl = newBlob.url;
        setProgress(50);
      } catch (uploadErr) {
        console.error('[VideoUploader] Upload error:', {
          message: uploadErr instanceof Error ? uploadErr.message : String(uploadErr),
          name: uploadErr instanceof Error ? uploadErr.name : undefined,
          stack: uploadErr instanceof Error ? uploadErr.stack : undefined,
        });

        const errorInfo = uploadErr instanceof Error
          ? uploadErr
          : new Error('Video upload to storage failed');
        const { message } = getErrorMessage(errorInfo);
        setError(message);
        setUploading(false);
        return;
      }

      // Step 2: Trigger processing on Cloud Run Worker
      try {
        const processResponse = await fetch("/api/process", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            uploadId,
            blobUrl,
            fileName: file.name,
            dataConsent,
          }),
          signal: AbortSignal.timeout(15000), // 15 second timeout
        });

        if (!processResponse.ok) {
          let errorMessage = "Processing failed to start";
          try {
            const errorData = await processResponse.json();
            errorMessage = errorData.error || errorData.message || errorMessage;
          } catch {
            // Response wasn't JSON, use status code
            errorMessage = `Server error (${processResponse.status}). Try again in a moment.`;
          }
          throw new Error(errorMessage);
        }

        setProgress(100);
        onUploadSuccess(uploadId);

        // Reset form
        setFile(null);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      } catch (processErr) {
        const errorInfo = processErr instanceof Error
          ? processErr
          : new Error('Processing initialization failed');
        const { message } = getErrorMessage(errorInfo);
        setError(message);
        setUploading(false);
        return;
      }
    } catch (err) {
      const { message } = getErrorMessage(err);
      setError(message);
    } finally {
      setUploading(false);
    }
  };

  const removeFile = () => {
    setFile(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-4">
      {/* Drop Zone */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors ${
          disabled
            ? "border-gray-200 bg-gray-50 cursor-not-allowed"
            : "border-indigo-300 hover:border-indigo-500 bg-indigo-50/50 dark:bg-indigo-900/10 cursor-pointer"
        }`}
        onClick={() => !disabled && fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          onChange={handleFileSelect}
          className="hidden"
          disabled={disabled}
        />

        {!file ? (
          <>
            <Upload className="w-16 h-16 mx-auto mb-4 text-indigo-500" />
            <p className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              Drop your video here or click to browse
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Supports MP4, MOV, AVI (max 500MB)
            </p>
          </>
        ) : (
          <div className="flex items-center justify-center gap-4">
            <Film className="w-8 h-8 text-indigo-600" />
            <div className="flex-1 text-left">
              <p className="font-semibold text-gray-900 dark:text-white">
                {file.name}
              </p>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {(file.size / 1024 / 1024).toFixed(2)} MB
              </p>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                removeFile();
              }}
              className="p-2 hover:bg-red-100 dark:hover:bg-red-900 rounded-lg transition-colors"
              disabled={uploading}
            >
              <X className="w-5 h-5 text-red-600" />
            </button>
          </div>
        )}
      </div>

      {/* Progress Bar */}
      {uploading && (
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-600 dark:text-gray-400">Uploading...</span>
            <span className="font-semibold text-gray-900 dark:text-white">{progress}%</span>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
            <div
              className="bg-indigo-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 space-y-3">
          <div className="flex gap-3">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-red-600 dark:text-red-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="flex-1">
              <p className="text-red-800 dark:text-red-400 text-sm font-medium">{error}</p>
            </div>
          </div>
          {file && (
            <button
              onClick={handleUpload}
              disabled={uploading}
              className="text-sm font-medium text-red-700 dark:text-red-300 hover:text-red-800 dark:hover:text-red-200 underline"
            >
              Retry Upload
            </button>
          )}
        </div>
      )}

      {/* Data Consent */}
      <div className="flex items-start gap-3 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
        <input
          type="checkbox"
          id="dataConsent"
          checked={dataConsent}
          onChange={(e) => setDataConsent(e.target.checked)}
          className="mt-1 w-4 h-4 text-indigo-600 rounded focus:ring-2 focus:ring-indigo-500"
          disabled={disabled}
        />
        <label htmlFor="dataConsent" className="text-sm text-gray-700 dark:text-gray-300">
          I consent to anonymously store video analytics (duration, resolution, etc.) for service improvement.
          No personal data or video content is stored.
        </label>
      </div>

      {/* Upload Button */}
      <button
        onClick={handleUpload}
        disabled={!file || uploading || disabled}
        className={`w-full py-4 px-6 rounded-xl font-semibold text-lg transition-all ${
          !file || uploading || disabled
            ? "bg-gray-300 dark:bg-gray-700 text-gray-500 cursor-not-allowed"
            : "bg-indigo-600 text-white hover:bg-indigo-700 hover:shadow-lg"
        }`}
      >
        {uploading ? "Uploading & Processing..." : "Upload & Process Video"}
      </button>
    </div>
  );
}
