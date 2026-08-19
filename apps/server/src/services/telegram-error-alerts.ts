import type { LogEvent } from "@monitor-center/shared";
import { env } from "../config/env.js";
import { listTelegramReportChatIds } from "./telegram-subscribers.js";
import { silenceManager } from "./silence-manager.js";
import type { SpikeResult } from "./spike-detector.js";
import type { IpAnomaly } from "./ip-anomaly-detector.js";
import { answerLogQuestion } from "./assistant-service.js";
import { formatForTelegram } from "./telegram-format.js";
import { trySendAsDocument } from "./telegram-report.js";

export type InlineKeyboardButton = { text: string; callback_data: string };

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

async function sendTelegramText(token: string, chatId: string, text: string, buttons?: InlineKeyboardButton[][]) {
  if (await trySendAsDocument(token, chatId, text, buttons)) return;

  const parts = chunkText(formatForTelegram(text));
  for (let i = 0; i < parts.length; i++) {
    // Buttons only make sense attached to the final chunk (the one the user reads last).
    const isLast = i === parts.length - 1;
    const baseBody = {
      chat_id: chatId,
      text: parts[i],
      disable_web_page_preview: true,
      ...(isLast && buttons ? { reply_markup: { inline_keyboard: buttons } } : {})
    };

    let response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...baseBody, parse_mode: "Markdown" })
    });
    let payload = (await response.json()) as { ok: boolean; description?: string };

    if (!payload.ok) {
      // Likely unbalanced * _ ` entities left over from AI output — resend plain rather than lose the alert.
      response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(baseBody)
      });
      payload = (await response.json()) as { ok: boolean; description?: string };
    }

    if (!payload.ok) {
      throw new Error(payload.description ?? `Telegram HTTP ${response.status}`);
    }
  }
}

