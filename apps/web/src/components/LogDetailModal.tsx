import type { LogEvent } from "@monitor-center/shared";
import styles from "./LogDetailModal.module.css";

function formatFull(iso: string) {
  return new Date(iso).toLocaleString();
}

export function LogDetailModal({ log, onClose }: { log: LogEvent | null; onClose: () => void }) {
  if (!log) return null;

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
          <div className={styles.label}>Raw</div>
          <pre className={styles.code}>{log.raw}</pre>
          <div className={styles.label}>Metadata</div>
          <pre className={styles.code}>{JSON.stringify(log.metadata ?? {}, null, 2)}</pre>
        </div>
      </div>
    </div>
  );
}
