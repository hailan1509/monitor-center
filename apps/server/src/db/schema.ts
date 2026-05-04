export const baseSchemaSql = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS container_state (
  container_id TEXT PRIMARY KEY,
  container_name TEXT NOT NULL,
  project TEXT NOT NULL,
  service TEXT NOT NULL,
  status TEXT NOT NULL,
  state TEXT NOT NULL,
  image TEXT NOT NULL,
  labels JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS logs (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ NOT NULL,
  project TEXT NOT NULL,
  service TEXT NOT NULL,
  container_name TEXT NOT NULL,
  container_id TEXT NOT NULL,
  stream TEXT NOT NULL CHECK (stream IN ('stdout', 'stderr')),
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  raw TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'docker',
  tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  fingerprint TEXT NOT NULL,
  PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);

CREATE INDEX IF NOT EXISTS idx_logs_project_time ON logs (project, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_logs_level_time ON logs (level, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_logs_fingerprint_time ON logs (fingerprint, timestamp DESC);

CREATE TABLE IF NOT EXISTS telegram_report_subscribers (
  chat_id TEXT PRIMARY KEY,
  telegram_user_id TEXT,
  username TEXT,
  display_name TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS telegram_bot_poll_state (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_update_id BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

export function partitionSql(partitionDate: Date) {
  const yyyy = partitionDate.getUTCFullYear();
  const mm = String(partitionDate.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(partitionDate.getUTCDate()).padStart(2, "0");

  const name = `logs_${yyyy}${mm}${dd}`;
  const start = `${yyyy}-${mm}-${dd}`;
  const endDate = new Date(Date.UTC(yyyy, Number(mm) - 1, Number(dd) + 1));
  const end = `${endDate.getUTCFullYear()}-${String(endDate.getUTCMonth() + 1).padStart(2, "0")}-${String(
    endDate.getUTCDate()
  ).padStart(2, "0")}`;

  return `
    CREATE TABLE IF NOT EXISTS ${name}
    PARTITION OF logs
    FOR VALUES FROM ('${start}') TO ('${end}');
  `;
}
