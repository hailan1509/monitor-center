import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { LogEvent } from "@monitor-center/shared";
import { api } from "../lib/api";
import { useLiveLogsContext } from "../lib/LiveLogsContext";
import { downloadCsv } from "../lib/csv";
import { LogDetailModal } from "../components/LogDetailModal";
import styles from "./Logs.module.css";

const levelOptions = ["", "fatal", "error", "warn", "info", "debug", "trace", "unknown"] as const;

function formatFull(iso: string) {
  return new Date(iso).toLocaleString();
}

export function Logs() {
  const { connected, logs: liveLogs } = useLiveLogsContext();
  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState<"live" | "search">("live");
  const [project, setProject] = useState(() => searchParams.get("project") ?? "");
  const [level, setLevel] = useState("");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<LogEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [selected, setSelected] = useState<LogEvent | null>(null);
  const [knownProjects, setKnownProjects] = useState<string[]>([]);

  useEffect(() => {
    void api.overview().then((r) => setKnownProjects(r.projects.map((p) => p.project)));
  }, []);

  const projects = useMemo(() => {
    const set = new Set<string>(knownProjects);
    for (const log of liveLogs) set.add(log.project);
    for (const log of results) set.add(log.project);
    return Array.from(set).sort();
  }, [knownProjects, liveLogs, results]);

  async function runSearch(before?: string) {
    setLoading(true);
    try {
      const params: Record<string, string> = { limit: "100" };
      if (project) params.project = project;
      if (level) params.level = level;
      if (q) params.q = q;
      if (before) params.end = before;
      const response = await api.searchLogs(params);
      setResults((current) => (before ? [...current, ...response.logs] : response.logs));
      setHasMore(response.logs.length === 100);
    } finally {
      setLoading(false);
    }
  }

  function handleSearch() {
    setMode("search");
    void runSearch();
  }

  function loadMore() {
    const last = results[results.length - 1];
    if (!last) return;
    const cursor = new Date(new Date(last.timestamp).getTime() - 1).toISOString();
    void runSearch(cursor);
  }

  const liveFiltered = liveLogs
    .filter((l) => (project ? l.project === project : true))
    .filter((l) => (level ? l.level === level : true))
    .filter((l) => (q ? l.message.toLowerCase().includes(q.toLowerCase()) : true));

  const visible = mode === "live" ? liveFiltered : results;

  function handleExport() {
    downloadCsv(
      `logs-${Date.now()}.csv`,
      visible.map((l) => ({
        timestamp: l.timestamp,
        project: l.project,
        service: l.service,
        container: l.containerName,
        level: l.level,
        message: l.message
      }))
    );
  }

  return (
    <div>
      <div className={styles.heroRow}>
        <h1 className={styles.heroTitle}>Logs</h1>
        <p className={styles.heroSubtitle}>Xem realtime hoặc tìm kiếm log lịch sử trên toàn bộ hệ thống.</p>
      </div>

      <div className={styles.toolbar}>
        <div className={styles.modeToggle}>
          <button type="button" className={mode === "live" ? `${styles.modeBtn} ${styles.modeBtnActive}` : styles.modeBtn} onClick={() => setMode("live")}>
            Live {connected ? <span className={styles.liveDot} /> : null}
          </button>
          <button type="button" className={mode === "search" ? `${styles.modeBtn} ${styles.modeBtnActive}` : styles.modeBtn} onClick={handleSearch}>
            Search
          </button>
        </div>

        <select value={project} onChange={(e) => setProject(e.target.value)} className={styles.select}>
          <option value="">Tất cả project</option>
          {projects.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select value={level} onChange={(e) => setLevel(e.target.value)} className={styles.select}>
          <option value="">Tất cả level</option>
          {levelOptions
            .filter(Boolean)
            .map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
        </select>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSearch();
          }}
          placeholder="Tìm kiếm nội dung…"
          className={styles.input}
        />
        {mode === "search" ? (
          <button type="button" className={styles.button} onClick={handleSearch} disabled={loading}>
            {loading ? "Đang tìm…" : "Tìm"}
          </button>
        ) : null}
        <button type="button" className={styles.buttonGhost} onClick={handleExport} disabled={visible.length === 0}>
          Xuất CSV
        </button>
      </div>

      <div className={styles.table}>
        <div className={styles.tableHead}>
          <span>Thời gian</span>
          <span>Project</span>
          <span>Container</span>
          <span>Level</span>
          <span>Message</span>
        </div>
        {visible.length === 0 ? <div className={styles.empty}>{mode === "live" ? "Đang chờ log realtime…" : "Không có kết quả."}</div> : null}
        {visible.map((log) => (
          <button key={`${log.id}-${log.timestamp}`} type="button" className={styles.row} onClick={() => setSelected(log)}>
            <span className={styles.time}>{formatFull(log.timestamp)}</span>
            <span className={styles.cellProject}>{log.project}</span>
            <span className={styles.cellContainer}>{log.containerName}</span>
            <span className={`${styles.levelBadge} ${styles["level-" + log.level]}`}>{log.level}</span>
            <span className={styles.message}>{log.message}</span>
          </button>
        ))}
      </div>

      {mode === "search" && hasMore ? (
        <div className={styles.loadMoreWrap}>
          <button type="button" className={styles.buttonGhost} onClick={loadMore} disabled={loading}>
            {loading ? "Đang tải…" : "Tải thêm"}
          </button>
        </div>
      ) : null}

      <LogDetailModal log={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
