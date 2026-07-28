// STE-430 (M117) — "Widen transient-failure retry and clear recurring gate noise".
//
// Five ACs across three unrelated mechanisms; this file carries all five.
//
//   AC-STE-430.1 — the retry path covers a connection-drop class failure whose
//     post-hoc tree state is provably clean; the budget stays bounded at one.
//   AC-STE-430.2 — a failure whose tree state is NOT provably clean still does
//     not auto-retry; the widening is gated on the clean-tree check, not on the
//     error class.
//   AC-STE-430.3 — a commit in the heredoc/stdin form is permitted under the
//     same allow-list entry that permits its non-heredoc equivalent.
//   AC-STE-430.4 — probe #49 does not emit `milestone_local_orphan` for a plan
//     declaring the scaffolding kind; a fresh bootstrap gates clean.
//   AC-STE-430.5 — the retry audit row records both attempts with their
//     outcomes, which requires attempt 1's capture to survive attempt 2.
//
// Structure notes:
//
//  * The retry contract lives in driver PROSE (`.claude/skills/{smoke-test,
//    conformance-loop}/SKILL.md`), which ships zero prior test coverage. Those
//    assertions are therefore PARAGRAPH-SCOPED (`someParagraphMatches` /
//    section slices) — a whole-file grep over a 1379-line SKILL is satisfiable
//    from 40 lines away and would pass vacuously.
//  * The driver SKILLs live at the REPO root, outside `plugins/dev-process-
//    toolkit/`, so every read goes through `readIfPresent` + `describe.skip`
//    (toolkit consumers do not ship the smoke harness).
//  * AC.3's assertions are grounded in a committed capture of the OBSERVED
//    denial (`tests/fixtures/permission-denials/…`), extracted verbatim from
//    the 2026-07-27 Linear smoke leg, so the fix is built on measured bytes
//    rather than on the FR's prose reconstruction.

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  FRMetadata,
  FRSpec,
  LockResult,
  Provider,
  SyncResult,
} from "../adapters/_shared/src/provider";
import { reconcileTrackerLocal } from "../adapters/_shared/src/reconcile_tracker_local";
import { runTrackerLocalReconciliationDriftProbe } from "../adapters/_shared/src/tracker_local_reconciliation_drift";

// ---------------------------------------------------------------------------
// Paths (project-local; repoRoot is three levels up from tests/).
// ---------------------------------------------------------------------------

const repoRoot = join(import.meta.dir, "..", "..", "..");
const pluginRoot = join(import.meta.dir, "..");
const smokeSkillPath = join(repoRoot, ".claude", "skills", "smoke-test", "SKILL.md");
const conformanceSkillPath = join(
  repoRoot,
  ".claude",
  "skills",
  "conformance-loop",
  "SKILL.md",
);
const gateCheckSkillPath = join(pluginRoot, "skills", "gate-check", "SKILL.md");
const repoSettingsPath = join(repoRoot, ".claude", "settings.json");
const templateSettingsPath = join(pluginRoot, "templates", "settings.json");
const denialFixturePath = join(
  import.meta.dir,
  "fixtures",
  "permission-denials",
  "setup-heredoc-commit-denial-2026-07-27.json",
);

function readIfPresent(path: string): string | null {
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8");
}

const smokeSkill = readIfPresent(smokeSkillPath);
const conformanceSkill = readIfPresent(conformanceSkillPath);
const gateCheckSkill = readIfPresent(gateCheckSkillPath);
const denialFixtureRaw = readIfPresent(denialFixturePath);

const describeSmoke = smokeSkill === null ? describe.skip : describe;
const describeConformance = conformanceSkill === null ? describe.skip : describe;
const describeGateCheck = gateCheckSkill === null ? describe.skip : describe;
const describeDenialFixture = denialFixtureRaw === null ? describe.skip : describe;

// Settings files are gated on PRESENCE only. `jsonAllow` returns null for three
// different reasons — file absent, unparseable JSON, `permissions.allow` not an
// array — and only the first is a legitimate exemption (a consumer checkout
// without the toolkit repo). Folding the other two into an early `return` let a
// malformed settings file exempt itself from the only programmatic assertion on
// it in the tree, so presence is decided here and malformed content is a RED
// via `strictAllow` below.
const describeRepoSettings =
  readIfPresent(repoSettingsPath) === null ? describe.skip : describe;
