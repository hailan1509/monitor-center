import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv();

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(8),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4.1-mini"),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-flash-latest"),
  GEMINI_MAX_OUTPUT_TOKENS: z.coerce.number().min(64).max(8192).default(2048),
  AI_TIMEOUT_MS: z.coerce.number().min(5_000).max(300_000).default(120_000),
  DOCKER_SOCKET_PATH: z.string().default("/var/run/docker.sock"),
  COOKIE_SECURE: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  TELEGRAM_BOT_TOKEN: z
    .string()
    .optional()
    .transform((value) => (value && value.trim() ? value.trim() : undefined)),
  /** Một hoặc nhiều chat id, cách nhau bằng dấu phẩy hoặc khoảng trắng (thường dùng: nhiều chat private sau khi mỗi người /start bot). */
  TELEGRAM_CHAT_ID: z
    .string()
    .optional()
    .transform((value) => {
      if (!value?.trim()) return undefined;
      const ids = value
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      return ids.length ? ids : undefined;
    }),
  TELEGRAM_DAILY_REPORT_CRON: z.string().default("0 22 * * *"),
  TELEGRAM_DAILY_REPORT_TIMEZONE: z.string().default("Asia/Ho_Chi_Minh"),
  TELEGRAM_DAILY_REPORT_QUESTION: z
    .string()
    .default(
      "Hãy phân tích log hôm nay: tóm tắt tình trạng từng hệ thống/project, các lỗi nổi bật (root cause khả dĩ), mức độ ảnh hưởng, và đề xuất bước kiểm tra tiếp theo. Trả lời ngắn gọn theo gạch đầu dòng."
    ),
  /** Gọi getUpdates định kỳ để lưu chat_id khi user nhắn bot (private). */
  TELEGRAM_POLL_ENABLED: z
    .string()
    .optional()
    .transform((value) => value !== "false"),
  TELEGRAM_POLL_INTERVAL_MS: z.coerce.number().min(3_000).max(120_000).default(15_000),
  /** Chỉ để log/hướng dẫn (vd MonitorCenterAI_bot). Không thay token. */
  TELEGRAM_BOT_USERNAME: z
    .string()
    .optional()
    .transform((value) => (value && value.trim() ? value.trim().replace(/^@/, "") : undefined)),
  /** Lần khởi động: xóa webhook để getUpdates hoạt động (nếu trước đó đã set webhook). */
  TELEGRAM_DELETE_WEBHOOK_ON_START: z
    .string()
    .optional()
    .transform((value) => value === "true")
});

export const env = envSchema.parse(process.env);
