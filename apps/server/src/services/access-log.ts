export type ParsedAccessLog = {
  clientIp: string;
  method: string;
  path: string;
  status: number;
  bytes?: number;
  referer?: string;
  userAgent?: string;
};

// Nginx combined log (common default):
// 118.70.177.107 - - [28/Apr/2026:10:45:29 +0000] "GET /api/dashboard/overview HTTP/1.1" 200 56167 "http://host/" "UA" "-"
const accessLogRegex =
  /^(?<ip>\S+)\s+\S+\s+\S+\s+\[[^\]]+\]\s+"(?<method>[A-Z]+)\s+(?<path>\S+)\s+HTTP\/(?<httpver>[\d.]+)"\s+(?<status>\d{3})\s+(?<bytes>\d+|-)\s+"(?<referer>[^"]*)"\s+"(?<ua>[^"]*)"/;

export function parseNginxAccessLog(line: string): ParsedAccessLog | null {
  const match = line.match(accessLogRegex);
  if (!match?.groups) return null;

  const status = Number(match.groups.status);
  if (!Number.isFinite(status)) return null;

  const bytesRaw = match.groups.bytes;
  const bytes = bytesRaw && bytesRaw !== "-" ? Number(bytesRaw) : undefined;

  return {
    clientIp: match.groups.ip,
    method: match.groups.method,
    path: match.groups.path,
    status,
    bytes,
    referer: match.groups.referer && match.groups.referer !== "-" ? match.groups.referer : undefined,
    userAgent: match.groups.ua && match.groups.ua !== "-" ? match.groups.ua : undefined
  };
}

export function classifySecurityEvent(input: { path?: string; status?: number; userAgent?: string; message: string }) {
  const path = (input.path ?? "").toLowerCase();
  const ua = (input.userAgent ?? "").toLowerCase();
  const message = input.message.toLowerCase();
  const status = input.status ?? 0;

  const suspiciousPathPrefixes = [
    "/xmlrpc.php",
    "/wp-login.php",
    "/wp-admin",
    "/wp-content",
    "/wp-includes",
    "/.env",
    "/.git",
    "/.aws",
    "/phpmyadmin",
    "/cgi-bin",
    "/admin",
    "/login",
    "/actuator",
    "/shell",
    "/webshell",
    "/ws/v1/cluster",
    "/api/config",
    "/api/env"
  ];

  // Sensitive credential/config files that scanners probe at arbitrary depths.
  const sensitiveFilePatterns = [
    "serviceaccountkey.json",
    "firebase-service-account.json",
    "google-service-account.json",
    "service-account.json",
    "credentials.json",
    "secrets.json",
    "appsettings.json"
  ];

  const suspiciousUserAgents = ["zgrab", "masscan", "python-requests", "sqlmap", "acunetix", "nmap", "curl", "wget"];

  if (suspiciousPathPrefixes.some((prefix) => path.startsWith(prefix))) return true;
  if (sensitiveFilePatterns.some((f) => path.includes(f))) return true;
  if (suspiciousUserAgents.some((needle) => ua.includes(needle))) return true;
  // Binary control sequences: TLS ClientHello (\x16\x03) or legacy probes (\x03\x00).
  if (message.includes("\\x16\\x03") || message.includes("\x16\x03")) return true;
  if (message.includes("\\x03\\x00") || message.includes("\x03\x00")) return true;

  // Consider auth failures and malformed requests as security noise.
  if ([400, 401, 403].includes(status)) return true;

  // A lot of scanners cause 404 to common sensitive paths; only treat 404 as security when path looks suspicious.
  if (
    status === 404 &&
    (path.includes("wp-") ||
      path.includes(".php") ||
      path.includes(".env") ||
      path.includes(".git") ||
      path.includes(".aws") ||
      path.includes("credentials") ||
      path.includes("service-account"))
  )
    return true;

  return false;
}
