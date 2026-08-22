import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { ChatTurn } from "@monitor-center/shared";
import { env } from "../config/env.js";
import { anthropicClient, minimaxClient, openaiClient, omnirouteClient, buildLogContext, withTimeout } from "./assistant-service.js";
import { searchLogs, getOverview, getErrorTimeseries, getSecuritySummary } from "./log-repository.js";
import { getLatestStats } from "./container-stats.js";
import { getUptimeStatuses } from "./uptime-checker.js";
import { getDiskUsage } from "./disk-space.js";

/**
 * Tool-use agent behind the web "AI Assistant" page. Unlike the legacy answerLogQuestion (which
 * always pre-fetches one fixed log window and does a single-shot completion), this agent starts
 * with only the question and lets the model pull whatever data it actually needs — possibly
 * several rounds of it — before answering. That's what makes it able to answer things like "so
 * sánh xu hướng lỗi tuần này với dashboard" or "container nào đang ăn RAM nhiều nhất" instead of
 * being limited to "errors/fatals in the last 24h".
 */

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function num(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

type JsonSchema = {
  type: "object";
  properties: Record<string, { type: string; description?: string }>;
  required?: string[];
};

type ToolSpec = {
  name: string;
  /** Short Vietnamese label shown as live progress in the UI while the tool runs. */
  progressLabel: string;
  description: string;
  parameters: JsonSchema;
  run: (input: Record<string, unknown>) => Promise<string>;
};

const TOOLS: ToolSpec[] = [
  {
    name: "search_logs",
    progressLabel: "Đang tìm log liên quan…",
    description:
      "Tìm kiếm log tuỳ ý theo project, service, container, mức độ (level), từ khoá trong nội dung, và khoảng thời gian. " +
      "Dùng để đào sâu vào 1 vấn đề cụ thể (vd: lỗi 500 của 1 service, log của 1 container, log chứa 1 từ khoá) thay vì chỉ xem log gần đây.",
    parameters: {
      type: "object",
      properties: {
        project: { type: "string", description: "Lọc theo project chính xác, bỏ trống để lấy tất cả" },
        service: { type: "string", description: "Lọc theo service chính xác" },
        containerName: { type: "string", description: "Lọc theo tên container chính xác" },
        level: { type: "string", description: "debug | info | warn | error | fatal" },
        q: { type: "string", description: "Từ khoá tìm trong nội dung log (message/raw), khớp một phần" },
        start: { type: "string", description: "ISO timestamp bắt đầu, vd 2026-08-20T00:00:00Z" },
        end: { type: "string", description: "ISO timestamp kết thúc" },
        limit: { type: "number", description: "Số log tối đa trả về (mặc định 50, tối đa 200)" }
      }
    },
    run: async (input) => {
      const limitRaw = num(input.limit);
      const limit = limitRaw && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 200) : 50;
      const logs = await searchLogs({
        project: str(input.project),
        service: str(input.service),
        containerName: str(input.containerName),
        level: str(input.level),
        q: str(input.q),
        start: str(input.start),
        end: str(input.end),
        limit
      });
      if (logs.length === 0) return "Không tìm thấy log nào khớp điều kiện.";
      const lines = logs.map(
        (l) => `[${l.timestamp}] ${l.level.toUpperCase()} ${l.project}/${l.service} (${l.containerName}): ${l.message}`
      );
      return `Tìm thấy ${logs.length} log (mới nhất trước, tối đa ${limit}):\n${lines.join("\n")}`;
    }
  },
  {
    name: "get_recent_issues",
    progressLabel: "Đang lấy log lỗi gần đây…",
    description:
      "Lấy nhanh log error/fatal trong 24h qua và log mọi mức độ trong 2h gần nhất (đã lọc bớt nhiễu bảo mật/maintenance). " +
      "Điểm khởi đầu tốt cho câu hỏi tổng quát kiểu 'hôm nay có gì bất thường không', trước khi đào sâu bằng search_logs.",
    parameters: {
      type: "object",
      properties: { project: { type: "string", description: "Lọc theo project cụ thể, bỏ trống để lấy tất cả" } }
    },
    run: async (input) => {
      const { logText, summary } = await buildLogContext({ project: str(input.project) });
      return summary.length ? logText : "Không có log error/fatal nào trong 24h qua, và không có log nào gần đây.";
    }
  },
  {
    name: "get_overview",
    progressLabel: "Đang lấy tổng quan hệ thống…",
    description:
      "Xem tổng quan toàn hệ thống: số container healthy/tổng theo từng project, số error/warn 24h theo project, " +
      "và top vấn đề nổi bật (đã gộp theo fingerprint, sắp theo số lần lặp).",
    parameters: { type: "object", properties: {} },
    run: async () => {
      const data = await getOverview();
      const projLines = data.projects.map(
        (p) =>
          `- ${p.project}: ${p.healthyContainers}/${p.containerCount} container healthy, ${p.errorCount24h} error, ${p.warnCount24h} warn (24h), log gần nhất: ${p.lastLogAt ?? "—"}`
      );
      const issueLines = data.issues
        .slice(0, 15)
        .map((i) => `- [${i.level.toUpperCase()}] ${i.project}/${i.service} x${i.count} — ${i.sampleMessage.slice(0, 160)} (gần nhất ${i.lastSeenAt})`);
      return [
        "Tổng quan project (24h):",
        projLines.join("\n") || "(không có project nào)",
        "",
        "Top vấn đề nổi bật (24h, đã gộp trùng lặp):",
        issueLines.join("\n") || "(không có vấn đề nào nổi bật)"
      ].join("\n");
    }
  },
  {
    name: "get_error_trend",
    progressLabel: "Đang phân tích xu hướng lỗi…",
    description:
      "Xem số lượng error/warn theo từng khung thời gian (bucket) trong N giờ gần nhất — dùng để trả lời câu hỏi về " +
      "xu hướng tăng/giảm, tăng đột biến, hoặc so sánh theo thời gian.",
    parameters: {
      type: "object",
      properties: {
        project: { type: "string", description: "Lọc theo project, bỏ trống để lấy toàn hệ thống" },
        hours: { type: "number", description: "Số giờ gần nhất cần xem, mặc định 6, tối đa 72" },
        bucketMinutes: { type: "number", description: "Độ rộng mỗi khung tính bằng phút, mặc định 30" }
      }
    },
    run: async (input) => {
      const hoursRaw = num(input.hours);
      const hours = hoursRaw && hoursRaw > 0 ? Math.min(hoursRaw, 72) : 6;
      const bucketRaw = num(input.bucketMinutes);
      const bucketMinutes = bucketRaw && bucketRaw > 0 ? Math.min(Math.max(Math.floor(bucketRaw), 5), 180) : 30;
      const project = str(input.project);
      const buckets = await getErrorTimeseries({ project, hours, bucketMinutes });
      const nonEmpty = buckets.filter((b) => b.errorCount > 0 || b.warnCount > 0);
      const totalError = buckets.reduce((sum, b) => sum + b.errorCount, 0);
      const totalWarn = buckets.reduce((sum, b) => sum + b.warnCount, 0);
      const lines = nonEmpty.map((b) => `${b.bucket}: ${b.errorCount} error, ${b.warnCount} warn`);
      return (
        `Xu hướng ${hours}h qua (mỗi khung ${bucketMinutes} phút)${project ? ` — project ${project}` : " — toàn hệ thống"}: ` +
        `tổng ${totalError} error, ${totalWarn} warn.\n${lines.join("\n") || "Không có error/warn nào trong khung thời gian này."}`
      );
    }
  },
  {
    name: "get_security_summary",
    progressLabel: "Đang kiểm tra sự kiện bảo mật…",
    description: "Xem tổng số sự kiện bảo mật (quét, tấn công, request đáng ngờ) trong 24h qua, top IP/đường dẫn/user-agent liên quan.",
    parameters: { type: "object", properties: {} },
    run: async () => {
      const s = await getSecuritySummary();
      const ipLines = s.topIps.slice(0, 10).map((x) => `- ${x.clientIp ?? "(unknown)"}: ${x.count}`);
      const pathLines = s.topPaths.slice(0, 10).map((x) => `- ${x.path ?? "(unknown)"}: ${x.count}`);
      const uaLines = s.topUserAgents.slice(0, 5).map((x) => `- ${x.userAgent ?? "(unknown)"}: ${x.count}`);
      return [
        `Sự kiện bảo mật 24h qua: ${s.total24h}`,
        "Top IP:",
        ipLines.join("\n") || "(không có)",
        "Top đường dẫn bị nhắm tới:",
        pathLines.join("\n") || "(không có)",
        "Top user-agent:",
        uaLines.join("\n") || "(không có)"
      ].join("\n");
    }
  },
  {
    name: "get_container_stats",
    progressLabel: "Đang lấy CPU/RAM container…",
    description: "Xem CPU/RAM hiện tại của tất cả container đang chạy.",
    parameters: { type: "object", properties: {} },
    run: async () => {
      const stats = getLatestStats();
      return stats.length
        ? stats
            .map(
              (s) =>
                `${s.containerName} (${s.project}/${s.service}): CPU ${s.cpuPercent.toFixed(1)}%, RAM ${s.memoryPercent.toFixed(1)}% ` +
                `(${(s.memoryUsageBytes / 1024 / 1024).toFixed(0)}MB/${(s.memoryLimitBytes / 1024 / 1024).toFixed(0)}MB)`
            )
            .join("\n")
        : "Chưa có dữ liệu container stats.";
    }
  },
  {
    name: "get_uptime_status",
    progressLabel: "Đang kiểm tra uptime…",
    description: "Xem trạng thái UP/DOWN hiện tại của các endpoint đang được theo dõi.",
    parameters: { type: "object", properties: {} },
    run: async () => {
      const checks = getUptimeStatuses();
      return checks.length
        ? checks.map((u) => `${u.name}: ${u.up ? "UP" : `DOWN${u.error ? ` (${u.error})` : ""}`} (${u.url})`).join("\n")
        : "Chưa cấu hình uptime check nào.";
    }
  },
  {
    name: "get_disk_usage",
    progressLabel: "Đang kiểm tra dung lượng đĩa…",
    description: "Xem dung lượng ổ đĩa VPS hiện tại (tổng, còn trống, % đã dùng).",
    parameters: { type: "object", properties: {} },
    run: async () => {
      const usage = getDiskUsage();
      const gb = (b: number) => `${(b / 1024 / 1024 / 1024).toFixed(1)}GB`;
      return `Đĩa: ${usage.usedPercent.toFixed(1)}% đã dùng, còn trống ${gb(usage.availableBytes)} / ${gb(usage.totalBytes)}.`;
    }
  }
];

