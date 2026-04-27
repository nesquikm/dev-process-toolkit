import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// STE-73 — /ship-milestone skill shape.
//
// Prose assertions covering the 12 ACs of STE-73. The skill is
// plugin-authored (no runtime binary), so these doc-conformance tests
// are the long-term backstop — a future SKILL.md edit that drops the
// `--version` override, silences the codename prompt, or skips the
// CHANGELOG closing line would break a test instead of a release.

const pluginRoot = join(import.meta.dir, "..");
const skillPath = join(pluginRoot, "skills", "ship-milestone", "SKILL.md");
const referencePath = join(pluginRoot, "docs", "ship-milestone-reference.md");

function readSkill(): string {
  return readFileSync(skillPath, "utf8");
}
function readReference(): string {
  return readFileSync(referencePath, "utf8");
}

describe("AC-STE-73.1 — skill file + frontmatter", () => {
  test("skill file exists at canonical path", () => {
    const body = readSkill();
    expect(body.length).toBeGreaterThan(0);
  });

  test("frontmatter name is 'ship-milestone' and description mentions Release Checklist", () => {
    const body = readSkill();
    expect(body).toMatch(/^---\nname:\s*ship-milestone\n/);
    expect(body).toMatch(/description:[^\n]*[Rr]elease [Cc]hecklist/);
  });

  test("argument-hint advertises the M<N> + optional flags", () => {
    const body = readSkill();
    expect(body).toMatch(/argument-hint:[^\n]*M<N>/);
  });

  test("invocation is /ship-milestone with optional M<N> (no-arg picks most-recent in-progress)", () => {
    const body = readSkill();
    expect(body).toMatch(/\/ship-milestone/);
    expect(body).toMatch(/no-arg|no argument|most recent|most-recent/i);
  });
});

describe("AC-STE-73.2 — reads FR list from specs/plan/M<N>.md", () => {
  test("skill names `specs/plan/M<N>.md` as the FR-list source", () => {
    const body = readSkill();
    expect(body).toContain("specs/plan/M<N>.md");
  });
});

describe("AC-STE-73.3 — semver inference + --version override", () => {
  test("skill references inferBump / version_bump.ts", () => {
    const body = readSkill();
    expect(body).toMatch(/inferBump|version_bump\.ts/);
  });

  test("skill documents the --version X.Y.Z override flag", () => {
    const body = readSkill();
    expect(body).toMatch(/--version\s+X\.Y\.Z|--version\s+<X\.Y\.Z>/);
  });

  test("skill names the three bump paths (major / minor / patch)", () => {
    const body = readSkill();
    expect(body).toContain("major bump");
    expect(body).toContain("minor bump");
    expect(body).toContain("patch bump");
  });
});

describe("AC-STE-73.4 — Release Checklist in order", () => {
  test("skill enumerates the four checklist files in order", () => {
    const body = readSkill();
    const plugin = body.indexOf("plugin.json");
    const marketplace = body.indexOf("marketplace.json");
    const changelog = body.indexOf("CHANGELOG.md");
    const readme = body.indexOf("README.md");
    expect(plugin).toBeGreaterThan(-1);
    expect(marketplace).toBeGreaterThan(plugin);
    expect(changelog).toBeGreaterThan(marketplace);
    expect(readme).toBeGreaterThan(changelog);
  });

  test("CHANGELOG step documents the changelog_ci_owned skip", () => {
    const body = readSkill();
    expect(body).toContain("changelog_ci_owned");
  });
});

describe("AC-STE-73.5 — invokes /docs --commit --full internally", () => {
  test("skill names the /docs --commit --full invocation", () => {
    const body = readSkill();
    expect(body).toContain("/docs --commit --full");
  });

  test("skill documents the abort-on-/docs-failure NFR-10 refusal", () => {
    const body = readSkill();
    expect(body).toMatch(/cannot proceed with release/i);
    // NFR-10 canonical shape has a "Remedy:" line and a "Context:" line.
    expect(body).toMatch(/Remedy:[\s\S]*Context:/);
  });

  test("skill documents the docs-disabled skip (no-op log)", () => {
    const body = readSkill();
    expect(body).toMatch(/docs disabled|docs generation.*disabled/i);
  });
});

