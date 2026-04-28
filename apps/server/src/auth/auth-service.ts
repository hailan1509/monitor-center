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
