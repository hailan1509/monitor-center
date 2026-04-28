import type { NextFunction, Request, Response } from "express";
import type { UserRole } from "@monitor-center/shared";

export function requireAuth(request: Request, response: Response, next: NextFunction) {
  if (!request.session.user) {
    response.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
}

export function requireRole(role: UserRole) {
  return (request: Request, response: Response, next: NextFunction) => {
    if (!request.session.user) {
      response.status(401).json({ error: "Unauthorized" });
      return;
    }

    if (request.session.user.role !== role) {
      response.status(403).json({ error: "Forbidden" });
      return;
    }

    next();
  };
}
