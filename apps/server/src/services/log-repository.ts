import type { LogEvent } from "@monitor-center/shared";
import { pool, query } from "../db/index.js";
import { partitionSql } from "../db/schema.js";

type SearchFilters = {
  q?: string;
  project?: string;
  service?: string;
  containerName?: string;
  level?: string;
  start?: string;
  end?: string;
  limit?: number;
};

type PurgeFilters = {
  project?: string;
  service?: string;
  containerName?: string;
  level?: string;
  category?: "security" | "system";
  start?: string;
  end?: string;
  before?: string;
  dryRun: boolean;
};

export async function ensureLogPartition(timestamp: string) {
  await pool.query(partitionSql(new Date(timestamp)));
}

export async function insertLog(log: LogEvent & { containerId: string; fingerprint: string }) {
  await ensureLogPartition(log.timestamp);

  await query(
    `
    INSERT INTO logs (
      timestamp,
      project,
      service,
      container_name,
      container_id,
      stream,
      level,
      message,
      raw,
      source,
      tags,
      metadata,
      fingerprint
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)
    `,
    [
      log.timestamp,
      log.project,
      log.service,
      log.containerName,
      log.containerId,
      log.stream,
      log.level,
      log.message,
      log.raw,
      log.source,
      log.tags,
      JSON.stringify(log.metadata),
      log.fingerprint
    ]
  );
}

export async function upsertContainerState(input: {
  containerId: string;
  containerName: string;
  project: string;
  service: string;
  status: string;
  state: string;
  image: string;
  startedAt: string | null;
  labels: Record<string, string>;
}) {
  await query(
    `
    INSERT INTO container_state (
      container_id,
      container_name,
      project,
      service,
      status,
      state,
      image,
      started_at,
      labels,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, NOW())
    ON CONFLICT (container_id)
    DO UPDATE SET
      container_name = EXCLUDED.container_name,
      project = EXCLUDED.project,
      service = EXCLUDED.service,
      status = EXCLUDED.status,
      state = EXCLUDED.state,
      image = EXCLUDED.image,
      started_at = EXCLUDED.started_at,
      labels = EXCLUDED.labels,
      updated_at = NOW()
    `,
    [
      input.containerId,
      input.containerName,
      input.project,
      input.service,
      input.status,
      input.state,
      input.image,
      input.startedAt,
      JSON.stringify(input.labels)
    ]
  );
}

/** Removes container_state rows for containers no longer seen on the host (e.g. after a rebuild/recreate
    assigns a new container_id) — otherwise dead containers pile up forever since upsert only adds/updates. */
export async function pruneContainerStates(activeContainerIds: string[]) {
  if (activeContainerIds.length === 0) {
    await query(`DELETE FROM container_state`);
    return;
  }
  await query(`DELETE FROM container_state WHERE container_id <> ALL($1::text[])`, [activeContainerIds]);
}

export async function searchLogs(filters: SearchFilters) {
  const clauses: string[] = [];
  const values: unknown[] = [];

  if (filters.project) {
    values.push(filters.project);
    clauses.push(`project = $${values.length}`);
  }
  if (filters.service) {
    values.push(filters.service);
    clauses.push(`service = $${values.length}`);
  }
  if (filters.containerName) {
    values.push(filters.containerName);
    clauses.push(`container_name = $${values.length}`);
  }
  if (filters.level) {
    values.push(filters.level);
    clauses.push(`level = $${values.length}`);
  }
  if (filters.start) {
    values.push(filters.start);
    clauses.push(`timestamp >= $${values.length}`);
  }
  if (filters.end) {
    values.push(filters.end);
    clauses.push(`timestamp <= $${values.length}`);
  }
  if (filters.q) {
    values.push(`%${filters.q}%`);
    clauses.push(`(message ILIKE $${values.length} OR raw ILIKE $${values.length})`);
  }

  values.push(filters.limit ?? 100);

  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const result = await query<{
    id: string;
    timestamp: string;
    project: string;
    service: string;
    container_name: string;
    stream: "stdout" | "stderr";
    level: string;
    message: string;
    raw: string;
    source: string;
    tags: string[];
    metadata: Record<string, string | number | boolean | null>;
  }>(
    `
    SELECT id, timestamp, project, service, container_name, stream, level, message, raw, source, tags, metadata
    FROM logs
    ${whereClause}
    ORDER BY timestamp DESC
    LIMIT $${values.length}
    `,
    values
  );

  return result.rows.map((row) => ({
    id: row.id,
    timestamp: row.timestamp,
    project: row.project,
    service: row.service,
    containerName: row.container_name,
    stream: row.stream,
    level: row.level,
    message: row.message,
    raw: row.raw,
    source: row.source,
    tags: row.tags,
    metadata: row.metadata
  }));
}

