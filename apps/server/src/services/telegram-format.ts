/**
 * AI replies often come back in GFM/document-style Markdown (tables, #-headers, **bold**), but
 * Telegram's "Markdown" (legacy) parse_mode only understands *bold*, _italic_, `code`, and
 * ```code blocks``` — no tables, no #-headers, no double-asterisk bold. Without this, those
 * bits show up as raw pipes/asterisks/hashes instead of rendering. Convert what's convertible
 * and drop what isn't; code fence contents are left untouched (comments in nginx snippets can
 * start with "#" and shouldn't be mistaken for a markdown heading).
 */
export function formatForTelegram(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let inFence = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      inFence = !inFence;
      out.push(line);
      continue;
    }

    if (inFence) {
      out.push(line);
      continue;
    }

    // Markdown table separator row (|---|---|) — pure noise once rendered, drop it.
    if (trimmed.includes("|") && trimmed.includes("-") && /^\|?[\s:|-]+\|?$/.test(trimmed)) {
      continue;
    }

    // Markdown table row -> plain "col — col — col" line.
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      const cells = trimmed
        .slice(1, -1)
        .split("|")
        .map((c) => c.trim())
        .filter(Boolean);
      out.push(cells.join(" — "));
      continue;
    }

    // Headers (#, ##, ###...) -> bold line, no literal #.
    const headerMatch = trimmed.match(/^#{1,6}\s+(.*)$/);
    if (headerMatch) {
      out.push(`*${headerMatch[1]}*`);
      continue;
    }

    // Horizontal rules (---, ***, ___ alone on a line) -> drop.
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      continue;
    }

    // GFM bold (**x**) -> Telegram legacy bold (*x*).
    out.push(line.replace(/\*\*(.+?)\*\*/g, "*$1*"));
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
