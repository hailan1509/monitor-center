import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./lib/useAuth";
import { AppShell } from "./components/layout/AppShell";
import { Login } from "./pages/Login";
import { Overview } from "./pages/Overview";
import { ProjectDetail } from "./pages/ProjectDetail";
import { Logs } from "./pages/Logs";
import { Issues } from "./pages/Issues";
import { Security } from "./pages/Security";
import { Containers } from "./pages/Containers";
import { Uptime } from "./pages/Uptime";
import { Assistant } from "./pages/Assistant";
import { Team } from "./pages/Team";
import { Settings } from "./pages/Settings";
import styles from "./Root.module.css";

export function Root() {
  const { user, loading, login, logout } = useAuth();

  if (loading) {
    return (
      <div className={styles.splash}>
        <div className={styles.spinner} />
      </div>
    );
  }

  if (!user) {
    return <Login onLogin={login} />;
  }

  return (
    <Routes>
      <Route element={<AppShell user={user} onLogout={() => void logout()} />}>
        <Route path="/" element={<Overview />} />
        <Route path="/projects/:project" element={<ProjectDetail />} />
        <Route path="/logs" element={<Logs />} />
        <Route path="/issues" element={<Issues />} />
        <Route path="/security" element={<Security user={user} />} />
        <Route path="/containers" element={<Containers />} />
        <Route path="/uptime" element={<Uptime />} />
        <Route path="/assistant" element={<Assistant />} />
        <Route path="/team" element={<Team user={user} />} />
        <Route path="/settings" element={<Settings user={user} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