const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/** Vietnamese label for a tool name, for live progress display — falls back to the raw name. */
export function getToolProgressLabel(toolName: string): string {
  return TOOLS_BY_NAME.get(toolName)?.progressLabel ?? `Đang chạy ${toolName}…`;
}

async function runReadOnlyTool(name: string, rawInput: unknown): Promise<string> {
  const tool = TOOLS_BY_NAME.get(name);
  if (!tool) return `Không có tool tên "${name}".`;
  const input = rawInput && typeof rawInput === "object" ? (rawInput as Record<string, unknown>) : {};
  try {
    return await tool.run(input);
  } catch (error) {
    return `Lỗi khi chạy tool ${name}: ${error instanceof Error ? error.message : "unknown error"}`;
  }
}

const ANTHROPIC_TOOLS: Anthropic.Tool[] = TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: t.parameters as Anthropic.Tool.InputSchema
}));

const OPENAI_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = TOOLS.map((t) => ({
  type: "function",
  function: { name: t.name, description: t.description, parameters: t.parameters }
}));

const ASSISTANT_AGENT_SYSTEM_PROMPT = `
Bạn là trợ lý AI vận hành & phân tích log cho Monitor Center — hệ thống giám sát nhiều project/container/server.
Bạn có các tool để tự truy vấn dữ liệu log/hệ thống theo thời gian thực. Hãy CHỦ ĐỘNG gọi tool để lấy đủ bằng chứng
trước khi trả lời — không đoán mò, không chỉ dựa vào một lần lấy log cố định.

Cách chọn tool:
- Câu hỏi tổng quát ("hôm nay thế nào", "có gì bất thường không", "project nào lỗi nhiều nhất") → bắt đầu bằng
  get_overview và get_recent_issues; nếu thấy nghi vấn ở project/service cụ thể thì đào sâu bằng search_logs
  (lọc theo project, service, level, từ khoá, khoảng thời gian phù hợp).
- Câu hỏi về xu hướng, tăng đột biến, so sánh theo thời gian → get_error_trend với hours/bucketMinutes phù hợp.
- Câu hỏi bảo mật (quét, tấn công, IP/đường dẫn đáng ngờ) → get_security_summary, có thể kết hợp search_logs.
- Câu hỏi hạ tầng (CPU/RAM, endpoint sống/chết, dung lượng đĩa) → get_container_stats / get_uptime_status / get_disk_usage.
- Có thể gọi nhiều tool, nhiều lượt liên tiếp để thu thập đủ bằng chứng trước khi kết luận.
- KHÔNG gọi tool nào khi câu hỏi không liên quan tới log/hệ thống (chat thường, kiến thức chung) — trả lời thẳng
  bằng kiến thức của bạn.
- Nếu dữ liệu thu thập được không đủ để kết luận chắc chắn, hãy nói rõ điều đó và nêu cần thêm thông tin gì, thay vì bịa đặt.

Cách trả lời:
- Trả lời đầy đủ, trọn vẹn — không cắt ngang giữa chừng. Nếu nội dung dài, ưu tiên các điểm quan trọng nhất nhưng
  vẫn phải có mở đầu, phần thân, và kết luận rõ ràng.
- Trả lời bằng tiếng Việt (trừ khi người dùng hỏi bằng ngôn ngữ khác), giọng văn rõ ràng, chuyên nghiệp.
- Định dạng bằng Markdown: dùng heading (## hoặc ###) khi câu trả lời có nhiều phần, gạch đầu dòng cho danh sách,
  **in đậm** cho từ khoá/kết luận quan trọng, bảng khi so sánh nhiều mục (nhiều project/service/lỗi), và code block
  (ba dấu backtick) khi trích nguyên văn log hoặc lệnh.
- Luôn nêu bằng chứng cụ thể lấy từ tool: thời gian, số lượng, tên project/service/container, trích message log liên
  quan — tránh nói chung chung, mơ hồ.
- Khi phù hợp (câu hỏi về sự cố/lỗi), kết thúc bằng mục "### Đề xuất tiếp theo" gợi ý nguyên nhân khả dĩ và bước kiểm
  tra/khắc phục tiếp theo.
`.trim();