export async function broadcastText(text: string, buttons?: InlineKeyboardButton[][]): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  const chatIds = await resolveRecipientChatIds();
  if (chatIds.length === 0) return;

  const errors: string[] = [];
  for (const chatId of chatIds) {
    try {
      await sendTelegramText(token, chatId, text, buttons);
    } catch (error) {
      errors.push(`${chatId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (errors.length === chatIds.length) {
    console.error(`[telegram] Alert failed for all chats (${chatIds.length}): ${errors.join(" | ")}`);
  } else if (errors.length) {
    console.warn(`[telegram] Alert failed for ${errors.length}/${chatIds.length} chat(s): ${errors.join(" | ")}`);
  }
}

/** Best-effort AI root-cause analysis for an alert; returns null on failure so alert delivery is never blocked by it. */
export async function runAlertAiAnalysis(project: string, service: string, question: string): Promise<string | null> {
  try {
    const result = await answerLogQuestion({
      project,
      question,
      systemPrompt:
        "Bạn là trợ lý giám sát hệ thống server. Dựa vào log được cung cấp, phân tích nguyên nhân khả dĩ, mức độ ảnh hưởng, " +
        "và đề xuất bước kiểm tra tiếp theo. Trả lời bằng tiếng Việt, ngắn gọn theo gạch đầu dòng, tối đa ~6 dòng. " +
        "Đây là tin nhắn Telegram: không dùng bảng markdown, không dùng heading #.",
      // Crash/spike alerts are an actual incident moment — worth the paid Claude model first.
      tier: "strong"
    });
    return result.answer || null;
  } catch {
    return null;
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

function nowVietnam() {
  return formatVietnamTime(new Date().toISOString());
}

function formatAlert(log: AlertLog) {
  const lines: string[] = [];
  lines.push(`🚨 [${String(log.level).toUpperCase()}] ${log.project} / ${log.service}`);
  lines.push(`🕐 ${formatVietnamTime(log.timestamp)}`);
  lines.push(`📦 Container: ${log.containerName}`);
  lines.push(`📡 Stream: ${log.stream} | Mức: ${log.level}`);
  if (log.fingerprint) {
    lines.push(`🔑 Fingerprint: ${log.fingerprint.slice(0, 8)}`);
  }
  lines.push("─────────────────────");
  lines.push(log.message);
  return lines.join("\n");
}

// ─── Error alert ─────────────────────────────────────────────────────────────

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

    // Bỏ qua log nội bộ của chính monitor-server để tránh feedback loop.
    if (/^\[telegram\]|\[db\]/.test(log.message)) return;

    // Bỏ qua nếu đang trong maintenance window.
    if (silenceManager.isSilenced(log.project, log.service)) return;

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
        await broadcastText(formatAlert(log));
      } finally {
        this.#inflight.delete(key);
      }
    })();

    this.#inflight.set(key, task);
    await task;
  }
}

export const telegramErrorAlerter = new TelegramErrorAlerter();

// ─── Crash alert ──────────────────────────────────────────────────────────────

const crashCooldowns = new Map<string, number>();
const CRASH_ALERT_COOLDOWN_MS = 5 * 60 * 1000; // 5 phút / container

export type CrashInfo = {
  project: string;
  service: string;
  containerName: string;
  exitCode: number | null;
};

export async function sendCrashAlert(info: CrashInfo): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  if (!env.TELEGRAM_ERROR_ALERTS_ENABLED) return;
  if (silenceManager.isSilenced(info.project, info.service)) return;

  const key = `crash::${info.containerName}`;
  const now = Date.now();
  if (now - (crashCooldowns.get(key) ?? 0) < CRASH_ALERT_COOLDOWN_MS) return;
  crashCooldowns.set(key, now);

  const exitLabel = info.exitCode !== null ? `Exit code: ${info.exitCode}` : "Exit code: unknown";
  const lines = [
    `💀 Container crash — ${info.project} / ${info.service}`,
    `🕐 ${nowVietnam()}`,
    `📦 Container: ${info.containerName}`,
    `⚠️  ${exitLabel}`
  ];

  void broadcastText(lines.join("\n"), [
    [
      { text: "🔧 Khởi động lại container", callback_data: `restartcrash:${info.containerName}` },
      { text: "🔇 Im lặng 1h", callback_data: `silence:${info.project}:${info.service}` }
    ],
    [{ text: "🤖 Phân tích sâu hơn", callback_data: `aidetail:${info.project}:${info.service}` }]
  ]);

  // AI root-cause analysis runs after the base alert so delivery isn't delayed by the AI call.
  void (async () => {
    const analysis = await runAlertAiAnalysis(
      info.project,
      info.service,
      `Container ${info.containerName} (service ${info.service}) vừa crash, ${exitLabel}. Dựa vào log gần nhất, nguyên nhân khả dĩ là gì?`
    );
    if (analysis) {
      void broadcastText(`🤖 Phân tích AI — ${info.project} / ${info.service}:\n${analysis}`);
    }
  })();
}

// ─── Spike alert ──────────────────────────────────────────────────────────────

export async function sendSpikeAlert(
  project: string,
  service: string,
  spike: SpikeResult
): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  if (!env.TELEGRAM_ERROR_ALERTS_ENABLED) return;
  if (silenceManager.isSilenced(project, service)) return;

  const baselineLabel =
    spike.baselineRate < 1
      ? "chưa có baseline"
      : `baseline ~${spike.baselineRate.toFixed(1)} errors/5 phút`;

  const lines = [
    `📈 Error spike — ${project} / ${service}`,
    `🕐 ${nowVietnam()}`,
    `⚡ ${spike.recentCount} errors trong 5 phút (${baselineLabel})`
  ];

  void broadcastText(lines.join("\n"), [
    [
      { text: "🔇 Im lặng 1h", callback_data: `silence:${project}:${service}` },
      { text: "🤖 Phân tích sâu hơn", callback_data: `aidetail:${project}:${service}` }
    ]
  ]);

  // AI root-cause analysis runs after the base alert so delivery isn't delayed by the AI call.
  void (async () => {
    const analysis = await runAlertAiAnalysis(
      project,
      service,
      `Vừa phát hiện error spike: ${spike.recentCount} lỗi trong 5 phút (${baselineLabel}). Dựa vào log gần nhất, nguyên nhân khả dĩ là gì?`
    );
    if (analysis) {
      void broadcastText(`🤖 Phân tích AI — ${project} / ${service}:\n${analysis}`);
    }
  })();
}

// ─── IP anomaly alert ─────────────────────────────────────────────────────────

export async function sendIpAnomalyAlert(ip: string, project: string, service: string, anomaly: IpAnomaly): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  if (!env.TELEGRAM_ERROR_ALERTS_ENABLED) return;

  const detailLine =
    anomaly.type === "scan"
      ? `🔎 Đang quét: ${anomaly.count} request đáng ngờ trong 5 phút`
      : `⚡ Gọi API dồn dập: ${anomaly.count} request trong 1 phút`;

  const pathLines = anomaly.topPaths.map((p) => `   • ${p.path} (${p.count})`);

  const lines = [
    `🕵️ IP bất thường — ${ip}`,
    `🕐 ${nowVietnam()}`,
    `📦 Gần nhất: ${project} / ${service}`,
    detailLine,
    ...pathLines
  ];

  void broadcastText(lines.join("\n"), [[{ text: "🚫 Chặn IP ngay", callback_data: `blockip:${ip}` }]]);
}
