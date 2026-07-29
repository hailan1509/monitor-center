import { useEffect, useMemo, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import type { DashboardSnapshot } from "@monitor-center/shared";
import { api } from "../lib/api";
import type { AppShellContext } from "../components/layout/AppShell";
import styles from "./Containers.module.css";

const emptySnapshot: DashboardSnapshot = { projects: [], containers: [], issues: [], recentLogs: [] };

type Stat = {
  containerId: string;
  cpuPercent: number;
  memoryPercent: number;
  memoryUsageBytes: number;
  memoryLimitBytes: number;
  pidsCount: number;
  networkRxBytes: number;
  networkTxBytes: number;
};
type Inspect = {
  restartCount: number;
  health: string | null;
  ports: Array<{ privatePort: number; publicPort: number | null; type: string }>;
  networkMode: string;
  command: string;
};

function meterTone(pct: number): "good" | "warning" | "critical" {
  if (pct >= 90) return "critical";
  if (pct >= 70) return "warning";
  return "good";
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatUptime(startedAt: string | null) {
  if (!startedAt) return "—";
  const ms = Date.now() - new Date(startedAt).getTime();
  if (ms < 0) return "—";
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  if (days > 0) return `${days} ngày ${hours} giờ`;
  if (hours > 0) return `${hours} giờ ${minutes} phút`;
  return `${minutes} phút`;
}

export function Containers() {
  const { user } = useOutletContext<AppShellContext>();
  const [snapshot, setSnapshot] = useState<DashboardSnapshot>(emptySnapshot);
  const [stats, setStats] = useState<Stat[]>([]);
  const [inspects, setInspects] = useState<Record<string, Inspect>>({});
  const [project, setProject] = useState("");
  const [restartingId, setRestartingId] = useState<string | null>(null);
  const [restartError, setRestartError] = useState<{ id: string; message: string } | null>(null);

  function refresh() {
    void api.overview().then((snap) => {
      setSnapshot(snap);
      void Promise.all(
        snap.containers.map((c) =>
          api
            .inspectContainer(c.containerId)
            .then((r) => [c.containerId, r] as const)
            .catch(() => null)
        )
      ).then((entries) => {
        const map: Record<string, Inspect> = {};
        for (const entry of entries) {
          if (entry) map[entry[0]] = entry[1];
        }
        setInspects(map);
      });
    });
    void api.containerStats().then((r) => setStats(r.stats));
  }

  useEffect(refresh, []);

  const projects = useMemo(() => snapshot.projects.map((p) => p.project), [snapshot.projects]);
  const filtered = project ? snapshot.containers.filter((c) => c.project === project) : snapshot.containers;

  async function handleRestart(containerId: string, containerName: string) {
    const confirmed = window.confirm(`Khởi động lại container "${containerName}"? Ứng dụng sẽ gián đoạn trong vài giây.`);
    if (!confirmed) return;
    setRestartingId(containerId);
    setRestartError(null);
    try {
      await api.restartContainer(containerId);
      setTimeout(refresh, 2500);
    } catch (err) {
      setRestartError({ id: containerId, message: err instanceof Error ? err.message : "Không thể khởi động lại container" });
    } finally {
      setRestartingId(null);
    }
  }

  return (
    <div>
      <div className={styles.heroRow}>
        <h1 className={styles.heroTitle}>Containers</h1>
        <p className={styles.heroSubtitle}>Trạng thái & tài nguyên container đang chạy trên VPS.</p>
      </div>

      <div className={styles.toolbar}>
        <select value={project} onChange={(e) => setProject(e.target.value)} className={styles.select}>
          <option value="">Tất cả project</option>
          {projects.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <span className={styles.count}>{filtered.length} container</span>
      </div>

      <div className={styles.list}>
        {filtered.length === 0 ? <div className={styles.empty}>Không có container.</div> : null}
        {filtered.map((c) => {
          const stat = stats.find((s) => s.containerId === c.containerId);
          const inspect = inspects[c.containerId];
          return (
            <article key={c.containerId} className={styles.card}>
              <div className={styles.cardHead}>
                <span className={c.state === "running" ? `${styles.statusDot} ${styles.statusOk}` : `${styles.statusDot} ${styles.statusMuted}`} />
                <div className={styles.cardTitleWrap}>
                  <div className={styles.cardTitle}>{c.containerName}</div>
                  <div className={styles.cardSubtitle}>
                    {c.project} / {c.service} · {c.image}
                  </div>
                </div>
                <Link to={`/logs?project=${encodeURIComponent(c.project)}`} className={styles.linkBtn}>
                  Logs
                </Link>
                {user.role === "admin" ? (
                  <button
                    type="button"
                    className={styles.restartBtn}
                    onClick={() => void handleRestart(c.containerId, c.containerName)}
                    disabled={restartingId === c.containerId}
                  >
                    {restartingId === c.containerId ? "Đang khởi động lại…" : "Khởi động lại"}
                  </button>
                ) : null}
              </div>

              {restartError?.id === c.containerId ? <div className={styles.restartError}>{restartError.message}</div> : null}

              <div className={styles.statGrid}>
                <div className={styles.statItem}>
                  <div className={styles.statLabel}>CPU</div>
                  {stat ? (
                    <div className={styles.meterRow}>
                      <span className={styles.meterTrack}>
                        <span className={`${styles.meterFill} ${styles["tone-" + meterTone(stat.cpuPercent)]}`} style={{ width: `${Math.min(100, stat.cpuPercent)}%` }} />
                      </span>
                      <span className={styles.statValue}>{stat.cpuPercent.toFixed(0)}%</span>
                    </div>
                  ) : (
                    <span className={styles.dash}>—</span>
                  )}
                </div>
                <div className={styles.statItem}>
                  <div className={styles.statLabel}>Memory</div>
                  {stat ? (
                    <div className={styles.meterRow}>
                      <span className={styles.meterTrack}>
                        <span className={`${styles.meterFill} ${styles["tone-" + meterTone(stat.memoryPercent)]}`} style={{ width: `${Math.min(100, stat.memoryPercent)}%` }} />
                      </span>
                      <span className={styles.statValue}>
                        {stat.memoryPercent.toFixed(0)}% ({formatBytes(stat.memoryUsageBytes)})
                      </span>
                    </div>
                  ) : (
                    <span className={styles.dash}>—</span>
                  )}
                </div>
                <div className={styles.statItem}>
                  <div className={styles.statLabel}>Network I/O</div>
                  <div className={styles.statValue}>{stat ? `↓ ${formatBytes(stat.networkRxBytes)} · ↑ ${formatBytes(stat.networkTxBytes)}` : "—"}</div>
                </div>
                <div className={styles.statItem}>
                  <div className={styles.statLabel}>Processes</div>
                  <div className={styles.statValue}>{stat ? `${stat.pidsCount} PID` : "—"}</div>
                </div>
                <div className={styles.statItem}>
                  <div className={styles.statLabel}>Uptime</div>
                  <div className={styles.statValue}>{c.state === "running" ? formatUptime(c.startedAt) : "—"}</div>
                </div>
                <div className={styles.statItem}>
                  <div className={styles.statLabel}>Restart count</div>
                  <div className={styles.statValue}>{inspect ? `${inspect.restartCount} lần` : "—"}</div>
                </div>
                <div className={styles.statItem}>
                  <div className={styles.statLabel}>Health</div>
                  <div className={styles.statValue}>{inspect?.health ?? "—"}</div>
                </div>
                <div className={styles.statItem}>
                  <div className={styles.statLabel}>Ports</div>
                  <div className={styles.statValue}>
                    {inspect && inspect.ports.length > 0
                      ? inspect.ports.map((p) => (p.publicPort ? `${p.publicPort}→${p.privatePort}` : `${p.privatePort} (nội bộ)`)).join(", ")
                      : "—"}
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
