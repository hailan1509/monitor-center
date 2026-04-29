import { z } from "zod";

export const userRoleSchema = z.enum(["admin", "viewer"]);

export const logLevelSchema = z.enum(["trace", "debug", "info", "warn", "error", "fatal", "unknown"]);

export const logEventSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  project: z.string(),
  service: z.string(),
  containerName: z.string(),
  stream: z.enum(["stdout", "stderr"]),
  level: logLevelSchema,
  message: z.string(),
  raw: z.string(),
  source: z.string().default("docker"),
  tags: z.array(z.string()).default([]),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({})
});

export const issueSchema = z.object({
  fingerprint: z.string(),
  project: z.string(),
  service: z.string(),
  title: z.string(),
  level: logLevelSchema,
  count: z.number(),
  lastSeenAt: z.string(),
  sampleMessage: z.string()
});

export const containerSummarySchema = z.object({
  containerId: z.string(),
  containerName: z.string(),
  project: z.string(),
  service: z.string(),
  status: z.string(),
  state: z.string(),
  image: z.string(),
  startedAt: z.string().nullable(),
  labels: z.record(z.string(), z.string())
});

export const projectSummarySchema = z.object({
  project: z.string(),
  containerCount: z.number(),
  healthyContainers: z.number(),
  errorCount24h: z.number(),
  warnCount24h: z.number(),
  lastLogAt: z.string().nullable()
});

export const dashboardSnapshotSchema = z.object({
  projects: z.array(projectSummarySchema),
  containers: z.array(containerSummarySchema),
  issues: z.array(issueSchema),
  recentLogs: z.array(logEventSchema)
});

export const searchQuerySchema = z.object({
  q: z.string().optional(),
  project: z.string().optional(),
  service: z.string().optional(),
  containerName: z.string().optional(),
  level: logLevelSchema.optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  limit: z.coerce.number().min(1).max(500).default(100)
});

export const assistantRequestSchema = z.object({
  question: z.string().min(3),
  project: z.string().optional(),
  start: z.string().optional(),
  end: z.string().optional()
});

export const logPurgeRequestSchema = z
  .object({
    project: z.string().optional(),
    service: z.string().optional(),
    containerName: z.string().optional(),
    level: logLevelSchema.optional(),
    category: z.enum(["security", "system"]).optional(),
    start: z.string().optional(),
    end: z.string().optional(),
    before: z.string().optional(),
    dryRun: z.boolean().default(true)
  })
  .refine((value) => Boolean(value.before || value.start || value.end), {
    message: "Provide at least one time constraint: before, start, or end."
  });

export type UserRole = z.infer<typeof userRoleSchema>;
export type LogLevel = z.infer<typeof logLevelSchema>;
export type LogEvent = z.infer<typeof logEventSchema>;
export type Issue = z.infer<typeof issueSchema>;
export type ContainerSummary = z.infer<typeof containerSummarySchema>;
export type ProjectSummary = z.infer<typeof projectSummarySchema>;
export type DashboardSnapshot = z.infer<typeof dashboardSnapshotSchema>;
export type SearchQuery = z.infer<typeof searchQuerySchema>;
export type AssistantRequest = z.infer<typeof assistantRequestSchema>;
export type LogPurgeRequest = z.infer<typeof logPurgeRequestSchema>;

export const DEFAULT_PROJECT_MAPPINGS = [
  {
    project: "cong-duc-dinh-tan-kim",
    matchers: ["cong-duc-dinh-tan-kim-web-1"]
  },
  {
    project: "quanlytufo_app",
    matchers: ["quanlytufo_app", "quanlytufo_nginx"]
  },
  {
    project: "wedding-website",
    matchers: ["wedding_app", "wedding_nginx"]
  }
] as const;
