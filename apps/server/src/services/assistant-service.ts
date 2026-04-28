import OpenAI from "openai";
import { env } from "../config/env.js";
import { searchLogs } from "./log-repository.js";

const client = env.OPENAI_API_KEY ? new OpenAI({ apiKey: env.OPENAI_API_KEY }) : null;

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

  if (!client) {
    return {
      answer:
        "OPENAI_API_KEY chưa được cấu hình. Hệ thống đã trả về dữ liệu log thô để bạn kiểm tra trong dashboard, nhưng AI assistant chưa thể phân tích sâu.",
      context: summary
    };
  }

  try {
    const response = await client.responses.create({
      model: env.OPENAI_MODEL,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text:
                "You are an internal observability assistant. Answer using only the provided log context. If evidence is weak, say so. Highlight likely root causes, impacted service, and recommended next checks."
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Question: ${input.question}\n\nContext logs:\n${JSON.stringify(summary, null, 2)}`
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
