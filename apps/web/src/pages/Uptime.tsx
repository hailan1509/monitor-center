import { useEffect, useState } from "react";
import { api } from "../lib/api";
import styles from "./Uptime.module.css";

type Check = {
  name: string;
  url: string;
  up: boolean;
  statusCode: number | null;
  latencyMs: number | null;
  lastCheckedAt: string;
  error: string | null;
};

export function Uptime() {
  const [checks, setChecks] = useState<Check[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    function load() {
      void api
        .uptimeChecks()
        .then((r) => {
          if (mounted) setChecks(r.checks);
        })
        .finally(() => mounted && setLoading(false));
    }
    load();
    const interval = setInterval(load, 15000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const upCount = checks.filter((c) => c.up).length;

  return (
    <div>
      <div className={styles.heroRow}>
        <h1 className={styles.heroTitle}>Uptime</h1>
        <p className={styles.heroSubtitle}>
          {checks.length === 0 ? "Chưa cấu hình uptime check." : `${upCount}/${checks.length} endpoint đang hoạt động.`}
        </p>
      </div>

      <div className={styles.list}>
        {loading && checks.length === 0 ? <div className={styles.empty}>Đang tải…</div> : null}
        {!loading && checks.length === 0 ? (
          <div className={styles.empty}>Chưa có endpoint nào được cấu hình (biến môi trường UPTIME_CHECKS).</div>
        ) : null}
        {checks.map((check) => (
          <div key={check.name} className={styles.row}>
            <span className={check.up ? `${styles.statusBadge} ${styles.statusUp}` : `${styles.statusBadge} ${styles.statusDown}`}>
              {check.up ? "UP" : "DOWN"}
            </span>
            <div className={styles.rowMain}>
              <div className={styles.rowName}>{check.name}</div>
              <div className={styles.rowUrl}>{check.url}</div>
            </div>
            <div className={styles.rowMeta}>
              {check.up ? (
                <span className={styles.latency}>{check.latencyMs}ms</span>
              ) : (
                <span className={styles.errorText}>{check.error ?? (check.statusCode ? `HTTP ${check.statusCode}` : "no response")}</span>
              )}
              <span className={styles.checkedAt}>{new Date(check.lastCheckedAt).toLocaleTimeString()}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
