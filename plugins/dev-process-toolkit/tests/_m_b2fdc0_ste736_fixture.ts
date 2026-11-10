// STE-736 (M_b2fdc0) — shared legs for the main suites and the mutation battery.
//
// Every leg takes a PLUGIN ROOT — the real plugin, or a temporary copy with one
// sited mutation — imports the shipped helpers FROM THAT ROOT and reads the
// shipped docs FROM THAT ROOT. A leg returns null when it holds and a one-line
// reason when it does not, so the battery can tell "the leg fails on the mutant"
// from "the leg could not run".
//
// All ids are fake (STE-90xx, M_feed0x): this is a public repo.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const PLUGIN_ROOT = resolve(import.meta.dir, "..");

const temps: string[] = [];
export function tempDir(label: string): string {
  const d = mkdtempSync(join(tmpdir(), `ste736-${label}-`));
  temps.push(d);
  return d;
}
export function cleanupTemps(): void {
  while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true });
}

export function tree(label: string, files: Record<string, string>): string {
  const root = tempDir(label);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
  return root;
}

const FR_BODY = "---\nstatus: archived\n---\n\n# Fake FR\n";

// ---------------------------------------------------------------------------
// Module loaders — always from the given plugin root.

type RewriteFn = (repoRoot: string, frId: string) => { filesChanged: string[] };
async function rewriteFrom(root: string): Promise<RewriteFn> {
  const mod = await import(join(root, "adapters/_shared/src/spec_archive/rewrite_links.ts"));
  return mod.rewriteArchiveLinks as RewriteFn;
}

type LoadFn = (projectRoot: string) => unknown;
async function loaderFrom(root: string): Promise<LoadFn> {
  const mod = await import(join(root, "adapters/_shared/src/project_settings.ts"));
  return mod.loadProjectSettings as LoadFn;
}

interface ProbeMod {
  inspectCommit: (subject: string, body: string) => "out-of-scope" | "legitimate" | "violation";
  runSocraticFirstTurnPostHocDriftProbe: (root: string) => Promise<{ violations: unknown[] }>;
}
async function probeFrom(root: string): Promise<ProbeMod> {
  return (await import(join(root, "adapters/_shared/src/socratic_first_turn_post_hoc_drift.ts"))) as ProbeMod;
}

// ---------------------------------------------------------------------------
// Link helpers.

/** Every relative markdown link target in `text` that names an FR file. */
export function frLinkTargets(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = m[1]!;
    if (/^[a-z]+:/i.test(target) || target.startsWith("/")) continue;
    if (/(^|\/)frs\/(archive\/)?[^/]+\.md$/.test(target)) out.push(target);
  }
  return out;
}

/** The FR link targets in `relFile` that do not resolve from the file's own folder. */
export function brokenFrLinks(repoRoot: string, relFile: string): string[] {
  const abs = join(repoRoot, relFile);
  const text = readFileSync(abs, "utf-8");
  return frLinkTargets(text).filter((t) => !existsSync(resolve(dirname(abs), t)));
}

function read(root: string, rel: string): string {
  return readFileSync(join(root, rel), "utf-8");
}

// ---------------------------------------------------------------------------
// Legs.

export interface Leg {
  name: string;
  ac: string;
  check: (pluginRoot: string) => Promise<string | null>;
}

/** Settings value a refusal must point at: "use `blocking`" on the same line. */
const USE_BLOCKING_RE = /\buse\b[^\n]*\bblocking\b/i;