export async function getOverview() {
  const [projectResult, containerResult, issueResult, logResult] = await Promise.all([
    query<{
      project: string;
      container_count: string;
      healthy_containers: string;
      error_count_24h: string;
      warn_count_24h: string;
      last_log_at: string | null;
    }>(
      `
      SELECT
        cs.project,
        COUNT(*)::int AS container_count,
        COUNT(*) FILTER (WHERE cs.state = 'running')::int AS healthy_containers,
        COALESCE(SUM(CASE WHEN l.level IN ('error', 'fatal') THEN 1 ELSE 0 END), 0)::int AS error_count_24h,
        COALESCE(SUM(CASE WHEN l.level = 'warn' THEN 1 ELSE 0 END), 0)::int AS warn_count_24h,
        MAX(l.timestamp) AS last_log_at
      FROM container_state cs
      LEFT JOIN logs l
        ON l.container_name = cs.container_name
        AND l.timestamp >= NOW() - INTERVAL '24 HOURS'
      GROUP BY cs.project
      ORDER BY cs.project ASC
      `
    ),
    query<{
      container_id: string;
      container_name: string;
      project: string;
      service: string;
      status: string;
      state: string;
      image: string;
      labels: Record<string, string>;
      started_at: string | null;
    }>(
      `
      SELECT container_id, container_name, project, service, status, state, image, labels, started_at
      FROM container_state
      ORDER BY project ASC, container_name ASC
      `
    ),
    query<{
      fingerprint: string;
      project: string;
      service: string;
      level: string;
      count: string;
      last_seen_at: string;
      sample_message: string;
    }>(
      `
      SELECT
        fingerprint,
        project,
        service,
        MAX(level) AS level,
        COUNT(*)::int AS count,
        MAX(timestamp) AS last_seen_at,
        MAX(message) AS sample_message
      FROM logs
      WHERE timestamp >= NOW() - INTERVAL '24 HOURS'
        AND level IN ('warn', 'error', 'fatal')
        AND (metadata->>'category') IS DISTINCT FROM 'security'
      GROUP BY fingerprint, project, service
      ORDER BY count DESC, last_seen_at DESC
      LIMIT 20
      `
    ),
    query<{
      id: string;
      timestamp: string;
      project: string;
      service: string;
      container_name: string;
      stream: "stdout" | "stderr";
      level: string;
      message: string;
      raw: string;
      source: string;
      tags: string[];
      metadata: Record<string, string | number | boolean | null>;
    }>(
      `
      SELECT id, timestamp, project, service, container_name, stream, level, message, raw, source, tags, metadata
      FROM logs
      ORDER BY timestamp DESC
      LIMIT 50
      `
    )
  ]);

  return {
    projects: projectResult.rows.map((row) => ({
      project: row.project,
      containerCount: Number(row.container_count),
      healthyContainers: Number(row.healthy_containers),
      errorCount24h: Number(row.error_count_24h),
      warnCount24h: Number(row.warn_count_24h),
      lastLogAt: row.last_log_at
    })),
    containers: containerResult.rows.map((row) => ({
      containerId: row.container_id,
      containerName: row.container_name,
      project: row.project,
      service: row.service,
      status: row.status,
      state: row.state,
      image: row.image,
      labels: row.labels,
      startedAt: row.started_at
    })),
    issues: issueResult.rows.map((row) => ({
      fingerprint: row.fingerprint,
      project: row.project,
      service: row.service,
      level: row.level,
      count: Number(row.count),
      lastSeenAt: row.last_seen_at,
      sampleMessage: row.sample_message,
      title: row.sample_message.slice(0, 120)
    })),
    recentLogs: logResult.rows.map((row) => ({
      id: row.id,
      timestamp: row.timestamp,
      project: row.project,
      service: row.service,
      containerName: row.container_name,
      stream: row.stream,
      level: row.level,
      message: row.message,
      raw: row.raw,
      source: row.source,
      tags: row.tags,
      metadata: row.metadata
    }))
  };
}

