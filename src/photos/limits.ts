import type { MiddlewareHandler } from "hono";
import { day, hour, limited, mib, minute, type UsageBudget, type UsageWindows } from "../request-limits.js";
import { maxPhotoBytes, maxThumbnailBytes } from "./contract.js";

export const photoBodySize = maxPhotoBytes + maxThumbnailBytes + 64 * 1024;

export const isPhotoUpload = (method: string, path: string) => method === "POST" && path === "/v1/progress-photos";

export function photoLimits(consume: UsageWindows) {
  let activeUploads = 0;

  const beforeUpload: MiddlewareHandler = async (_context, next) => {
    if (activeUploads >= 2) return limited("Photo uploads are busy. Try again shortly.", 60);
    activeUploads++;

    try { await next(); } finally { activeUploads--; }
  };

  function budgets(userId: string, method: string, path: string): UsageBudget[] {
    if (isPhotoUpload(method, path)) return [{ key: `uploads:${userId}`, maximum: 20, duration: hour }];

    if (/^\/v1\/progress-photos\/[^/]+\/(image|thumbnail)$/.test(path)) return [
      { key: `photo-reads:${userId}`, maximum: 60, duration: minute },
      { key: `photo-reads-day:${userId}`, maximum: 1000, duration: day },
    ];

    return [];
  }

  function download(userId: string, amount: number): Response | null {
    return consume.reserve([
      { key: `photo-bytes:${userId}`, maximum: 512 * mib, duration: day, amount },
      { key: "photo-bytes", maximum: 2 * 1024 * mib, duration: day, amount },
    ]) ? null : limited("Daily photo download allowance reached. Try again tomorrow.", 86400);
  }

  return { beforeUpload, budgets, download };
}
