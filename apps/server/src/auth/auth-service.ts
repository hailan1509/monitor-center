import bcrypt from "bcryptjs";
import type { UserRole } from "@monitor-center/shared";
import { query } from "../db/index.js";

type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  role: UserRole;
};

export async function verifyUser(email: string, password: string) {
  const result = await query<UserRow>(
    `
    SELECT id, email, password_hash, display_name, role
    FROM users
    WHERE email = $1
    LIMIT 1
    `,
    [email]
  );

  const user = result.rows[0];
  if (!user) {
    return null;
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    role: user.role
  };
}

export async function listUsers() {
  const result = await query<{
    id: string;
    email: string;
    display_name: string;
    role: UserRole;
    created_at: string;
  }>(
    `
    SELECT id, email, display_name, role, created_at
    FROM users
    ORDER BY created_at ASC
    `
  );

  return result.rows.map((row) => ({
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    createdAt: row.created_at
  }));
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string): Promise<"ok" | "invalid-current"> {
  const result = await query<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id = $1 LIMIT 1`, [userId]);
  const row = result.rows[0];
  if (!row) {
    return "invalid-current";
  }

  const valid = await bcrypt.compare(currentPassword, row.password_hash);
  if (!valid) {
    return "invalid-current";
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await query(`UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, [passwordHash, userId]);
  return "ok";
}

/** Admin-initiated edit of another (or their own) user — no current-password check, unlike self-service changePassword. */
export async function updateUser(
  id: string,
  input: { email?: string; displayName?: string; role?: UserRole; password?: string }
) {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (input.email !== undefined) {
    values.push(input.email);
    sets.push(`email = $${values.length}`);
  }
  if (input.displayName !== undefined) {
    values.push(input.displayName);
    sets.push(`display_name = $${values.length}`);
  }
  if (input.role !== undefined) {
    values.push(input.role);
    sets.push(`role = $${values.length}`);
  }
  if (input.password !== undefined) {
    values.push(await bcrypt.hash(input.password, 10));
    sets.push(`password_hash = $${values.length}`);
  }

  if (sets.length === 0) {
    return;
  }

  sets.push(`updated_at = NOW()`);
  values.push(id);

  await query(
    `UPDATE users SET ${sets.join(", ")} WHERE id = $${values.length}`,
    values
  );
}

export async function createUser(input: { email: string; password: string; displayName: string; role: UserRole }) {
  const passwordHash = await bcrypt.hash(input.password, 10);
  const result = await query<{ id: string }>(
    `
    INSERT INTO users (email, password_hash, display_name, role)
    VALUES ($1, $2, $3, $4)
    RETURNING id
    `,
    [input.email, passwordHash, input.displayName, input.role]
  );

  return result.rows[0];
}
