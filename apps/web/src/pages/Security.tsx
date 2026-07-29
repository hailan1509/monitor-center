import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { LineChart } from "../components/charts/LineChart";
import styles from "./Security.module.css";

type Summary = {
  total24h: number;
  topIps: Array<{ clientIp: string; count: number }>;
  topPaths: Array<{ path: string; count: number }>;
  topUserAgents: Array<{ userAgent: string; count: number }>;
};

function formatHm(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function Security() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [buckets, setBuckets] = useState<Array<{ bucket: string; count: number }>>([]);

  useEffect(() => {
    void api.securitySummary().then(setSummary);
    void api.securityTimeseries({ hours: 24, bucketMinutes: 60 }).then((r) => setBuckets(r.buckets));
  }, []);

  return (
    <div>
      <div className={styles.heroRow}>
        <h1 className={styles.heroTitle}>Security</h1>
        <p className={styles.heroSubtitle}>Truy vấn đáng ngờ, quét cổng, brute-force… trong 24h gần nhất.</p>
      </div>

      <div className={styles.kpiRow}>
        <div className={styles.kpiTile}>
          <div className={styles.kpiLabel}>Sự kiện bảo mật (24h)</div>
          <div className={styles.kpiValue}>{summary?.total24h ?? "—"}</div>
        </div>
      </div>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Xu hướng · 24 giờ</h2>
        </div>
        <div className={styles.chartCard}>
          {buckets.length > 1 ? (
            <LineChart data={buckets.map((b) => ({ x: b.bucket, y: b.count }))} tone="serious" seriesLabel="Sự kiện" formatX={formatHm} height={200} />
          ) : (
            <div className={styles.empty}>Chưa đủ dữ liệu.</div>
          )}
        </div>
      </section>

      <section className={styles.twoCol}>
        <div>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>Top IP</h2>
          </div>
          <div className={styles.list}>
            {(summary?.topIps ?? []).length === 0 ? <div className={styles.empty}>Không có dữ liệu.</div> : null}
            {(summary?.topIps ?? []).map((row) => (
              <div key={row.clientIp} className={styles.row}>
                <span className={styles.rowLabel}>{row.clientIp}</span>
                <span className={styles.rowCount}>{row.count}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>Top path</h2>
          </div>
          <div className={styles.list}>
            {(summary?.topPaths ?? []).length === 0 ? <div className={styles.empty}>Không có dữ liệu.</div> : null}
            {(summary?.topPaths ?? []).map((row) => (
              <div key={row.path} className={styles.row}>
                <span className={styles.rowLabel}>{row.path}</span>
                <span className={styles.rowCount}>{row.count}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Top user agent</h2>
        </div>
        <div className={styles.list}>
          {(summary?.topUserAgents ?? []).length === 0 ? <div className={styles.empty}>Không có dữ liệu.</div> : null}
          {(summary?.topUserAgents ?? []).map((row) => (
            <div key={row.userAgent} className={styles.row}>
              <span className={styles.rowLabel}>{row.userAgent}</span>
              <span className={styles.rowCount}>{row.count}</span>
            </div>
          ))}
        </div>
      </section>

      <div className={styles.tip}>
        Gợi ý: chặn ở Nginx Proxy Manager (block <code>/xmlrpc.php</code>, <code>/.env</code>, <code>/.git</code>) và rate-limit
        <code> /api/auth/login</code>.
      </div>
    </div>
  );
}
