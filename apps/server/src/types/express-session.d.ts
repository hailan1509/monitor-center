import "express-session";
import type { UserRole } from "@monitor-center/shared";

declare module "express-session" {
  interface SessionData {
    user?: {
      id: string;
      email: string;
      role: UserRole;
      displayName: string;
    };
  }
}
