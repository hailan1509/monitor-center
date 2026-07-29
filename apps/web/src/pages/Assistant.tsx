import { useEffect, useState } from "react";
import { api } from "../lib/api";
import styles from "./Assistant.module.css";

export function Assistant() {
  const [projects, setProjects] = useState<string[]>([]);
  const [project, setProject] = useState("");
  const [question, setQuestion] = useState("Project nào đang lỗi nhiều nhất hôm nay?");
  const [answer, setAnswer] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.overview().then((r) => setProjects(r.projects.map((p) => p.project)));
  }, []);

  async function handleAsk() {
    setError("");
    setAnswer("");
    setStatus("Đang xếp hàng…");
    setBusy(true);
    try {
      const started = await api.startAssistantJob({ question, ...(project ? { project } : {}) });
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
      setError(err instanceof Error ? err.message : "Assistant failed");
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className={styles.heroRow}>
        <h1 className={styles.heroTitle}>AI Assistant</h1>
        <p className={styles.heroSubtitle}>Hỏi về tình trạng log, root cause, xu hướng lỗi bằng ngôn ngữ tự nhiên.</p>
      </div>

      <div className={styles.grid}>
        <div className={styles.inputCard}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Project</span>
            <select value={project} onChange={(e) => setProject(e.target.value)} className={styles.select}>
              <option value="">Tất cả project</option>
              {projects.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Câu hỏi</span>
            <textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={6} className={styles.textarea} />
          </label>
          <button type="button" className={styles.button} onClick={() => void handleAsk()} disabled={busy}>
            {busy ? "Đang hỏi…" : "Hỏi"}
          </button>
          <div className={styles.tip}>
            Gợi ý: "web nào lỗi 500 nhiều nhất?", "container nào restart bất thường?", "lỗi nào tăng đột biến trong 1h qua?"
          </div>
        </div>
        <div className={styles.outputCard}>
          <div className={styles.fieldLabel}>Trả lời</div>
          {status ? <div className={styles.status}>{status}</div> : null}
          {error ? <div className={styles.error}>{error}</div> : null}
          <pre className={styles.answer}>{answer || "—"}</pre>
        </div>
      </div>
    </div>
  );
}