const describeTemplateSettings =
  readIfPresent(templateSettingsPath) === null ? describe.skip : describe;

/**
 * The `permissions.allow` array, or a thrown error naming the file. Use inside
 * a `describe*Settings` block, where the file is known to exist — anything
 * other than a well-formed allow array is then a defect, not an exemption.
 */
function strictAllow(path: string): string[] {
  const allow = jsonAllow(path);
  if (allow === null) {
    throw new Error(
      `${path} exists but has no parseable permissions.allow array — ` +
        `a malformed settings file must fail this suite, not exempt itself.`,
    );
  }
  return allow;
}

// ---------------------------------------------------------------------------
// Prose helpers (shape borrowed from
// tests/smoke-driver-m96-verified-wipe-freshness.test.ts:55-128).
// ---------------------------------------------------------------------------

/** Paragraph-proximity: some blank-line-delimited paragraph satisfies ALL patterns. */
function someParagraphMatches(body: string, patterns: RegExp[]): boolean {
  return body
    .split(/\n\n+/)
    .some((paragraph) => patterns.every((re) => re.test(paragraph)));
}

/** Paragraphs matching `select` that FAIL to also satisfy `require` — rendered for diffs. */
function paragraphsMissing(
  body: string,
  select: RegExp,
  require: RegExp,
): string[] {
  return body
    .split(/\n\n+/)
    .filter((p) => select.test(p) && !require.test(p))
    .map((p) => p.trim().slice(0, 160));
}

/** Every ```bash / ``` fence body inside a section (fence language-agnostic). */
function fenceBodies(section: string): string[] {
  const out: string[] = [];
  const lines = section.split("\n");
  let inFence = false;
  let buf: string[] = [];
  for (const line of lines) {
    if (!inFence && /^\s*```\S*\s*$/.test(line)) {
      inFence = true;
      buf = [];
      continue;
    }
    if (inFence && /^\s*```\s*$/.test(line)) {
      out.push(buf.join("\n"));
      inFence = false;
      buf = [];
      continue;
    }
    if (inFence) buf.push(line);
  }
  return out;
}

interface Section {
  heading: string;
  line: number; // 1-based
  body: string; // heading line included
}

/**
 * Fence-aware heading scan. A `## …` line inside a fenced block is a shell
 * comment, not a heading, so fenced regions are skipped.
 */
function headingSections(body: string): Section[] {
  const lines = body.split("\n");
  const headingIdx: number[] = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence && /^#{2,6} /.test(line)) headingIdx.push(i);
  }
  const out: Section[] = [];
  for (let k = 0; k < headingIdx.length; k++) {
    const start = headingIdx[k]!;
    const end = k + 1 < headingIdx.length ? headingIdx[k + 1]! : lines.length;
    out.push({
      heading: lines[start]!,
      line: start + 1,
      body: lines.slice(start, end).join("\n"),
    });
  }
  return out;
}

/**
 * The driver's retry section, located by MECHANISM (a heading naming the retry
 * path) rather than by its current ticket-stamped title, so the section can be
 * renamed as it widens without breaking these pins.
 */
function retrySections(body: string): Section[] {
  return headingSections(body).filter((s) => /retry/i.test(s.heading));
}

function theRetrySection(body: string): Section {
  const found = retrySections(body);
  // Exactly one — two retry sections would make every paragraph-scoped
  // assertion below ambiguous about which contract it is pinning.
  expect(found.map((s) => `${s.line}: ${s.heading}`)).toHaveLength(1);
  return found[0]!;
}

// The signature observed on the 2026-07-27 Linear leg's `/setup` attempt 1
// (`is_error: true`, `terminal_reason: "api_error"`, tree byte-identical to
// the pre-spawn commit). Verbatim from /tmp/dpt-smoke-linear-setup.attempt1.log.
const CONNECTION_DROP_SIGNATURE = /Connection closed mid-response/;
const STREAM_IDLE_SIGNATURE = /Stream idle timeout/;
const CLEAN_TREE_PROBE = /git status --porcelain/;

