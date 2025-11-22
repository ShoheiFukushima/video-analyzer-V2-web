"use client";

import { useEffect, useState, useCallback } from "react";
import { Loader2, CheckCircle2, Download, AlertCircle } from "lucide-react";
import type { ProcessingMetadata } from "@/types/shared";
import { cn } from "@/lib/utils";

interface ProcessingStatusProps {
  uploadId: string;
  onComplete?: () => void;
}

type ProcessingStage = "uploading" | "downloading" | "metadata" | "vad" | "audio" | "frames" | "whisper" | "ocr" | "excel" | "upload_result" | "completed" | "error";

export function ProcessingStatus({ uploadId, onComplete }: ProcessingStatusProps) {
  const [status, setStatus] = useState<ProcessingStage>("uploading");
  const [error, setError] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<ProcessingMetadata | null>(null);
  const [progress, setProgress] = useState(0);
  const [autoDownloadTriggered, setAutoDownloadTriggered] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  const downloadResult = useCallback(async () => {
    try {
      setIsDownloading(true);
      const response = await fetch(`/api/download/${uploadId}`);
      if (!response.ok) throw new Error((await response.json()).error || 'Download failed');
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `result_${uploadId}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download result');
      setStatus('error');
    } finally {
      setIsDownloading(false);
    }
  }, [uploadId]);

  useEffect(() => {
    const pollStatus = async () => {
      try {
        const response = await fetch(`/api/status/${uploadId}`);
        const data = await response.json();
        
        if (data.progress !== undefined) setProgress(data.progress);

        const stageMap: Record<string, ProcessingStage> = { 'downloading': 'downloading', 'compressing': 'downloading', 'metadata': 'metadata', 'audio': 'audio', 'audio_skipped': 'audio', 'vad_whisper': 'whisper', 'scene_ocr_excel': 'ocr', 'upload_result': 'upload_result', 'completed': 'completed' };
        if (data.stage) setStatus(stageMap[data.stage] || 'frames');

        if (data.status === "completed" && data.resultUrl) {
          setStatus("completed");
          setResultUrl(data.resultUrl);
          setMetadata(data.metadata);
          setProgress(100);
          onComplete?.();
          return true; // Stop polling
        } else if (data.status === "error") {
          setStatus("error");
          setError(data.error || "Processing failed");
          onComplete?.();
          return true; // Stop polling
        }
      } catch (err) {
        console.error("Error polling status:", err);
      }
      return false; // Continue polling
    };

    const intervalId = setInterval(async () => {
      const stopped = await pollStatus();
      if (stopped) clearInterval(intervalId);
    }, 5000);

    pollStatus(); // Initial poll

    return () => clearInterval(intervalId);
  }, [uploadId, onComplete]);

  useEffect(() => {
    if (status === "completed" && resultUrl && !autoDownloadTriggered) {
      setAutoDownloadTriggered(true);
      setTimeout(() => downloadResult(), 500);
    }
  }, [status, resultUrl, autoDownloadTriggered, downloadResult]);

  const getStageLabel = (stage: ProcessingStage): string => {
    const labels: Record<ProcessingStage, string> = { uploading: "Uploading...", downloading: "Preparing video...", metadata: "Extracting metadata...", vad: "Detecting voice...", audio: "Extracting audio...", frames: "Detecting scenes...", whisper: "Transcribing audio (AI)...", ocr: "Reading text on screen (AI)...", excel: "Generating Excel report...", upload_result: "Finalizing results...", completed: "Completed!", error: "Error" };
    return labels[stage] || "Processing...";
  };

  if (status === "error") {
    return (
      <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-6 flex items-start gap-4">
        <AlertCircle className="w-6 h-6 text-destructive flex-shrink-0" />
        <div>
          <h3 className="text-lg font-semibold text-destructive">Processing Failed</h3>
          <p className="text-destructive/80 mt-1">{error}</p>
        </div>
      </div>
    );
  }

  if (status === "completed" && resultUrl) {
    return (
      <div className="space-y-6">
        <div className="bg-green-600/10 border border-green-600/20 rounded-lg p-6 flex items-start gap-4">
          <CheckCircle2 className="w-6 h-6 text-green-600 flex-shrink-0" />
          <div>
            <h3 className="text-lg font-semibold text-green-600">Processing Completed!</h3>
            <p className="text-green-600/80 mt-1">
              {isDownloading ? 'Downloading...' : 'Your Excel report has been prepared.'}
            </p>
          </div>
        </div>

        {metadata && (
          <div className="grid md:grid-cols-3 gap-4">
            {(['duration', 'segmentCount', 'ocrResultCount'] as const).map(key => (
              <div key={key} className="bg-secondary/50 rounded-lg p-4">
                <p className="text-sm text-muted-foreground capitalize">{key.replace('Count', 's').replace('Result', '')}</p>
                <p className="text-xl font-semibold text-foreground">
                  {key === 'duration' ? `${metadata[key]?.toFixed(1) || 0}s` : metadata[key] || 0}
                </p>
              </div>
            ))}
          </div>
        )}

        <button onClick={downloadResult} disabled={isDownloading} className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-11 px-8 w-full">
          {isDownloading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
          <span>{autoDownloadTriggered ? 'Download Again' : 'Download Excel Report'}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm font-medium text-foreground">{getStageLabel(status)}</span>
          <span className="text-sm font-semibold text-primary">{Math.round(progress)}%</span>
        </div>
        <div className="relative w-full h-2 bg-secondary rounded-full overflow-hidden">
            <div className="absolute top-0 left-0 h-full bg-primary rounded-full transition-all duration-500 ease-out" style={{ width: `${progress}%` }} />
        </div>
      </div>
      <p className="text-sm text-muted-foreground text-center">
        Processing your video... This may take several minutes depending on the video length.
      </p>
      <p className="text-xs text-muted-foreground/50 text-center pt-2">Upload ID: {uploadId}</p>
    </div>
  );
}
