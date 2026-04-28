import { ensureDatabaseReady } from "../db/bootstrap.js";
import { pool } from "../db/index.js";

async function main() {
  await ensureDatabaseReady();
  console.log("Database initialized. Seed admin: admin@monitor.local / admin123!");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
