import Docker from "dockerode";
import { env } from "../config/env.js";
import { silenceManager } from "./silence-manager.js";
import { broadcastText } from "./telegram-error-alerts.js";

export type ContainerStatsSnapshot = {
  containerId: string;
  containerName: string;
  project: string;
  service: string;
  cpuPercent: number;
  memoryUsageBytes: number;
  memoryLimitBytes: number;
  memoryPercent: number;
  collectedAt: string;
};

// containerId → snapshot
const latestStats = new Map<string, ContainerStatsSnapshot>();

// containerId → timestamp of last memory alert
const memoryAlertCooldowns = new Map<string, number>();
const MEMORY_ALERT_COOLDOWN_MS = 15 * 60 * 1000; // 15 phút

export function getLatestStats(): ContainerStatsSnapshot[] {
  return Array.from(latestStats.values());
}

type DockerStatsRaw = {
  cpu_stats: {
    cpu_usage: { total_usage: number };
    system_cpu_usage: number;
    online_cpus?: number;
  };
  precpu_stats: {
    cpu_usage: { total_usage: number };
    system_cpu_usage: number;
  };
  memory_stats: {
    usage: number;
    limit: number;
    stats?: { cache?: number };
  };
};

function calcCpuPercent(raw: DockerStatsRaw): number {
  const cpuDelta = raw.cpu_stats.cpu_usage.total_usage - raw.precpu_stats.cpu_usage.total_usage;
  const systemDelta = raw.cpu_stats.system_cpu_usage - raw.precpu_stats.system_cpu_usage;
  const numCpus = raw.cpu_stats.online_cpus ?? 1;
  if (systemDelta <= 0 || cpuDelta < 0) return 0;
  return Math.min(100, (cpuDelta / systemDelta) * numCpus * 100);
}

function calcMemoryPercent(raw: DockerStatsRaw): { usageBytes: number; percent: number } {
  // Trừ cache để có số thực tế (Linux cgroups v1)
  const cache = raw.memory_stats.stats?.cache ?? 0;
  const usageBytes = Math.max(0, raw.memory_stats.usage - cache);
  const limit = raw.memory_stats.limit;
  const percent = limit > 0 ? (usageBytes / limit) * 100 : 0;
  return { usageBytes, percent };
}

async function pollOneContainer(
  docker: Docker,
  containerId: string,
  containerName: string,
  project: string,
  service: string,
  sendAlert: (snap: ContainerStatsSnapshot) => Promise<void>
): Promise<void> {
  try {
    const raw = (await docker.getContainer(containerId).stats({ stream: false })) as DockerStatsRaw;
    const cpuPercent = calcCpuPercent(raw);
    const { usageBytes, percent: memoryPercent } = calcMemoryPercent(raw);
    const snap: ContainerStatsSnapshot = {
      containerId,
      containerName,
      project,
      service,
      cpuPercent: Math.round(cpuPercent * 10) / 10,
      memoryUsageBytes: usageBytes,
      memoryLimitBytes: raw.memory_stats.limit,
      memoryPercent: Math.round(memoryPercent * 10) / 10,
      collectedAt: new Date().toISOString()
    };
    latestStats.set(containerId, snap);
    await sendAlert(snap);
  } catch {
    // Container có thể đã stop — bỏ qua
    latestStats.delete(containerId);
  }
}

async function maybeSendMemoryAlert(snap: ContainerStatsSnapshot): Promise<void> {
  if (snap.memoryPercent < env.CONTAINER_MEMORY_ALERT_THRESHOLD) return;
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_ERROR_ALERTS_ENABLED) return;
  if (silenceManager.isSilenced(snap.project, snap.service)) return;

  const now = Date.now();
  const last = memoryAlertCooldowns.get(snap.containerId) ?? 0;
  if (now - last < MEMORY_ALERT_COOLDOWN_MS) return;
  memoryAlertCooldowns.set(snap.containerId, now);

  const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(0)} MB`;
  const lines = [
    `🔴 Memory cao — ${snap.project} / ${snap.service}`,
    `📦 Container: ${snap.containerName}`,
    `💾 Memory: ${snap.memoryPercent.toFixed(1)}% (${mb(snap.memoryUsageBytes)} / ${mb(snap.memoryLimitBytes)})`,
    `🖥️  CPU: ${snap.cpuPercent.toFixed(1)}%`
  ];
  void broadcastText(lines.join("\n"));
}

export function startContainerStatsPoller(
  docker: Docker,
  getRunningContainers: () => Array<{ containerId: string; containerName: string; project: string; service: string }>
): void {
  const poll = async () => {
    const containers = getRunningContainers();
    await Promise.allSettled(
      containers.map((c) => pollOneContainer(docker, c.containerId, c.containerName, c.project, c.service, maybeSendMemoryAlert))
    );
  };

  void poll();
  setInterval(() => void poll(), env.CONTAINER_STATS_INTERVAL_MS);
}
