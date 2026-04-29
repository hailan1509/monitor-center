import type { NextFunction, Request, Response } from "express";

type RateLimitOptions = {
  windowMs: number;
  max: number;
  keyPrefix?: string;
  getKey?: (request: Request) => string;
};

type Hit = { count: number; resetAt: number };

const buckets = new Map<string, Hit>();

function now() {
  return Date.now();
}

function defaultKey(request: Request) {
  const ip = request.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() || request.socket.remoteAddress || "unknown";
  return ip;
}

export function rateLimit(options: RateLimitOptions) {
  const keyPrefix = options.keyPrefix ?? "rl";
  const getKey = options.getKey ?? defaultKey;

  return (request: Request, response: Response, next: NextFunction) => {
    const key = `${keyPrefix}:${getKey(request)}`;
    const time = now();
    const entry = buckets.get(key);

    if (!entry || entry.resetAt <= time) {
      buckets.set(key, { count: 1, resetAt: time + options.windowMs });
      next();
      return;
    }

    entry.count += 1;

    response.setHeader("X-RateLimit-Limit", String(options.max));
    response.setHeader("X-RateLimit-Remaining", String(Math.max(0, options.max - entry.count)));
    response.setHeader("X-RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > options.max) {
      response.status(429).json({
        error: "Too Many Requests",
        retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - time) / 1000))
      });
      return;
    }

    next();
  };
}

// Best-effort cleanup to avoid unbounded growth.
setInterval(() => {
  const time = now();
  for (const [key, entry] of buckets.entries()) {
    if (entry.resetAt <= time) buckets.delete(key);
  }
}, 60_000).unref?.();

