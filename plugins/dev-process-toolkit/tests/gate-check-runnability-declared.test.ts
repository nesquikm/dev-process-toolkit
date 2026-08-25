// STE-504 (M131) — /gate-check probe `runnability_declared` (#80).
//
// "A repo carrying discoverable run instructions must declare a run command; a
// repo carrying none is never asked."
//
// The probe is the enforcement half of `detectRunnability` (whose own
// both-directions coverage lives in `tests/m131-ste-504-runnability.test.ts`).
// Its whole design constraint is restraint: it must be SILENT unless detection
// actually fired, and silent the moment the author has answered — including
// when the answer is `none`. The FR's `## Notes` names the failure mode: a
// probe that reds a library repo trains the author to write `run_cmd: none`
// without reading the question, and a contract everyone silences is worse than
// no contract because it looks like coverage.
//
// RED-state until the implementation lands at:
//   plugins/dev-process-toolkit/adapters/_shared/src/runnability_declared.ts
//
// AC coverage:
//   AC-STE-504.3 — detection fires AND `run_cmd` absent ⇒ one error violation.
//   AC-STE-504.4 — silent when detection does not fire (whatever `run_cmd`
//                  says), and silent when `run_cmd` is declared — `none`
//                  asserted explicitly and separately, because the
//                  none-vs-absent distinction is the whole point.
//   AC-STE-504.6 — the violation message NAMES the fired source and its
//                  concrete evidence, and offers `none` as a legitimate answer.
//
// Plus the house bookkeeping a new probe owes: `## Verification` is read
// through `readVerificationConfig` and never re-parsed privately; the module
// routes managed-ness through `./toolkit_managed` and is vacuous on a tree the
// toolkit does not own; and the gate-check SKILL.md registration is itself
// falsifiable (contiguous 1..81).

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// Modules not yet present — these imports drive the RED state.
import {
  PROBE_ID,
  runRunnabilityDeclaredProbe,
} from "../adapters/_shared/src/runnability_declared";
import { detectRunnability } from "../adapters/_shared/src/detect_runnability";

const pluginRoot = join(import.meta.dir, "..");
const repoRoot = join(pluginRoot, "..", "..");
const gateCheckSkillMd = join(pluginRoot, "skills", "gate-check", "SKILL.md");
const probeModulePath = join(
  pluginRoot,
  "adapters",
  "_shared",
  "src",
  "runnability_declared.ts",
);

// ─────────────────────────────────────────────────────────────────────────────
// Fixture helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a throwaway project root containing exactly `files`, hand it to `fn`,
 * and tear it down only after `fn` has RESOLVED — the probe is async, so a
 * synchronous `finally` would delete the fixture out from under it.
 */
