// STE-670 — video offer at /ship-milestone.
//
//   AC-STE-670.1 — `video_offer.ts <projectRoot> <milestone>` prints `slug=<slug>`
//                  then one `fr=<id> <title>` per Added/Changed FR bound to the
//                  milestone when readiness is ready; prints nothing (exit 0) when
//                  not ready or when no such FR exists.
//   AC-STE-670.2 — `skills/ship-milestone/SKILL.md` places the offer after the
//                  release commit and before the opt-in `/pr` offer, with the exact
//                  prompt and decline line.
//   AC-STE-670.3 — the offer step is conditioned on non-empty `video_offer.ts` output.
//   AC-STE-670.4 — under the driven-run marker the offer is omitted, per the
//                  continuation-offer module's rule (registry entry + adoption scan).
//   AC-STE-670.5 — the slug is lowercase kebab-case of the milestone title, at most
//                  40 characters, and stable across runs.
//   AC-STE-670.6 — mutation-verified in a temp overlay: forcing readiness to "ready"
//                  turns AC-STE-670.1's not-ready case red.
//
// Fixtures are git-initialised temp projects under tmpdir(); the working tree is
// never touched. SKILL.md is read lazily inside tests so the AC-STE-670.6 overlay
// (which carries only adapters/_shared/src) can load this file.

import { afterAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { writeDptGitignore } from "../adapters/_shared/src/setup/dpt_gitignore";
import { DRIVEN_MARKER } from "../adapters/_shared/src/driven_run_signal";
import {
  CONTINUATION_OFFERS,
  DRIVEN_OMISSION_CLAUSE,
  offerFires,
  scanContinuationOfferAdoption,
} from "../adapters/_shared/src/continuation_offer";
import { mutateInRegion } from "./_sited-mutation";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const FRONT_DOOR = join(PLUGIN_ROOT, "adapters", "_shared", "src", "video_offer.ts");
const SHIP_SKILL = join(PLUGIN_ROOT, "skills", "ship-milestone", "SKILL.md");
const THIS_FILE_REL = "tests/m_1e0717-ste-670-video-offer.test.ts";

const PROMPT = "Make an explainer video for M<N>? [y/N]";
const DECLINE = "Run: /video <slug>";
const PR_PROMPT = "Open ceremony PR via /pr now? (y/n):";
const COMMIT_ANCHOR = "and create a single commit in";

const KEY_VARS = ["ELEVENLABS_API_KEY", "GOOGLE_TTS_API_KEY"] as const;
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const VALID_CONFIG = [
  "tts:",
  "  provider: elevenlabs",
  "  voice: Rachel",
  "  model: eleven_multilingual_v2",
  "recorder:",
  "  kind: web",
  "music:",
  "  source: none",
  "",
].join("\n");

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const tmpRoots: string[] = [];

function makeTmpRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tmpRoots.push(root);
  return root;
}

function cleanup(root: string): void {
  rmSync(root, { recursive: true, force: true });
  if (existsSync(root)) Bun.spawnSync(["rm", "-rf", root]);
}

afterAll(() => {
  for (const r of tmpRoots) cleanup(r);
});

