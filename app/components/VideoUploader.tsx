"use client";

import { useState, useRef } from "react";
import { UploadCloud, X, Film, AlertTriangle } from "lucide-react";
import { upload } from "@vercel/blob/client";
import { cn } from "@/lib/utils";

interface VideoUploaderProps {
  onUploadSuccess: (uploadId: string) => void;
  disabled?: boolean;
}

export function VideoUploader({ onUploadSuccess, disabled }: VideoUploaderProps) {
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
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

    const maxSize = 500 * 1024 * 1024; // 500MB
    if (selectedFile.size > maxSize) {
      setError("File size exceeds 500MB limit.");
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
    
    // Simulating the same validation logic as handleFileSelect
    if (!droppedFile.type.startsWith("video/")) {
      setError("Please select a valid video file.");
      return;
    }
    const maxSize = 500 * 1024 * 1024;
    if (droppedFile.size > maxSize) {
      setError("File size exceeds 500MB limit.");
      return;
    }

    setFile(droppedFile);
    setError(null);
    await handleUploadWithFile(droppedFile);
  };
  
  const getErrorMessage = (error: unknown): { message: string; retryable: boolean } => {
    // ... (error message logic remains the same)
    if (error instanceof Error) {
        const msg = error.message.toLowerCase();
        if (msg.includes('network') || msg.includes('fetch')) return { message: 'Network error. Check connection and retry.', retryable: true };
        if (msg.includes('timeout')) return { message: 'Upload timed out. Try a smaller file.', retryable: true };
        if (msg.includes('unauthorized') || msg.includes('401')) return { message: 'Authentication failed. Please sign in again.', retryable: false };
        if (msg.includes('size') || msg.includes('too large') || msg.includes('413')) return { message: `File too large (Max: 500MB).`, retryable: false };
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
      const uploadId = `upload_${Date.now()}`;
      
      setProgress(25);
      const newBlob = await upload(fileToUpload.name, fileToUpload, {
        access: 'public',
        handleUploadUrl: '/api/blob-upload',
      });
      setProgress(50);
      
      await fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadId, blobUrl: newBlob.url, fileName: fileToUpload.name, dataConsent: true }),
        signal: controller.signal,
      });

      setProgress(100);
      onUploadSuccess(uploadId);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";

    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        console.log('Upload cancelled by user');
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
    <div className="space-y-4">
      <div
        onDrop={handleDrop}
        onDragOver={(e) => handleDragEvent(e, true)}
        onDragEnter={(e) => handleDragEvent(e, true)}
        onDragLeave={(e) => handleDragEvent(e, false)}
        className={cn(
            "border-2 border-dashed rounded-lg p-8 text-center transition-colors duration-200",
            disabled || uploading ? "cursor-not-allowed bg-secondary/50 border-border" : "cursor-pointer hover:border-primary hover:bg-primary/5 border-border",
            isDragging && "border-primary bg-primary/10"
        )}
        onClick={() => !disabled && !uploading && fileInputRef.current?.click()}
      >
        <input ref={fileInputRef} type="file" accept="video/*" onChange={handleFileSelect} className="hidden" disabled={disabled || uploading} />

        <div className="flex flex-col items-center justify-center gap-4">
            <div className={cn("w-16 h-16 rounded-full flex items-center justify-center", disabled || uploading ? "bg-muted" : "bg-primary/10")}>
                <UploadCloud className={cn("w-8 h-8", disabled || uploading ? "text-muted-foreground" : "text-primary")} />
            </div>
            <div>
                <p className="text-lg font-semibold text-foreground">
                    Drop your video here or click to browse
                </p>
                <p className="text-sm text-muted-foreground">
                    Supports MP4, MOV, AVI (max 500MB)
                </p>
            </div>
        </div>
      </div>

      {file && (
        <div className="bg-card border rounded-lg p-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
                <Film className="w-6 h-6 text-primary flex-shrink-0" />
                <div className="text-sm min-w-0">
                    <p className="font-semibold text-foreground truncate">{file.name}</p>
                    <p className="text-muted-foreground">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                </div>
            </div>
            <button
                onClick={uploading ? handleCancel : removeFile}
                className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 hover:bg-destructive/10 h-9 w-9"
            >
                <X className="w-4 h-4 text-destructive" />
            </button>
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
