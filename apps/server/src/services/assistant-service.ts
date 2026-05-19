import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
import { env } from "../config/env.js";
import { searchLogs } from "./log-repository.js";

const openaiClient = env.OPENAI_API_KEY ? new OpenAI({ apiKey: env.OPENAI_API_KEY }) : null;
const geminiClient = env.GEMINI_API_KEY ? new GoogleGenerativeAI(env.GEMINI_API_KEY) : null;

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

  if (geminiClient) {
    try {
      const model = geminiClient.getGenerativeModel({
        model: normalizeGeminiModelName(env.GEMINI_MODEL),
        systemInstruction: systemText
      });

      const result = await withTimeout(
        model.generateContent({
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: `Question: ${input.question}\n\nContext logs:\n${contextText}`
                }
              ]
            }
          ],
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
        "Chưa cấu hình AI key. Hãy set GEMINI_API_KEY (khuyến nghị) hoặc OPENAI_API_KEY để bật AI assistant.",
      context: summary
    };
  }

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
                text: `Question: ${input.question}\n\nContext logs:\n${contextText}`
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
