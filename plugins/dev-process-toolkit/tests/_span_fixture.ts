// Shared two-root fixture for cross-repository (`spans_repos:`) behaviour —
// M_8f07e0. Created by STE-583 as its first consumer; graded by STE-587.
//
// Leading underscore: a helper module, never collected as a suite.
//
// Why REAL directories: `defaultRepoProbe().locate` answers from `existsSync`
// and `isDirectory`, so a sibling root only "locates" if it is really on disk.
// Why realpathSync at every comparison: macOS `mkdtempSync` hands back a
// `/var/…` path that resolves to `/private/var/…`, so a raw `===` between a
// probe-located root and a fixture root is a coin toss across platforms.
//
// Callers own teardown: build the fixture, run the body inside `try`, and call
// `cleanup()` in `finally` so a throwing test body still removes both roots.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface SpanFixture {
  /** Root A — the invoking repository. */
  a: string;
  /** Root B — the sibling repository. */
  b: string;
  /**
   * Write `specs/plan/<milestone>.md` in root A: a tracker-mode plan (no `id:`
   * key) with `status: active`, `archived_at: null`, `shipped_in: null`, a
   * 2-space nested `spans_repos:` map built from `spans` in insertion order,
   * and any `extra` frontmatter keys. An EMPTY `spans` record omits the
   * `spans_repos:` key entirely — the undeclared state — rather than writing a
   * bare key, which is a malformed spelling.
   */
  planA(spans: Record<string, string>, extra?: Record<string, string>): void;
  /** The same plan, written in root B. */
  planB(spans: Record<string, string>, extra?: Record<string, string>): void;
  /** Write `specs/frs/<id>.md` under `root`, `status: active`, bound to `milestone`. */
  activeFr(root: string, id: string, milestone: string): void;
  /** Write `specs/frs/archive/<id>.md` under `root`, `status: archived`, bound to `milestone`. */
  archivedFr(root: string, id: string, milestone: string): void;
  /** Remove both roots (recursive, force). Safe to call more than once. */
  cleanup(): void;
}

function planBody(
  milestone: string,
  spans: Record<string, string>,
  extra: Record<string, string>,
): string {
  const lines = [
    "---",
    `milestone: ${milestone}`,
    "status: active",
    "archived_at: null",
    "shipped_in: null",
  ];
  const entries = Object.entries(spans);
  if (entries.length > 0) {
    lines.push("spans_repos:");
    for (const [name, path] of entries) lines.push(`  ${name}: ${path}`);
  }
  for (const [key, value] of Object.entries(extra)) lines.push(`${key}: ${value}`);
  lines.push("---", "", `# ${milestone}`, "");
  return lines.join("\n");
}

function frBody(
  id: string,
  milestone: string,
  status: "active" | "archived",
): string {
  return [
    "---",
    `title: ${id}`,
    `milestone: ${milestone}`,
    `status: ${status}`,
    `archived_at: ${status === "archived" ? "2026-09-10T00:00:00Z" : "null"}`,
    "---",
    "",
    `# ${id}`,
    "",
  ].join("\n");
}

function makeRoot(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `dpt-span-${label}-`));
  mkdirSync(join(root, "specs", "plan"), { recursive: true });
  mkdirSync(join(root, "specs", "frs", "archive"), { recursive: true });
  return root;
}

export function makeSpanFixture(milestone: string): SpanFixture {
  const a = makeRoot("a");
  let b: string;
  try {
    b = makeRoot("b");
  } catch (e) {
    rmSync(a, { recursive: true, force: true });
    throw e;
  }

  const writePlan = (
    root: string,
    spans: Record<string, string>,
    extra: Record<string, string> = {},
  ): void => {
    writeFileSync(
      join(root, "specs", "plan", `${milestone}.md`),
      planBody(milestone, spans, extra),
    );
  };

  return {
    a,
    b,
    planA(spans, extra) {
      writePlan(a, spans, extra);
    },
    planB(spans, extra) {
      writePlan(b, spans, extra);
    },
    activeFr(root, id, m) {
      writeFileSync(join(root, "specs", "frs", `${id}.md`), frBody(id, m, "active"));
    },
    archivedFr(root, id, m) {
      writeFileSync(
        join(root, "specs", "frs", "archive", `${id}.md`),
        frBody(id, m, "archived"),
      );
    },
    cleanup() {
      try {
        rmSync(a, { recursive: true, force: true });
      } finally {
        rmSync(b, { recursive: true, force: true });
      }
    },
  };
}
