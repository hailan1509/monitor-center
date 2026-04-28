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
  return raw.replace(/\u0000/g, "").trim();
}
