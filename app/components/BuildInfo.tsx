'use client';

import { useEffect } from 'react';

// Store version info globally for checkVersion()
declare global {
  interface Window {
    checkVersion: () => void;
    __buildInfo?: {
      frontend: { buildTime: string; commit: string };
      backend: { buildTime: string; commit: string; revision: string } | null;
    };
  }
}

/**
 * BuildInfo - Logs build information to console on mount
 * Helps verify you're testing against the latest deployment
 *
 * Features:
 * - Shows Frontend and Backend build info
 * - Warns if commit SHAs don't match (version mismatch)
 * - Provides checkVersion() function in console
 */
export function BuildInfo() {
  useEffect(() => {
    const buildTime = process.env.NEXT_PUBLIC_BUILD_TIME || 'unknown';
    const frontendCommit = (process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || 'local').slice(0, 7);
    const commitMsg = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_MESSAGE || '';

    // Store frontend info
    window.__buildInfo = {
      frontend: { buildTime, commit: frontendCommit },
      backend: null,
    };

    console.log(
      '%c[Build Info] Frontend (Vercel)',
      'background: #0070f3; color: white; padding: 2px 8px; border-radius: 4px; font-weight: bold;',
      `\n  Build Time: ${buildTime}`,
      `\n  Commit: ${frontendCommit}`,
      commitMsg ? `\n  Message: ${commitMsg}` : ''
    );

    // Fetch backend build info
    const cloudRunUrl = process.env.NEXT_PUBLIC_CLOUD_RUN_URL || 'https://video-analyzer-worker-820467345033.us-central1.run.app';
    fetch(`${cloudRunUrl}/health`)
      .then(res => res.json())
      .then(data => {
        const backendCommit = (data.commit || 'unknown').slice(0, 7);

        // Store backend info
        window.__buildInfo!.backend = {
          buildTime: data.buildTimeJST || 'unknown',
          commit: backendCommit,
          revision: data.revision || 'unknown',
        };

        console.log(
          '%c[Build Info] Backend (Cloud Run)',
          'background: #4285f4; color: white; padding: 2px 8px; border-radius: 4px; font-weight: bold;',
          `\n  Revision: ${data.revision || 'unknown'}`,
          `\n  Build Time (JST): ${data.buildTimeJST || 'unknown'}`,
          `\n  Commit: ${backendCommit}`
        );

        // Check version match
        if (frontendCommit !== 'local' && backendCommit !== 'unknown' && backendCommit !== 'local') {
          if (frontendCommit !== backendCommit) {
            console.log(
              '%c⚠️ VERSION MISMATCH!',
              'background: #dc2626; color: white; padding: 4px 12px; border-radius: 4px; font-weight: bold; font-size: 14px;',
              `\n  Frontend: ${frontendCommit}`,
              `\n  Backend:  ${backendCommit}`,
              '\n  Run ./deploy.sh in cloud-run-worker to sync backend'
            );
          } else {
            console.log(
              '%c✅ Versions match',
              'background: #16a34a; color: white; padding: 2px 8px; border-radius: 4px;',
              `(${frontendCommit})`
            );
          }
        }
      })
      .catch(() => {
        console.log('[Build Info] Could not fetch backend info');
      });

    // Register global checkVersion function
    window.checkVersion = () => {
      const info = window.__buildInfo;
      if (!info) {
        console.log('Build info not loaded yet. Refresh the page.');
        return;
      }

      console.log('\n========== Version Check ==========');
      console.log(`Frontend: ${info.frontend.commit} (${info.frontend.buildTime})`);

      if (info.backend) {
        console.log(`Backend:  ${info.backend.commit} (${info.backend.buildTime})`);
        console.log(`Revision: ${info.backend.revision}`);

        if (info.frontend.commit !== 'local' && info.backend.commit !== 'unknown' && info.backend.commit !== 'local') {
          if (info.frontend.commit === info.backend.commit) {
            console.log('%c✅ MATCH - Safe to test', 'color: #16a34a; font-weight: bold;');
          } else {
            console.log('%c⚠️ MISMATCH - Run ./deploy.sh', 'color: #dc2626; font-weight: bold;');
          }
        } else {
          console.log('⚠️ Cannot compare (local/unknown commits)');
        }
      } else {
        console.log('Backend: Not loaded');
      }
      console.log('====================================\n');
    };
  }, []);

  return null;
}
