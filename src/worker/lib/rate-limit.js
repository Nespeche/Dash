const requestCounts = new Map();
const MAX_TRACKED_KEYS = 2048;
const SWEEP_INTERVAL_MS = 30_000;
let lastSweepAt = 0;

function normalizeIp(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "anonymous";
  const forwarded = raw.split(",")[0]?.trim();
  return forwarded || "anonymous";
}

function sweepStaleEntries(now = Date.now()) {
  if ((now - lastSweepAt) < SWEEP_INTERVAL_MS && requestCounts.size < MAX_TRACKED_KEYS) return;
  lastSweepAt = now;

  for (const [key, entry] of requestCounts.entries()) {
    const ttl = Math.max(Number(entry?.windowMs || 60_000) * 2, 60_000);
    if ((now - Number(entry?.start || now)) > ttl) {
      requestCounts.delete(key);
    }
  }

  if (requestCounts.size <= MAX_TRACKED_KEYS) return;
  const overflow = requestCounts.size - MAX_TRACKED_KEYS;
  let evicted = 0;
  for (const key of requestCounts.keys()) {
    if (evicted >= overflow) break;
    requestCounts.delete(key);
    evicted++;
  }
}

export function getClientIp(request) {
  return normalizeIp(
    request?.headers?.get("cf-connecting-ip")
    || request?.headers?.get("x-forwarded-for")
    || request?.headers?.get("x-real-ip")
    || ""
  );
}

export function checkRateLimit(ip, {
  scope = "global",
  limit = 60,
  windowMs = 60_000
} = {}) {
  const now = Date.now();
  sweepStaleEntries(now);

  const safeLimit = Math.max(1, Number(limit || 60));
  const safeWindowMs = Math.max(1_000, Number(windowMs || 60_000));
  const key = `${String(scope || "global")}::${normalizeIp(ip)}`;
  const existing = requestCounts.get(key);

  if (!existing || (now - existing.start) >= safeWindowMs) {
    const next = { count: 1, start: now, windowMs: safeWindowMs };
    requestCounts.set(key, next);
    return {
      allowed: true,
      remaining: Math.max(0, safeLimit - 1),
      retryAfterMs: safeWindowMs
    };
  }

  existing.count += 1;
  existing.windowMs = safeWindowMs;
  requestCounts.set(key, existing);

  const remaining = Math.max(0, safeLimit - existing.count);
  const retryAfterMs = Math.max(0, safeWindowMs - (now - existing.start));
  return {
    allowed: existing.count <= safeLimit,
    remaining,
    retryAfterMs
  };
}
