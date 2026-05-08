import { randomUUID } from "node:crypto";
import { PassThrough } from "node:stream";
import Docker from "dockerode";
import type { ContainerInfo } from "dockerode";
import type { LogEvent } from "@monitor-center/shared";
import { env } from "../config/env.js";
import { resolveProject } from "../config/project-mappings.js";
import { insertLog, upsertContainerState } from "../services/log-repository.js";
import { buildFingerprint } from "../services/fingerprint.js";
import { inferLogLevel, normalizeMessage } from "../services/log-level.js";
import { classifySecurityEvent, parseNginxAccessLog } from "../services/access-log.js";
import { telegramErrorAlerter, sendCrashAlert, sendSpikeAlert } from "../services/telegram-error-alerts.js";
import { spikeDetector } from "../services/spike-detector.js";
import type { RealtimeHub } from "../services/ws-hub.js";

// Docker internal network CIDR: 172.16.0.0/12 covers 172.16–172.31
const DOCKER_INTERNAL_IP_RE = /^172\.(1[6-9]|2\d|3[01])\./;

function shouldSkipLine(line: string, service: string): boolean {
  const trimmed = line.trim();

  // Empty or brace/bracket-only lines (garbage from JSON error printing)
  if (!trimmed || /^[{}[\]]+$/.test(trimmed)) return true;

  // Stack trace continuation lines — context for a previous error, not standalone events
  if (/^\s*at\s+\S/.test(line)) return true;

  // Framework helper lines that follow an error but add no actionable info
  if (/^\s*Read more:\s+https?:\/\//.test(trimmed)) return true;
  if (/^\s*at\s+ignore-listed\s+frames/.test(trimmed)) return true;

  // Postgres operational noise — checkpoint and autovacuum are normal DB maintenance
  if (/postgres/i.test(service)) {
    if (/\bcheckpoint\s+(starting|complete)\b/i.test(trimmed)) return true;
    if (/\bautovacuum\b.*\btable\b/i.test(trimmed)) return true;
  }

  // MySQL deprecated auth plugin warning — fires on every connection, never actionable
  if (/(?:sha256_password|caching_sha2_password).*deprecated/i.test(trimmed)) return true;

  // HTTP access log 200 OK from Docker internal network — these are health checks / uptime
  // pings between containers. A 200 means everything is fine; no anomaly to detect.
  // Non-200 responses from internal IPs are kept because they may indicate misconfiguration.
  const internalAccessMatch = trimmed.match(/^(\d+\.\d+\.\d+\.\d+)\s/);
  if (internalAccessMatch && DOCKER_INTERNAL_IP_RE.test(internalAccessMatch[1])) {
    // Keep 4xx/5xx — repeated identical errors from internal IPs indicate config issues
    if (!/ [45]\d{2} /.test(trimmed)) return true;
  }

  return false;
}

function inferPostgresSeverity(message: string) {
  // Postgres log lines often include "LOG:", "WARNING:", "ERROR:", etc.
  const match = message.match(/\b(LOG|INFO|NOTICE|WARNING|ERROR|FATAL|PANIC):/i);
  if (!match) return null;

  const token = match[1].toUpperCase();
  if (token === "FATAL" || token === "PANIC") return "fatal";
  if (token === "ERROR") return "error";
  if (token === "WARNING") return "warn";
  // LOG/INFO/NOTICE are normal operation.
  return "info";
}

type CollectorDependencies = {
  hub: RealtimeHub;
};

export class DockerCollector {
  #docker: Docker;
  #hub: RealtimeHub;
  #activeStreams = new Map<string, unknown>();
  #prevStates = new Map<string, string>(); // containerId → state
  #containerMeta = new Map<string, { containerId: string; containerName: string; project: string; service: string }>();
  #initialized = false;
  #started = false;

  readonly docker: Docker;

  constructor({ hub }: CollectorDependencies) {
    this.#hub = hub;
    this.#docker = new Docker({ socketPath: env.DOCKER_SOCKET_PATH });
    this.docker = this.#docker;
  }

  async start() {
    if (this.#started) {
      return;
    }

    this.#started = true;
    await this.syncContainers();
    this.#hub.broadcastStatus({ collector: "ready" });
    setInterval(() => {
      void this.syncContainers();
    }, 15_000);
  }

  async syncContainers() {
    let containers: ContainerInfo[] = [];

    try {
      containers = await this.#docker.listContainers({ all: true });
    } catch (error) {
      this.#hub.broadcastStatus({
        collector: "error",
        message: error instanceof Error ? error.message : "Failed to list Docker containers"
      });
      return;
    }

    const seenIds = new Set<string>();

    await Promise.all(
      containers.map(async (containerInfo) => {
        const containerId = containerInfo.Id;
        seenIds.add(containerId);

        const containerName = containerInfo.Names[0]?.replace(/^\//, "") ?? containerId;
        const mapping = resolveProject(containerName, containerInfo.Labels ?? {});
        const currentState = containerInfo.State ?? "unknown";

        await upsertContainerState({
          containerId,
          containerName,
          project: mapping.project,
          service: mapping.service,
          status: containerInfo.Status ?? "unknown",
          state: currentState,
          image: containerInfo.Image,
          startedAt: containerInfo.Created ? new Date(containerInfo.Created * 1000).toISOString() : null,
          labels: containerInfo.Labels ?? {}
        });

        // Phát hiện crash: container chuyển từ running → exited/dead.
        if (this.#initialized) {
          const prevState = this.#prevStates.get(containerId);
          if (prevState === "running" && (currentState === "exited" || currentState === "dead")) {
            const exitCodeMatch = (containerInfo.Status ?? "").match(/Exited \((-?\d+)\)/);
            const exitCode = exitCodeMatch ? Number(exitCodeMatch[1]) : null;
            void sendCrashAlert({
              project: mapping.project,
              service: mapping.service,
              containerName,
              exitCode
            });
          }
        }

        this.#prevStates.set(containerId, currentState);
        this.#containerMeta.set(containerId, { containerId, containerName, project: mapping.project, service: mapping.service });

        if (currentState === "running" && !this.#activeStreams.has(containerId)) {
          await this.attachToLogs(containerId, containerName, mapping.project, mapping.service);
        }
      })
    );

    // Dọn state của container đã biến mất khỏi danh sách.
    for (const id of this.#prevStates.keys()) {
      if (!seenIds.has(id)) {
        this.#prevStates.delete(id);
        this.#containerMeta.delete(id);
      }
    }

    this.#initialized = true;
  }

  getRunningContainers(): Array<{ containerId: string; containerName: string; project: string; service: string }> {
    return Array.from(this.#prevStates.entries())
      .filter(([, state]) => state === "running")
      .map(([containerId]) => {
        // containerName/project/service tracked via activeStreams metadata không có sẵn —
        // dùng lại từ #containerMeta
        return this.#containerMeta.get(containerId) ?? { containerId, containerName: containerId, project: "unknown", service: "unknown" };
      });
  }

  async attachToLogs(containerId: string, containerName: string, project: string, service: string) {
    try {
      const stream = await this.#docker.getContainer(containerId).logs({
        stdout: true,
        stderr: true,
        follow: true,
        since: Math.floor(Date.now() / 1000) - 60,
        tail: 100
      });

      this.#activeStreams.set(containerId, stream);

      const stdoutStream = new PassThrough();
      const stderrStream = new PassThrough();

      // Docker multiplexes stdout/stderr for non-TTY containers.
      // Demux ensures we don't parse binary framing headers as part of log lines.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      (this.#docker as unknown as { modem?: { demuxStream?: (s: unknown, out: unknown, err: unknown) => void } }).modem?.demuxStream?.(
        stream,
        stdoutStream,
        stderrStream
      );

      const handleChunk = (streamType: "stdout" | "stderr", chunk: Buffer) => {
        const lines = chunk
          .toString("utf8")
          .split(/\r?\n/)
          .map((line: string) => normalizeMessage(line))
          .filter(Boolean);

        for (const line of lines) {
          if (shouldSkipLine(line, service)) continue;

          const parsedAccess = parseNginxAccessLog(line);
          const accessMetadata: Record<string, string | number | boolean | null> = {};
          if (parsedAccess) {
            accessMetadata.clientIp = parsedAccess.clientIp;
            accessMetadata.httpMethod = parsedAccess.method;
            accessMetadata.httpPath = parsedAccess.path;
            accessMetadata.httpStatus = parsedAccess.status;
            accessMetadata.httpBytes = parsedAccess.bytes ?? null;
            accessMetadata.httpReferer = parsedAccess.referer ?? null;
            accessMetadata.httpUserAgent = parsedAccess.userAgent ?? null;
          }

          const isSecurity = classifySecurityEvent({
            path: parsedAccess?.path,
            status: parsedAccess?.status,
            userAgent: parsedAccess?.userAgent,
            message: line
          });

          const category = isSecurity ? "security" : "system";
          const baseLevel = inferLogLevel(line, streamType);
          const postgresLevel = /postgres/i.test(service) ? inferPostgresSeverity(line) : null;
          const level = postgresLevel ?? baseLevel;

          const log: LogEvent & { containerId: string; fingerprint: string } = {
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            project,
            service,
            containerName,
            stream: streamType,
            level,
            message: line,
            raw: line,
            source: "docker",
            tags: [project, service, containerName, `category:${category}`],
            metadata: {
              category,
              ...accessMetadata
            },
            containerId,
            fingerprint: buildFingerprint(line)
          };

          void insertLog(log);
          this.#hub.broadcastLog(log);
          void telegramErrorAlerter.maybeSend(log);

          if (level === "error" || level === "fatal") {
            const spike = spikeDetector.record(project, service);
            if (spike.isSpike) {
              void sendSpikeAlert(project, service, spike);
            }
          }
        }
      };

      stdoutStream.on("data", (chunk: Buffer) => handleChunk("stdout", chunk));
      stderrStream.on("data", (chunk: Buffer) => handleChunk("stderr", chunk));

      stream.on("end", () => {
        this.#activeStreams.delete(containerId);
      });

      stream.on("error", () => {
        this.#activeStreams.delete(containerId);
      });
    } catch (error) {
      this.#hub.broadcastStatus({
        collector: "warning",
        message: `Unable to stream logs for ${containerName}: ${error instanceof Error ? error.message : "unknown"}`
      });
    }
  }
}
