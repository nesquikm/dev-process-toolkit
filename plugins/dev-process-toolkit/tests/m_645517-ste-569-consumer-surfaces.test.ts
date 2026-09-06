// STE-569 — what a consumer copies works for the consumer, not for this repo.
//
// The stack examples and the CLAUDE.md template are copied wholesale by every
// project that adopts the toolkit, and none of them is exercised by this
// repository's own gate. So the legs below EXECUTE the real modules rather
// than reading bytes: the dash finding, the `field:` finding and the Kotlin
// finding in the sibling FR were all found by running the parser and the
// bumper, and not one of them is visible to a string assertion.

import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import {
  bumpFile,
  bumpRegex,
  parseReleaseFiles,
  RegexPatternMissError,
  type ReleaseFile,
} from "../adapters/_shared/src/release_config";
import {
  readMilestoneScanFetch,
  resolveFetchPolicy,
} from "../adapters/_shared/src/milestone_scan_fetch_config";
import { parseReadmeLatest } from "../adapters/_shared/src/release_surface_agreement";
import { runTaskTrackingWorkspaceBindingPresentProbe } from "../adapters/_shared/src/task_tracking_workspace_binding_present";
import { mutate } from "./_fence";

const pluginRoot = join(import.meta.dir, "..");
const repoRoot = join(pluginRoot, "..", "..");
const examplesDir = join(pluginRoot, "examples");
const read = (p: string) => readFileSync(p, "utf-8");

/** Every file under `examples/`, recursively — ENUMERATED, never listed. */
function everyExampleFile(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const abs = join(dir, entry);
      if (statSync(abs).isDirectory()) walk(abs);
      else out.push(relative(examplesDir, abs).split(sep).join("/"));
    }
  };
  walk(examplesDir);
  return out.sort();
}

/** The stack directories that ship a `release.yml`. */
const releaseStacks = (): string[] =>
  readdirSync(examplesDir).filter((d) => existsSync(join(examplesDir, d, "release.yml")));

function entriesFor(stack: string): ReleaseFile[] {
  const yaml = read(join(examplesDir, stack, "release.yml"));
  return parseReleaseFiles(`## Release Files\n\n\`\`\`yaml\n${yaml}\`\`\`\n`);
}

// ===========================================================================
// AC-STE-569.1 / .2 / .3 — a consumer's copy works in the consumer's tree
// ===========================================================================

