import { createHash } from "node:crypto";

export function buildFingerprint(message: string) {
  const normalized = message
    .replace(/\b\d{2,}\b/g, "#")
    .replace(/[a-f0-9]{24,}/gi, "<hex>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);

  return createHash("sha1").update(normalized).digest("hex");
}
