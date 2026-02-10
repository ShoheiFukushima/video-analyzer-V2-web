'use client';

import { useEffect } from 'react';

/**
 * BuildInfo - Logs build information to console on mount
 * Helps verify you're testing against the latest deployment
 */
export function BuildInfo() {
  useEffect(() => {
    const buildTime = process.env.NEXT_PUBLIC_BUILD_TIME || 'unknown';
    const commitSha = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || 'local';
    const commitMsg = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_MESSAGE || '';

    console.log(
      '%c[Build Info] Frontend',
      'background: #0070f3; color: white; padding: 2px 8px; border-radius: 4px;',
      `\n  Build Time: ${buildTime}`,
      `\n  Commit: ${commitSha.slice(0, 7)}`,
      commitMsg ? `\n  Message: ${commitMsg}` : ''
    );

    // Also fetch and log backend build info
    const cloudRunUrl = process.env.NEXT_PUBLIC_CLOUD_RUN_URL || 'https://video-analyzer-worker-820467345033.us-central1.run.app';
    fetch(`${cloudRunUrl}/health`)
      .then(res => res.json())
      .then(data => {
        console.log(
          '%c[Build Info] Backend (Cloud Run)',
          'background: #4285f4; color: white; padding: 2px 8px; border-radius: 4px;',
          `\n  Revision: ${data.revision || 'unknown'}`,
          `\n  Build Time (JST): ${data.buildTimeJST || 'unknown'}`,
          `\n  Commit: ${data.commit || 'unknown'}`
        );
      })
      .catch(() => {
        console.log('[Build Info] Could not fetch backend info');
      });
  }, []);

  return null;
}
