"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { checkVideoUploadQuota } from "@/lib/quota";
import type { QuotaCheckResult } from "@/lib/quota";
import { AlertTriangle, CheckCircle, Info } from "lucide-react";

export function QuotaDisplay() {
  const { getToken } = useAuth();
  const [quota, setQuota] = useState<QuotaCheckResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchQuota();
  }, []);

  const fetchQuota = async () => {
    try {
      // Clerk JWTトークンを取得してAPIに送信
      const token = await getToken();
      const result = await checkVideoUploadQuota(token);
      setQuota(result);
      setError(null);
    } catch (err) {
      console.error("Quota fetch error:", err);
      setError(err instanceof Error ? err.message : "クォータ情報の取得に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="border rounded-lg p-4 mb-4 bg-secondary/30 animate-pulse">
        <div className="h-4 bg-muted rounded w-3/4 mb-2"></div>
        <div className="h-2 bg-muted rounded w-1/2"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="border border-yellow-500/20 bg-yellow-50/50 dark:bg-yellow-900/10 rounded-lg p-4 mb-4">
        <div className="flex items-start gap-3">
          <Info className="w-5 h-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-yellow-800 dark:text-yellow-200">
              クォータ情報を取得できませんでした
            </p>
            <p className="text-xs text-yellow-700 dark:text-yellow-300 mt-1">
              {error}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!quota) {
    return null;
  }

  const usagePercent = (quota.used / quota.quota) * 100;
  const isNearLimit = usagePercent >= 80 && usagePercent < 100;
  const isOverLimit = usagePercent >= 100;

  return (
    <div
      className={`border rounded-lg p-4 mb-4 ${
        isOverLimit
          ? "border-destructive/20 bg-destructive/5"
          : isNearLimit
          ? "border-yellow-500/20 bg-yellow-50/50 dark:bg-yellow-900/10"
          : "border-border bg-secondary/30"
      }`}
    >
      <div className="flex items-start gap-3">
        {isOverLimit ? (
          <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
        ) : isNearLimit ? (
          <AlertTriangle className="w-5 h-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
        ) : (
          <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-foreground">今月の使用状況</h3>
            <span className="text-xs font-medium text-muted-foreground">
              プラン: <span className="capitalize">{quota.plan_type}</span>
            </span>
          </div>

          <div className="space-y-2">
            {/* プログレスバー */}
            <div className="relative w-full h-2 bg-secondary rounded-full overflow-hidden">
              <div
                className={`absolute top-0 left-0 h-full transition-all duration-300 ${
                  isOverLimit
                    ? "bg-destructive"
                    : isNearLimit
                    ? "bg-yellow-500"
                    : "bg-green-500"
                }`}
                style={{ width: `${Math.min(usagePercent, 100)}%` }}
              />
            </div>

            {/* 使用量表示 */}
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {quota.used}/{quota.quota}動画使用
              </span>
              <span
                className={`font-medium ${
                  isOverLimit
                    ? "text-destructive"
                    : isNearLimit
                    ? "text-yellow-600 dark:text-yellow-400"
                    : "text-green-600 dark:text-green-400"
                }`}
              >
                残り {quota.remaining}動画
              </span>
            </div>

            {/* 警告メッセージ */}
            {isNearLimit && (
              <p className="text-xs text-yellow-700 dark:text-yellow-300 mt-2">
                ⚠️ 残りわずかです。プランのアップグレードをご検討ください。
              </p>
            )}

            {isOverLimit && (
              <div className="mt-2">
                <p className="text-xs text-destructive font-medium mb-2">
                  🚫 月間クォータを超過しています
                </p>
                <a
                  href={`${process.env.NEXT_PUBLIC_SAAS_PLATFORM_URL || "http://localhost:3000"}/billing`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block text-xs font-medium text-primary hover:text-primary/80 underline"
                >
                  プランをアップグレード →
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
