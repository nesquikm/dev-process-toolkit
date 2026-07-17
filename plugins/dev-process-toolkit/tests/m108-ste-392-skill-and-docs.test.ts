// M108 STE-392 AC-STE-392.2/.3/.4/.6/.7/.8 — the assisted monolith-split flow
// as it is written down: STE-49-shape doc-conformance greps over
// `skills/upgrade/SKILL.md` (the flow prose) and `docs/upgrade-reference.md`
// (the walkthrough), plus the calibration snapshots this FR's prose rides
// against.
//
// The flow's ORDER is asserted on four anchors distinctive to one step each —
// none of them appeared in either file before this FR, so their document order
// is the sequence itself:
//
//   backup  → `specs-backup-`            triage → `AskUserQuestion`
//   split   → `buildFRFrontmatter`       freeze → `requirements.md.template`

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const UPGRADE_SKILL = join(PLUGIN_ROOT, "skills", "upgrade", "SKILL.md");
const UPGRADE_REFERENCE = join(PLUGIN_ROOT, "docs", "upgrade-reference.md");

const readSkill = (): string => readFileSync(UPGRADE_SKILL, "utf-8");
const readDoc = (): string => readFileSync(UPGRADE_REFERENCE, "utf-8");
const paragraphs = (body: string): string[] => body.split(/\n{2,}/);

/** Paragraphs matching every predicate — the STE-391 grep shape. */
const hits = (body: string, ...res: RegExp[]): string[] =>
  paragraphs(body).filter((p) => res.every((re) => re.test(p)));

/**
 * The reference's monolith-split walkthrough section ONLY — `""` when no
 * heading introduces one.
 *
 * Scoped rather than grepping the whole file, because the reference already
 * carries generic re-run/idempotency and backup-tag prose from STE-391: an
 * unscoped grep for "re-running" or "restore … backup" passes on the shipped
 * doc and would prove nothing about this FR's walkthrough.
 */
