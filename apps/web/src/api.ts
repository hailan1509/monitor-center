import type { AssistantRequest, DashboardSnapshot, LogEvent, LogPurgeRequest, UserRole } from "@monitor-center/shared";

type User = {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
};

let pendingRequests = 0;
const loadingListeners = new Set<() => void>();

function notifyLoadingListeners() {
  for (const listener of loadingListeners) listener();
}

export const apiLoadingStore = {
  subscribe(listener: () => void) {
    loadingListeners.add(listener);
    return () => loadingListeners.delete(listener);
  },
  getSnapshot() {
    return pendingRequests;
  }
};

type RequestOptions = {
  silent?: boolean;
};

async function request<T>(path: string, init?: RequestInit, options?: RequestOptions): Promise<T> {
  const silent = options?.silent === true;
  if (!silent) {
    pendingRequests += 1;
    notifyLoadingListeners();
  }

  try {
    const response = await fetch(path, {
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {})
      },
      ...init
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "Request failed" }));
      throw new Error(error.error ?? "Request failed");
    }

    return response.json() as Promise<T>;
  } finally {
    if (!silent) {
      pendingRequests = Math.max(0, pendingRequests - 1);
      notifyLoadingListeners();
    }
  }
}

export const api = {
  login: (payload: { email: string; password: string }) =>
    request<{ user: User }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  logout: () =>
    request<{ ok: boolean }>("/api/auth/logout", {
      method: "POST"
    }),
  me: () => request<{ user: User | null }>("/api/auth/me"),
  overview: () => request<DashboardSnapshot>("/api/dashboard/overview"),
  securitySummary: () =>
    request<{
      total24h: number;
      topIps: Array<{ clientIp: string; count: number }>;
      topPaths: Array<{ path: string; count: number }>;
      topUserAgents: Array<{ userAgent: string; count: number }>;
    }>("/api/security/summary"),
  searchLogs: (params: Record<string, string>) =>
    request<{ logs: LogEvent[] }>(`/api/logs/search?${new URLSearchParams(params).toString()}`),
  purgeLogs: (payload: LogPurgeRequest) =>
    request<{ dryRun: boolean; affected: number }>("/api/logs/purge", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  startAssistantJob: (payload: AssistantRequest) =>
    request<{ jobId: string }>("/api/assistant/query", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  getAssistantJob: (jobId: string) =>
    request<{
      id: string;
      status: "queued" | "running" | "done" | "error";
      progress?: string;
      result?: { answer: string; context: Array<Record<string, unknown>> };
      error?: string;
    }>(`/api/assistant/jobs/${encodeURIComponent(jobId)}`, undefined, { silent: true }),
  users: () => request<{ users: Array<User & { createdAt: string }> }>("/api/users"),
  createUser: (payload: { email: string; password: string; displayName: string; role: UserRole }) =>
    request<{ user: { id: string } }>("/api/users", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  listSilences: () =>
    request<{
      silences: Array<{ project: string; service: string | null; expiresAt: number; remainingMs: number }>
    }>("/api/silences"),
  addSilence: (payload: { project: string; service: string | null; durationMs: number }) =>
    request<{ ok: boolean; expiresAt: string }>("/api/silences", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  removeSilence: (payload: { project: string; service: string | null }) =>
    request<{ ok: boolean }>("/api/silences", {
      method: "DELETE",
      body: JSON.stringify(payload)
    })
};
