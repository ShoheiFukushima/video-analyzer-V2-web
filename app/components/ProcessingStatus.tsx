"use client";

import { useEffect, useState, useCallback } from "react";
import { Loader2, CheckCircle2, Download, AlertCircle } from "lucide-react";
import type { ProcessingMetadata } from "@/types/shared";

interface ProcessingStatusProps {
  uploadId: string;
  onComplete?: () => void;
}

type ProcessingStage =
  | "uploading"
  | "downloading"
  | "metadata"
  | "vad"
  | "audio"
  | "frames"
  | "whisper"
  | "ocr"
  | "excel"
  | "upload_result"
  | "completed"
  | "error";

export function ProcessingStatus({ uploadId, onComplete }: ProcessingStatusProps) {
  const [status, setStatus] = useState<ProcessingStage>("uploading");
  const [error, setError] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<ProcessingMetadata | null>(null);
  const [progress, setProgress] = useState(0);
  const [autoDownloadTriggered, setAutoDownloadTriggered] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  // Download function (defined before useEffects)
  const downloadResult = useCallback(async () => {
    try {
      setIsDownloading(true);

      // Always use Next.js API endpoint for authenticated downloads
      // This ensures consistent authentication flow in both dev and production
      const downloadUrl = `/api/download/${uploadId}`;

      // Use fetch to handle errors gracefully
      const response = await fetch(downloadUrl);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Download failed' }));
        throw new Error(errorData.error || `Download failed with status ${response.status}`);
      }

      // Convert response to blob and trigger download
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `result_${uploadId}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      console.log('Download completed successfully');
    } catch (error) {
      console.error('Download error:', error);
      setError(error instanceof Error ? error.message : 'Failed to download result');
      setStatus('error');
    } finally {
      setIsDownloading(false);
    }
  }, [uploadId]);

  // Poll for processing status
  useEffect(() => {
    let pollInterval: NodeJS.Timeout;
    let currentStage = 0;

    const stages: ProcessingStage[] = [
      "downloading",
      "metadata",
      "vad",
      "frames",
      "whisper",
      "ocr",
      "excel",
      "upload_result",
      "completed",
    ];

    // Simulate progress (since we don't have real-time updates from worker)
    const simulateProgress = () => {
      if (currentStage < stages.length) {
        setStatus(stages[currentStage]);
        setProgress(((currentStage + 1) / stages.length) * 100);
        currentStage++;
      }
    };

    // Poll for status
    const pollStatus = async () => {
      try {
        const response = await fetch(`/api/status/${uploadId}`);
        const data = await response.json();

        // Update progress from API
        if (data.progress !== undefined) {
          setProgress(data.progress);
        }

        if (data.status === "completed" && data.resultUrl) {
          setStatus("completed");
          setResultUrl(data.resultUrl);
          setMetadata(data.metadata);
          setProgress(100);
          clearInterval(pollInterval);
          clearInterval(progressInterval);
          onComplete?.();
        } else if (data.status === "error") {
          setStatus("error");
          setError(data.message || "Processing failed");
          clearInterval(pollInterval);
          clearInterval(progressInterval);
          onComplete?.();
        } else if (data.status === "processing") {
          // Map "processing" to a stage
          setStatus("frames");
        }
      } catch (err) {
        console.error("Error polling status:", err);
      }
    };

    // Start progress simulation (slower, as backup)
    const progressInterval = setInterval(simulateProgress, 5000);

    // Start polling every 10 seconds (reduced from 3s to minimize Supabase load)
    pollInterval = setInterval(pollStatus, 10000);
    pollStatus(); // Initial poll immediately

    return () => {
      clearInterval(pollInterval);
      clearInterval(progressInterval);
    };
  }, [uploadId, onComplete]);

  // Auto-download when processing completes
  useEffect(() => {
    if (status === "completed" && resultUrl && !autoDownloadTriggered) {
      setAutoDownloadTriggered(true);
      console.log('Auto-download triggered for uploadId:', uploadId);
      // Delay to allow UI to update
      setTimeout(() => {
        downloadResult();
      }, 500);
    }
  }, [status, resultUrl, autoDownloadTriggered, uploadId, downloadResult]);

  const getStageLabel = (stage: ProcessingStage): string => {
    const labels: Record<ProcessingStage, string> = {
      uploading: "Uploading video...",
      downloading: "Downloading video from storage...",
      metadata: "Extracting video metadata...",
      vad: "Detecting voice activity...",
      audio: "Extracting audio track...",
      frames: "Extracting video frames (scene detection)...",
      whisper: "Transcribing audio with Whisper AI...",
      ocr: "Performing OCR with Gemini Vision...",
      excel: "Generating Excel report...",
      upload_result: "Uploading results...",
      completed: "Processing completed!",
      error: "Processing failed",
    };
    return labels[stage] || "Processing...";
  };

  if (status === "error") {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-6">
        <div className="flex items-start gap-4">
          <AlertCircle className="w-6 h-6 text-red-600 dark:text-red-400 flex-shrink-0 mt-1" />
          <div>
            <h3 className="text-lg font-semibold text-red-900 dark:text-red-100 mb-2">
              Processing Failed
            </h3>
            <p className="text-red-700 dark:text-red-300">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (status === "completed" && resultUrl) {
    return (
      <div className="space-y-6">
        {/* Success Message */}
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-6">
          <div className="flex items-start gap-4">
            <CheckCircle2 className="w-6 h-6 text-green-600 dark:text-green-400 flex-shrink-0 mt-1" />
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-green-900 dark:text-green-100 mb-2">
                Processing Completed!
              </h3>
              <p className="text-green-700 dark:text-green-300">
                {isDownloading
                  ? 'Downloading Excel file...'
                  : autoDownloadTriggered
                    ? 'Excel file download started automatically. If it didn\'t start, click the button below.'
                    : 'Your video has been processed successfully. Download the Excel file below.'}
              </p>
            </div>
          </div>
        </div>

        {/* Metadata */}
        {metadata && (
          <div className="grid md:grid-cols-3 gap-4">
            <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4">
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Duration</p>
              <p className="text-xl font-semibold text-gray-900 dark:text-white">
                {metadata.duration?.toFixed(1) || "0"}s
              </p>
            </div>
            <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4">
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Segments</p>
              <p className="text-xl font-semibold text-gray-900 dark:text-white">
                {metadata.segmentCount || 0}
              </p>
            </div>
            <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4">
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">OCR Frames</p>
              <p className="text-xl font-semibold text-gray-900 dark:text-white">
                {metadata.ocrResultCount || 0}
              </p>
            </div>
          </div>
        )}

        {/* Download Button */}
        <button
          onClick={downloadResult}
          disabled={isDownloading}
          className="w-full py-4 px-6 bg-green-600 text-white rounded-xl font-semibold text-lg hover:bg-green-700 transition-all hover:shadow-lg flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isDownloading ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Downloading...
            </>
          ) : (
            <>
              <Download className="w-5 h-5" />
              {autoDownloadTriggered ? 'Download Again' : 'Download Excel Report'}
            </>
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Progress Bar */}
      <div>
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {getStageLabel(status)}
          </span>
          <span className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">
            {Math.round(progress)}%
          </span>
        </div>
        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3">
          <div
            className="bg-indigo-600 h-3 rounded-full transition-all duration-500 ease-out relative overflow-hidden"
            style={{ width: `${progress}%` }}
          >
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer" />
          </div>
        </div>
      </div>

      {/* Processing Indicator */}
      <div className="flex items-center justify-center gap-3 p-6 bg-indigo-50 dark:bg-indigo-900/20 rounded-xl">
        <Loader2 className="w-6 h-6 text-indigo-600 dark:text-indigo-400 animate-spin" />
        <p className="text-indigo-900 dark:text-indigo-100 font-medium">
          Processing your video... This may take several minutes.
        </p>
      </div>

      {/* Info Message */}
      <div className="text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-900 rounded-lg p-4">
        <p className="mb-2">
          <strong>What's happening:</strong>
        </p>
        <ul className="list-disc list-inside space-y-1 ml-2">
          <li>Extracting audio and video frames</li>
          <li>Running Whisper AI for transcription</li>
          <li>Running Gemini Vision for OCR</li>
          <li>Generating comprehensive Excel report</li>
        </ul>
      </div>

      {/* Upload ID */}
      <div className="text-xs text-gray-500 dark:text-gray-500 text-center">
        Upload ID: {uploadId}
      </div>
    </div>
  );
}