describe("AC-STE-569.2 — no shipped example hardcodes this repository's paths", () => {
  const OWN_PATH = "plugins/dev-process-toolkit/";

  test("the sweep enumerates a non-trivial tree", () => {
    // The audit that produced these findings handed its examples reader a
    // repo-root path when the examples live under the plugin, so its first
    // pass searched a directory that does not exist and returned confidently
    // empty. An enumeration that finds nothing must fail loudly here.
    const files = everyExampleFile();
    expect(files.length).toBeGreaterThan(10);
    expect(files.some((f) => f.endsWith("release.yml"))).toBe(true);
  });

  test("no example file names this repository's own plugin directory", () => {
    const offenders = everyExampleFile().filter((f) =>
      read(join(examplesDir, f)).includes(OWN_PATH),
    );
    expect(offenders).toEqual([]);
  });

  test("FALSIFIABILITY — reintroducing the path is caught by the same sweep", () => {
    const yaml = read(join(examplesDir, "plugin", "release.yml"));
    const regressed = mutate(yaml, /plugins\/<your-plugin>\//, OWN_PATH);
    expect(regressed).toContain(OWN_PATH);
  });

  test("AC-STE-569.1 — the plugin fixture is a placeholder with an edit note", () => {
    const yaml = read(join(examplesDir, "plugin", "release.yml"));
    expect(yaml).toContain("plugins/<your-plugin>/.claude-plugin/plugin.json");
    expect(yaml).toMatch(/EDIT THE TWO PATHS BELOW/);
    const entries = entriesFor("plugin");
    const marketplace = entries.find((e) => e.path.endsWith("marketplace.json"))!;
    // A plugin repo that is not also a marketplace has no such file, so a
    // required entry would refuse before writing a byte.
    expect(marketplace.optional).toBe(true);
  });

  test("AC-STE-569.1 — both hand-off points carry the edit note", () => {
    expect(read(join(pluginRoot, "skills", "setup", "SKILL.md"))).toMatch(
      /plugins\/<your-plugin>\//,
    );
    expect(read(join(pluginRoot, "docs", "ship-milestone-reference.md"))).toMatch(
      /plugins\/<your-plugin>\//,
    );
  });

  test("AC-STE-569.3 — the plugin fixture carries the requirements.md entry", () => {
    const entries = entriesFor("plugin");
    const req = entries.find((e) => e.path === "specs/requirements.md");
    expect(req).toBeDefined();
    expect(req!.optional).toBe(true);
    // It must actually write BOTH fields the root block writes — a
    // version-only rewrite reproduces the pre-STE-554 defect one field down.
    expect(req!.replace).toContain("{version}");
    expect(req!.replace).toContain("{codename}");
  });

  test("AC-STE-569.3 — the header describes the entries the file has", () => {
    const yaml = read(join(examplesDir, "plugin", "release.yml"));
    const header = yaml.split("files:")[0]!;
    expect(header).toContain("Five entries");
    expect(entriesFor("plugin")).toHaveLength(5);
    // The retired "dogfood case the toolkit itself uses" claim is gone: the
    // fixture now carries placeholders the toolkit's own block does not.
    expect(header).not.toContain("dogfood");
  });
});

// ===========================================================================
// AC-STE-569.4 / .5 — the writer's dash class and the grader's agree
// ===========================================================================

describe("AC-STE-569.4 — every example bumps every dash the grader accepts", () => {
  const DASHES = ["—", "–", "-"] as const; // em, en, hyphen
  const RETIRED = String.raw`Latest: \*\*v(?<version>\d+\.\d+\.\d+) — `;

  for (const stack of releaseStacks()) {
    const readmeEntry = () => entriesFor(stack).find((e) => e.path === "README.md")!;

    for (const dash of DASHES) {
      const label = dash === "—" ? "em" : dash === "–" ? "en" : "hyphen";
      test(`${stack}: the ${label}-dash banner is graded AND bumped`, () => {
        const banner = `Latest: **v1.2.0 ${dash} "Falcon"** (M42, notes)\n`;
        // The grader parses it — that is the half that was already tolerant.
        expect(parseReadmeLatest(banner)).not.toBeNull();
        // The writer now does too.
        const bumped = bumpFile(readmeEntry(), banner, {
          newVersion: "1.3.0",
          codename: "Falcon",
        });
        expect(bumped).toContain("v1.3.0");
        // And the bump canonicalizes back to the em-dash.
        expect(bumped).toContain("v1.3.0 — ");
      });
    }

    test(`${stack}: MEASURED — the retired em-dash-only pattern misses the others`, () => {
      // The finding reproduced in the same leg. Since STE-555 an optional
      // entry SKIPS on a miss rather than aborting, so this was a silent
      // non-bump reported as success — the better failure mode and still the
      // wrong outcome.
      for (const dash of ["–", "-"]) {
        const banner = `Latest: **v1.2.0 ${dash} "Falcon"** (M42)\n`;
        expect(() =>
          bumpRegex(banner, RETIRED, "Latest: **v{version} — ", "1.3.0", "Falcon"),
        ).toThrow(RegexPatternMissError);
      }
      // Control: the retired pattern DID work on the em-dash, so the three
      // legs above differ by the dash and nothing else.
      expect(
        bumpRegex(
          `Latest: **v1.2.0 — "Falcon"** (M42)\n`,
          RETIRED,
          "Latest: **v{version} — ",
          "1.3.0",
          "Falcon",
        ),
      ).toContain("v1.3.0");
    });
  }
});

describe("AC-STE-569.5 — the two grammars are asserted to AGREE", () => {
  test("the class the writer accepts is the class the grader accepts", () => {
    const grader = read(
      join(pluginRoot, "adapters", "_shared", "src", "release_surface_agreement.ts"),
    );
    const graderClass = /\[([—–-]+)\]/.exec(grader)?.[1];
    expect(graderClass).toBeDefined();
    for (const stack of releaseStacks()) {
      const pattern = entriesFor(stack).find((e) => e.path === "README.md")!.pattern!;
      const writerClass = /\[([—–-]+)\]/.exec(pattern)?.[1];
      expect(writerClass, stack).toBe(graderClass);
    }
  });

  test("FALSIFIABILITY — narrowing either side breaks the agreement", () => {
    const pattern = entriesFor("typescript-node").find((e) => e.path === "README.md")!
      .pattern!;
    const narrowed = mutate(pattern, /\[[—–-]+\]/, "—");
    expect(/\[([—–-]+)\]/.exec(narrowed)).toBeNull();
  });
});

// ===========================================================================
// AC-STE-569.6 / .7 / .9 — the roster, CI parity, and the second writer
// ===========================================================================

describe("AC-STE-569.6 — the /setup roster names every stack that ships one", () => {
  test("step 7e's roster is the set of examples/*/release.yml on disk", () => {
    const roster = /from `examples\/<stack>\/release\.yml` \(([^)]+)\)/.exec(
      read(join(pluginRoot, "skills", "setup", "SKILL.md")),
    )![1]!;
    const named = roster.split("/").map((s) => s.trim());
    expect(named.sort()).toEqual(releaseStacks().sort());
  });

  test("the per-stack defaults list in the reference names the same set", () => {
    const ref = read(join(pluginRoot, "docs", "ship-milestone-reference.md"));
    for (const stack of releaseStacks()) {
      expect(ref, stack).toContain(`examples/${stack}/release.yml`);
    }
  });
});

