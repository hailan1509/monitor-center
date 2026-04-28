import type { LogLevel } from "@monitor-center/shared";

const levelMatchers: Array<{ level: LogLevel; pattern: RegExp }> = [
  { level: "fatal", pattern: /\bfatal\b/i },
  { level: "error", pattern: /\berror\b|\bexception\b|\bpanic\b|5\d{2}/i },
  { level: "warn", pattern: /\bwarn\b|\bwarning\b|4\d{2}/i },
  { level: "info", pattern: /\binfo\b|\bstarted\b|\blisten\b/i },
  { level: "debug", pattern: /\bdebug\b/i },
  { level: "trace", pattern: /\btrace\b/i }
];

export function inferLogLevel(message: string, stream: "stdout" | "stderr"): LogLevel {
  for (const matcher of levelMatchers) {
    if (matcher.pattern.test(message)) {
      return matcher.level;
    }
  }

  if (stream === "stderr") {
    return "error";
  }

  return "unknown";
}

export function normalizeMessage(raw: string) {
  // Clean up control characters and null bytes that can appear
  // when logs are framed or contain binary.
  return raw
    .replace(/\u0000/g, "")
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .trim();
}
