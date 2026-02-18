"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Loader2,
  CheckCircle2,
  Download,
  AlertCircle,
  Clock,
  Eye,
  History,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface UploadRecord {
  uploadId: string;
  status: string;
  progress: number;
  stage: string | null;
  fileName: string | null;
  resultR2Key: string | null;
  createdAt: string;
  updatedAt: string;
  errorMessage: string | null;
}

interface UploadHistoryProps {
  onResumeProcessing: (uploadId: string) => void;
  currentUploadId?: string | null;
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString("ja-JP", { month: "short", day: "numeric" });
}

function truncateFileName(name: string, maxLen = 30): string {
  if (name.length <= maxLen) return name;
  const ext = name.lastIndexOf(".");
  if (ext > 0) {
    const extension = name.slice(ext);
    const base = name.slice(0, maxLen - extension.length - 3);
    return `${base}...${extension}`;
  }
  return name.slice(0, maxLen - 3) + "...";
}

export function UploadHistory({
  onResumeProcessing,
  currentUploadId,
}: UploadHistoryProps) {
  const [uploads, setUploads] = useState<UploadRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState<string | null>(null);

  const fetchUploads = useCallback(async () => {
    try {
      const response = await fetch("/api/uploads");
      if (!response.ok) {
        if (response.status === 401) return;
        throw new Error("Failed to fetch uploads");
      }
      const data = await response.json();
      setUploads(data.uploads || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load history");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUploads();
    const intervalId = setInterval(fetchUploads, 30_000);
    return () => clearInterval(intervalId);
  }, [fetchUploads]);

  const handleDownload = useCallback(
    async (uploadId: string) => {
      try {
        setIsDownloading(uploadId);
        const response = await fetch(`/api/download/${uploadId}`);
        if (!response.ok)
          throw new Error(
            (await response.json()).error || "Download failed"
          );

        const contentType = response.headers.get("content-type") || "";

        if (contentType.includes("application/json")) {
          const data = await response.json();
          if (!data.downloadUrl) throw new Error("No download URL returned");
          const a = document.createElement("a");
          a.href = data.downloadUrl;
          a.download = `result_${uploadId}.xlsx`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        } else {
          const blob = await response.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `result_${uploadId}.xlsx`;
          document.body.appendChild(a);
          a.click();
          window.URL.revokeObjectURL(url);
          document.body.removeChild(a);
        }
      } catch (err) {
        console.error("Download failed:", err);
      } finally {
        setIsDownloading(null);
      }
    },
    []
  );

  // Don't show if no uploads and not loading
  const filteredUploads = uploads.filter(
    (u) => u.uploadId !== currentUploadId
  );

  if (loading) {
    return null;
  }

  if (error) {
    return null;
  }

  if (filteredUploads.length === 0) {
    return null;
  }

  return (
    <div className="bg-card border rounded-xl shadow-sm p-6 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-muted-foreground">
          <History className="w-4 h-4" />
          <span className="text-sm font-medium">Recent uploads</span>
        </div>
        <button
          onClick={fetchUploads}
          className="text-muted-foreground hover:text-foreground transition-colors p-1"
          title="Refresh"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="divide-y divide-border rounded-lg border overflow-hidden">
        {filteredUploads.map((upload) => (
          <UploadRow
            key={upload.uploadId}
            upload={upload}
            isDownloading={isDownloading === upload.uploadId}
            onResume={() => onResumeProcessing(upload.uploadId)}
            onDownload={() => handleDownload(upload.uploadId)}
          />
        ))}
      </div>
    </div>
  );
}

interface UploadRowProps {
  upload: UploadRecord;
  isDownloading: boolean;
  onResume: () => void;
  onDownload: () => void;
}

function UploadRow({
  upload,
  isDownloading,
  onResume,
  onDownload,
}: UploadRowProps) {
  const isProcessing =
    upload.status === "processing" || upload.status === "downloading" || upload.status === "pending";
  const isCompleted = upload.status === "completed";
  const isError = upload.status === "error";

  const displayName = upload.fileName
    ? truncateFileName(upload.fileName)
    : upload.uploadId.slice(0, 16) + "...";

  return (
    <div
      className={cn(
        "flex items-center gap-3 px-4 py-3 transition-colors",
        (isProcessing || isCompleted) && "hover:bg-secondary/50 cursor-pointer",
        isError && "opacity-75"
      )}
      onClick={() => {
        if (isProcessing) onResume();
        else if (isCompleted) onDownload();
      }}
    >
      {/* Status icon */}
      <div className="flex-shrink-0">
        {isProcessing && (
          <div className="relative">
            <Loader2 className="w-5 h-5 text-primary animate-spin" />
          </div>
        )}
        {isCompleted && (
          <CheckCircle2 className="w-5 h-5 text-green-600" />
        )}
        {isError && <AlertCircle className="w-5 h-5 text-destructive/70" />}
      </div>

      {/* File info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">
          {displayName}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          {isProcessing && (
            <span className="text-xs text-primary">
              {upload.progress}% processing
            </span>
          )}
          {isCompleted && (
            <span className="text-xs text-green-600">Completed</span>
          )}
          {isError && (
            <span className="text-xs text-destructive/70 truncate">
              {upload.errorMessage || "Error"}
            </span>
          )}
          <span className="text-xs text-muted-foreground/60 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {formatRelativeTime(upload.updatedAt || upload.createdAt)}
          </span>
        </div>
      </div>

      {/* Action */}
      <div className="flex-shrink-0">
        {isProcessing && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onResume();
            }}
            className="text-xs text-primary hover:text-primary/80 flex items-center gap-1 px-2 py-1 rounded-md hover:bg-primary/10 transition-colors"
          >
            <Eye className="w-3.5 h-3.5" />
            View
          </button>
        )}
        {isCompleted && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDownload();
            }}
            disabled={isDownloading}
            className="text-xs text-green-600 hover:text-green-700 flex items-center gap-1 px-2 py-1 rounded-md hover:bg-green-600/10 transition-colors disabled:opacity-50"
          >
            {isDownloading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            Download
          </button>
        )}
      </div>
    </div>
  );
}
