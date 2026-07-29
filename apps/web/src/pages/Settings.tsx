import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { LogPurgeRequest } from "@monitor-center/shared";
import { api } from "../lib/api";
import type { CurrentUser } from "../lib/useAuth";
import styles from "./Settings.module.css";

type Silence = { project: string; service: string | null; expiresAt: number; remainingMs: number };

export function Settings({ user }: { user: CurrentUser }) {
  const [projects, setProjects] = useState<string[]>([]);
  const [silences, setSilences] = useState<Silence[]>([]);
  const [silenceError, setSilenceError] = useState("");
  const [purgePreview, setPurgePreview] = useState<number | null>(null);
  const [purgeStatus, setPurgeStatus] = useState("");
  const [purgeError, setPurgeError] = useState("");
  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwStatus, setPwStatus] = useState("");
  const [pwError, setPwError] = useState("");

  const isAdmin = user.role === "admin";

  function refreshSilences() {
    void api.listSilences().then((r) => setSilences(r.silences));
  }

  useEffect(() => {
    void api.overview().then((r) => setProjects(r.projects.map((p) => p.project)));
    if (isAdmin) refreshSilences();
  }, [isAdmin]);

  async function handleAddSilence(formData: FormData) {
    setSilenceError("");
    try {
      const project = String(formData.get("project") ?? "");
      const service = String(formData.get("service") ?? "").trim() || null;
      const durationMs = Number(formData.get("durationMs"));
      await api.addSilence({ project, service, durationMs });
      refreshSilences();
    } catch (err) {
      setSilenceError(err instanceof Error ? err.message : "Không thể thêm silence");
    }
  }

  async function handleRemoveSilence(project: string, service: string | null) {
    await api.removeSilence({ project, service });
    refreshSilences();
  }

  async function handlePurge(formData: FormData) {
    setPurgeError("");
    setPurgeStatus("");
    try {
      const payload: LogPurgeRequest = {
        project: String(formData.get("project") ?? "") || undefined,
        category: (String(formData.get("category") ?? "") as "security" | "system") || undefined,
        level: (String(formData.get("level") ?? "") as LogPurgeRequest["level"]) || undefined,
        before: String(formData.get("before") ?? "") || undefined,
        start: String(formData.get("start") ?? "") || undefined,
        end: String(formData.get("end") ?? "") || undefined,
        dryRun: true
      };

      const preview = await api.purgeLogs(payload);
      setPurgePreview(preview.affected);
      if (preview.affected === 0) {
        setPurgeStatus("Không có log nào khớp filter.");
        return;
      }
      const confirmed = window.confirm(`Thao tác này sẽ xoá ${preview.affected} dòng log. Tiếp tục?`);
      if (!confirmed) {
        setPurgeStatus("Đã huỷ.");
        return;
      }
      const result = await api.purgeLogs({ ...payload, dryRun: false });
      setPurgeStatus(`Đã xoá ${result.affected} dòng log.`);
      setPurgePreview(null);
    } catch (err) {
      setPurgeError(err instanceof Error ? err.message : "Không thể xoá log");
    }
  }

  async function handleChangePassword(event: FormEvent) {
    event.preventDefault();
    setPwError("");
    setPwStatus("");
    try {
      await api.changePassword({ currentPassword: pwCurrent, newPassword: pwNew });
      setPwStatus("Đổi mật khẩu thành công.");
      setPwCurrent("");
      setPwNew("");
    } catch (err) {
      setPwError(err instanceof Error ? err.message : "Không thể đổi mật khẩu");
    }
  }

  return (
    <div>
      <div className={styles.heroRow}>
        <h1 className={styles.heroTitle}>Settings</h1>
        <p className={styles.heroSubtitle}>Tài khoản, bảo trì, và dọn dẹp log.</p>
      </div>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Đổi mật khẩu</h2>
        <form className={styles.card} onSubmit={handleChangePassword}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Mật khẩu hiện tại</span>
            <input type="password" value={pwCurrent} onChange={(e) => setPwCurrent(e.target.value)} required className={styles.input} />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Mật khẩu mới</span>
            <input type="password" value={pwNew} onChange={(e) => setPwNew(e.target.value)} required minLength={6} className={styles.input} />
          </label>
          {pwError ? <div className={styles.error}>{pwError}</div> : null}
          {pwStatus ? <div className={styles.success}>{pwStatus}</div> : null}
          <button type="submit" className={styles.button}>
            Cập nhật mật khẩu
          </button>
        </form>
      </section>

      {isAdmin ? (
        <>
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Silence / bảo trì</h2>
            <div className={styles.twoCol}>
              <form
                className={styles.card}
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleAddSilence(new FormData(e.currentTarget));
                  e.currentTarget.reset();
                }}
              >
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Project</span>
                  <select name="project" required defaultValue="" className={styles.input}>
                    <option value="" disabled>
                      Chọn project
                    </option>
                    {projects.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Service (để trống = cả project)</span>
                  <input name="service" placeholder="vd: api, nginx…" className={styles.input} />
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Thời gian</span>
                  <select name="durationMs" defaultValue="600000" className={styles.input}>
                    <option value="600000">10 phút</option>
                    <option value="1800000">30 phút</option>
                    <option value="3600000">1 giờ</option>
                    <option value="7200000">2 giờ</option>
                    <option value="28800000">8 giờ</option>
                    <option value="86400000">24 giờ</option>
                  </select>
                </label>
                {silenceError ? <div className={styles.error}>{silenceError}</div> : null}
                <button type="submit" className={styles.button}>
                  Thêm silence
                </button>
              </form>

              <div className={styles.card}>
                <div className={styles.cardTitle}>{silences.length} đang active</div>
                {silences.length === 0 ? <div className={styles.empty}>Không có silence nào.</div> : null}
                {silences.map((s) => (
                  <div key={`${s.project}::${s.service ?? "*"}`} className={styles.silenceRow}>
                    <div>
                      <div className={styles.rowName}>{s.project}</div>
                      <div className={styles.rowMeta}>{s.service ?? "cả project"} · còn {Math.ceil(s.remainingMs / 60000)} phút</div>
                    </div>
                    <button type="button" className={styles.smallBtn} onClick={() => void handleRemoveSilence(s.project, s.service)}>
                      Xoá
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Log cleanup</h2>
            <form
              className={styles.card}
              onSubmit={(e) => {
                e.preventDefault();
                void handlePurge(new FormData(e.currentTarget));
              }}
            >
              <div className={styles.row3}>
                <select name="project" defaultValue="" className={styles.input}>
                  <option value="">Tất cả project</option>
                  {projects.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
                <select name="category" defaultValue="" className={styles.input}>
                  <option value="">Tất cả category</option>
                  <option value="system">system</option>
                  <option value="security">security</option>
                </select>
                <select name="level" defaultValue="" className={styles.input}>
                  <option value="">Tất cả level</option>
                  <option value="fatal">fatal</option>
                  <option value="error">error</option>
                  <option value="warn">warn</option>
                  <option value="info">info</option>
                </select>
              </div>
              <div className={styles.row3}>
                <input name="before" placeholder="before (ISO)" className={styles.input} />
                <input name="start" placeholder="start (ISO)" className={styles.input} />
                <input name="end" placeholder="end (ISO)" className={styles.input} />
              </div>
              {purgeError ? <div className={styles.error}>{purgeError}</div> : null}
              <button type="submit" className={styles.buttonDanger}>
                Preview & Xoá
              </button>
              {purgePreview !== null ? <div className={styles.hint}>Preview: {purgePreview} dòng khớp.</div> : null}
              {purgeStatus ? <div className={styles.hint}>{purgeStatus}</div> : null}
            </form>
          </section>
        </>
      ) : null}
    </div>
  );
}
