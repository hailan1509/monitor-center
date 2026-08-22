import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { ChatTurn } from "@monitor-center/shared";
import { env } from "../config/env.js";
import { searchLogs } from "./log-repository.js";

// Exported so telegram-agent.ts (tool-use loop) can reuse the same clients instead of
// re-instantiating — both are Anthropic-compatible and support the same tool_use API shape.
export const anthropicClient = env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }) : null;
// MiniMax's Anthropic-compatible endpoint — same @anthropic-ai/sdk client, just pointed at a
// different baseURL. Primary "cheap" tier provider.
export const minimaxClient = env.MINIMAX_API_KEY ? new Anthropic({ apiKey: env.MINIMAX_API_KEY, baseURL: env.MINIMAX_BASE_URL }) : null;
export const openaiClient = env.OPENAI_API_KEY ? new OpenAI({ apiKey: env.OPENAI_API_KEY }) : null;
// Self-hosted OmniRoute gateway — OpenAI-compatible endpoint fronting free-tier providers
// (mistral, etc). Tried after MiniMax and before the paid Anthropic/OpenAI keys.
export const omnirouteClient =
  env.OMNIROUTE_BASE_URL && env.OMNIROUTE_API_KEY
    ? new OpenAI({ apiKey: env.OMNIROUTE_API_KEY, baseURL: env.OMNIROUTE_BASE_URL })
    : null;

export type { ChatTurn };