function walkthrough(): string {
  const lines = readDoc().split("\n");
  const start = lines.findIndex((l) => /^#{2,4}\s.*(monolith|walkthrough)/i.test(l));
  if (start === -1) return "";
  const level = lines[start]!.match(/^#+/)![0]!.length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i]!.match(/^(#+)\s/);
    if (m && m[1]!.length <= level) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

// ---------------------------------------------------------------------------
// The flow is registered and reachable
// ---------------------------------------------------------------------------

describe("AC-STE-392.1 — the runner's assisted routing names this entry's flow", () => {
  test("the skill names the `monolith-split` entry by id", () => {
    expect(readSkill()).toContain("monolith-split");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-392.2 — backup rail prose: ordering, mandatory, surfaced
// ---------------------------------------------------------------------------

describe("AC-STE-392.2 — the backup happens BEFORE any mutation", () => {
  test("the flow's four steps appear in order: backup → triage → split → freeze", () => {
    const body = readSkill();
    const backup = body.indexOf("specs-backup-");
    const triage = body.indexOf("AskUserQuestion");
    const split = body.indexOf("buildFRFrontmatter");
    const freeze = body.indexOf("requirements.md.template");
    expect(backup).toBeGreaterThan(-1);
    expect(triage).toBeGreaterThan(-1);
    expect(split).toBeGreaterThan(-1);
    expect(freeze).toBeGreaterThan(-1);
    expect(backup).toBeLessThan(triage);
    expect(triage).toBeLessThan(split);
    expect(split).toBeLessThan(freeze);
  });

  test("the backup step states it runs before anything is mutated", () => {
    expect(hits(readSkill(), /backup/i, /before|first|prior to/i, /mutat|touch|move|writ/i).length)
      .toBeGreaterThanOrEqual(1);
  });

  test("the backup is MANDATORY regardless of VCS state — a git-ignored tree has no other net", () => {
    expect(
      hits(readSkill(), /backup/i, /mandatory|always|regardless|whether or not|even when/i).length,
    ).toBeGreaterThanOrEqual(1);
  });

  test("the backup directory shape is pinned (timestamped sibling, collision-suffixed)", () => {
    const body = readSkill();
    expect(body).toContain("specs-backup-");
    expect(hits(body, /specs-backup-/, /collision|suffix|clash/i).length).toBeGreaterThanOrEqual(1);
  });

  test("copy failure aborts the flow in NFR-10 shape", () => {
    expect(
      hits(readSkill(), /backup|copy/i, /fail|error/i, /abort|refus|exit/i).length,
    ).toBeGreaterThanOrEqual(1);
  });

  test("the backup path is surfaced in the closing summary", () => {
    expect(hits(readSkill(), /summar/i, /backup/i).length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-392.3 — triage prose
// ---------------------------------------------------------------------------

describe("AC-STE-392.3 — status triage is operator-confirmed, never silent", () => {
  test("the derived table is presented for confirmation", () => {
    expect(hits(readSkill(), /triage|derived/i, /table|open|shipped/i).length).toBeGreaterThanOrEqual(
      1,
    );
  });

  test("the Socratic contract is honored — AskUserQuestion, not a silent classification", () => {
    const body = readSkill();
    expect(body).toContain("AskUserQuestion");
    expect(hits(body, /AskUserQuestion|confirm/i, /override|per-FR|each FR/i).length)
      .toBeGreaterThanOrEqual(1);
  });

  test("triage completes before anything moves", () => {
    expect(
      hits(readSkill(), /triage|confirm|classif/i, /before/i, /move|split|freeze|mutat/i).length,
    ).toBeGreaterThanOrEqual(1);
  });

  test("the prose says why triage exists: derived state is not trusted on its own", () => {
    expect(
      hits(readSkill(), /checkbox|derived|classif/i, /lie|stale|wrong|not trust|no silent|never silent/i)
        .length,
    ).toBeGreaterThanOrEqual(1);
  });

  test("the classification is derived by the registry's pure helpers, not by eyeball", () => {
    const body = readSkill();
    expect(body).toMatch(/parseMonolithFRSections|extractPlanCheckboxState|classifyFRs/);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-392.4 — split prose
// ---------------------------------------------------------------------------

describe("AC-STE-392.4 — the split routes through the canonical helpers", () => {
  test("all three canonical helpers are named", () => {
    const body = readSkill();
    expect(body).toContain("buildFRFrontmatter");
    expect(body).toContain("acPrefix");
    expect(body).toMatch(/Provider\.filenameFor|filenameFor/);
  });

  test("mode: none mints ULIDs locally — short-ULID filenames and AC prefixes", () => {
    expect(hits(readSkill(), /mode: ?none|mode none/i, /ULID/).length).toBeGreaterThanOrEqual(1);
  });

  test("tracker mode routes through the /spec-write creation path instead", () => {
    const body = readSkill();
    expect(body).toContain("/spec-write");
    expect(hits(body, /tracker mode|tracker-mode/i, /spec-write|0b|creat/i).length)
      .toBeGreaterThanOrEqual(1);
  });

  test("ticket creation does NOT claim the ticket on create", () => {
    expect(hits(readSkill(), /creat/i, /no claim|never claim|without claim|not claim/i).length)
      .toBeGreaterThanOrEqual(1);
  });

  test("legacy dotted AC ids are rewritten to the derived prefix", () => {
    expect(hits(readSkill(), /rewriteAcPrefix|AC-|prefix/i, /legacy|rewrit|re-key/i).length)
      .toBeGreaterThanOrEqual(1);
  });

  test("each split file carries a provenance note naming its legacy FR number", () => {
    expect(hits(readSkill(), /provenance/i, /legacy|FR-/i).length).toBeGreaterThanOrEqual(1);
  });

  test("milestone bindings retain the LEGACY M-numbers — nothing is renumbered", () => {
    expect(hits(readSkill(), /milestone|M-number|M<N>/i, /legacy|retain|keep|preserve/i).length)
      .toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-392.5 — freeze prose
// ---------------------------------------------------------------------------

describe("AC-STE-392.5 — the freeze step's prose", () => {
  test("the monolith relocates read-only into the specs archive", () => {
    expect(hits(readSkill(), /freeze|archiv|relocat/i, /read-only|legacy/i).length)
      .toBeGreaterThanOrEqual(1);
  });

  test("git mv when tracked, filesystem move otherwise", () => {
    const body = readSkill();
    expect(body).toContain("git mv");
    expect(hits(body, /git mv/, /track|untrack|otherwise|ignor/i).length).toBeGreaterThanOrEqual(1);
  });

  test("the fresh cross-cutting requirements.md comes from the shipped template", () => {
    expect(readSkill()).toContain("requirements.md.template");
  });

  test("a pointer line is left behind pointing at the legacy archive", () => {
    expect(hits(readSkill(), /pointer/i, /legacy|archiv/i).length).toBeGreaterThanOrEqual(1);
  });

  test("plan stubs are minted ONLY for milestones with surviving open work", () => {
    expect(hits(readSkill(), /stub/i, /open|surviv|remaining/i).length).toBeGreaterThanOrEqual(1);
  });

  test("freeze-everything is stated as LEGAL, not as an error path", () => {
    // An operator whose every AC turns out shipped must not read the empty
    // split set as a failure.
    expect(
      hits(readSkill(), /empty|everything|zero|all shipped/i, /legal|valid|legitimate|expected|fine/i)
        .length,
    ).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-392.6 — ignored-specs advisory + commit leg
// ---------------------------------------------------------------------------

describe("AC-STE-392.6 — git-ignored specs get a loud advisory and NO commit", () => {
  test("the advisory fires when specs/ is git-ignored", () => {
    expect(hits(readSkill(), /ignor/i, /specs/, /advisor/i).length).toBeGreaterThanOrEqual(1);
  });

  test("it recommends removing the ignore rule, on the committed-specs rationale", () => {
    expect(
      hits(readSkill(), /ignor/i, /remov|delet|drop/i, /source of truth|committed|convention/i).length,
    ).toBeGreaterThanOrEqual(1);
  });

  test("the commit leg is SKIPPED when specs/ is ignored", () => {
    expect(hits(readSkill(), /ignor/i, /skip/i, /commit/i).length).toBeGreaterThanOrEqual(1);
  });

  test("the advisory NEVER edits the consumer's .gitignore", () => {
    expect(
      hits(readSkill(), /\.gitignore/, /never|not edit|does not|advisory only|leave/i).length,
    ).toBeGreaterThanOrEqual(1);
  });

  test("a TRACKED specs tree takes the standard one-approval-commit rail", () => {
    // Scoped to a paragraph that is about `specs/`: the runner's step 4 already
    // pairs track/commit/approval words for the SCRIPT batch, and matching that
    // would prove nothing about this flow's commit leg.
    expect(hits(readSkill(), /specs/, /track/i, /commit/i, /approv/i).length)
      .toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-392.7 — docs/upgrade-reference.md walkthrough
// ---------------------------------------------------------------------------

describe("AC-STE-392.7 — the reference gains the assisted-entry walkthrough", () => {
  test("a dedicated walkthrough section exists and names the entry", () => {
    expect(walkthrough().length).toBeGreaterThan(0);
    expect(walkthrough()).toContain("monolith-split");
  });

  test("all six legs are documented: detect → backup → triage → split → freeze → commit/advisory", () => {
    const body = walkthrough();
    for (const leg of [
      /\bdetect/i,
      /\bbackup/i,
      /\btriage/i,
      /\bsplit/i,
      /\bfreeze/i,
      /\bcommit/i,
      /advisor/i,
    ]) {
      expect(body).toMatch(leg);
    }
  });

  test("the legs are documented in flow order", () => {
    const body = walkthrough();
    const at = (re: RegExp): number => body.search(re);
    expect(at(/\bbackup/i)).toBeGreaterThan(-1);
    expect(at(/\btriage/i)).toBeGreaterThan(-1);
    expect(at(/\bfreeze/i)).toBeGreaterThan(-1);
    expect(at(/\bbackup/i)).toBeLessThan(at(/\btriage/i));
    expect(at(/\btriage/i)).toBeLessThan(at(/\bfreeze/i));
  });

  test("re-run semantics are documented — the post-split detector goes quiet", () => {
    expect(
      hits(walkthrough(), /re-run|rerun|second run|again/i, /quiet|silent|no longer|stops|nothing to do/i)
        .length,
    ).toBeGreaterThanOrEqual(1);
  });

  test("the restore-from-backup recovery path is documented", () => {
    expect(hits(walkthrough(), /restore|recover/i, /backup/i).length).toBeGreaterThanOrEqual(1);
  });

  test("recovery is re-run-from-restored-tree, not bespoke rollback machinery", () => {
    expect(
      hits(walkthrough(), /restore|recover|backup/i, /re-run|rerun|run .*again/i).length,
    ).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-392.8 — the calibration snapshots this FR's prose rides against
// ---------------------------------------------------------------------------

describe("AC-STE-392.8 — no meta-test regresses on the surfaces this FR edits", () => {
  test("skills/upgrade/SKILL.md stays within the NFR-1 line cap (354)", () => {
    expect(readSkill().split("\n").length).toBeLessThanOrEqual(354);
  });

  test("the skills/ STE-token ceiling (246) is not breached by the new flow prose", () => {
    // The ceiling is AT the pin with ZERO headroom: the flow prose must cite
    // its precedents by mechanism (`/spec-write` § 0b, `acPrefix`), never by
    // `STE-N` token.
    let count = 0;
    const walk = (d: string): void => {
      for (const name of readdirSync(d)) {
        const p = join(d, name);
        if (statSync(p).isDirectory()) {
          walk(p);
          continue;
        }
        if (!name.endsWith(".md")) continue;
        count += (readFileSync(p, "utf-8").match(/\b(STE|AC-STE)-\d+(?:\.\d+)?\b/g) ?? []).length;
      }
    };
    walk(join(PLUGIN_ROOT, "skills"));
    expect(count).toBeLessThanOrEqual(246);
  });
});
