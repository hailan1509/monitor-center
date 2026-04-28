import { randomUUID } from "node:crypto";
import type { AssistantRequest } from "@monitor-center/shared";
import { answerLogQuestion } from "./assistant-service.js";

export type AssistantJobStatus = "queued" | "running" | "done" | "error";

export type AssistantJob = {
  id: string;
  status: AssistantJobStatus;
  createdAt: number;
  updatedAt: number;
  progress?: string;
  result?: { answer: string; context: Array<Record<string, unknown>> };
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
    progress: "Queued"
  };
  jobs.set(id, job);

  // Fire-and-forget processing.
  void (async () => {
    const current = jobs.get(id);
    if (!current) return;
    current.status = "running";
    current.progress = "Collecting logs";
    current.updatedAt = now();

    try {
      current.progress = "Calling AI model";
      current.updatedAt = now();
      const result = await answerLogQuestion(input);
      current.status = "done";
      current.progress = "Done";
      current.result = result;
      current.updatedAt = now();
    } catch (error) {
      current.status = "error";
      current.progress = "Failed";
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

