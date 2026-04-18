// Markdown → Asana restricted HTML.
//
// Emits a <body>-wrapped fragment using only Asana's supported tags:
//   <body>, <b> / <strong>, <i> / <em>, <u>, <code>, <pre>,
//   <a href>, <ul> / <ol> / <li>, <h1> / <h2>, <br>
//
// Deterministic, pure (Schema P). Paired with html_to_md.ts: the invariant
// md_to_html(html_to_md(x)) === x holds when x is already canonical
// md_to_html output.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderInline(md: string): string {
  // Order matters: code first (preserves literal content), then links, then
  // bold/italic/underline. Each pass uses a conservative regex so we don't
  // corrupt adjacent tokens.
  let out = "";
  let i = 0;
  while (i < md.length) {
    // Inline code: `...`
    if (md[i] === "`") {
      const close = md.indexOf("`", i + 1);
      if (close !== -1) {
        out += `<code>${escapeHtml(md.slice(i + 1, close))}</code>`;
        i = close + 1;
        continue;
      }
    }
    // Link: [text](href)
    if (md[i] === "[") {
      const closeBracket = md.indexOf("]", i + 1);
      if (closeBracket !== -1 && md[closeBracket + 1] === "(") {
        const closeParen = md.indexOf(")", closeBracket + 2);
        if (closeParen !== -1) {
          const text = md.slice(i + 1, closeBracket);
          const href = md.slice(closeBracket + 2, closeParen);
          out += `<a href="${escapeHtml(href)}">${renderInline(text)}</a>`;
          i = closeParen + 1;
          continue;
        }
      }
    }
    // Bold: **text**
    if (md[i] === "*" && md[i + 1] === "*") {
      const close = md.indexOf("**", i + 2);
      if (close !== -1) {
        out += `<strong>${renderInline(md.slice(i + 2, close))}</strong>`;
        i = close + 2;
        continue;
      }
    }
    // Italic: *text*
    if (md[i] === "*") {
      const close = md.indexOf("*", i + 1);
      if (close !== -1 && close !== i + 1) {
        out += `<em>${renderInline(md.slice(i + 1, close))}</em>`;
        i = close + 1;
        continue;
      }
    }
    // Underline: _text_
    if (md[i] === "_") {
      const close = md.indexOf("_", i + 1);
      if (close !== -1 && close !== i + 1) {
        out += `<u>${renderInline(md.slice(i + 1, close))}</u>`;
        i = close + 1;
        continue;
      }
    }
    out += escapeHtml(md[i]!);
    i++;
  }
  return out;
}

type Block =
  | { kind: "h"; level: 1 | 2; text: string }
  | { kind: "p"; text: string }
  | { kind: "pre"; body: string }
  | { kind: "list"; ordered: boolean; items: ListItem[] };

type ListItem = { text: string; children: Block[] };

function parseBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === "") { i++; continue; }

    // Fenced code block.
    if (line.startsWith("```")) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith("```")) {
        body.push(lines[i]!);
        i++;
      }
      i++; // consume closing ```
      blocks.push({ kind: "pre", body: body.join("\n") });
      continue;
    }

    // Headings.
    const h = line.match(/^(#{1,2})\s+(.*)$/);
    if (h) {
      const level = h[1]!.length as 1 | 2;
      blocks.push({ kind: "h", level, text: h[2]!.trim() });
      i++;
      continue;
    }

    // Lists.
    const listMatch = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
    if (listMatch) {
      const { items, consumed } = collectList(lines, i);
      blocks.push(items);
      i += consumed;
      continue;
    }

    // Paragraph — accumulate until blank line or next block start.
    const para: string[] = [line];
    i++;
    while (i < lines.length) {
      const next = lines[i]!;
      if (next.trim() === "") break;
      if (/^(#{1,2})\s+/.test(next)) break;
      if (next.startsWith("```")) break;
      if (/^(\s*)([-*]|\d+\.)\s+/.test(next)) break;
      para.push(next);
      i++;
    }
    blocks.push({ kind: "p", text: para.join("\n").trim() });
  }
  return blocks;
}

function collectList(lines: string[], startIdx: number): { items: Block; consumed: number } {
  const first = lines[startIdx]!.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/)!;
  const baseIndent = first[1]!.length;
  const ordered = /\d+\./.test(first[2]!);
  const items: ListItem[] = [];
  let i = startIdx;
  while (i < lines.length) {
    const ln = lines[i]!;
    if (ln.trim() === "") { i++; break; }
    const m = ln.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
    if (!m) break;
    const indent = m[1]!.length;
    if (indent < baseIndent) break;
    if (indent > baseIndent) {
      // Nested list belongs to previous item.
      const { items: nested, consumed } = collectList(lines, i);
      if (items.length > 0) items[items.length - 1]!.children.push(nested);
      i += consumed;
      continue;
    }
    items.push({ text: m[3]!, children: [] });
    i++;
  }
  return { items: { kind: "list", ordered, items }, consumed: i - startIdx };
}

function renderList(list: Extract<Block, { kind: "list" }>): string {
  const tag = list.ordered ? "ol" : "ul";
  const inner = list.items
    .map((item) => {
      const children = item.children.map(renderBlock).join("");
      return `<li>${renderInline(item.text)}${children}</li>`;
    })
    .join("");
  return `<${tag}>${inner}</${tag}>`;
}

function renderBlock(block: Block): string {
  switch (block.kind) {
    case "h":
      return `<h${block.level}>${renderInline(block.text)}</h${block.level}>`;
    case "p":
      return `<p>${renderInline(block.text.replace(/\n/g, " "))}</p>`;
    case "pre":
      return `<pre>${escapeHtml(block.body)}</pre>`;
    case "list":
      return renderList(block);
  }
}

export function mdToHtml(md: string): string {
  const blocks = parseBlocks(md);
  const inner = blocks.map(renderBlock).join("");
  return `<body>${inner}</body>`;
}

if (import.meta.main) {
  const input = await new Response(Bun.stdin.stream()).text();
  try {
    process.stdout.write(mdToHtml(input) + "\n");
  } catch (err) {
    process.stderr.write(`md_to_html: ${(err as Error).message}\n`);
    process.exit(1);
  }
}
