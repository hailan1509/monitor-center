import { Router } from "express";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type Docker from "dockerode";
import { z } from "zod";
import { assistantRequestSchema, logPurgeRequestSchema, searchQuerySchema, userRoleSchema } from "@monitor-center/shared";
import { changePassword, createUser, listUsers, updateUser, verifyUser } from "../auth/auth-service.js";
import { silenceManager } from "../services/silence-manager.js";
import { getLatestStats } from "../services/container-stats.js";
import { inspectContainer, restartContainer } from "../services/container-actions.js";
import { getUptimeStatuses } from "../services/uptime-checker.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import {
  getErrorTimeseries,
  getOverview,
  getSecuritySummary,
  getSecurityTimeseries,
  purgeLogs,
  searchLogs
} from "../services/log-repository.js";
import { createAssistantJob, getAssistantJob } from "../services/assistant-jobs.js";
import { rateLimit } from "../services/rate-limit.js";

// Express 4 does not forward rejected promises from async handlers to the error
// middleware on its own — an unhandled rejection there crashes the whole process.
// Wrapping every async handler here routes its errors to next() instead.
function asyncHandler(handler: (request: Request, response: Response) => Promise<void>): RequestHandler {
  return (request, response, next: NextFunction) => {
    handler(request, response).catch(next);
  };
}

