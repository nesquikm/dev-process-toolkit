// STE-791 (M_d1e7b1) — the gate receipt counts under ONE narrow `cd` form, and
// spec deletions get the spec-only pass.
//
// Recogniser legs (AC .1–.3) call `announcesGateReceipt` / `runsGateOutcome` /
// `bunInvocation` directly. Every rejection leg pairs its shape with the
// accepted base it was derived from, so the refusal is caused by the one fact
// the shape adds, not by the `cd` form being refused altogether.
//
// Deletion legs (AC .5–.6) drive the SHIPPED `pre-commit-gate-check.sh` wrapper
// over a transcript carrying NO gate-check Skill call: a pass is exit 0 with no
// `Refusing:`, a refusal is exit 2 naming dev-process-toolkit:gate-check.
//
// Doc legs (AC .4, .7) read docs/hooks-reference.md and the smoke-test skill.
// AC-STE-791.8 (the full suite) is graded by the orchestrator, not here.

import { afterAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { FR_ACTIVE_PATH, frText, git, makeArchiveRepo, PLAN_ACTIVE_PATH, writeAt } from "./_archive_only_fixture";
import {
  bareTranscriptRecords,
  cleanupTemps as cleanupSpecTemps,
  GATE_CHECK,
  type HookRun,
  permitProblem,
  refusalProblem,
  runHook as runCommitHook,
  SELF,
  show,
  tempDir as specTempDir,
} from "./_m_b2fdc0_ste733_fixture";
import {
  bashCall,
  cleanupTemps as cleanupGateTemps,
  FRONT_DOOR,
  makeTree,
  mintRun,
  PLUGIN_ROOT,
  runHook as runGateHook,
  skillCall,
  SRC,
  stageCodeAndTest,
  tempDir as gateTempDir,
  writeTranscript,
} from "./_m_7bc805_gate_outcome_fixture";

type AnyMod = Record<string, any>;
const T = 120_000;

afterAll(() => {
  cleanupSpecTemps();
  cleanupGateTemps();
});

async function receiptModule(): Promise<AnyMod> {
  return (await import("../adapters/_shared/src/gate_receipt")) as AnyMod;
}

async function shellModule(): Promise<AnyMod> {
  return (await import("../adapters/_shared/src/shell_invocations")) as AnyMod;
}

const ABS = FRONT_DOOR;
/** A literal directory to `cd` into. */
const DIR = gateTempDir("791-cd");
/** An empty directory: a relative front-door path resolved against it finds nothing. */
const EMPTY = gateTempDir("791-empty");
/** A tree holding a same-basename `gate_receipt.ts` this plugin does not own. */
const OTHER = gateTempDir("791-other");
const OTHER_DOOR = join(OTHER, "adapters", "_shared", "src", "gate_receipt.ts");
mkdirSync(join(OTHER, "adapters", "_shared", "src"), { recursive: true });
copyFileSync(ABS, OTHER_DOOR);

/** The accepted base: `cd <literal dir> && bun run <absolute front door> gate-check <dir>`. */
const BASE = `cd ${DIR} && bun run ${ABS} gate-check ${DIR}`;

// ------------------------------------------------------------------- AC .1

describe("AC-STE-791.1 — `cd <dir> && bun [run] <front door> <gate skill>` announces", () => {
  test("AC-STE-791.1 — `cd <dir> && bun run <absolute path> gate-check <dir>`", async () => {
    const m = await receiptModule();
    expect(m.announcesGateReceipt(BASE)).toBe(true);
  });

  test("AC-STE-791.1 — `cd <dir> && bun <absolute path> tdd <dir>` (no `run`)", async () => {
    const m = await receiptModule();
    expect(m.announcesGateReceipt(`cd ${DIR} && bun ${ABS} tdd ${DIR}`)).toBe(true);
  });

  test("AC-STE-791.1 — a quoted literal directory and path, spec-review", async () => {
    const m = await receiptModule();
    expect(m.announcesGateReceipt(`cd "${DIR}" && bun run "${ABS}" spec-review "${DIR}"`)).toBe(true);
  });

  test("AC-STE-791.1 — a relative path resolves against the cd directory (`cd <src> && bun run gate_receipt.ts …`)", async () => {
    const m = await receiptModule();
    expect(m.announcesGateReceipt(`cd ${SRC} && bun run gate_receipt.ts gate-check ${DIR}`)).toBe(true);
  });

  test("AC-STE-791.1 — a relative path two levels down from the cd directory", async () => {
    const m = await receiptModule();
    expect(
      m.announcesGateReceipt(`cd ${join(PLUGIN_ROOT, "adapters")} && bun run _shared/src/gate_receipt.ts gate-check ${DIR}`),
    ).toBe(true);
  });

  test("AC-STE-791.1 — announcesGateReceiptFor reads the cd form's gate skill as its subject", async () => {
    const m = await receiptModule();
    expect({
      own: m.announcesGateReceiptFor(BASE, "dev-process-toolkit:gate-check"),
      other: m.announcesGateReceiptFor(BASE, "dev-process-toolkit:tdd"),
    }).toEqual({ own: true, other: false });
  });

  test("AC-STE-791.1 — a subcommand that is not a gate skill still announces nothing under the cd form", async () => {
    const m = await receiptModule();
    expect({
      base: m.announcesGateReceipt(BASE),
      unknown: m.announcesGateReceipt(`cd ${DIR} && bun run ${ABS} deploy ${DIR}`),
    }).toEqual({ base: true, unknown: false });
  });

  test(
    "AC-STE-791.1 — the commit hook permits a commit whose receipt was announced by the cd form",
    async () => {
      const root = makeTree("791-hook-cd", "on");
      stageCodeAndTest(root);
      const run = mintRun(root, "gate-check");
      const tr = writeTranscript(gateTempDir("791-tr"), [
        ...skillCall("gate"),
        ...bashCall("b0", `cd ${root} && bun run ${ABS} gate-check ${root}`, run.run.stdout),
      ]);
      const r = await runGateHook("gate", root, tr);
      expect({ code: r.exitCode, err: r.stderr }).toEqual({ code: 0, err: "" });
    },
    T,
  );

  test(
    "AC-STE-791.1 — TWIN: the same receipt announced by `cd … && bun … ; echo $?` is refused",
    async () => {
      const root = makeTree("791-hook-cd-tail", "on");
      stageCodeAndTest(root);
      const run = mintRun(root, "gate-check");
      const tr = writeTranscript(gateTempDir("791-tr"), [
        ...skillCall("gate"),
        ...bashCall("b0", `cd ${root} && bun run ${ABS} gate-check ${root}; echo $?`, `${run.run.stdout}0\n`),
      ]);
      const r = await runGateHook("gate", root, tr);
      expect(r.exitCode).toBe(2);
    },
    T,
  );
});

// ------------------------------------------------------------------- AC .2

/** The accepted base announces, and the shape derived from it does not. */
async function expectRejected(shape: string, base: string = BASE): Promise<void> {
  const m = await receiptModule();
  expect({ base: m.announcesGateReceipt(base), shape: m.announcesGateReceipt(shape) }).toEqual({ base: true, shape: false });
}

// Fix round 1 (verify survivors 791-d, 791-f): the cd takes exactly one operand, and only bun runs after it.
describe("AC-STE-791.2 — the cd takes one operand, and the program after it is bun", () => {
  test("AC-STE-791.2 — `cd <dir> extra && bun …` is refused", async () => {
    await expectRejected(`cd ${DIR} extra && bun run ${ABS} gate-check ${DIR}`);
  });
  test("AC-STE-791.2 — `cd <dir> && node <front door> …` is refused", async () => {
    await expectRejected(`cd ${DIR} && node ${ABS} gate-check ${DIR}`);
  });
});

describe("AC-STE-791.2 — any segment after the receipt call is refused", () => {
  test("AC-STE-791.2 — `; true` after the receipt call", async () => {
    await expectRejected(`${BASE}; true`);
  });
  test("AC-STE-791.2 — `&& true` after the receipt call", async () => {
    await expectRejected(`${BASE} && true`);
  });
  test("AC-STE-791.2 — `|| true` after the receipt call", async () => {
    await expectRejected(`${BASE} || true`);
  });
  test("AC-STE-791.2 — a pipe after the receipt call", async () => {
    await expectRejected(`${BASE} | cat`);
  });
  test("AC-STE-791.2 — `; echo $?` after the receipt call", async () => {
    await expectRejected(`${BASE}; echo $?`);
  });
});

describe("AC-STE-791.2 — anything before the `cd` is refused", () => {
  test("AC-STE-791.2 — `true && cd <dir> && bun …`", async () => {
    await expectRejected(`true && ${BASE}`);
  });
  test("AC-STE-791.2 — `echo x; cd <dir> && bun …`", async () => {
    await expectRejected(`echo x; ${BASE}`);
  });
  test("AC-STE-791.2 — an assignment before the cd: `FOO=1 cd <dir> && bun …`", async () => {
    await expectRejected(`FOO=1 ${BASE}`);
  });
});

// Added after the audit: the directory must be absolute, since a relative `cd` would be read
// against whatever directory the hook happens to run in.
describe("AC-STE-791.2 — a relative directory is refused", () => {
  test("AC-STE-791.2 — `cd specs && bun …` (relative dir)", async () => {
    await expectRejected(`cd specs && bun run ${ABS} gate-check ${DIR}`);
  });
});

describe("AC-STE-791.2 — an expansion in the directory is refused", () => {
  test("AC-STE-791.2 — `$VAR` as the directory", async () => {
    await expectRejected(`cd $HOME && bun run ${ABS} gate-check ${DIR}`);
  });
  test("AC-STE-791.2 — `${VAR}` as the directory", async () => {
    await expectRejected(`cd \${HOME} && bun run ${ABS} gate-check ${DIR}`);
  });
  test("AC-STE-791.2 — `\"$VAR\"` inside double quotes as the directory", async () => {
    await expectRejected(`cd "$HOME" && bun run ${ABS} gate-check ${DIR}`);
  });
  test("AC-STE-791.2 — `$(…)` as the directory", async () => {
    await expectRejected(`cd $(pwd) && bun run ${ABS} gate-check ${DIR}`);
  });
  test("AC-STE-791.2 — a backtick substitution as the directory", async () => {
    await expectRejected(`cd \`pwd\` && bun run ${ABS} gate-check ${DIR}`);
  });
  test("AC-STE-791.2 — `$VAR` as a directory prefix", async () => {
    await expectRejected(`cd $HOME/x && bun run ${ABS} gate-check ${DIR}`);
  });
});

describe("AC-STE-791.2 — an expansion in the path is refused", () => {
  test("AC-STE-791.2 — `$VAR` in the path", async () => {
    await expectRejected(`cd ${DIR} && bun run $P/gate_receipt.ts gate-check ${DIR}`);
  });
  test("AC-STE-791.2 — `${CLAUDE_PLUGIN_ROOT}` bare in the path", async () => {
    await expectRejected(`cd ${DIR} && bun run \${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/gate_receipt.ts gate-check ${DIR}`);
  });
  test("AC-STE-791.2 — `\"${CLAUDE_PLUGIN_ROOT}/…\"` quoted in the path", async () => {
    await expectRejected(`cd ${DIR} && bun run "\${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/gate_receipt.ts" gate-check ${DIR}`);
  });
  test("AC-STE-791.2 — `$CLAUDE_PLUGIN_ROOT` in the path", async () => {
    await expectRejected(`cd ${DIR} && bun run $CLAUDE_PLUGIN_ROOT/adapters/_shared/src/gate_receipt.ts gate-check ${DIR}`);
  });
  test("AC-STE-791.2 — `$(…)` as the path", async () => {
    await expectRejected(`cd ${DIR} && bun run $(echo ${ABS}) gate-check ${DIR}`);
  });
  test("AC-STE-791.2 — a backtick substitution as the path", async () => {
    await expectRejected(`cd ${DIR} && bun run \`echo ${ABS}\` gate-check ${DIR}`);
  });
});

describe("AC-STE-791.2 — a `cd` option is refused", () => {
  test("AC-STE-791.2 — `cd -P <dir>`", async () => {
    await expectRejected(`cd -P ${DIR} && bun run ${ABS} gate-check ${DIR}`);
  });
  test("AC-STE-791.2 — `cd -L <dir>`", async () => {
    await expectRejected(`cd -L ${DIR} && bun run ${ABS} gate-check ${DIR}`);
  });
});

describe("AC-STE-791.2 — a same-basename script at another path is refused", () => {
  test("AC-STE-791.2 — an absolute path to another `gate_receipt.ts`", async () => {
    await expectRejected(`cd ${DIR} && bun run ${OTHER_DOOR} gate-check ${DIR}`);
  });

  test("AC-STE-791.2 — a relative path that resolves, from the cd directory, to another `gate_receipt.ts`", async () => {
    await expectRejected(
      `cd ${OTHER} && bun run adapters/_shared/src/gate_receipt.ts gate-check ${DIR}`,
      `cd ${PLUGIN_ROOT} && bun run adapters/_shared/src/gate_receipt.ts gate-check ${DIR}`,
    );
  });

  test("AC-STE-791.2 — a relative path is resolved against the cd directory, never the process's own cwd", async () => {
    const m = await receiptModule();
    const before = process.cwd();
    process.chdir(PLUGIN_ROOT);
    let verdicts: { base: boolean; shape: boolean };
    try {
      verdicts = {
        base: m.announcesGateReceipt(`cd ${PLUGIN_ROOT} && bun run adapters/_shared/src/gate_receipt.ts gate-check ${DIR}`),
        shape: m.announcesGateReceipt(`cd ${EMPTY} && bun run adapters/_shared/src/gate_receipt.ts gate-check ${DIR}`),
      };
    } finally {
      process.chdir(before);
    }
    expect(verdicts).toEqual({ base: true, shape: false });
  });
});

// Added after Stage B review (round 1). bun applies `..` to the PHYSICAL directory the shell
// entered; a lexical resolve through a symlinked `cd` dir would name the real front door while
// bun runs another file. The relative target climbs exactly as many levels as the cd dir's own
// path has, so lexically it lands on `/` + the front door, and physically (through a deeper
// symlink target) it lands somewhere else.
describe("AC-STE-791.2 — the cd directory is graded as the shell enters it", () => {
  // Real path: on macOS the temp dir itself sits behind the /var -> /private/var symlink.
  const root = realpathSync(gateTempDir("791-symlink"));
  const deep = join(root, "d", "1", "2", "3", "4", "5", "6");
  mkdirSync(deep, { recursive: true });
  const link = join(root, "link");
  symlinkSync(deep, link);
  const plain = join(root, "plain");
  mkdirSync(plain, { recursive: true });
  const climb = (dir: string): string => `${"../".repeat(dir.split("/").filter(Boolean).length)}${ABS.replace(/^\//, "")}`;

  test("AC-STE-791.2 — `..` through a symlinked cd dir is refused; the same climb from a plain dir is accepted", async () => {
    const m = await receiptModule();
    expect({
      plain: m.announcesGateReceipt(`cd ${plain} && bun run ${climb(plain)} gate-check ${DIR}`),
      symlinked: m.announcesGateReceipt(`cd ${link} && bun run ${climb(link)} gate-check ${DIR}`),
    }).toEqual({ plain: true, symlinked: false });
  });

  // Added after Stage B review (round 2): `..` in the cd dir itself. The shell collapses it
  // lexically (`link/..` is `root`), realpath follows the symlink first (`link/..` is `deep/..`).
  test("AC-STE-791.2 — a cd dir that is not in normal form is refused (`..`, `.`, `//`, trailing slash)", async () => {
    for (const odd of [`${link}/..`, `${plain}/.`, `${root}//plain`, `${plain}/`]) {
      await expectRejected(`cd ${odd} && bun run ${ABS} gate-check ${DIR}`);
    }
  });

  test("AC-STE-791.2 — a cd into a directory that does not exist is refused", async () => {
    await expectRejected(`cd ${join(root, "no-such-dir")} && bun run ${ABS} gate-check ${DIR}`);
  });

  test("AC-STE-791.2 — a cd onto a file, not a directory, is refused", async () => {
    const file = join(root, "a-file");
    writeFileSync(file, "x");
    await expectRejected(`cd ${file} && bun run ${ABS} gate-check ${DIR}`);
  });

  test("AC-STE-791.2 — a newline anywhere in the command is refused", async () => {
    await expectRejected(`cd ${DIR}\n&& bun run ${ABS} gate-check ${DIR}`);
  });
});

// ------------------------------------------------------------------- AC .3

describe("AC-STE-791.3 — runsGateOutcome and bunInvocation are unchanged", () => {
  test("AC-STE-791.3 — the outcome verb under the cd form is not recognised; standalone it is", async () => {
    const m = await receiptModule();
    expect({
      standalone: m.runsGateOutcome(`bun run ${ABS} outcome gate-check ${DIR} pass`),
      cd: m.runsGateOutcome(`cd ${DIR} && bun run ${ABS} outcome gate-check ${DIR} pass`),
    }).toEqual({ standalone: true, cd: false });
  });

  test("AC-STE-791.3 — bunInvocation still reads no invocation from the cd form", async () => {
    const s = await shellModule();
    expect(s.bunInvocation(BASE)).toBeNull();
    expect(s.bunInvocation(`bun run ${ABS} gate-check ${DIR}`)).toEqual({ module: s.realpathOr(ABS), args: ["gate-check", DIR] });
  });
});

// ------------------------------------------------------------------- AC .4

describe("AC-STE-791.4 — docs/hooks-reference.md documents the one cd form", () => {
  const doc = readFileSync(join(PLUGIN_ROOT, "docs", "hooks-reference.md"), "utf-8");
  const lines = doc.split("\n");

  test("AC-STE-791.4 — a line documents `cd <dir> && bun … gate_receipt.ts` as accepted", () => {
    const hits = lines.filter((l) => l.includes("gate_receipt.ts") && /\bcd\s+\S+\s+&&\s+bun\b/.test(l));
    expect(hits.length).toBeGreaterThan(0);
  });

  test("AC-STE-791.4 — a line about the gate receipt says variable paths are unsupported", () => {
    const hits = lines.filter(
      (l) => l.includes("gate_receipt.ts") && /variable/i.test(l) && /unsupported|not supported/i.test(l),
    );
    expect(hits.length).toBeGreaterThan(0);
  });

  test("AC-STE-791.4 — the standalone front-door form is shown", () => {
    const standalone =
      /bun run "?(\$\{CLAUDE_PLUGIN_ROOT\}|\$CLAUDE_PLUGIN_ROOT|<[^>]+>)"?\/adapters\/_shared\/src\/gate_receipt\.ts"? +(gate-check|tdd|spec-review|<)/;
    const hits = lines.filter((l) => standalone.test(l));
    expect(hits.length).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------------- AC .5 / .6

const MSG = '"docs(specs): drop FX-1"';

interface World {
  repo: string;
  transcript: string;
}

interface WorldOpts {
  /** Delete the tracked active FR from disk (an unstaged deletion). */
  deleteFr?: boolean;
  /** `git rm` the active FR before the command runs (a staged deletion). */
  stageFrDeletion?: boolean;
  /** Delete the tracked code file src/app.ts from disk (an unstaged deletion). */
  deleteCode?: boolean;
  /** `git rm` src/app.ts before the command runs (a staged deletion). */
  stageCodeDeletion?: boolean;
  /** Leave an unstaged edit to the tracked plan (a spec path). */
  planEdit?: boolean;
}

function makeWorld(o: WorldOpts = {}): World {
  const root = specTempDir("791");
  const repo = makeArchiveRepo(join(root, "repo"));
  if (o.deleteFr) rmSync(join(repo, FR_ACTIVE_PATH));
  if (o.stageFrDeletion) git(repo, "rm", "-q", FR_ACTIVE_PATH);
  if (o.deleteCode) rmSync(join(repo, "src", "app.ts"));
  if (o.stageCodeDeletion) git(repo, "rm", "-q", "src/app.ts");
  if (o.planEdit) writeAt(repo, PLAN_ACTIVE_PATH, readFileSync(join(repo, PLAN_ACTIVE_PATH), "utf-8") + "\nA reworded line.\n");
  const transcript = join(root, "transcript.jsonl");
  writeFileSync(transcript, bareTranscriptRecords().join("\n") + "\n");
  return { repo, transcript };
}

function runCommit(w: World, command: string): Promise<HookRun> {
  return runCommitHook(PLUGIN_ROOT, "commit", w.repo, command, w.transcript, SELF);
}

async function expectPermit(w: World, command: string): Promise<void> {
  const r = await runCommit(w, command);
  const p = permitProblem(r);
  expect(p === null ? null : `${p}\n${show(r)}`).toBeNull();
}

async function expectRefusal(w: World, command: string): Promise<void> {
  const r = await runCommit(w, command);
  const p = refusalProblem(r, GATE_CHECK);
  expect(p === null ? null : `${p}\n${show(r)}`).toBeNull();
}

describe("AC-STE-791.5 — spec deletions get the spec-only pass", () => {
  test("AC-STE-791.5 — `git rm <tracked fr> && git commit` (the file still on disk)", async () => {
    await expectPermit(makeWorld(), `git rm ${FR_ACTIVE_PATH} && git commit -m ${MSG}`);
  }, T);

  test("AC-STE-791.5 — `git rm <fr> && git commit` when the FR file is already deleted from disk", async () => {
    await expectPermit(makeWorld({ deleteFr: true }), `git rm ${FR_ACTIVE_PATH} && git commit -m ${MSG}`);
  }, T);

  test("AC-STE-791.5 — `git add <deleted tracked fr> && git commit` names a path whose file was deleted", async () => {
    await expectPermit(makeWorld({ deleteFr: true }), `git add ${FR_ACTIVE_PATH} && git commit -m ${MSG}`);
  }, T);

  test("AC-STE-791.5 — `git add <deleted fr> <edited plan> && git commit`: a deletion beside an edit, both spec", async () => {
    await expectPermit(
      makeWorld({ deleteFr: true, planEdit: true }),
      `git add ${FR_ACTIVE_PATH} ${PLAN_ACTIVE_PATH} && git commit -m ${MSG}`,
    );
  }, T);

  test("AC-STE-791.5 — `git rm <fr> <plan> && git commit`: two spec deletions named", async () => {
    await expectPermit(makeWorld(), `git rm ${FR_ACTIVE_PATH} ${PLAN_ACTIVE_PATH} && git commit -m ${MSG}`);
  }, T);

  test("AC-STE-791.5 — a staged spec-deletion-only set under a plain `git commit` passes", async () => {
    await expectPermit(makeWorld({ stageFrDeletion: true }), `git commit -m ${MSG}`);
  }, T);

  // Added after Stage B review (round 1): `git rm` flags never take the pass.
  for (const flag of ["-r", "--cached", "-f"]) {
    test(`AC-STE-791.6 — \`git rm ${flag} <fr> && git commit\` gets no pass`, async () => {
      await expectRefusal(makeWorld(), `git rm ${flag} ${FR_ACTIVE_PATH} && git commit -m ${MSG}`);
    }, T);
  }

  // Added after the audit: the tracked check under `git rm` holds for a file that IS on disk too.
  test("AC-STE-791.5 — an untracked spec file present on disk is refused by `git rm`", async () => {
    const w = makeWorld();
    writeAt(w.repo, "specs/frs/FX-9.md", "---\ntitle: untracked\n---\n");
    await expectRefusal(w, `git rm specs/frs/FX-9.md && git commit -m ${MSG}`);
  }, T);

  test("AC-STE-791.5 — an untracked spec path that does not exist on disk is still refused by `git rm`", async () => {
    await expectRefusal(makeWorld(), `git rm specs/frs/FX-9.md && git commit -m ${MSG}`);
  }, T);
});

describe("AC-STE-791.6 — a deletion outside the spec set gets no pass", () => {
  test("AC-STE-791.6 — `git rm src/app.ts && git commit` (a code deletion alone)", async () => {
    await expectRefusal(makeWorld(), `git rm src/app.ts && git commit -m ${MSG}`);
  }, T);

  test("AC-STE-791.6 — `git rm <fr> src/app.ts && git commit` (a code deletion beside a spec one)", async () => {
    await expectRefusal(makeWorld(), `git rm ${FR_ACTIVE_PATH} src/app.ts && git commit -m ${MSG}`);
  }, T);

  test("AC-STE-791.6 — `git add src/app.ts && git commit` with src/app.ts deleted on disk", async () => {
    await expectRefusal(makeWorld({ deleteCode: true }), `git add src/app.ts && git commit -m ${MSG}`);
  }, T);

  test("AC-STE-791.6 — `git add <deleted fr> <deleted src/app.ts> && git commit`", async () => {
    await expectRefusal(makeWorld({ deleteFr: true, deleteCode: true }), `git add ${FR_ACTIVE_PATH} src/app.ts && git commit -m ${MSG}`);
  }, T);

  test("AC-STE-791.6 — `git rm <fr> && git commit` beside an already staged code deletion", async () => {
    await expectRefusal(makeWorld({ stageCodeDeletion: true }), `git rm ${FR_ACTIVE_PATH} && git commit -m ${MSG}`);
  }, T);

  test("AC-STE-791.6 — `git rm <fr> && git commit` beside an unstaged code deletion left out of the rm", async () => {
    await expectRefusal(makeWorld({ deleteCode: true }), `git rm ${FR_ACTIVE_PATH} && git commit -m ${MSG}`);
  }, T);

  test("AC-STE-791.6 — a staged code deletion under a plain `git commit`", async () => {
    await expectRefusal(makeWorld({ stageCodeDeletion: true }), `git commit -m ${MSG}`);
  }, T);

  test("AC-STE-791.6 — `git rm <path outside the checkout> && git commit`", async () => {
    const w = makeWorld();
    const outside = resolve(w.repo, "..", "outside.md");
    writeFileSync(outside, frText());
    await expectRefusal(w, `git rm ${outside} && git commit -m ${MSG}`);
  }, T);
});

// ------------------------------------------------------------------- AC .7

describe("AC-STE-791.7 — the smoke-test skill documents the driver's gate evidence", () => {
  const SKILL = readFileSync(resolve(PLUGIN_ROOT, "..", "..", ".claude", "skills", "smoke-test", "SKILL.md"), "utf-8");

  function section(start: string, end: string): string {
    const a = SKILL.indexOf(start);
    const b = SKILL.indexOf(end, a + start.length);
    expect({ start: a >= 0, end: b > a }).toEqual({ start: true, end: true });
    return SKILL.slice(a, b);
  }

  test("AC-STE-791.7 — Phase 1 runs /gate-check and a standalone receipt call before the scaffold commit", () => {
    const p1 = section("### Phase 1 — Setup", "### Phase 2 — Run the canonical chain");
    const scaffold = p1.search(/git commit[^\n]*scaffold/);
    const receipt = p1.indexOf("gate_receipt.ts");
    const gate = p1.search(/\/(dev-process-toolkit:)?gate-check\b/);
    expect({ scaffold: scaffold >= 0, receipt: receipt >= 0, gate: gate >= 0 }).toEqual({ scaffold: true, receipt: true, gate: true });
    expect(receipt).toBeLessThan(scaffold);
  });

  test("AC-STE-791.7 — Phase 2 runs a standalone receipt call before the post-setup merge", () => {
    const p2 = section("### Phase 2 — Run the canonical chain", "### Phase 2.X");
    const merge = p2.indexOf("merge --no-ff chore/setup-bootstrap");
    const receipt = p2.indexOf("gate_receipt.ts");
    expect({ merge: merge >= 0, receipt: receipt >= 0 }).toEqual({ merge: true, receipt: true });
    expect(receipt).toBeLessThan(merge);
  });

  test("AC-STE-791.7 — Phase 9 carries a written setup recipe whose commits carry gate evidence", () => {
    const p9 = section("### Phase 9 —", "## Allowlist matrix");
    expect({
      recipe: /recipe/i.test(p9),
      commit: /git (-C \S+ )?commit\b/.test(p9),
      receipt: p9.includes("gate_receipt.ts"),
    }).toEqual({ recipe: true, commit: true, receipt: true });
  });

  test("AC-STE-791.7 — Phase 9 says the recipe never sets core.hooksPath, and no command in it does", () => {
    const p9 = section("### Phase 9 —", "## Allowlist matrix");
    const says = p9
      .split(/\n/)
      .some((l) => l.includes("core.hooksPath") && /\bnever\b|\bnot\b|\bno\b/i.test(l));
    const sets = /git\s+(-C\s+\S+\s+)?config\s+(--\S+\s+)*core\.hooksPath|-c\s+core\.hooksPath=/.test(p9);
    expect({ says, sets }).toEqual({ says: true, sets: false });
  });
});
