import type { LogLevel } from "@monitor-center/shared";

const levelMatchers: Array<{ level: LogLevel; pattern: RegExp }> = [
  { level: "fatal", pattern: /\bfatal\b/i },
  // HTTP status codes are handled separately via access log parsing.
  // Avoid matching generic 3-digit numbers (e.g. timestamps like ".558") as errors.
  { level: "error", pattern: /\berror\b|\bexception\b|\bpanic\b/i },
  { level: "warn", pattern: /\bwarn\b|\bwarning\b/i },
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
  // Stack frames (e.g. "at process.processTimers (node:internal/timers:521:7)")
  // are context for an error, but shouldn't be treated as standalone error events.
  if (/^\s*at\s+\S+/.test(message)) {
    return "info";
  }

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
    // stderr doesn't always mean error (many containers, including Postgres, emit normal logs on stderr).
    // Keep it as info unless keywords/status codes match above.
    return "info";
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
