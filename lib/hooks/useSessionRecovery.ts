"use client";

import { useEffect, useCallback, useRef } from "react";
import { useAuth, useClerk } from "@clerk/nextjs";

/**
 * Session Recovery Hook
 *
 * Handles session recovery after:
 * - Mac sleep/wake
 * - Browser tab becoming visible
 * - Network reconnection
 *
 * Automatically refreshes Clerk session token when needed.
 * Includes exponential backoff retry for 429 (rate limit) errors.
 */

const MAX_RETRY_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 1000;

function is429Error(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as Record<string, unknown>;
  if (err.status === 429) return true;
  const message = String(err.message ?? "");
  return message.includes("429") || message.includes("rate limit") || message.includes("Too Many Requests");
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function useSessionRecovery() {
  const { isSignedIn, getToken } = useAuth();
  const { session } = useClerk();
  const lastActiveTime = useRef<number>(Date.now());
  const isRecovering = useRef<boolean>(false);

  // Session recovery function
  const recoverSession = useCallback(async () => {
    if (isRecovering.current || !isSignedIn) return;

    isRecovering.current = true;

    try {
      const timeSinceActive = Date.now() - lastActiveTime.current;

      // If more than 5 minutes have passed, proactively refresh the token
      if (timeSinceActive > 5 * 60 * 1000) {
        console.log("[SessionRecovery] Refreshing session after inactivity...");

        // Force token refresh with retry on 429
        let token: string | null = null;
        for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
          try {
            token = await getToken({ skipCache: true });
            break;
          } catch (tokenError) {
            if (is429Error(tokenError) && attempt < MAX_RETRY_ATTEMPTS) {
              const delay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
              console.warn(
                `[SessionRecovery] getToken() 429 rate limited, retry ${attempt}/${MAX_RETRY_ATTEMPTS} after ${delay}ms`
              );
              await sleep(delay);
              continue;
            }
            throw tokenError;
          }
        }

        if (token) {
          console.log("[SessionRecovery] Session refreshed successfully");
        } else {
          console.warn("[SessionRecovery] Failed to refresh token, session may be expired");
        }
      }
    } catch (error) {
      console.error("[SessionRecovery] Error refreshing session:", error);

      // If session refresh fails, try to touch the session with retry on 429
      for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
        try {
          await session?.touch();
          console.log("[SessionRecovery] Session touched successfully");
          break;
        } catch (touchError) {
          if (is429Error(touchError) && attempt < MAX_RETRY_ATTEMPTS) {
            const delay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
            console.warn(
              `[SessionRecovery] session.touch() 429 rate limited, retry ${attempt}/${MAX_RETRY_ATTEMPTS} after ${delay}ms`
            );
            await sleep(delay);
            continue;
          }
          console.error("[SessionRecovery] Session touch failed:", touchError);
          break;
        }
      }
    } finally {
      lastActiveTime.current = Date.now();
      isRecovering.current = false;
    }
  }, [isSignedIn, getToken, session]);

  useEffect(() => {
    if (!isSignedIn) return;

    // 1. Handle visibility change (tab becomes visible)
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        console.log("[SessionRecovery] Page became visible, checking session...");
        recoverSession();
      } else {
        // Record when page became hidden
        lastActiveTime.current = Date.now();
      }
    };

    // 2. Handle online event (network reconnection)
    const handleOnline = () => {
      console.log("[SessionRecovery] Network reconnected, refreshing session...");
      recoverSession();
    };

    // 3. Handle focus event (window gains focus)
    const handleFocus = () => {
      const timeSinceActive = Date.now() - lastActiveTime.current;
      // Only recover if inactive for more than 1 minute
      if (timeSinceActive > 60 * 1000) {
        console.log("[SessionRecovery] Window focused after inactivity, checking session...");
        recoverSession();
      }
    };

    // Add event listeners
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);
    window.addEventListener("focus", handleFocus);

    // Cleanup
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("focus", handleFocus);
    };
  }, [isSignedIn, recoverSession]);

  // Return recovery function for manual use if needed
  return { recoverSession };
}
