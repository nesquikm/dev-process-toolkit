// Linear description canonical-form normalizer (AC-37.5, AC-39.6).
//
// Operates on the `## Acceptance Criteria` section of a Linear issue
// description. Linear normalizes markdown on the server side (list markers,
// whitespace, CRLF, bullet casing) — if the adapter pushes a byte-different
// form, the next `pull_acs` surfaces spurious drift. This helper applies the
// same canonical form on both pull and push so round-trips converge on the
// first iteration.
//
// Pure function over text, no network, no file I/O. CLI entry: raw description
// blob on stdin, canonical AC block on stdout (empty if no AC section found).
//
// Tests: see `normalize.test.ts` (run with `bun test`).

export function normalize(md: string): string {
  // Step 1: CRLF -> LF
  const lf = md.replace(/\r\n/g, "\n");
  const lines = lf.split("\n");

  // Step 2: Find `## Acceptance Criteria` section boundaries.
  let start = -1;
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === "## Acceptance Criteria" || /^##\s+Acceptance\s+Criteria\s*$/.test(trimmed)) {
      start = i + 1;
      break;
    }
  }
  if (start === -1) return ""; // No AC section.

  for (let i = start; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (/^#{1,3}\s/.test(trimmed)) {
      end = i;
      break;
    }
  }

  // Step 3: Canonicalize AC bullets.
  const acLines = lines.slice(start, end);
  const canonical: string[] = [];
  let lastBlank = false;
  for (const raw of acLines) {
    const stripped = raw.replace(/\s+$/, ""); // trailing whitespace removed
    if (stripped === "") {
      if (!lastBlank) canonical.push("");
      lastBlank = true;
      continue;
    }
    lastBlank = false;

    // Match checkbox bullets: allow `- [ ]`, `- [x]`, `- [X]`, `*  [ ]`, etc.
    const m = stripped.match(/^(\s*)[-*]\s*\[\s*(x|X|\s)\s*\]\s*(.*)$/);
    if (m) {
      const indent = m[1] ?? "";
      const state = (m[2] ?? " ").toLowerCase() === "x" ? "x" : " ";
      const text = (m[3] ?? "").trim();
      canonical.push(`${indent}- [${state}] ${text}`);
    } else {
      // Non-checkbox line inside AC section: keep trimmed form.
      canonical.push(stripped);
    }
  }

  // Trim leading/trailing blank lines.
  while (canonical.length && canonical[0] === "") canonical.shift();
  while (canonical.length && canonical[canonical.length - 1] === "") canonical.pop();

  if (canonical.length === 0) {
    // Section header found but body empty: emit header alone so downstream
    // parsers can detect the boundary and fail loud (AC-35.4).
    return "## Acceptance Criteria\n";
  }
  return "## Acceptance Criteria\n" + canonical.join("\n") + "\n";
}

// CLI entry: stdin -> stdout when invoked as `bun run normalize.ts`.
if (import.meta.main) {
  const input = await new Response(Bun.stdin.stream()).text();
  process.stdout.write(normalize(input));
}
