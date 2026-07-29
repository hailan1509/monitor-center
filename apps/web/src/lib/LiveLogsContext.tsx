import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { LogEvent } from "@monitor-center/shared";
import { useLiveLogs } from "./useWebSocket";

type LiveLogsValue = { connected: boolean; logs: LogEvent[] };

const LiveLogsContext = createContext<LiveLogsValue>({ connected: false, logs: [] });

/** One shared WebSocket connection for the whole app shell — pages read from context instead of opening their own socket. */
export function LiveLogsProvider({ children, limit = 300 }: { children: ReactNode; limit?: number }) {
  const value = useLiveLogs(limit);
  return <LiveLogsContext.Provider value={value}>{children}</LiveLogsContext.Provider>;
}

export function useLiveLogsContext() {
  return useContext(LiveLogsContext);
}
