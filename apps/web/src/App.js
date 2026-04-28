import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
const emptySnapshot = {
    projects: [],
    containers: [],
    issues: [],
    recentLogs: []
};
const navItems = [
    { key: "overview", label: "Overview" },
    { key: "live", label: "Live Tail" },
    { key: "search", label: "Search" },
    { key: "issues", label: "Issues" },
    { key: "assistant", label: "AI Assistant" },
    { key: "containers", label: "Containers" },
    { key: "team", label: "Team" }
];
function formatShortTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.valueOf()))
        return value;
    return date.toLocaleString();
}
function levelClass(level) {
    const normalized = level.toLowerCase();
    if (normalized === "fatal")
        return "badge badge-fatal";
    if (normalized === "error")
        return "badge badge-error";
    if (normalized === "warn")
        return "badge badge-warn";
    if (normalized === "info")
        return "badge badge-info";
    if (normalized === "debug")
        return "badge badge-muted";
    if (normalized === "trace")
        return "badge badge-muted";
    return "badge badge-muted";
}
const levelOptions = ["", "fatal", "error", "warn", "info", "debug", "trace", "unknown"];
function matchesLevel(level, filter) {
    if (!filter)
        return true;
    return level.toLowerCase() === filter;
}
export function App() {
    const [user, setUser] = useState(null);
    const [nav, setNav] = useState("overview");
    const [snapshot, setSnapshot] = useState(emptySnapshot);
    const [liveLogs, setLiveLogs] = useState([]);
    const [searchResults, setSearchResults] = useState([]);
    const [assistantAnswer, setAssistantAnswer] = useState("");
    const [error, setError] = useState("");
    const [filterProject, setFilterProject] = useState("");
    const [filterLevel, setFilterLevel] = useState("");
    const [searchText, setSearchText] = useState("");
    const [assistantQuestion, setAssistantQuestion] = useState("Project nào đang lỗi nhiều nhất hôm nay?");
    const [users, setUsers] = useState([]);
    const [selectedLog, setSelectedLog] = useState(null);
    const [selectedIssue, setSelectedIssue] = useState(null);
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
            const data = JSON.parse(event.data);
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
    async function handleLogin(formData) {
        try {
            setError("");
            const response = await api.login({
                email: String(formData.get("email")),
                password: String(formData.get("password"))
            });
            setUser(response.user);
        }
        catch (loginError) {
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
        }
        catch (searchError) {
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
        }
        catch (assistantError) {
            setError(assistantError instanceof Error ? assistantError.message : "Assistant failed");
        }
    }
    async function handleCreateUser(formData) {
        try {
            await api.createUser({
                email: String(formData.get("email")),
                password: String(formData.get("password")),
                displayName: String(formData.get("displayName")),
                role: String(formData.get("role"))
            });
            const response = await api.users();
            setUsers(response.users);
        }
        catch (createUserError) {
            setError(createUserError instanceof Error ? createUserError.message : "Unable to create user");
        }
    }
    const topProject = useMemo(() => snapshot.projects[0]?.project ?? "No project yet", [snapshot.projects]);
    const allProjects = useMemo(() => {
        const set = new Set();
        for (const container of snapshot.containers)
            set.add(container.project);
        for (const project of snapshot.projects)
            set.add(project.project);
        return Array.from(set).sort();
    }, [snapshot]);
    const visibleLiveLogs = useMemo(() => {
        return liveLogs
            .filter((log) => (filterProject ? log.project === filterProject : true))
            .filter((log) => matchesLevel(log.level, filterLevel));
    }, [liveLogs, filterProject, filterLevel]);
    if (!user) {
        return (_jsx("main", { className: "login-shell", children: _jsxs("form", { className: "panel login-card", onSubmit: (event) => {
                    event.preventDefault();
                    void handleLogin(new FormData(event.currentTarget));
                }, children: [_jsx("h1", { children: "Monitor Center" }), _jsx("p", { children: "Internal log observability for your Docker workloads." }), _jsxs("label", { children: ["Email", _jsx("input", { name: "email", type: "email", defaultValue: "admin@monitor.local", required: true })] }), _jsxs("label", { children: ["Password", _jsx("input", { name: "password", type: "password", defaultValue: "admin123!", required: true })] }), error ? _jsx("div", { className: "error", children: error }) : null, _jsx("button", { type: "submit", children: "Login" })] }) }));
    }
    return (_jsxs("main", { className: "layout", children: [_jsxs("aside", { className: "sidebar", children: [_jsxs("div", { className: "brand", children: [_jsx("div", { className: "brand-mark", children: "MC" }), _jsxs("div", { className: "brand-text", children: [_jsx("div", { className: "brand-title", children: "Monitor Center" }), _jsx("div", { className: "brand-subtitle", children: "Logs & Observability" })] })] }), _jsx("nav", { className: "menu", children: navItems
                            .filter((item) => (item.key === "team" ? user.role === "admin" : true))
                            .map((item) => (_jsx("button", { type: "button", className: nav === item.key ? "menu-item active" : "menu-item", onClick: () => setNav(item.key), children: item.label }, item.key))) }), _jsxs("div", { className: "sidebar-footer", children: [_jsxs("div", { className: "user-pill", children: [_jsx("div", { className: "user-name", children: user.displayName }), _jsxs("div", { className: "user-meta", children: [_jsx("span", { className: "badge badge-muted", children: user.role }), _jsx("span", { className: "muted", children: user.email })] })] }), _jsx("button", { type: "button", className: "button button-ghost", onClick: () => {
                                    void api.logout().then(() => setUser(null));
                                }, children: "Logout" })] })] }), _jsxs("section", { className: "content", children: [_jsxs("header", { className: "content-header", children: [_jsxs("div", { children: [_jsx("h1", { className: "page-title", children: navItems.find((item) => item.key === nav)?.label }), _jsxs("p", { className: "page-subtitle", children: ["Focus: ", topProject] })] }), _jsx("div", { className: "header-actions", children: _jsx("button", { type: "button", className: "button", onClick: () => void refreshDashboard(), children: "Refresh" }) })] }), error ? _jsx("div", { className: "callout callout-error", children: error }) : null, nav === "overview" ? (_jsxs(_Fragment, { children: [_jsx("section", { className: "grid cards", children: snapshot.projects.map((project) => (_jsxs("article", { className: "card", children: [_jsx("div", { className: "card-title", children: project.project }), _jsxs("div", { className: "card-metrics", children: [_jsxs("div", { className: "metric", children: [_jsx("div", { className: "metric-label", children: "Containers" }), _jsxs("div", { className: "metric-value", children: [project.healthyContainers, "/", project.containerCount] })] }), _jsxs("div", { className: "metric", children: [_jsx("div", { className: "metric-label", children: "Errors (24h)" }), _jsx("div", { className: "metric-value metric-danger", children: project.errorCount24h })] }), _jsxs("div", { className: "metric", children: [_jsx("div", { className: "metric-label", children: "Warnings (24h)" }), _jsx("div", { className: "metric-value metric-warn", children: project.warnCount24h })] })] }), _jsxs("div", { className: "muted small", children: ["Last log: ", project.lastLogAt ? formatShortTime(project.lastLogAt) : "—"] })] }, project.project))) }), _jsxs("section", { className: "grid two", children: [_jsxs("article", { className: "panel", children: [_jsxs("div", { className: "panel-head", children: [_jsx("h2", { className: "panel-title", children: "Recent logs" }), _jsx("div", { className: "muted small", children: "Realtime via WebSocket" })] }), _jsx("div", { className: "table log-table", children: visibleLiveLogs.slice(0, 80).map((log) => (_jsxs("button", { type: "button", className: "row row-button", onClick: () => setSelectedLog(log), children: [_jsx("div", { className: "cell time", children: formatShortTime(log.timestamp) }), _jsx("div", { className: "cell project", children: log.project }), _jsx("div", { className: "cell container", children: log.containerName }), _jsx("div", { className: "cell level", children: _jsx("span", { className: levelClass(log.level), children: log.level }) }), _jsx("div", { className: "cell message", children: log.message })] }, `${log.id}-${log.timestamp}`))) })] }), _jsxs("article", { className: "panel", children: [_jsxs("div", { className: "panel-head", children: [_jsx("h2", { className: "panel-title", children: "Top issues (24h)" }), _jsx("div", { className: "muted small", children: "Grouped by fingerprint" })] }), _jsx("div", { className: "table issue-table", children: snapshot.issues.map((issue) => (_jsxs("button", { type: "button", className: "row row-button", onClick: () => setSelectedIssue(issue), children: [_jsx("div", { className: "cell project", children: issue.project }), _jsx("div", { className: "cell level", children: _jsx("span", { className: levelClass(issue.level), children: issue.level }) }), _jsx("div", { className: "cell count", children: issue.count }), _jsx("div", { className: "cell message", children: issue.sampleMessage })] }, issue.fingerprint))) })] })] })] })) : null, nav === "live" ? (_jsxs("section", { className: "panel", children: [_jsxs("div", { className: "panel-head", children: [_jsx("h2", { className: "panel-title", children: "Live Tail" }), _jsxs("div", { className: "filters", children: [_jsxs("select", { value: filterProject, onChange: (event) => setFilterProject(event.target.value), children: [_jsx("option", { value: "", children: "All projects" }), allProjects.map((project) => (_jsx("option", { value: project, children: project }, project)))] }), _jsxs("select", { value: filterLevel, onChange: (event) => setFilterLevel(event.target.value), children: [_jsx("option", { value: "", children: "All levels" }), levelOptions
                                                        .filter((value) => value)
                                                        .map((level) => (_jsx("option", { value: level, children: level }, level)))] })] })] }), _jsx("div", { className: "table log-table", children: visibleLiveLogs.slice(0, 200).map((log) => (_jsxs("button", { type: "button", className: "row row-button", onClick: () => setSelectedLog(log), children: [_jsx("div", { className: "cell time", children: formatShortTime(log.timestamp) }), _jsx("div", { className: "cell project", children: log.project }), _jsx("div", { className: "cell container", children: log.containerName }), _jsx("div", { className: "cell level", children: _jsx("span", { className: levelClass(log.level), children: log.level }) }), _jsx("div", { className: "cell message", children: log.message })] }, `${log.id}-${log.timestamp}`))) })] })) : null, nav === "search" ? (_jsxs("section", { className: "panel", children: [_jsxs("div", { className: "panel-head", children: [_jsx("h2", { className: "panel-title", children: "Search logs" }), _jsxs("div", { className: "filters", children: [_jsxs("select", { value: filterProject, onChange: (event) => setFilterProject(event.target.value), children: [_jsx("option", { value: "", children: "All projects" }), allProjects.map((project) => (_jsx("option", { value: project, children: project }, project)))] }), _jsxs("select", { value: filterLevel, onChange: (event) => setFilterLevel(event.target.value), children: [_jsx("option", { value: "", children: "All levels" }), levelOptions
                                                        .filter((value) => value)
                                                        .map((level) => (_jsx("option", { value: level, children: level }, level)))] }), _jsx("input", { value: searchText, onChange: (event) => setSearchText(event.target.value), placeholder: "keyword, error, status code..." }), _jsx("button", { type: "button", className: "button", onClick: () => void handleSearch(), children: "Search" })] })] }), _jsx("div", { className: "table log-table", children: searchResults.map((log) => (_jsxs("button", { type: "button", className: "row row-button", onClick: () => setSelectedLog(log), children: [_jsx("div", { className: "cell time", children: formatShortTime(log.timestamp) }), _jsx("div", { className: "cell project", children: log.project }), _jsx("div", { className: "cell container", children: log.containerName }), _jsx("div", { className: "cell level", children: _jsx("span", { className: levelClass(log.level), children: log.level }) }), _jsx("div", { className: "cell message", children: log.message })] }, log.id))) })] })) : null, nav === "issues" ? (_jsxs("section", { className: "panel", children: [_jsxs("div", { className: "panel-head", children: [_jsx("h2", { className: "panel-title", children: "Issues" }), _jsxs("div", { className: "filters", children: [_jsxs("select", { value: filterProject, onChange: (event) => setFilterProject(event.target.value), children: [_jsx("option", { value: "", children: "All projects" }), allProjects.map((project) => (_jsx("option", { value: project, children: project }, project)))] }), _jsxs("select", { value: filterLevel, onChange: (event) => setFilterLevel(event.target.value), children: [_jsx("option", { value: "", children: "All levels" }), levelOptions
                                                        .filter((value) => value)
                                                        .map((level) => (_jsx("option", { value: level, children: level }, level)))] }), _jsx("div", { className: "muted small", children: "Most frequent fingerprints in the last 24h" })] })] }), _jsx("div", { className: "table issue-table", children: snapshot.issues
                                    .filter((issue) => (filterProject ? issue.project === filterProject : true))
                                    .filter((issue) => matchesLevel(issue.level, filterLevel))
                                    .map((issue) => (_jsxs("button", { type: "button", className: "row row-button", onClick: () => setSelectedIssue(issue), children: [_jsx("div", { className: "cell project", children: issue.project }), _jsx("div", { className: "cell level", children: _jsx("span", { className: levelClass(issue.level), children: issue.level }) }), _jsx("div", { className: "cell count", children: issue.count }), _jsx("div", { className: "cell time", children: formatShortTime(issue.lastSeenAt) }), _jsx("div", { className: "cell message", children: issue.sampleMessage })] }, issue.fingerprint))) })] })) : null, nav === "assistant" ? (_jsxs("section", { className: "panel", children: [_jsxs("div", { className: "panel-head", children: [_jsx("h2", { className: "panel-title", children: "AI Assistant" }), _jsx("div", { className: "filters", children: _jsxs("select", { value: filterProject, onChange: (event) => setFilterProject(event.target.value), children: [_jsx("option", { value: "", children: "All projects" }), allProjects.map((project) => (_jsx("option", { value: project, children: project }, project)))] }) })] }), _jsxs("div", { className: "assistant-grid", children: [_jsxs("div", { className: "assistant-input", children: [_jsxs("label", { className: "field", children: [_jsx("div", { className: "field-label", children: "Question" }), _jsx("textarea", { value: assistantQuestion, onChange: (event) => setAssistantQuestion(event.target.value), rows: 6 })] }), _jsx("button", { type: "button", className: "button", onClick: () => void handleAssistant(), children: "Ask" }), _jsx("div", { className: "muted small", children: "Tip: h\u1ECFi theo d\u1EA1ng \u201Cweb n\u00E0o l\u1ED7i 500 nhi\u1EC1u nh\u1EA5t?\u201D, \u201Ccontainer n\u00E0o restart b\u1EA5t th\u01B0\u1EDDng?\u201D, \u201Cl\u1ED7i n\u00E0o t\u0103ng \u0111\u1ED9t bi\u1EBFn trong 1h qua?\u201D" })] }), _jsxs("div", { className: "assistant-output", children: [_jsx("div", { className: "field-label", children: "Answer" }), _jsx("pre", { className: "assistant-answer", children: assistantAnswer || "—" })] })] })] })) : null, nav === "containers" ? (_jsxs("section", { className: "panel", children: [_jsxs("div", { className: "panel-head", children: [_jsx("h2", { className: "panel-title", children: "Containers" }), _jsx("div", { className: "muted small", children: "Collected from Docker Engine" })] }), _jsx("div", { className: "table container-table", children: snapshot.containers.map((container) => (_jsxs("div", { className: "row", children: [_jsx("div", { className: "cell project", children: container.project }), _jsx("div", { className: "cell container", children: container.containerName }), _jsx("div", { className: "cell level", children: _jsx("span", { className: container.state === "running" ? "badge badge-ok" : "badge badge-muted", children: container.state }) }), _jsx("div", { className: "cell message", children: container.image })] }, container.containerId))) })] })) : null, nav === "team" && user.role === "admin" ? (_jsxs("section", { className: "grid two", children: [_jsxs("article", { className: "panel", children: [_jsxs("div", { className: "panel-head", children: [_jsx("h2", { className: "panel-title", children: "Create user" }), _jsx("div", { className: "muted small", children: "Admin only" })] }), _jsxs("form", { className: "form", onSubmit: (event) => {
                                            event.preventDefault();
                                            void handleCreateUser(new FormData(event.currentTarget));
                                        }, children: [_jsxs("label", { className: "field", children: [_jsx("div", { className: "field-label", children: "Display name" }), _jsx("input", { name: "displayName", placeholder: "Display name", required: true })] }), _jsxs("label", { className: "field", children: [_jsx("div", { className: "field-label", children: "Email" }), _jsx("input", { name: "email", type: "email", placeholder: "Email", required: true })] }), _jsxs("label", { className: "field", children: [_jsx("div", { className: "field-label", children: "Password" }), _jsx("input", { name: "password", type: "password", placeholder: "Password", required: true })] }), _jsxs("label", { className: "field", children: [_jsx("div", { className: "field-label", children: "Role" }), _jsxs("select", { name: "role", defaultValue: "viewer", children: [_jsx("option", { value: "viewer", children: "viewer" }), _jsx("option", { value: "admin", children: "admin" })] })] }), _jsx("button", { type: "submit", className: "button", children: "Create user" })] })] }), _jsxs("article", { className: "panel", children: [_jsxs("div", { className: "panel-head", children: [_jsx("h2", { className: "panel-title", children: "Users" }), _jsxs("div", { className: "muted small", children: [users.length, " accounts"] })] }), _jsx("div", { className: "table user-table", children: users.map((teamUser) => (_jsxs("div", { className: "row", children: [_jsx("div", { className: "cell project", children: teamUser.displayName }), _jsx("div", { className: "cell level", children: _jsx("span", { className: "badge badge-muted", children: teamUser.role }) }), _jsx("div", { className: "cell message", children: teamUser.email }), _jsx("div", { className: "cell time", children: formatShortTime(teamUser.createdAt) })] }, teamUser.id))) })] })] })) : null, selectedLog ? (_jsx("div", { className: "modal-overlay", role: "button", tabIndex: 0, onClick: () => setSelectedLog(null), onKeyDown: (event) => {
                            if (event.key === "Escape")
                                setSelectedLog(null);
                        }, children: _jsxs("div", { className: "modal", role: "dialog", "aria-modal": "true", onClick: (event) => {
                                event.stopPropagation();
                            }, children: [_jsxs("div", { className: "modal-head", children: [_jsx("div", { className: "modal-title", children: "Log detail" }), _jsx("button", { type: "button", className: "button button-ghost", onClick: () => setSelectedLog(null), children: "Close" })] }), _jsxs("div", { className: "modal-body", children: [_jsxs("div", { className: "kv", children: [_jsx("div", { className: "k", children: "Timestamp" }), _jsx("div", { className: "v", children: formatShortTime(selectedLog.timestamp) }), _jsx("div", { className: "k", children: "Project" }), _jsx("div", { className: "v", children: selectedLog.project }), _jsx("div", { className: "k", children: "Container" }), _jsx("div", { className: "v", children: selectedLog.containerName }), _jsx("div", { className: "k", children: "Service" }), _jsx("div", { className: "v", children: selectedLog.service }), _jsx("div", { className: "k", children: "Level" }), _jsx("div", { className: "v", children: _jsx("span", { className: levelClass(selectedLog.level), children: selectedLog.level }) }), _jsx("div", { className: "k", children: "Stream" }), _jsx("div", { className: "v", children: selectedLog.stream })] }), _jsx("div", { className: "divider" }), _jsx("div", { className: "field-label", children: "Message" }), _jsx("pre", { className: "code-block", children: selectedLog.message }), _jsx("div", { className: "field-label", children: "Raw" }), _jsx("pre", { className: "code-block", children: selectedLog.raw }), _jsx("div", { className: "field-label", children: "Metadata" }), _jsx("pre", { className: "code-block", children: JSON.stringify(selectedLog.metadata ?? {}, null, 2) })] })] }) })) : null, selectedIssue ? (_jsx("div", { className: "modal-overlay", role: "button", tabIndex: 0, onClick: () => setSelectedIssue(null), onKeyDown: (event) => {
                            if (event.key === "Escape")
                                setSelectedIssue(null);
                        }, children: _jsxs("div", { className: "modal", role: "dialog", "aria-modal": "true", onClick: (event) => {
                                event.stopPropagation();
                            }, children: [_jsxs("div", { className: "modal-head", children: [_jsx("div", { className: "modal-title", children: "Issue detail" }), _jsx("button", { type: "button", className: "button button-ghost", onClick: () => setSelectedIssue(null), children: "Close" })] }), _jsxs("div", { className: "modal-body", children: [_jsxs("div", { className: "kv", children: [_jsx("div", { className: "k", children: "Project" }), _jsx("div", { className: "v", children: selectedIssue.project }), _jsx("div", { className: "k", children: "Service" }), _jsx("div", { className: "v", children: selectedIssue.service }), _jsx("div", { className: "k", children: "Level" }), _jsx("div", { className: "v", children: _jsx("span", { className: levelClass(selectedIssue.level), children: selectedIssue.level }) }), _jsx("div", { className: "k", children: "Count (24h)" }), _jsx("div", { className: "v", children: selectedIssue.count }), _jsx("div", { className: "k", children: "Last seen" }), _jsx("div", { className: "v", children: formatShortTime(selectedIssue.lastSeenAt) })] }), _jsx("div", { className: "divider" }), _jsx("div", { className: "field-label", children: "Fingerprint" }), _jsx("pre", { className: "code-block", children: selectedIssue.fingerprint }), _jsx("div", { className: "field-label", children: "Sample message" }), _jsx("pre", { className: "code-block", children: selectedIssue.sampleMessage })] })] }) })) : null] })] }));
}
