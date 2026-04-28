import { Pool, type QueryResultRow } from "pg";
import { env } from "../config/env.js";

export const pool = new Pool({
  connectionString: env.DATABASE_URL
});

export async function query<T extends QueryResultRow>(text: string, params?: unknown[]) {
  const result = await pool.query<T>(text, params);
  return result;
}

export async function withTransaction<T>(callback: (client: import("pg").PoolClient) => Promise<T>) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
