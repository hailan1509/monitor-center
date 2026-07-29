import { useCallback, useEffect, useState } from "react";
import type { UserRole } from "@monitor-center/shared";
import { api } from "./api";

export type CurrentUser = {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
};

export function useAuth() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void api
      .me()
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api.login({ email, password });
    setUser(r.user);
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setUser(null);
  }, []);

  return { user, loading, login, logout };
}
