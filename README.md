# Monitor Center

Internal log monitoring platform for multiple Dockerized projects on a single VPS.

## Workspace layout

- `apps/server`: Express API, Docker collector, WebSocket hub, auth, AI assistant
- `apps/web`: React dashboard for overview, live tail, search, issues, and AI chat
- `packages/shared`: shared types and helpers

## Quick start

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy the environment file:

   ```bash
   copy apps\\server\\.env.example apps\\server\\.env
   ```

3. Start the local PostgreSQL stack:

   ```bash
   docker compose up -d
   ```

4. Seed the database and start development:

   ```bash
   npm run db:init
   npm run dev
   ```

The server reads Docker data from `/var/run/docker.sock` in production. On Windows/local development you can set `DOCKER_SOCKET_PATH` or disable the collector temporarily.
