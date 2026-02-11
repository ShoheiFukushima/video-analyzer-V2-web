/**
 * Quota Management Library
 * SaaS Platform Core APIと連携してクォータチェック・使用量記録を行う
 */

const SAAS_PLATFORM_URL = process.env.NEXT_PUBLIC_SAAS_PLATFORM_URL || 'http://localhost:3000';

export interface QuotaCheckResult {
  allowed: boolean;
  remaining: number;
  used: number;
  quota: number;
  plan_type: string;
}

export interface UsageTrackData {
  uploadId: string;
  videoDurationSeconds: number;
  sceneCount?: number;
  processingTimeSeconds?: number;
}

/**
 * クォータチェック（動画アップロード前に必ず実行）
 * @param token - Clerk JWT token (required for cross-origin auth)
 */
export async function checkVideoUploadQuota(token?: string | null): Promise<QuotaCheckResult> {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };

  // JWTトークンがある場合はAuthorizationヘッダーに設定
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${SAAS_PLATFORM_URL}/api/quota/check`, {
    method: 'GET',
    headers,
    credentials: 'include',
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('認証が必要です。ログインしてください。');
    }
    throw new Error('クォータチェックに失敗しました。');
  }

  return await response.json();
}

/**
 * 使用量記録（動画処理完了後に実行）
 */
export async function trackVideoUsage(data: UsageTrackData): Promise<void> {
  try {
    const response = await fetch(`${SAAS_PLATFORM_URL}/api/quota/track`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        upload_id: data.uploadId,
        video_duration_seconds: data.videoDurationSeconds,
        scene_count: data.sceneCount,
        processing_time_seconds: data.processingTimeSeconds,
      }),
    });

    if (!response.ok) {
      console.error('Failed to track usage:', await response.text());
      // エラーはログに記録するが、ユーザーには表示しない（UX優先）
    }
  } catch (error) {
    console.error('Usage tracking error:', error);
    // 使用量記録の失敗はアプリケーション動作に影響させない
  }
}

/**
 * 動画長制限チェック（クライアント側）
 */
export function checkVideoDuration(
  durationSeconds: number,
  planType: string
): { allowed: boolean; maxDuration: number } {
  const limits: Record<string, number> = {
    free: 600,      // 10分
    basic: 1800,    // 30分
    pro: 3600,      // 60分
    teacher: 1800,  // 30分
  };

  const maxDuration = limits[planType] || 600;

  return {
    allowed: durationSeconds <= maxDuration,
    maxDuration,
  };
}