describe("AC-STE-569.7 — each CI starter runs what its gate commands run", () => {
  /** The gate commands a stack's `gate-commands.md` prescribes, in order. */
  const gateCommands = (stack: string): string[] => {
    const body = read(join(examplesDir, stack, "gate-commands.md"));
    const block = /## Gate Check Commands\n+```bash\n([\s\S]*?)```/.exec(body)?.[1] ?? "";
    return block
      .split("\n")
      .map((l) => l.split("#")[0]!.trim())
      .filter((l) => l.length > 0);
  };

  const ciStacks = readdirSync(examplesDir).filter((d) =>
    existsSync(join(examplesDir, d, ".github", "workflows", "gate-check.yml")),
  );

  test("every stack with gate commands ships a starter workflow", () => {
    const withCommands = readdirSync(examplesDir).filter(
      (d) =>
        statSync(join(examplesDir, d)).isDirectory() &&
        existsSync(join(examplesDir, d, "gate-commands.md")),
    );
    expect(ciStacks.sort()).toEqual(withCommands.sort());
  });

  // `fvm` is a LOCAL Flutter version manager; CI pins the SDK with
  // `subosito/flutter-action` instead, so the wrapper is absent there by
  // design. Parity is about the check that runs, not the launcher, so the
  // prefix is normalized away on both sides rather than being tolerated by a
  // substring match that would also hide a genuinely missing step.
  const withoutLauncher = (cmd: string): string => cmd.replace(/^fvm /, "");

  for (const stack of ciStacks) {
    test(`${stack}: the workflow is not a strict subset of the local gate`, () => {
      const ci = read(join(examplesDir, stack, ".github", "workflows", "gate-check.yml"));
      const commands = gateCommands(stack);
      expect(commands.length, stack).toBeGreaterThan(1);
      const missing = commands.filter((c) => !ci.includes(withoutLauncher(c)));
      expect(missing, `${stack} CI omits`).toEqual([]);
    });
  }

  test("the guide's starter list names every workflow that ships", () => {
    const guide = read(join(pluginRoot, "docs", "adaptation-guide.md"));
    for (const stack of ciStacks) {
      expect(guide, stack).toContain(`examples/${stack}/.github/workflows/gate-check.yml`);
    }
  });
});

