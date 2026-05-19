import { env } from "../config/env.js";
import { answerLogQuestion } from "./assistant-service.js";
import { getLatestStats } from "./container-stats.js";
import { getUptimeStatuses } from "./uptime-checker.js";

const COOLDOWN_MS = 5_000;
const lastHandledAt = new Map<string, number>();
const pendingChats = new Set<string>();

function chunkText(text: string, max = 3900) {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += max) chunks.push(text.slice(i, i + max));
  return chunks.length ? chunks : [text];
}

async function telegramPost(method: string, body: Record<string, unknown>) {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }).catch(() => undefined);
}

async function sendReply(chatId: string, text: string) {
  for (const chunk of chunkText(text)) {
    await telegramPost("sendMessage", { chat_id: chatId, text: chunk });
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

export async function handleTelegramChat(chatId: string, text: string): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  if (!text.trim()) return;

  const now = Date.now();
  if (now - (lastHandledAt.get(chatId) ?? 0) < COOLDOWN_MS) return;
  lastHandledAt.set(chatId, now);

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

    const result = await answerLogQuestion({
      question: text,
      systemPrompt:
        "Bạn là trợ lý giám sát hệ thống server. Trả lời bằng tiếng Việt, ngắn gọn và rõ ràng. " +
        "Dựa vào dữ liệu log và thông tin hệ thống được cung cấp. " +
        "Nếu không có đủ thông tin, hãy nói rõ. Không bịa đặt.",
      extraContext: systemContext
    });

    await sendReply(chatId, result.answer);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    await sendReply(chatId, `❌ Không xử lý được: ${msg}`);
  } finally {
    clearInterval(typingInterval);
    pendingChats.delete(chatId);
  }
}