describe("AC-STE-73.6 — unified diff + approval, conventional commit, no push", () => {
  test("skill promises a single unified diff of all modified files", () => {
    const body = readSkill();
    expect(body).toMatch(/unified diff|single.*diff/i);
  });

  test("skill requires explicit approval (y / yes)", () => {
    const body = readSkill();
    expect(body).toMatch(/\by\b.*\byes\b|\byes\b.*\by\b|`y`.*`yes`|explicit approval/i);
  });

  test("skill commit template references milestone + version + codename", () => {
    const body = readSkill();
    // AC-STE-73.6 + AC-STE-133.5 — Conventional Commits v1.0.0 form:
    //   subject: `chore(release): v<X.Y.Z>`
    //   footers: `Release: v<X.Y.Z> "<Codename>"` + `Refs: M<N>`
    // The pre-M36 bespoke `M<N>: v<X.Y.Z> "<Codename>" — <summary>` form is
    // superseded — the M36 cutover is from-CC-forward.
    expect(body).toMatch(/chore\(release\):\s*v<X\.Y\.Z>/);
    expect(body).toMatch(/Release:\s*v<X\.Y\.Z>\s*"<Codename>"/);
    expect(body).toMatch(/Refs:\s*M<N>/);
  });

  test("skill explicitly forbids git push", () => {
    const body = readSkill();
    expect(body).toMatch(/does not (run )?`?git push`?|no `?git push`?|never push/i);
  });
});

describe("AC-STE-73.7 — decline = no writes", () => {
  test("skill documents the declined-release exit message", () => {
    const body = readSkill();
    expect(body).toContain("ship-milestone declined");
    expect(body).toMatch(/release not committed/i);
  });
});

describe("AC-STE-73.8 — refuse when unshipped FRs remain", () => {
  test("skill documents the unshipped-FR NFR-10 refusal", () => {
    const body = readSkill();
    expect(body).toMatch(/unshipped FR|status:\s*active/i);
    // NFR-10 shape again — unshipped-count refusal must mention `Context:`.
    expect(body).toMatch(/Context:[^\n]*milestone/);
  });
});

describe("AC-STE-73.9 — refuse on uncommitted changes outside expected set", () => {
  test("skill documents the dirty-working-tree refusal", () => {
    const body = readSkill();
    expect(body).toMatch(/uncommitted changes|dirty working tree|working tree/i);
    expect(body).toMatch(/expected-modified set|expected set|release files/i);
  });
});

describe("AC-STE-73.10 — codename prompt + validation", () => {
  test("skill documents the codename prompt wording", () => {
    const body = readSkill();
    expect(body).toMatch(/Enter milestone codename/);
  });

  test("skill documents codename validation: non-empty, ≤32 chars, no backticks or newlines", () => {
    const body = readSkill();
    expect(body).toMatch(/non-empty/i);
    expect(body).toMatch(/32\s*chars?|≤\s*32/);
    expect(body).toMatch(/backticks?|backtick/i);
    expect(body).toMatch(/newlines?/i);
  });

  test("skill documents the --codename override", () => {
    const body = readSkill();
    expect(body).toContain("--codename");
  });
});

describe("AC-STE-73.11 — post-ship checklist", () => {
  test("skill documents the post-ship next-steps block", () => {
    const body = readSkill();
    expect(body).toMatch(/git push/);
    expect(body).toMatch(/\/pr/);
    // The checklist must mention it is NOT automated — these steps are on the user.
    expect(body).toMatch(/not automated|next steps/i);
  });
});

describe("AC-STE-73.12 — CHANGELOG closing line with total test count", () => {
  test("skill documents the literal closing line template", () => {
    const body = readSkill();
    expect(body).toContain("Total test count at release:");
    expect(body).toMatch(/<N> tests, <F> failures, <E> errors/);
  });

  test("skill references adapters/_shared/src/test_count_parser.ts", () => {
    const body = readSkill();
    expect(body).toMatch(/test_count_parser\.ts|parseTestOutput/);
  });

  test("skill documents the non-zero-failures NFR-10 refusal", () => {
    const body = readSkill();
    expect(body).toMatch(/cannot tag release with/i);
    expect(body).toMatch(/test failure\(s\)/);
  });

  test("skill documents the changelog_ci_owned suppression of the closing line", () => {
    const body = readSkill();
    // The test-count line is suppressed when the CHANGELOG is CI-owned.
    expect(body).toMatch(/changelog_ci_owned[\s\S]{0,300}skip|skip[\s\S]{0,300}changelog_ci_owned/i);
  });
});

describe("NFR-1 — 300-line budget + reference overflow", () => {
  test("ship-milestone SKILL.md is ≤ 300 lines", () => {
    const body = readSkill();
    const lines = body.split("\n").length;
    expect(lines).toBeLessThanOrEqual(300);
  });

  test("SKILL.md points to docs/ship-milestone-reference.md", () => {
    const body = readSkill();
    expect(body).toContain("docs/ship-milestone-reference.md");
  });

  test("reference file exists", () => {
    const body = readReference();
    expect(body.length).toBeGreaterThan(0);
  });
});

describe("Canonical plugin discovery — argument-hint + skills/ path", () => {
  test("skill lives under plugins/dev-process-toolkit/skills/ship-milestone/SKILL.md", () => {
    // Canonical path test — the file at `skillPath` must exist. If it
    // doesn't, readSkill() throws above; this is a redundant positive
    // assertion that the layout contract is what AC-STE-73.1 prescribes.
    const body = readSkill();
    expect(body).toMatch(/# Ship milestone|# Ship Milestone|# \/ship-milestone/);
  });
});
