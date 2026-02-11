/**
 * Turso Database Client & Utilities
 *
 * プロジェクト: Video Analyzer V2 Web
 * データベース: Turso (libSQL) - saas-platform-coreと共有
 */

import { createClient, type Client } from '@libsql/client';
import { auth } from '@clerk/nextjs/server';
import { verifyToken } from '@clerk/backend';
import { headers } from 'next/headers';

/**
 * Tursoクライアントとユーザー認証を取得
 * Next.js API Routes用
 *
 * 認証フロー:
 * 1. セッションクッキー認証を試行（同一ドメイン）
 * 2. 失敗した場合、AuthorizationヘッダーのJWTトークンを検証（クロスドメイン）
 *
 * @returns { client: Client, userId: string }
 * @throws Error - ユーザーが未認証の場合
 */
export async function getTursoClient(): Promise<{ client: Client; userId: string }> {
  let userId: string | null = null;

  // 1. セッションクッキー認証を試行（同一ドメインリクエスト用）
  try {
    const authResult = await auth();
    userId = authResult.userId;
  } catch (e) {
    // セッション認証失敗、JWTフォールバックを試行
  }

  // 2. セッション認証が失敗した場合、JWTトークン検証を試行（クロスドメイン用）
  if (!userId) {
    const headersList = await headers();
    const authHeader = headersList.get('authorization');

    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      try {
        const verifiedToken = await verifyToken(token, {
          secretKey: process.env.CLERK_SECRET_KEY!,
        });
        userId = verifiedToken.sub;
      } catch (e) {
        console.error('JWT verification failed:', e);
      }
    }
  }

  if (!userId) throw new Error('Unauthorized');

  const client = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  });

  return { client, userId };
}

/**
 * Tursoクライアントのみ取得（認証なし）
 * Cloud Run Worker用 - userIdは別途渡される
 */
export function getTursoClientOnly(): Client {
  return createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  });
}

/**
 * ISO8601日時生成
 */
export function getCurrentTimestamp(): string {
  return new Date().toISOString();
}
