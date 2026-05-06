import type { LogEvent } from "@monitor-center/shared";
import { env } from "../config/env.js";
import { listTelegramReportChatIds } from "./telegram-subscribers.js";

type AlertLog = LogEvent & { fingerprint?: string };

function normalizeLevels(levels: unknown): string[] {
  if (!Array.isArray(levels)) return ["error", "fatal"];
  return levels.map((v) => String(v).toLowerCase()).filter(Boolean);
}

function chunkText(text: string, max = 3900) {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += max) {
    chunks.push(text.slice(i, i + max));
  }
  return chunks.length ? chunks : [text];
}

async function resolveRecipientChatIds(): Promise<string[]> {
  const fromDb = await listTelegramReportChatIds();
  const fromEnv = env.TELEGRAM_CHAT_ID ?? [];
  return [...new Set([...fromDb, ...fromEnv])];
}

async function sendTelegramText(token: string, chatId: string, text: string) {
  for (const part of chunkText(text)) {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: part,
        disable_web_page_preview: true
      })
    });

    const payload = (await response.json()) as { ok: boolean; description?: string };
    if (!payload.ok) {
      throw new Error(payload.description ?? `Telegram HTTP ${response.status}`);
    }
  }
}

function formatVietnamTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) return iso;
  const timeZone = env.TELEGRAM_DAILY_REPORT_TIMEZONE || "Asia/Ho_Chi_Minh";
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone,
    dateStyle: "short",
    timeStyle: "medium"
  }).format(date);
}

function formatAlert(log: AlertLog) {
  const lines: string[] = [];
  lines.push("🚨 Monitor Center — Cảnh báo lỗi");
  lines.push(`Giờ (VN): ${formatVietnamTime(log.timestamp)}`);
  lines.push(`Project: ${log.project}`);
  lines.push(`Service: ${log.service}`);
  lines.push(`Container: ${log.containerName}`);
  lines.push(`Mức: ${log.level}`);
  if (log.fingerprint) {
    lines.push(`Fingerprint: ${log.fingerprint}`);
  }
  lines.push("");
  lines.push(log.message);
  return lines.join("\n");
}

class TelegramErrorAlerter {
  #lastSentAt = new Map<string, number>();
  #inflight = new Map<string, Promise<void>>();

  async maybeSend(log: AlertLog): Promise<void> {
    if (!env.TELEGRAM_BOT_TOKEN) return;
    if (!env.TELEGRAM_ERROR_ALERTS_ENABLED) return;

    const levels = normalizeLevels(env.TELEGRAM_ERROR_ALERTS_LEVELS);
    if (!levels.includes(String(log.level).toLowerCase())) return;

    const category = typeof log.metadata?.category === "string" ? log.metadata.category : undefined;
    if (category === "security" && !env.TELEGRAM_ERROR_ALERTS_INCLUDE_SECURITY) return;

    const fingerprint = log.fingerprint ?? "";
    const key = `${log.project}::${log.service}::${fingerprint || log.message.slice(0, 120)}`;

    const now = Date.now();
    const last = this.#lastSentAt.get(key) ?? 0;
    if (now - last < env.TELEGRAM_ERROR_ALERTS_COOLDOWN_MS) {
      return;
    }
    this.#lastSentAt.set(key, now);

    const existing = this.#inflight.get(key);
    if (existing) return;

    const task = (async () => {
      try {
        const chatIds = await resolveRecipientChatIds();
        if (chatIds.length === 0) return;

        const text = formatAlert(log);
        const errors: string[] = [];
        for (const chatId of chatIds) {
          try {
            await sendTelegramText(env.TELEGRAM_BOT_TOKEN!, chatId, text);
          } catch (error) {
            errors.push(`${chatId}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        if (errors.length === chatIds.length) {
          console.error("[telegram] Error alert failed for all chats:\n", errors.join("\n"));
        } else if (errors.length) {
          console.error("[telegram] Error alert failed for some chats:\n", errors.join("\n"));
        }
      } finally {
        this.#inflight.delete(key);
      }
    })();

    this.#inflight.set(key, task);
    await task;
  }
}

export const telegramErrorAlerter = new TelegramErrorAlerter();

