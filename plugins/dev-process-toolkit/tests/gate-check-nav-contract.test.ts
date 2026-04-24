import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runNavContractProbe } from "../adapters/_shared/src/docs_nav_contract";

// Gate-check probe #12 integration tests (STE-69 AC-STE-69.9, STE-82
// probe authoring contract). Required companion to the probe declared in
// skills/gate-check/SKILL.md. Covers:
//   - positive fixture: valid tree + docs mode enabled → passes clean
//   - docs mode disabled → probe skips
//   - negative #1: missing #how-to anchor
//   - negative #2: extra ##-level heading
//   - negative #3: broken subdirectory link
// Each negative asserts the note shape `file:line — reason` required by
// STE-82's contract.

let work: string;
let projectRoot: string;

const VALID_README = `# Docs

## Tutorials {#tutorials}

Learn the basics. See [tutorials/](tutorials/).

## How-to guides {#how-to}

Task-oriented recipes. See [how-to/](how-to/).

## Reference {#reference}

Lookups. See [reference/](reference/).

## Explanation {#explanation}

Rationale. See [explanation/architecture.md](explanation/architecture.md).
`;

const CLAUDE_MD_DOCS_ENABLED = `# Project

## Docs

user_facing_mode: true
packages_mode: false
changelog_ci_owned: false
`;

const CLAUDE_MD_DOCS_DISABLED = `# Project

No docs section.
`;

function seedValidTree(): void {
  mkdirSync(join(projectRoot, "docs/tutorials"), { recursive: true });
  mkdirSync(join(projectRoot, "docs/how-to"), { recursive: true });
  mkdirSync(join(projectRoot, "docs/reference"), { recursive: true });
  mkdirSync(join(projectRoot, "docs/explanation"), { recursive: true });
  writeFileSync(join(projectRoot, "docs/explanation/architecture.md"), "# Arch\n");
  writeFileSync(join(projectRoot, "docs/README.md"), VALID_README);
}

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "dpt-probe-nav-"));
  projectRoot = join(work, "project");
  mkdirSync(projectRoot, { recursive: true });
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

describe("gate-check probe #12 — docs/README.md nav contract", () => {
  test("positive: valid tree + docs mode enabled → passes clean", () => {
    writeFileSync(join(projectRoot, "CLAUDE.md"), CLAUDE_MD_DOCS_ENABLED);
    seedValidTree();

    const result = runNavContractProbe(projectRoot);

    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.notes).toEqual([]);
  });

  test("skip: no docs mode enabled → probe skips, emits no notes", () => {
    writeFileSync(join(projectRoot, "CLAUDE.md"), CLAUDE_MD_DOCS_DISABLED);
    // Deliberately do NOT seed the tree — skipped probes never read it.

    const result = runNavContractProbe(projectRoot);

    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.notes).toEqual([]);
  });

  test("negative: missing #how-to anchor → note in file:line — reason shape", () => {
    writeFileSync(join(projectRoot, "CLAUDE.md"), CLAUDE_MD_DOCS_ENABLED);
    seedValidTree();
    const missing = VALID_README.replace(
      /## How-to guides \{#how-to\}[\s\S]*?(?=## Reference)/,
      "",
    );
    writeFileSync(join(projectRoot, "docs/README.md"), missing);

    const result = runNavContractProbe(projectRoot);

    expect(result.ok).toBe(false);
    expect(result.notes.length).toBeGreaterThan(0);
    const note = result.notes.find((n) => n.reason.includes("how-to"));
    expect(note).toBeDefined();
    expect(note!.file).toBe("docs/README.md");
    expect(note!.line).toBeGreaterThan(0);
    expect(note!.reason.toLowerCase()).toContain("how-to");
  });

  test("negative: extra ##-level heading → note names the offending heading + its line", () => {
    writeFileSync(join(projectRoot, "CLAUDE.md"), CLAUDE_MD_DOCS_ENABLED);
    seedValidTree();
    const withExtra = VALID_README + `\n## Bonus Section\n\nExtra content.\n`;
    writeFileSync(join(projectRoot, "docs/README.md"), withExtra);

    const result = runNavContractProbe(projectRoot);

    expect(result.ok).toBe(false);
    const note = result.notes.find((n) => n.reason.includes("Bonus Section"));
    expect(note).toBeDefined();
    expect(note!.file).toBe("docs/README.md");
    // The `## Bonus Section` line lives after the valid README body, which is
    // at least 17 lines in the base template — assert non-1 line number to
    // prove we resolved the heading's true position, not a fallback.
    expect(note!.line).toBeGreaterThan(1);
  });

  test("negative: broken subdirectory link → note names the broken target", () => {
    writeFileSync(join(projectRoot, "CLAUDE.md"), CLAUDE_MD_DOCS_ENABLED);
    seedValidTree();
    // Remove the referenced architecture.md.
    rmSync(join(projectRoot, "docs/explanation/architecture.md"));

    const result = runNavContractProbe(projectRoot);

    expect(result.ok).toBe(false);
    const note = result.notes.find((n) => n.reason.includes("architecture.md"));
    expect(note).toBeDefined();
    expect(note!.file).toBe("docs/README.md");
    expect(note!.reason).toContain("broken link");
  });

  test("negative: missing README.md file itself → single note describing the miss", () => {
    writeFileSync(join(projectRoot, "CLAUDE.md"), CLAUDE_MD_DOCS_ENABLED);
    // No tree seeded at all.

    const result = runNavContractProbe(projectRoot);

    expect(result.ok).toBe(false);
    expect(result.notes.length).toBeGreaterThan(0);
  });
});
