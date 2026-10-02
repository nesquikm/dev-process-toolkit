// STE-654 (M_a85e46, design C-J1) — a ticket created by /spec-write is
// re-synced once after the FR file is written, so the ticket carries the
// substituted AC ids and the back-link rendered with the real key.
//
// Every anchor below is located by content, never by line number.
//
// AC-STE-654.5 is a CONTROL: it documents the failure mode the re-sync
// closes (the parser falls back to adapter-local jira-<n> ids, and the AC
// diff then reports no identical row). It is green at HEAD by design.
// AC-STE-654.2's budget pins mirror the existing pins in
// tests/ticket-ownership-shared.test.ts (AC-STE-606.10) and
// tests/create-front-door-shared.test.ts (AC-STE-604.8); they are green at
// HEAD and must stay green after the in-place edit.

import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseJiraDescriptionAcs } from "../adapters/_shared/src/jira_pull_acs";
import { classifyDiff } from "../adapters/_shared/src/classify_diff";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const read = (rel: string) => readFileSync(join(PLUGIN_ROOT, rel), "utf-8");

const TRACKER_MODE_DOC = "docs/spec-write-tracker-mode.md";
const SPEC_WRITE_SKILL = "skills/spec-write/SKILL.md";
const MODULE_PATH_RE = /[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.ts\b/;

/** The `### Concrete flow` section, up to the next `###`/`##` heading. */
function concreteFlow(doc: string): string {
  const start = doc.indexOf("### Concrete flow");
  if (start === -1) throw new Error("no `### Concrete flow` heading");
  const tail = doc.slice(start + "### Concrete flow".length);
  const end = tail.search(/\n#{2,3} /);
  return end === -1 ? tail : tail.slice(0, end);
}

/** Top-level numbered steps (`N. ...` at column 0) of a section, in order. */
function numberedSteps(section: string): string[] {
  const steps: string[] = [];
  for (const chunk of section.split(/\n(?=\d+\.\s)/)) {
    if (/^\d+\.\s/.test(chunk)) steps.push(chunk);
  }
  return steps;
}

/**
 * True when a step naming a Provider.sync UPDATE of the returned key appears
 * strictly after the step that writes the FR file.
 */
function resyncOrderedAfterWrite(section: string): boolean {
  const steps = numberedSteps(section);
  const writeIdx = steps.findIndex((s) => /Write the FR file/.test(s));
  if (writeIdx === -1) return false;
  return steps.slice(writeIdx + 1).some(
    (s) => /Provider\.sync/.test(s) && /\bupdate\b/i.test(s) && /returned (key|ID)/i.test(s),
  );
}

// ===========================================================================
// AC-STE-654.1 — the Concrete flow and the brand-new-FR paragraph.
// ===========================================================================

describe("AC-STE-654.1 — spec-write-tracker-mode.md orders the post-write re-sync", () => {
  test("AC-STE-654.1: the Concrete flow orders a Provider.sync update of the returned key AFTER 'Write the FR file'", () => {
    const section = concreteFlow(read(TRACKER_MODE_DOC));
    expect(numberedSteps(section).some((s) => /Write the FR file/.test(s))).toBe(true);
    expect(resyncOrderedAfterWrite(section)).toBe(true);
  });

  test("AC-STE-654.1 (opposite break): a flow that orders the re-sync BEFORE 'Write the FR file' fails the check", () => {
    const before = [
      "",
      "1. **Draft with placeholder.** Use `<tracker-id>`.",
      "2. **Create the tracker ticket.** Call `Provider.sync(spec)`.",
      "3. **Re-sync the ticket.** Call `Provider.sync(spec)` again — an update of the returned key.",
      "4. **Write the FR file.** Only after substitution completes.",
      "",
    ].join("\n");
    expect(resyncOrderedAfterWrite(before)).toBe(false);
    // Positive control: the same steps in the required order pass, so the
    // checker is not vacuously false.
    const after = [
      "",
      "1. **Draft with placeholder.** Use `<tracker-id>`.",
      "2. **Create the tracker ticket.** Call `Provider.sync(spec)`.",
      "3. **Write the FR file.** Only after substitution completes.",
      "4. **Re-sync the ticket.** Call `Provider.sync(spec)` again — an update of the returned key.",
      "",
    ].join("\n");
    expect(resyncOrderedAfterWrite(after)).toBe(true);
  });

  test("AC-STE-654.1: the brand-new-FR paragraph names the same re-sync", () => {
    const doc = read(TRACKER_MODE_DOC);
    const para = doc.split(/\n\s*\n/).find((p) => /^`\/spec-write` on a brand-new FR/.test(p.trim()));
    expect(para, "brand-new-FR paragraph not found").toBeDefined();
    expect(para!).toMatch(/re-?sync/i);
    expect(para!).toMatch(/\bupdate\b/i);
  });
});

// ===========================================================================
// AC-STE-654.2 — the SKILL.md ticket-create line, in place, plus budgets.
// ===========================================================================

describe("AC-STE-654.2 — spec-write SKILL.md ticket-create line orders the re-sync", () => {
  const ticketCreateLine = (): string => {
    const lines = read(SPEC_WRITE_SKILL).split("\n").filter((l) => l.startsWith("**Draft with placeholder.**"));
    expect(lines.length, "exactly one ticket-create line").toBe(1);
    return lines[0]!;
  };

  test("AC-STE-654.2: a Provider.sync update is ordered after the FR-file write on the ticket-create line", () => {
    const line = ticketCreateLine();
    const writeAt = line.search(/write the FR file/i);
    expect(writeAt).toBeGreaterThan(-1);
    const after = line.slice(writeAt);
    expect(after).toMatch(/Provider\.sync/);
    expect(after).toMatch(/\bupdate\b/i);
  });

  test("AC-STE-654.2: the ticket-create line carries no module path", () => {
    expect(ticketCreateLine().match(MODULE_PATH_RE)).toBeNull();
  });

  // Mirrors of the existing budget pins (AC-STE-606.10 / AC-STE-604.8).
  const steTokens = (s: string) => (s.match(/STE-\d+/g) ?? []).length;

  test("AC-STE-654.2: SKILL.md keeps 358 split-lines and 54 STE tokens", () => {
    const body = read(SPEC_WRITE_SKILL);
    expect(body.split("\n").length).toBe(358);
    expect(steTokens(body)).toBe(54);
  });

  test("AC-STE-654.2: skills/**/*.md keeps 245 STE tokens", () => {
    const root = join(PLUGIN_ROOT, "skills");
    let total = 0;
    let files = 0;
    for (const rel of new Glob("**/*.md").scanSync(root)) {
      files += 1;
      total += steTokens(readFileSync(join(root, rel), "utf-8"));
    }
    expect(files).toBeGreaterThan(20);
    expect(total).toBe(245);
  });
});

// ===========================================================================
// AC-STE-654.3 — the adapters render {tracker_id} on the post-create update.
// ===========================================================================

/** The numbered step that renders `ticket_description_template`. */
function renderStep(doc: string): string {
  const step = numberedStepsAnyIndent(doc).find((s) => /Render `ticket_description_template`/.test(s));
  if (step === undefined) throw new Error("no render step found");
  return step;
}

function numberedStepsAnyIndent(doc: string): string[] {
  return doc.split(/\n(?=\d+\.\s)/).filter((c) => /^\d+\.\s/.test(c));
}

describe("AC-STE-654.3 — jira.md and linear.md render {tracker_id} on the post-create update", () => {
  for (const adapter of ["jira", "linear"] as const) {
    test(`AC-STE-654.3: adapters/${adapter}.md's render step names the post-create update, not the create`, () => {
      const step = renderStep(read(`adapters/${adapter}.md`));
      expect(step).toContain("{tracker_id}");
      expect(step).toMatch(/post-create update/i);
      expect(step).toMatch(/not on the create|key is unknown|unknown (at|on) (the )?create/i);
    });
  }
});

// ===========================================================================
// AC-STE-654.4 — ac-sync.md explains how a placeholder ticket heals.
// ===========================================================================

describe("AC-STE-654.4 — ac-sync.md names the jira-<n> / placeholder pairing and keep-local healing", () => {
  test("AC-STE-654.4: § Per-AC prompt states the pairing means draft placeholder ids and keeping local heals it", () => {
    const doc = read("docs/ac-sync.md");
    const start = doc.indexOf("## Per-AC prompt");
    expect(start).toBeGreaterThan(-1);
    const tail = doc.slice(start + 1);
    const end = tail.search(/\n## /);
    const section = end === -1 ? tail : tail.slice(0, end);
    const para = section.split(/\n\s*\n/).find((p) => /jira-<n>/.test(p));
    expect(para, "no paragraph naming jira-<n>").toBeDefined();
    expect(para!).toMatch(/tracker-only/);
    expect(para!).toMatch(/local-only/);
    expect(para!).toMatch(/placeholder/i);
    expect(para!).toMatch(/keep(ing)? local/i);
    expect(para!).toMatch(/heal/i);
  });
});

// ===========================================================================
// AC-STE-654.5 — CONTROL (green at HEAD): the failure mode, measured.
// ===========================================================================

describe("AC-STE-654.5 — parser + classifyDiff control (documents behaviour; green at HEAD)", () => {
  const LOCAL = [
    { id: "AC-GF-100.1", text: "x", completed: false },
    { id: "AC-GF-100.2", text: "y", completed: false },
  ];

  test("AC-STE-654.5: a placeholder body parses to adapter-local ids and classifyDiff reports no identical row", () => {
    for (const body of [
      "## Acceptance Criteria\n- [ ] AC.1: x\n- [ ] AC.2: y\n",
      "## Acceptance Criteria\n- [ ] AC-<tracker-id>.1: x\n- [ ] AC-<tracker-id>.2: y\n",
    ]) {
      const tracker = parseJiraDescriptionAcs(body);
      expect(tracker.map((a) => a.id)).toEqual(["jira-1", "jira-2"]);
      const rows = classifyDiff(LOCAL, tracker);
      expect(rows.length).toBe(4);
      expect(rows.filter((r) => r.classification === "identical")).toEqual([]);
      expect(rows.filter((r) => r.classification === "tracker-only").map((r) => r.id)).toEqual(["jira-1", "jira-2"]);
      expect(rows.filter((r) => r.classification === "local-only").map((r) => r.id)).toEqual(["AC-GF-100.1", "AC-GF-100.2"]);
    }
  });

  test("AC-STE-654.5: the substituted body yields identical rows", () => {
    const tracker = parseJiraDescriptionAcs("## Acceptance Criteria\n- [ ] AC-GF-100.1: x\n- [ ] AC-GF-100.2: y\n");
    expect(tracker.map((a) => a.id)).toEqual(["AC-GF-100.1", "AC-GF-100.2"]);
    const rows = classifyDiff(LOCAL, tracker);
    expect(rows.map((r) => r.classification)).toEqual(["identical", "identical"]);
  });
});
