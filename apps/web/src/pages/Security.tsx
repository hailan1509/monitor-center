import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { LineChart } from "../components/charts/LineChart";
import type { CurrentUser } from "../lib/useAuth";
import styles from "./Security.module.css";

type Summary = {
  total24h: number;
  topIps: Array<{ clientIp: string; count: number }>;
  topPaths: Array<{ path: string; count: number }>;
  topUserAgents: Array<{ userAgent: string; count: number }>;
};

type BlockedIp = { ip: string; reason: string | null; blockedBy: string | null; createdAt: string };

function formatHm(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function formatFull(iso: string) {
  return new Date(iso).toLocaleString();
}

export function Security({ user }: { user: CurrentUser }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [buckets, setBuckets] = useState<Array<{ bucket: string; count: number }>>([]);
  const [blockedIps, setBlockedIps] = useState<BlockedIp[]>([]);
  const [manualIp, setManualIp] = useState("");
  const [manualReason, setManualReason] = useState("");
  const [busyIp, setBusyIp] = useState<string | null>(null);
  const [blockError, setBlockError] = useState("");

  const isAdmin = user.role === "admin";

  function refreshBlockedIps() {
    void api.listBlockedIps().then((r) => setBlockedIps(r.blockedIps));
  }

  useEffect(() => {
    void api.securitySummary().then(setSummary);
    void api.securityTimeseries({ hours: 24, bucketMinutes: 60 }).then((r) => setBuckets(r.buckets));
    refreshBlockedIps();
  }, []);

  const blockedSet = new Set(blockedIps.map((b) => b.ip));

  async function handleBlock(ip: string, reason?: string) {
    setBlockError("");
    setBusyIp(ip);
    try {
      await api.blockIp({ ip, reason: reason || undefined });
      refreshBlockedIps();
      if (ip === manualIp) {
        setManualIp("");
        setManualReason("");
      }
    } catch (err) {
      setBlockError(err instanceof Error ? err.message : "Không chặn được IP này");
    } finally {
      setBusyIp(null);
    }
  }

  async function handleUnblock(ip: string) {
    setBlockError("");
    setBusyIp(ip);
    try {
      await api.unblockIp(ip);
      refreshBlockedIps();
    } catch (err) {
      setBlockError(err instanceof Error ? err.message : "Không bỏ chặn được IP này");
    } finally {
      setBusyIp(null);
    }
  }

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
                {isAdmin ? (
                  blockedSet.has(row.clientIp) ? (
                    <span className={styles.blockedBadge}>Đã chặn</span>
                  ) : (
                    <button
                      type="button"
                      className={styles.blockBtn}
                      disabled={busyIp === row.clientIp}
                      onClick={() => void handleBlock(row.clientIp, `Top IP nghi ngờ (${row.count} sự kiện/24h)`)}
                    >
                      {busyIp === row.clientIp ? "Đang chặn…" : "Chặn"}
                    </button>
                  )
                ) : null}
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

      {isAdmin ? (
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>IP bị chặn (firewall VPS)</h2>
          </div>

          <form
            className={styles.blockForm}
            onSubmit={(e) => {
              e.preventDefault();
              if (manualIp.trim()) void handleBlock(manualIp.trim(), manualReason.trim());
            }}
          >
            <input
              value={manualIp}
              onChange={(e) => setManualIp(e.target.value)}
              placeholder="Nhập IP cần chặn (vd: 1.2.3.4)"
              className={styles.blockInput}
            />
            <input
              value={manualReason}
              onChange={(e) => setManualReason(e.target.value)}
              placeholder="Lý do (tùy chọn)"
              className={styles.blockInput}
            />
            <button type="submit" className={styles.button} disabled={!manualIp.trim() || busyIp === manualIp.trim()}>
              {busyIp === manualIp.trim() ? "Đang chặn…" : "Chặn IP"}
            </button>
          </form>
          {blockError ? <div className={styles.blockErrorMsg}>{blockError}</div> : null}

          <div className={styles.list}>
            {blockedIps.length === 0 ? <div className={styles.empty}>Chưa chặn IP nào.</div> : null}
            {blockedIps.map((b) => (
              <div key={b.ip} className={styles.row}>
                <span className={styles.rowLabel}>{b.ip}</span>
                <span className={styles.blockedMeta}>
                  {b.reason ? `${b.reason} · ` : ""}
                  {formatFull(b.createdAt)}
                  {b.blockedBy ? ` · ${b.blockedBy}` : ""}
                </span>
                <button type="button" className={styles.unblockBtn} disabled={busyIp === b.ip} onClick={() => void handleUnblock(b.ip)}>
                  {busyIp === b.ip ? "Đang bỏ chặn…" : "Bỏ chặn"}
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <div className={styles.tip}>
        Gợi ý: chặn ở Nginx Proxy Manager (block <code>/xmlrpc.php</code>, <code>/.env</code>, <code>/.git</code>) và rate-limit
        <code> /api/auth/login</code>.
      </div>
    </div>
  );
}
