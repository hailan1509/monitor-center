import { Router } from "express";
import { z } from "zod";
import { assistantRequestSchema, searchQuerySchema, userRoleSchema } from "@monitor-center/shared";
import { createUser, listUsers, verifyUser } from "../auth/auth-service.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { getOverview, searchLogs } from "../services/log-repository.js";
import { answerLogQuestion } from "../services/assistant-service.js";

export function createApiRouter() {
  const router = Router();

  router.get("/health", (_request, response) => {
    response.json({ ok: true });
  });

  router.post("/auth/login", async (request, response) => {
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
  });

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

  router.get("/logs/search", requireAuth, async (request, response) => {
    const parsed = searchQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      response.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    response.json({ logs: await searchLogs(parsed.data) });
  });

  router.post("/assistant/query", requireAuth, async (request, response) => {
    const parsed = assistantRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    try {
      response.json(await answerLogQuestion(parsed.data));
    } catch (error) {
      response.status(500).json({
        error: error instanceof Error ? error.message : "Assistant error"
      });
    }
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
