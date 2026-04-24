// Unit tests for validateNavContract (STE-69 AC-STE-69.2, .5, .8).
//
// 5 cases per the testing plan in specs/frs/STE-69.md:
//   (a) valid README passes,
//   (b) missing `#how-to` anchor fails with specific reason,
//   (c) extra `##`-level heading fails,
//   (d) anchor present but target file missing fails,
//   (e) mode invariance — user-facing-only config still needs all four
//       anchors (the reference/ content differs between modes but the
//       top-level nav contract is invariant).

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateNavContract } from "./docs_nav_contract";

let work: string;
let docsRoot: string;
let readmePath: string;

const VALID_README = `# Docs

## Tutorials {#tutorials}

Learn the basics step-by-step. See [tutorials/](tutorials/).

## How-to guides {#how-to}

Task-oriented recipes. See [how-to/](how-to/).

## Reference {#reference}

API + state reference. See [reference/](reference/).

## Explanation {#explanation}

Architecture and design rationale. See [explanation/architecture.md](explanation/architecture.md).
`;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "dpt-nav-"));
  docsRoot = join(work, "docs");
  readmePath = join(docsRoot, "README.md");
  // Seed the referenced targets so link resolution succeeds in the happy
  // path.  Individual tests overwrite README or remove targets as needed.
  mkdirSync(join(docsRoot, "tutorials"), { recursive: true });
  mkdirSync(join(docsRoot, "how-to"), { recursive: true });
  mkdirSync(join(docsRoot, "reference"), { recursive: true });
  mkdirSync(join(docsRoot, "explanation"), { recursive: true });
  writeFileSync(join(docsRoot, "explanation/architecture.md"), "# Arch\n");
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

describe("validateNavContract", () => {
  test("AC-STE-69.2/.5 — valid README passes", () => {
    writeFileSync(readmePath, VALID_README);
    const result = validateNavContract(readmePath);
    expect(result.ok).toBe(true);
  });

  test("AC-STE-69.5 — missing `#how-to` anchor fails with specific reason", () => {
    const bad = VALID_README.replace(/## How-to guides \{#how-to\}[\s\S]*?(?=## Reference)/, "");
    writeFileSync(readmePath, bad);
    const result = validateNavContract(readmePath);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.missingAnchors).toContain("how-to");
    expect(result.reason).toContain("how-to");
  });

  test("AC-STE-69.2 — extra `##`-level heading fails", () => {
    const extra = VALID_README + `\n## Bonus Section\n\nExtra content.\n`;
    writeFileSync(readmePath, extra);
    const result = validateNavContract(readmePath);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason.toLowerCase()).toContain("heading");
    expect(result.extraHeadings?.some((e) => e.title === "Bonus Section")).toBe(true);
    // Line number is computed from the parsed heading, not a hard-coded 1.
    expect(result.extraHeadings?.find((e) => e.title === "Bonus Section")?.line).toBeGreaterThan(1);
  });

  test("AC-STE-69.5 — anchor present but target file missing fails", () => {
    writeFileSync(readmePath, VALID_README);
    // Remove the architecture.md target.
    rmSync(join(docsRoot, "explanation/architecture.md"));

    const result = validateNavContract(readmePath);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.brokenLinks?.some((l) => l.includes("architecture.md"))).toBe(true);
  });

  test("AC-STE-69.5 — anchor present but target directory missing fails", () => {
    writeFileSync(readmePath, VALID_README);
    rmSync(join(docsRoot, "how-to"), { recursive: true });

    const result = validateNavContract(readmePath);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.brokenLinks?.some((l) => l.includes("how-to"))).toBe(true);
  });

  test("mode invariance — user-facing-only tree still needs all four anchors", () => {
    // Same README contract, no `reference/api/` subdir (user-facing only
    // mode). Top-level anchors still must resolve.
    writeFileSync(readmePath, VALID_README);
    const result = validateNavContract(readmePath);
    expect(result.ok).toBe(true);
  });

  test("README file missing — returns ok:false with a reason", () => {
    // No README written; validator should not throw.
    const result = validateNavContract(readmePath);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason.toLowerCase()).toContain("readme");
  });

  test("all four missing — returns ok:false listing all four as missing", () => {
    writeFileSync(readmePath, `# Docs\n\nNothing here yet.\n`);
    const result = validateNavContract(readmePath);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.missingAnchors).toEqual(
      expect.arrayContaining(["tutorials", "how-to", "reference", "explanation"]),
    );
  });
});