// ---------------------------------------------------------------------------
// Bash permission-rule matcher model. Same semantics as
// tests/claude-spawn-allowlist.test.ts:152-161 — `Bash(<prefix>:*)` matches a
// command equal to `<prefix>` or beginning with `<prefix> `; `Bash(<exact>)`
// matches ONLY the exact command string. Under this model `Bash(git *)` is an
// EXACT rule whose literal is `git *`, so it authorizes no real git command.
// ---------------------------------------------------------------------------

function bashPatternMatches(pattern: string, command: string): boolean {
  const m = pattern.match(/^Bash\((.*)\)$/);
  if (!m) return false;
  const inner = m[1]!;
  if (inner.endsWith(":*")) {
    const prefix = inner.slice(0, -2);
    return command === prefix || command.startsWith(`${prefix} `);
  }
  return command === inner;
}

/** The non-heredoc equivalent of the denied commit — same subcommand, inline body. */
const NON_HEREDOC_COMMIT = 'git commit -m "chore: bootstrap dev-process-toolkit"';

interface DenialRecord {
  tool_name: string;
  tool_use_id: string;
  tool_input: { command: string; description?: string };
}

function fixtureDenials(): DenialRecord[] {
  const parsed = JSON.parse(denialFixtureRaw!) as {
    permission_denials: DenialRecord[];
  }[];
  return parsed.flatMap((ev) => ev.permission_denials);
}

/** Extract the Phase 1 step 6 `.claude/settings.json` scaffold heredoc's allow list. */
function scaffoldAllow(skill: string): string[] | null {
  const lines = skill.split("\n");
  const starts: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/cat\s+>\s+\.claude\/settings\.json\s+<<'EOF'/.test(lines[i]!)) starts.push(i);
  }
  if (starts.length !== 1) return null;
  const body: string[] = [];
  for (let i = starts[0]! + 1; i < lines.length; i++) {
    if (lines[i]!.trim() === "EOF") break;
    body.push(lines[i]!);
  }
  try {
    const parsed = JSON.parse(body.join("\n")) as {
      permissions?: { allow?: unknown };
    };
    const allow = parsed.permissions?.allow;
    return Array.isArray(allow) ? (allow as string[]) : null;
  } catch {
    return null;
  }
}

