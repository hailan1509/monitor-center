import { env } from "../config/env.js";
import {
  getTelegramPollLastUpdateId,
  setTelegramPollLastUpdateId,
  upsertTelegramReportSubscriber
} from "./telegram-subscribers.js";

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

/** Một vòng getUpdates: lưu subscriber từ chat private (dùng cho poller và script gửi thử). */
export async function ingestTelegramUpdatesOnce(token: string): Promise<void> {
  try {
    const lastStored = await getTelegramPollLastUpdateId();
    const offset = lastStored === 0 ? 0 : lastStored + 1;
    const response = await fetch(
      `https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=0`,
      { method: "GET" }
    );
    const data = (await response.json()) as GetUpdatesResponse;
    if (!data.ok) {
      console.error("[telegram] getUpdates:", data.description ?? `HTTP ${response.status}`);
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
    }

    if (maxId > 0) {
      await setTelegramPollLastUpdateId(maxId);
    }
  } catch (error) {
    console.error("[telegram] ingestTelegramUpdatesOnce:", error);
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
  setInterval(() => {
    void ingestTelegramUpdatesOnce(token);
  }, env.TELEGRAM_POLL_INTERVAL_MS);
}
