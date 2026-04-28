import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
const emptySnapshot = {
    projects: [],
    containers: [],
    issues: [],
    recentLogs: []
};
export function App() {
    const [user, setUser] = useState(null);
    const [snapshot, setSnapshot] = useState(emptySnapshot);
    const [liveLogs, setLiveLogs] = useState([]);
    const [searchResults, setSearchResults] = useState([]);
    const [assistantAnswer, setAssistantAnswer] = useState("");
    const [error, setError] = useState("");
    const [searchProject, setSearchProject] = useState("");
    const [searchText, setSearchText] = useState("");
    const [assistantQuestion, setAssistantQuestion] = useState("Project nào đang lỗi nhiều nhất hôm nay?");
    const [users, setUsers] = useState([]);
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
                ...(searchProject ? { project: searchProject } : {}),
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
                ...(searchProject ? { project: searchProject } : {})
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
    if (!user) {
        return (_jsx("main", { className: "login-shell", children: _jsxs("form", { className: "panel login-card", onSubmit: (event) => {
                    event.preventDefault();
                    void handleLogin(new FormData(event.currentTarget));
                }, children: [_jsx("h1", { children: "Monitor Center" }), _jsx("p", { children: "Internal log observability for your Docker workloads." }), _jsxs("label", { children: ["Email", _jsx("input", { name: "email", type: "email", defaultValue: "admin@monitor.local", required: true })] }), _jsxs("label", { children: ["Password", _jsx("input", { name: "password", type: "password", defaultValue: "admin123!", required: true })] }), error ? _jsx("div", { className: "error", children: error }) : null, _jsx("button", { type: "submit", children: "Login" })] }) }));
    }
    return (_jsxs("main", { className: "app-shell", children: [_jsxs("header", { className: "topbar", children: [_jsxs("div", { children: [_jsx("h1", { children: "Monitor Center" }), _jsxs("p", { children: [user.displayName, " | ", user.role, " | Focus: ", topProject] })] }), _jsx("button", { type: "button", onClick: () => {
                            void api.logout().then(() => setUser(null));
                        }, children: "Logout" })] }), error ? _jsx("div", { className: "error banner", children: error }) : null, _jsx("section", { className: "grid summary-grid", children: snapshot.projects.map((project) => (_jsxs("article", { className: "panel metric-card", children: [_jsx("h2", { children: project.project }), _jsxs("p", { children: [project.healthyContainers, "/", project.containerCount, " containers healthy"] }), _jsxs("p", { children: [project.errorCount24h, " errors in 24h"] }), _jsxs("p", { children: [project.warnCount24h, " warnings in 24h"] })] }, project.project))) }), _jsxs("section", { className: "grid two-col", children: [_jsxs("article", { className: "panel", children: [_jsxs("div", { className: "panel-header", children: [_jsx("h2", { children: "Live Tail" }), _jsx("button", { type: "button", onClick: () => void refreshDashboard(), children: "Refresh snapshot" })] }), _jsx("div", { className: "log-list", children: liveLogs.map((log) => (_jsxs("div", { className: `log-item level-${log.level}`, children: [_jsx("strong", { children: log.project }), _jsx("span", { children: log.containerName }), _jsx("span", { children: log.level }), _jsx("p", { children: log.message })] }, `${log.id}-${log.timestamp}`))) })] }), _jsxs("article", { className: "panel", children: [_jsx("h2", { children: "Search" }), _jsxs("div", { className: "filters", children: [_jsx("input", { value: searchProject, onChange: (event) => setSearchProject(event.target.value), placeholder: "project" }), _jsx("input", { value: searchText, onChange: (event) => setSearchText(event.target.value), placeholder: "keyword or error code" }), _jsx("button", { type: "button", onClick: () => void handleSearch(), children: "Search logs" })] }), _jsx("div", { className: "log-list compact", children: searchResults.map((log) => (_jsxs("div", { className: "log-item", children: [_jsx("strong", { children: log.timestamp }), _jsx("span", { children: log.project }), _jsx("span", { children: log.level }), _jsx("p", { children: log.message })] }, log.id))) })] })] }), _jsxs("section", { className: "grid two-col", children: [_jsxs("article", { className: "panel", children: [_jsx("h2", { children: "Issues" }), _jsx("div", { className: "issue-list", children: snapshot.issues.map((issue) => (_jsxs("div", { className: "issue-item", children: [_jsx("strong", { children: issue.project }), _jsx("span", { children: issue.level }), _jsxs("span", { children: [issue.count, " hits"] }), _jsx("p", { children: issue.sampleMessage })] }, issue.fingerprint))) })] }), _jsxs("article", { className: "panel", children: [_jsx("h2", { children: "AI Assistant" }), _jsx("textarea", { value: assistantQuestion, onChange: (event) => setAssistantQuestion(event.target.value), rows: 5 }), _jsx("button", { type: "button", onClick: () => void handleAssistant(), children: "Ask about logs" }), _jsx("pre", { className: "assistant-answer", children: assistantAnswer })] })] }), _jsxs("section", { className: "grid two-col", children: [_jsxs("article", { className: "panel", children: [_jsx("h2", { children: "Containers" }), _jsx("div", { className: "issue-list", children: snapshot.containers.map((container) => (_jsxs("div", { className: "issue-item", children: [_jsx("strong", { children: container.containerName }), _jsx("span", { children: container.project }), _jsx("span", { children: container.state }), _jsx("p", { children: container.image })] }, container.containerId))) })] }), user.role === "admin" ? (_jsxs("article", { className: "panel", children: [_jsx("h2", { children: "Team Access" }), _jsxs("form", { className: "user-form", onSubmit: (event) => {
                                    event.preventDefault();
                                    void handleCreateUser(new FormData(event.currentTarget));
                                }, children: [_jsx("input", { name: "displayName", placeholder: "Display name", required: true }), _jsx("input", { name: "email", type: "email", placeholder: "Email", required: true }), _jsx("input", { name: "password", type: "password", placeholder: "Password", required: true }), _jsxs("select", { name: "role", defaultValue: "viewer", children: [_jsx("option", { value: "viewer", children: "viewer" }), _jsx("option", { value: "admin", children: "admin" })] }), _jsx("button", { type: "submit", children: "Create user" })] }), _jsx("div", { className: "issue-list compact", children: users.map((teamUser) => (_jsxs("div", { className: "issue-item", children: [_jsx("strong", { children: teamUser.displayName }), _jsx("span", { children: teamUser.role }), _jsx("p", { children: teamUser.email })] }, teamUser.id))) })] })) : (_jsxs("article", { className: "panel", children: [_jsx("h2", { children: "Team Access" }), _jsx("p", { children: "Your role is viewer. Ask an admin to manage accounts." })] }))] })] }));
}
