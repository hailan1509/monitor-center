import { ensureDatabaseReady } from "../db/bootstrap.js";
import { runDailyTelegramDigestOnce } from "../services/telegram-daily-report.js";

async function main() {
  await ensureDatabaseReady();
  await runDailyTelegramDigestOnce();
  console.log("Telegram digest sent.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