function writeFile(root: string, rel: string, body: string): string {
  const full = join(root, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
  return full;
}

function gitInit(root: string): void {
  const proc = Bun.spawnSync(["git", "init", "-q"], { cwd: root, stdout: "pipe", stderr: "pipe" });
  expect(proc.exitCode).toBe(0);
}

interface FrFixture {
  id: string;
  title: string;
  milestone: string;
  category: string;
  archived?: boolean;
}

function frBody(fr: FrFixture): string {
  return [
    "---",
    `title: ${fr.title}`,
    `milestone: ${fr.milestone}`,
    `status: ${fr.archived ? "archived" : "active"}`,
    `archived_at: ${fr.archived ? "2026-10-12T10:00:00Z" : "null"}`,
    "tracker:",
    `  linear: ${fr.id}`,
    "created_at: 2026-10-12T09:00:00Z",
    `changelog_category: ${fr.category}`,
    "---",
    "",
    `# ${fr.title}`,
    "",
    "## Acceptance Criteria",
    "",
    `- AC-${fr.id}.1: something.`,
    "",
  ].join("\n");
}

function planBody(milestone: string, title: string, archived: boolean): string {
  return [
    "---",
    `milestone: ${milestone}`,
    `status: ${archived ? "archived" : "active"}`,
    `archived_at: ${archived ? "2026-10-12T10:00:00Z" : "null"}`,
    "kickoff_branch: feat/x",
    "frozen_at: null",
    "---",
    "",
    "# Implementation Plan",
    "",
    `## ${milestone} — ${title} {#${milestone}}`,
    "",
    "**Goal:** a goal.",
    "",
  ].join("\n");
}

function makeProject(opts: {
  ready: boolean;
  milestone: string;
  title: string;
  planArchived?: boolean;
  frs: FrFixture[];
}): string {
  const root = makeTmpRoot("ste670-proj-");
  gitInit(root);
  writeDptGitignore(root);
  if (opts.ready) {
    writeFile(root, ".dpt/video/config.yaml", VALID_CONFIG);
    writeFile(root, ".dpt/.env", "ELEVENLABS_API_KEY=sk-ste670-test\n");
  }
  const planDir = opts.planArchived ? "specs/plan/archive" : "specs/plan";
  writeFile(root, `${planDir}/${opts.milestone}.md`, planBody(opts.milestone, opts.title, !!opts.planArchived));
  for (const fr of opts.frs) {
    const dir = fr.archived ? "specs/frs/archive" : "specs/frs";
    writeFile(root, `${dir}/${fr.id}.md`, frBody(fr));
  }
  return root;
}

function runOffer(root: string, milestone: string): { exitCode: number; stdout: string; stderr: string } {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !(KEY_VARS as readonly string[]).includes(k)) env[k] = v;
  }
  const proc = Bun.spawnSync([process.execPath, FRONT_DOOR, root, milestone], {
    cwd: PLUGIN_ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env,
  });
  return {
    exitCode: proc.exitCode ?? -1,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

const lines = (s: string): string[] => s.split("\n").filter((l) => l.trim() !== "");

const MS = "M_ab12cd";
const TITLE = "Feature explainer videos";

/** The standard bound set: two user-facing (one archived), plus three that must be filtered out. */
function standardFrs(): FrFixture[] {
  return [
    { id: "STE-901", title: "Video workspace and keys", milestone: MS, category: "Added", archived: true },
    { id: "STE-902", title: "Faster renderer", milestone: MS, category: "Changed" },
    { id: "STE-903", title: "Fix a crash", milestone: MS, category: "Fixed", archived: true },
    { id: "STE-904", title: "Another milestone feature", milestone: "M_ffffff", category: "Added" },
    { id: "STE-905", title: "Drop a flag", milestone: MS, category: "Removed" },
  ];
}

// ===========================================================================
// AC-STE-670.1 — the predicate front door
// ===========================================================================

describe("AC-STE-670.1 — video_offer.ts predicate", () => {
  test("front door exists at adapters/_shared/src/video_offer.ts", () => {
    expect(existsSync(FRONT_DOOR)).toBe(true);
  });

  test("ready: prints slug= then one fr= line per Added/Changed FR bound to the milestone", () => {
    const root = makeProject({ ready: true, milestone: MS, title: TITLE, planArchived: true, frs: standardFrs() });
    const out = runOffer(root, MS);
    expect(out.exitCode, out.stderr).toBe(0);
    const ls = lines(out.stdout);
    expect(ls[0]).toBe("slug=feature-explainer-videos");
    expect(ls.slice(1).sort()).toEqual(["fr=STE-901 Video workspace and keys", "fr=STE-902 Faster renderer"]);
    expect(ls.length).toBe(3);
  });

  test("ready with an active plan and active FRs: same shape", () => {
    const root = makeProject({
      ready: true,
      milestone: MS,
      title: TITLE,
      frs: [{ id: "STE-911", title: "Only feature", milestone: MS, category: "Added" }],
    });
    const out = runOffer(root, MS);
    expect(out.exitCode, out.stderr).toBe(0);
    expect(lines(out.stdout)).toEqual(["slug=feature-explainer-videos", "fr=STE-911 Only feature"]);
  });

  test("not ready, no video config: prints nothing and exits 0", () => {
    const root = makeProject({ ready: false, milestone: MS, title: TITLE, planArchived: true, frs: standardFrs() });
    const out = runOffer(root, MS);
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toBe("");
  });

  test("ready but no Added/Changed FR bound to the milestone: prints nothing and exits 0", () => {
    const root = makeProject({
      ready: true,
      milestone: MS,
      title: TITLE,
      frs: [
        { id: "STE-921", title: "Fix one", milestone: MS, category: "Fixed", archived: true },
        { id: "STE-922", title: "Elsewhere", milestone: "M_eeeeee", category: "Added" },
      ],
    });
    const out = runOffer(root, MS);
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toBe("");
  });
});

// ===========================================================================
// AC-STE-670.5 — deterministic slug
// ===========================================================================

describe("AC-STE-670.5 — slug derivation", () => {
  const oneFr = (ms: string): FrFixture[] => [{ id: "STE-931", title: "A feature", milestone: ms, category: "Added" }];

  function slugOf(title: string): string {
    const root = makeProject({ ready: true, milestone: MS, title, frs: oneFr(MS) });
    const out = runOffer(root, MS);
    expect(out.exitCode, out.stderr).toBe(0);
    const first = lines(out.stdout)[0] ?? "";
    expect(first.startsWith("slug=")).toBe(true);
    return first.slice("slug=".length);
  }

  test("punctuation and case collapse to lowercase kebab-case", () => {
    expect(slugOf("Voice & Music: Providers!")).toBe("voice-music-providers");
  });

  test("a long title is cut to at most 40 characters, still kebab-case, a prefix of the full slug", () => {
    const title = "Record every simulator and emulator screen with deterministic retakes";
    const full = "record-every-simulator-and-emulator-screen-with-deterministic-retakes";
    const slug = slugOf(title);
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.length).toBeGreaterThan(0);
    expect(slug).toMatch(KEBAB);
    expect(full.startsWith(slug)).toBe(true);
  });

  test("repeated runs report the same slug", () => {
    const root = makeProject({ ready: true, milestone: MS, title: TITLE, frs: oneFr(MS) });
    const a = runOffer(root, MS);
    const b = runOffer(root, MS);
    expect(a.exitCode).toBe(0);
    expect(lines(a.stdout)[0]).toBe("slug=feature-explainer-videos");
    expect(lines(b.stdout)[0]).toBe(lines(a.stdout)[0]);
    expect(b.stdout).toBe(a.stdout);
  });
});

