import { useEffect, useRef, useState } from "react";
import type { LogEvent } from "@monitor-center/shared";

type WsMessage = { type: "log"; payload: LogEvent } | { type: "status"; payload: unknown };

/** Live log stream over the existing /ws endpoint. Keeps the last `limit` events, newest first. */
export function useLiveLogs(limit = 200) {
  const [connected, setConnected] = useState(false);
  const [logs, setLogs] = useState<LogEvent[]>([]);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const socket = new WebSocket(`${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws`);
    socketRef.current = socket;

    socket.addEventListener("open", () => setConnected(true));
    socket.addEventListener("close", () => setConnected(false));
    socket.addEventListener("error", () => setConnected(false));
    socket.addEventListener("message", (event) => {
      const data = JSON.parse(event.data) as WsMessage;
      if (data.type === "log") {
        setLogs((current) => [data.payload, ...current].slice(0, limit));
      }
    });

    return () => socket.close();
  }, [limit]);

  return { connected, logs };
}
