import { useEffect, useMemo, useState } from "react";
import type { DashboardSnapshot, LogEvent, UserRole } from "@monitor-center/shared";
import { api } from "./api";

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

type NavKey = "overview" | "live" | "search" | "issues" | "assistant" | "containers" | "team";

const navItems: Array<{ key: NavKey; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "live", label: "Live Tail" },
  { key: "search", label: "Search" },
  { key: "issues", label: "Issues" },
  { key: "assistant", label: "AI Assistant" },
  { key: "containers", label: "Containers" },
  { key: "team", label: "Team" }
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
  const [snapshot, setSnapshot] = useState<DashboardSnapshot>(emptySnapshot);
  const [liveLogs, setLiveLogs] = useState<LogEvent[]>([]);
  const [searchResults, setSearchResults] = useState<LogEvent[]>([]);
  const [assistantAnswer, setAssistantAnswer] = useState("");
  const [error, setError] = useState("");
  const [filterProject, setFilterProject] = useState("");
  const [filterLevel, setFilterLevel] = useState<LevelFilter>("");
  const [searchText, setSearchText] = useState("");
  const [assistantQuestion, setAssistantQuestion] = useState("Project nào đang lỗi nhiều nhất hôm nay?");
  const [users, setUsers] = useState<Array<User & { createdAt: string }>>([]);
  const [selectedLog, setSelectedLog] = useState<LogEvent | null>(null);
  const [selectedIssue, setSelectedIssue] = useState<DashboardSnapshot["issues"][number] | null>(null);

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

    const socket = new WebSocket(`${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws`);
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
      const response = await api.askAssistant({
        question: assistantQuestion,
        ...(filterProject ? { project: filterProject } : {})
      });
      setAssistantAnswer(response.answer);
    } catch (assistantError) {
      setError(assistantError instanceof Error ? assistantError.message : "Assistant failed");
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
        <form
          className="panel login-card"
          onSubmit={(event) => {
            event.preventDefault();
            void handleLogin(new FormData(event.currentTarget));
          }}
        >
          <h1>Monitor Center</h1>
          <p>Internal log observability for your Docker workloads.</p>
          <label>
            Email
            <input name="email" type="email" defaultValue="admin@monitor.local" required />
          </label>
          <label>
            Password
            <input name="password" type="password" defaultValue="admin123!" required />
          </label>
          {error ? <div className="error">{error}</div> : null}
          <button type="submit">Login</button>
        </form>
      </main>
    );
  }

  return (
    <main className="layout">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">MC</div>
          <div className="brand-text">
            <div className="brand-title">Monitor Center</div>
            <div className="brand-subtitle">Logs & Observability</div>
          </div>
        </div>

        <nav className="menu">
          {navItems
            .filter((item) => (item.key === "team" ? user.role === "admin" : true))
            .map((item) => (
              <button
                key={item.key}
                type="button"
                className={nav === item.key ? "menu-item active" : "menu-item"}
                onClick={() => setNav(item.key)}
              >
                {item.label}
              </button>
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
            <button type="button" className="button" onClick={() => void refreshDashboard()}>
              Refresh
            </button>
          </div>
        </header>

        {error ? <div className="callout callout-error">{error}</div> : null}

        {nav === "overview" ? (
          <>
            <section className="grid cards">
              {snapshot.projects.map((project) => (
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

            <section className="grid two">
              <article className="panel">
                <div className="panel-head">
                  <h2 className="panel-title">Recent logs</h2>
                  <div className="muted small">Realtime via WebSocket</div>
                </div>
                <div className="table log-table">
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
                <div className="table issue-table">
                  {snapshot.issues.map((issue) => (
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
                .filter((issue) => (filterProject ? issue.project === filterProject : true))
                .filter((issue) => matchesLevel(issue.level, filterLevel))
                .map((issue) => (
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
                <pre className="assistant-answer">{assistantAnswer || "—"}</pre>
              </div>
            </div>
          </section>
        ) : null}

        {nav === "containers" ? (
          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">Containers</h2>
              <div className="muted small">Collected from Docker Engine</div>
            </div>
            <div className="table container-table">
              {snapshot.containers.map((container) => (
                <div key={container.containerId} className="row">
                  <div className="cell project">{container.project}</div>
                  <div className="cell container">{container.containerName}</div>
                  <div className="cell level">
                    <span className={container.state === "running" ? "badge badge-ok" : "badge badge-muted"}>{container.state}</span>
                  </div>
                  <div className="cell message">{container.image}</div>
                </div>
              ))}
            </div>
          </section>
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
