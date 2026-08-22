import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatTurn } from "@monitor-center/shared";
import { api } from "../lib/api";
import styles from "./Assistant.module.css";

const SUGGESTED_QUESTIONS = [
  "Hôm nay hệ thống có gì bất thường không?",
  "Project nào đang lỗi nhiều nhất, nguyên nhân khả dĩ là gì?",
  "Lỗi nào đang tăng đột biến trong 1 giờ qua?",
  "Có dấu hiệu bị quét/tấn công trong 24h qua không?",
  "Container nào đang ăn CPU/RAM nhiều nhất?"
];

export function Assistant() {
  const [projects, setProjects] = useState<string[]>([]);
  const [project, setProject] = useState("");
  const [deepAnalysis, setDeepAnalysis] = useState(false);
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const threadEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    void api.overview().then((r) => setProjects(r.projects.map((p) => p.project)));
  }, []);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, status]);

  async function handleAsk(overrideQuestion?: string) {
    const askedQuestion = (overrideQuestion ?? question).trim();
    if (!askedQuestion || busy) return;

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
        tier: deepAnalysis ? "strong" : "cheap",
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

  function handleSuggestionClick(text: string) {
    if (busy) return;
    void handleAsk(text);
  }

  return (
    <div>
      <div className={styles.heroRow}>
        <h1 className={styles.heroTitle}>AI Assistant</h1>
        <p className={styles.heroSubtitle}>
          Hỏi về tình trạng log, root cause, xu hướng lỗi bằng ngôn ngữ tự nhiên — AI sẽ tự tra cứu log, tổng quan hệ thống,
          xu hướng, bảo mật, CPU/RAM, uptime… theo đúng nhu cầu câu hỏi thay vì chỉ nhìn vào một khung log cố định.
        </p>
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
              ref={textareaRef}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Vd: web nào lỗi 500 nhiều nhất trong 2 giờ qua?"
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
          <label className={styles.checkboxField}>
            <input type="checkbox" checked={deepAnalysis} onChange={(e) => setDeepAnalysis(e.target.checked)} />
            <span>
              Phân tích sâu <span className={styles.checkboxHint}>(ưu tiên model mạnh hơn, chậm hơn — dùng khi cần điều tra kỹ)</span>
            </span>
          </label>
          <div className={styles.actionsRow}>
            <button type="button" className={styles.button} onClick={() => void handleAsk()} disabled={busy || !question.trim()}>
              {busy ? "Đang hỏi…" : turns.length ? "Hỏi tiếp" : "Hỏi"}
            </button>
            {turns.length ? (
              <button type="button" className={styles.secondaryButton} onClick={handleNewConversation} disabled={busy}>
                Cuộc hội thoại mới
              </button>
            ) : null}
          </div>

          {turns.length === 0 ? (
            <div className={styles.suggestions}>
              <span className={styles.fieldLabel}>Gợi ý câu hỏi</span>
              <div className={styles.suggestionChips}>
                {SUGGESTED_QUESTIONS.map((q) => (
                  <button
                    type="button"
                    key={q}
                    className={styles.suggestionChip}
                    onClick={() => handleSuggestionClick(q)}
                    disabled={busy}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className={styles.tip}>
            Có thể hỏi tiếp để AI nhớ ngữ cảnh cuộc hội thoại (Ctrl/Cmd+Enter để gửi nhanh).
          </div>
        </div>
        <div className={styles.outputCard}>
          <div className={styles.fieldLabel}>Trả lời</div>
          {error ? <div className={styles.error}>{error}</div> : null}
          <div className={styles.thread}>
            {turns.length === 0 && !status ? (
              <div className={styles.empty}>Chưa có cuộc trò chuyện nào — hãy đặt câu hỏi hoặc chọn gợi ý bên trái.</div>
            ) : null}
            {turns.map((turn, index) => (
              <div key={index} className={turn.role === "user" ? styles.turnUser : styles.turnAssistant}>
                <div className={styles.turnRole}>{turn.role === "user" ? "Bạn" : "AI"}</div>
                {turn.role === "assistant" ? (
                  <div className={styles.markdown}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{turn.text}</ReactMarkdown>
                  </div>
                ) : (
                  <div className={styles.turnText}>{turn.text}</div>
                )}
              </div>
            ))}
            {status ? (
              <div className={styles.statusRow}>
                <span className={styles.statusDots} aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
                <span>{status}</span>
              </div>
            ) : null}
            <div ref={threadEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
}