const MAX_TOOL_ITERATIONS = 6;

type AnthropicMessageParam = Anthropic.MessageParam;
type OpenAiMessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type OnToolCall = (toolName: string) => void;

async function runAnthropicToolLoop(
  client: Anthropic,
  model: string,
  maxTokens: number,
  systemText: string,
  initialMessages: AnthropicMessageParam[],
  onToolCall?: OnToolCall
): Promise<string> {
  const messages = [...initialMessages];

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await withTimeout(
      client.messages.create({ model, max_tokens: maxTokens, system: systemText, tools: ANTHROPIC_TOOLS, messages }),
      env.AI_TIMEOUT_MS,
      "assistant-agent"
    );

    if (response.stop_reason === "refusal") {
      return "Trợ lý từ chối trả lời câu hỏi này. Hãy thử diễn đạt lại câu hỏi.";
    }

    const toolUseBlocks = response.content.filter((block): block is Anthropic.ToolUseBlock => block.type === "tool_use");

    if (toolUseBlocks.length === 0) {
      const textBlock = response.content.find((block): block is Anthropic.TextBlock => block.type === "text");
      return textBlock?.text ?? "";
    }

    messages.push({ role: "assistant", content: response.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of toolUseBlocks) {
      onToolCall?.(block.name);
      const resultText = await runReadOnlyTool(block.name, block.input);
      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: resultText });
    }

    messages.push({ role: "user", content: toolResults });
  }

  return "Mình đã tra cứu nhiều bước liên tiếp nhưng vẫn chưa đủ để kết luận chắc chắn — hãy hỏi cụ thể hơn (project, khoảng thời gian, service) để mình đào sâu tiếp.";
}

