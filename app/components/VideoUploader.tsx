"use client";

import { useState, useRef } from "react";
import { Upload, X, Film } from "lucide-react";

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

  const handleUpload = async () => {
    if (!file) return;

    setUploading(true);
    setProgress(0);
    setError(null);

    try {
      // Step 1: Upload to Vercel Blob
      const uploadId = `upload_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      const formData = new FormData();
      formData.append("file", file);
      formData.append("uploadId", uploadId);

      // Upload to Vercel Blob via API route
      const uploadResponse = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!uploadResponse.ok) {
        const errorData = await uploadResponse.json();
        throw new Error(errorData.error || "Upload failed");
      }

      const { blobUrl } = await uploadResponse.json();
      setProgress(50);

      // Step 2: Trigger processing on Cloud Run Worker
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
      });

      if (!processResponse.ok) {
        const errorData = await processResponse.json();
        throw new Error(errorData.error || "Processing failed to start");
      }

      setProgress(100);
      onUploadSuccess(uploadId);

      // Reset form
      setFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
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
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-red-800 dark:text-red-400 text-sm">{error}</p>
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
