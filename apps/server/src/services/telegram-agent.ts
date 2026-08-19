import Anthropic from "@anthropic-ai/sdk";
import type Docker from "dockerode";
import type { ChatTurn } from "@monitor-center/shared";
import { env } from "../config/env.js";
import { anthropicClient, minimaxClient, buildLogContext } from "./assistant-service.js";
import { restartContainer } from "./container-actions.js";
import { blockIp, unblockIp, listBlockedIps, isBlockableIp } from "./ip-blocklist.js";
import { getLatestStats } from "./container-stats.js";
import { getUptimeStatuses } from "./uptime-checker.js";
import { silenceManager } from "./silence-manager.js";

/**
 * Tools deliberately limited to actions already vetted elsewhere in the app (Telegram buttons,
 * REST admin endpoints) — bounded and reversible. No shell/exec, no log purge, no user
 * management: the agent can only do what a human could already safely do with one tap.
 */
const tools: Anthropic.Tool[] = [
  {
    name: "restart_container",
    description: "Khởi động lại 1 container Docker theo tên (vd: dfood_nginx). Dùng khi container đang lỗi/treo cần restart.",
    input_schema: {
      type: "object",
      properties: { containerName: { type: "string", description: "Tên container chính xác" } },
      required: ["containerName"]
    }
  },
  {
    name: "block_ip",
    description: "Chặn 1 IP trên firewall của VPS (iptables). Chỉ dùng cho IP thật sự đáng ngờ (quét, tấn công).",
    input_schema: {
      type: "object",
      properties: {
        ip: { type: "string" },
        reason: { type: "string", description: "Lý do chặn, ngắn gọn" }
      },
      required: ["ip"]
    }
  },
  {
    name: "unblock_ip",
    description: "Bỏ chặn 1 IP đã bị chặn trên firewall VPS.",
    input_schema: { type: "object", properties: { ip: { type: "string" } }, required: ["ip"] }
  },
  {
    name: "list_blocked_ips",
    description: "Liệt kê các IP hiện đang bị chặn trên firewall VPS.",
    input_schema: { type: "object", properties: {} }
  },
  {
    name: "get_container_stats",
    description: "Xem CPU/RAM hiện tại của tất cả container đang chạy.",
    input_schema: { type: "object", properties: {} }
  },
  {
    name: "get_uptime_status",
    description: "Xem trạng thái UP/DOWN hiện tại của các endpoint đang được theo dõi.",
    input_schema: { type: "object", properties: {} }
  },
  {
    name: "silence_alerts",
    description: "Tắt tạm thời cảnh báo Telegram cho 1 project (và service cụ thể nếu có) trong X phút — dùng khi đang bảo trì/deploy chủ động.",
    input_schema: {
      type: "object",
      properties: {
        project: { type: "string" },
        service: { type: "string", description: "Bỏ trống để tắt cảnh báo cho toàn bộ project" },
        durationMinutes: { type: "number" }
      },
      required: ["project", "durationMinutes"]
    }
  }
];

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" ? (input as Record<string, unknown>) : {};
}

async function runTool(docker: Docker, name: string, rawInput: unknown): Promise<string> {
  const input = asRecord(rawInput);

  switch (name) {
    case "restart_container": {
      const containerName = String(input.containerName ?? "");
      if (!containerName) return "Thiếu tên container.";
      await restartContainer(docker, containerName);
      return `Đã khởi động lại container ${containerName}.`;
    }
    case "block_ip": {
      const ip = String(input.ip ?? "");
      if (!isBlockableIp(ip)) return `IP ${ip} không hợp lệ hoặc không thể chặn (loopback/nội bộ Docker).`;
      const reason = typeof input.reason === "string" && input.reason ? input.reason : "Chặn qua Telegram agent";
      await blockIp(docker, ip, reason, "agent:telegram");
      return `Đã chặn IP ${ip} trên firewall VPS.`;
    }
    case "unblock_ip": {
      const ip = String(input.ip ?? "");
      await unblockIp(docker, ip);
      return `Đã bỏ chặn IP ${ip}.`;
    }
    case "list_blocked_ips": {
      const list = await listBlockedIps();
      return list.length
        ? list.map((b) => `${b.ip} — ${b.reason ?? "(không có lý do)"} — ${b.createdAt}`).join("\n")
        : "Không có IP nào đang bị chặn.";
    }
    case "get_container_stats": {
      const stats = getLatestStats();
      return stats.length
        ? stats
            .map((s) => `${s.containerName}: CPU ${s.cpuPercent.toFixed(1)}%, RAM ${s.memoryPercent.toFixed(1)}%`)
            .join("\n")
        : "Chưa có dữ liệu container stats.";
    }
    case "get_uptime_status": {
      const checks = getUptimeStatuses();
      return checks.length
        ? checks.map((u) => `${u.name}: ${u.up ? "UP" : `DOWN${u.error ? ` (${u.error})` : ""}`}`).join("\n")
        : "Chưa cấu hình uptime check nào.";
    }
    case "silence_alerts": {
      const project = String(input.project ?? "");
      const service = typeof input.service === "string" && input.service ? input.service : null;
      const durationMinutes = Number(input.durationMinutes ?? 60);
      if (!project) return "Thiếu tên project.";
      silenceManager.silence(project, service, durationMinutes * 60_000);
      return `Đã tắt cảnh báo cho ${project}${service ? `/${service}` : ""} trong ${durationMinutes} phút.`;
    }
    default:
      return `Không có tool tên "${name}".`;
  }
}