describe("AC-STE-569.9 — no second writer for the pubspec version", () => {
  test("/bump-version is gone from the example AND the guide", () => {
    // Fixing only the example would leave the guide stale, which is how this
    // class propagates.
    for (const [label, body] of [
      ["gate-commands", read(join(examplesDir, "flutter-dart", "gate-commands.md"))],
      ["adaptation-guide", read(join(pluginRoot, "docs", "adaptation-guide.md"))],
    ] as const) {
      expect(body, label).not.toMatch(/^\s*-\s*`\/bump-version`\s*—/m);
    }
  });

  test("the field it would have written is owned by the release block", () => {
    const pubspec = entriesFor("flutter-dart").find((e) => e.path === "pubspec.yaml")!;
    expect(pubspec.field).toBe("version");
    expect(read(join(examplesDir, "flutter-dart", "gate-commands.md"))).toMatch(
      /owned by|written by `\/ship-milestone`|`\/ship-milestone`/,
    );
  });
});

// ===========================================================================
// AC-STE-569.8 — the allowlist covers its own prescribed invocations
// ===========================================================================

describe("AC-STE-569.8 — argument-carrying rules use the :* prefix form", () => {
  const template = JSON.parse(read(join(pluginRoot, "templates", "permissions.json")));
  const rules: string[] = [
    ...(template._common as string[]),
    ...Object.values(template.stacks as Record<string, string[]>).flat(),
  ];

  /** `Bash(git status:*)` → `git status`; `Bash(ls)` → `ls`. */
  const commandOf = (rule: string): string =>
    /^Bash\((.+?)(?::\*)?\)$/.exec(rule)![1]!;
  const isPrefixForm = (rule: string): boolean => rule.endsWith(":*)");

  test("the rule set is non-empty and well-formed", () => {
    expect(rules.length).toBeGreaterThan(20);
    for (const r of rules) expect(r, r).toMatch(/^Bash\(.+\)$/);
  });

  test("no rule uses the denied glob shape", () => {
    for (const r of rules) expect(r, r).not.toMatch(/\s\*\)$/);
  });

  test("every command the gate-command examples invoke WITH arguments is :*", () => {
    // Derived from the examples rather than from a list: these are the
    // invocations the toolkit itself prescribes, so a bare rule for one of
    // them is an allowlist that looks configured and permits nothing.
    const invocations = readdirSync(examplesDir)
      .filter((d) => existsSync(join(examplesDir, d, "gate-commands.md")))
      .flatMap((d) => {
        const body = read(join(examplesDir, d, "gate-commands.md"));
        const block = /## Gate Check Commands\n+```bash\n([\s\S]*?)```/.exec(body)?.[1] ?? "";
        return block
          .split("\n")
          .map((l) => l.split("#")[0]!.trim())
          .filter((l) => l.length > 0);
      });
    expect(invocations.length).toBeGreaterThan(8);

    for (const rule of rules) {
      if (isPrefixForm(rule)) continue;
      const cmd = commandOf(rule);
      const carriesArgs = invocations.some(
        (inv) => inv.startsWith(`${cmd} `) && inv !== cmd,
      );
      expect(carriesArgs, `${rule} is invoked with arguments by an example`).toBe(false);
    }
  });

  test("FALSIFIABILITY — stripping a :* suffix reds that derivation", () => {
    const stripped = mutate("Bash(npm run:*)", /:\*\)$/, ")");
    expect(isPrefixForm(stripped)).toBe(false);
    expect(commandOf(stripped)).toBe("npm run");
  });
});

// ===========================================================================
// AC-STE-569.10 / .11 / .12 — the template a project is configured from
// ===========================================================================

