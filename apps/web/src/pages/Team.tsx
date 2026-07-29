import { useEffect, useState } from "react";
import type { UserRole } from "@monitor-center/shared";
import { api } from "../lib/api";
import type { CurrentUser } from "../lib/useAuth";
import styles from "./Team.module.css";

type User = { id: string; email: string; displayName: string; role: UserRole; createdAt: string };

export function Team({ user }: { user: CurrentUser }) {
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [editError, setEditError] = useState("");
  const [editSubmitting, setEditSubmitting] = useState(false);

  function refresh() {
    void api.users().then((r) => setUsers(r.users));
  }

  useEffect(() => {
    if (user.role === "admin") refresh();
  }, [user.role]);

  if (user.role !== "admin") {
    return (
      <div className={styles.denied}>
        <h1 className={styles.heroTitle}>Team</h1>
        <p className={styles.heroSubtitle}>Chỉ admin mới có quyền truy cập trang này.</p>
      </div>
    );
  }

  async function handleCreate(formData: FormData) {
    setError("");
    setSubmitting(true);
    try {
      await api.createUser({
        email: String(formData.get("email")),
        password: String(formData.get("password")),
        displayName: String(formData.get("displayName")),
        role: String(formData.get("role")) as UserRole
      });
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể tạo user");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdate(formData: FormData) {
    if (!editing) return;
    setEditError("");
    setEditSubmitting(true);
    try {
      const password = String(formData.get("password") ?? "").trim();
      await api.updateUser(editing.id, {
        displayName: String(formData.get("displayName")),
        email: String(formData.get("email")),
        role: String(formData.get("role")) as UserRole,
        ...(password ? { password } : {})
      });
      setEditing(null);
      refresh();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Không thể cập nhật user");
    } finally {
      setEditSubmitting(false);
    }
  }

  return (
    <div>
      <div className={styles.heroRow}>
        <h1 className={styles.heroTitle}>Team</h1>
        <p className={styles.heroSubtitle}>Quản lý tài khoản truy cập dashboard.</p>
      </div>

      <div className={styles.grid}>
        <div className={styles.card}>
          <div className={styles.cardTitle}>Thêm user</div>
          <form
            className={styles.form}
            onSubmit={(e) => {
              e.preventDefault();
              void handleCreate(new FormData(e.currentTarget));
              e.currentTarget.reset();
            }}
          >
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Tên hiển thị</span>
              <input name="displayName" required className={styles.input} />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Email</span>
              <input name="email" type="email" required className={styles.input} />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Mật khẩu</span>
              <input name="password" type="password" required minLength={6} className={styles.input} />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Vai trò</span>
              <select name="role" defaultValue="viewer" className={styles.input}>
                <option value="viewer">viewer</option>
                <option value="admin">admin</option>
              </select>
            </label>
            {error ? <div className={styles.error}>{error}</div> : null}
            <button type="submit" className={styles.button} disabled={submitting}>
              {submitting ? "Đang tạo…" : "Tạo user"}
            </button>
          </form>
        </div>

        <div className={styles.card}>
          <div className={styles.cardTitle}>{users.length} tài khoản</div>
          <div className={styles.list}>
            {users.map((u) => (
              <div key={u.id} className={styles.row}>
                <div className={styles.rowMain}>
                  <div className={styles.rowName}>{u.displayName}</div>
                  <div className={styles.rowEmail}>{u.email}</div>
                </div>
                <span className={`${styles.roleBadge} ${u.role === "admin" ? styles.roleAdmin : ""}`}>{u.role}</span>
                <button type="button" className={styles.editBtn} onClick={() => setEditing(u)}>
                  Sửa
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {editing ? (
        <div
          className={styles.overlay}
          role="button"
          tabIndex={0}
          onClick={() => setEditing(null)}
          onKeyDown={(e) => e.key === "Escape" && setEditing(null)}
        >
          <div className={styles.modal} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHead}>
              <div className={styles.modalTitle}>Sửa user</div>
              <button type="button" className={styles.closeBtn} onClick={() => setEditing(null)}>
                Đóng
              </button>
            </div>
            <form
              className={styles.modalBody}
              onSubmit={(e) => {
                e.preventDefault();
                void handleUpdate(new FormData(e.currentTarget));
              }}
            >
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Tên hiển thị</span>
                <input name="displayName" defaultValue={editing.displayName} required className={styles.input} />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Email</span>
                <input name="email" type="email" defaultValue={editing.email} required className={styles.input} />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Vai trò</span>
                <select name="role" defaultValue={editing.role} className={styles.input}>
                  <option value="viewer">viewer</option>
                  <option value="admin">admin</option>
                </select>
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Mật khẩu mới (để trống nếu không đổi)</span>
                <input name="password" type="password" minLength={6} placeholder="••••••••" className={styles.input} />
              </label>
              {editError ? <div className={styles.error}>{editError}</div> : null}
              <button type="submit" className={styles.button} disabled={editSubmitting}>
                {editSubmitting ? "Đang lưu…" : "Lưu thay đổi"}
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