export type TimeseriesBucket = { bucket: string; errorCount: number; warnCount: number };

/** Bucketed error/warn counts over the trailing window — powers trend charts. No schema change: reads the existing `logs` table. */
export async function getErrorTimeseries(input: { project?: string; hours: number; bucketMinutes: number }): Promise<TimeseriesBucket[]> {
  const bucketSeconds = input.bucketMinutes * 60;
  const clauses: string[] = [`timestamp >= NOW() - ($1 || ' hours')::interval`];
  const values: unknown[] = [input.hours];

  if (input.project) {
    values.push(input.project);
    clauses.push(`project = $${values.length}`);
  }

  values.push(bucketSeconds);
  const bucketParamIndex = values.length;

  const result = await query<{ bucket: Date; error_count: string; warn_count: string }>(
    `
    SELECT
      to_timestamp(floor(extract(epoch FROM timestamp) / $${bucketParamIndex}) * $${bucketParamIndex}) AS bucket,
      COUNT(*) FILTER (WHERE level IN ('error', 'fatal'))::int AS error_count,
      COUNT(*) FILTER (WHERE level = 'warn')::int AS warn_count
    FROM logs
    WHERE ${clauses.join(" AND ")}
    GROUP BY bucket
    ORDER BY bucket ASC
    `,
    values
  );

  const byBucket = new Map(result.rows.map((row) => [row.bucket.toISOString(), row]));

  // Fill gaps so the chart line doesn't skip silent buckets.
  const buckets: TimeseriesBucket[] = [];
  const now = Date.now();
  const start = Math.floor((now - input.hours * 60 * 60 * 1000) / (bucketSeconds * 1000)) * bucketSeconds * 1000;
  for (let t = start; t <= now; t += bucketSeconds * 1000) {
    const iso = new Date(t).toISOString();
    const row = byBucket.get(iso);
    buckets.push({
      bucket: iso,
      errorCount: row ? Number(row.error_count) : 0,
      warnCount: row ? Number(row.warn_count) : 0
    });
  }

  return buckets;
}

/** Bucketed security-event counts over the trailing window — same bucketing approach as getErrorTimeseries. */
export async function getSecurityTimeseries(input: { hours: number; bucketMinutes: number }): Promise<Array<{ bucket: string; count: number }>> {
  const bucketSeconds = input.bucketMinutes * 60;

  const result = await query<{ bucket: Date; count: string }>(
    `
    SELECT
      to_timestamp(floor(extract(epoch FROM timestamp) / $2) * $2) AS bucket,
      COUNT(*)::int AS count
    FROM logs
    WHERE timestamp >= NOW() - ($1 || ' hours')::interval
      AND (metadata->>'category') = 'security'
    GROUP BY bucket
    ORDER BY bucket ASC
    `,
    [input.hours, bucketSeconds]
  );

  const byBucket = new Map(result.rows.map((row) => [row.bucket.toISOString(), Number(row.count)]));

  const buckets: Array<{ bucket: string; count: number }> = [];
  const now = Date.now();
  const start = Math.floor((now - input.hours * 60 * 60 * 1000) / (bucketSeconds * 1000)) * bucketSeconds * 1000;
  for (let t = start; t <= now; t += bucketSeconds * 1000) {
    const iso = new Date(t).toISOString();
    buckets.push({ bucket: iso, count: byBucket.get(iso) ?? 0 });
  }

  return buckets;
}

