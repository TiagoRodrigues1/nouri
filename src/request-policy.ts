import { accountExports } from "./account/export-limits.js";
import { isPhotoUpload, photoBodySize, photoLimits } from "./photos/limits.js";
import { day, hour, limited, minute, requestLimits, usageWindows, type UsageBudget } from "./request-limits.js";

// Compose route policy at the HTTP boundary, without teaching the counter engine about features.
export function requestPolicy(options: { identify: (request: Request) => Promise<string | null> }, now = Date.now) {
  const consume = usageWindows(now);
  const photos = photoLimits(consume);
  const exportStream = accountExports(consume);

  const beforeRequest = requestLimits(consume, {
    identify: options.identify,
    costly: (path) => ["/v1/", "/mcp", "/webhooks/", "/oauth/"].some((prefix) => path.startsWith(prefix)),
    bodySize: (method, path) => isPhotoUpload(method, path) ? photoBodySize : 256 * 1024,
    // Only callers the gate could not identify count here: failed sessions, and agent tokens Clerk must check.
    admit(method, path, clerkUserId) {
      if (clerkUserId) return null;

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

    if (path.startsWith("/v1/foods/barcodes/")) budgets.push({ key: `barcodes:${userId}`, maximum: 120, duration: hour });

    if (!["GET", "HEAD", "OPTIONS"].includes(method)) budgets.push(
      { key: "writes", maximum: 5000, duration: day },
      { key: `writes:${userId}`, maximum: 500, duration: day },
      { key: `writes-hour:${userId}`, maximum: 120, duration: hour },
    );

    return consume.reserve(budgets) ? null : limited("Account usage limit reached. Try again later.", 3600);
  }

  // Cached barcodes answer without this; it bounds what all accounts together ask Open Food Facts.
  const barcodeFetch = () => consume("barcode-fetches", 600, hour);

  return { beforeRequest, beforeUpload: photos.beforeUpload, forUser, photoDownload: photos.download, exportStream, barcodeFetch };
}
