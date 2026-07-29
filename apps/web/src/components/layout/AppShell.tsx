import { useEffect, useRef } from "react";
import { Outlet } from "react-router-dom";
import type { CurrentUser } from "../../lib/useAuth";
import { LiveLogsProvider, useLiveLogsContext } from "../../lib/LiveLogsContext";
import { ToastProvider, useToast } from "../../lib/ToastContext";
import { ToastStack } from "../ToastStack";
import { CommandPalette } from "../CommandPalette";
import { NavBar } from "./NavBar";
import styles from "./AppShell.module.css";

/** Watches the shared live-log stream and raises a toast the moment a new fatal/error line arrives. */
function ErrorToastWatcher() {
  const { logs } = useLiveLogsContext();
  const { push } = useToast();
  const seenHeadId = useRef<string | null>(null);
  const isFirstRun = useRef(true);

  useEffect(() => {
    const head = logs[0];
    if (!head || head.id === seenHeadId.current) return;
    seenHeadId.current = head.id;

    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }

    if (head.level === "fatal" || head.level === "error") {
      push({
        title: `${head.level === "fatal" ? "Fatal" : "Error"} — ${head.project}`,
        message: head.message,
        tone: "critical"
      });
    }
  }, [logs, push]);

  return null;
}

export type AppShellContext = { user: CurrentUser };

function ShellInner({ user, onLogout }: { user: CurrentUser; onLogout: () => void }) {
  const { connected } = useLiveLogsContext();
  return (
    <div className={styles.shell}>
      <NavBar user={user} connected={connected} onLogout={onLogout} />
      <main className={styles.content}>
        <Outlet context={{ user } satisfies AppShellContext} />
      </main>
      <ErrorToastWatcher />
      <ToastStack />
      <CommandPalette />
    </div>
  );
}

export function AppShell({ user, onLogout }: { user: CurrentUser; onLogout: () => void }) {
  return (
    <LiveLogsProvider limit={300}>
      <ToastProvider>
        <ShellInner user={user} onLogout={onLogout} />
      </ToastProvider>
    </LiveLogsProvider>
  );
}
