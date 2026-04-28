import type { LogLevel } from "@monitor-center/shared";

const levelMatchers: Array<{ level: LogLevel; pattern: RegExp }> = [
  { level: "fatal", pattern: /\bfatal\b/i },
  // Match real HTTP status codes, not byte sizes like "56167".
  { level: "error", pattern: /\berror\b|\bexception\b|\bpanic\b|\b5\d{2}\b/i },
  { level: "warn", pattern: /\bwarn\b|\bwarning\b|\b4\d{2}\b/i },
  { level: "info", pattern: /\binfo\b|\bstarted\b|\blisten\b/i },
  { level: "debug", pattern: /\bdebug\b/i },
  { level: "trace", pattern: /\btrace\b/i }
];

function parseHttpStatusFromAccessLog(message: string): number | null {
  // Common Nginx access log fragment:
  // "GET /path HTTP/1.1" 200 1234
  const match = message.match(/"([A-Z]+)\s+[^"]*\s+HTTP\/\d(?:\.\d)?\"\s+(\d{3})\b/);
  if (!match) return null;
  const status = Number(match[2]);
  return Number.isFinite(status) ? status : null;
}

export function inferLogLevel(message: string, stream: "stdout" | "stderr"): LogLevel {
  // If it's an HTTP access log, classify by status code.
  const status = parseHttpStatusFromAccessLog(message);
  if (status) {
    if (status >= 500) return "error";
    if (status >= 400) return "warn";
    return "info";
  }

  for (const matcher of levelMatchers) {
    if (matcher.pattern.test(message)) {
      return matcher.level;
    }
  }

  if (stream === "stderr") {
    // stderr doesn't always mean error (some containers write normal logs to stderr).
    return "warn";
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
