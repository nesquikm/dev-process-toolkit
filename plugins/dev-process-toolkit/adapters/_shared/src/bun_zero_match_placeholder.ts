// bun_zero_match_placeholder — /gate-check probe (STE-113 AC-STE-113.4 +
// STE-128 AC-STE-128.5 layout-policy enforcement).
//
// Bun's `bun test` exits 1 when no test files match. The first concern is
// the placeholder marker that shields a fresh project from zero-match-exit-1.
// The second concern (added in M33) is layout consistency: when CLAUDE.md
// `## Testing Conventions` declares a layout (`co-location` or `mirror`),
// every `*.test.ts` file in the project must follow it; rogue files in the
// other layout fail the gate.
//
// Vacuous when bun.lock is absent (non-Bun projects). Layout enforcement
// further skips when `## Testing Conventions` is absent or the layout is
// not declared — backwards-compat for projects pre-M33.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const MARKER = "Bun zero-match workaround";
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".cache",
  "dist",
  "build",
  "out",
  ".dpt-locks",
]);

export interface BunZeroMatchViolation {
  file: string;
  line: number;
  reason: string;
  note: string;
  message: string;
}

export interface BunZeroMatchReport {
  violations: BunZeroMatchViolation[];
}

interface ScanResult {
  hasTestFile: boolean;
  hasMarker: boolean;
  testFiles: string[];
}

type Layout = "co-location" | "mirror" | null;

function detectLayout(claudeMdPath: string): Layout {
  if (!existsSync(claudeMdPath)) return null;
  let body: string;
  try {
    body = readFileSync(claudeMdPath, "utf-8");
  } catch {
    return null;
  }
  // Locate the `## Testing Conventions` section, then read until the next
  // top-level heading.
  const sectionStart = body.search(/^## Testing Conventions\s*$/m);
  if (sectionStart === -1) return null;
  const tail = body.slice(sectionStart);
  const nextTop = tail.slice(2).search(/^## /m); // skip past current `##`
  const section = nextTop === -1 ? tail : tail.slice(0, nextTop + 2);

  // Strip HTML comments so example wording inside `<!-- ... -->` doesn't
  // leak into the Layout match (the pre-M33 template carries an example
  // comment naming both `tests/ mirrors src/` and `colocated with source`).
  const sectionLive = section.replace(/<!--[\s\S]*?-->/g, "");

  // Look for an explicit `Layout:` line (probe contract — see
  // docs/patterns.md § Test Layout Policy). Match a few synonyms so authors
  // can phrase the choice naturally.
  const layoutLine = sectionLive.match(/^[\s\-*]*\*{0,2}Layout\*{0,2}:?\s*(.+)$/im);
  if (!layoutLine) return null;
  const value = layoutLine[1]!.toLowerCase();
  // Order matters: check mirror first (its phrasing often references "src/"
  // in the parenthetical explanation, which would otherwise match co-location).
  if (/mirror|tests\/-mirror|tests\/.*mirror/.test(value)) return "mirror";
  if (/co.?locat|colocated|src\/-co|src\/.*co.?locat/.test(value)) return "co-location";
  return null;
}

function walkAndScan(dir: string, root: string, out: ScanResult, depth = 0): void {
  if (depth > 6) return; // Bound recursion to keep probe fast
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walkAndScan(full, root, out, depth + 1);
      continue;
    }
    if (!st.isFile()) continue;
    if (/\.test\.ts$/.test(name)) {
      // A `*.test.ts` file by itself satisfies the contract — but if it's
      // a placeholder file (carries the marker), we additionally record the
      // marker presence. Both are sufficient on their own.
      let content = "";
      try {
        content = readFileSync(full, "utf-8");
      } catch {
        // Treat unreadable as a real test file (existence is the check)
        out.hasTestFile = true;
        out.testFiles.push(relative(root, full));
        continue;
      }
      if (content.includes(MARKER)) {
        out.hasMarker = true;
        // Marker satisfies the contract — but also note any real test file.
      } else {
        out.hasTestFile = true;
      }
      out.testFiles.push(relative(root, full));
      continue;
    }
    // Allow the marker comment to live in a non-test source file too
    // (e.g., `src/_dpt_placeholder.ts`). Only scan plausible source files
    // (limited to TypeScript/JavaScript/Markdown) and bound the read size
    // so the probe stays fast on large projects.
    if (!/\.(ts|tsx|js|mjs|cjs|md)$/.test(name)) continue;
    if (st.size > 64 * 1024) continue; // skip large files; the marker is a 1-line top-of-file comment
    try {
      const content = readFileSync(full, "utf-8");
      if (content.includes(MARKER)) out.hasMarker = true;
    } catch {
      // ignore
    }
  }
}

