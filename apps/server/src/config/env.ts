import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv();

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(8),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-opus-5"),
  ANTHROPIC_MAX_OUTPUT_TOKENS: z.coerce.number().min(64).max(8192).default(2048),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4.1-mini"),
  /** MiniMax's Anthropic-compatible endpoint (https://api.minimax.io/anthropic) — called via
   * @anthropic-ai/sdk with a custom baseURL, same SDK as the real ANTHROPIC_API_KEY client below.
   * Primary "cheap" tier provider, replacing Gemini. */
  MINIMAX_API_KEY: z.string().optional(),
  MINIMAX_BASE_URL: z.string().default("https://api.minimax.io/anthropic"),
  MINIMAX_MODEL: z.string().default("MiniMax-M2.7-highspeed"),
  MINIMAX_MAX_OUTPUT_TOKENS: z.coerce.number().min(64).max(8192).default(2048),
  /** Self-hosted OmniRoute gateway (VPS) — OpenAI-compatible endpoint fronting several free-tier
   * providers. Used as a free fallback tier before the paid ANTHROPIC/OPENAI keys are hit. */
  OMNIROUTE_BASE_URL: z.string().optional(),
  OMNIROUTE_API_KEY: z.string().optional(),
  /** CSV of model ids to try in order, e.g. "mistral/mistral-small-latest,opencode/claude-sonnet-5".
   * Defaults to only mistral — at setup time opencode/pollinations returned 401 through OmniRoute
   * despite being listed as keyless-connected; add them back once that's fixed on the VPS side. */
  OMNIROUTE_FREE_MODELS: z
    .string()
    .optional()
    .transform((value) =>
      (!value?.trim() ? "mistral/mistral-small-latest" : value)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    ),
  AI_TIMEOUT_MS: z.coerce.number().min(5_000).max(300_000).default(120_000),
  DOCKER_SOCKET_PATH: z.string().default("/var/run/docker.sock"),
  COOKIE_SECURE: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  TELEGRAM_ERROR_ALERTS_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  /** CSV/space-separated: error,fatal,... */
  TELEGRAM_ERROR_ALERTS_LEVELS: z
    .string()
    .optional()
    .transform((value) => {
      if (!value?.trim()) return ["error", "fatal"];
      return value
        .split(/[\s,]+/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    }),
  /** Cooldown per (project/service/fingerprint) to avoid alert spam. */
  TELEGRAM_ERROR_ALERTS_COOLDOWN_MS: z.coerce.number().min(5_000).max(24 * 60 * 60 * 1000).default(60_000),
  /** Ignore security noise by default (scanner probes, etc.). */
  TELEGRAM_ERROR_ALERTS_INCLUDE_SECURITY: z
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
    .transform((value) => value === "true"),
  /** JSON array: [{"name":"myapp","url":"http://myapp/health","intervalMs":60000,"timeoutMs":10000}] */
  UPTIME_CHECKS: z
    .string()
    .optional()
    .transform((value) => {
      if (!value?.trim()) return [] as Array<{ name: string; url: string; intervalMs: number; timeoutMs: number }>;
      try {
        const parsed = JSON.parse(value) as Array<{ name: string; url: string; intervalMs?: number; timeoutMs?: number }>;
        return parsed.map((check) => ({
          name: check.name,
          url: check.url,
          intervalMs: check.intervalMs ?? 60_000,
          timeoutMs: check.timeoutMs ?? 10_000
        }));
      } catch {
        console.error("[env] UPTIME_CHECKS JSON không hợp lệ, bỏ qua.");
        return [] as Array<{ name: string; url: string; intervalMs: number; timeoutMs: number }>;
      }
    }),
  /** Ngưỡng memory (%) để gửi alert. Mặc định 90. */
  CONTAINER_MEMORY_ALERT_THRESHOLD: z.coerce.number().min(50).max(99).default(90),
  /** Bao lâu poll Docker stats một lần (ms). Mặc định 30s. */
  CONTAINER_STATS_INTERVAL_MS: z.coerce.number().min(10_000).max(300_000).default(30_000),
  /** Tự động chặn IP trên firewall VPS khi ip-anomaly-detector phát hiện bất thường (cả "scan"
   * lẫn "rate") — không gửi thông báo Telegram khi chặn thành công, chỉ log server-side. */
  IP_AUTO_BLOCK: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  /** Ngưỡng dung lượng ổ đĩa VPS (%) để gửi alert. Mặc định 85. */
  DISK_ALERT_THRESHOLD: z.coerce.number().min(50).max(99).default(85),
  /** Bao lâu kiểm tra dung lượng đĩa một lần (ms). Mặc định 5 phút. */
  DISK_CHECK_INTERVAL_MS: z.coerce.number().min(60_000).max(3_600_000).default(300_000)
});

export const env = envSchema.parse(process.env);