function jsonAllow(path: string): string[] | null {
  const raw = readIfPresent(path);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as { permissions?: { allow?: unknown } };
    const allow = parsed.permissions?.allow;
    return Array.isArray(allow) ? (allow as string[]) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Reconciliation fixtures (shape borrowed from
// tests/gate-check-tracker-local-reconciliation-drift.test.ts).
// ---------------------------------------------------------------------------

class StubTrackerProvider implements Provider {
  readonly mode = "tracker" as const;
  constructor(
    private readonly activeFRs: string[],
    private readonly milestones: { name: string }[],
  ) {}
  async listActiveFRs(): Promise<string[]> {
    return [...this.activeFRs];
  }
  async listMilestones(): Promise<{ name: string }[]> {
    return [...this.milestones];
  }
  async getMetadata(id: string): Promise<FRMetadata> {
    return {
      id,
      title: "",
      milestone: "",
      status: "active",
      tracker: {},
      inFlightBranch: null,
      assignee: null,
    };
  }
  async sync(_spec: FRSpec): Promise<SyncResult> {
    return { kind: "skipped", updated: [], conflicts: [], message: "" };
  }
  getUrl(): string | null {
    return null;
  }
  async claimLock(): Promise<LockResult> {
    return { kind: "claimed", branch: null, message: "" };
  }
  async releaseLock(): Promise<"transitioned" | "already-released"> {
    return "already-released";
  }
  async getTicketStatus(): Promise<{ status: string }> {
    return { status: "in_progress" };
  }
  filenameFor(_spec: FRSpec): string {
    return "stub.md";
  }
}

interface Project {
  root: string;
  specsDir: string;
  cleanup: () => void;
}

function makeProject(): Project {
  const root = mkdtempSync(join(tmpdir(), "m117-ste-430-"));
  const specsDir = join(root, "specs");
  mkdirSync(join(specsDir, "frs", "archive"), { recursive: true });
  mkdirSync(join(specsDir, "plan", "archive"), { recursive: true });
  return {
    root,
    specsDir,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

/**
 * Write `specs/plan/<milestone>.md`. `kind` null ⇒ no `kind:` key at all (the
 * ordinary feature-milestone shape). `eol` lets a case exercise CRLF so the
 * carve-out must route through the shared frontmatter parser rather than a
 * hand-rolled `kind:` scanner (the documented CRLF/BOM blindness of probe #13's
 * scanner is exactly the trap to avoid re-creating).
 */
function writePlan(
  specsDir: string,
  milestone: string,
  kind: string | null,
  opts: { eol?: "lf" | "crlf"; bom?: boolean } = {},
): void {
  const kindLine = kind === null ? "" : `kind: ${kind}\n`;
  let body =
    `---\nmilestone: ${milestone}\nstatus: active\n${kindLine}archived_at: null\n---\n\n` +
    `# ${milestone} — Test plan\n`;
  if (opts.eol === "crlf") body = body.replace(/\n/g, "\r\n");
  if (opts.bom) body = `﻿${body}`;
  writeFileSync(join(specsDir, "plan", `${milestone}.md`), body);
}

/** The local-side milestone-mismatch rows the probe would render as `milestone_local_orphan`. */
function localMilestoneOrphanNotes(
  violations: { kind: string; note: string }[],
  milestone: string,
): string[] {
  return violations
    .filter((v) => v.kind === "milestone-mismatch" && v.note.includes(`/${milestone}.md`))
    .map((v) => v.note);
}

// ===========================================================================
// AC-STE-430.1 — the retry path covers the connection-drop class, budget = 1.
// ===========================================================================

describeSmoke("AC-STE-430.1 — /smoke-test retry covers the connection-drop class", () => {
  test("the driver ships exactly one retry section, located by mechanism", () => {
    const section = theRetrySection(smokeSkill!);
    expect(section.body.length).toBeGreaterThan(200);
  });

  test("the detection paragraph names BOTH transient signatures", () => {
    const section = theRetrySection(smokeSkill!);
    // Paragraph-scoped: the two signatures must sit in the same detection
    // paragraph, not merely somewhere in a 1379-line file.
    expect(
      someParagraphMatches(section.body, [
        /detect/i,
        STREAM_IDLE_SIGNATURE,
        CONNECTION_DROP_SIGNATURE,
      ]),
    ).toBe(true);
  });

  test("the worked-example fence branches on the connection-drop signature too", () => {
    const section = theRetrySection(smokeSkill!);
    const fences = fenceBodies(section.body);
    expect(fences.length).toBeGreaterThan(0);
    const detecting = fences.filter((f) => CONNECTION_DROP_SIGNATURE.test(f));
    expect(detecting.length).toBeGreaterThanOrEqual(1);
  });

  test("the retry budget stays bounded at one (two attempts total)", () => {
    const section = theRetrySection(smokeSkill!);
    expect(
      someParagraphMatches(section.body, [
        /budget/i,
        /\bone\b/i,
        /two attempts total/i,
      ]),
    ).toBe(true);
    // No paragraph may authorize a third attempt.
    expect(paragraphsMissing(section.body, /three attempts|two retries/i, /never|not/i)).toEqual(
      [],
    );
  });

  test("no paragraph excludes a whole error class from retry without the tree check", () => {
    const section = theRetrySection(smokeSkill!);
    // Today's exclusion sentence ("Other exit modes … do NOT retry — only the
    // stream-idle signature has a known deterministic rollback") is the clause
    // that aborted an otherwise-healthy headless leg. Whatever survives must
    // condition on the tree state, not on the error class alone.
    const offenders = paragraphsMissing(
      section.body,
      /do NOT retry|does not retry|no auto-retry|never retr/i,
      /clean/i,
    );
    expect(offenders).toEqual([]);
  });
});

// ===========================================================================
// AC-STE-430.2 — the widening is gated on the clean-tree check.
// ===========================================================================

describeSmoke("AC-STE-430.2 — the widening is gated on a verified-clean tree", () => {
  test("a paragraph pins the clean-tree probe as the retry precondition", () => {
    const section = theRetrySection(smokeSkill!);
    expect(
      someParagraphMatches(section.body, [
        CLEAN_TREE_PROBE,
        /empty|clean/i,
        /retr/i,
      ]),
    ).toBe(true);
  });

  test("the clean-tree probe runs after the failed attempt and before rollback", () => {
    const section = theRetrySection(smokeSkill!);
    const fences = fenceBodies(section.body);
    const gated = fences.filter((f) => CLEAN_TREE_PROBE.test(f) && /git clean -fdq/.test(f));
    expect(gated.length).toBeGreaterThanOrEqual(1);
    for (const fence of gated) {
      // Ordering is the contract: probing the tree AFTER `git clean` would
      // always observe "clean" and the gate would be vacuous.
      expect(fence.indexOf("git status --porcelain")).toBeLessThan(
        fence.indexOf("git clean -fdq"),
      );
    }
  });

  test("a dirty tree still aborts instead of auto-retrying", () => {
    const section = theRetrySection(smokeSkill!);
    expect(
      someParagraphMatches(section.body, [
        /dirty|non-empty|not .{0,20}clean/i,
        /(NOT|not|never|no) (auto-)?retr/i,
      ]),
    ).toBe(true);
  });

  test("the clean-tree probe is scoped to the test project, never the toolkit repo", () => {
    const section = theRetrySection(smokeSkill!);
    // The rollback recipe already carries this scoping warning; the new probe
    // shares the same cwd hazard (a porcelain read in the dpt repo cwd would
    // report the operator's own dirty tree and suppress every retry).
    expect(
      someParagraphMatches(section.body, [CLEAN_TREE_PROBE, /test project|cwd/i]),
    ).toBe(true);
  });
});

// ===========================================================================
// AC-STE-430.1 + .2 parity — the contract must reach the /conformance-loop
// driver too. The observed failure was ON a conformance-run leg, and that
// driver ships no retry logic at all today.
// ===========================================================================

describeConformance("AC-STE-430.1/.2 — /conformance-loop carries the same retry contract", () => {
  test("the conformance driver ships a retry section", () => {
    const found = retrySections(conformanceSkill!);
    expect(found.map((s) => `${s.line}: ${s.heading}`).length).toBeGreaterThanOrEqual(1);
  });

  test("its retry section names the connection-drop signature and the clean-tree gate", () => {
    const found = retrySections(conformanceSkill!);
    expect(found.length).toBeGreaterThanOrEqual(1);
    const joined = found.map((s) => s.body).join("\n\n");
    expect(CONNECTION_DROP_SIGNATURE.test(joined)).toBe(true);
    expect(CLEAN_TREE_PROBE.test(joined)).toBe(true);
  });

  test("its retry budget is bounded at one, same as the smoke driver", () => {
    const found = retrySections(conformanceSkill!);
    expect(found.length).toBeGreaterThanOrEqual(1);
    const joined = found.map((s) => s.body).join("\n\n");
    expect(someParagraphMatches(joined, [/\bone\b/i, /two attempts total/i])).toBe(true);
  });
});

// ===========================================================================
// AC-STE-430.3 — heredoc/stdin commit form must be permitted.
// ===========================================================================

describeDenialFixture("AC-STE-430.3 — diagnosis pin (measured bytes, not reconstruction)", () => {
  test("the committed capture carries exactly one Bash permission denial", () => {
    const denials = fixtureDenials();
    expect(denials).toHaveLength(1);
    expect(denials[0]!.tool_name).toBe("Bash");
  });

  test("the denied command's head is the bare word `git`, not a compound `cd …` prefix", () => {
    const command = fixtureDenials()[0]!.tool_input.command;
    // The FR's diagnosis is CONFIRMED here: the first token is `git`. (An
    // unrelated, ALLOWED invocation in the same run did carry a leading
    // `cd <dir>` line — pinning the head from the denial record itself keeps
    // the fix anchored to the command that was actually refused.)
    expect(command.split(/\s+/)[0]).toBe("git");
    expect(command.startsWith("git commit -F - <<'EOF'")).toBe(true);
    expect(command).toContain("\n"); // multi-line heredoc body
  });

  test("`Bash(git *)` — the scaffolded entry — authorizes NEITHER commit form", () => {
    const command = fixtureDenials()[0]!.tool_input.command;
    // Under the repo's own matcher model, `git *` has no `:*` suffix, so it is
    // an EXACT rule matching only the literal string `git *`. This is the
    // mechanism behind the denial: the entry is inert, so every git command
    // falls through to the auto-mode safety classifier, which approved the
    // one-line forms and refused the multi-line heredoc.
    expect(bashPatternMatches("Bash(git *)", command)).toBe(false);
    expect(bashPatternMatches("Bash(git *)", NON_HEREDOC_COMMIT)).toBe(false);
    // Self-check: a prefix-form entry matches both, so the assertions above
    // are about the rule shape, not about a broken matcher model.
    expect(bashPatternMatches("Bash(git:*)", command)).toBe(true);
    expect(bashPatternMatches("Bash(git:*)", NON_HEREDOC_COMMIT)).toBe(true);
  });
});

describeSmoke("AC-STE-430.3 — the scaffolded allow-list permits both commit forms", () => {
  test("one scaffold entry matches the heredoc form AND its non-heredoc equivalent", () => {
    const allow = scaffoldAllow(smokeSkill!);
    expect(allow).not.toBeNull();
    const command =
      denialFixtureRaw === null
        ? "git commit -F - <<'EOF'\nchore: bootstrap\nEOF"
        : fixtureDenials()[0]!.tool_input.command;
    const covering = allow!.filter(
      (entry) =>
        bashPatternMatches(entry, command) &&
        bashPatternMatches(entry, NON_HEREDOC_COMMIT),
    );
    // AC.3's wording is "the SAME allow-list entry" — one entry must cover
    // both forms, so a fix cannot land by special-casing the heredoc.
    expect(covering.length).toBeGreaterThanOrEqual(1);
  });

  test("the scaffold ships no inert exact-rule Bash entry of the `<cmd> *` shape", () => {
    const allow = scaffoldAllow(smokeSkill!);
    expect(allow).not.toBeNull();
    const inert = allow!.filter((e) => /^Bash\([^)]*\s\*\)$/.test(e));
    expect(inert).toEqual([]);
  });
});

// NOTE on scope, established by the end-of-FR audit: `templates/settings.json`
// is NOT what /setup emits. /setup derives a project's allow-list from
// `templates/permissions.json` via `canonicalAllowList` (skills/setup/SKILL.md
// § step 6), and this file has no other programmatic reader in the tree — the
// assertion below is its only one. So fixing it removes a stale exemplar of the
// retired exact-rule shape; it does NOT change what a bootstrapped consumer
// project gets. `templates/permissions.json` deliberately ships exact rules
// (`Bash(git commit)`, `Bash(git status)`) per an earlier self-modification
// finding, which under the matcher model pinned above grant nothing — that is a
// real and larger defect, covered by no AC in this milestone, and it is
// recorded as a follow-up rather than silently widened here.
describeTemplateSettings("AC-STE-430.3 — the standalone settings template carries the fixed shape", () => {
  test("templates/settings.json permits both commit forms under one entry", () => {
    const allow = strictAllow(templateSettingsPath);
    const covering = allow.filter(
      (entry) =>
        bashPatternMatches(entry, "git commit -F - <<'EOF'\nbody\nEOF") &&
        bashPatternMatches(entry, NON_HEREDOC_COMMIT),
    );
    expect(covering.length).toBeGreaterThanOrEqual(1);
  });
});

describeRepoSettings("AC-STE-430.3 — repo-root allow-list stays sorted and covers both forms", () => {
  test("the tracked allow array equals its sorted copy", () => {
    const allow = strictAllow(repoSettingsPath);
    // Guard for the hard constraint: a new entry must land in string-sort
    // position (`Bash(git commit:*)` sorts BEFORE `Bash(git:*)`, since
    // space 0x20 < colon 0x3A).
    expect(allow).toEqual([...allow].sort());
  });

  test("the toolkit repo itself already permits both commit forms (parity anchor)", () => {
    const allow = strictAllow(repoSettingsPath);
    const covering = allow.filter(
      (entry) =>
        bashPatternMatches(entry, "git commit -F - <<'EOF'\nbody\nEOF") &&
        bashPatternMatches(entry, NON_HEREDOC_COMMIT),
    );
    expect(covering.length).toBeGreaterThanOrEqual(1);
  });
});

// ===========================================================================
// AC-STE-430.4 — probe #49 carve-out for scaffolding-kind plans.
// ===========================================================================

describe("AC-STE-430.4 — the reconciler exposes a structural side discriminator", () => {
  test("milestone mismatches carry `side` so consumers filter without prose regexes", async () => {
    const ctx = makeProject();
    try {
      writePlan(ctx.specsDir, "M2", null);
      const provider = new StubTrackerProvider([], [{ name: "M9" }]);
      const report = await reconcileTrackerLocal(provider, ctx.specsDir);
      expect(report.milestoneMismatches.length).toBe(2);
      const bySide = new Map<string, string[]>();
      for (const item of report.milestoneMismatches) {
        const side = (item as unknown as Record<string, unknown>)["side"];
        // Both directions currently emit an identical `kind`, distinguishable
        // only by free text. A structured discriminator is what lets probe #49
        // apply the scaffolding carve-out without byte-pinning prose.
        expect(typeof side).toBe("string");
        const list = bySide.get(side as string) ?? [];
        list.push(item.id);
        bySide.set(side as string, list);
      }
      expect(bySide.get("local")).toEqual(["M2"]);
      expect(bySide.get("tracker")).toEqual(["M9"]);
    } finally {
      ctx.cleanup();
    }
  });

  test("both `details` templates stay byte-stable (fallback pin for a prose carve-out)", async () => {
    const ctx = makeProject();
    try {
      writePlan(ctx.specsDir, "M2", null);
      const provider = new StubTrackerProvider([], [{ name: "M9" }]);
      const report = await reconcileTrackerLocal(provider, ctx.specsDir);
      const notes = report.milestoneMismatches.map((i) => i.details).sort();
      // If the implementation takes the prose-regex fallback instead of the
      // structural discriminator, these pins make a wording edit fail loudly
      // rather than silently disabling the carve-out.
      expect(notes.some((n) => n.endsWith("has no matching tracker milestone."))).toBe(true);
      expect(notes.some((n) => /^Tracker milestone M9 has no local plan file at /.test(n))).toBe(
        true,
      );
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-430.4 — probe #49 skips scaffolding-kind plans", () => {
  test("a `kind: scaffolding` plan with no tracker milestone emits no drift row", async () => {
    const ctx = makeProject();
    try {
      writePlan(ctx.specsDir, "M1", "scaffolding");
      const provider = new StubTrackerProvider([], []);
      const r = await runTrackerLocalReconciliationDriftProbe(ctx.root, { provider });
      expect(localMilestoneOrphanNotes(r.violations, "M1")).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });

  test("a freshly bootstrapped project gates clean — info severity, zero violations", async () => {
    const ctx = makeProject();
    try {
      // The exact /setup output shape: an empty frs/ tree plus the bootstrap
      // plan, against a tracker with no FRs and no milestones yet.
      writeFileSync(join(ctx.specsDir, "frs", ".gitkeep"), "");
      writeFileSync(join(ctx.specsDir, "plan", ".gitkeep"), "");
      writePlan(ctx.specsDir, "M1", "scaffolding");
      const provider = new StubTrackerProvider([], []);
      const r = await runTrackerLocalReconciliationDriftProbe(ctx.root, { provider });
      expect(r.violations).toEqual([]);
      expect(r.severity).toBe("info");
    } finally {
      ctx.cleanup();
    }
  });

  test("the carve-out reads CRLF frontmatter (shared parser, not a hand-rolled scanner)", async () => {
    const ctx = makeProject();
    try {
      writePlan(ctx.specsDir, "M1", "scaffolding", { eol: "crlf", bom: true });
      const provider = new StubTrackerProvider([], []);
      const r = await runTrackerLocalReconciliationDriftProbe(ctx.root, { provider });
      expect(localMilestoneOrphanNotes(r.violations, "M1")).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });

  test("the carve-out is narrow — an ordinary milestone still reports drift", async () => {
    const ctx = makeProject();
    try {
      writePlan(ctx.specsDir, "M1", "scaffolding");
      writePlan(ctx.specsDir, "M2", null);
      writePlan(ctx.specsDir, "M3", "feature");
      const provider = new StubTrackerProvider([], []);
      const r = await runTrackerLocalReconciliationDriftProbe(ctx.root, { provider });
      expect(localMilestoneOrphanNotes(r.violations, "M1")).toEqual([]);
      expect(localMilestoneOrphanNotes(r.violations, "M2")).toHaveLength(1);
      expect(localMilestoneOrphanNotes(r.violations, "M3")).toHaveLength(1);
      expect(r.severity).toBe("warning");
    } finally {
      ctx.cleanup();
    }
  });

  test("a tracker-side milestone with no local plan still reports drift", async () => {
    const ctx = makeProject();
    try {
      writePlan(ctx.specsDir, "M1", "scaffolding");
      const provider = new StubTrackerProvider([], [{ name: "M7" }]);
      const r = await runTrackerLocalReconciliationDriftProbe(ctx.root, { provider });
      // The carve-out must not swallow the ORIGINAL partial-scan trap the
      // probe was built for (tracker has a milestone, local has no plan).
      expect(r.violations.filter((v) => v.note.includes("M7"))).toHaveLength(1);
      expect(localMilestoneOrphanNotes(r.violations, "M1")).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });
});

describeGateCheck("AC-STE-430.4 — the probe's documented render names the carve-out", () => {
  test("the `milestone_local_orphan` paragraph documents the scaffolding exclusion", () => {
    const offenders = paragraphsMissing(
      gateCheckSkill!,
      /`milestone_local_orphan`/,
      /scaffolding/i,
    );
    expect(offenders).toEqual([]);
  });
});

// ===========================================================================
// AC-STE-430.5 — the audit row records both attempts with their outcomes.
// ===========================================================================

describeSmoke("AC-STE-430.5 — both attempts stay visible in the audit trail", () => {
  test("the audit-row template names both attempts' start and exit", () => {
    const section = theRetrySection(smokeSkill!);
    for (const token of [
      "attempt_1_started",
      "attempt_1_exit",
      "attempt_2_started",
      "attempt_2_exit",
    ]) {
      expect(section.body).toContain(token);
    }
  });

  test("attempt 1's capture survives attempt 2 — the two attempts write distinct paths", () => {
    const section = theRetrySection(smokeSkill!);
    const fences = fenceBodies(section.body);
    const spawningFences = fences.filter((f) => /claude\s+-p/.test(f));
    expect(spawningFences.length).toBeGreaterThanOrEqual(1);
    for (const fence of spawningFences) {
      const targets = new Set<string>();
      const re = /(?<![>])>\s*(\/tmp\/\S+?\.log)\b/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(fence)) !== null) targets.add(m[1]!);
      // Both attempts truncating into ONE path destroys attempt 1's evidence
      // before attempt 2 runs, so the audit row cannot honestly report
      // attempt 1's outcome.
      expect(targets.size).toBeGreaterThanOrEqual(2);
    }
  });

  test("the per-attempt capture path is stated in prose, not only in the fence", () => {
    const section = theRetrySection(smokeSkill!);
    expect(
      someParagraphMatches(section.body, [
        /attempt.{0,3}1/i,
        /log|capture/i,
        /surviv|preserv|separate|distinct|per-attempt|not overwrit/i,
      ]),
    ).toBe(true);
  });

  test("the audit vocabulary is not hard-coded to the stream-idle outcome", () => {
    const section = theRetrySection(smokeSkill!);
    const values = new Set<string>();
    const re = /attempt_\d+_exit=([A-Za-z0-9_<>-]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(section.body)) !== null) values.add(m[1]!);
    // A widened retry that still reports `attempt_1_exit=stream_idle` would
    // mislabel the transient class it actually recovered from.
    const nonStreamIdleFailures = [...values].filter(
      (v) => v !== "stream_idle" && v !== "success" && !v.startsWith("<"),
    );
    expect(nonStreamIdleFailures.length).toBeGreaterThanOrEqual(1);
  });

  test("any glob over per-attempt logs carries a zsh-nomatch guard in the same fence", () => {
    const section = theRetrySection(smokeSkill!);
    const globbing = fenceBodies(section.body).filter((f) =>
      /\/tmp\/\S*attempt\S*\*|\*\S*attempt\S*\.log/i.test(f),
    );
    for (const fence of globbing) {
      expect(/bash -c|nullglob|setopt/.test(fence)).toBe(true);
    }
  });
});

describeConformance("AC-STE-430.5 — /conformance-loop records both attempts too", () => {
  test("its retry section carries the two-attempt audit row", () => {
    const found = retrySections(conformanceSkill!);
    expect(found.length).toBeGreaterThanOrEqual(1);
    const joined = found.map((s) => s.body).join("\n\n");
    for (const token of ["attempt_1_exit", "attempt_2_exit"]) {
      expect(joined).toContain(token);
    }
  });
});
