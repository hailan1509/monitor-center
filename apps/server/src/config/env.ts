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
    .transform((value) => value === "true")
});

export const env = envSchema.parse(process.env);
