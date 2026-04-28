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

  app.use("/api", createApiRouter());

  const server = http.createServer(app);
  const hub = new RealtimeHub(server);
  const collector = new DockerCollector({ hub });
  await collector.start();

  server.listen(env.PORT, () => {
    console.log(`Monitor server listening on :${env.PORT}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
