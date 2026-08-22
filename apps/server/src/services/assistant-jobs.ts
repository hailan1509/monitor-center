import { randomUUID } from "node:crypto";
import type { AssistantRequest } from "@monitor-center/shared";
import { answerAssistantQuestion, getToolProgressLabel } from "./assistant-agent.js";

export type AssistantJobStatus = "queued" | "running" | "done" | "error";

export type AssistantJob = {
  id: string;
  status: AssistantJobStatus;
  createdAt: number;
  updatedAt: number;
  progress?: string;
  result?: { answer: string };
  error?: string;
};

const jobs = new Map<string, AssistantJob>();
const JOB_TTL_MS = 30 * 60 * 1000;

function now() {
  return Date.now();
}

export function createAssistantJob(input: AssistantRequest) {
  const id = randomUUID();
  const job: AssistantJob = {
    id,
    status: "queued",
    createdAt: now(),
    updatedAt: now(),
    progress: "Đang xếp hàng…"
  };
  jobs.set(id, job);

  // Fire-and-forget processing.
  void (async () => {
    const current = jobs.get(id);
    if (!current) return;
    current.status = "running";
    current.progress = "Đang suy nghĩ…";
    current.updatedAt = now();

    try {
      const result = await answerAssistantQuestion({
        ...input,
        onToolCall: (toolName) => {
          const job = jobs.get(id);
          if (!job) return;
          job.progress = getToolProgressLabel(toolName);
          job.updatedAt = now();
        }
      });
      current.status = "done";
      current.progress = "Xong";
      current.result = result;
      current.updatedAt = now();
    } catch (error) {
      current.status = "error";
      current.progress = "Thất bại";
      current.error = error instanceof Error ? error.message : "Assistant job failed";
      current.updatedAt = now();
    }
  })();

  // Cleanup after TTL.
  setTimeout(() => {
    jobs.delete(id);
  }, JOB_TTL_MS).unref?.();

  return job;
}

export function getAssistantJob(id: string) {
  return jobs.get(id) ?? null;
}