// ===========================================================================
// AC-STE-670.2 / .3 — the ship skill's offer step
// ===========================================================================

function shipSkill(): string {
  return readFileSync(SHIP_SKILL, "utf8");
}

/** The stretch between the release commit and the opt-in /pr prompt. */
function offerWindow(body: string): string {
  const commitIdx = body.indexOf(COMMIT_ANCHOR);
  const prIdx = body.indexOf(PR_PROMPT);
  expect(commitIdx).toBeGreaterThan(-1);
  expect(prIdx).toBeGreaterThan(commitIdx);
  return body.slice(commitIdx, prIdx);
}

describe("AC-STE-670.2 — offer placement and exact strings", () => {
  test("the prompt appears exactly once in the ship skill", () => {
    expect(shipSkill().split(PROMPT).length - 1).toBe(1);
  });

  test("the prompt sits after the release commit and before the opt-in /pr offer", () => {
    expect(offerWindow(shipSkill())).toContain(PROMPT);
  });

  test("the decline line `Run: /video <slug>` follows the prompt, before the /pr offer", () => {
    const w = offerWindow(shipSkill());
    const p = w.indexOf(PROMPT);
    const d = w.indexOf(DECLINE);
    expect(p).toBeGreaterThan(-1);
    expect(d).toBeGreaterThan(p);
  });

  test("accepting starts `/video <slug>`", () => {
    const w = offerWindow(shipSkill());
    const after = w.slice(w.indexOf(PROMPT));
    expect(after).toContain("/video <slug>");
  });
});

