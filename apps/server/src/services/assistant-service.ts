import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
import type { ChatTurn } from "@monitor-center/shared";
import { env } from "../config/env.js";
import { searchLogs } from "./log-repository.js";

const anthropicClient = env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }) : null;
const geminiClient = env.GEMINI_API_KEY ? new GoogleGenerativeAI(env.GEMINI_API_KEY) : null;
const openaiClient = env.OPENAI_API_KEY ? new OpenAI({ apiKey: env.OPENAI_API_KEY }) : null;

export type { ChatTurn };

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`)), timeoutMs);
    })
  ]);
}

function normalizeGeminiModelName(model: string) {
  // The models list API returns names like "models/gemini-2.5-flash".
  // The Node SDK expects just "gemini-2.5-flash" (without the "models/" prefix).
  return model.replace(/^models\//, "");
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

export async function answerLogQuestion(input: {
  question: string;
  project?: string;
  start?: string;
  end?: string;
  systemPrompt?: string;
  extraContext?: string;
  /** Prior turns in this conversation, oldest first — enables multi-turn follow-up questions. */
  history?: ChatTurn[];
}) {
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

  const logText = JSON.stringify(summary, null, 2);
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

  if (anthropicClient) {
    try {
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
        return {
          answer: "Claude từ chối trả lời câu hỏi này. Hãy thử diễn đạt lại câu hỏi.",
          context: summary
        };
      }

      const textBlock = response.content.find((block): block is Anthropic.TextBlock => block.type === "text");
      return {
        answer: textBlock?.text ?? "",
        context: summary
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        answer: `Không gọi được Claude lúc này. Lý do: ${message}`,
        context: summary
      };
    }
  }

  if (geminiClient) {
    try {
      const model = geminiClient.getGenerativeModel({
        model: normalizeGeminiModelName(env.GEMINI_MODEL),
        systemInstruction: systemText
      });

      const historyContents = history.map((turn) => ({
        role: turn.role === "assistant" ? "model" : "user",
        parts: [{ text: turn.text }]
      }));

      const result = await withTimeout(
        model.generateContent({
          contents: [...historyContents, { role: "user", parts: [{ text: userTurnText }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: env.GEMINI_MAX_OUTPUT_TOKENS
          }
        }),
        env.AI_TIMEOUT_MS,
        "Gemini"
      );

      return {
        answer: result.response.text(),
        context: summary
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        answer: `Không gọi được Gemini lúc này. Lý do: ${message}`,
        context: summary
      };
    }
  }

  if (!openaiClient) {
    return {
      answer:
        "Chưa cấu hình AI key. Hãy set ANTHROPIC_API_KEY (khuyến nghị), GEMINI_API_KEY, hoặc OPENAI_API_KEY để bật AI assistant.",
      context: summary
    };
  }

  // OpenAI is the last-resort fallback (after Claude and Gemini); kept single-turn for
  // simplicity — multi-turn is covered by the two higher-priority providers above.
  try {
    const response = await withTimeout(
      openaiClient.responses.create({
        model: env.OPENAI_MODEL,
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text: systemText
              }
            ]
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: userTurnText
              }
            ]
          }
        ]
      }),
      env.AI_TIMEOUT_MS,
      "OpenAI"
    );

    return {
      answer: response.output_text,
      context: summary
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      answer: `Không gọi được AI assistant lúc này. Lý do: ${message}`,
      context: summary
    };
  }
}
