import type { AssistantRequest, DashboardSnapshot, LogEvent, UserRole } from "@monitor-center/shared";

type User = {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
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
  searchLogs: (params: Record<string, string>) =>
    request<{ logs: LogEvent[] }>(`/api/logs/search?${new URLSearchParams(params).toString()}`),
  askAssistant: (payload: AssistantRequest) =>
    request<{ answer: string; context: Array<Record<string, unknown>> }>("/api/assistant/query", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  users: () => request<{ users: Array<User & { createdAt: string }> }>("/api/users"),
  createUser: (payload: { email: string; password: string; displayName: string; role: UserRole }) =>
    request<{ user: { id: string } }>("/api/users", {
      method: "POST",
      body: JSON.stringify(payload)
    })
};
