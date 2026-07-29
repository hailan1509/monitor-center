import { useEffect, useMemo, useState } from "react";
import type { DashboardSnapshot } from "@monitor-center/shared";
import { api } from "../lib/api";
import styles from "./Issues.module.css";

const emptySnapshot: DashboardSnapshot = { projects: [], containers: [], issues: [], recentLogs: [] };
const levelOptions = ["", "fatal", "error", "warn"] as const;

function formatFull(iso: string) {
  return new Date(iso).toLocaleString();
}

type Issue = DashboardSnapshot["issues"][number];

export function Issues() {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot>(emptySnapshot);
  const [project, setProject] = useState("");
  const [level, setLevel] = useState("");
  const [selected, setSelected] = useState<Issue | null>(null);
  const [silencedKeys, setSilencedKeys] = useState<Set<string>>(new Set());
  const [silencing, setSilencing] = useState<string | null>(null);

  useEffect(() => {
    void api.overview().then(setSnapshot);
  }, []);

  const projects = useMemo(() => snapshot.projects.map((p) => p.project), [snapshot.projects]);

  const filtered = snapshot.issues
    .filter((i) => (project ? i.project === project : true))
    .filter((i) => (level ? i.level === level : true));

  async function handleSilence(issue: Issue) {
    const key = `${issue.project}::${issue.service}`;
    setSilencing(key);
    try {
      await api.addSilence({ project: issue.project, service: issue.service, durationMs: 30 * 60 * 1000 });
      setSilencedKeys((current) => new Set(current).add(key));
    } finally {
      setSilencing(null);
    }
  }

  return (
    <div>
      <div className={styles.heroRow}>
        <h1 className={styles.heroTitle}>Issues</h1>
        <p className={styles.heroSubtitle}>Lỗi được nhóm theo fingerprint trong 24h gần nhất.</p>
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
        <span className={styles.count}>{filtered.length} issue</span>
      </div>

      <div className={styles.list}>
        {filtered.length === 0 ? <div className={styles.empty}>Không có issue nào.</div> : null}
        {filtered.map((issue) => {
          const key = `${issue.project}::${issue.service}`;
          const isSilenced = silencedKeys.has(key);
          return (
            <div key={issue.fingerprint} className={styles.row}>
              <button type="button" className={styles.rowMain} onClick={() => setSelected(issue)}>
                <span className={`${styles.levelBadge} ${styles["level-" + issue.level]}`}>{issue.level}</span>
                <div className={styles.rowText}>
                  <div className={styles.rowMessage}>{issue.sampleMessage}</div>
                  <div className={styles.rowMeta}>
                    {issue.project} / {issue.service} · {formatFull(issue.lastSeenAt)}
                  </div>
                </div>
                <div className={styles.rowCount}>{issue.count}×</div>
              </button>
              <button
                type="button"
                className={isSilenced ? `${styles.silenceBtn} ${styles.silenceBtnDone}` : styles.silenceBtn}
                onClick={() => void handleSilence(issue)}
                disabled={isSilenced || silencing === key}
              >
                {isSilenced ? "Đã tắt 30p" : silencing === key ? "Đang tắt…" : "Tắt 30 phút"}
              </button>
            </div>
          );
        })}
      </div>

      {selected ? (
        <div
          className={styles.overlay}
          role="button"
          tabIndex={0}
          onClick={() => setSelected(null)}
          onKeyDown={(e) => e.key === "Escape" && setSelected(null)}
        >
          <div className={styles.modal} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHead}>
              <div className={styles.modalTitle}>Chi tiết issue</div>
              <button type="button" className={styles.closeBtn} onClick={() => setSelected(null)}>
                Đóng
              </button>
            </div>
            <div className={styles.modalBody}>
              <div className={styles.kv}>
                <div className={styles.k}>Project</div>
                <div className={styles.v}>{selected.project}</div>
                <div className={styles.k}>Service</div>
                <div className={styles.v}>{selected.service}</div>
                <div className={styles.k}>Level</div>
                <div className={styles.v}>{selected.level}</div>
                <div className={styles.k}>Số lần (24h)</div>
                <div className={styles.v}>{selected.count}</div>
                <div className={styles.k}>Lần cuối</div>
                <div className={styles.v}>{formatFull(selected.lastSeenAt)}</div>
              </div>
              <div className={styles.label}>Fingerprint</div>
              <pre className={styles.code}>{selected.fingerprint}</pre>
              <div className={styles.label}>Sample message</div>
              <pre className={styles.code}>{selected.sampleMessage}</pre>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