async function runOpenAiToolLoop(
  client: OpenAI,
  model: string,
  maxTokens: number,
  initialMessages: OpenAiMessageParam[],
  onToolCall?: OnToolCall
): Promise<string> {
  const messages = [...initialMessages];

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await withTimeout(
      client.chat.completions.create({
        model,
        max_tokens: maxTokens,
        temperature: 0.2,
        tools: OPENAI_TOOLS,
        messages
      }),
      env.AI_TIMEOUT_MS,
      "assistant-agent"
    );

    const message = response.choices[0]?.message;
    const toolCalls = message?.tool_calls ?? [];

    if (!message || toolCalls.length === 0) {
      return message?.content ?? "";
    }

    messages.push({ role: "assistant", content: message.content, tool_calls: message.tool_calls });

    for (const call of toolCalls) {
      if (call.type !== "function") continue;
      onToolCall?.(call.function.name);
      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = JSON.parse(call.function.arguments || "{}");
      } catch {
        // Malformed tool-call arguments — the tool runner will just see an empty input.
      }
      const resultText = await runReadOnlyTool(call.function.name, parsedArgs);
      messages.push({ role: "tool", tool_call_id: call.id, content: resultText });
    }
  }

  return "Mình đã tra cứu nhiều bước liên tiếp nhưng vẫn chưa đủ để kết luận chắc chắn — hãy hỏi cụ thể hơn (project, khoảng thời gian, service) để mình đào sâu tiếp.";
}

