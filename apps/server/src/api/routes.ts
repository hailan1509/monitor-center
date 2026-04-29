import { Router } from "express";
import { z } from "zod";
import { assistantRequestSchema, logPurgeRequestSchema, searchQuerySchema, userRoleSchema } from "@monitor-center/shared";
import { createUser, listUsers, verifyUser } from "../auth/auth-service.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { getOverview, getSecuritySummary, purgeLogs, searchLogs } from "../services/log-repository.js";
import { createAssistantJob, getAssistantJob } from "../services/assistant-jobs.js";
import { rateLimit } from "../services/rate-limit.js";

export function createApiRouter() {
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
    async (request, response) => {
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
    }
  );

  router.post("/auth/logout", requireAuth, (request, response) => {
    request.session.destroy(() => {
      response.json({ ok: true });
    });
  });

  router.get("/auth/me", (request, response) => {
    response.json({ user: request.session.user ?? null });
  });

  router.get("/dashboard/overview", requireAuth, async (_request, response) => {
    response.json(await getOverview());
  });

  router.get("/security/summary", requireAuth, async (_request, response) => {
    response.json(await getSecuritySummary());
  });

  router.get("/logs/search", requireAuth, async (request, response) => {
    const parsed = searchQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      response.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    response.json({ logs: await searchLogs(parsed.data) });
  });

  router.post("/logs/purge", requireRole("admin"), async (request, response) => {
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
  });

  router.post("/assistant/query", requireAuth, async (request, response) => {
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

  router.get("/users", requireRole("admin"), async (_request, response) => {
    response.json({ users: await listUsers() });
  });

  router.post("/users", requireRole("admin"), async (request, response) => {
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

    const user = await createUser(parsed.data);
    response.status(201).json({ user });
  });

  return router;
}