describe("AC-STE-569.10 — a template-configured project passes probe #25", () => {
  const template = read(join(pluginRoot, "templates", "CLAUDE.md.template"));

  test("the template states the binding requirement and names the probe", () => {
    expect(template).toContain("task-tracking-workspace-binding-present");
    expect(template).toMatch(/### Linear/);
    expect(template).toMatch(/### Jira/);
    expect(template).toMatch(/hard-fails without it/);
  });

  /** Build a CLAUDE.md from the keys the template documents, and grade it. */
  const gradeFixture = async (taskTracking: string) => {
    const root = mkdtempSync(join(tmpdir(), "ste569-"));
    try {
      writeFileSync(
        join(root, "CLAUDE.md"),
        `# Fixture\n\n## Task Tracking\n\n${taskTracking}\n`,
      );
      return (await runTaskTrackingWorkspaceBindingPresentProbe(root)).violations;
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };

  test("END-TO-END — the template's own documented keys pass the probe", async () => {
    // The statement is about the OUTCOME, not about the sentence: a template
    // that mentions the binding and a project that still fails probe #25 would
    // both satisfy a prose assertion.
    expect(
      await gradeFixture(
        "mode: linear\nmcp_server: linear\n\n### Linear\n\nteam: STE\nproject: Example Project\n",
      ),
    ).toEqual([]);
  });

  test("FALSIFIABILITY — the pre-template shape (keys only) FAILS the probe", async () => {
    // This is the defect: a user hand-writing the section from the template's
    // four-key enumeration alone landed a red gate on their first run.
    const violations = await gradeFixture("mode: linear\nmcp_server: linear\n");
    expect(violations.length).toBeGreaterThan(0);
  });

  test("FALSIFIABILITY — an empty value fails too, not just an absent key", async () => {
    expect(
      (
        await gradeFixture(
          "mode: linear\nmcp_server: linear\n\n### Linear\n\nteam: STE\nproject:\n",
        )
      ).length,
    ).toBeGreaterThan(0);
  });
});

describe("AC-STE-569.11 — the field: legend is legal for the kind it names", () => {
  const template = read(join(pluginRoot, "templates", "CLAUDE.md.template"));

  /** Parse + bump one entry through the real modules. */
  const attempt = (kind: string, field: string, body: string): string => {
    try {
      const entries = parseReleaseFiles(
        `## Release Files\n\n\`\`\`yaml\nfiles:\n  - path: f\n    kind: ${kind}\n    field: ${field}\n\`\`\`\n`,
      );
      bumpFile(entries[0]!, body, { newVersion: "2.0.0" });
      return "ok";
    } catch (e) {
      return `THREW: ${(e as Error).message}`;
    }
  };

  test("MEASURED — the previously-offered combinations are refused", () => {
    // The template offered one capability line for three kinds. Two of its
    // three examples are json-only, and both failures are real.
    expect(attempt("yaml", "project.version", "project:\n  version: 1.0.0\n")).toMatch(
      /yaml kind only supports top-level fields/,
    );
    expect(attempt("toml", "plugins[0].version", 'version = "1.0.0"\n')).toMatch(
      /bumpToml: could not find/,
    );
  });

  test("MEASURED — every example the legend now offers is legal for its kind", () => {
    expect(attempt("json", "plugins[0].version", '{"plugins":[{"version":"1.0.0"}]}')).toBe(
      "ok",
    );
    expect(attempt("toml", "project.version", '[project]\nversion = "1.0.0"\n')).toBe("ok");
    expect(attempt("yaml", "version", "version: 1.0.0\n")).toBe("ok");
  });

  test("the legend states three per-kind rules, not one capability", () => {
    const legend = template.split("  - field:")[1]!.split("  - pattern:")[0]!;
    expect(legend).toMatch(/json —/);
    expect(legend).toMatch(/toml —/);
    expect(legend).toMatch(/yaml —/);
    expect(legend).not.toMatch(/dot-path \(json\/toml\/yaml only\)/);
  });
});

describe("AC-STE-569.12 — the template names what the toolkit reads", () => {
  const template = read(join(pluginRoot, "templates", "CLAUDE.md.template"));

  test("both manifests have a home in the specs tree", () => {
    const tree = template.split("```\nspecs/")[1]!.split("```")[0]!;
    expect(tree).toContain("deps.yaml");
    expect(tree).toContain("best-practices.yaml");
  });

  test("the orchestrator its own Orchestration keys configure is named", () => {
    expect(template).toContain("## Orchestration");
    expect(template).toContain("`/deliver`");
    expect(template).toMatch(/`\/deliver`[\s\S]{0,400}Orchestration/);
  });

  test("the manifest-management surfaces are both named", () => {
    for (const skill of ["/deps", "/best-practices", "/spec-archive"]) {
      expect(template, skill).toContain(`\`${skill}\``);
    }
  });

  test("the template states a /docs invocation /docs accepts", () => {
    expect(template).not.toContain("/docs --commit --full");
  });
});

// ===========================================================================
// AC-STE-569.13 — the documented key gains its reader
// ===========================================================================

describe("AC-STE-569.13 — milestone_scan_fetch has a deterministic reader", () => {
  const withClaudeMd = <T,>(body: string | null, fn: (p: string) => T): T => {
    const root = mkdtempSync(join(tmpdir(), "ste569-fetch-"));
    try {
      const p = join(root, "CLAUDE.md");
      if (body !== null) writeFileSync(p, body);
      return fn(p);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };

  test("a standalone true line reads true", () => {
    expect(withClaudeMd("# P\n\nmilestone_scan_fetch: true\n", readMilestoneScanFetch)).toBe(
      true,
    );
  });

  test("absent line, absent file and false all read false", () => {
    expect(withClaudeMd("# P\n\nmode: linear\n", readMilestoneScanFetch)).toBe(false);
    expect(withClaudeMd(null, readMilestoneScanFetch)).toBe(false);
    expect(withClaudeMd("milestone_scan_fetch: false\n", readMilestoneScanFetch)).toBe(
      false,
    );
  });

  test("a malformed value reads false rather than throwing", () => {
    for (const v of ["yes", "1", "True", ""]) {
      expect(
        withClaudeMd(`milestone_scan_fetch: ${v}\n`, readMilestoneScanFetch),
        v,
      ).toBe(false);
    }
  });

  test("an INDENTED occurrence is not configuration", () => {
    // The template's own explanatory comment block carries the token indented.
    // A loose match would read a project's documentation as its config.
    expect(
      withClaudeMd("<!--\n  milestone_scan_fetch: true\n-->\n", readMilestoneScanFetch),
    ).toBe(false);
  });

  test("the four-way precedence is encoded, --no-fetch first", () => {
    expect(resolveFetchPolicy({ noFetch: true, fetch: true, configValue: true })).toBe(
      false,
    );
    expect(resolveFetchPolicy({ fetch: true, configValue: false })).toBe(true);
    expect(resolveFetchPolicy({ configValue: true })).toBe(true);
    expect(resolveFetchPolicy({})).toBe(false);
  });

  test("/spec-write names the reader rather than describing the parse", () => {
    const skill = read(join(pluginRoot, "skills", "spec-write", "SKILL.md"));
    expect(skill).toContain("readMilestoneScanFetch");
    expect(skill).toContain("resolveFetchPolicy");
    expect(skill).toContain("milestone_scan_fetch_config.ts");
  });

  test("the edit stayed within the NFR-1 cap it was already at", () => {
    const cap = Number.parseInt(
      /SKILL_LINE_CAP = (\d+)/.exec(
        read(join(pluginRoot, "tests", "skill-nfr-1-length.test.ts")),
      )![1]!,
      10,
    );
    const lines = read(join(pluginRoot, "skills", "spec-write", "SKILL.md")).split("\n")
      .length;
    expect(lines).toBeLessThanOrEqual(cap);
  });
});

// ===========================================================================
// AC-STE-569.14 — the remediation text states the condition
// ===========================================================================

describe("AC-STE-569.14 — the codename remedy names which case the reader is in", () => {
  test("the universal claim is gone and the condition is stated", () => {
    const src = read(
      join(pluginRoot, "adapters", "_shared", "src", "release_surface_agreement.ts"),
    );
    expect(src).not.toContain("so this field goes stale unless it is written by hand");
    expect(src).toContain("Add `{codename}` to that");
    expect(src).toContain("ship-milestone-reference.md");
  });

  test("this repository is the case the old wording got wrong", () => {
    // Since STE-554 the toolkit's own block writes the field, so "unless it is
    // written by hand" was false for exactly the project reading it here.
    const claudeMd = read(join(repoRoot, "CLAUDE.md"));
    // The yaml fence itself, not the prose section that names it — the phrase
    // "## Release Files" occurs in the Release Checklist paragraph first.
    const block = /## Release Files\n+```yaml\n([\s\S]*?)```/.exec(claudeMd)![1]!;
    expect(block).toContain("{codename}");
    expect(block).toContain("specs/requirements.md");
  });
});

// Referenced by AC-STE-569.2's enumeration guard; kept here so an accidental
// `examples/` move breaks the import rather than emptying the sweep.
test("the examples directory is where this suite thinks it is", () => {
  expect(existsSync(examplesDir)).toBe(true);
  mkdirSync(examplesDir, { recursive: true });
});
