import { Link } from "react-router-dom";
import { useToast } from "../lib/ToastContext";
import styles from "./ToastStack.module.css";

export function ToastStack() {
  const { toasts, dismiss } = useToast();
  if (toasts.length === 0) return null;

  return (
    <div className={styles.stack}>
      {toasts.map((toast) => (
        <div key={toast.id} className={`${styles.toast} ${styles["tone-" + toast.tone]}`} role="status">
          <div className={styles.toastBody}>
            <div className={styles.toastTitle}>{toast.title}</div>
            <div className={styles.toastMessage}>{toast.message}</div>
          </div>
          <Link to="/logs" className={styles.toastLink} onClick={() => dismiss(toast.id)}>
            Xem
          </Link>
          <button type="button" className={styles.toastClose} onClick={() => dismiss(toast.id)} aria-label="Đóng">
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
