// jira_pull_acs — canonical pull_acs parser for the Jira description-body
// path (STE-190). The Jira adapter's description-body pull_acs reads the
// issue's description, locates the literal heading line `## Acceptance
// Criteria`, and extracts each bullet item between that heading and the
// next `##`-level heading (or EOF) into a Schema N AC list.
//
// ADF-escape tolerance: markdown bullets `- [x] ...` round-trip through
// Jira's ADF conversion as `* \[x\] ...` (asterisk-bullet + escaped
// brackets). The parser tolerates both forms by design — the regex
// optional-backslash before each bracket is the load-bearing piece for
// STE-190 (smoke #9 / Jira run 2 F3).
//
// Pure function over text, no network, no file I/O. The Jira pull_acs
// MCP-call shape lives in adapters/jira.md § pull_acs; this helper
// implements the bullet-extraction step.

export type AC = { id: string; text: string; completed: boolean };

const HEADING_RE = /^##\s+Acceptance\s+Criteria\s*$/;
const SECTION_END_RE = /^##\s/;
// Bullet shape: optional indent, `-` or `*`, whitespace, optional
// backslash-escape before `[`, the state token (x/X/space), optional
// backslash before `]`, then the bullet body. Extra whitespace tolerated
// throughout to match Jira's ADF re-rendering and the linear normalizer.
const BULLET_RE = /^\s*[-*]\s*\\?\[\s*(x|X|\s)\s*\\?\]\s*(.*)$/;
const AC_ID_RE = /^(AC-[A-Za-z0-9-]+\.\d+):\s*(.*)$/;

export function parseJiraDescriptionAcs(body: string): AC[] {
  const lines = body.replace(/\r\n/g, "\n").split("\n");

  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (HEADING_RE.test(lines[i]!.trim())) {
      start = i + 1;
      break;
    }
  }
  if (start === -1) return [];

  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    if (SECTION_END_RE.test(lines[i]!.trim())) {
      end = i;
      break;
    }
  }

  const acs: AC[] = [];
  let local = 0;
  for (const raw of lines.slice(start, end)) {
    const m = raw.match(BULLET_RE);
    if (!m) continue;
    const completed = (m[1] ?? " ").toLowerCase() === "x";
    const rest = (m[2] ?? "").trim();
    const idMatch = rest.match(AC_ID_RE);
    if (idMatch) {
      acs.push({ id: idMatch[1]!, text: idMatch[2]!.trim(), completed });
    } else {
      local += 1;
      acs.push({ id: `jira-${local}`, text: rest, completed });
    }
  }
  return acs;
}