const AGENT_SYSTEM_PROMPT =
  "Bạn là trợ lý vận hành hệ thống server qua Telegram. Trả lời bằng tiếng Việt, ngắn gọn, rõ ràng. " +
  "Khi câu hỏi cần hành động cụ thể (restart container, chặn/bỏ chặn IP, xem trạng thái, tắt cảnh báo tạm thời), " +
  "hãy dùng tool tương ứng thay vì chỉ mô tả. Chỉ dùng tool khi thực sự cần thiết và đã đủ thông tin " +
  "(vd: biết chính xác tên container/IP) — nếu thiếu thông tin, hỏi lại người dùng thay vì đoán. " +
  "Sau khi dùng tool xong, tóm tắt kết quả cho người dùng bằng ngôn ngữ tự nhiên.";

const MAX_TOOL_ITERATIONS = 5;

type AnthropicMessageParam = Anthropic.MessageParam;

async function runAgentLoop(
  client: Anthropic,
  model: string,
  maxTokens: number,
  docker: Docker,
  systemText: string,
  initialMessages: AnthropicMessageParam[]
): Promise<string> {
  const messages = [...initialMessages];

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system: systemText,
      tools,
      messages
    });

    if (response.stop_reason === "refusal") {
      return "Agent từ chối trả lời/thực hiện yêu cầu này. Hãy thử diễn đạt lại.";
    }

    const toolUseBlocks = response.content.filter((block): block is Anthropic.ToolUseBlock => block.type === "tool_use");

    if (toolUseBlocks.length === 0) {
      const textBlock = response.content.find((block): block is Anthropic.TextBlock => block.type === "text");
      return textBlock?.text ?? "";
    }

    messages.push({ role: "assistant", content: response.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of toolUseBlocks) {
      let resultText: string;
      try {
        resultText = await runTool(docker, block.name, block.input);
      } catch (error) {
        resultText = `Lỗi khi chạy tool: ${error instanceof Error ? error.message : "unknown error"}`;
      }
      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: resultText });
    }

    messages.push({ role: "user", content: toolResults });
  }

  return "Agent xử lý quá nhiều bước liên tiếp, dừng lại để an toàn. Hãy hỏi cụ thể/chia nhỏ yêu cầu.";
}

/**
 * Tool-enabled Telegram agent — tries MiniMax then Claude (both Anthropic-compatible). Falls
 * back to null (caller should use the plain answerLogQuestion) if neither is configured or both fail.
 */
export async function runTelegramAgent(
  docker: Docker,
  question: string,
  systemContext: string,
  history: ChatTurn[]
): Promise<string | null> {
  const { logText } = await buildLogContext({});
  const userTurnText = `Bối cảnh hệ thống:\n${systemContext}\n\nLog gần đây:\n${logText}\n\nCâu hỏi: ${question}`;

  const historyMessages: AnthropicMessageParam[] = history.map((turn) => ({ role: turn.role, content: turn.text }));
  const initialMessages: AnthropicMessageParam[] = [...historyMessages, { role: "user", content: userTurnText }];

  const candidates: Array<{ client: Anthropic; model: string; maxTokens: number; label: string }> = [];
  if (minimaxClient) candidates.push({ client: minimaxClient, model: env.MINIMAX_MODEL, maxTokens: env.MINIMAX_MAX_OUTPUT_TOKENS, label: "MiniMax" });
  if (anthropicClient) candidates.push({ client: anthropicClient, model: env.ANTHROPIC_MODEL, maxTokens: env.ANTHROPIC_MAX_OUTPUT_TOKENS, label: "Claude" });

  for (const candidate of candidates) {
    try {
      return await runAgentLoop(candidate.client, candidate.model, candidate.maxTokens, docker, AGENT_SYSTEM_PROMPT, initialMessages);
    } catch (error) {
      console.error(`[telegram-agent] ${candidate.label} thất bại:`, error instanceof Error ? error.message : error);
    }
  }

  return null;
}
