"use client";

import { useEffect, useState, useCallback } from "react";
import { Loader2, CheckCircle2, Download, AlertCircle, RefreshCw, Volume2, Eye, FileSpreadsheet, SkipForward } from "lucide-react";
import type { ProcessingMetadata, ProcessingPhase, PhaseStatus } from "@/types/shared";
import { cn } from "@/lib/utils";

interface ProcessingStatusProps {
  uploadId: string;
  onComplete?: () => void;
}

interface PhaseData {
  phase: ProcessingPhase;
  label: string;
  icon: React.ReactNode;
  status: PhaseStatus;
  progress: number;
  estimatedTime?: string;
  subTask?: string;
  skipReason?: string;
}

const PHASE_LABELS: Record<ProcessingPhase, string> = {
  1: "Listening to narration...",
  2: "Reading on-screen text...",
  3: "Creating your report...",
};

const PHASE_COMPLETE_LABELS: Record<ProcessingPhase, string> = {
  1: "Narration captured",
  2: "Text extracted",
  3: "Report ready",
};

export function ProcessingStatus({ uploadId, onComplete }: ProcessingStatusProps) {
  const [error, setError] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<ProcessingMetadata | null>(null);
  const [autoDownloadTriggered, setAutoDownloadTriggered] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [isError, setIsError] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);

  // Stale detection: if status hasn't updated for 5 minutes, show error
  // Heartbeat updates every 60s, so 5 min means ~5 missed heartbeats
  const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

  // Phase state
  const [phases, setPhases] = useState<PhaseData[]>([
    { phase: 1, label: PHASE_LABELS[1], icon: <Volume2 className="w-5 h-5" />, status: 'waiting', progress: 0 },
    { phase: 2, label: PHASE_LABELS[2], icon: <Eye className="w-5 h-5" />, status: 'waiting', progress: 0 },
    { phase: 3, label: PHASE_LABELS[3], icon: <FileSpreadsheet className="w-5 h-5" />, status: 'waiting', progress: 0 },
  ]);

  const downloadResult = useCallback(async () => {
    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 2000;

    setIsDownloading(true);
    setDownloadError(null);

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(`/api/download/${uploadId}`);
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error || `Download failed (${response.status})`);
        }

        const contentType = response.headers.get('content-type') || '';

        if (contentType.includes('application/json')) {
          // Production: API returns presigned URL for direct R2 download
          const data = await response.json();
          if (!data.downloadUrl) throw new Error('No download URL returned');

          const a = document.createElement('a');
          a.href = data.downloadUrl;
          a.download = `result_${uploadId}.xlsx`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        } else {
          // Development / backward compatibility: API returns file directly
          const blob = await response.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `result_${uploadId}.xlsx`;
          document.body.appendChild(a);
          a.click();
          window.URL.revokeObjectURL(url);
          document.body.removeChild(a);
        }

        // Success - clear any previous download error
        setDownloadError(null);
        setIsDownloading(false);
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Download failed';
        console.warn(`[${uploadId}] Download attempt ${attempt}/${MAX_RETRIES} failed: ${msg}`);

        if (attempt < MAX_RETRIES) {
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
        } else {
          // All retries exhausted - show download error (not processing error)
          setDownloadError(msg);
        }
      }
    }

    setIsDownloading(false);
  }, [uploadId]);

  useEffect(() => {
    const pollStatus = async () => {
      try {
        const response = await fetch(`/api/status/${uploadId}`);
        const data = await response.json();

        // Check for stale status (processing hasn't updated for too long)
        if (data.updatedAt) {
          const updatedAt = new Date(data.updatedAt).getTime();
          const now = Date.now();
          const timeSinceUpdate = now - updatedAt;

          // If status is "processing" but hasn't updated for 30+ minutes, treat as error
          if (data.status === "processing" && timeSinceUpdate > STALE_THRESHOLD_MS) {
            console.error(`[${uploadId}] Processing stale: no update for ${Math.round(timeSinceUpdate / 1000 / 60)} minutes`);
            setIsError(true);
            setError("Processing appears to have stopped unexpectedly. Please try uploading again.");
            onComplete?.();
            return true; // Stop polling
          }

          setLastUpdatedAt(data.updatedAt);
        }

        // Update phase data from API response
        if (data.phase !== undefined) {
          // Debug: Log phase data from API
          if (data.phase === 2 && data.subTask) {
            console.log(`[ProcessingStatus] Phase 2 subTask: "${data.subTask}"`);
          }
          setPhases(prev => prev.map(p => {
            if (p.phase === data.phase) {
              return {
                ...p,
                status: data.phaseStatus || 'in_progress',
                progress: data.phaseProgress || 0,
                estimatedTime: data.estimatedTimeRemaining,
                subTask: data.subTask,
                label: data.phaseStatus === 'completed'
                  ? PHASE_COMPLETE_LABELS[p.phase]
                  : data.phaseStatus === 'skipped'
                    ? 'Skipped'
                    : PHASE_LABELS[p.phase],
                skipReason: data.phaseStatus === 'skipped' ? data.subTask : undefined,
              };
            }
            // Mark previous phases as completed
            if (p.phase < data.phase) {
              return {
                ...p,
                status: p.status === 'skipped' ? 'skipped' : 'completed',
                progress: 100,
                label: p.status === 'skipped' ? 'Skipped' : PHASE_COMPLETE_LABELS[p.phase],
              };
            }
            return p;
          }));
        }

        if (data.status === "completed" && data.resultUrl) {
          // Mark all phases as completed
          setPhases(prev => prev.map(p => ({
            ...p,
            status: p.status === 'skipped' ? 'skipped' : 'completed',
            progress: 100,
            label: p.status === 'skipped' ? 'Skipped' : PHASE_COMPLETE_LABELS[p.phase],
          })));
          setIsCompleted(true);
          setResultUrl(data.resultUrl);
          setMetadata(data.metadata);
          onComplete?.();
          return true; // Stop polling
        } else if (data.status === "error") {
          setIsError(true);
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
    }, 3000); // Poll every 3 seconds for smoother updates

    pollStatus(); // Initial poll

    return () => clearInterval(intervalId);
  }, [uploadId, onComplete]);

  useEffect(() => {
    if (isCompleted && resultUrl && !autoDownloadTriggered) {
      setAutoDownloadTriggered(true);
      setTimeout(() => downloadResult(), 500);
    }
  }, [isCompleted, resultUrl, autoDownloadTriggered, downloadResult]);

  // Error state
  if (isError) {
    // Determine if this is a server-side interruption (not a user error)
    const isServerInterruption = error?.includes('maintenance') ||
                                  error?.includes('scaling') ||
                                  error?.includes('resource') ||
                                  error?.includes('interrupted') ||
                                  error?.includes('stopped unexpectedly');

    return (
      <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-6 space-y-4">
        <div className="flex items-start gap-4">
          <AlertCircle className="w-6 h-6 text-destructive flex-shrink-0" />
          <div className="flex-1">
            <h3 className="text-lg font-semibold font-serif text-destructive">
              {isServerInterruption ? 'Processing was interrupted' : 'An issue occurred'}
            </h3>
            <p className="text-destructive/80 mt-1">{error}</p>
            {isServerInterruption && (
              <p className="text-muted-foreground text-sm mt-2">
                This was not caused by your video. The server was restarted or scaled down during processing.
              </p>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground/50">Upload ID: {uploadId}</p>
      </div>
    );
  }

  // Completed state
  if (isCompleted && resultUrl) {
    return (
      <div className="space-y-6">
        <div className="bg-green-600/10 border border-green-600/20 rounded-lg p-6 flex items-start gap-4">
          <CheckCircle2 className="w-6 h-6 text-green-600 flex-shrink-0" />
          <div>
            <h3 className="text-lg font-semibold font-serif text-green-600">Your artwork is ready</h3>
            <p className="text-green-600/80 mt-1">
              The interpreted data from your video is now available for download.
            </p>
          </div>
        </div>

        {metadata && (
          <div className="space-y-4">
            {/* Main Stats */}
            <div className="grid md:grid-cols-3 gap-4">
              {(['duration', 'segmentCount', 'ocrResultCount'] as const).map(key => (
                <div key={key} className="bg-secondary/50 rounded-lg p-4">
                  <p className="text-sm text-muted-foreground capitalize font-serif">{key.replace('Count', 's').replace('Result', '')}</p>
                  <p className="text-xl font-semibold text-foreground">
                    {key === 'duration' ? `${metadata[key]?.toFixed(1) || 0}s` : metadata[key] || 0}
                  </p>
                </div>
              ))}
            </div>

          </div>
        )}

        {downloadError && (
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-amber-700 dark:text-amber-400">Download failed</p>
              <p className="text-xs text-amber-600/80 dark:text-amber-400/70 mt-1">{downloadError}</p>
            </div>
          </div>
        )}

        <button onClick={downloadResult} disabled={isDownloading} className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-11 px-8 w-full">
          {isDownloading ? <Loader2 className="w-5 h-5 animate-spin" /> : downloadError ? <RefreshCw className="w-5 h-5" /> : <Download className="w-5 h-5" />}
          <span>{isDownloading ? 'Retrying...' : downloadError ? 'Retry Download' : autoDownloadTriggered ? 'Download Again' : 'Download Artwork'}</span>
        </button>
      </div>
    );
  }

  // Processing state - 3-Phase UI
  return (
    <div className="space-y-6">
      {/* Phase indicators */}
      <div className="space-y-4">
        {phases.map((phase) => (
          <PhaseIndicator key={phase.phase} phase={phase} />
        ))}
      </div>

      {/* Helper text - Dynamic based on phase */}
      <div className="text-center space-y-1">
        <p className="text-sm text-muted-foreground">
          {phases.find(p => p.status === 'in_progress')?.phase === 2 && phases[1].subTask?.includes('Batch')
            ? 'Processing your video in optimized batches for best results...'
            : 'The AI is interpreting your video...'}
        </p>
        {/* Estimated time hint for long videos */}
        {phases.find(p => p.status === 'in_progress')?.phase === 2 &&
         phases[1].subTask?.includes('Batch') && (
          <p className="text-xs text-muted-foreground/70">
            Long videos may take 30-60 minutes. Feel free to leave this tab open.
          </p>
        )}
        {phases[1].estimatedTime && (
          <p className="text-xs text-primary/80 font-medium">
            {phases[1].estimatedTime}
          </p>
        )}
      </div>
      <p className="text-xs text-muted-foreground/50 text-center">Upload ID: {uploadId}</p>
    </div>
  );
}

interface PhaseIndicatorProps {
  phase: PhaseData;
}

function PhaseIndicator({ phase }: PhaseIndicatorProps) {
  const isWaiting = phase.status === 'waiting';
  const isInProgress = phase.status === 'in_progress';
  const isCompleted = phase.status === 'completed';
  const isSkipped = phase.status === 'skipped';

  return (
    <div
      className={cn(
        "rounded-lg border p-4 transition-all duration-300",
        isWaiting && "bg-secondary/30 border-secondary opacity-60",
        isInProgress && "bg-primary/5 border-primary/30 shadow-sm",
        isCompleted && "bg-green-600/5 border-green-600/20",
        isSkipped && "bg-amber-500/5 border-amber-500/20 opacity-80"
      )}
    >
      <div className="flex items-center gap-3">
        {/* Phase icon */}
        <div
          className={cn(
            "flex items-center justify-center w-10 h-10 rounded-full",
            isWaiting && "bg-secondary text-muted-foreground",
            isInProgress && "bg-primary/10 text-primary",
            isCompleted && "bg-green-600/10 text-green-600",
            isSkipped && "bg-amber-500/10 text-amber-600"
          )}
        >
          {isCompleted ? (
            <CheckCircle2 className="w-5 h-5" />
          ) : isSkipped ? (
            <SkipForward className="w-5 h-5" />
          ) : isInProgress ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            phase.icon
          )}
        </div>

        {/* Phase info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <span
              className={cn(
                "text-sm font-medium",
                isWaiting && "text-muted-foreground",
                isInProgress && "text-foreground",
                isCompleted && "text-green-600",
                isSkipped && "text-amber-600"
              )}
            >
              {isSkipped && phase.skipReason ? phase.skipReason : phase.label}
            </span>
            {isInProgress && (
              <span className="text-sm font-semibold text-primary">
                {phase.progress}%
              </span>
            )}
            {isCompleted && (
              <CheckCircle2 className="w-4 h-4 text-green-600" />
            )}
          </div>

          {/* Progress bar for in-progress phase */}
          {isInProgress && (
            <div className="mt-2">
              <div className="relative w-full h-1.5 bg-secondary rounded-full overflow-hidden">
                <div
                  className="absolute top-0 left-0 h-full bg-primary rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${phase.progress}%` }}
                />
              </div>
              {/* Sub-task and estimated time */}
              <div className="flex items-center justify-between mt-1.5">
                {phase.subTask && (
                  <span className="text-xs text-muted-foreground">
                    {phase.subTask}
                  </span>
                )}
                {phase.estimatedTime && (
                  <span className="text-xs text-muted-foreground/70 ml-auto">
                    {phase.estimatedTime}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