async function withFixture<T>(
  files: Record<string, string>,
  fn: (root: string) => Promise<T>,
): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), "ste504-probe-"));
  try {
    for (const [rel, body] of Object.entries(files)) {
      const abs = join(root, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, body, "utf-8");
    }
    return await fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * A CLAUDE.md that the shared predicate recognizes as toolkit-managed (via a
 * real `## Task Tracking` heading), carrying an optional `## Verification`
 * section. None of the headings used here are in the run-heading closed set,
 * so this file never makes detection fire on its own.
 */
function managedClaudeMd(verification?: string): string {
  const parts = ["# Fixture", "", "## Task Tracking", "", "mode: none", ""];
  if (verification !== undefined) parts.push("## Verification", "", verification, "");
  return parts.join("\n");
}

/** `package.json` carrying a `dev` script — one firing source, nothing else. */
const PKG_DEV = JSON.stringify({ name: "fx", scripts: { dev: "vite dev --port 4321" } }, null, 2);
const MAKEFILE_RUN = ".PHONY: run\n\nrun:\n\tnode server.js\n";

// ─────────────────────────────────────────────────────────────────────────────
// AC-STE-504.3 — detection fires + `run_cmd` absent ⇒ one error violation
// ─────────────────────────────────────────────────────────────────────────────

describe("AC-STE-504.3 — the probe fails when detection fires and run_cmd is undeclared", () => {
  test("exactly one violation, severity error, non-vacuous", async () => {
    await withFixture(
      { "package.json": PKG_DEV, "CLAUDE.md": managedClaudeMd() },
      async (root) => {
        const report = await runRunnabilityDeclaredProbe(root);
        expect(report.vacuous).toBe(false);
        expect(report.violations).toHaveLength(1);
        expect(report.violations[0]!.severity).toBe("error");
      },
    );
  });

  test("the note is in the documented `file:line — reason` shape", async () => {
    await withFixture(
      { "package.json": PKG_DEV, "CLAUDE.md": managedClaudeMd() },
      async (root) => {
        const { note } = (await runRunnabilityDeclaredProbe(root)).violations[0]!;
        expect(note).toMatch(/^CLAUDE\.md:\d+ — \S/);
      },
    );
  });

  test("the message follows the NFR-10 canonical shape", async () => {
    await withFixture(
      { "package.json": PKG_DEV, "CLAUDE.md": managedClaudeMd() },
      async (root) => {
        const { message, note } = (await runRunnabilityDeclaredProbe(root)).violations[0]!;
        const lines = message.split("\n");
        expect(lines[0]).toBe(`${PROBE_ID}: ${note}`);
        expect(message).toContain("\nRemedy: ");
        expect(message).toContain("\nContext: ");
        expect(message).toContain(`probe=${PROBE_ID}`);
        expect(message).toContain("severity=error");
      },
    );
  });

  test("a `## Verification` section that declares other keys but not run_cmd still fires", async () => {
    await withFixture(
      {
        "package.json": PKG_DEV,
        "CLAUDE.md": managedClaudeMd("verify_mode: advisory\ne2e_cmd: none"),
      },
      async (root) => {
        expect((await runRunnabilityDeclaredProbe(root)).violations).toHaveLength(1);
      },
    );
  });

  test("one violation, not one per fired source", async () => {
    await withFixture(
      {
        "package.json": PKG_DEV,
        Makefile: MAKEFILE_RUN,
        "README.md": "# fx\n\n## Running\n",
        "CLAUDE.md": `${managedClaudeMd()}\n## Development\n`,
      },
      async (root) => {
        expect(detectRunnability(root).sources.length).toBe(4);
        expect((await runRunnabilityDeclaredProbe(root)).violations).toHaveLength(1);
      },
    );
  });

  test("each of the four sources on its own is enough to fire the probe", async () => {
    const cases: Record<string, Record<string, string>> = {
      package_json_script: { "package.json": PKG_DEV, "CLAUDE.md": managedClaudeMd() },
      makefile_run_target: { Makefile: MAKEFILE_RUN, "CLAUDE.md": managedClaudeMd() },
      readme_run_heading: {
        "README.md": "# fx\n\n## Getting Started\n",
        "CLAUDE.md": managedClaudeMd(),
      },
      claude_md_run_block: { "CLAUDE.md": `${managedClaudeMd()}\n## Development\n` },
    };
    for (const [id, files] of Object.entries(cases)) {
      await withFixture(files, async (root) => {
        const report = await runRunnabilityDeclaredProbe(root);
        expect(detectRunnability(root).sources.map((s) => s.source)).toEqual([id]);
        expect(report.violations).toHaveLength(1);
      });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-STE-504.4 — silent when detection does not fire, silent when declared
// ─────────────────────────────────────────────────────────────────────────────

describe("AC-STE-504.4 — the probe is silent when detection does not fire", () => {
  test("a managed tree with no run instructions and no run_cmd is silent", async () => {
    await withFixture({ "CLAUDE.md": managedClaudeMd() }, async (root) => {
      expect(detectRunnability(root).runnable).toBe(false);
      const report = await runRunnabilityDeclaredProbe(root);
      expect(report.violations).toEqual([]);
    });
  });

  test("silent whatever run_cmd says, when detection did not fire", async () => {
    for (const verification of [undefined, "run_cmd: none", "run_cmd: bun dev"]) {
      await withFixture(
        {
          "package.json": '{"scripts":{"build":"tsc"}}',
          "README.md": "# fx\n\n## Running the test suite\n",
          "CLAUDE.md": managedClaudeMd(verification),
        },
        async (root) => {
          expect(detectRunnability(root).sources).toEqual([]);
          expect((await runRunnabilityDeclaredProbe(root)).violations).toEqual([]);
        },
      );
    }
  });

  test("this repository's own root is clean (detection does not fire here)", async () => {
    expect(detectRunnability(repoRoot).runnable).toBe(false);
    const report = await runRunnabilityDeclaredProbe(repoRoot);
    expect(report.violations).toEqual([]);
  });
});

describe("AC-STE-504.4 — the probe is silent when run_cmd is declared", () => {
  test("a real command silences it", async () => {
    await withFixture(
      { "package.json": PKG_DEV, "CLAUDE.md": managedClaudeMd("run_cmd: bun run dev") },
      async (root) => {
        expect(detectRunnability(root).runnable).toBe(true);
        expect((await runRunnabilityDeclaredProbe(root)).violations).toEqual([]);
      },
    );
  });

  // Asserted explicitly and separately: `none` is an ANSWER ("this project
  // cannot be run"), distinct from an absent key, which is no answer at all.
  test("`run_cmd: none` silences it — none is an answer, not an omission", async () => {
    await withFixture(
      { "package.json": PKG_DEV, "CLAUDE.md": managedClaudeMd("run_cmd: none") },
      async (root) => {
        expect(detectRunnability(root).runnable).toBe(true);
        expect((await runRunnabilityDeclaredProbe(root)).violations).toEqual([]);
      },
    );
  });

  test("`none` and absent are genuinely different verdicts on the same tree", async () => {
    const files = { "package.json": PKG_DEV };
    const absent = await withFixture(
      { ...files, "CLAUDE.md": managedClaudeMd() },
      async (root) => (await runRunnabilityDeclaredProbe(root)).violations.length,
    );
    const none = await withFixture(
      { ...files, "CLAUDE.md": managedClaudeMd("run_cmd: none") },
      async (root) => (await runRunnabilityDeclaredProbe(root)).violations.length,
    );
    expect(absent).toBe(1);
    expect(none).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-STE-504.3 — a bare `run_cmd:` with an EMPTY value is not an answer
//
// `readVerificationConfig` parses `run_cmd:` (no value) to the empty string,
// and an emptiness-blind `!== null` guard reads that as "declared" and falls
// silent. That is a CHEAPER reflex-silence than typing `none`: the author
// deletes four characters, detection still fires, and the gate stays green —
// exactly the "contract everyone silences" failure AC-STE-504.6 exists to
// prevent, reached without even reading the question.
//
// `none` is an answer. An absent key is no answer. An EMPTY key is no answer
// either, and must be treated as the absent key is.
//
// The discrimination is asserted in all three directions in ONE place so no
// future edit can collapse them into each other.
//
// (Nothing is asserted about `e2e_cmd` here: `runnability_declared` reads only
// `runCmd` from the config — it never consults `e2eCmd` — so an e2e clause
// would be inventing a requirement this probe does not have.)
// ─────────────────────────────────────────────────────────────────────────────

describe("AC-STE-504.3 — an empty `run_cmd:` value is an omission, not a declaration", () => {
  /** Violation count for one `## Verification` body against a firing tree. */
  async function violationsFor(verification: string | undefined): Promise<number> {
    return await withFixture(
      { "package.json": PKG_DEV, "CLAUDE.md": managedClaudeMd(verification) },
      async (root) => {
        // Precondition: detection really did fire, so a zero count below means
        // "the probe fell silent", never "there was nothing to report".
        expect(detectRunnability(root).runnable).toBe(true);
        return (await runRunnabilityDeclaredProbe(root)).violations.length;
      },
    );
  }

  test("empty fires, `none` is silent, a real command is silent — all three at once", async () => {
    expect(await violationsFor("run_cmd:")).toBe(1);
    expect(await violationsFor("run_cmd: none")).toBe(0);
    expect(await violationsFor("run_cmd: bun run dev")).toBe(0);
  });

  test("a whitespace-only value is empty too", async () => {
    expect(await violationsFor("run_cmd:   ")).toBe(1);
  });

  test("the empty case is indistinguishable from the absent case in its verdict", async () => {
    expect(await violationsFor(undefined)).toBe(1);
    expect(await violationsFor("run_cmd:")).toBe(1);
  });

  test("the empty-value violation carries the same message shape as the absent-key case", async () => {
    const violationFor = async (verification: string | undefined) =>
      await withFixture(
        { "package.json": PKG_DEV, "CLAUDE.md": managedClaudeMd(verification) },
        async (root) => (await runRunnabilityDeclaredProbe(root)).violations[0]!,
      );

    const absent = await violationFor(undefined);
    const empty = await violationFor("run_cmd:");

    // The reason is position-independent, so the two cases must agree on it
    // exactly — same fired source, same evidence, same wording.
    expect(empty.reason).toBe(absent.reason);
    expect(empty.severity).toBe("error");
    expect(empty.note).toMatch(/^CLAUDE\.md:\d+ — \S/);
    expect(empty.message.split("\n")[0]).toBe(`${PROBE_ID}: ${empty.note}`);
    expect(empty.message).toContain("\nRemedy: ");
    expect(empty.message).toContain("\nContext: ");
    expect(empty.message).toContain("package_json_script");
    expect(empty.message).toMatch(/`none`/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-STE-504.6 — the message names WHICH source fired
// ─────────────────────────────────────────────────────────────────────────────

describe("AC-STE-504.6 — the violation names the fired source and offers `none`", () => {
  test("the message carries the source id and its concrete evidence", async () => {
    await withFixture(
      { "package.json": PKG_DEV, "CLAUDE.md": managedClaudeMd() },
      async (root) => {
        const [fired] = detectRunnability(root).sources;
        const { message } = (await runRunnabilityDeclaredProbe(root)).violations[0]!;
        expect(message).toContain(fired!.source);
        // Evidence, not merely the id: "declare run_cmd" teaches nothing;
        // "package.json declares a `dev` script" lets the author answer in one
        // step (FR ## Technical Design).
        expect(message).toContain(fired!.evidence);
      },
    );
  });

  // A message that names only the FIRST fired source passes the single-source
  // test and fails here — which is the point of asserting on a two-source tree.
  test("with two sources fired, BOTH evidences appear in the message", async () => {
    await withFixture(
      { "package.json": PKG_DEV, Makefile: MAKEFILE_RUN, "CLAUDE.md": managedClaudeMd() },
      async (root) => {
        const sources = detectRunnability(root).sources;
        expect(sources).toHaveLength(2);
        const { message } = (await runRunnabilityDeclaredProbe(root)).violations[0]!;
        for (const s of sources) {
          expect(message).toContain(s.source);
          expect(message).toContain(s.evidence);
        }
      },
    );
  });

  test("the remedy offers `none` as a legitimate answer, not just 'declare run_cmd'", async () => {
    await withFixture(
      { "package.json": PKG_DEV, "CLAUDE.md": managedClaudeMd() },
      async (root) => {
        const { message } = (await runRunnabilityDeclaredProbe(root)).violations[0]!;
        const remedy = message.slice(message.indexOf("\nRemedy: "));
        expect(remedy).toContain("run_cmd");
        expect(remedy).toMatch(/`none`/);
        expect(remedy).toContain("## Verification");
      },
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// House constraints: shared readers, and vacuity on an unmanaged tree
// ─────────────────────────────────────────────────────────────────────────────

describe("the probe reads run_cmd through readVerificationConfig, never a private re-parse", () => {
  test("the module imports readVerificationConfig from ./verification_config", () => {
    const body = readFileSync(probeModulePath, "utf-8");
    expect(body).toMatch(/from\s+["']\.\/verification_config(?:\.[jt]s)?["']/);
    expect(body).toContain("readVerificationConfig");
  });

  // Behavioural half: a `run_cmd:` line OUTSIDE the `## Verification` section
  // is not a declaration. `readVerificationConfig` knows that; a bare grep for
  // `run_cmd:` would not, and would silence the probe here.
  test("a run_cmd line outside the ## Verification section does not count as declared", async () => {
    await withFixture(
      {
        "package.json": PKG_DEV,
        "CLAUDE.md": [
          "# Fixture",
          "",
          "## Task Tracking",
          "",
          "mode: none",
          "",
          "## Docs",
          "",
          "run_cmd: bun run dev",
          "",
        ].join("\n"),
      },
      async (root) => {
        expect((await runRunnabilityDeclaredProbe(root)).violations).toHaveLength(1);
      },
    );
  });
});

describe("probe #74 — the probe routes managed-ness through ./toolkit_managed", () => {
  test("the module imports the shared predicate", () => {
    const body = readFileSync(probeModulePath, "utf-8");
    expect(body).toMatch(/from\s+["']\.\/toolkit_managed(?:\.[jt]s)?["']/);
  });

  test("vacuous on a tree with no CLAUDE.md at all, even when detection would fire", async () => {
    await withFixture({ "package.json": PKG_DEV, Makefile: MAKEFILE_RUN }, async (root) => {
      expect(detectRunnability(root).runnable).toBe(true);
      const report = await runRunnabilityDeclaredProbe(root);
      expect(report.vacuous).toBe(true);
      expect(report.violations).toEqual([]);
    });
  });

  // A repo the toolkit does not own must never be nagged about a key it has
  // never heard of.
  test("vacuous on a hand-written CLAUDE.md carrying no managed signal", async () => {
    await withFixture(
      {
        "package.json": PKG_DEV,
        "CLAUDE.md": "# My project\n\nSome hand-written guidance for Claude.\n",
      },
      async (root) => {
        const report = await runRunnabilityDeclaredProbe(root);
        expect(report.vacuous).toBe(true);
        expect(report.violations).toEqual([]);
      },
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Registration — gate-check SKILL.md row #80 (meta-test)
// ─────────────────────────────────────────────────────────────────────────────

describe("gate-check SKILL.md registers probe #80 runnability_declared", () => {
  const gateCheckSkill = (): string => readFileSync(gateCheckSkillMd, "utf-8");

  test("PROBE_ID is the registered slug", () => {
    expect(PROBE_ID).toBe("runnability_declared");
  });

  test("row #80 exists, numbered, named runnability_declared", () => {
    expect(gateCheckSkill()).toMatch(/^80\.\s+\*\*`runnability_declared`\*\*/m);
  });

  test("the row names the runner, the module path, error severity, and this test file", () => {
    const body = gateCheckSkill();
    const idx = body.indexOf("`runnability_declared`");
    expect(idx).toBeGreaterThan(-1);
    const block = body.slice(idx, idx + 2500);
    expect(block).toContain("runRunnabilityDeclaredProbe(projectRoot)");
    expect(block).toContain("adapters/_shared/src/runnability_declared.ts");
    expect(block).toContain("**Severity: error**");
    expect(block).toContain("tests/gate-check-runnability-declared.test.ts");
  });

  // The registration sweep is itself falsifiable: a probe added to the prose
  // without renumbering, or renumbered without being added, fails here.
  test("the numbered probe list is contiguous 1..81", () => {
    // Recalibrated 80 → 81: M133 adds #81 module_reachability.
    const numbers = [...gateCheckSkill().matchAll(/^(\d+)\. \*\*/gm)].map((m) => Number(m[1]));
    expect(numbers.length).toBe(81);
    expect([...numbers].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 81 }, (_, i) => i + 1),
    );
    expect(Math.max(...numbers)).toBe(81);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Regression — a project bootstrapped from the SHIPPED template is not asked
//
// The detector's fence-blindness (fixed under AC-STE-504.5, covered in
// tests/m131-ste-504-runnability.test.ts) reaches the author through THIS
// probe, and this is where the damage is: `templates/CLAUDE.md.template` carries
//
//     ```bash
//     # Development
//
// under `## Key Commands`, and the template's first line is the `/setup`
// generation marker — so a freshly bootstrapped project is TOOLKIT-MANAGED,
// detection fires on a shell comment, no `run_cmd` exists yet, and probe #80
// reds every single new project on day one. That is the FR's own ## Notes
// arriving verbatim: a probe that reds a repo it should never have asked
// teaches the author to write `run_cmd: none` without reading the question.
//
// Asserted against the REAL shipped bytes, not a paraphrase — a hand-written
// fixture would drift from the template and stop protecting it.
// ─────────────────────────────────────────────────────────────────────────────

const shippedClaudeMdTemplate = join(pluginRoot, "templates", "CLAUDE.md.template");

describe("regression — the shipped CLAUDE.md template does not trip probe #80", () => {
  test("the template still carries the fenced `# Development` comment that caused this", () => {
    const body = readFileSync(shippedClaudeMdTemplate, "utf-8").replace(/\r\n/g, "\n");
    expect(body).toContain("```bash\n# Development\n");
  });

  test("a tree bootstrapped from the shipped template is silent, and NOT vacuous", async () => {
    const body = readFileSync(shippedClaudeMdTemplate, "utf-8");
    await withFixture({ "CLAUDE.md": body }, async (root) => {
      // Vacuity would be a false green: the template IS managed (its first line
      // is the /setup marker), so the probe must really run here and still say
      // nothing. Pin both halves.
      const result = await runRunnabilityDeclaredProbe(root);
      expect(result.vacuous).toBe(false);
      expect(result.violations).toEqual([]);
      // ...and the detector underneath agrees, so the silence is not the probe
      // swallowing a firing detection.
      expect(detectRunnability(root).runnable).toBe(false);
    });
  });

  test("the twin: a REAL run heading in that same tree does fire", async () => {
    // Proves the silence above comes from fence-awareness, not from a probe or
    // detector that gave up on the shipped template's bytes.
    const body = readFileSync(shippedClaudeMdTemplate, "utf-8") + "\n## Running\n\nnpm run dev\n";
    await withFixture({ "CLAUDE.md": body }, async (root) => {
      const result = await runRunnabilityDeclaredProbe(root);
      expect(result.vacuous).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]!.severity).toBe("error");
      expect(result.violations[0]!.reason).toContain("claude_md_run_block");
      expect(result.violations[0]!.reason).toContain("## Running");
    });
  });

  test("PROBE_ID is the probe these regressions are about", () => {
    expect(PROBE_ID).toBe("runnability_declared");
  });
});
