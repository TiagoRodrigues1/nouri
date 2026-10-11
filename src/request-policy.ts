import { accountExports } from "./account/export-limits.js";
import { isPhotoUpload, photoBodySize, photoLimits } from "./photos/limits.js";
import { day, hour, limited, minute, requestLimits, usageWindows, type UsageBudget } from "./request-limits.js";

// Compose route policy at the HTTP boundary, without teaching the counter engine about features.
export function requestPolicy(now = Date.now) {
  const consume = usageWindows(now);
  const photos = photoLimits(consume);
  const exportStream = accountExports(consume);

  const beforeRequest = requestLimits(consume, {
    bodySize: (method, path) => isPhotoUpload(method, path) ? photoBodySize : 256 * 1024,
    admit(method, path) {
      if (path.startsWith("/v1/") && !consume("session-checks", 600, minute)) return limited("Too many API requests. Try again shortly.", 60);

      if (path === "/mcp" && method === "POST" && !consume("oauth-checks", 60, minute)) return limited("Too many agent requests. Try again shortly.", 60);

      return null;
    },
  });

  function forUser(userId: string, method: string, path: string): Response | null {
    // Attempt limits intentionally count rejected requests. Write and feature allowances count admissions together.
    if (!consume(`requests:${userId}`, 180, minute)) return limited("Too many requests for this account. Try again shortly.", 60);

    // Background import checks merge into one queued job and retain their separate allowance.
    if (method === "POST" && /^\/v1\/integrations\/[^/]+\/refreshes$/.test(path)) {
      return consume(`refreshes:${userId}`, 30, minute) ? null : limited("Too many refresh checks. Try again shortly.", 60);
    }

    const budgets: UsageBudget[] = photos.budgets(userId, method, path);

    if (!["GET", "HEAD", "OPTIONS"].includes(method)) budgets.push(
      { key: "writes", maximum: 5000, duration: day },
      { key: `writes:${userId}`, maximum: 500, duration: day },
      { key: `writes-hour:${userId}`, maximum: 120, duration: hour },
    );

    return consume.reserve(budgets) ? null : limited("Account usage limit reached. Try again later.", 3600);
  }

  return { beforeRequest, beforeUpload: photos.beforeUpload, forUser, photoDownload: photos.download, exportStream };
}
