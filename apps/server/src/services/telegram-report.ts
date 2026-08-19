import type { InlineKeyboardButton } from "./telegram-error-alerts.js";

/** True when the text has markdown structure (tables/headings) that Telegram text can't render properly. */
export function looksStructured(text: string): boolean {
  return /^\s*\|.*\|\s*$/m.test(text) || /^#{1,6}\s+/m.test(text);
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inlineFormat(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function isTableRow(line: string): boolean {
  const t = line.trim();
  return t.startsWith("|") && t.endsWith("|");
}

function isTableSeparator(line: string): boolean {
  const t = line.trim();
  return t.includes("|") && t.includes("-") && /^\|?[\s:|-]+\|?$/.test(t);
}

function splitCells(line: string): string[] {
  return line
    .trim()
    .slice(1, -1)
    .split("|")
    .map((c) => c.trim());
}

/** Small hand-rolled markdown-ish -> HTML converter — just enough for what the AI actually produces
 * (headings, tables, bold/italic/code, bullets, code fences), not a full CommonMark implementation. */
export function renderReportHtml(title: string, markdownish: string): string {
  const lines = markdownish.split("\n");
  const body: string[] = [];
  let i = 0;
  let inFence = false;
  let fenceBuf: string[] = [];
  let listBuf: string[] = [];

  function flushList() {
    if (listBuf.length) {
      body.push(`<ul>${listBuf.map((item) => `<li>${inlineFormat(item)}</li>`).join("")}</ul>`);
      listBuf = [];
    }
  }

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      if (inFence) {
        body.push(`<pre><code>${escapeHtml(fenceBuf.join("\n"))}</code></pre>`);
        fenceBuf = [];
        inFence = false;
      } else {
        flushList();
        inFence = true;
      }
      i++;
      continue;
    }

    if (inFence) {
      fenceBuf.push(line);
      i++;
      continue;
    }

    if (isTableRow(trimmed) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      flushList();
      const headerCells = splitCells(trimmed);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(splitCells(lines[i]));
        i++;
      }
      const thead = `<tr>${headerCells.map((c) => `<th>${inlineFormat(c)}</th>`).join("")}</tr>`;
      const tbody = rows.map((r) => `<tr>${r.map((c) => `<td>${inlineFormat(c)}</td>`).join("")}</tr>`).join("");
      body.push(`<table><thead>${thead}</thead><tbody>${tbody}</tbody></table>`);
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flushList();
      const level = Math.min(headingMatch[1].length + 1, 6); // shift down one level; h1 is the page title
      body.push(`<h${level}>${inlineFormat(headingMatch[2])}</h${level}>`);
      i++;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushList();
      body.push("<hr>");
      i++;
      continue;
    }

    const bulletMatch = trimmed.match(/^[-*]\s+(.*)$/);
    if (bulletMatch) {
      listBuf.push(bulletMatch[1]);
      i++;
      continue;
    }

    flushList();
    if (trimmed) body.push(`<p>${inlineFormat(trimmed)}</p>`);
    i++;
  }
  flushList();

  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 720px; margin: 0 auto; padding: 20px 16px 40px; line-height: 1.55; }
  h1 { font-size: 22px; margin: 0 0 16px; }
  h2 { font-size: 18px; margin: 24px 0 8px; border-bottom: 1px solid #8884; padding-bottom: 6px; }
  h3, h4 { font-size: 15px; margin: 18px 0 6px; }
  p { margin: 8px 0; }
  ul { margin: 8px 0; padding-left: 22px; }
  li { margin: 4px 0; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 14px; }
  th, td { border: 1px solid #8884; padding: 6px 10px; text-align: left; vertical-align: top; }
  th { background: #8881; font-weight: 700; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; background: #8881; padding: 1px 5px; border-radius: 4px; font-size: 13px; }
  pre { background: #8881; padding: 10px 12px; border-radius: 8px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  hr { border: none; border-top: 1px solid #8884; margin: 20px 0; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
${body.join("\n")}
</body>
</html>`;
}

/**
 * Sends `text` as an .html document attachment when it looks structured (tables/headings) —
 * Telegram's own text formatting has no table/heading support in any parse_mode, but a static
 * HTML file opens fine in any mobile/desktop browser with real rendering. Returns false (caller
 * should fall back to a normal text message) when the text isn't structured or the upload fails.
 */
export async function trySendAsDocument(
  token: string,
  chatId: string,
  text: string,
  buttons?: InlineKeyboardButton[][]
): Promise<boolean> {
  if (!looksStructured(text)) return false;

  try {
    const html = renderReportHtml("Báo cáo Monitor Center", text);
    const filename = `bao-cao-${Date.now()}.html`;

    const form = new FormData();
    form.set("chat_id", chatId);
    form.set("caption", "📄 Báo cáo có bảng/định dạng — mở file đính kèm để xem đầy đủ.");
    if (buttons) form.set("reply_markup", JSON.stringify({ inline_keyboard: buttons }));
    form.set("document", new Blob([html], { type: "text/html" }), filename);

    const response = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
      method: "POST",
      body: form
    });
    const payload = (await response.json()) as { ok: boolean };
    return payload.ok === true;
  } catch {
    return false;
  }
}
