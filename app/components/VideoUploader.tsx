"use client";

import { useState, useRef } from "react";
import { useAuth } from "@clerk/nextjs";
import { UploadCloud, X, Film, AlertTriangle, Settings2, Zap, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { checkVideoUploadQuota } from "@/lib/quota";
import type { DetectionMode } from "@/types/shared";

interface VideoUploaderProps {
  onUploadSuccess: (uploadId: string) => void;
  disabled?: boolean;
}

export function VideoUploader({ onUploadSuccess, disabled }: VideoUploaderProps) {
  const { getToken } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [detectionMode, setDetectionMode] = useState<DetectionMode>('standard');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    if (uploading) return;

    if (!selectedFile.type.startsWith("video/")) {
      setError("Please select a valid video file.");
      return;
    }

    const maxSize = 2 * 1024 * 1024 * 1024; // 2GB
    if (selectedFile.size > maxSize) {
      setError("File size exceeds 2GB limit.");
      return;
    }

    setFile(selectedFile);
    setError(null);
    await handleUploadWithFile(selectedFile);
  };

  const handleDragEvent = (e: React.DragEvent, isEntering: boolean) => {
    e.preventDefault();
    if (!disabled && !uploading) {
      setIsDragging(isEntering);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (disabled || uploading) return;

    const droppedFile = e.dataTransfer.files[0];
    if (!droppedFile) return;
    
    if (!droppedFile.type.startsWith("video/")) {
      setError("Please select a valid video file.");
      return;
    }
    const maxSize = 2 * 1024 * 1024 * 1024; // 2GB
    if (droppedFile.size > maxSize) {
      setError("File size exceeds 2GB limit.");
      return;
    }

    setFile(droppedFile);
    setError(null);
    await handleUploadWithFile(droppedFile);
  };
  
  const getErrorMessage = (error: unknown): { message: string; retryable: boolean } => {
    if (error instanceof Error) {
        const msg = error.message.toLowerCase();
        if (msg.includes('network') || msg.includes('fetch')) return { message: 'Network error. Check connection and retry.', retryable: true };
        if (msg.includes('timeout')) return { message: 'Upload timed out. Try a smaller file.', retryable: true };
        if (msg.includes('unauthorized') || msg.includes('401')) return { message: 'Authentication failed. Please sign in again.', retryable: false };
        if (msg.includes('size') || msg.includes('too large') || msg.includes('413')) return { message: `File too large (Max: 2GB).`, retryable: false };
        if (msg.includes('cors')) return { message: 'Upload blocked by CORS policy. Please try again.', retryable: true };
        return { message: `Upload failed: ${error.message}`, retryable: true };
    }
    return { message: 'An unexpected error occurred.', retryable: true };
  };

  const handleUploadWithFile = async (fileToUpload: File) => {
    if (!fileToUpload) return;

    const controller = new AbortController();
    abortControllerRef.current = controller;
    setUploading(true);
    setProgress(0);
    setError(null);

    try {
      // クォータチェック (JWTトークン取得してクロスオリジン認証)
      try {
        const token = await getToken();
        const quotaResult = await checkVideoUploadQuota(token);

        if (!quotaResult.allowed) {
          setError(
            `月間クォータを超過しています。\n` +
            `残り: ${quotaResult.remaining}/${quotaResult.quota}動画\n` +
            `プラン: ${quotaResult.plan_type}\n\n` +
            `プランをアップグレードしてください。`
          );
          setUploading(false);
          return;
        }
      } catch (quotaError) {
        console.error('Quota check error:', quotaError);
        // クォータチェック失敗時は警告を表示して続行
        console.warn('Proceeding with upload despite quota check failure');
      }

      setProgress(5);

      // Step 1: Get presigned URL from R2
      const presignedResponse = await fetch('/api/r2/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: fileToUpload.name,
          contentType: fileToUpload.type || 'video/mp4',
          fileSize: fileToUpload.size,
        }),
        signal: controller.signal,
      });

      if (!presignedResponse.ok) {
        const errorData = await presignedResponse.json();
        throw new Error(errorData.error || 'Failed to get upload URL');
      }

      const { uploadUrl, uploadId, r2Key } = await presignedResponse.json();
      setProgress(10);

      // Step 2: Upload directly to R2 with progress tracking
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();

        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            // Map upload progress to 10-80% of total progress
            const uploadProgress = 10 + (e.loaded / e.total) * 70;
            setProgress(Math.round(uploadProgress));
          }
        });

        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(new Error(`Upload failed with status ${xhr.status}`));
          }
        });

        xhr.addEventListener('error', () => reject(new Error('Network error during upload')));
        xhr.addEventListener('abort', () => reject(new Error('Upload aborted')));

        // Handle abort signal
        controller.signal.addEventListener('abort', () => xhr.abort());

        xhr.open('PUT', uploadUrl);
        xhr.setRequestHeader('Content-Type', fileToUpload.type || 'video/mp4');
        xhr.send(fileToUpload);
      });

      setProgress(85);

      // Step 3: Start processing with R2 key
      const res = await fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uploadId,
          r2Key,
          fileName: fileToUpload.name,
          dataConsent: true,
          detectionMode,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to start processing.');
      }

      setProgress(100);
      onUploadSuccess(uploadId);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";

    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        setError(null);
      } else {
        const { message } = getErrorMessage(err);
        setError(message);
      }
    } finally {
      setUploading(false);
      abortControllerRef.current = null;
    }
  };

  const removeFile = () => {
    setFile(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleCancel = () => {
    if (abortControllerRef.current) abortControllerRef.current.abort();
    setUploading(false);
    setProgress(0);
    setError(null);
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="space-y-6">
      <div
        onDrop={handleDrop}
        onDragOver={(e) => handleDragEvent(e, true)}
        onDragEnter={(e) => handleDragEvent(e, true)}
        onDragLeave={(e) => handleDragEvent(e, false)}
        className={cn(
            "border-2 border-dashed rounded-2xl p-8 text-center transition-all duration-300",
            disabled || uploading ? "cursor-not-allowed bg-secondary/30 border-border" : "cursor-pointer hover:border-primary/80 hover:bg-primary/10 border-border",
            isDragging && "border-primary/80 bg-primary/10 scale-105"
        )}
        onClick={() => !disabled && !uploading && fileInputRef.current?.click()}
      >
        <input ref={fileInputRef} type="file" accept="video/*" onChange={handleFileSelect} className="hidden" disabled={disabled || uploading} />

        <div className="flex flex-col items-center justify-center gap-4">
            <div className={cn("w-20 h-20 rounded-full flex items-center justify-center bg-secondary/50", disabled || uploading ? "bg-muted" : "bg-primary/10")}>
                <UploadCloud className={cn("w-9 h-9", disabled || uploading ? "text-muted-foreground" : "text-primary")} />
            </div>
            <div>
                <p className="text-lg font-medium text-foreground font-serif">
                    Drop your video here or click to browse
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                    Supports MP4, MOV, AVI, MKV, WebM (max 2GB)
                </p>
            </div>
        </div>
      </div>

      {file && (
        <div className="bg-secondary/50 border rounded-lg p-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
                <Film className="w-6 h-6 text-primary flex-shrink-0" />
                <div className="text-sm min-w-0">
                    <p className="font-semibold text-foreground truncate">{file.name}</p>
                    <p className="text-muted-foreground">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                </div>
            </div>
            <button
                onClick={uploading ? handleCancel : removeFile}
                className="inline-flex items-center justify-center whitespace-nowrap rounded-full text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 hover:bg-destructive/10 h-9 w-9"
            >
                <X className="w-4 h-4 text-destructive" />
            </button>
        </div>
      )}

      {/* Advanced Options - Detection Mode Selection */}
      {file && !uploading && (
        <div className="space-y-3">
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <Settings2 className="w-4 h-4" />
            <span>Advanced Options</span>
            <span className={cn("text-xs transition-transform", showAdvanced && "rotate-180")}>▼</span>
          </button>

          {showAdvanced && (
            <div className="bg-secondary/30 border rounded-lg p-4 space-y-3">
              <p className="text-sm font-medium text-foreground">Detection Mode</p>
              <div className="grid grid-cols-2 gap-3">
                {/* Standard Mode */}
                <button
                  onClick={() => setDetectionMode('standard')}
                  className={cn(
                    "p-4 rounded-lg border-2 text-left transition-all",
                    detectionMode === 'standard'
                      ? "border-primary bg-primary/10"
                      : "border-border hover:border-primary/50 hover:bg-secondary/50"
                  )}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Zap className={cn("w-5 h-5", detectionMode === 'standard' ? "text-primary" : "text-muted-foreground")} />
                    <span className="font-semibold text-foreground">Standard</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Fast processing, works well for most videos with hard cuts
                  </p>
                </button>

                {/* Enhanced Mode */}
                <button
                  onClick={() => setDetectionMode('enhanced')}
                  className={cn(
                    "p-4 rounded-lg border-2 text-left transition-all",
                    detectionMode === 'enhanced'
                      ? "border-primary bg-primary/10"
                      : "border-border hover:border-primary/50 hover:bg-secondary/50"
                  )}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Sparkles className={cn("w-5 h-5", detectionMode === 'enhanced' ? "text-primary" : "text-muted-foreground")} />
                    <span className="font-semibold text-foreground">Enhanced</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Better for fades, dissolves, text animations (2-3x processing time)
                  </p>
                </button>
              </div>
              {detectionMode === 'enhanced' && (
                <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  Enhanced mode takes longer but detects more transitions
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {uploading && (
        <div className="space-y-2">
          <div className="relative w-full h-2 bg-secondary rounded-full overflow-hidden">
            <div className="absolute top-0 left-0 h-full bg-primary transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Uploading...</span>
            <span className="font-medium text-foreground">{progress}%</span>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-destructive">{error}</p>
              {file && (
                 <button onClick={() => handleUploadWithFile(file)} disabled={uploading} className="text-sm font-medium text-destructive/80 hover:text-destructive underline mt-1">
                    Retry Upload
                 </button>
              )}
            </div>
        </div>
      )}
    </div>
  );
}
