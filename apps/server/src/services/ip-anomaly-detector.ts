const RATE_WINDOW_MS = 60 * 1000;              // cửa sổ tính "gọi API dồn dập": 1 phút
const RATE_ALERT_THRESHOLD = 60;               // >=60 request/phút từ 1 IP là bất thường
const SCAN_WINDOW_MS = 5 * 60 * 1000;          // cửa sổ tính "đang quét": 5 phút
const SCAN_ALERT_THRESHOLD = 6;                // >=6 request bị đánh dấu security/5 phút là quét
const ALERT_COOLDOWN_MS = 15 * 60 * 1000;      // giữa 2 lần alert cùng loại cho cùng 1 IP
const IDLE_EVICT_MS = 30 * 60 * 1000;          // dọn IP không hoạt động để tránh phình bộ nhớ
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const TOP_PATHS_LIMIT = 5;

// Never alert on Docker-internal / loopback addresses — these are reverse-proxy hops (e.g.
// Nginx Proxy Manager's own container IP), not real clients. Backend nginx configs that don't
// trust NPM's X-Forwarded-For header will log NPM's IP as $remote_addr for every request, which
// would otherwise look like a single "attacker" scanning nonstop.
const LOOPBACK_RE = /^(127\.|::1$)/;
const DOCKER_INTERNAL_IP_RE = /^172\.(1[6-9]|2\d|3[01])\./;

function isTrackableIp(ip: string): boolean {
  return !LOOPBACK_RE.test(ip) && !DOCKER_INTERNAL_IP_RE.test(ip);
}

export type PathCount = { path: string; count: number };
export type IpAnomaly = { type: "rate" | "scan"; count: number; topPaths: PathCount[] };

type PathRecord = { t: number; path: string };

type IpState = {
  requests: PathRecord[];
  securityRequests: PathRecord[];
  lastSeenAt: number;
  lastRateAlertAt: number;
  lastScanAlertAt: number;
};

function topPathCounts(records: PathRecord[]): PathCount[] {
  const counts = new Map<string, number>();
  for (const r of records) counts.set(r.path, (counts.get(r.path) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_PATHS_LIMIT)
    .map(([path, count]) => ({ path, count }));
}

class IpAnomalyDetector {
  #ips = new Map<string, IpState>();
  #lastCleanupAt = 0;

  /** Call once per parsed access-log line. `isSecurityEvent` marks requests already flagged suspicious. */
  record(ip: string, isSecurityEvent: boolean, path: string): IpAnomaly | null {
    if (!isTrackableIp(ip)) return null;

    const now = Date.now();
    this.#maybeCleanup(now);

    let state = this.#ips.get(ip);
    if (!state) {
      state = { requests: [], securityRequests: [], lastSeenAt: now, lastRateAlertAt: 0, lastScanAlertAt: 0 };
      this.#ips.set(ip, state);
    }
    state.lastSeenAt = now;

    state.requests.push({ t: now, path });
    state.requests = state.requests.filter((r) => now - r.t < RATE_WINDOW_MS);

    if (isSecurityEvent) {
      state.securityRequests.push({ t: now, path });
      state.securityRequests = state.securityRequests.filter((r) => now - r.t < SCAN_WINDOW_MS);
    }

    // A sustained scan pattern is a stronger signal than raw volume, so check it first.
    if (state.securityRequests.length >= SCAN_ALERT_THRESHOLD && now - state.lastScanAlertAt >= ALERT_COOLDOWN_MS) {
      state.lastScanAlertAt = now;
      return { type: "scan", count: state.securityRequests.length, topPaths: topPathCounts(state.securityRequests) };
    }

    if (state.requests.length >= RATE_ALERT_THRESHOLD && now - state.lastRateAlertAt >= ALERT_COOLDOWN_MS) {
      state.lastRateAlertAt = now;
      return { type: "rate", count: state.requests.length, topPaths: topPathCounts(state.requests) };
    }

    return null;
  }

  #maybeCleanup(now: number) {
    if (now - this.#lastCleanupAt < CLEANUP_INTERVAL_MS) return;
    this.#lastCleanupAt = now;
    for (const [ip, state] of this.#ips) {
      if (now - state.lastSeenAt > IDLE_EVICT_MS) this.#ips.delete(ip);
    }
  }
}

export const ipAnomalyDetector = new IpAnomalyDetector();
