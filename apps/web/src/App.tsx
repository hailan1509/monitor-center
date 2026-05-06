import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import type { DashboardSnapshot, LogEvent, LogPurgeRequest, UserRole } from "@monitor-center/shared";
import { api, apiLoadingStore } from "./api";

type User = {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
};

const emptySnapshot: DashboardSnapshot = {
  projects: [],
  containers: [],
  issues: [],
  recentLogs: []
};

type NavKey = "overview" | "live" | "search" | "issues" | "security" | "assistant" | "containers" | "team" | "silences";

const navItems: Array<{ key: NavKey; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "live", label: "Live Tail" },
  { key: "search", label: "Search" },
  { key: "issues", label: "Issues" },
  { key: "security", label: "Security" },
  { key: "assistant", label: "AI Assistant" },
  { key: "containers", label: "Containers" },
  { key: "team", label: "Team" },
  { key: "silences", label: "Silences" }
];

const navIcons: Record<NavKey, ReactNode> = {
  overview: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M4 13.5c0-.55.45-1 1-1h2c.55 0 1 .45 1 1V19c0 .55-.45 1-1 1H5c-.55 0-1-.45-1-1v-5.5Zm6-6c0-.55.45-1 1-1h2c.55 0 1 .45 1 1V19c0 .55-.45 1-1 1h-2c-.55 0-1-.45-1-1V7.5Zm6 3c0-.55.45-1 1-1h2c.55 0 1 .45 1 1V19c0 .55-.45 1-1 1h-2c-.55 0-1-.45-1-1v-8.5Z"
      />
    </svg>
  ),
  live: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 8a4 4 0 1 1 0 8a4 4 0 0 1 0-8Zm0-5a1 1 0 0 1 1 1v1.06A8.003 8.003 0 0 1 20.94 11H22a1 1 0 1 1 0 2h-1.06A8.003 8.003 0 0 1 13 20.94V22a1 1 0 1 1-2 0v-1.06A8.003 8.003 0 0 1 3.06 13H2a1 1 0 1 1 0-2h1.06A8.003 8.003 0 0 1 11 5.06V4a1 1 0 0 1 1-1Z"
      />
    </svg>
  ),
  search: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M10 4a6 6 0 1 1 0 12a6 6 0 0 1 0-12Zm8.7 13.3a1 1 0 0 1 0 1.4l-.01.01a1 1 0 0 1-1.4 0l-2.52-2.52a8 8 0 1 1 1.4-1.4l2.53 2.53Z"
      />
    </svg>
  ),
  issues: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 2a10 10 0 1 1 0 20a10 10 0 0 1 0-20Zm0 12a1.25 1.25 0 1 0 0 2.5A1.25 1.25 0 0 0 12 14Zm0-8a1 1 0 0 0-1 1v5a1 1 0 1 0 2 0V7a1 1 0 0 0-1-1Z"
      />
    </svg>
  ),
  security: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 2l7 4v6c0 5-3 9-7 10c-4-1-7-5-7-10V6l7-4Zm0 2.3L7 6.7V12c0 4 2.2 7.2 5 8c2.8-.8 5-4 5-8V6.7l-5-2.4Zm0 4.2a1 1 0 0 1 1 1v3.4l1.3 1.3a1 1 0 1 1-1.4 1.4l-1.6-1.6a1 1 0 0 1-.3-.7V9.5a1 1 0 0 1 1-1Z"
      />
    </svg>
  ),
  assistant: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 2a7 7 0 0 1 7 7v3a5 5 0 0 1-5 5h-1.4l-2.3 2.3a1 1 0 0 1-1.7-.7V17H8a5 5 0 0 1-5-5V9a7 7 0 0 1 7-7h2Zm-2.25 9.5a1.25 1.25 0 1 0 0 2.5a1.25 1.25 0 0 0 0-2.5Zm4.5 0a1.25 1.25 0 1 0 0 2.5a1.25 1.25 0 0 0 0-2.5Z"
      />
    </svg>
  ),
  containers: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M3 7a2 2 0 0 1 1.2-1.84l7-3.11a2 2 0 0 1 1.6 0l7 3.11A2 2 0 0 1 21 7v10a2 2 0 0 1-1.2 1.84l-7 3.11a2 2 0 0 1-1.6 0l-7-3.11A2 2 0 0 1 3 17V7Zm2.5.66V17l6.5 2.89V10.6L5.5 7.66Zm8.5 12.23L20.5 17V7.66L14 10.6v9.29ZM12 3.9L6.58 6.3L12 8.83l5.42-2.53L12 3.9Z"
      />
    </svg>
  ),
  team: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M16 11a4 4 0 1 0-8 0a4 4 0 0 0 8 0Zm-13 9a7 7 0 0 1 14 0a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Zm15-9a3 3 0 0 0 0-6a1 1 0 1 0 0 2a1 1 0 1 1 0 2a1 1 0 1 0 0 2Zm3 9a1 1 0 0 1-1 1h-1.5a8.97 8.97 0 0 0-1.43-5.03A5 5 0 0 1 22 20Z"
      />
    </svg>
  ),
  silences: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M5.293 4.293a1 1 0 0 1 1.414 0L12 9.586l5.293-5.293a1 1 0 1 1 1.414 1.414L13.414 11l5.293 5.293a1 1 0 0 1-1.414 1.414L12 12.414l-5.293 5.293a1 1 0 0 1-1.414-1.414L10.586 11 5.293 5.707a1 1 0 0 1 0-1.414Z"
      />
    </svg>
  )
};

