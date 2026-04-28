import { randomUUID } from "node:crypto";
import Docker from "dockerode";
import type { ContainerInfo } from "dockerode";
import type { LogEvent } from "@monitor-center/shared";
import { env } from "../config/env.js";
import { resolveProject } from "../config/project-mappings.js";
import { insertLog, upsertContainerState } from "../services/log-repository.js";
import { buildFingerprint } from "../services/fingerprint.js";
import { inferLogLevel, normalizeMessage } from "../services/log-level.js";
import type { RealtimeHub } from "../services/ws-hub.js";

type CollectorDependencies = {
  hub: RealtimeHub;
};

export class DockerCollector {
  #docker: Docker;
  #hub: RealtimeHub;
  #activeStreams = new Map<string, unknown>();
  #started = false;

  constructor({ hub }: CollectorDependencies) {
    this.#hub = hub;
    this.#docker = new Docker({ socketPath: env.DOCKER_SOCKET_PATH });
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

    await Promise.all(
      containers.map(async (containerInfo) => {
        const containerName = containerInfo.Names[0]?.replace(/^\//, "") ?? containerInfo.Id;
        const mapping = resolveProject(containerName, containerInfo.Labels ?? {});
        await upsertContainerState({
          containerId: containerInfo.Id,
          containerName,
          project: mapping.project,
          service: mapping.service,
          status: containerInfo.Status ?? "unknown",
          state: containerInfo.State ?? "unknown",
          image: containerInfo.Image,
          startedAt: containerInfo.Created ? new Date(containerInfo.Created * 1000).toISOString() : null,
          labels: containerInfo.Labels ?? {}
        });

        if (containerInfo.State === "running" && !this.#activeStreams.has(containerInfo.Id)) {
          await this.attachToLogs(containerInfo.Id, containerName, mapping.project, mapping.service);
        }
      })
    );
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
      stream.on("data", (chunk: Buffer) => {
        const lines = chunk
          .toString("utf8")
          .split(/\r?\n/)
          .map((line: string) => normalizeMessage(line))
          .filter(Boolean);

        for (const line of lines) {
          const streamType = line.toLowerCase().includes("stderr") ? "stderr" : "stdout";
          const log: LogEvent & { containerId: string; fingerprint: string } = {
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            project,
            service,
            containerName,
            stream: streamType,
            level: inferLogLevel(line, streamType),
            message: line,
            raw: line,
            source: "docker",
            tags: [project, service, containerName],
            metadata: {},
            containerId,
            fingerprint: buildFingerprint(line)
          };

          void insertLog(log);
          this.#hub.broadcastLog(log);
        }
      });

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
