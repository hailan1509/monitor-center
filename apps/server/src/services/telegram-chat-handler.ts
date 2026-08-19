import type Docker from "dockerode";
import type { ChatTurn } from "@monitor-center/shared";
import { env } from "../config/env.js";
import { answerLogQuestion } from "./assistant-service.js";
import { runTelegramAgent } from "./telegram-agent.js";
import { getLatestStats } from "./container-stats.js";
import { getUptimeStatuses } from "./uptime-checker.js";
import { formatForTelegram } from "./telegram-format.js";
import { trySendAsDocument } from "./telegram-report.js";

const COOLDOWN_MS = 5_000;
const lastHandledAt = new Map<string, number>();
const pendingChats = new Set<string>();

// Per-chat conversation memory so follow-up questions ("còn container kia thì sao?")
// carry context. Bounded by turn count and reset after inactivity to avoid unbounded growth.
const CHAT_HISTORY_MAX_TURNS = 12;
const CHAT_HISTORY_IDLE_RESET_MS = 30 * 60 * 1000;
const chatHistories = new Map<string, { turns: ChatTurn[]; updatedAt: number }>();

function getChatHistory(chatId: string): ChatTurn[] {
  const entry = chatHistories.get(chatId);
  if (!entry) return [];
  if (Date.now() - entry.updatedAt > CHAT_HISTORY_IDLE_RESET_MS) {
    chatHistories.delete(chatId);
    return [];
  }
  return entry.turns;
}

function appendChatHistory(chatId: string, question: string, answer: string) {
  const turns = [...getChatHistory(chatId), { role: "user" as const, text: question }, { role: "assistant" as const, text: answer }];
  chatHistories.set(chatId, { turns: turns.slice(-CHAT_HISTORY_MAX_TURNS), updatedAt: Date.now() });
}

function chunkText(text: string, max = 3900) {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += max) chunks.push(text.slice(i, i + max));
  return chunks.length ? chunks : [text];
}

async function telegramPost(method: string, body: Record<string, unknown>): Promise<{ ok: boolean; description?: string }> {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, description: "no token" };
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    return (await response.json()) as { ok: boolean; description?: string };
  } catch (error) {
    return { ok: false, description: error instanceof Error ? error.message : "network error" };
  }
}

async function sendReply(chatId: string, text: string) {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (token && (await trySendAsDocument(token, chatId, text))) return;

  for (const chunk of chunkText(formatForTelegram(text))) {
    const result = await telegramPost("sendMessage", { chat_id: chatId, text: chunk, parse_mode: "Markdown" });
    if (!result.ok) {
      // Likely unbalanced * _ ` entities left over from AI output — resend plain rather than lose the message.
      await telegramPost("sendMessage", { chat_id: chatId, text: chunk });
    }
  }
}

function buildSystemContext(): string {
  const stats = getLatestStats();
  const uptime = getUptimeStatuses();
  const lines: string[] = [];

  if (stats.length) {
    lines.push("Trạng thái container:");
    for (const s of stats) {
      lines.push(`  ${s.containerName}: CPU ${s.cpuPercent.toFixed(1)}%, RAM ${s.memoryPercent.toFixed(1)}% (${(s.memoryUsageBytes / 1024 / 1024).toFixed(0)}MB)`);
    }
  }

  if (uptime.length) {
    lines.push("Uptime checks:");
    for (const u of uptime) {
      const status = u.up
        ? `UP ${u.latencyMs != null ? `(${u.latencyMs}ms)` : ""}`
        : `DOWN${u.error ? ` — ${u.error}` : ""}`;
      lines.push(`  ${u.name}: ${status}`);
    }
  }

  return lines.join("\n");
}

export async function handleTelegramChat(chatId: string, text: string, docker: Docker): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  if (!text.trim()) return;

  const now = Date.now();
  if (now - (lastHandledAt.get(chatId) ?? 0) < COOLDOWN_MS) return;
  lastHandledAt.set(chatId, now);

  if (text.trim() === "/new" || text.trim() === "/reset") {
    chatHistories.delete(chatId);
    await sendReply(chatId, "🔄 Đã bắt đầu cuộc hội thoại mới.");
    return;
  }

  if (pendingChats.has(chatId)) {
    await sendReply(chatId, "⏳ Đang xử lý câu hỏi trước, vui lòng đợi...");
    return;
  }
  pendingChats.add(chatId);

  // Refresh typing indicator mỗi 4s trong khi AI đang xử lý
  const typingInterval = setInterval(() => {
    void telegramPost("sendChatAction", { chat_id: chatId, action: "typing" });
  }, 4_000);
  void telegramPost("sendChatAction", { chat_id: chatId, action: "typing" });

  try {
    const systemContext = buildSystemContext();
    const history = getChatHistory(chatId);

    // Agent path can restart containers / block-unblock IPs / check status / silence alerts on
    // request. Falls back to the plain log Q&A if no Anthropic-compatible provider is configured
    // or every candidate errors out.
    let answer = await runTelegramAgent(docker, text, systemContext, history);

    if (answer === null) {
      const result = await answerLogQuestion({
        question: text,
        systemPrompt:
          "Bạn là trợ lý giám sát hệ thống server. Trả lời bằng tiếng Việt, ngắn gọn và rõ ràng. " +
          "Dựa vào dữ liệu log và thông tin hệ thống được cung cấp. " +
          "Nếu không có đủ thông tin, hãy nói rõ. Không bịa đặt. " +
          "Đây là tin nhắn Telegram, không phải tài liệu: không dùng bảng markdown, không dùng heading #, " +
          "ưu tiên gạch đầu dòng ngắn gọn và *in đậm* (một dấu sao) cho từ khoá quan trọng.",
        extraContext: systemContext,
        history
      });
      answer = result.answer;
    }

    appendChatHistory(chatId, text, answer);
    await sendReply(chatId, answer);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    await sendReply(chatId, `❌ Không xử lý được: ${msg}`);
  } finally {
    clearInterval(typingInterval);
    pendingChats.delete(chatId);
  }
}
