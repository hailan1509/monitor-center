import type Docker from "dockerode";
import { env } from "../config/env.js";
import {
  getTelegramPollLastUpdateId,
  setTelegramPollLastUpdateId,
  upsertTelegramReportSubscriber
} from "./telegram-subscribers.js";
import { handleTelegramChat } from "./telegram-chat-handler.js";
import { runAlertAiAnalysis } from "./telegram-error-alerts.js";
import { silenceManager } from "./silence-manager.js";
import { blockIp, isBlockableIp } from "./ip-blocklist.js";
import { restartContainer } from "./container-actions.js";
import { formatForTelegram } from "./telegram-format.js";

const SILENCE_DURATION_MS = 60 * 60 * 1000;

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

type CallbackQuery = {
  id: string;
  data?: string;
  message?: { chat?: TelegramChat };
};

type TelegramUpdate = {
  update_id: number;
  message?: IncomingMessage;
  edited_message?: IncomingMessage;
  callback_query?: CallbackQuery;
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

async function answerCallbackQuery(token: string, callbackQueryId: string, text: string) {
  await telegramApi(token, "answerCallbackQuery", { callback_query_id: callbackQueryId, text });
}

async function sendPlainMessage(token: string, chatId: string, text: string) {
  const formatted = formatForTelegram(text);
  const result = await telegramApi(token, "sendMessage", { chat_id: chatId, text: formatted, parse_mode: "Markdown" });
  if (!result.ok) {
    // Likely unbalanced * _ ` entities left over from AI output — resend plain rather than lose the message.
    await telegramApi(token, "sendMessage", { chat_id: chatId, text: formatted });
  }
}

/**
 * callback_data encodes "action:rest". For "silence"/"aidetail", rest is "project:service"
 * (service may itself contain ":" so it's not re-split). For "blockip"/"restartcrash", rest is
 * just the IP / container name.
 */
async function handleCallbackQuery(token: string, query: CallbackQuery, docker: Docker) {
  const chatId = query.message?.chat?.id;
  const data = query.data ?? "";
  const separatorIndex1 = data.indexOf(":");
  if (chatId == null || separatorIndex1 === -1) {
    await answerCallbackQuery(token, query.id, "Không xử lý được yêu cầu.");
    return;
  }

  const action = data.slice(0, separatorIndex1);
  const rest = data.slice(separatorIndex1 + 1);

  if (action === "blockip") {
    const ip = rest;
    if (!isBlockableIp(ip)) {
      await answerCallbackQuery(token, query.id, "IP không hợp lệ.");
      return;
    }
    await answerCallbackQuery(token, query.id, "Đang chặn...");
    try {
      await blockIp(docker, ip, "Chặn qua cảnh báo Telegram", `telegram:${chatId}`);
      await sendPlainMessage(token, String(chatId), `🚫 Đã chặn IP ${ip} trên firewall VPS.`);
    } catch (error) {
      await sendPlainMessage(token, String(chatId), `❌ Không chặn được ${ip}: ${error instanceof Error ? error.message : "lỗi không rõ"}`);
    }
    return;
  }

  if (action === "restartcrash") {
    const containerName = rest;
    await answerCallbackQuery(token, query.id, "Đang khởi động lại...");
    try {
      // dockerode resolves either a container ID or name here — the alert only carries the name.
      await restartContainer(docker, containerName);
      await sendPlainMessage(token, String(chatId), `🔧 Đã khởi động lại container ${containerName}.`);
    } catch (error) {
      await sendPlainMessage(
        token,
        String(chatId),
        `❌ Không khởi động lại được ${containerName}: ${error instanceof Error ? error.message : "lỗi không rõ"}`
      );
    }
    return;
  }

  const separatorIndex2 = rest.indexOf(":");
  if (separatorIndex2 === -1) {
    await answerCallbackQuery(token, query.id, "Không xử lý được yêu cầu.");
    return;
  }
  const project = rest.slice(0, separatorIndex2);
  const service = rest.slice(separatorIndex2 + 1);

  if (action === "silence") {
    silenceManager.silence(project, service, SILENCE_DURATION_MS);
    await answerCallbackQuery(token, query.id, "Đã im lặng 1h");
    await sendPlainMessage(token, String(chatId), `🔇 Đã tắt alert cho ${project} / ${service} trong 1 giờ.`);
    return;
  }

  if (action === "aidetail") {
    await answerCallbackQuery(token, query.id, "Đang phân tích, chờ chút...");
    const analysis = await runAlertAiAnalysis(
      project,
      service,
      `Hãy phân tích sâu hơn tình trạng gần đây của ${project} / ${service}: nguyên nhân gốc rễ khả dĩ, mức độ ảnh hưởng, và bước kiểm tra/khắc phục tiếp theo.`
    );
    await sendPlainMessage(
      token,
      String(chatId),
      analysis ? `🤖 Phân tích sâu — ${project} / ${service}:\n${analysis}` : "❌ Không phân tích được lúc này, thử lại sau."
    );
    return;
  }

  await answerCallbackQuery(token, query.id, "Hành động không hợp lệ.");
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
export async function ingestTelegramUpdatesOnce(token: string, docker: Docker): Promise<void> {
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

      if (update.callback_query) {
        void handleCallbackQuery(token, update.callback_query, docker);
        continue;
      }

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
        void handleTelegramChat(String(chat.id), payload.text, docker);
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

export function startTelegramUpdatesPollerIfConfigured(docker: Docker) {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token || !env.TELEGRAM_POLL_ENABLED) {
    return;
  }

  const botHint = env.TELEGRAM_BOT_USERNAME
    ? `https://t.me/${env.TELEGRAM_BOT_USERNAME}`
    : "(set TELEGRAM_BOT_USERNAME to show link in logs)";

  console.log(`[telegram] Subscriber poll every ${env.TELEGRAM_POLL_INTERVAL_MS}ms — share bot: ${botHint}`);

  void ingestTelegramUpdatesOnce(token, docker);
  pollIntervalHandle = setInterval(() => {
    void ingestTelegramUpdatesOnce(token, docker);
  }, env.TELEGRAM_POLL_INTERVAL_MS);
}