export async function getSecuritySummary() {
  const [countResult, ipResult, pathResult, uaResult] = await Promise.all([
    query<{ total: string }>(
      `
      SELECT COUNT(*)::int AS total
      FROM logs
      WHERE timestamp >= NOW() - INTERVAL '24 HOURS'
        AND (metadata->>'category') = 'security'
      `
    ),
    query<{ client_ip: string; count: string }>(
      `
      SELECT (metadata->>'clientIp') AS client_ip, COUNT(*)::int AS count
      FROM logs
      WHERE timestamp >= NOW() - INTERVAL '24 HOURS'
        AND (metadata->>'category') = 'security'
        AND (metadata->>'clientIp') IS NOT NULL
      GROUP BY (metadata->>'clientIp')
      ORDER BY count DESC
      LIMIT 20
      `
    ),
    query<{ path: string; count: string }>(
      `
      SELECT (metadata->>'httpPath') AS path, COUNT(*)::int AS count
      FROM logs
      WHERE timestamp >= NOW() - INTERVAL '24 HOURS'
        AND (metadata->>'category') = 'security'
        AND (metadata->>'httpPath') IS NOT NULL
      GROUP BY (metadata->>'httpPath')
      ORDER BY count DESC
      LIMIT 20
      `
    ),
    query<{ user_agent: string; count: string }>(
      `
      SELECT (metadata->>'httpUserAgent') AS user_agent, COUNT(*)::int AS count
      FROM logs
      WHERE timestamp >= NOW() - INTERVAL '24 HOURS'
        AND (metadata->>'category') = 'security'
        AND (metadata->>'httpUserAgent') IS NOT NULL
      GROUP BY (metadata->>'httpUserAgent')
      ORDER BY count DESC
      LIMIT 10
      `
    )
  ]);

  return {
    total24h: Number(countResult.rows[0]?.total ?? 0),
    topIps: ipResult.rows.map((row) => ({ clientIp: row.client_ip, count: Number(row.count) })),
    topPaths: pathResult.rows.map((row) => ({ path: row.path, count: Number(row.count) })),
    topUserAgents: uaResult.rows.map((row) => ({ userAgent: row.user_agent, count: Number(row.count) }))
  };
}

export async function purgeLogs(filters: PurgeFilters) {
  const clauses: string[] = [];
  const values: unknown[] = [];

  if (filters.project) {
    values.push(filters.project);
    clauses.push(`project = $${values.length}`);
  }
  if (filters.service) {
    values.push(filters.service);
    clauses.push(`service = $${values.length}`);
  }
  if (filters.containerName) {
    values.push(filters.containerName);
    clauses.push(`container_name = $${values.length}`);
  }
  if (filters.level) {
    values.push(filters.level);
    clauses.push(`level = $${values.length}`);
  }
  if (filters.category) {
    values.push(filters.category);
    clauses.push(`(metadata->>'category') = $${values.length}`);
  }
  if (filters.start) {
    values.push(filters.start);
    clauses.push(`timestamp >= $${values.length}`);
  }
  if (filters.end) {
    values.push(filters.end);
    clauses.push(`timestamp <= $${values.length}`);
  }
  if (filters.before) {
    values.push(filters.before);
    clauses.push(`timestamp < $${values.length}`);
  }

  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

  if (filters.dryRun) {
    const result = await query<{ count: string }>(
      `
      SELECT COUNT(*)::int AS count
      FROM logs
      ${whereClause}
      `,
      values
    );

    return { dryRun: true, affected: Number(result.rows[0]?.count ?? 0) };
  }

  const result = await query<{ count: string }>(
    `
    WITH deleted AS (
      DELETE FROM logs
      ${whereClause}
      RETURNING 1
    )
    SELECT COUNT(*)::int AS count FROM deleted
    `,
    values
  );

  return { dryRun: false, affected: Number(result.rows[0]?.count ?? 0) };
}

