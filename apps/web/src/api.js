async function request(path, init) {
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
    return response.json();
}
export const api = {
    login: (payload) => request("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(payload)
    }),
    logout: () => request("/api/auth/logout", {
        method: "POST"
    }),
    me: () => request("/api/auth/me"),
    overview: () => request("/api/dashboard/overview"),
    searchLogs: (params) => request(`/api/logs/search?${new URLSearchParams(params).toString()}`),
    askAssistant: (payload) => request("/api/assistant/query", {
        method: "POST",
        body: JSON.stringify(payload)
    }),
    users: () => request("/api/users"),
    createUser: (payload) => request("/api/users", {
        method: "POST",
        body: JSON.stringify(payload)
    })
};
