import { useEffect, useRef, useState } from "react";
import type { ChatTurn } from "@monitor-center/shared";
import { api } from "../lib/api";
import styles from "./Assistant.module.css";

export function Assistant() {
  const [projects, setProjects] = useState<string[]>([]);
  const [project, setProject] = useState("");
  const [question, setQuestion] = useState("Project nào đang lỗi nhiều nhất hôm nay?");
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const threadEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void api.overview().then((r) => setProjects(r.projects.map((p) => p.project)));
  }, []);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, status]);

  async function handleAsk() {
    const askedQuestion = question.trim();
    if (!askedQuestion) return;

    setError("");
    setStatus("Đang xếp hàng…");
    setBusy(true);
    const history = turns;
    setTurns([...history, { role: "user", text: askedQuestion }]);
    setQuestion("");

    try {
      const started = await api.startAssistantJob({
        question: askedQuestion,
        history,
        ...(project ? { project } : {})
      });
      const startedAt = Date.now();
      const hardTimeoutMs = 180_000;

      while (true) {
        const job = await api.getAssistantJob(started.jobId);
        setStatus(job.progress ?? job.status);

        if (job.status === "done" && job.result) {
          setTurns((prev) => [...prev, { role: "assistant", text: job.result!.answer }]);
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

  function handleNewConversation() {
    setTurns([]);
    setError("");
    setStatus("");
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
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              rows={6}
              className={styles.textarea}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void handleAsk();
                }
              }}
            />
          </label>
          <div className={styles.actionsRow}>
            <button type="button" className={styles.button} onClick={() => void handleAsk()} disabled={busy}>
              {busy ? "Đang hỏi…" : turns.length ? "Hỏi tiếp" : "Hỏi"}
            </button>
            {turns.length ? (
              <button type="button" className={styles.secondaryButton} onClick={handleNewConversation} disabled={busy}>
                Cuộc hội thoại mới
              </button>
            ) : null}
          </div>
          <div className={styles.tip}>
            Gợi ý: "web nào lỗi 500 nhiều nhất?", "container nào restart bất thường?", "lỗi nào tăng đột biến trong 1h qua?"
            <br />
            Có thể hỏi tiếp để AI nhớ ngữ cảnh cuộc hội thoại (Ctrl/Cmd+Enter để gửi nhanh).
          </div>
        </div>
        <div className={styles.outputCard}>
          <div className={styles.fieldLabel}>Trả lời</div>
          {error ? <div className={styles.error}>{error}</div> : null}
          <div className={styles.thread}>
            {turns.length === 0 && !status ? <div className={styles.empty}>—</div> : null}
            {turns.map((turn, index) => (
              <div key={index} className={turn.role === "user" ? styles.turnUser : styles.turnAssistant}>
                <div className={styles.turnRole}>{turn.role === "user" ? "Bạn" : "AI"}</div>
                <div className={styles.turnText}>{turn.text}</div>
              </div>
            ))}
            {status ? <div className={styles.status}>{status}</div> : null}
            <div ref={threadEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
}
