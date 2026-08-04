const RATE_WINDOW_MS = 60 * 1000;              // cửa sổ tính "gọi API dồn dập": 1 phút
const RATE_ALERT_THRESHOLD = 60;               // >=60 request/phút từ 1 IP là bất thường
const SCAN_WINDOW_MS = 5 * 60 * 1000;          // cửa sổ tính "đang quét": 5 phút
const SCAN_ALERT_THRESHOLD = 6;                // >=6 request bị đánh dấu security/5 phút là quét
const ALERT_COOLDOWN_MS = 15 * 60 * 1000;      // giữa 2 lần alert cùng loại cho cùng 1 IP
const IDLE_EVICT_MS = 30 * 60 * 1000;          // dọn IP không hoạt động để tránh phình bộ nhớ
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

export type IpAnomaly = { type: "rate"; count: number } | { type: "scan"; count: number };

type IpState = {
  requestTimestamps: number[];
  securityTimestamps: number[];
  lastSeenAt: number;
  lastRateAlertAt: number;
  lastScanAlertAt: number;
};

class IpAnomalyDetector {
  #ips = new Map<string, IpState>();
  #lastCleanupAt = 0;

  /** Call once per parsed access-log line. `isSecurityEvent` marks requests already flagged suspicious. */
  record(ip: string, isSecurityEvent: boolean): IpAnomaly | null {
    const now = Date.now();
    this.#maybeCleanup(now);

    let state = this.#ips.get(ip);
    if (!state) {
      state = { requestTimestamps: [], securityTimestamps: [], lastSeenAt: now, lastRateAlertAt: 0, lastScanAlertAt: 0 };
      this.#ips.set(ip, state);
    }
    state.lastSeenAt = now;

    state.requestTimestamps.push(now);
    state.requestTimestamps = state.requestTimestamps.filter((t) => now - t < RATE_WINDOW_MS);

    if (isSecurityEvent) {
      state.securityTimestamps.push(now);
      state.securityTimestamps = state.securityTimestamps.filter((t) => now - t < SCAN_WINDOW_MS);
    }

    // A sustained scan pattern is a stronger signal than raw volume, so check it first.
    if (state.securityTimestamps.length >= SCAN_ALERT_THRESHOLD && now - state.lastScanAlertAt >= ALERT_COOLDOWN_MS) {
      state.lastScanAlertAt = now;
      return { type: "scan", count: state.securityTimestamps.length };
    }

    if (state.requestTimestamps.length >= RATE_ALERT_THRESHOLD && now - state.lastRateAlertAt >= ALERT_COOLDOWN_MS) {
      state.lastRateAlertAt = now;
      return { type: "rate", count: state.requestTimestamps.length };
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
