import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
import { env } from "../config/env.js";
import { searchLogs } from "./log-repository.js";

const openaiClient = env.OPENAI_API_KEY ? new OpenAI({ apiKey: env.OPENAI_API_KEY }) : null;
const geminiClient = env.GEMINI_API_KEY ? new GoogleGenerativeAI(env.GEMINI_API_KEY) : null;

function normalizeGeminiModelName(model: string) {
  // The models list API returns names like "models/gemini-2.5-flash".
  // The Node SDK expects just "gemini-2.5-flash" (without the "models/" prefix).
  return model.replace(/^models\//, "");
}

export async function answerLogQuestion(input: {
  question: string;
  project?: string;
  start?: string;
  end?: string;
}) {
  const logs = await searchLogs({
    project: input.project,
    start: input.start,
    end: input.end,
    limit: 120
  });

  const summary = logs.slice(0, 120).map((log) => ({
    timestamp: log.timestamp,
    project: log.project,
    service: log.service,
    container: log.containerName,
    level: log.level,
    message: log.message
  }));

  const contextText = JSON.stringify(summary, null, 2);
  const systemText =
    "You are an internal observability assistant. Answer using only the provided log context. If evidence is weak, say so. Highlight likely root causes, impacted service, and recommended next checks.";

  if (geminiClient) {
    try {
      const model = geminiClient.getGenerativeModel({
        model: normalizeGeminiModelName(env.GEMINI_MODEL),
        systemInstruction: systemText
      });

      const result = await model.generateContent({
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
      });

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
    const response = await openaiClient.responses.create({
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
    });

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
