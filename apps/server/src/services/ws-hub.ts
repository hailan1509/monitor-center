import { WebSocketServer } from "ws";
import type { Server } from "node:http";
import type { LogEvent } from "@monitor-center/shared";

export class RealtimeHub {
  #server: WebSocketServer;

  constructor(server: Server) {
    this.#server = new WebSocketServer({ server, path: "/ws" });
  }

  broadcastLog(log: LogEvent) {
    const payload = JSON.stringify({ type: "log", payload: log });
    for (const client of this.#server.clients) {
      if (client.readyState === 1) {
        client.send(payload);
      }
    }
  }

  broadcastStatus(payload: unknown) {
    const data = JSON.stringify({ type: "status", payload });
    for (const client of this.#server.clients) {
      if (client.readyState === 1) {
        client.send(data);
      }
    }
  }
}
