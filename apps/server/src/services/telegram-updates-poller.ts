import { env } from "../config/env.js";
import {
  getTelegramPollLastUpdateId,
  setTelegramPollLastUpdateId,
  upsertTelegramReportSubscriber
} from "./telegram-subscribers.js";
import { handleTelegramChat } from "./telegram-chat-handler.js";

type TelegramChat = {
  id: number;
  type?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
};

type TelegramUser = {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
};

type IncomingMessage = {
  chat?: TelegramChat;
  from?: TelegramUser;
  text?: string;
};

type TelegramUpdate = {
  update_id: number;
  message?: IncomingMessage;
  edited_message?: IncomingMessage;
};

type GetUpdatesResponse = {
  ok: boolean;
  result?: TelegramUpdate[];
  description?: string;
};

function displayNameFrom(chat: TelegramChat, from?: TelegramUser) {
  const fn = from?.first_name ?? chat.first_name;
  const ln = from?.last_name ?? chat.last_name;
  const parts = [fn, ln].filter(Boolean);
  if (parts.length) return parts.join(" ");
  return from?.username ?? chat.username ?? null;
}

async function telegramApi(token: string, method: string, params: Record<string, string | number>) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    body.set(k, String(v));
  }
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  return response.json() as Promise<{ ok: boolean; description?: string; result?: unknown }>;
}

export async function deleteTelegramWebhookIfRequested() {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_DELETE_WEBHOOK_ON_START) {
    return;
  }
  const data = await telegramApi(env.TELEGRAM_BOT_TOKEN, "deleteWebhook", {
    drop_pending_updates: 1
  });
  if (!data.ok) {
    console.error("[telegram] deleteWebhook:", data.description ?? "unknown");
    return;
  }
  console.log("[telegram] Webhook cleared; getUpdates polling enabled.");
}

let pollIntervalHandle: ReturnType<typeof setInterval> | null = null;

/** Một vòng getUpdates: lưu subscriber từ chat private (dùng cho poller và script gửi thử). */
export async function ingestTelegramUpdatesOnce(token: string): Promise<void> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 15_000);

  try {
    const lastStored = await getTelegramPollLastUpdateId();
    const offset = lastStored === 0 ? 0 : lastStored + 1;
    const response = await fetch(
      `https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=0`,
      { method: "GET", signal: ac.signal }
    );
    const data = (await response.json()) as GetUpdatesResponse;

    if (!data.ok) {
      const desc = data.description ?? `HTTP ${response.status}`;
      // Conflict = another instance is already polling; stop this poller to avoid spam
      if (desc.toLowerCase().includes("conflict")) {
        console.warn("[telegram] getUpdates Conflict — another instance detected; stopping poller");
        if (pollIntervalHandle) {
          clearInterval(pollIntervalHandle);
          pollIntervalHandle = null;
        }
        return;
      }
      console.warn("[telegram] getUpdates:", desc);
      return;
    }

    let maxId = 0;
    for (const update of data.result ?? []) {
      maxId = Math.max(maxId, update.update_id);
      const payload = update.message ?? update.edited_message;
      const chat = payload?.chat;
      if (!chat?.id || chat.type !== "private") {
        continue;
      }

      const from = payload?.from;
      await upsertTelegramReportSubscriber({
        chatId: String(chat.id),
        telegramUserId: from?.id != null ? String(from.id) : null,
        username: from?.username ?? chat.username ?? null,
        displayName: displayNameFrom(chat, from)
      });

      if (payload?.text) {
        void handleTelegramChat(String(chat.id), payload.text);
      }
    }

    if (maxId > 0) {
      await setTelegramPollLastUpdateId(maxId);
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.warn("[telegram] getUpdates: request timed out (15s)");
    } else {
      console.warn("[telegram] ingestTelegramUpdatesOnce:", error instanceof Error ? error.message : error);
    }
  } finally {
    clearTimeout(timer);
  }
}

export function startTelegramUpdatesPollerIfConfigured() {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token || !env.TELEGRAM_POLL_ENABLED) {
    return;
  }

  const botHint = env.TELEGRAM_BOT_USERNAME
    ? `https://t.me/${env.TELEGRAM_BOT_USERNAME}`
    : "(set TELEGRAM_BOT_USERNAME to show link in logs)";

  console.log(`[telegram] Subscriber poll every ${env.TELEGRAM_POLL_INTERVAL_MS}ms — share bot: ${botHint}`);

  void ingestTelegramUpdatesOnce(token);
  pollIntervalHandle = setInterval(() => {
    void ingestTelegramUpdatesOnce(token);
  }, env.TELEGRAM_POLL_INTERVAL_MS);
}