export async function answerAssistantQuestion(input: {
  question: string;
  project?: string;
  start?: string;
  end?: string;
  history?: ChatTurn[];
  /** "cheap" (default) tries free/low-cost providers first; "strong" promotes the paid Claude model. */
  tier?: "cheap" | "strong";
  onToolCall?: OnToolCall;
}): Promise<{ answer: string }> {
  const history = input.history ?? [];

  const hints: string[] = [];
  if (input.project) hints.push(`Project đang chọn trên UI: ${input.project} (chỉ ưu tiên dùng nếu câu hỏi không tự nêu project khác).`);
  if (input.start || input.end) {
    hints.push(
      `Khoảng thời gian gợi ý từ UI: ${input.start ?? "…"} → ${input.end ?? "hiện tại"} (dùng làm mặc định cho search_logs/get_error_trend nếu câu hỏi không nêu khoảng khác).`
    );
  }
  const userTurnText = hints.length ? `${input.question}\n\n(${hints.join(" ")})` : input.question;

  const anthropicInitialMessages: AnthropicMessageParam[] = [
    ...history.map((turn) => ({ role: turn.role, content: turn.text }) as AnthropicMessageParam),
    { role: "user", content: userTurnText }
  ];
  const openAiInitialMessages: OpenAiMessageParam[] = [
    { role: "system", content: ASSISTANT_AGENT_SYSTEM_PROMPT },
    ...history.map((turn) => ({ role: turn.role, content: turn.text }) as OpenAiMessageParam),
    { role: "user", content: userTurnText }
  ];

  type Attempt = { label: string; run: () => Promise<string> };
  let minimaxAttempt: Attempt | null = null;
  let anthropicAttempt: Attempt | null = null;
  let openaiAttempt: Attempt | null = null;
  const omnirouteAttempts: Attempt[] = [];

  if (minimaxClient) {
    const client = minimaxClient;
    minimaxAttempt = {
      label: "MiniMax",
      run: () =>
        runAnthropicToolLoop(
          client,
          env.MINIMAX_MODEL,
          env.MINIMAX_MAX_OUTPUT_TOKENS,
          ASSISTANT_AGENT_SYSTEM_PROMPT,
          anthropicInitialMessages,
          input.onToolCall
        )
    };
  }

  if (anthropicClient) {
    const client = anthropicClient;
    anthropicAttempt = {
      label: "Claude",
      run: () =>
        runAnthropicToolLoop(
          client,
          env.ANTHROPIC_MODEL,
          env.ANTHROPIC_MAX_OUTPUT_TOKENS,
          ASSISTANT_AGENT_SYSTEM_PROMPT,
          anthropicInitialMessages,
          input.onToolCall
        )
    };
  }

  if (openaiClient) {
    const client = openaiClient;
    openaiAttempt = {
      label: "OpenAI",
      run: () => runOpenAiToolLoop(client, env.OPENAI_MODEL, env.ANTHROPIC_MAX_OUTPUT_TOKENS, openAiInitialMessages, input.onToolCall)
    };
  }

  if (omnirouteClient) {
    const client = omnirouteClient;
    for (const model of env.OMNIROUTE_FREE_MODELS) {
      omnirouteAttempts.push({
        label: `OmniRoute(${model})`,
        run: () => runOpenAiToolLoop(client, model, env.MINIMAX_MAX_OUTPUT_TOKENS, openAiInitialMessages, input.onToolCall)
      });
    }
  }

  const tier = input.tier ?? "cheap";
  const attempts: Attempt[] =
    tier === "strong"
      ? [anthropicAttempt, minimaxAttempt, ...omnirouteAttempts, openaiAttempt].filter((a): a is Attempt => a !== null)
      : [minimaxAttempt, ...omnirouteAttempts, anthropicAttempt, openaiAttempt].filter((a): a is Attempt => a !== null);

  if (attempts.length === 0) {
    return {
      answer:
        "Chưa cấu hình AI key. Hãy set MINIMAX_API_KEY (khuyến nghị), OMNIROUTE_API_KEY, ANTHROPIC_API_KEY, hoặc OPENAI_API_KEY để bật AI assistant."
    };
  }

  let lastErrorMessage = "Unknown error";
  for (const attempt of attempts) {
    try {
      const answer = await attempt.run();
      if (answer && answer.trim()) return { answer };
      lastErrorMessage = "Model trả về câu trả lời rỗng";
    } catch (error) {
      lastErrorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error(`[assistant-agent] ${attempt.label} thất bại: ${lastErrorMessage}`);
    }
  }

  return { answer: `Không gọi được AI assistant lúc này. Lý do: ${lastErrorMessage}` };
}
