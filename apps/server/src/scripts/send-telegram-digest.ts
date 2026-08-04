import Docker from "dockerode";
import { env } from "../config/env.js";
import { ensureDatabaseReady } from "../db/bootstrap.js";
import { runDailyTelegramDigestOnce } from "../services/telegram-daily-report.js";
import { ingestTelegramUpdatesOnce } from "../services/telegram-updates-poller.js";

async function main() {
  await ensureDatabaseReady();
  if (env.TELEGRAM_BOT_TOKEN) {
    const docker = new Docker({ socketPath: env.DOCKER_SOCKET_PATH });
    await ingestTelegramUpdatesOnce(env.TELEGRAM_BOT_TOKEN, docker);
  }
  await runDailyTelegramDigestOnce();
  console.log("Telegram digest sent.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
