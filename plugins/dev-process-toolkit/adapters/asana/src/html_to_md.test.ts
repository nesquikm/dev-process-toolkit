import { describe, expect, test } from "bun:test";
import { htmlToMd } from "./html_to_md";
import { mdToHtml } from "./md_to_html";

describe("asana html_to_md", () => {
  test("strong + em + code inline", () => {
    const md = htmlToMd("<body><p>This is <strong>bold</strong> and <em>italic</em> and <code>code</code>.</p></body>");
    expect(md).toContain("**bold**");
    expect(md).toContain("*italic*");
    expect(md).toContain("`code`");
  });

  test("h1 / h2 headings", () => {
    const md = htmlToMd("<body><h1>Title</h1><h2>Sub</h2></body>");
    expect(md).toContain("# Title");
    expect(md).toContain("## Sub");
  });

  test("unordered list with nested children", () => {
    const md = htmlToMd("<body><ul><li>parent<ul><li>child1</li><li>child2</li></ul></li></ul></body>");
    expect(md).toContain("- parent");
    expect(md).toContain("  - child1");
    expect(md).toContain("  - child2");
  });

  test("anchor tag renders as markdown link", () => {
    const md = htmlToMd('<body><p>See <a href="https://example.com">docs</a>.</p></body>');
    expect(md).toContain("[docs](https://example.com)");
  });

  test("pre block renders as fenced code", () => {
    const md = htmlToMd("<body><pre>const x = 1;</pre></body>");
    expect(md).toContain("```");
    expect(md).toContain("const x = 1;");
  });

  test("unknown tag fails loudly (NFR-10)", () => {
    expect(() => htmlToMd("<body><marquee>no</marquee></body>")).toThrow();
  });

  test("br renders as newline in inline context", () => {
    const md = htmlToMd("<body><p>line1<br/>line2</p></body>");
    expect(md).toContain("line1");
    expect(md).toContain("line2");
  });
});

describe("asana md_to_html", () => {
  test("wraps output in <body>", () => {
    const html = mdToHtml("hello");
    expect(html.startsWith("<body>")).toBe(true);
    expect(html.endsWith("</body>")).toBe(true);
  });

  test("heading + paragraph + list", () => {
    const html = mdToHtml("# Title\n\npara\n\n- one\n- two");
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<p>para</p>");
    expect(html).toContain("<ul><li>one</li><li>two</li></ul>");
  });

  test("inline bold + italic + code + link", () => {
    const html = mdToHtml("**b** *i* `c` [x](https://e.com)");
    expect(html).toContain("<strong>b</strong>");
    expect(html).toContain("<em>i</em>");
    expect(html).toContain("<code>c</code>");
    expect(html).toContain('<a href="https://e.com">x</a>');
  });

  test("ordered list", () => {
    const html = mdToHtml("1. first\n2. second");
    expect(html).toContain("<ol><li>first</li><li>second</li></ol>");
  });
});

describe("asana round-trip invariant", () => {
  const fixtures: string[] = [
    "<body><h2>Goal</h2><p>Let admins download audit entries as CSV.</p><ul><li>Filter by date range</li><li>Include actor + action</li></ul></body>",
    "<body><p>Plain paragraph.</p></body>",
    "<body><h1>A</h1><h2>B</h2><p><strong>bold</strong> and <em>italic</em>.</p></body>",
    "<body><ul><li>a</li><li>b</li></ul></body>",
    "<body><ol><li>one</li><li>two</li></ol></body>",
    '<body><p>Visit <a href="https://example.com">site</a>.</p></body>',
  ];

  test("md_to_html(html_to_md(x)) == x for canonical fixtures", () => {
    for (const html of fixtures) {
      const md = htmlToMd(html);
      const round = mdToHtml(md);
      expect(round).toBe(html);
    }
  });

  test("html_to_md is idempotent on its output (canonical form is a fixpoint)", () => {
    for (const html of fixtures) {
      const once = htmlToMd(html);
      const twice = htmlToMd(mdToHtml(once));
      expect(twice).toBe(once);
    }
  });
});