describe("AC-STE-670.3 — the offer is conditioned on non-empty video_offer.ts output", () => {
  test("the step runs video_offer.ts before it prompts", () => {
    const w = offerWindow(shipSkill());
    const call = w.indexOf("adapters/_shared/src/video_offer.ts");
    expect(call).toBeGreaterThan(-1);
    expect(call).toBeLessThan(w.indexOf(PROMPT));
  });

  test("empty output means no prompt and no decline line", () => {
    const w = offerWindow(shipSkill());
    const head = w.slice(w.indexOf("adapters/_shared/src/video_offer.ts"));
    expect(head).toMatch(/empty (?:stdout|output)[^\n]*no prompt[^\n]*no decline line/i);
  });

  test("behavioural half: an unconfigured project yields empty output", () => {
    const root = makeProject({ ready: false, milestone: MS, title: TITLE, frs: standardFrs() });
    expect(runOffer(root, MS).stdout).toBe("");
  });
});

// ===========================================================================
// AC-STE-670.4 — driven runs omit the offer (continuation-offer rule)
// ===========================================================================

describe("AC-STE-670.4 — driven-run omission", () => {
  const entry = () => CONTINUATION_OFFERS.find((o) => o.anchor.includes(PROMPT));

  test("the continuation-offer registry carries the video offer for ship-milestone", () => {
    const e = entry();
    expect(e).toBeDefined();
    expect(e!.skill).toBe("ship-milestone");
    expect(e!.file).toBe("plugins/dev-process-toolkit/skills/ship-milestone/SKILL.md");
    expect(e!.runsWhenDriven).toEqual([]);
  });

  test("offerFires: true on a plain body, false under the driven-run marker", () => {
    const e = entry();
    expect(e).toBeDefined();
    expect(offerFires(e!.id, "/ship-milestone M_ab12cd")).toBe(true);
    expect(offerFires(e!.id, `/ship-milestone M_ab12cd\n${DRIVEN_MARKER}`)).toBe(false);
  });

  test("the shipped skill adopts the driven-omission clause for the video offer", () => {
    const e = entry();
    expect(e).toBeDefined();
    const violations = scanContinuationOfferAdoption(REPO_ROOT).filter((v) => v.skill === "ship-milestone");
    expect(violations).toEqual([]);
    // The clause sits inside the video offer's own window, not only in a sibling's.
    const w = offerWindow(shipSkill());
    const span = w.slice(w.indexOf(PROMPT));
    expect(span).toContain(DRIVEN_OMISSION_CLAUSE);
  });
});

// ===========================================================================
// AC-STE-670.6 — mutation verification in a temp overlay
// ===========================================================================

interface OverlayRun {
  code: number;
  output: string;
  mutatedSource: string | null;
}

