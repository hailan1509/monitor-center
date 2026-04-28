import bcrypt from "bcryptjs";
import { pool } from "./index.js";
import { baseSchemaSql, partitionSql } from "./schema.js";

export async function ensureDatabaseReady() {
  await pool.query(baseSchemaSql);

  const today = new Date();
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await pool.query(partitionSql(today));
  await pool.query(partitionSql(tomorrow));

  const existing = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = $1 LIMIT 1", [
    "admin@monitor.local"
  ]);

  if (existing.rowCount === 0) {
    const passwordHash = await bcrypt.hash("admin123!", 10);
    await pool.query(
      `
      INSERT INTO users (email, password_hash, display_name, role)
      VALUES ($1, $2, $3, $4)
      `,
      ["admin@monitor.local", passwordHash, "System Admin", "admin"]
    );
  }
}
