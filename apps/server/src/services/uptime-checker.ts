import { env } from "../config/env.js";
import { broadcastText } from "./telegram-error-alerts.js";

export type UptimeStatus = {
  name: string;
  url: string;
  up: boolean;
  statusCode: number | null;
  latencyMs: number | null;
  lastCheckedAt: string;
  error: string | null;
};

// name → trạng thái hiện tại
const statuses = new Map<string, UptimeStatus>();
// name → trạng thái lần trước (để detect transition)
const prevUp = new Map<string, boolean>();
// name → timestamp alert cuối
const alertCooldowns = new Map<string, number>();
const ALERT_COOLDOWN_MS = 5 * 60 * 1000; // 5 phút

export function getUptimeStatuses(): UptimeStatus[] {
  return Array.from(statuses.values());
}

async function checkOne(check: { name: string; url: string; timeoutMs: number }): Promise<void> {
  const start = Date.now();
  let up = false;
  let statusCode: number | null = null;
  let error: string | null = null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), check.timeoutMs);
    try {
      const response = await fetch(check.url, {
        signal: controller.signal,
        redirect: "follow"
      });
      statusCode = response.status;
      up = response.status < 400;
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    if (error.includes("aborted") || error.includes("abort")) {
      error = `Timeout sau ${check.timeoutMs}ms`;
    }
  }

  const latencyMs = Date.now() - start;
  const status: UptimeStatus = {
    name: check.name,
    url: check.url,
    up,
    statusCode,
    latencyMs: up ? latencyMs : null,
    lastCheckedAt: new Date().toISOString(),
    error
  };

  statuses.set(check.name, status);
  await maybeSendAlert(status);
  prevUp.set(check.name, up);
}

async function maybeSendAlert(status: UptimeStatus): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_ERROR_ALERTS_ENABLED) return;

  const wasUp = prevUp.get(status.name); // undefined = lần đầu check
  const isFirstCheck = wasUp === undefined;

  // Chỉ alert khi down VÀ (lần đầu detect down, hoặc hết cooldown)
  if (status.up) return;

  const now = Date.now();
  const lastAlert = alertCooldowns.get(status.name) ?? 0;
  if (now - lastAlert < ALERT_COOLDOWN_MS) return;
  // Không alert lần đầu khởi động nếu đang down (tránh spam khi restart server)
  if (isFirstCheck) {
    alertCooldowns.set(status.name, now); // set cooldown để lần sau mới alert
    return;
  }

  alertCooldowns.set(status.name, now);

  const statusLabel = status.statusCode ? `HTTP ${status.statusCode}` : status.error ?? "no response";
  const recoveredLine = wasUp === true ? "" : "";
  const lines = [
    `🔴 Service down — ${status.name}`,
    `🌐 URL: ${status.url}`,
    `⚠️  ${statusLabel}${recoveredLine}`
  ];
  void broadcastText(lines.join("\n"));
}

async function maybeSendRecoveryAlert(status: UptimeStatus): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_ERROR_ALERTS_ENABLED) return;
  const wasUp = prevUp.get(status.name);
  if (!status.up || wasUp !== false) return; // chỉ alert khi vừa recover

  const lines = [
    `✅ Service recovered — ${status.name}`,
    `🌐 URL: ${status.url}`,
    `⚡ Latency: ${status.latencyMs}ms`
  ];
  void broadcastText(lines.join("\n"));
}

export function startUptimeChecker(): void {
  const checks = env.UPTIME_CHECKS;
  if (checks.length === 0) return;

  console.log(`[uptime] Checking ${checks.length} endpoint(s)`);

  for (const check of checks) {
    // Check ngay khi start, rồi theo interval riêng mỗi endpoint
    void checkOne(check).then(() => {
      // Sau lần đầu (isFirstCheck đã xong), set up interval
      setInterval(async () => {
        const before = statuses.get(check.name);
        await checkOne(check);
        const after = statuses.get(check.name);
        if (before && after && !before.up && after.up) {
          await maybeSendRecoveryAlert(after);
        }
      }, check.intervalMs);
    });
  }
}
