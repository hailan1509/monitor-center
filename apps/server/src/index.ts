import http from "node:http";
import express from "express";
import session from "express-session";
import pgSession from "connect-pg-simple";
import cors from "cors";
import { env } from "./config/env.js";
import { ensureDatabaseReady } from "./db/bootstrap.js";
import { createApiRouter } from "./api/routes.js";
import { RealtimeHub } from "./services/ws-hub.js";
import { DockerCollector } from "./collector/docker-collector.js";
import { pool } from "./db/index.js";
import { startTelegramDailyReportIfConfigured } from "./services/telegram-daily-report.js";
import {
  deleteTelegramWebhookIfRequested,
  startTelegramUpdatesPollerIfConfigured
} from "./services/telegram-updates-poller.js";
import { startContainerStatsPoller } from "./services/container-stats.js";
import { startUptimeChecker } from "./services/uptime-checker.js";
import { reapplyAllBlocks } from "./services/ip-blocklist.js";

async function main() {
  await ensureDatabaseReady();

  const app = express();
  app.use(
    cors({
      origin: true,
      credentials: true
    })
  );
  app.use(express.json({ limit: "1mb" }));

  const PgSessionStore = pgSession(session);
  app.use(
    session({
      secret: env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      store: new PgSessionStore({
        pool,
        tableName: "user_sessions",
        createTableIfMissing: true
      }),
      cookie: {
        secure: env.COOKIE_SECURE,
        httpOnly: true,
        sameSite: "lax",
        maxAge: 1000 * 60 * 60 * 12
      }
    })
  );

  const server = http.createServer(app);
  const hub = new RealtimeHub(server);
  const collector = new DockerCollector({ hub });

  app.use("/api", createApiRouter({ docker: collector.docker }));

  // Safety net: any error passed to next() (including from async route handlers)
  // lands here instead of crashing the process via an unhandled rejection.
  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    console.error("[api] Unhandled request error:", error);
    if (response.headersSent) return;
    response.status(500).json({ error: "Internal server error" });
  });

  await collector.start();
  // iptables rules don't survive a host reboot — reapply persisted blocks; best-effort so a
  // firewall-helper hiccup (e.g. no network to pull the alpine image) never blocks startup.
  reapplyAllBlocks(collector.docker).catch((error) => {
    console.error("[ip-blocklist] Failed to reapply blocked IPs on startup:", error instanceof Error ? error.message : error);
  });
  await deleteTelegramWebhookIfRequested();
  startTelegramUpdatesPollerIfConfigured();
  startTelegramDailyReportIfConfigured();
  startContainerStatsPoller(collector.docker, () => collector.getRunningContainers());
  startUptimeChecker();

  server.listen(env.PORT, () => {
    console.log(`Monitor server listening on :${env.PORT}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