export function createApiRouter({ docker }: { docker: Docker }) {
  const router = Router();

  router.get("/health", (_request, response) => {
    response.json({ ok: true });
  });

  // Brute-force protection: limit login attempts per IP.
  router.post(
    "/auth/login",
    rateLimit({
      windowMs: 5 * 60 * 1000,
      max: 12,
      keyPrefix: "login"
    }),
    asyncHandler(async (request, response) => {
      const schema = z.object({
        email: z.string().email(),
        password: z.string().min(6)
      });

      const parsed = schema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json({ error: parsed.error.flatten() });
        return;
      }

      const user = await verifyUser(parsed.data.email, parsed.data.password);
      if (!user) {
        response.status(401).json({ error: "Invalid credentials" });
        return;
      }

      request.session.user = user;
      response.json({ user });
    })
  );

  router.post("/auth/logout", requireAuth, (request, response) => {
    request.session.destroy(() => {
      response.json({ ok: true });
    });
  });

  router.get("/auth/me", (request, response) => {
    response.json({ user: request.session.user ?? null });
  });

  router.put(
    "/auth/password",
    requireAuth,
    asyncHandler(async (request, response) => {
      const schema = z.object({
        currentPassword: z.string().min(1),
        newPassword: z.string().min(6)
      });
      const parsed = schema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json({ error: parsed.error.flatten() });
        return;
      }

      const userId = request.session.user?.id;
      if (!userId) {
        response.status(401).json({ error: "Not authenticated" });
        return;
      }

      const result = await changePassword(userId, parsed.data.currentPassword, parsed.data.newPassword);
      if (result === "invalid-current") {
        response.status(400).json({ error: "Current password is incorrect" });
        return;
      }

      response.json({ ok: true });
    })
  );

  router.get(
    "/dashboard/overview",
    requireAuth,
    asyncHandler(async (_request, response) => {
      response.json(await getOverview());
    })
  );

  router.get(
    "/security/summary",
    requireAuth,
    asyncHandler(async (_request, response) => {
      response.json(await getSecuritySummary());
    })
  );

  router.get(
    "/security/timeseries",
    requireAuth,
    asyncHandler(async (request, response) => {
      const schema = z.object({
        hours: z.coerce.number().min(1).max(72).default(24),
        bucketMinutes: z.coerce.number().min(1).max(180).default(30)
      });
      const parsed = schema.safeParse(request.query);
      if (!parsed.success) {
        response.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      const buckets = await getSecurityTimeseries(parsed.data);
      response.json({ buckets });
    })
  );

  router.get(
    "/logs/search",
    requireAuth,
    asyncHandler(async (request, response) => {
      const parsed = searchQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        response.status(400).json({ error: parsed.error.flatten() });
        return;
      }

      response.json({ logs: await searchLogs(parsed.data) });
    })
  );

  router.get(
    "/logs/timeseries",
    requireAuth,
    asyncHandler(async (request, response) => {
      const schema = z.object({
        project: z.string().optional(),
        hours: z.coerce.number().min(1).max(72).default(6),
        bucketMinutes: z.coerce.number().min(1).max(180).default(5)
      });
      const parsed = schema.safeParse(request.query);
      if (!parsed.success) {
        response.status(400).json({ error: parsed.error.flatten() });
        return;
      }

      const buckets = await getErrorTimeseries(parsed.data);
      response.json({ buckets });
    })
  );

  router.post(
    "/logs/purge",
    requireRole("admin"),
    asyncHandler(async (request, response) => {
      const parsed = logPurgeRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json({ error: parsed.error.flatten() });
        return;
      }

      const result = await purgeLogs({
        ...parsed.data,
        dryRun: parsed.data.dryRun ?? true
      });

      response.json(result);
    })
  );

  router.post("/assistant/query", requireAuth, (request, response) => {
    const parsed = assistantRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const job = createAssistantJob(parsed.data);
    response.status(202).json({ jobId: job.id });
  });

  router.get("/assistant/jobs/:id", requireAuth, (request, response) => {
    const job = getAssistantJob(String(request.params.id));
    if (!job) {
      response.status(404).json({ error: "Job not found" });
      return;
    }

    response.json({
      id: job.id,
      status: job.status,
      progress: job.progress,
      result: job.result,
      error: job.error
    });
  });

  // ── Container stats ───────────────────────────────────────────────────────

  router.get("/containers/stats", requireAuth, (_request, response) => {
    response.json({ stats: getLatestStats() });
  });

  router.get(
    "/containers/:id/inspect",
    requireAuth,
    asyncHandler(async (request, response) => {
      try {
        const summary = await inspectContainer(docker, String(request.params.id));
        response.json(summary);
      } catch (error) {
        response.status(404).json({ error: error instanceof Error ? error.message : "Container not found" });
      }
    })
  );

  router.post(
    "/containers/:id/restart",
    requireRole("admin"),
    asyncHandler(async (request, response) => {
      try {
        await restartContainer(docker, String(request.params.id));
        response.json({ ok: true });
      } catch (error) {
        response.status(500).json({ error: error instanceof Error ? error.message : "Unable to restart container" });
      }
    })
  );

  // ── Uptime checks ─────────────────────────────────────────────────────────

  router.get("/uptime", requireAuth, (_request, response) => {
    response.json({ checks: getUptimeStatuses() });
  });

  // ── Silence / maintenance window ──────────────────────────────────────────

  router.get("/silences", requireAuth, (_request, response) => {
    response.json({ silences: silenceManager.listActive() });
  });

  router.post("/silences", requireRole("admin"), (request, response) => {
    const schema = z.object({
      project: z.string().min(1),
      service: z.string().min(1).nullable().default(null),
      durationMs: z.number().int().min(60_000).max(24 * 60 * 60 * 1000)
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const { project, service, durationMs } = parsed.data;
    silenceManager.silence(project, service, durationMs);
    response.json({ ok: true, expiresAt: new Date(Date.now() + durationMs).toISOString() });
  });

  router.delete("/silences", requireRole("admin"), (request, response) => {
    const schema = z.object({
      project: z.string().min(1),
      service: z.string().min(1).nullable().default(null)
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    silenceManager.clear(parsed.data.project, parsed.data.service);
    response.json({ ok: true });
  });

  router.get(
    "/users",
    requireRole("admin"),
    asyncHandler(async (_request, response) => {
      response.json({ users: await listUsers() });
    })
  );

  router.post(
    "/users",
    requireRole("admin"),
    asyncHandler(async (request, response) => {
      const schema = z.object({
        email: z.string().email(),
        password: z.string().min(6),
        displayName: z.string().min(2),
        role: userRoleSchema
      });

      const parsed = schema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json({ error: parsed.error.flatten() });
        return;
      }

      try {
        const user = await createUser(parsed.data);
        response.status(201).json({ user });
      } catch (error) {
        if (isUniqueViolation(error)) {
          response.status(409).json({ error: "A user with this email already exists" });
          return;
        }
        throw error;
      }
    })
  );

  router.put(
    "/users/:id",
    requireRole("admin"),
    asyncHandler(async (request, response) => {
      const schema = z.object({
        email: z.string().email().optional(),
        password: z.string().min(6).optional(),
        displayName: z.string().min(2).optional(),
        role: userRoleSchema.optional()
      });

      const parsed = schema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json({ error: parsed.error.flatten() });
        return;
      }

      try {
        await updateUser(String(request.params.id), parsed.data);
        response.json({ ok: true });
      } catch (error) {
        if (isUniqueViolation(error)) {
          response.status(409).json({ error: "A user with this email already exists" });
          return;
        }
        throw error;
      }
    })
  );

  return router;
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "23505");
}
