import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { DashboardSnapshot } from "@monitor-center/shared";
import { api, type TimeseriesBucket } from "../lib/api";
import { useLiveLogsContext } from "../lib/LiveLogsContext";
import { LineChart } from "../components/charts/LineChart";
import styles from "./ProjectDetail.module.css";

const emptySnapshot: DashboardSnapshot = { projects: [], containers: [], issues: [], recentLogs: [] };

function formatHm(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function meterTone(pct: number): "good" | "warning" | "critical" {
  if (pct >= 90) return "critical";
  if (pct >= 70) return "warning";
  return "good";
}

export function ProjectDetail() {
  const { project: projectParam } = useParams<{ project: string }>();
  const project = decodeURIComponent(projectParam ?? "");
  const [snapshot, setSnapshot] = useState<DashboardSnapshot>(emptySnapshot);
  const [containerStats, setContainerStats] = useState<
    Array<{ containerId: string; containerName: string; project: string; cpuPercent: number; memoryPercent: number }>
  >([]);
  const [buckets, setBuckets] = useState<TimeseriesBucket[]>([]);
  const { logs } = useLiveLogsContext();

  useEffect(() => {
    void api.overview().then(setSnapshot);
    void api.containerStats().then((r) => setContainerStats(r.stats));
    void api.timeseries({ project, hours: 24, bucketMinutes: 60 }).then((r) => setBuckets(r.buckets));
  }, [project]);

  const summary = useMemo(() => snapshot.projects.find((p) => p.project === project), [snapshot.projects, project]);
  const containers = useMemo(() => snapshot.containers.filter((c) => c.project === project), [snapshot.containers, project]);
  const issues = useMemo(() => snapshot.issues.filter((i) => i.project === project), [snapshot.issues, project]);
  const scopedContainerStats = useMemo(() => containerStats.filter((c) => c.project === project), [containerStats, project]);
  const scopedLogs = useMemo(() => logs.filter((l) => l.project === project), [logs, project]);

  return (
    <div>
      <Link to="/" className={styles.back}>
        ← Overview
      </Link>

      <div className={styles.heroRow}>
        <h1 className={styles.heroTitle}>{project}</h1>
        <p className={styles.heroSubtitle}>
          {summary ? `${summary.healthyContainers}/${summary.containerCount} container khoẻ mạnh` : "Đang tải…"}
        </p>
      </div>

      <div className={styles.kpiRow}>
        <div className={styles.kpiTile}>
          <div className={styles.kpiLabel}>Lỗi (24h)</div>
          <div className={`${styles.kpiValue} ${(summary?.errorCount24h ?? 0) > 0 ? styles.tCritical : ""}`}>{summary?.errorCount24h ?? "—"}</div>
        </div>
        <div className={styles.kpiTile}>
          <div className={styles.kpiLabel}>Warning (24h)</div>
          <div className={`${styles.kpiValue} ${(summary?.warnCount24h ?? 0) > 0 ? styles.tWarning : ""}`}>{summary?.warnCount24h ?? "—"}</div>
        </div>
        <div className={styles.kpiTile}>
          <div className={styles.kpiLabel}>Log gần nhất</div>
          <div className={styles.kpiValueSmall}>{summary?.lastLogAt ? formatHm(summary.lastLogAt) : "—"}</div>
        </div>
      </div>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Xu hướng lỗi · 24 giờ</h2>
        </div>
        <div className={styles.chartCard}>
          {buckets.length > 1 ? (
            <LineChart data={buckets.map((b) => ({ x: b.bucket, y: b.errorCount }))} tone="critical" seriesLabel="Lỗi" formatX={formatHm} height={200} />
          ) : (
            <div className={styles.empty}>Chưa đủ dữ liệu.</div>
          )}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Containers</h2>
        </div>
        <div className={styles.list}>
          {containers.length === 0 ? <div className={styles.empty}>Không có container.</div> : null}
          {containers.map((c) => {
            const stats = scopedContainerStats.find((s) => s.containerId === c.containerId);
            return (
              <div key={c.containerId} className={styles.containerRow}>
                <span className={c.state === "running" ? `${styles.statusDot} ${styles.statusOk}` : `${styles.statusDot} ${styles.statusMuted}`} />
                <div className={styles.containerMain}>
                  <div className={styles.containerName}>{c.containerName}</div>
                  <div className={styles.containerMeta}>{c.image}</div>
                </div>
                {stats ? (
                  <div className={styles.meters}>
                    <div className={styles.meterItem}>
                      <div className={styles.meterTrack}>
                        <div className={`${styles.meterFill} ${styles["tone-" + meterTone(stats.cpuPercent)]}`} style={{ width: `${Math.min(100, stats.cpuPercent)}%` }} />
                      </div>
                      <span className={styles.meterLabel}>CPU {stats.cpuPercent.toFixed(0)}%</span>
                    </div>
                    <div className={styles.meterItem}>
                      <div className={styles.meterTrack}>
                        <div className={`${styles.meterFill} ${styles["tone-" + meterTone(stats.memoryPercent)]}`} style={{ width: `${Math.min(100, stats.memoryPercent)}%` }} />
                      </div>
                      <span className={styles.meterLabel}>MEM {stats.memoryPercent.toFixed(0)}%</span>
                    </div>
                  </div>
                ) : (
                  <span className={styles.empty}>—</span>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Issues</h2>
        </div>
        <div className={styles.list}>
          {issues.length === 0 ? <div className={styles.empty}>Không có issue.</div> : null}
          {issues.map((issue) => (
            <div key={issue.fingerprint} className={styles.issueRow}>
              <span className={`${styles.levelDot} ${styles["level-" + issue.level]}`} />
              <span className={styles.issueCount}>{issue.count}×</span>
              <span className={styles.issueMessage} title={issue.sampleMessage}>
                {issue.sampleMessage}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Live tail</h2>
        </div>
        <div className={styles.tail}>
          {scopedLogs.length === 0 ? <div className={styles.empty}>Đang chờ log realtime…</div> : null}
          {scopedLogs.slice(0, 20).map((log) => (
            <div key={`${log.id}-${log.timestamp}`} className={styles.tailRow}>
              <span className={styles.tailTime}>{formatHm(log.timestamp)}</span>
              <span className={`${styles.levelDot} ${styles["level-" + log.level]}`} />
              <span className={styles.tailMessage}>{log.message}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