/** Start of local calendar day → now, both as ISO instants (for digest window). */
export async function getZonedCalendarDayStartToNow(timeZone: string) {
  const result = await query<{ day_start: Date; day_end: Date }>(
    `
    SELECT
      (date_trunc('day', NOW() AT TIME ZONE $1::text) AT TIME ZONE $1::text) AS day_start,
      NOW() AS day_end
    `,
    [timeZone]
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error("Failed to resolve calendar day bounds");
  }

  return {
    start: row.day_start.toISOString(),
    end: row.day_end.toISOString()
  };
}

export type LogDigestForRange = {
  projects: Array<{
    project: string;
    containerCount: number;
    healthyContainers: number;
    totalLogs: number;
    errorCount: number;
    warnCount: number;
  }>;
  topIssues: Array<{
    project: string;
    service: string;
    level: string;
    count: number;
    sampleMessage: string;
  }>;
  securityEvents: number;
};

export async function getLogDigestForRange(startIso: string, endIso: string): Promise<LogDigestForRange> {
  const [projectResult, issueResult, securityResult] = await Promise.all([
    query<{
      project: string;
      container_count: string;
      healthy_containers: string;
      total_logs: string;
      error_count: string;
      warn_count: string;
    }>(
      `
      SELECT
        cs.project,
        COUNT(*)::int AS container_count,
        COUNT(*) FILTER (WHERE cs.state = 'running')::int AS healthy_containers,
        COUNT(l.id)::int AS total_logs,
        COALESCE(SUM(CASE WHEN l.level IN ('error', 'fatal') THEN 1 ELSE 0 END), 0)::int AS error_count,
        COALESCE(SUM(CASE WHEN l.level = 'warn' THEN 1 ELSE 0 END), 0)::int AS warn_count
      FROM container_state cs
      LEFT JOIN logs l
        ON l.container_name = cs.container_name
        AND l.timestamp >= $1::timestamptz
        AND l.timestamp < $2::timestamptz
      GROUP BY cs.project
      ORDER BY cs.project ASC
      `,
      [startIso, endIso]
    ),
    query<{
      project: string;
      service: string;
      level: string;
      count: string;
      sample_message: string;
    }>(
      `
      SELECT
        project,
        service,
        MAX(level) AS level,
        COUNT(*)::int AS count,
        MAX(message) AS sample_message
      FROM logs
      WHERE timestamp >= $1::timestamptz
        AND timestamp < $2::timestamptz
        AND level IN ('warn', 'error', 'fatal')
        AND (metadata->>'category') IS DISTINCT FROM 'security'
      GROUP BY fingerprint, project, service
      ORDER BY count DESC, MAX(timestamp) DESC
      LIMIT 8
      `,
      [startIso, endIso]
    ),
    query<{ total: string }>(
      `
      SELECT COUNT(*)::int AS total
      FROM logs
      WHERE timestamp >= $1::timestamptz
        AND timestamp < $2::timestamptz
        AND (metadata->>'category') = 'security'
      `,
      [startIso, endIso]
    )
  ]);

  return {
    projects: projectResult.rows.map((row) => ({
      project: row.project,
      containerCount: Number(row.container_count),
      healthyContainers: Number(row.healthy_containers),
      totalLogs: Number(row.total_logs),
      errorCount: Number(row.error_count),
      warnCount: Number(row.warn_count)
    })),
    topIssues: issueResult.rows.map((row) => ({
      project: row.project,
      service: row.service,
      level: row.level,
      count: Number(row.count),
      sampleMessage: row.sample_message
    })),
    securityEvents: Number(securityResult.rows[0]?.total ?? 0)
  };
}