function buildLayoutViolation(
  testFile: string,
  layout: Layout,
  projectRoot: string,
): BunZeroMatchViolation {
  const expected = layout === "co-location" ? "src/-co-located" : "tests/-mirror";
  const wrongDir = layout === "co-location" ? "tests/" : "src/";
  const reason = `${testFile} violates declared test layout (${expected}); ${wrongDir} test files are not allowed under this policy`;
  const message = [
    `bun_zero_match_placeholder: ${reason}`,
    `Remedy: ${
      layout === "co-location"
        ? `move ${testFile} alongside its source as a sibling \`*.test.ts\` (e.g., \`src/foo.ts\` + \`src/foo.test.ts\`), or relax the policy by editing CLAUDE.md \`## Testing Conventions\` § Layout`
        : `move ${testFile} under \`tests/\` mirroring the source layout, or relax the policy by editing CLAUDE.md \`## Testing Conventions\` § Layout`
    }. Background: plugins/dev-process-toolkit/docs/patterns.md § Test Layout Policy.`,
    `Context: project=${projectRoot}, probe=bun_zero_match_placeholder, layout=${expected}`,
  ].join("\n");
  return {
    file: testFile,
    line: 1,
    reason,
    note: `${testFile}:1 — ${reason}`,
    message,
  };
}

function violatesLayout(testFile: string, layout: Layout): boolean {
  // Normalize to forward slashes for consistent matching.
  const norm = testFile.replace(/\\/g, "/");
  // Skip placeholder files — they're scaffold-time artifacts, not user tests.
  if (/\.placeholder\.test\.[a-z0-9]+$/i.test(norm)) return false;
  if (layout === "co-location") return /^tests\//.test(norm);
  if (layout === "mirror") return /^src\//.test(norm);
  return false;
}

export async function runBunZeroMatchPlaceholderProbe(
  projectRoot: string,
): Promise<BunZeroMatchReport> {
  const bunLock = join(projectRoot, "bun.lock");
  if (!existsSync(bunLock)) return { violations: [] };

  const scan: ScanResult = { hasTestFile: false, hasMarker: false, testFiles: [] };
  walkAndScan(projectRoot, projectRoot, scan);

  const violations: BunZeroMatchViolation[] = [];

  // Layout-policy enforcement (STE-128 AC-STE-128.5). Vacuous when CLAUDE.md
  // is absent or `## Testing Conventions` doesn't declare a layout.
  const layout = detectLayout(join(projectRoot, "CLAUDE.md"));
  if (layout) {
    for (const tf of scan.testFiles) {
      if (violatesLayout(tf, layout)) {
        violations.push(buildLayoutViolation(tf, layout, projectRoot));
      }
    }
  }

  // Zero-match-placeholder enforcement (existing STE-113 contract).
  if (!scan.hasTestFile && !scan.hasMarker) {
    const rel = relative(projectRoot, bunLock) || "bun.lock";
    const reason = `Bun project has no test files and no zero-match placeholder marker — \`bun test\` will exit 1 on the next gate`;
    const note = `${rel}:1 — ${reason}`;
    const message = [
      `bun_zero_match_placeholder: ${reason}`,
      `Remedy: write a placeholder test file carrying the marker comment ` +
        `\`// generated by /dev-process-toolkit:setup — Bun zero-match workaround (see examples/bun-typescript.md)\` ` +
        `until your project ships its first real test. Place the placeholder co-located with src (e.g., \`src/.placeholder.test.ts\`) per the toolkit's default test layout policy. ` +
        `Background: plugins/dev-process-toolkit/examples/bun-typescript.md § "Bun zero-match-exit-1 workaround".`,
      `Context: project=${projectRoot}, probe=bun_zero_match_placeholder`,
    ].join("\n");
    violations.push({ file: bunLock, line: 1, reason, note, message });
  }

  return { violations };
}
