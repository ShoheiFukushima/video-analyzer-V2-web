"use client";

import { useSessionRecovery } from "@/lib/hooks/useSessionRecovery";

/**
 * Session Recovery Provider
 *
 * Wrap your app with this component to enable automatic session recovery
 * after Mac sleep, tab switch, or network reconnection.
 *
 * Usage in layout.tsx:
 *   <SessionRecoveryProvider>
 *     {children}
 *   </SessionRecoveryProvider>
 */
export function SessionRecoveryProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // Initialize session recovery hook
  useSessionRecovery();

  return <>{children}</>;
}
