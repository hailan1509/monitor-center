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

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [snapshot, setSnapshot] = useState<DashboardSnapshot>(emptySnapshot);
  const [liveLogs, setLiveLogs] = useState<LogEvent[]>([]);
  const [searchResults, setSearchResults] = useState<LogEvent[]>([]);
  const [assistantAnswer, setAssistantAnswer] = useState("");
  const [error, setError] = useState("");
  const [searchProject, setSearchProject] = useState("");
  const [searchText, setSearchText] = useState("");
  const [assistantQuestion, setAssistantQuestion] = useState("Project nào đang lỗi nhiều nhất hôm nay?");
  const [users, setUsers] = useState<Array<User & { createdAt: string }>>([]);

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
        ...(searchProject ? { project: searchProject } : {}),
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
        ...(searchProject ? { project: searchProject } : {})
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
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>Monitor Center</h1>
          <p>{user.displayName} | {user.role} | Focus: {topProject}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            void api.logout().then(() => setUser(null));
          }}
        >
          Logout
        </button>
      </header>

      {error ? <div className="error banner">{error}</div> : null}

      <section className="grid summary-grid">
        {snapshot.projects.map((project) => (
          <article key={project.project} className="panel metric-card">
            <h2>{project.project}</h2>
            <p>{project.healthyContainers}/{project.containerCount} containers healthy</p>
            <p>{project.errorCount24h} errors in 24h</p>
            <p>{project.warnCount24h} warnings in 24h</p>
          </article>
        ))}
      </section>

      <section className="grid two-col">
        <article className="panel">
          <div className="panel-header">
            <h2>Live Tail</h2>
            <button type="button" onClick={() => void refreshDashboard()}>
              Refresh snapshot
            </button>
          </div>
          <div className="log-list">
            {liveLogs.map((log) => (
              <div key={`${log.id}-${log.timestamp}`} className={`log-item level-${log.level}`}>
                <strong>{log.project}</strong>
                <span>{log.containerName}</span>
                <span>{log.level}</span>
                <p>{log.message}</p>
              </div>
            ))}
          </div>
        </article>

        <article className="panel">
          <h2>Search</h2>
          <div className="filters">
            <input value={searchProject} onChange={(event) => setSearchProject(event.target.value)} placeholder="project" />
            <input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="keyword or error code" />
            <button type="button" onClick={() => void handleSearch()}>
              Search logs
            </button>
          </div>
          <div className="log-list compact">
            {searchResults.map((log) => (
              <div key={log.id} className="log-item">
                <strong>{log.timestamp}</strong>
                <span>{log.project}</span>
                <span>{log.level}</span>
                <p>{log.message}</p>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="grid two-col">
        <article className="panel">
          <h2>Issues</h2>
          <div className="issue-list">
            {snapshot.issues.map((issue) => (
              <div key={issue.fingerprint} className="issue-item">
                <strong>{issue.project}</strong>
                <span>{issue.level}</span>
                <span>{issue.count} hits</span>
                <p>{issue.sampleMessage}</p>
              </div>
            ))}
          </div>
        </article>

        <article className="panel">
          <h2>AI Assistant</h2>
          <textarea value={assistantQuestion} onChange={(event) => setAssistantQuestion(event.target.value)} rows={5} />
          <button type="button" onClick={() => void handleAssistant()}>
            Ask about logs
          </button>
          <pre className="assistant-answer">{assistantAnswer}</pre>
        </article>
      </section>

      <section className="grid two-col">
        <article className="panel">
          <h2>Containers</h2>
          <div className="issue-list">
            {snapshot.containers.map((container) => (
              <div key={container.containerId} className="issue-item">
                <strong>{container.containerName}</strong>
                <span>{container.project}</span>
                <span>{container.state}</span>
                <p>{container.image}</p>
              </div>
            ))}
          </div>
        </article>

        {user.role === "admin" ? (
          <article className="panel">
            <h2>Team Access</h2>
            <form
              className="user-form"
              onSubmit={(event) => {
                event.preventDefault();
                void handleCreateUser(new FormData(event.currentTarget));
              }}
            >
              <input name="displayName" placeholder="Display name" required />
              <input name="email" type="email" placeholder="Email" required />
              <input name="password" type="password" placeholder="Password" required />
              <select name="role" defaultValue="viewer">
                <option value="viewer">viewer</option>
                <option value="admin">admin</option>
              </select>
              <button type="submit">Create user</button>
            </form>
            <div className="issue-list compact">
              {users.map((teamUser) => (
                <div key={teamUser.id} className="issue-item">
                  <strong>{teamUser.displayName}</strong>
                  <span>{teamUser.role}</span>
                  <p>{teamUser.email}</p>
                </div>
              ))}
            </div>
          </article>
        ) : (
          <article className="panel">
            <h2>Team Access</h2>
            <p>Your role is viewer. Ask an admin to manage accounts.</p>
          </article>
        )}
      </section>
    </main>
  );
}
