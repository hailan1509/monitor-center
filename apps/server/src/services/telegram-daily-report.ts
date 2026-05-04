/**
 * Báo cáo định kỳ qua Telegram.
 * Người nhận: tự động từ DB (poller getUpdates khi user nhắn bot private) + tùy chọn TELEGRAM_CHAT_ID.
 */
import { schedule, validate } from "node-cron";
import { env } from "../config/env.js";
import { getZonedCalendarDayStartToNow } from "./log-repository.js";
import { answerLogQuestion } from "./assistant-service.js";
import { listTelegramReportChatIds } from "./telegram-subscribers.js";

async function resolveRecipientChatIds(): Promise<string[]> {
  const fromDb = await listTelegramReportChatIds();
  const fromEnv = env.TELEGRAM_CHAT_ID ?? [];
  return [...new Set([...fromDb, ...fromEnv])];
}

let lastSentDigestDateKey: string | null = null;

function localDateKeyInZone(timeZone: string, instant: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(instant);
}

async function sendTelegramText(token: string, chatId: string, text: string) {
  const max = 3900;
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += max) {
    chunks.push(text.slice(i, i + max));
  }

  for (let i = 0; i < chunks.length; i++) {
    const part =
      chunks.length > 1 ? `${chunks[i]}\n\n(${i + 1}/${chunks.length})` : chunks[i];
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

async function sendTelegramTextToAll(token: string, chatIds: string[], text: string) {
  const errors: string[] = [];
  for (const chatId of chatIds) {
    try {
      await sendTelegramText(token, chatId, text);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${chatId}: ${message}`);
    }
  }
  if (errors.length === chatIds.length) {
    throw new Error(`Telegram: gửi thất bại cho mọi chat:\n${errors.join("\n")}`);
  }
  if (errors.length > 0) {
    console.error("[telegram] Một số chat gửi lỗi:\n", errors.join("\n"));
  }
}

function buildAiDailyReportMessage(params: {
  timeZone: string;
  start: string;
  end: string;
  answer: string;
}) {
  const { timeZone, start, end, answer } = params;
  const startDate = new Date(start);
  const endDate = new Date(end);
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat("vi-VN", {
      timeZone,
      dateStyle: "short",
      timeStyle: "short"
    }).format(d);

  const lines: string[] = [];
  lines.push("📊 Monitor Center — AI Daily Log Report");
  lines.push(`Múi giờ: ${timeZone}`);
  lines.push(`Khung: ${fmt(startDate)} → ${fmt(endDate)}`);
  lines.push("");
  lines.push(answer.trim() || "(AI không trả lời được)");
  return lines.join("\n");
}

export async function runDailyTelegramDigestOnce(): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN must be set");
  }
  const chatIds = await resolveRecipientChatIds();
  if (chatIds.length === 0) {
    throw new Error(
      "Chưa có người nhận: nhắn bot (private) để đăng ký, hoặc set TELEGRAM_CHAT_ID. Đảm bảo TELEGRAM_POLL_ENABLED không phải false."
    );
  }

  const tz = env.TELEGRAM_DAILY_REPORT_TIMEZONE;
  const bounds = await getZonedCalendarDayStartToNow(tz);
  const ai = await answerLogQuestion({
    question: env.TELEGRAM_DAILY_REPORT_QUESTION,
    start: bounds.start,
    end: bounds.end
  });
  const message = buildAiDailyReportMessage({
    timeZone: tz,
    start: bounds.start,
    end: bounds.end,
    answer: ai.answer
  });
  await sendTelegramTextToAll(token, chatIds, message);
}

export function startTelegramDailyReportIfConfigured() {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return;
  }

  const expression = env.TELEGRAM_DAILY_REPORT_CRON;
  if (!validate(expression)) {
    console.error(`[telegram] Invalid TELEGRAM_DAILY_REPORT_CRON: ${expression}`);
    return;
  }

  schedule(
    expression,
    async () => {
      const tz = env.TELEGRAM_DAILY_REPORT_TIMEZONE;
      const dateKey = localDateKeyInZone(tz, new Date());
      if (lastSentDigestDateKey === dateKey) {
        return;
      }

      try {
        const chatIds = await resolveRecipientChatIds();
        if (chatIds.length === 0) {
          console.warn(
            "[telegram] Bỏ qua báo cáo: chưa có subscriber (nhắn bot để đăng ký) và không có TELEGRAM_CHAT_ID."
          );
          return;
        }

        const bounds = await getZonedCalendarDayStartToNow(tz);
        const ai = await answerLogQuestion({
          question: env.TELEGRAM_DAILY_REPORT_QUESTION,
          start: bounds.start,
          end: bounds.end
        });
        const message = buildAiDailyReportMessage({
          timeZone: tz,
          start: bounds.start,
          end: bounds.end,
          answer: ai.answer
        });
        await sendTelegramTextToAll(token, chatIds, message);
        lastSentDigestDateKey = dateKey;
        console.log(`[telegram] Daily digest sent (${dateKey}) → ${chatIds.length} chat(s)`);
      } catch (error) {
        console.error("[telegram] Daily digest failed:", error);
      }
    },
    { timezone: env.TELEGRAM_DAILY_REPORT_TIMEZONE, noOverlap: true }
  );

  console.log(
    `[telegram] Daily digest scheduled (${expression}, ${env.TELEGRAM_DAILY_REPORT_TIMEZONE}); recipients = DB subscribers ∪ TELEGRAM_CHAT_ID`
  );
}
