import fs from "node:fs";
import http from "node:http";
import type Docker from "dockerode";
import { env } from "../config/env.js";
import { broadcastText } from "./telegram-error-alerts.js";

export type DiskUsage = { totalBytes: number; availableBytes: number; usedPercent: number };

/**
 * fs.statfsSync on the container's own root reflects the host disk (verified against `df` on the
 * VPS: same total, and bavail — not bfree, which still counts the ~5% root-reserved margin —
 * matches df's "Available" almost exactly). No privileged helper container needed here, unlike
 * the iptables case, since reading disk stats isn't a namespaced operation the way networking is.
 */
export function getDiskUsage(path = "/"): DiskUsage {
  const stats = fs.statfsSync(path);
  const totalBytes = stats.blocks * stats.bsize;
  const availableBytes = stats.bavail * stats.bsize;
  const usedPercent = totalBytes > 0 ? ((totalBytes - availableBytes) / totalBytes) * 100 : 0;
  return { totalBytes, availableBytes, usedPercent };
}

function formatGb(bytes: number): string {
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}GB`;
}

function dockerApiPost<T>(path: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath: env.DOCKER_SOCKET_PATH, path, method: "POST" }, (res) => {
      let data = "";
      res.on("data", (chunk: Buffer) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(data ? (JSON.parse(data) as T) : ({} as T));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

export type DiskCleanupReport = {
  before: DiskUsage;
  after: DiskUsage;
  freedBytes: number;
  imagesDeleted: number;
  imagesSpaceReclaimed: number;
  buildCacheSpaceReclaimed: number;
};

/** Manual/on-demand cleanup — more aggressive than the CI/CD deploy prune (no cache-age filter),
 * since this only runs when disk space is an active concern (alert threshold or manual trigger). */
export async function cleanupDiskSpace(docker: Docker): Promise<DiskCleanupReport> {
  const before = getDiskUsage();

  const imagePrune = await docker.pruneImages({ filters: { dangling: ["false"] } });
  const buildPrune = await dockerApiPost<{ CachesDeleted?: string[]; SpaceReclaimed?: number }>("/build/prune");

  const after = getDiskUsage();

  return {
    before,
    after,
    freedBytes: Math.max(0, after.availableBytes - before.availableBytes),
    imagesDeleted: imagePrune.ImagesDeleted?.length ?? 0,
    imagesSpaceReclaimed: imagePrune.SpaceReclaimed ?? 0,
    buildCacheSpaceReclaimed: buildPrune.SpaceReclaimed ?? 0
  };
}

export function formatDiskCleanupReport(report: DiskCleanupReport): string {
  const lines = [
    `🧹 Đã dọn dẹp xong`,
    `📦 Image đã xoá: ${report.imagesDeleted} (${formatGb(report.imagesSpaceReclaimed)})`,
    `🗄️ Build cache đã xoá: ${formatGb(report.buildCacheSpaceReclaimed)}`,
    `💽 Dung lượng đĩa trống: ${formatGb(report.before.availableBytes)} → ${formatGb(report.after.availableBytes)} (giải phóng ${formatGb(report.freedBytes)})`,
    `📊 Tỉ lệ sử dụng: ${report.before.usedPercent.toFixed(1)}% → ${report.after.usedPercent.toFixed(1)}%`
  ];
  return lines.join("\n");
}

const DISK_ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 giờ giữa 2 lần cảnh báo nếu vẫn còn đầy
let lastAlertAt = 0;

async function checkDiskSpace(): Promise<void> {
  const usage = getDiskUsage();
  if (usage.usedPercent < env.DISK_ALERT_THRESHOLD) return;
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_ERROR_ALERTS_ENABLED) return;

  const now = Date.now();
  if (now - lastAlertAt < DISK_ALERT_COOLDOWN_MS) return;
  lastAlertAt = now;

  const lines = [
    `💽 Ổ đĩa VPS gần đầy — ${usage.usedPercent.toFixed(1)}% đã dùng`,
    `📉 Còn trống: ${formatGb(usage.availableBytes)} / ${formatGb(usage.totalBytes)}`,
    `⚠️ Có thể gây crash Postgres/container nếu đầy hẳn (đã từng xảy ra).`
  ];

  void broadcastText(lines.join("\n"), [[{ text: "🧹 Dọn dẹp ngay", callback_data: "diskcleanup:go" }]]);
}

export function startDiskSpaceChecker(): void {
  void checkDiskSpace();
  setInterval(() => void checkDiskSpace(), env.DISK_CHECK_INTERVAL_MS);
}
