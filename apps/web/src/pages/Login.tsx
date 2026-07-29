import { useState } from "react";
import styles from "./Login.module.css";

function readInitialTheme(): "light" | "dark" {
  const attr = document.documentElement.getAttribute("data-theme");
  return attr === "dark" ? "dark" : "light";
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 4a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0V5a1 1 0 0 1 1-1Zm0 5a3 3 0 1 1 0 6a3 3 0 0 1 0-6Zm7 2a1 1 0 0 1 1 1h1a1 1 0 1 1 0 2h-1a1 1 0 1 1 0-2h-1a1 1 0 0 1 1-1Zm-14 1a1 1 0 0 1-1 1H3a1 1 0 1 1 0-2h1a1 1 0 0 1 1 1Zm11.66-6.66a1 1 0 0 1 1.42 0l.7.71a1 1 0 0 1-1.42 1.41l-.7-.7a1 1 0 0 1 0-1.42ZM6.22 16.95a1 1 0 0 1 1.41 0l.71.71a1 1 0 1 1-1.41 1.41l-.71-.7a1 1 0 0 1 0-1.42Zm11.13.71a1 1 0 0 1 1.41-1.42l.71.71a1 1 0 0 1-1.41 1.41l-.71-.7ZM7.63 6.22a1 1 0 0 1-1.41 1.41l-.71-.7a1 1 0 0 1 1.41-1.42l.71.71ZM12 17a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0v-1a1 1 0 0 1 1-1Z"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M20.4 14.7A8.5 8.5 0 0 1 9.3 3.6a1 1 0 0 0-1.2-1.3A10.5 10.5 0 1 0 21.7 15.9a1 1 0 0 0-1.3-1.2Z" />
    </svg>
  );
}

type LoginProps = {
  onLogin: (email: string, password: string) => Promise<void>;
};

export function Login({ onLogin }: LoginProps) {
  const [theme, setTheme] = useState(readInitialTheme);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function toggleTheme() {
    setTheme((current) => {
      const next = current === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      window.localStorage.setItem("mc:theme", next);
      return next;
    });
  }

  async function handleSubmit(formData: FormData) {
    setError("");
    setSubmitting(true);
    try {
      await onLogin(String(formData.get("email")), String(formData.get("password")));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Đăng nhập thất bại");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.page}>
      <button type="button" className={styles.themeToggle} onClick={toggleTheme} aria-label="Đổi giao diện">
        {theme === "dark" ? <SunIcon /> : <MoonIcon />}
      </button>
      <div className={styles.card}>
        <div className={styles.mark}>MC</div>
        <h1 className={styles.title}>Monitor Center</h1>
        <p className={styles.subtitle}>Đăng nhập để theo dõi log & hệ thống của bạn.</p>

        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit(new FormData(event.currentTarget));
          }}
        >
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Email</span>
            <input name="email" type="email" autoComplete="username" placeholder="you@company.com" required />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Mật khẩu</span>
            <input name="password" type="password" autoComplete="current-password" placeholder="••••••••" required />
          </label>
          {error ? <div className={styles.error}>{error}</div> : null}
          <button type="submit" className={styles.submit} disabled={submitting}>
            {submitting ? "Đang đăng nhập…" : "Đăng nhập"}
          </button>
        </form>
      </div>
    </div>
  );
}