function runOverlay(
  filter: string,
  mutation: { moduleRel: string; find: string; repl: string; marker: string } | null,
): OverlayRun {
  const root = makeTmpRoot("ste670-overlay-");
  const plugin = join(root, "plugins", "dev-process-toolkit");
  mkdirSync(join(plugin, "adapters", "_shared"), { recursive: true });
  mkdirSync(join(plugin, "tests"), { recursive: true });
  const copy = Bun.spawnSync(
    [
      "bash",
      "-c",
      [
        "set -e",
        `cp -R ${JSON.stringify(join(PLUGIN_ROOT, "adapters", "_shared", "src"))} ${JSON.stringify(join(plugin, "adapters", "_shared"))}/`,
        `cp ${JSON.stringify(join(PLUGIN_ROOT, THIS_FILE_REL))} ${JSON.stringify(join(plugin, "tests"))}/`,
        `cp ${JSON.stringify(join(PLUGIN_ROOT, "tests", "_sited-mutation.ts"))} ${JSON.stringify(join(plugin, "tests"))}/`,
      ].join("; "),
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (copy.exitCode !== 0) {
    throw new Error(`overlay copy failed (exit ${copy.exitCode}): ${copy.stderr.toString().trim()}`);
  }
  if (existsSync(join(REPO_ROOT, "node_modules"))) {
    symlinkSync(join(REPO_ROOT, "node_modules"), join(root, "node_modules"));
  }

  let mutatedSource: string | null = null;
  if (mutation !== null) {
    const target = join(plugin, mutation.moduleRel);
    expect(existsSync(target)).toBe(true);
    const before = readFileSync(target, "utf8");
    const after = mutateInRegion(before, 0, before.length, mutation.find, mutation.repl, {
      label: `${mutation.moduleRel} (whole module)`,
    });
    writeFileSync(target, after);
    mutatedSource = readFileSync(target, "utf8");
    expect(mutatedSource).not.toBe(before);
    expect(mutatedSource).toContain(mutation.marker);
  }

  const proc = Bun.spawnSync(["bun", "test", THIS_FILE_REL, "-t", filter], {
    cwd: plugin,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    code: proc.exitCode ?? -1,
    output: `${proc.stdout.toString()}\n${proc.stderr.toString()}`,
    mutatedSource,
  };
}

const failedRow = (run: OverlayRun, name: string): boolean =>
  run.output.split("\n").some((l) => l.startsWith("(fail)") && l.includes(name));
/** Grade on summary counts: "(pass)" rows are suppressed under CLAUDECODE=1. */
const count = (run: OverlayRun, kind: "pass" | "fail"): number => {
  const m = run.output.match(new RegExp(`^\\s*(\\d+) ${kind}\\b`, "m"));
  return m === null ? -1 : Number.parseInt(m[1]!, 10);
};

const NOT_READY_TARGET = "not ready, no video config: prints nothing";

describe("AC-STE-670.6 — ignoring readiness is mutation-verified", () => {
  test(
    "control: the unmutated overlay passes the not-ready case",
    () => {
      const run = runOverlay(NOT_READY_TARGET, null);
      expect(count(run, "pass"), run.output.slice(-800)).toBeGreaterThan(0);
      expect(count(run, "fail"), run.output.slice(-800)).toBe(0);
      expect(failedRow(run, NOT_READY_TARGET)).toBe(false);
      expect(run.code).toBe(0);
    },
    120_000,
  );

  test(
    "forcing readiness to ready turns the not-ready case red",
    () => {
      const marker = "/* MUTATION:STE-670.6:ignore-readiness */";
      const run = runOverlay(NOT_READY_TARGET, {
        moduleRel: "adapters/_shared/src/video/readiness.ts",
        find: "export function videoReadiness(projectRoot: string): VideoReadiness {",
        repl:
          `export function videoReadiness(_projectRoot: string): VideoReadiness { ${marker} return { ready: true, reasons: [] }; }\n` +
          "function __unmutated_videoReadiness(projectRoot: string): VideoReadiness {",
        marker,
      });
      expect(run.mutatedSource).toContain(marker);
      expect(failedRow(run, NOT_READY_TARGET), run.output.slice(-800)).toBe(true);
      expect(count(run, "fail")).toBeGreaterThan(0);
      expect(run.code).not.toBe(0);
    },
    120_000,
  );
});

// ===========================================================================
// HARDEN-J — FR STE-670 "never skips … any other ship gate": accept continues to step 10
// ===========================================================================

describe("HARDEN-J — accepting the video offer still continues to step 10", () => {
  /** The § 9b section, heading to the step-10 heading. */
  function section9b(body: string): string {
    const start = body.indexOf("### 9b. Explainer video offer");
    const end = body.indexOf("### 10.", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return body.slice(start, end);
  }

  test("HARDEN-J the accept (`y`) bullet says the run continues to step 10 after /video returns, fails or aborts", () => {
    const accept = section9b(shipSkill())
      .split("\n")
      .find((l) => /^- \*\*Accept\*\*/.test(l));
    expect(accept, "§ 9b has an `- **Accept**` bullet").toBeDefined();
    expect(accept!).toContain("/video <slug>");
    expect(accept!).toMatch(/\breturns?\b/i);
    expect(accept!).toMatch(/\bfail/i);
    expect(accept!).toMatch(/\babort/i);
    expect(accept!).toMatch(/continue[s]? to step 10/i);
  });
});
