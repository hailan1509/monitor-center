import { useEffect, useRef, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import type { CurrentUser } from "../../lib/useAuth";
import styles from "./NavBar.module.css";

const primaryLinks = [
  { to: "/", label: "Overview", end: true },
  { to: "/logs", label: "Logs" },
  { to: "/issues", label: "Issues" },
  { to: "/security", label: "Security" },
  { to: "/containers", label: "Containers" },
  { to: "/uptime", label: "Uptime" },
  { to: "/assistant", label: "Assistant" }
];

function initialsFrom(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

type NavBarProps = {
  user: CurrentUser;
  connected: boolean;
  onLogout: () => void;
};

export function NavBar({ user, connected, onLogout }: NavBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function go(path: string) {
    setMenuOpen(false);
    setMobileOpen(false);
    navigate(path);
  }

  return (
    <header className={styles.nav}>
      <div className={styles.navInner}>
        <NavLink to="/" className={styles.brand}>
          Monitor Center
        </NavLink>

        <nav className={styles.links}>
          {primaryLinks.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) => (isActive ? `${styles.link} ${styles.linkActive}` : styles.link)}
            >
              {link.label}
            </NavLink>
          ))}
        </nav>

        <div className={connected ? `${styles.livePill} ${styles.livePillOn}` : styles.livePill}>
          <span className={styles.liveDot} />
          <span className={styles.liveText}>{connected ? "Realtime" : "Offline"}</span>
        </div>

        <span className={styles.kbdHint} title="Command palette">
          <kbd>⌘K</kbd>
        </span>

        <button
          type="button"
          className={styles.mobileToggle}
          onClick={() => setMobileOpen((v) => !v)}
          aria-label="Mở menu"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d="M4 6.75A.75.75 0 0 1 4.75 6h14.5a.75.75 0 0 1 0 1.5H4.75A.75.75 0 0 1 4 6.75Zm0 5.25a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H4.75A.75.75 0 0 1 4 12Zm0 5.25a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H4.75a.75.75 0 0 1-.75-.75Z" />
          </svg>
        </button>

        <div className={styles.avatarWrap} ref={menuRef}>
          <button type="button" className={styles.avatar} onClick={() => setMenuOpen((v) => !v)} aria-label="Tài khoản">
            {initialsFrom(user.displayName)}
          </button>
          {menuOpen ? (
            <div className={styles.dropdown} role="menu">
              <div className={styles.dropdownHead}>
                <div className={styles.dropdownName}>{user.displayName}</div>
                <div className={styles.dropdownEmail}>{user.email}</div>
              </div>
              <div className={styles.dropdownDivider} />
              {user.role === "admin" ? (
                <button type="button" className={styles.dropdownItem} onClick={() => go("/team")}>
                  Team
                </button>
              ) : null}
              <button type="button" className={styles.dropdownItem} onClick={() => go("/settings")}>
                Settings
              </button>
              <div className={styles.dropdownDivider} />
              <button type="button" className={styles.dropdownItem} onClick={onLogout}>
                Đăng xuất
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {mobileOpen ? (
        <div className={styles.mobilePanel}>
          {primaryLinks.map((link) => (
            <button key={link.to} type="button" className={styles.mobileLink} onClick={() => go(link.to)}>
              {link.label}
            </button>
          ))}
          <div className={styles.dropdownDivider} />
          {user.role === "admin" ? (
            <button type="button" className={styles.mobileLink} onClick={() => go("/team")}>
              Team
            </button>
          ) : null}
          <button type="button" className={styles.mobileLink} onClick={() => go("/settings")}>
            Settings
          </button>
          <button type="button" className={styles.mobileLink} onClick={onLogout}>
            Đăng xuất
          </button>
        </div>
      ) : null}
    </header>
  );
}
