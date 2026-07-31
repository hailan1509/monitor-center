import { useEffect, useState } from "react";
import type { LogEvent } from "@monitor-center/shared";
import { api } from "../lib/api";
import styles from "./LogDetailModal.module.css";

function formatFull(iso: string) {
  return new Date(iso).toLocaleString();
}

export function LogDetailModal({ log, onClose }: { log: LogEvent | null; onClose: () => void }) {
  const [status, setStatus] = useState("");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");

  // Reset the AI explanation when a different log is opened.
  useEffect(() => {
    setStatus("");
    setAnswer("");
    setError("");
  }, [log?.id]);

  if (!log) return null;

  async function handleExplain() {
    if (!log) return;
    setError("");
    setAnswer("");
    setStatus("Đang xếp hàng…");

    try {
      const logTime = new Date(log.timestamp).getTime();
      const started = await api.startAssistantJob({
        question: `Giải thích ngắn gọn dòng log này và nguyên nhân khả dĩ (service "${log.service}", mức "${log.level}"): "${log.message}"`,
        project: log.project,
        start: new Date(logTime - 30 * 60 * 1000).toISOString(),
        end: new Date(logTime + 30 * 60 * 1000).toISOString(),
        tier: "cheap"
      });
      const startedAt = Date.now();
      const hardTimeoutMs = 180_000;

      while (true) {
        const job = await api.getAssistantJob(started.jobId);
        setStatus(job.progress ?? job.status);

        if (job.status === "done" && job.result) {
          setAnswer(job.result.answer);
          setStatus("");
          return;
        }
        if (job.status === "error") {
          throw new Error(job.error ?? "Assistant failed");
        }
        if (Date.now() - startedAt > hardTimeoutMs) {
          throw new Error("Quá thời gian chờ, thử lại sau.");
        }
        await new Promise((resolve) => setTimeout(resolve, 900));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không giải thích được log này");
      setStatus("");
    }
  }

  const busy = status !== "" && !answer && !error;

  return (
    <div
      className={styles.overlay}
      role="button"
      tabIndex={0}
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className={styles.modal} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className={styles.head}>
          <div className={styles.title}>Chi tiết log</div>
          <button type="button" className={styles.closeBtn} onClick={onClose}>
            Đóng
          </button>
        </div>
        <div className={styles.body}>
          <div className={styles.kv}>
            <div className={styles.k}>Thời gian</div>
            <div className={styles.v}>{formatFull(log.timestamp)}</div>
            <div className={styles.k}>Project</div>
            <div className={styles.v}>{log.project}</div>
            <div className={styles.k}>Container</div>
            <div className={styles.v}>{log.containerName}</div>
            <div className={styles.k}>Service</div>
            <div className={styles.v}>{log.service}</div>
            <div className={styles.k}>Level</div>
            <div className={styles.v}>
              <span className={`${styles.levelBadge} ${styles["level-" + log.level]}`}>{log.level}</span>
            </div>
            <div className={styles.k}>Stream</div>
            <div className={styles.v}>{log.stream}</div>
          </div>
          <div className={styles.label}>Message</div>
          <pre className={styles.code}>{log.message}</pre>

          <div className={styles.explainRow}>
            <button type="button" className={styles.explainBtn} onClick={() => void handleExplain()} disabled={busy}>
              {busy ? "Đang phân tích…" : "🤖 Giải thích bằng AI"}
            </button>
            {status ? <span className={styles.explainStatus}>{status}</span> : null}
          </div>
          {error ? <div className={styles.explainError}>{error}</div> : null}
          {answer ? <div className={styles.explainAnswer}>{answer}</div> : null}

          <div className={styles.label}>Raw</div>
          <pre className={styles.code}>{log.raw}</pre>
          <div className={styles.label}>Metadata</div>
          <pre className={styles.code}>{JSON.stringify(log.metadata ?? {}, null, 2)}</pre>
        </div>
      </div>
    </div>
  );
}
