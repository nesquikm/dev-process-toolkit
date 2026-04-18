// Asana restricted HTML → Markdown converter.
//
// Scope: Asana's description dialect only. Supported tags:
//   <body>, <b> / <strong>, <i> / <em>, <u>, <code>, <pre>,
//   <a href>, <ul> / <ol> / <li>, <h1> / <h2>, <br>
//
// Pure function over text (Schema P). No network, no DOM, deterministic.
// Invariant (paired with md_to_html.ts): md_to_html(html_to_md(x)) == x when
// x is already canonical output of md_to_html.

type Tag =
  | "body"
  | "b"
  | "strong"
  | "i"
  | "em"
  | "u"
  | "code"
  | "pre"
  | "a"
  | "ul"
  | "ol"
  | "li"
  | "h1"
  | "h2"
  | "br"
  | "p";

const KNOWN_TAGS: Tag[] = [
  "body", "b", "strong", "i", "em", "u", "code", "pre", "a",
  "ul", "ol", "li", "h1", "h2", "br", "p",
];

type Node =
  | { kind: "text"; value: string }
  | { kind: "tag"; name: Tag; attrs: Record<string, string>; children: Node[]; selfClosing: boolean };

function isKnown(name: string): name is Tag {
  return (KNOWN_TAGS as string[]).includes(name);
}

function parseAttrs(src: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /(\w+)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    attrs[m[1]!.toLowerCase()] = m[2]!;
  }
  return attrs;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function parse(html: string): Node[] {
  const tokens: Array<{ kind: "open" | "close" | "self" | "text"; name?: string; attrs?: string; value?: string }> = [];
  let i = 0;
  while (i < html.length) {
    if (html[i] === "<") {
      const end = html.indexOf(">", i);
      if (end === -1) throw new Error(`unclosed tag near byte ${i}`);
      const raw = html.slice(i + 1, end).trim();
      if (raw.startsWith("/")) {
        const name = raw.slice(1).trim().toLowerCase();
        tokens.push({ kind: "close", name });
      } else if (raw.endsWith("/")) {
        const body = raw.slice(0, -1).trim();
        const [name, ...rest] = body.split(/\s+/);
        tokens.push({ kind: "self", name: name!.toLowerCase(), attrs: rest.join(" ") });
      } else {
        const [name, ...rest] = raw.split(/\s+/);
        const lower = name!.toLowerCase();
        if (lower === "br") tokens.push({ kind: "self", name: "br", attrs: "" });
        else tokens.push({ kind: "open", name: lower, attrs: rest.join(" ") });
      }
      i = end + 1;
    } else {
      const next = html.indexOf("<", i);
      const chunk = next === -1 ? html.slice(i) : html.slice(i, next);
      if (chunk.length > 0) tokens.push({ kind: "text", value: chunk });
      i = next === -1 ? html.length : next;
    }
  }

  function buildChildren(startIdx: number, stopTag?: string): { nodes: Node[]; endIdx: number } {
    const nodes: Node[] = [];
    let idx = startIdx;
    while (idx < tokens.length) {
      const t = tokens[idx]!;
      if (t.kind === "close") {
        if (stopTag && t.name === stopTag) {
          return { nodes, endIdx: idx };
        }
        throw new Error(`unexpected </${t.name}> at token ${idx}`);
      }
      if (t.kind === "text") {
        nodes.push({ kind: "text", value: decodeEntities(t.value!) });
        idx++;
        continue;
      }
      if (t.kind === "self") {
        const name = t.name!;
        if (!isKnown(name)) throw new Error(`unsupported tag <${name}/>`);
        nodes.push({ kind: "tag", name, attrs: parseAttrs(t.attrs ?? ""), children: [], selfClosing: true });
        idx++;
        continue;
      }
      // open tag
      const name = t.name!;
      if (!isKnown(name)) throw new Error(`unsupported tag <${name}>`);
      const res = buildChildren(idx + 1, name);
      nodes.push({
        kind: "tag",
        name,
        attrs: parseAttrs(t.attrs ?? ""),
        children: res.nodes,
        selfClosing: false,
      });
      idx = res.endIdx + 1;
    }
    if (stopTag) throw new Error(`missing </${stopTag}>`);
    return { nodes, endIdx: idx };
  }

  const { nodes } = buildChildren(0);
  return nodes;
}

function renderInline(nodes: Node[]): string {
  let out = "";
  for (const n of nodes) {
    if (n.kind === "text") {
      out += n.value;
      continue;
    }
    switch (n.name) {
      case "b":
      case "strong":
        out += `**${renderInline(n.children)}**`;
        break;
      case "i":
      case "em":
        out += `*${renderInline(n.children)}*`;
        break;
      case "u":
        out += `_${renderInline(n.children)}_`;
        break;
      case "code":
        out += "`" + renderInline(n.children) + "`";
        break;
      case "a":
        out += `[${renderInline(n.children)}](${n.attrs["href"] ?? ""})`;
        break;
      case "br":
        out += "\n";
        break;
      default:
        out += renderInline(n.children);
    }
  }
  return out;
}

function renderBlock(nodes: Node[], depth = 0): string {
  const parts: string[] = [];
  for (const n of nodes) {
    if (n.kind === "text") {
      const v = n.value.replace(/^\n+/, "").replace(/\n+$/, "");
      if (v.length > 0) parts.push(v);
      continue;
    }
    switch (n.name) {
      case "h1":
        parts.push(`# ${renderInline(n.children).trim()}`);
        break;
      case "h2":
        parts.push(`## ${renderInline(n.children).trim()}`);
        break;
      case "pre":
        parts.push("```\n" + renderInline(n.children) + "\n```");
        break;
      case "ul":
      case "ol":
        parts.push(renderList(n.children, n.name, depth));
        break;
      case "body":
        parts.push(renderBlock(n.children, depth));
        break;
      case "p":
        parts.push(renderInline(n.children).trim());
        break;
      default:
        parts.push(renderInline([n]));
    }
  }
  return parts.filter((p) => p.length > 0).join("\n\n");
}

function renderList(children: Node[], kind: "ul" | "ol", depth: number): string {
  const lines: string[] = [];
  let ordinal = 1;
  for (const child of children) {
    if (child.kind !== "tag" || child.name !== "li") continue;
    const marker = kind === "ul" ? "-" : `${ordinal++}.`;
    const indent = "  ".repeat(depth);
    // split children into inline content + nested lists
    const inline: Node[] = [];
    const nested: Node[] = [];
    for (const sub of child.children) {
      if (sub.kind === "tag" && (sub.name === "ul" || sub.name === "ol")) nested.push(sub);
      else inline.push(sub);
    }
    const body = renderInline(inline).trim();
    lines.push(`${indent}${marker} ${body}`);
    for (const nl of nested) {
      lines.push(renderList(nl.children, nl.name as "ul" | "ol", depth + 1));
    }
  }
  return lines.join("\n");
}

export function htmlToMd(html: string): string {
  const trimmed = html.trim();
  if (trimmed.length === 0) return "";
  const nodes = parse(trimmed);
  const rendered = renderBlock(nodes).trim();
  return rendered;
}

if (import.meta.main) {
  const input = await new Response(Bun.stdin.stream()).text();
  try {
    process.stdout.write(htmlToMd(input) + "\n");
  } catch (err) {
    process.stderr.write(`html_to_md: ${(err as Error).message}\n`);
    process.exit(1);
  }
}