/** The `### \`verification\`` section of docs/settings-reference.md. */
export function verificationSection(doc: string): string {
  const start = doc.indexOf("### `verification`");
  if (start < 0) return "";
  const rest = doc.slice(start + 1);
  const next = rest.search(/\n#{2,3} /);
  return next < 0 ? doc.slice(start) : doc.slice(start, start + 1 + next);
}

/** §1 of skills/visual-check/SKILL.md: from `### 1.` up to `### 2.`. */
export function devServerSection(skill: string): string {
  const start = skill.indexOf("### 1.");
  const end = skill.indexOf("### 2.");
  if (start < 0 || end < 0 || end < start) return "";
  return skill.slice(start, end);
}

export const SKILL_LINE_CAP = 358;

export const LEGS: Leg[] = [
  // ---- AC-STE-736.1 ------------------------------------------------------
  {
    name: "AC.1 archived plan FR links resolve after milestone archival",
    ac: "AC-STE-736.1",
    check: async (root) => {
      const rewrite = await rewriteFrom(root);
      // State after `git mv` of the FRs and the plan, before the rewrite.
      const repo = tree("ac1", {
        "specs/frs/archive/STE-9001.md": FR_BODY,
        "specs/frs/archive/STE-9002.md": FR_BODY,
        "specs/plan/archive/M_feed01.md":
          "# Plan\n\n- [STE-9001](../frs/STE-9001.md) first\n- [STE-9002](./../frs/STE-9002.md) second\n",
        "specs/requirements.md": "| STE-9001 | x | [link](frs/STE-9001.md) |\n",
      });
      rewrite(repo, "STE-9001");
      rewrite(repo, "STE-9002");
      const plan = read(repo, "specs/plan/archive/M_feed01.md");
      const targets = frLinkTargets(plan);
      if (targets.length !== 2) return `expected 2 FR links in the archived plan, found ${targets.length}: ${plan}`;
      const broken = brokenFrLinks(repo, "specs/plan/archive/M_feed01.md");
      if (broken.length) return `archived plan has unresolved FR links: ${broken.join(", ")}`;
      return null;
    },
  },
  {
    name: "AC.1 active plans and requirements keep today's form",
    ac: "AC-STE-736.1",
    check: async (root) => {
      const rewrite = await rewriteFrom(root);
      const repo = tree("ac1-active", {
        "specs/frs/archive/STE-9003.md": FR_BODY,
        "specs/plan/M_feed02.md": "# Plan\n\n- [STE-9003](../frs/STE-9003.md)\n",
        "specs/requirements.md": "| STE-9003 | x | [link](frs/STE-9003.md) |\n",
      });
      rewrite(repo, "STE-9003");
      const plan = read(repo, "specs/plan/M_feed02.md");
      const req = read(repo, "specs/requirements.md");
      if (plan !== "# Plan\n\n- [STE-9003](../frs/archive/STE-9003.md)\n") return `active plan changed shape: ${JSON.stringify(plan)}`;
      if (req !== "| STE-9003 | x | [link](frs/archive/STE-9003.md) |\n") return `requirements changed shape: ${JSON.stringify(req)}`;
      return null;
    },
  },

  // ---- AC-STE-736.2 ------------------------------------------------------
  {
    name: "AC.2 v3.3.0-shape broken link is repaired on a re-run",
    ac: "AC-STE-736.2",
    check: async (root) => {
      const rewrite = await rewriteFrom(root);
      const repo = tree("ac2-rerun", {
        "specs/frs/archive/STE-9011.md": FR_BODY,
        "specs/plan/archive/M_feed03.md": "# Plan\n\n- [STE-9011](../frs/archive/STE-9011.md)\n",
      });
      rewrite(repo, "STE-9011");
      const broken = brokenFrLinks(repo, "specs/plan/archive/M_feed03.md");
      if (broken.length) return `v3.3.0-shape link not repaired: ${broken.join(", ")}`;
      if (frLinkTargets(read(repo, "specs/plan/archive/M_feed03.md")).length !== 1) return "the FR link vanished";
      return null;
    },
  },
  {
    name: "AC.2 v3.3.0-shape broken link is repaired by the next archival of another FR",
    ac: "AC-STE-736.2",
    check: async (root) => {
      const rewrite = await rewriteFrom(root);
      // STE-9012 was rewritten while the plan was active, then the plan moved
      // (the v3.3.0 shape); STE-9013 is archived next, after the move.
      const repo = tree("ac2-next", {
        "specs/frs/archive/STE-9012.md": FR_BODY,
        "specs/frs/archive/STE-9013.md": FR_BODY,
        "specs/plan/archive/M_feed04.md":
          "# Plan\n\n- [STE-9012](../frs/archive/STE-9012.md)\n- [STE-9013](../frs/STE-9013.md)\n",
      });
      rewrite(repo, "STE-9013");
      const broken = brokenFrLinks(repo, "specs/plan/archive/M_feed04.md");
      if (broken.length) return `archived plan still has unresolved FR links: ${broken.join(", ")}`;
      if (frLinkTargets(read(repo, "specs/plan/archive/M_feed04.md")).length !== 2) return "an FR link vanished";
      return null;
    },
  },
  {
    name: "AC.2 a link that resolves today is never changed",
    ac: "AC-STE-736.2",
    check: async (root) => {
      const rewrite = await rewriteFrom(root);
      const archived =
        "# Plan\n\n- [STE-9014](../../frs/archive/STE-9014.md)\n- [STE-9015](../../frs/STE-9015.md)\n";
      const active = "# Plan\n\n- [STE-9014](../frs/archive/STE-9014.md)\n";
      const repo = tree("ac2-keep", {
        "specs/frs/archive/STE-9014.md": FR_BODY,
        "specs/frs/STE-9015.md": FR_BODY,
        "specs/frs/archive/STE-9016.md": FR_BODY,
        "specs/plan/archive/M_feed05.md": archived,
        "specs/plan/M_feed06.md": active,
      });
      rewrite(repo, "STE-9014");
      rewrite(repo, "STE-9016");
      if (read(repo, "specs/plan/archive/M_feed05.md") !== archived) return "a resolving link in an archived plan was changed";
      if (read(repo, "specs/plan/M_feed06.md") !== active) return "a resolving link in an active plan was changed";
      return null;
    },
  },

  // ---- AC-STE-736.3 ------------------------------------------------------
  {
    name: "AC.3 settings loader refuses `required` and says to use `blocking`",
    ac: "AC-STE-736.3",
    check: async (root) => {
      const load = await loaderFrom(root);
      const repo = tree("ac3-settings", {
        "specs/settings.yaml": 'schema_version: 1\nmin_dpt_version: "3.0.0"\nverification:\n  verify_mode: required\n',
      });
      let err: unknown = null;
      try {
        load(repo);
      } catch (e) {
        err = e;
      }
      if (!(err instanceof Error)) return "verify_mode: required was accepted by the settings loader";
      if (!err.message.includes("verification.verify_mode")) return `refusal does not name the key: ${err.message}`;
      if (!USE_BLOCKING_RE.test(err.message)) return `refusal does not say to use \`blocking\`: ${err.message}`;
      return null;
    },
  },
  {
    name: "AC.3 legacy loader refuses `required` and says to use `blocking`",
    ac: "AC-STE-736.3",
    check: async (root) => {
      const load = await loaderFrom(root);
      const repo = tree("ac3-legacy", { "CLAUDE.md": "# Fake\n\n## Verification\n\nverify_mode: required\n" });
      let err: unknown = null;
      try {
        load(repo);
      } catch (e) {
        err = e;
      }
      if (!(err instanceof Error)) return "verify_mode: required was accepted by the legacy loader";
      if (err.name !== "MalformedVerificationConfigError") return `unexpected refusal class ${err.name}: ${err.message}`;
      if (!USE_BLOCKING_RE.test(err.message)) return `refusal does not say to use \`blocking\`: ${err.message}`;
      return null;
    },
  },
  {
    name: "AC.3 settings-reference says `required` is refused and `blocking` is the value",
    ac: "AC-STE-736.3",
    check: async (root) => {
      const section = verificationSection(read(root, "docs/settings-reference.md"));
      if (!section) return "docs/settings-reference.md has no ### `verification` section";
      const line = section.split("\n").find((l) => l.includes("`required`") && /\buse\b[^\n]*`blocking`/i.test(l));
      if (!line) return "no line in the verification section names `required` and says to use `blocking`";
      if (!/refus|not accepted|rejected/i.test(line)) return `the line does not say \`required\` is refused: ${line}`;
      return null;
    },
  },

  // ---- AC-STE-736.4 ------------------------------------------------------
  {
    name: "AC.4 probe #45 checks a plural `write FRs` subject",
    ac: "AC-STE-736.4",
    check: async (root) => {
      const { inspectCommit } = await probeFrom(root);
      const subject = "chore(specs): write FRs STE-9021, STE-9022";
      const bare = inspectCommit(subject, "Refs: STE-9021\n");
      if (bare !== "violation") return `plural subject without a marker read as ${bare}`;
      const approved = inspectCommit(subject, "spec_write_commit_operator_approved\n\nRefs: STE-9021\n");
      if (approved !== "legitimate") return `plural subject with an approval marker read as ${approved}`;
      const audited = inspectCommit(subject, "spec_write_draft_default_applied\n");
      if (audited !== "legitimate") return `plural subject with an audit marker read as ${audited}`;
      return null;
    },
  },
  {
    name: "AC.4 probe #45 flags a plural-subject HEAD commit with no marker",
    ac: "AC-STE-736.4",
    check: async (root) => {
      const probe = await probeFrom(root);
      const results: number[] = [];
      for (const body of ["Refs: STE-9023", "spec_write_commit_operator_approved\n\nRefs: STE-9023"]) {
        const repo = tempDir("ac4-git");
        const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" });
        git("init", "-q");
        git("config", "user.email", "test@example.com");
        git("config", "user.name", "Test User");
        git("config", "core.hooksPath", "/dev/null");
        git("config", "commit.gpgsign", "false");
        writeFileSync(join(repo, "README.md"), "x\n");
        git("add", "README.md");
        git("commit", "-q", "-m", `chore(specs): write FRs STE-9023, STE-9024\n\n${body}`);
        results.push((await probe.runSocraticFirstTurnPostHocDriftProbe(repo)).violations.length);
      }
      if (results[0] !== 1) return `unmarked plural HEAD produced ${results[0]} violations, expected 1`;
      if (results[1] !== 0) return `approved plural HEAD produced ${results[1]} violations, expected 0`;
      return null;
    },
  },

  // ---- AC-STE-736.5 ------------------------------------------------------
  {
    name: "AC.5 visual-check §1 names a route around a loopback refusal",
    ac: "AC-STE-736.5",
    check: async (root) => {
      const skill = read(root, "skills/visual-check/SKILL.md");
      const section = devServerSection(skill);
      if (!section) return "visual-check SKILL.md has no §1 … §2 span";
      const para = section
        .split(/\n\s*\n/)
        .find((p) => /refus/i.test(p) && /loopback/i.test(p) && /private/i.test(p));
      if (!para) return "§1 has no paragraph about the browser helper refusing a loopback or private address";
      if (!/non-loopback/i.test(para)) return `the paragraph names no non-loopback address route: ${para}`;
      if (!/Chrome browser tools/i.test(para)) return `the paragraph names no Chrome browser tools route: ${para}`;
      return null;
    },
  },
  {
    name: "AC.5 visual-check SKILL.md stays under the NFR-1 line cap",
    ac: "AC-STE-736.5",
    check: async (root) => {
      const n = read(root, "skills/visual-check/SKILL.md").split("\n").length;
      return n <= SKILL_LINE_CAP ? null : `visual-check SKILL.md has ${n} lines, cap ${SKILL_LINE_CAP}`;
    },
  },
];

export const LEG_BY_NAME = new Map(LEGS.map((l) => [l.name, l]));
export function legsFor(ac: string): Leg[] {
  return LEGS.filter((l) => l.ac === ac);
}
