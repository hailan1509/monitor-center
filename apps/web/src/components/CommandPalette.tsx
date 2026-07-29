import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import styles from "./CommandPalette.module.css";

const staticItems = [
  { label: "Overview", path: "/" },
  { label: "Logs", path: "/logs" },
  { label: "Issues", path: "/issues" },
  { label: "Security", path: "/security" },
  { label: "Containers", path: "/containers" },
  { label: "Uptime", path: "/uptime" },
  { label: "AI Assistant", path: "/assistant" },
  { label: "Team", path: "/team" },
  { label: "Settings", path: "/settings" }
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [projects, setProjects] = useState<string[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const isMeta = event.metaKey || event.ctrlKey;
      if (isMeta && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((v) => !v);
      } else if (event.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (open && projects.length === 0) {
      void api.overview().then((r) => setProjects(r.projects.map((p) => p.project)));
    }
    if (open) {
      setQuery("");
      setActiveIndex(0);
    }
  }, [open, projects.length]);

  const items = useMemo(() => {
    const projectItems = projects.map((p) => ({ label: `Project: ${p}`, path: `/projects/${encodeURIComponent(p)}` }));
    const all = [...staticItems, ...projectItems];
    if (!query.trim()) return all;
    const q = query.toLowerCase();
    return all.filter((item) => item.label.toLowerCase().includes(q));
  }, [projects, query]);

  function go(path: string) {
    setOpen(false);
    navigate(path);
  }

  if (!open) return null;

  return (
    <div
      className={styles.overlay}
      role="button"
      tabIndex={0}
      onClick={() => setOpen(false)}
      onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
    >
      <div className={styles.palette} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActiveIndex((i) => Math.min(items.length - 1, i + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActiveIndex((i) => Math.max(0, i - 1));
            } else if (e.key === "Enter" && items[activeIndex]) {
              go(items[activeIndex].path);
            }
          }}
          placeholder="Đi tới trang hoặc project… (Esc để đóng)"
          className={styles.input}
        />
        <div className={styles.list}>
          {items.length === 0 ? <div className={styles.empty}>Không tìm thấy.</div> : null}
          {items.map((item, index) => (
            <button
              key={item.path}
              type="button"
              className={index === activeIndex ? `${styles.item} ${styles.itemActive}` : styles.item}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => go(item.path)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