// Exported so assistant-agent.ts (tool-use loop for the web Assistant page) can share the same
// per-call timeout behavior instead of duplicating it.
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`)), timeoutMs);
    })
  ]);
}

function isSecurityNoise(log: { metadata?: Record<string, unknown>; message: string; project: string; service: string }) {
  const category = typeof log.metadata?.category === "string" ? log.metadata.category : undefined;
  if (category === "security") return true;

  // Postgres checkpoints are normal maintenance; treat as noise for system-error analysis.
  if (log.service === "postgres" || log.project === "infra") {
    const msg = log.message.toLowerCase();
    if (msg.includes("checkpoint") || msg.includes("autovacuum") || msg.includes("database system is ready")) {
      return true;
    }
  }

  return false;
}

/** Shared by answerLogQuestion and the Telegram agent — pulls recent error/fatal + 2h-window logs. */
export async function buildLogContext(input: { project?: string; start?: string; end?: string }) {
  const now = new Date();
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const since2h = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();

  // Query song song: errors + fatals trong 24h, và tất cả levels trong 2h gần nhất
  const [errorLogs, fatalLogs, recentLogs] = await Promise.all([
    searchLogs({
      project: input.project,
      start: input.start ?? since24h,
      end: input.end,
      level: "error",
      limit: 100
    }),
    searchLogs({
      project: input.project,
      start: input.start ?? since24h,
      end: input.end,
      level: "fatal",
      limit: 50
    }),
    searchLogs({
      project: input.project,
      start: input.start ?? since2h,
      end: input.end,
      limit: 100
    })
  ]);

  // Merge và dedup theo id, ưu tiên errors
  const seen = new Set<string>();
  const merged = [...fatalLogs, ...errorLogs, ...recentLogs].filter((log) => {
    if (seen.has(log.id)) return false;
    seen.add(log.id);
    return true;
  });

  const filtered = merged.filter((log) => !isSecurityNoise(log));
  const summary = filtered.slice(0, 200).map((log) => ({
    timestamp: log.timestamp,
    project: log.project,
    service: log.service,
    container: log.containerName,
    level: log.level,
    message: log.message
  }));

  return { summary, logText: JSON.stringify(summary, null, 2) };
}

export async function answerLogQuestion(input: {
  question: string;
  project?: string;
  start?: string;
  end?: string;
  systemPrompt?: string;
  extraContext?: string;
  /** Prior turns in this conversation, oldest first — enables multi-turn follow-up questions. */
  history?: ChatTurn[];
  /** "cheap" (default) tries free/low-cost providers first; "strong" promotes the paid Claude
   * model to the front, for deliberate incident investigation instead of routine questions. */
  tier?: "cheap" | "strong";
}) {
  const { summary, logText } = await buildLogContext(input);
  const contextText = input.extraContext
    ? `${input.extraContext}\n\nLog gần nhất:\n${logText}`
    : logText;

  const systemText =
    input.systemPrompt ??
    "You are an internal observability assistant. Answer using only the provided log context. If evidence is weak, say so. Highlight likely root causes, impacted service, and recommended next checks.";

  // Log context is only attached to the newest turn — prior Q&A in `history` already
  // carries its own answer, so we don't want to re-paste hundreds of log lines every turn.
  const userTurnText = `Question: ${input.question}\n\nContext logs:\n${contextText}`;
  const history = input.history ?? [];

  // Each provider attempt is only attempted if configured, and a failure falls through to the
  // next one instead of failing the whole request. Order depends on `tier` (see below).
  type Attempt = { label: string; run: () => Promise<string> };
  let minimaxAttempt: Attempt | null = null;
  const omnirouteAttempts: Attempt[] = [];
  let anthropicAttempt: Attempt | null = null;
  let openaiAttempt: Attempt | null = null;

  if (minimaxClient) {
    minimaxAttempt = {
      label: "MiniMax",
      run: async () => {
        const response = await withTimeout(
          minimaxClient.messages.create({
            model: env.MINIMAX_MODEL,
            max_tokens: env.MINIMAX_MAX_OUTPUT_TOKENS,
            system: systemText,
            messages: [...history.map((turn) => ({ role: turn.role, content: turn.text })), { role: "user" as const, content: userTurnText }]
          }),
          env.AI_TIMEOUT_MS,
          "MiniMax"
        );

        if (response.stop_reason === "refusal") {
          return "MiniMax từ chối trả lời câu hỏi này. Hãy thử diễn đạt lại câu hỏi.";
        }

        const textBlock = response.content.find((block): block is Anthropic.TextBlock => block.type === "text");
        return textBlock?.text ?? "";
      }
    };
  }

  if (omnirouteClient) {
    for (const model of env.OMNIROUTE_FREE_MODELS) {
      omnirouteAttempts.push({
        label: `OmniRoute(${model})`,
        run: async () => {
          const response = await withTimeout(
            omnirouteClient.chat.completions.create({
              model,
              stream: false,
              temperature: 0.2,
              max_tokens: env.MINIMAX_MAX_OUTPUT_TOKENS,
              messages: [
                { role: "system", content: systemText },
                ...history.map((turn) => ({ role: turn.role, content: turn.text }) as const),
                { role: "user" as const, content: userTurnText }
              ]
            }),
            env.AI_TIMEOUT_MS,
            `OmniRoute(${model})`
          );

          const text = response.choices[0]?.message?.content;
          if (!text) throw new Error("Empty response");
          return text;
        }
      });
    }
  }

  if (anthropicClient) {
    anthropicAttempt = {
      label: "Claude",
      run: async () => {
        const response = await withTimeout(
          anthropicClient.messages.create({
            model: env.ANTHROPIC_MODEL,
            max_tokens: env.ANTHROPIC_MAX_OUTPUT_TOKENS,
            system: systemText,
            messages: [...history.map((turn) => ({ role: turn.role, content: turn.text })), { role: "user" as const, content: userTurnText }]
          }),
          env.AI_TIMEOUT_MS,
          "Claude"
        );

        if (response.stop_reason === "refusal") {
          return "Claude từ chối trả lời câu hỏi này. Hãy thử diễn đạt lại câu hỏi.";
        }

        const textBlock = response.content.find((block): block is Anthropic.TextBlock => block.type === "text");
        return textBlock?.text ?? "";
      }
    };
  }

  if (openaiClient) {
    openaiAttempt = {
      label: "OpenAI",
      run: async () => {
        const response = await withTimeout(
          openaiClient.responses.create({
            model: env.OPENAI_MODEL,
            input: [
              {
                role: "system",
                content: [{ type: "input_text", text: systemText }]
              },
              {
                role: "user",
                content: [{ type: "input_text", text: userTurnText }]
              }
            ]
          }),
          env.AI_TIMEOUT_MS,
          "OpenAI"
        );

        return response.output_text;
      }
    };
  }

  // "cheap" (default, for routine/frequent calls): MiniMax → OmniRoute free tier → Claude → OpenAI.
  // "strong" (deliberate incident investigation): Claude promoted to the front.
  const tier = input.tier ?? "cheap";
  const attempts: Attempt[] =
    tier === "strong"
      ? [anthropicAttempt, minimaxAttempt, ...omnirouteAttempts, openaiAttempt].filter((a): a is Attempt => a !== null)
      : [minimaxAttempt, ...omnirouteAttempts, anthropicAttempt, openaiAttempt].filter((a): a is Attempt => a !== null);

  if (attempts.length === 0) {
    return {
      answer:
        "Chưa cấu hình AI key. Hãy set MINIMAX_API_KEY (khuyến nghị), OMNIROUTE_API_KEY, ANTHROPIC_API_KEY, hoặc OPENAI_API_KEY để bật AI assistant.",
      context: summary
    };
  }

  let lastErrorMessage = "Unknown error";
  for (const attempt of attempts) {
    try {
      const answer = await attempt.run();
      return { answer, context: summary };
    } catch (error) {
      lastErrorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error(`[assistant] ${attempt.label} thất bại: ${lastErrorMessage}`);
    }
  }

  return {
    answer: `Không gọi được AI assistant lúc này. Lý do: ${lastErrorMessage}`,
    context: summary
  };
}