const navSections: Array<{ title: string; keys: NavKey[] }> = [
  { title: "Observability", keys: ["overview", "live", "search", "issues", "security", "containers"] },
  { title: "Automation", keys: ["assistant"] },
  { title: "Admin", keys: ["team", "silences"] }
];

function formatShortTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return date.toLocaleString();
}

function levelClass(level: string) {
  const normalized = level.toLowerCase();
  if (normalized === "fatal") return "badge badge-fatal";
  if (normalized === "error") return "badge badge-error";
  if (normalized === "warn") return "badge badge-warn";
  if (normalized === "info") return "badge badge-info";
  if (normalized === "debug") return "badge badge-muted";
  if (normalized === "trace") return "badge badge-muted";
  return "badge badge-muted";
}

const levelOptions = ["", "fatal", "error", "warn", "info", "debug", "trace", "unknown"] as const;
type LevelFilter = (typeof levelOptions)[number];

function matchesLevel(level: string, filter: LevelFilter) {
  if (!filter) return true;
  return level.toLowerCase() === filter;
}

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [nav, setNav] = useState<NavKey>("overview");
  const [showPassword, setShowPassword] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [snapshot, setSnapshot] = useState<DashboardSnapshot>(emptySnapshot);
  const [liveLogs, setLiveLogs] = useState<LogEvent[]>([]);
  const [searchResults, setSearchResults] = useState<LogEvent[]>([]);
  const [assistantAnswer, setAssistantAnswer] = useState("");
  const [assistantStatus, setAssistantStatus] = useState("");
  const [error, setError] = useState("");
  const [filterProject, setFilterProject] = useState("");
  const [filterLevel, setFilterLevel] = useState<LevelFilter>("");
  const [searchText, setSearchText] = useState("");
  const [assistantQuestion, setAssistantQuestion] = useState("Project nào đang lỗi nhiều nhất hôm nay?");
  const [users, setUsers] = useState<Array<User & { createdAt: string }>>([]);
  const [selectedLog, setSelectedLog] = useState<LogEvent | null>(null);
  const [selectedIssue, setSelectedIssue] = useState<DashboardSnapshot["issues"][number] | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [securitySummary, setSecuritySummary] = useState<{
    total24h: number;
    topIps: Array<{ clientIp: string; count: number }>;
    topPaths: Array<{ path: string; count: number }>;
    topUserAgents: Array<{ userAgent: string; count: number }>;
  } | null>(null);
  const [purgePreview, setPurgePreview] = useState<number | null>(null);
  const [purgeStatus, setPurgeStatus] = useState<string>("");
  const [silences, setSilences] = useState<Array<{ project: string; service: string | null; expiresAt: number; remainingMs: number }>>([]);
  const [containerStats, setContainerStats] = useState<Array<{
    containerId: string; containerName: string; project: string; service: string;
    cpuPercent: number; memoryPercent: number; memoryUsageBytes: number; memoryLimitBytes: number;
    collectedAt: string;
  }>>([]);
  const [uptimeChecks, setUptimeChecks] = useState<Array<{
    name: string; url: string; up: boolean;
    statusCode: number | null; latencyMs: number | null;
    lastCheckedAt: string; error: string | null;
  }>>([]);

  const pendingRequests = useSyncExternalStore(apiLoadingStore.subscribe, apiLoadingStore.getSnapshot, () => 0);
  const showLoading = pendingRequests > 0;

  useEffect(() => {
    const stored = window.localStorage.getItem("mc:sidebarCollapsed");
    if (stored === "true") setSidebarCollapsed(true);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("mc:sidebarCollapsed", sidebarCollapsed ? "true" : "false");
  }, [sidebarCollapsed]);

  useEffect(() => {
    void api
      .me()
      .then((response) => {
        setUser(response.user);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!user) {
      return;
    }

    void refreshDashboard();
    void api.securitySummary().then(setSecuritySummary).catch(() => undefined);

    const socket = new WebSocket(`${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws`);
    setWsConnected(socket.readyState === WebSocket.OPEN);
    socket.addEventListener("open", () => setWsConnected(true));
    socket.addEventListener("close", () => setWsConnected(false));
    socket.addEventListener("error", () => setWsConnected(false));
    socket.addEventListener("message", (event) => {
      const data = JSON.parse(event.data) as { type: string; payload: LogEvent };
      if (data.type === "log") {
        setLiveLogs((current) => [data.payload, ...current].slice(0, 200));
      }
    });

    if (user.role === "admin") {
      void api.users().then((response) => setUsers(response.users));
    }

    return () => socket.close();
  }, [user]);

  async function refreshDashboard() {
    const overview = await api.overview();
    setSnapshot(overview);
    setLiveLogs(overview.recentLogs);
    void api.securitySummary().then(setSecuritySummary).catch(() => undefined);
  }

  async function handleLogin(formData: FormData) {
    try {
      setError("");
      const response = await api.login({
        email: String(formData.get("email")),
        password: String(formData.get("password"))
      });
      setUser(response.user);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Login failed");
    }
  }

  async function handleSearch() {
    try {
      const response = await api.searchLogs({
        ...(filterProject ? { project: filterProject } : {}),
        ...(filterLevel ? { level: filterLevel } : {}),
        ...(searchText ? { q: searchText } : {})
      });
      setSearchResults(response.logs);
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : "Search failed");
    }
  }

  async function handleAssistant() {
    try {
      setError("");
      setAssistantAnswer("");
      setAssistantStatus("Queued");

      const started = await api.startAssistantJob({
        question: assistantQuestion,
        ...(filterProject ? { project: filterProject } : {})
      });

      const startedAt = Date.now();
      const pollEveryMs = 900;
      const hardTimeoutMs = 180_000;

      while (true) {
        const job = await api.getAssistantJob(started.jobId);
        setAssistantStatus(job.progress ?? job.status);

        if (job.status === "done" && job.result) {
          setAssistantAnswer(job.result.answer);
          setAssistantStatus("");
          return;
        }

        if (job.status === "error") {
          throw new Error(job.error ?? "Assistant failed");
        }

        if (Date.now() - startedAt > hardTimeoutMs) {
          throw new Error("Assistant is taking too long. Please try again.");
        }

        await new Promise((resolve) => setTimeout(resolve, pollEveryMs));
      }
    } catch (assistantError) {
      setError(assistantError instanceof Error ? assistantError.message : "Assistant failed");
      setAssistantStatus("");
    }
  }

  async function handleCreateUser(formData: FormData) {
    try {
      await api.createUser({
        email: String(formData.get("email")),
        password: String(formData.get("password")),
        displayName: String(formData.get("displayName")),
        role: String(formData.get("role")) as UserRole
      });
      const response = await api.users();
      setUsers(response.users);
    } catch (createUserError) {
      setError(createUserError instanceof Error ? createUserError.message : "Unable to create user");
    }
  }

  async function refreshSilences() {
    const response = await api.listSilences();
    setSilences(response.silences);
  }

  async function handleAddSilence(formData: FormData) {
    try {
      setError("");
      const project = String(formData.get("project") ?? "");
      const service = String(formData.get("service") ?? "").trim() || null;
      const durationMs = Number(formData.get("durationMs"));
      await api.addSilence({ project, service, durationMs });
      await refreshSilences();
    } catch (silenceError) {
      setError(silenceError instanceof Error ? silenceError.message : "Failed to add silence");
    }
  }

  async function handleRemoveSilence(project: string, service: string | null) {
    try {
      await api.removeSilence({ project, service });
      await refreshSilences();
    } catch (silenceError) {
      setError(silenceError instanceof Error ? silenceError.message : "Failed to remove silence");
    }
  }

  async function handlePurgeLogs(formData: FormData) {
    try {
      setError("");
      setPurgeStatus("");

      const payload: LogPurgeRequest = {
        project: String(formData.get("project") ?? "") || undefined,
        category: (String(formData.get("category") ?? "") as "security" | "system") || undefined,
        level: (String(formData.get("level") ?? "") as any) || undefined,
        before: String(formData.get("before") ?? "") || undefined,
        start: String(formData.get("start") ?? "") || undefined,
        end: String(formData.get("end") ?? "") || undefined,
        dryRun: true
      };

      const preview = await api.purgeLogs(payload);
      setPurgePreview(preview.affected);

      if (preview.affected === 0) {
        setPurgeStatus("No logs match the purge filters.");
        return;
      }

      const confirmed = window.confirm(`This will delete ${preview.affected} log rows. Continue?`);
      if (!confirmed) {
        setPurgeStatus("Cancelled.");
        return;
      }

      const result = await api.purgeLogs({ ...payload, dryRun: false });
      setPurgeStatus(`Deleted ${result.affected} logs.`);
      setPurgePreview(null);
      void refreshDashboard();
    } catch (purgeError) {
      setError(purgeError instanceof Error ? purgeError.message : "Unable to purge logs");
    }
  }

  useEffect(() => {
    if (nav === "silences" && user?.role === "admin") void refreshSilences();
    if (nav === "containers" && user) void api.containerStats().then((r) => setContainerStats(r.stats)).catch(() => undefined);
    if ((nav === "overview" || nav === "containers") && user) void api.uptimeChecks().then((r) => setUptimeChecks(r.checks)).catch(() => undefined);
  }, [nav]);

  const topProject = useMemo(() => snapshot.projects[0]?.project ?? "No project yet", [snapshot.projects]);
  const allProjects = useMemo(() => {
    const set = new Set<string>();
    for (const container of snapshot.containers) set.add(container.project);
    for (const project of snapshot.projects) set.add(project.project);
    return Array.from(set).sort();
  }, [snapshot]);

  const visibleLiveLogs = useMemo(() => {
    return liveLogs
      .filter((log) => (filterProject ? log.project === filterProject : true))
      .filter((log) => matchesLevel(log.level, filterLevel));
  }, [liveLogs, filterProject, filterLevel]);

  if (!user) {
    return (
      <main className="login-shell">
        {showLoading ? (
          <div className="global-loading-overlay" role="status" aria-live="polite" aria-label="Loading">
            <div className="global-loading-card">
              <div className="spinner" />
              <div className="global-loading-text">Loading…</div>
            </div>
          </div>
        ) : null}
        <section className="login-hero" aria-hidden="true">
          <div className="login-hero-mark">MC</div>
          <div className="login-hero-title">Monitor Center</div>
          <div className="login-hero-subtitle">Logs & Observability for Docker workloads</div>
          <div className="login-hero-footnote">Secure access for your internal dashboard.</div>
        </section>
        <form
          className="panel login-card"
          onSubmit={(event) => {
            event.preventDefault();
            void handleLogin(new FormData(event.currentTarget));
          }}
        >
          <div className="login-card-head">
            <h1>Sign in</h1>
            <p>Use your admin account to access the dashboard.</p>
          </div>
          <label className="field">
            <div className="field-label">Email</div>
            <input name="email" type="email" autoComplete="username" placeholder="you@company.com" required />
          </label>
          <label className="field">
            <div className="field-label">Password</div>
            <input
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              placeholder="Your password"
              required
            />
          </label>
          <label className="login-show-password">
            <input type="checkbox" checked={showPassword} onChange={(event) => setShowPassword(event.target.checked)} />
            Show password
          </label>
          {error ? <div className="error">{error}</div> : null}
          <button type="submit" className="button login-submit">
            Login
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className={sidebarCollapsed ? "layout layout-collapsed" : "layout"}>
      {showLoading ? (
        <div className="global-loading-overlay" role="status" aria-live="polite" aria-label="Loading">
          <div className="global-loading-card">
            <div className="spinner" />
            <div className="global-loading-text">Loading…</div>
          </div>
        </div>
      ) : null}
      <aside className={sidebarCollapsed ? "sidebar sidebar-collapsed" : "sidebar"}>
        <div className="brand">
          <div className="brand-mark">MC</div>
          <div className="brand-text">
            <div className="brand-title">Monitor Center</div>
            <div className="brand-subtitle">Logs & Observability</div>
          </div>
          <button
            type="button"
            className="icon-button brand-toggle"
            onClick={() => setSidebarCollapsed((value) => !value)}
            aria-label={sidebarCollapsed ? "Expand menu" : "Collapse menu"}
            title={sidebarCollapsed ? "Expand menu" : "Collapse menu"}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="currentColor"
                d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6Zm6 0H6v12h4V6Zm2 0v12h6V6h-6Z"
              />
            </svg>
          </button>
        </div>

        <nav className="menu">
          {navSections.map((section) => (
            <div key={section.title} className="menu-section">
              <div className="menu-section-title">{section.title}</div>
              <div className="menu-section-items">
                {section.keys
                  .filter((key) => (key === "team" || key === "silences" ? user.role === "admin" : true))
                  .map((key) => {
                    const item = navItems.find((candidate) => candidate.key === key);
                    if (!item) return null;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        className={nav === item.key ? "menu-item active" : "menu-item"}
                        onClick={() => setNav(item.key)}
                        title={sidebarCollapsed ? item.label : undefined}
                      >
                        <span className="menu-item-icon">{navIcons[item.key]}</span>
                        <span className="menu-item-label">{item.label}</span>
                      </button>
                    );
                  })}
              </div>
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="user-pill">
            <div className="user-name">{user.displayName}</div>
            <div className="user-meta">
              <span className="badge badge-muted">{user.role}</span>
              <span className="muted">{user.email}</span>
            </div>
          </div>
          <button
            type="button"
            className="button button-ghost"
            onClick={() => {
              void api.logout().then(() => setUser(null));
            }}
          >
            Logout
          </button>
        </div>
      </aside>

      <section className="content">
        <header className="content-header">
          <div>
            <h1 className="page-title">{navItems.find((item) => item.key === nav)?.label}</h1>
            <p className="page-subtitle">Focus: {topProject}</p>
          </div>
          <div className="header-actions">
            <div className={wsConnected ? "status-pill status-pill-ok" : "status-pill status-pill-muted"} title="WebSocket status">
              <span className="status-dot" aria-hidden="true" />
              {wsConnected ? "Realtime connected" : "Realtime offline"}
            </div>
            <select
              aria-label="Project filter"
              value={filterProject}
              onChange={(event) => setFilterProject(event.target.value)}
              className="header-select"
            >
              <option value="">All projects</option>
              {allProjects.map((project) => (
                <option key={project} value={project}>
                  {project}
                </option>
              ))}
            </select>
            <button type="button" className="button" onClick={() => void refreshDashboard()}>
              Refresh
            </button>
          </div>
        </header>

        {error ? <div className="callout callout-error">{error}</div> : null}

        {nav === "overview" ? (
          <>
            <section className="grid cards">
              {snapshot.projects.map((project: DashboardSnapshot["projects"][number]) => (
                <article key={project.project} className="card">
                  <div className="card-title">{project.project}</div>
                  <div className="card-metrics">
                    <div className="metric">
                      <div className="metric-label">Containers</div>
                      <div className="metric-value">
                        {project.healthyContainers}/{project.containerCount}
                      </div>
                    </div>
                    <div className="metric">
                      <div className="metric-label">Errors (24h)</div>
                      <div className="metric-value metric-danger">{project.errorCount24h}</div>
                    </div>
                    <div className="metric">
                      <div className="metric-label">Warnings (24h)</div>
                      <div className="metric-value metric-warn">{project.warnCount24h}</div>
                    </div>
                  </div>
                  <div className="muted small">Last log: {project.lastLogAt ? formatShortTime(project.lastLogAt) : "—"}</div>
                </article>
              ))}
            </section>

            {uptimeChecks.length > 0 ? (
              <section className="panel">
                <div className="panel-head">
                  <h2 className="panel-title">Uptime checks</h2>
                  <div className="muted small">{uptimeChecks.filter((c) => c.up).length}/{uptimeChecks.length} up</div>
                </div>
                <div className="table">
                  {uptimeChecks.map((check) => (
                    <div key={check.name} className="row">
                      <div className="cell level">
                        <span className={check.up ? "badge badge-ok" : "badge badge-error"}>{check.up ? "UP" : "DOWN"}</span>
                      </div>
                      <div className="cell project">{check.name}</div>
                      <div className="cell message muted small">{check.url}</div>
                      <div className="cell time muted small">
                        {check.up ? `${check.latencyMs}ms` : (check.error ?? `HTTP ${check.statusCode}`)}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="grid two">
              <article className="panel">
                <div className="panel-head">
                  <h2 className="panel-title">Recent logs</h2>
                  <div className="muted small">Realtime via WebSocket</div>
                </div>
                <div className="table table-scroll log-table">
                  {visibleLiveLogs.slice(0, 80).map((log) => (
                    <button
                      key={`${log.id}-${log.timestamp}`}
                      type="button"
                      className="row row-button"
                      onClick={() => setSelectedLog(log)}
                    >
                      <div className="cell time">{formatShortTime(log.timestamp)}</div>
                      <div className="cell project">{log.project}</div>
                      <div className="cell container">{log.containerName}</div>
                      <div className="cell level">
                        <span className={levelClass(log.level)}>{log.level}</span>
                      </div>
                      <div className="cell message">{log.message}</div>
                    </button>
                  ))}
                </div>
              </article>

              <article className="panel">
                <div className="panel-head">
                  <h2 className="panel-title">Top issues (24h)</h2>
                  <div className="muted small">Grouped by fingerprint</div>
                </div>
                <div className="table table-scroll issue-table">
                  {snapshot.issues.map((issue: DashboardSnapshot["issues"][number]) => (
                    <button
                      key={issue.fingerprint}
                      type="button"
                      className="row row-button"
                      onClick={() => setSelectedIssue(issue)}
                    >
                      <div className="cell project">{issue.project}</div>
                      <div className="cell level">
                        <span className={levelClass(issue.level)}>{issue.level}</span>
                      </div>
                      <div className="cell count">{issue.count}</div>
                      <div className="cell message">{issue.sampleMessage}</div>
                    </button>
                  ))}
                </div>
              </article>
            </section>
          </>
        ) : null}

        {nav === "live" ? (
          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">Live Tail</h2>
              <div className="filters">
                <select value={filterProject} onChange={(event) => setFilterProject(event.target.value)}>
                  <option value="">All projects</option>
                  {allProjects.map((project) => (
                    <option key={project} value={project}>
                      {project}
                    </option>
                  ))}
                </select>
                <select value={filterLevel} onChange={(event) => setFilterLevel(event.target.value as LevelFilter)}>
                  <option value="">All levels</option>
                  {levelOptions
                    .filter((value) => value)
                    .map((level) => (
                      <option key={level} value={level}>
                        {level}
                      </option>
                    ))}
                </select>
              </div>
            </div>
            <div className="table log-table">
              {visibleLiveLogs.slice(0, 200).map((log) => (
                <button
                  key={`${log.id}-${log.timestamp}`}
                  type="button"
                  className="row row-button"
                  onClick={() => setSelectedLog(log)}
                >
                    <div className="cell time">{formatShortTime(log.timestamp)}</div>
                    <div className="cell project">{log.project}</div>
                    <div className="cell container">{log.containerName}</div>
                    <div className="cell level">
                      <span className={levelClass(log.level)}>{log.level}</span>
                    </div>
                    <div className="cell message">{log.message}</div>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {nav === "search" ? (
          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">Search logs</h2>
              <div className="filters">
                <select value={filterProject} onChange={(event) => setFilterProject(event.target.value)}>
                  <option value="">All projects</option>
                  {allProjects.map((project) => (
                    <option key={project} value={project}>
                      {project}
                    </option>
                  ))}
                </select>
                <select value={filterLevel} onChange={(event) => setFilterLevel(event.target.value as LevelFilter)}>
                  <option value="">All levels</option>
                  {levelOptions
                    .filter((value) => value)
                    .map((level) => (
                      <option key={level} value={level}>
                        {level}
                      </option>
                    ))}
                </select>
                <input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="keyword, error, status code..." />
                <button type="button" className="button" onClick={() => void handleSearch()}>
                  Search
                </button>
              </div>
            </div>

            <div className="table log-table">
              {searchResults.map((log) => (
                <button key={log.id} type="button" className="row row-button" onClick={() => setSelectedLog(log)}>
                  <div className="cell time">{formatShortTime(log.timestamp)}</div>
                  <div className="cell project">{log.project}</div>
                  <div className="cell container">{log.containerName}</div>
                  <div className="cell level">
                    <span className={levelClass(log.level)}>{log.level}</span>
                  </div>
                  <div className="cell message">{log.message}</div>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {nav === "issues" ? (
          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">Issues</h2>
              <div className="filters">
                <select value={filterProject} onChange={(event) => setFilterProject(event.target.value)}>
                  <option value="">All projects</option>
                  {allProjects.map((project) => (
                    <option key={project} value={project}>
                      {project}
                    </option>
                  ))}
                </select>
                <select value={filterLevel} onChange={(event) => setFilterLevel(event.target.value as LevelFilter)}>
                  <option value="">All levels</option>
                  {levelOptions
                    .filter((value) => value)
                    .map((level) => (
                      <option key={level} value={level}>
                        {level}
                      </option>
                    ))}
                </select>
                <div className="muted small">Most frequent fingerprints in the last 24h</div>
              </div>
            </div>
            <div className="table issue-table">
              {snapshot.issues
                .filter((issue: DashboardSnapshot["issues"][number]) => (filterProject ? issue.project === filterProject : true))
                .filter((issue: DashboardSnapshot["issues"][number]) => matchesLevel(issue.level, filterLevel))
                .map((issue: DashboardSnapshot["issues"][number]) => (
                <button
                  key={issue.fingerprint}
                  type="button"
                  className="row row-button"
                  onClick={() => setSelectedIssue(issue)}
                >
                  <div className="cell project">{issue.project}</div>
                  <div className="cell level">
                    <span className={levelClass(issue.level)}>{issue.level}</span>
                  </div>
                  <div className="cell count">{issue.count}</div>
                  <div className="cell time">{formatShortTime(issue.lastSeenAt)}</div>
                  <div className="cell message">{issue.sampleMessage}</div>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {nav === "security" ? (
          <section className="grid two">
            <article className="panel">
              <div className="panel-head">
                <h2 className="panel-title">Security events (24h)</h2>
                <div className="muted small">Noise reduction: scanners, probes, auth failures</div>
              </div>
              <div className="card-metrics">
                <div className="metric">
                  <div className="metric-label">Total events</div>
                  <div className="metric-value">{securitySummary?.total24h ?? "—"}</div>
                </div>
              </div>
              <div className="muted small">
                Tip: Chặn ở Nginx Proxy Manager (block `/xmlrpc.php`, `/.env`, `/.git`) + rate-limit `/api/auth/login`.
              </div>
            </article>

            <article className="panel">
              <div className="panel-head">
                <h2 className="panel-title">Top IPs</h2>
                <div className="muted small">Last 24h</div>
              </div>
              <div className="table">
                {(securitySummary?.topIps ?? []).map((row) => (
                  <div key={row.clientIp} className="row">
                    <div className="cell project">{row.clientIp}</div>
                    <div className="cell count">{row.count}</div>
                  </div>
                ))}
              </div>
            </article>

            <article className="panel">
              <div className="panel-head">
                <h2 className="panel-title">Top paths</h2>
                <div className="muted small">Last 24h</div>
              </div>
              <div className="table">
                {(securitySummary?.topPaths ?? []).map((row) => (
                  <div key={row.path} className="row">
                    <div className="cell message">{row.path}</div>
                    <div className="cell count">{row.count}</div>
                  </div>
                ))}
              </div>
            </article>

            <article className="panel">
              <div className="panel-head">
                <h2 className="panel-title">Top user agents</h2>
                <div className="muted small">Last 24h</div>
              </div>
              <div className="table">
                {(securitySummary?.topUserAgents ?? []).map((row) => (
                  <div key={row.userAgent} className="row">
                    <div className="cell message">{row.userAgent}</div>
                    <div className="cell count">{row.count}</div>
                  </div>
                ))}
              </div>
            </article>
          </section>
        ) : null}

        {nav === "assistant" ? (
          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">AI Assistant</h2>
              <div className="filters">
                <select value={filterProject} onChange={(event) => setFilterProject(event.target.value)}>
                  <option value="">All projects</option>
                  {allProjects.map((project) => (
                    <option key={project} value={project}>
                      {project}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="assistant-grid">
              <div className="assistant-input">
                <label className="field">
                  <div className="field-label">Question</div>
                  <textarea value={assistantQuestion} onChange={(event) => setAssistantQuestion(event.target.value)} rows={6} />
                </label>
                <button type="button" className="button" onClick={() => void handleAssistant()}>
                  Ask
                </button>
                <div className="muted small">
                  Tip: hỏi theo dạng “web nào lỗi 500 nhiều nhất?”, “container nào restart bất thường?”, “lỗi nào tăng đột biến trong 1h qua?”
                </div>
              </div>
              <div className="assistant-output">
                <div className="field-label">Answer</div>
                {assistantStatus ? <div className="muted small">Status: {assistantStatus}</div> : null}
                <pre className="assistant-answer">{assistantAnswer || "—"}</pre>
              </div>
            </div>
          </section>
        ) : null}

        {nav === "containers" ? (
          <>
            {uptimeChecks.length > 0 ? (
              <section className="panel">
                <div className="panel-head">
                  <h2 className="panel-title">Uptime checks</h2>
                  <div className="muted small">{uptimeChecks.filter((c) => c.up).length}/{uptimeChecks.length} up</div>
                </div>
                <div className="table">
                  {uptimeChecks.map((check) => (
                    <div key={check.name} className="row">
                      <div className="cell level">
                        <span className={check.up ? "badge badge-ok" : "badge badge-error"}>{check.up ? "UP" : "DOWN"}</span>
                      </div>
                      <div className="cell project">{check.name}</div>
                      <div className="cell message muted small">{check.url}</div>
                      <div className="cell time muted small">
                        {check.up ? `${check.latencyMs}ms` : (check.error ?? `HTTP ${check.statusCode}`)}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="panel">
              <div className="panel-head">
                <h2 className="panel-title">Containers</h2>
                <div className="muted small">Collected from Docker Engine</div>
              </div>
              <div className="table container-table">
                {snapshot.containers.map((container: DashboardSnapshot["containers"][number]) => {
                  const stats = containerStats.find((s) => s.containerName === container.containerName);
                  return (
                    <div key={container.containerId} className="row">
                      <div className="cell project">{container.project}</div>
                      <div className="cell container">{container.containerName}</div>
                      <div className="cell level">
                        <span className={container.state === "running" ? "badge badge-ok" : "badge badge-muted"}>{container.state}</span>
                      </div>
                      {stats ? (
                        <>
                          <div className="cell muted small" title="CPU">
                            CPU {stats.cpuPercent.toFixed(1)}%
                          </div>
                          <div
                            className="cell muted small"
                            title="Memory"
                            style={{ color: stats.memoryPercent >= 90 ? "var(--color-error, #e53)" : undefined }}
                          >
                            MEM {stats.memoryPercent.toFixed(1)}%
                          </div>
                        </>
                      ) : (
                        <div className="cell muted small">—</div>
                      )}
                      <div className="cell message">{container.image}</div>
                    </div>
                  );
                })}
              </div>
            </section>
          </>
        ) : null}

        {nav === "team" && user.role === "admin" ? (
          <section className="grid two">
            <article className="panel">
              <div className="panel-head">
                <h2 className="panel-title">Create user</h2>
                <div className="muted small">Admin only</div>
              </div>
              <form
                className="form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleCreateUser(new FormData(event.currentTarget));
                }}
              >
                <label className="field">
                  <div className="field-label">Display name</div>
                  <input name="displayName" placeholder="Display name" required />
                </label>
                <label className="field">
                  <div className="field-label">Email</div>
                  <input name="email" type="email" placeholder="Email" required />
                </label>
                <label className="field">
                  <div className="field-label">Password</div>
                  <input name="password" type="password" placeholder="Password" required />
                </label>
                <label className="field">
                  <div className="field-label">Role</div>
                  <select name="role" defaultValue="viewer">
                    <option value="viewer">viewer</option>
                    <option value="admin">admin</option>
                  </select>
                </label>
                <button type="submit" className="button">
                  Create user
                </button>
              </form>
            </article>

            <article className="panel">
              <div className="panel-head">
                <h2 className="panel-title">Users</h2>
                <div className="muted small">{users.length} accounts</div>
              </div>
              <div className="table user-table">
                {users.map((teamUser) => (
                  <div key={teamUser.id} className="row">
                    <div className="cell project">{teamUser.displayName}</div>
                    <div className="cell level">
                      <span className="badge badge-muted">{teamUser.role}</span>
                    </div>
                    <div className="cell message">{teamUser.email}</div>
                    <div className="cell time">{formatShortTime(teamUser.createdAt)}</div>
                  </div>
                ))}
              </div>
            </article>

            <article className="panel">
              <div className="panel-head">
                <h2 className="panel-title">Log cleanup</h2>
                <div className="muted small">Admin only (deletes rows in DB)</div>
              </div>
              <form
                className="form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handlePurgeLogs(new FormData(event.currentTarget));
                }}
              >
                <div className="filters">
                  <select name="project" defaultValue="">
                    <option value="">All projects</option>
                    {allProjects.map((project) => (
                      <option key={project} value={project}>
                        {project}
                      </option>
                    ))}
                  </select>
                  <select name="category" defaultValue="">
                    <option value="">All categories</option>
                    <option value="system">system</option>
                    <option value="security">security</option>
                  </select>
                  <select name="level" defaultValue="">
                    <option value="">All levels</option>
                    {levelOptions
                      .filter((value) => value)
                      .map((level) => (
                        <option key={level} value={level}>
                          {level}
                        </option>
                      ))}
                  </select>
                </div>

                <div className="filters">
                  <input
                    name="before"
                    placeholder="before (ISO), e.g. 2026-04-29T00:00:00Z"
                    inputMode="text"
                    aria-label="Before timestamp"
                  />
                  <input name="start" placeholder="start (ISO)" inputMode="text" aria-label="Start timestamp" />
                  <input name="end" placeholder="end (ISO)" inputMode="text" aria-label="End timestamp" />
                </div>

                <button type="submit" className="button">
                  Preview & Delete
                </button>
                {purgePreview !== null ? <div className="muted small">Preview: {purgePreview} rows match.</div> : null}
                {purgeStatus ? <div className="muted small">{purgeStatus}</div> : null}
              </form>
            </article>
          </section>
        ) : null}

        {nav === "silences" && user.role === "admin" ? (
          <section className="grid two">
            <article className="panel">
              <div className="panel-head">
                <h2 className="panel-title">Thêm silence</h2>
                <div className="muted small">Tắt alert trong thời gian bảo trì / deploy</div>
              </div>
              <form
                className="form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleAddSilence(new FormData(event.currentTarget));
                  event.currentTarget.reset();
                }}
              >
                <label className="field">
                  <div className="field-label">Project</div>
                  <select name="project" required defaultValue="">
                    <option value="" disabled>Chọn project</option>
                    {allProjects.map((project) => (
                      <option key={project} value={project}>{project}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <div className="field-label">Service (để trống = cả project)</div>
                  <input name="service" placeholder="vd: api, nginx, worker..." />
                </label>
                <label className="field">
                  <div className="field-label">Thời gian</div>
                  <select name="durationMs" defaultValue="600000">
                    <option value="600000">10 phút</option>
                    <option value="1800000">30 phút</option>
                    <option value="3600000">1 giờ</option>
                    <option value="7200000">2 giờ</option>
                    <option value="28800000">8 giờ</option>
                    <option value="86400000">24 giờ</option>
                  </select>
                </label>
                <button type="submit" className="button">Thêm silence</button>
              </form>
            </article>

            <article className="panel">
              <div className="panel-head">
                <h2 className="panel-title">Đang active</h2>
                <div className="muted small">{silences.length} silence(s)</div>
              </div>
              {silences.length === 0 ? (
                <div className="muted small">Không có silence nào đang active.</div>
              ) : (
                <div className="table">
                  {silences.map((s) => (
                    <div key={`${s.project}::${s.service ?? "*"}`} className="row">
                      <div className="cell project">{s.project}</div>
                      <div className="cell container">{s.service ?? "* (cả project)"}</div>
                      <div className="cell time muted small">
                        còn {Math.ceil(s.remainingMs / 60000)} phút
                      </div>
                      <div className="cell">
                        <button
                          type="button"
                          className="button button-ghost"
                          onClick={() => void handleRemoveSilence(s.project, s.service)}
                        >
                          Xoá
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </article>
          </section>
        ) : null}

        {selectedLog ? (
          <div
            className="modal-overlay"
            role="button"
            tabIndex={0}
            onClick={() => setSelectedLog(null)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setSelectedLog(null);
            }}
          >
            <div
              className="modal"
              role="dialog"
              aria-modal="true"
              onClick={(event) => {
                event.stopPropagation();
              }}
            >
              <div className="modal-head">
                <div className="modal-title">Log detail</div>
                <button type="button" className="button button-ghost" onClick={() => setSelectedLog(null)}>
                  Close
                </button>
              </div>
              <div className="modal-body">
                <div className="kv">
                  <div className="k">Timestamp</div>
                  <div className="v">{formatShortTime(selectedLog.timestamp)}</div>
                  <div className="k">Project</div>
                  <div className="v">{selectedLog.project}</div>
                  <div className="k">Container</div>
                  <div className="v">{selectedLog.containerName}</div>
                  <div className="k">Service</div>
                  <div className="v">{selectedLog.service}</div>
                  <div className="k">Level</div>
                  <div className="v">
                    <span className={levelClass(selectedLog.level)}>{selectedLog.level}</span>
                  </div>
                  <div className="k">Stream</div>
                  <div className="v">{selectedLog.stream}</div>
                </div>
                <div className="divider" />
                <div className="field-label">Message</div>
                <pre className="code-block">{selectedLog.message}</pre>
                <div className="field-label">Raw</div>
                <pre className="code-block">{selectedLog.raw}</pre>
                <div className="field-label">Metadata</div>
                <pre className="code-block">{JSON.stringify(selectedLog.metadata ?? {}, null, 2)}</pre>
              </div>
            </div>
          </div>
        ) : null}

        {selectedIssue ? (
          <div
            className="modal-overlay"
            role="button"
            tabIndex={0}
            onClick={() => setSelectedIssue(null)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setSelectedIssue(null);
            }}
          >
            <div
              className="modal"
              role="dialog"
              aria-modal="true"
              onClick={(event) => {
                event.stopPropagation();
              }}
            >
              <div className="modal-head">
                <div className="modal-title">Issue detail</div>
                <button type="button" className="button button-ghost" onClick={() => setSelectedIssue(null)}>
                  Close
                </button>
              </div>
              <div className="modal-body">
                <div className="kv">
                  <div className="k">Project</div>
                  <div className="v">{selectedIssue.project}</div>
                  <div className="k">Service</div>
                  <div className="v">{selectedIssue.service}</div>
                  <div className="k">Level</div>
                  <div className="v">
                    <span className={levelClass(selectedIssue.level)}>{selectedIssue.level}</span>
                  </div>
                  <div className="k">Count (24h)</div>
                  <div className="v">{selectedIssue.count}</div>
                  <div className="k">Last seen</div>
                  <div className="v">{formatShortTime(selectedIssue.lastSeenAt)}</div>
                </div>
                <div className="divider" />
                <div className="field-label">Fingerprint</div>
                <pre className="code-block">{selectedIssue.fingerprint}</pre>
                <div className="field-label">Sample message</div>
                <pre className="code-block">{selectedIssue.sampleMessage}</pre>
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}
