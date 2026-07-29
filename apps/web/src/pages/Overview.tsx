import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { DashboardSnapshot } from "@monitor-center/shared";
import { api, type TimeseriesBucket } from "../lib/api";
import { useLiveLogsContext } from "../lib/LiveLogsContext";
import { Sparkline } from "../components/charts/Sparkline";
import { LineChart } from "../components/charts/LineChart";
import { BarChart, type BarDatum } from "../components/charts/BarChart";
import styles from "./Overview.module.css";

const emptySnapshot: DashboardSnapshot = { projects: [], containers: [], issues: [], recentLogs: [] };

function formatHm(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function formatRelative(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "vừa xong";
  if (mins < 60) return `${mins} phút trước`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} giờ trước`;
  return new Date(iso).toLocaleDateString();
}

export function Overview() {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot>(emptySnapshot);
  const [uptime, setUptime] = useState<Array<{ name: string; up: boolean; latencyMs: number | null }>>([]);
  const [containerStats, setContainerStats] = useState<Array<{ containerId: string; project: string; cpuPercent: number; memoryPercent: number }>>([]);
  const [buckets, setBuckets] = useState<TimeseriesBucket[]>([]);
  const [projectSparklines, setProjectSparklines] = useState<Record<string, number[]>>({});
  const { logs } = useLiveLogsContext();

  useEffect(() => {
    void api.overview().then((snap) => {
      setSnapshot(snap);
      const projectNames = snap.projects.slice(0, 8).map((p) => p.project);
      void Promise.all(
        projectNames.map((name) =>
          api.timeseries({ project: name, hours: 24, bucketMinutes: 60 }).then((r) => [name, r.buckets] as const)
        )
      ).then((entries) => {
        const map: Record<string, number[]> = {};
        for (const [name, projBuckets] of entries) map[name] = projBuckets.map((b) => b.errorCount + b.warnCount);
        setProjectSparklines(map);
      });
    });
    void api.uptimeChecks().then((r) => setUptime(r.checks));
    void api.containerStats().then((r) => setContainerStats(r.stats));
    void api.timeseries({ hours: 12, bucketMinutes: 30 }).then((r) => setBuckets(r.buckets));
  }, []);

  const totalErrors = snapshot.projects.reduce((sum, p) => sum + p.errorCount24h, 0);
  const totalWarns = snapshot.projects.reduce((sum, p) => sum + p.warnCount24h, 0);
  const runningContainers = snapshot.containers.filter((c) => c.state === "running").length;
  const upCount = uptime.filter((c) => c.up).length;
  const projectsWithIssues = snapshot.projects.filter((p) => p.errorCount24h > 0).length;

  const summary =
    snapshot.projects.length === 0
      ? "Chưa có dữ liệu dự án."
      : projectsWithIssues === 0
        ? `Tất cả ${snapshot.projects.length} dự án đang hoạt động ổn định.`
        : `${projectsWithIssues}/${snapshot.projects.length} dự án đang có lỗi cần chú ý.`;

  const barData: BarDatum[] = snapshot.projects.map((p) => ({
    label: p.project,
    value: p.errorCount24h,
    tone: p.errorCount24h > 0 ? "critical" : p.warnCount24h > 0 ? "warning" : "good"
  }));

  const avgCpuByProject = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const stat of containerStats) {
      const list = map.get(stat.project) ?? [];
      list.push(stat.cpuPercent);
      map.set(stat.project, list);
    }
    const out: Record<string, number> = {};
    for (const [project, values] of map) out[project] = values.reduce((a, b) => a + b, 0) / values.length;
    return out;
  }, [containerStats]);

  return (
    <div>
      <div className={styles.heroRow}>
        <h1 className={styles.heroTitle}>Chào buổi sáng 👋</h1>
        <p className={styles.heroSubtitle}>{summary}</p>
      </div>

      <div className={styles.kpiRow}>
        <div className={styles.kpiTile}>
          <div className={styles.kpiLabel}>Lỗi (24h)</div>
          <div className={`${styles.kpiValue} ${totalErrors > 0 ? styles.tCritical : ""}`}>{totalErrors}</div>
          {buckets.length > 1 ? <Sparkline data={buckets.map((b) => b.errorCount)} tone="critical" width={80} height={24} /> : null}
        </div>
        <div className={styles.kpiTile}>
          <div className={styles.kpiLabel}>Warning (24h)</div>
          <div className={`${styles.kpiValue} ${totalWarns > 0 ? styles.tWarning : ""}`}>{totalWarns}</div>
          {buckets.length > 1 ? <Sparkline data={buckets.map((b) => b.warnCount)} tone="warning" width={80} height={24} /> : null}
        </div>
        <div className={styles.kpiTile}>
          <div className={styles.kpiLabel}>Container chạy</div>
          <div className={styles.kpiValue}>
            {runningContainers}/{snapshot.containers.length}
          </div>
        </div>
        <div className={styles.kpiTile}>
          <div className={styles.kpiLabel}>Uptime</div>
          <div className={`${styles.kpiValue} ${upCount < uptime.length ? styles.tCritical : styles.tGood}`}>
            {upCount}/{uptime.length || 0}
          </div>
        </div>
      </div>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Xu hướng lỗi · 12 giờ</h2>
          <Link to="/logs" className={styles.sectionLink}>
            Xem logs →
          </Link>
        </div>
        <div className={styles.chartCard}>
          {buckets.length > 1 ? (
            <LineChart data={buckets.map((b) => ({ x: b.bucket, y: b.errorCount }))} tone="critical" seriesLabel="Lỗi" formatX={formatHm} height={200} />
          ) : (
            <div className={styles.emptyFeed}>Chưa đủ dữ liệu.</div>
          )}
        </div>
      </section>

      <section className={styles.twoCol}>
        <div>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>Lỗi theo dự án</h2>
          </div>
          <div className={styles.chartCard}>
            {barData.length > 0 ? <BarChart data={barData} height={170} /> : <div className={styles.emptyFeed}>Không có dự án.</div>}
          </div>
        </div>
        <div>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>Uptime checks</h2>
            <Link to="/uptime" className={styles.sectionLink}>
              Xem tất cả →
            </Link>
          </div>
          <div className={styles.miniList}>
            {uptime.length === 0 ? <div className={styles.emptyFeed}>Chưa cấu hình.</div> : null}
            {uptime.map((check) => (
              <div key={check.name} className={styles.miniRow}>
                <span className={check.up ? `${styles.statusDot} ${styles.statusOk}` : `${styles.statusDot} ${styles.statusDanger}`} />
                <span className={styles.miniName}>{check.name}</span>
                <span className={styles.miniMeta}>{check.up ? `${check.latencyMs}ms` : "down"}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Dự án</h2>
        </div>
        <div className={styles.feed}>
          {snapshot.projects.map((project) => (
            <Link key={project.project} to={`/projects/${encodeURIComponent(project.project)}`} className={styles.projectRow}>
              <span
                className={project.errorCount24h > 0 ? `${styles.statusDot} ${styles.statusDanger}` : `${styles.statusDot} ${styles.statusOk}`}
              />
              <div className={styles.projectMain}>
                <div className={styles.projectName}>{project.project}</div>
                <div className={styles.projectMeta}>
                  {project.healthyContainers}/{project.containerCount} container
                  {avgCpuByProject[project.project] !== undefined ? ` · CPU trung bình ${avgCpuByProject[project.project].toFixed(0)}%` : ""}{" "}
                  · {project.lastLogAt ? formatRelative(project.lastLogAt) : "chưa có log"}
                </div>
              </div>
              {projectSparklines[project.project]?.some((v) => v > 0) ? (
                <Sparkline data={projectSparklines[project.project]} tone={project.errorCount24h > 0 ? "critical" : "accent"} width={72} height={22} />
              ) : null}
              <div className={styles.projectCounts}>
                {project.errorCount24h > 0 ? <span className={styles.countDanger}>{project.errorCount24h} lỗi</span> : null}
                {project.warnCount24h > 0 ? <span className={styles.countWarn}>{project.warnCount24h} warn</span> : null}
                {project.errorCount24h === 0 && project.warnCount24h === 0 ? <span className={styles.countOk}>Ổn định</span> : null}
              </div>
              <span className={styles.chevron} aria-hidden="true">
                ›
              </span>
            </Link>
          ))}
          {snapshot.projects.length === 0 ? <div className={styles.emptyFeed}>Chưa có dự án nào.</div> : null}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Hoạt động gần đây</h2>
          <span className={styles.sectionMeta}>{logs.length} sự kiện</span>
        </div>
        <div className={styles.tail}>
          {logs.length === 0 ? <div className={styles.emptyFeed}>Đang chờ log realtime…</div> : null}
          {logs.slice(0, 16).map((log) => (
            <div key={`${log.id}-${log.timestamp}`} className={styles.tailRow}>
              <span className={styles.tailTime}>{formatHm(log.timestamp)}</span>
              <span className={`${styles.levelDot} ${styles["level-" + log.level]}`} />
              <span className={styles.tailProject}>{log.project}</span>
              <span className={styles.tailMessage}>{log.message}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
