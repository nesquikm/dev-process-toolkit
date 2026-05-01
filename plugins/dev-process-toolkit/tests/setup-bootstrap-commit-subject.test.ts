import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSetupBootstrapCommitSubjectProbe } from "../adapters/_shared/src/setup_bootstrap_commit_subject";

// STE-183 AC-STE-183.4 / AC-STE-183.5 — `setup-bootstrap-commit-subject` probe.
//
// Verifies the most recent `chore: bootstrap dev-process-toolkit*` commit on
// the current branch carries:
//   (a) subject exactly `chore: bootstrap dev-process-toolkit` (no `(v0.1.0)`
//       suffix or any parenthesized suffix), AND
//   (b) body contains a single line matching `^Toolkit: dev-process-toolkit
//       v\d+\.\d+\.\d+$`, OR no `Toolkit:` line if the commit predates the FR
//       ship date (backwards-compat carve-out via author date < shipDate).
//
// Vacuous on repos with no `chore: bootstrap dev-process-toolkit*` commit.

const pluginRoot = join(import.meta.dir, "..");
const setupSkill = join(pluginRoot, "skills", "setup", "SKILL.md");
const gateCheckSkill = join(pluginRoot, "skills", "gate-check", "SKILL.md");

function git(cwd: string, ...args: string[]): string {
  // Use execFileSync (argv array) rather than execSync with a shell-string
  // so commit subjects / bodies containing spaces, quotes, or shell
  // metacharacters never reach a shell parser.
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}

function makeRepo(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "bootstrap-subject-"));
  git(root, "init", "-q");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  // Allow commit-msg hook bypass — fresh tmp repos have no hook installed.
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function makeBootstrapCommit(root: string, subject: string, body: string): void {
  writeFileSync(join(root, "scaffold.txt"), "scaffold");
  git(root, "add", "scaffold.txt");
  // Use HEREDOC-style multi-line commit message via -F file approach.
  const msgPath = join(root, ".git", "COMMITMSG");
  writeFileSync(msgPath, `${subject}\n\n${body}\n`);
  git(root, "commit", "-F", msgPath, "-q");
}

