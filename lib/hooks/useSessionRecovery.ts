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
 */
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

        // Force token refresh by getting a fresh token
        const token = await getToken({ skipCache: true });

        if (token) {
          console.log("[SessionRecovery] Session refreshed successfully");
        } else {
          console.warn("[SessionRecovery] Failed to refresh token, session may be expired");
          // Session might be expired, Clerk will handle redirect to sign-in
        }
      }
    } catch (error) {
      console.error("[SessionRecovery] Error refreshing session:", error);

      // If session refresh fails, try to touch the session
      try {
        await session?.touch();
        console.log("[SessionRecovery] Session touched successfully");
      } catch (touchError) {
        console.error("[SessionRecovery] Session touch failed:", touchError);
        // User may need to re-login
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
