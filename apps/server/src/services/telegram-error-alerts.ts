import type { LogEvent } from "@monitor-center/shared";
import { env } from "../config/env.js";
import { listTelegramReportChatIds } from "./telegram-subscribers.js";
import { silenceManager } from "./silence-manager.js";
import type { SpikeResult } from "./spike-detector.js";

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

async function broadcastText(text: string): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  const chatIds = await resolveRecipientChatIds();
  if (chatIds.length === 0) return;

  const errors: string[] = [];
  for (const chatId of chatIds) {
    try {
      await sendTelegramText(token, chatId, text);
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

  void broadcastText(lines.join("\n"));
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

  void broadcastText(lines.join("\n"));
}