describe("AC-STE-183.5(a) fresh /setup produces clean shape — probe passes", () => {
  test("subject without suffix + Toolkit: footer → no violations", async () => {
    const ctx = makeRepo();
    try {
      makeBootstrapCommit(
        ctx.root,
        "chore: bootstrap dev-process-toolkit",
        "Initial scaffold by /setup.\n\nRefs: STE-109\nToolkit: dev-process-toolkit v2.4.0",
      );
      const report = await runSetupBootstrapCommitSubjectProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-183.5(b) plugin.json missing → footer absent → still passes when the most recent commit is post-ship", () => {
  test("subject clean, footer absent → no violations (footer is best-effort)", async () => {
    const ctx = makeRepo();
    try {
      makeBootstrapCommit(
        ctx.root,
        "chore: bootstrap dev-process-toolkit",
        "Initial scaffold by /setup.\n\nRefs: STE-109",
      );
      const report = await runSetupBootstrapCommitSubjectProbe(ctx.root);
      // Per AC-STE-183.3: footer is best-effort — its absence is not a probe
      // failure when plugin.json is missing/corrupt. The probe only fails on
      // a malformed footer line or a regression to the suffixed subject.
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-183.5(c) plugin.json corrupt → same vacuous-on-footer-absence shape", () => {
  test("malformed Toolkit: line → probe flags the line; absent line → vacuous pass", async () => {
    // Same as (b): when the footer is absent, the probe does not enforce
    // its presence. Distinct from a malformed line, which IS a violation.
    const ctx = makeRepo();
    try {
      makeBootstrapCommit(
        ctx.root,
        "chore: bootstrap dev-process-toolkit",
        "Initial scaffold by /setup.\n\nToolkit: dev-process-toolkit v<unknown>",
      );
      const report = await runSetupBootstrapCommitSubjectProbe(ctx.root);
      expect(report.violations.length).toBeGreaterThan(0);
      const v = report.violations[0]!;
      expect(v.message).toMatch(/Toolkit:.*malformed|footer.*malformed|invalid.*Toolkit/i);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-183.5(d) subject regression to (v0.1.0) shape → probe fails", () => {
  test("legacy suffix in subject → violation", async () => {
    const ctx = makeRepo();
    try {
      makeBootstrapCommit(
        ctx.root,
        "chore: bootstrap dev-process-toolkit (v0.1.0)",
        "Initial scaffold by /setup.\n\nRefs: STE-109",
      );
      const report = await runSetupBootstrapCommitSubjectProbe(ctx.root);
      expect(report.violations.length).toBe(1);
      const v = report.violations[0]!;
      expect(v.message).toMatch(/Remedy:/);
      expect(v.message).toMatch(/Context:/);
      expect(v.message).toMatch(/v0\.1\.0|parenthesized suffix|suffix/i);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-183.4 vacuous-pass cases", () => {
  test("repo with no bootstrap commit → vacuous pass", async () => {
    const ctx = makeRepo();
    try {
      git(ctx.root, "commit", "--allow-empty", "-m", "init", "-q");
      const report = await runSetupBootstrapCommitSubjectProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });

  test("non-git directory → vacuous pass", async () => {
    const root = mkdtempSync(join(tmpdir(), "no-git-"));
    try {
      const report = await runSetupBootstrapCommitSubjectProbe(root);
      expect(report.violations).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("AC-STE-183.1 — SKILL.md drops the (v0.1.0) suffix from the bootstrap section", () => {
  test("setup SKILL.md no longer documents the (v0.1.0) suffix in the bootstrap step", () => {
    const body = readFileSync(setupSkill, "utf-8");
    // Slice from the bootstrap commit step heading forward (8b) until the
    // next ### heading. The (v0.1.0) literal must not appear inside that
    // slice. (Outside the slice, e.g., in a CHANGELOG-style historical
    // mention, the literal is allowed.)
    const start = body.indexOf("### 8b. Bootstrap commit");
    expect(start).toBeGreaterThan(-1);
    const tail = body.slice(start);
    const endRel = tail.indexOf("\n### ");
    const slice = endRel === -1 ? tail : tail.slice(0, endRel);
    expect(slice).not.toMatch(/\(v0\.1\.0\)/);
  });
});

describe("AC-STE-183.2 — SKILL.md adds Toolkit: footer instruction", () => {
  test("setup SKILL.md mentions the Toolkit: dev-process-toolkit footer", () => {
    const body = readFileSync(setupSkill, "utf-8");
    expect(body).toMatch(/Toolkit:\s*dev-process-toolkit/);
  });

  test("setup SKILL.md names plugin.json as the version source", () => {
    const body = readFileSync(setupSkill, "utf-8");
    expect(body).toMatch(/\.claude-plugin\/plugin\.json/);
  });
});

describe("AC-STE-183.3 — fault tolerance prose", () => {
  test("setup SKILL.md documents the missing/corrupt plugin.json fall-through", () => {
    const body = readFileSync(setupSkill, "utf-8");
    expect(body).toMatch(/missing|corrupt|fault.tolerant|best.effort/i);
    // The bootstrap commit is load-bearing; the footer is best-effort.
    expect(body).toMatch(/footer.*absent|skip.*footer|footer.*skip/i);
  });
});

describe("AC-STE-183.4 — gate-check SKILL.md registers the probe", () => {
  test("gate-check SKILL.md references probe `setup-bootstrap-commit-subject`", () => {
    const body = readFileSync(gateCheckSkill, "utf-8");
    expect(body).toMatch(/setup-bootstrap-commit-subject/);
  });
});

describe("Stage C hardening — boundary cases", () => {
  test("two valid Toolkit: footer lines → violation (count > 1 path)", async () => {
    const ctx = makeRepo();
    try {
      makeBootstrapCommit(
        ctx.root,
        "chore: bootstrap dev-process-toolkit",
        "Initial scaffold.\n\nToolkit: dev-process-toolkit v2.4.0\nToolkit: dev-process-toolkit v2.4.1",
      );
      const report = await runSetupBootstrapCommitSubjectProbe(ctx.root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.message).toMatch(/at most one|count=2/i);
    } finally {
      ctx.cleanup();
    }
  });

  test("subject with bracketed scope (chore(scope): bootstrap ...) → vacuous (probe's grep does not match)", async () => {
    // The probe's `git log --grep='^chore: bootstrap dev-process-toolkit'`
    // only matches the canonical bare-`chore:` shape. A scoped variant
    // (`chore(setup): bootstrap ...`) doesn't match and the probe is
    // vacuous on it — that's intentional. The exact-subject check fires
    // only on commits the grep matched (i.e., trailing-suffix variants).
    const ctx = makeRepo();
    try {
      makeBootstrapCommit(
        ctx.root,
        "chore(setup): bootstrap dev-process-toolkit",
        "Initial scaffold.\n\nToolkit: dev-process-toolkit v2.4.0",
      );
      const report = await runSetupBootstrapCommitSubjectProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });

  test("body with a Toolkit-prefixed but non-Toolkit-line → not mistakenly flagged as malformed", async () => {
    // Lines that contain `Toolkit:` mid-body (e.g., a sentence) but don't
    // *start* with the prefix must not trip the malformed scanner — the
    // probe checks `line.startsWith("Toolkit:")` to scope to footer lines.
    const ctx = makeRepo();
    try {
      makeBootstrapCommit(
        ctx.root,
        "chore: bootstrap dev-process-toolkit",
        "Initial scaffold by /setup. The Toolkit: keyword appears mid-sentence here.\n\nToolkit: dev-process-toolkit v2.4.0",
      );
      const report = await runSetupBootstrapCommitSubjectProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-139.5 — setup-bootstrap-commit-subject runs clean on this repo's baseline", () => {
  test("runSetupBootstrapCommitSubjectProbe(repoRoot) returns zero violations", async () => {
    // Self-test: the dev-process-toolkit repo's own most-recent
    // `chore: bootstrap dev-process-toolkit*` commit (if any) must comply.
    // Absence of such a commit makes the probe vacuous → zero violations.
    const repoRoot = join(pluginRoot, "..", "..");
    const report = await runSetupBootstrapCommitSubjectProbe(repoRoot);
    expect(report.violations).toEqual([]);
  });
});
