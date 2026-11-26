// STE-875 (M_4e7874) — the tracker gate's "not a plain invocation" note names
// the first construct that made the command non-plain.
//
// The contract these tests define:
//
//   NON_PLAIN_CONSTRUCTS  a frozen record exported by the hook module: a stable
//                         key → the name the note prints for that construct.
//   nonPlainConstruct(c)  the KEY of the first construct, by position in `c`,
//                         that takes `c` outside the plain-invocation grammar
//                         (`bunInvocation` / `simpleCommandWords`); null when
//                         the grammar reads `c` as one plain `bun [run] <abs
//                         module> <args>` command.
//   the note              today's sentence byte for byte through
//                         "— the latest: `<quote>`.", then, inside the same
//                         note, text carrying the construct's name.
//
// "First" is by position among the characters the grammar refuses. The two
// reasons the grammar only finds once every character passed — the first word
// is not `bun`, the module path is not absolute — and the nested-shell body
// (`bash -c "…"`, all quoted, so no character is refused) apply to a command
// with no refused character: `cd <dir> && bun run …` names `&&`, not `cd`.
//
// A command the grammar reads as plain but the gate still ignores — a
// same-named module outside this plugin — has no construct to name, so its
// note stays today's sentence and nothing more (the STE-868 suite pins that).
//
// Every refusal leg drives the SHIPPED `.sh` wrapper on a recorded PreToolUse
// payload over a synthetic transcript. The refusal to a bare transcript is the
// baseline: a leg's stderr is that baseline plus one contiguous note.
//
// Invented keys and paths only (PROJ-*, /srv/example/…, example.invalid).

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";

import * as hookModule from "../templates/hooks/_lib/hooks/pre-tracker-write-gate";
import {
  CLOUD,
  EPIC,
  JIRA,
  PLUGIN_ROOT,
  SESSION,
  Transcript,
  cleanupTemps,
  gate,
  makeWorld,
  refusalProblem,
  show,
  type World,
} from "./_m_b2fdc0_ste729_fixture";

// Spawned children (git, bash, bun) under full-suite load exceed bun's 5 s default.
setDefaultTimeout(120_000);

/** The hook module as this FR leaves it; the two new exports are absent before the fix. */
const hook = hookModule as unknown as {
  NON_PLAIN_CONSTRUCTS?: Readonly<Record<string, string>>;
  nonPlainConstruct?: (command: string) => string | null;
  scanAnnouncements: (lines: string[], sessionId: string) => { rejected: string[] };
};

/** The closed set, read at assertion time: `{}` while the export is missing. */
const constructs = (): Readonly<Record<string, string>> => hook.NON_PLAIN_CONSTRUCTS ?? {};
/** The helper's answer; "<nonPlainConstruct is not exported>" while it is missing (never a valid key, never null). */
const keyOf = (command: string): string | null =>
  typeof hook.nonPlainConstruct === "function" ? hook.nonPlainConstruct(command) : "<nonPlainConstruct is not exported>";

// ------------------------------------------------------------------- commands
// Never executed: a transcript only records them. The module is this plugin's
// own epic_close.ts, with the argv under which it writes a receipt.

const MODULE = join(PLUGIN_ROOT, "adapters", "_shared", "src", "epic_close.ts");
const MODULE_REL = "adapters/_shared/src/epic_close.ts";
const REPO = "/srv/example/demo-be";
const LISTING = "/srv/example/children.json";
const ARGS = `${REPO} ${EPIC} --children ${LISTING}`;
/** The accepted shape: one plain invocation. */
const PLAIN = `bun run "${MODULE}" ${ARGS}`;
/** The STE-802 shape, as the live close recorded it. */
const STE_802 = `bun run ${MODULE} ${ARGS}; echo "exit=$?"`;
/** Plain to the grammar, ignored by the gate: a same-named module outside this plugin. */
const STRAY = `bun run "/srv/example/stray/adapters/_shared/src/epic_close.ts" ${ARGS}`;

interface Row {
  /** The member of NON_PLAIN_CONSTRUCTS the command's note names. */
  key: string;
  label: string;
  command: string;
}

/** One rejected command per member of the closed set. */
const TABLE: Row[] = [
  { key: "semicolon", label: "`;` after the invocation", command: `${PLAIN}; echo done` },
  { key: "andAnd", label: "`cd <dir> &&` before the invocation", command: `cd "${REPO}" && ${PLAIN}` },
  { key: "orOr", label: "`||` after the invocation", command: `${PLAIN} || true` },
  { key: "pipe", label: "`|` into another program", command: `${PLAIN} | tail -5` },
  { key: "background", label: "a trailing `&`", command: `${PLAIN} &` },
  { key: "redirection", label: "a redirection (`2>&1`)", command: `${PLAIN} 2>&1` },
  { key: "subshell", label: "a `( … )` subshell", command: `( ${PLAIN} )` },
  { key: "shellBody", label: "a `bash -c` body", command: `bash -c "bun run '${MODULE}' ${ARGS}"` },
  { key: "variable", label: "a module path held in a variable", command: `bun run "$TOOLKIT_HOME/${MODULE_REL}" ${ARGS}` },
  {
    key: "commandSubstitution",
    label: "a `$(…)` command substitution",
    command: `bun run "$(git rev-parse --show-toplevel)/plugins/dev-process-toolkit/${MODULE_REL}" ${ARGS}`,
  },
  { key: "backslash", label: "a backslash-newline continuation", command: `bun run \\\n  "${MODULE}" \\\n  ${ARGS}` },
  { key: "newline", label: "a second command on the next line", command: `${PLAIN}\necho done` },
  { key: "tilde", label: "a `~` module path", command: `bun run ~/toolkit/${MODULE_REL} ${ARGS}` },
  { key: "glob", label: "a glob (`*`)", command: `bun run "${MODULE}" ${REPO} ${EPIC} --children /srv/example/child*.json` },
  { key: "comment", label: "a trailing `#` comment", command: `${PLAIN} # close the epic` },
  { key: "brace", label: "a `{…}` brace", command: `bun run "${MODULE}" ${REPO} ${EPIC} --children /srv/example/{children}.json` },
  { key: "history", label: "a leading `!`", command: `! ${PLAIN}` },
  { key: "leadingWord", label: "`bun` spelled by an absolute path", command: `/usr/local/bin/bun run "${MODULE}" ${ARGS}` },
  { key: "modulePath", label: "a relative module path", command: `bun run ${MODULE_REL} ${ARGS}` },
  { key: "other", label: "an unterminated quote (the catch-all)", command: `${PLAIN} 'unterminated` },
];
const TABLE_KEYS = TABLE.map((r) => r.key);

/** Further rejected commands: the first construct by position, quoting respected, look-alikes told apart. */
const MORE: Row[] = [
  { key: "pipe", label: "`… | tee <file>; echo` — the pipe comes first", command: `${PLAIN} | tee /srv/example/close.log; echo done` },
  { key: "semicolon", label: "`…; echo done | cat` — the semicolon comes first", command: `${PLAIN}; echo done | cat` },
  { key: "andAnd", label: "`&&` is not a background `&`", command: `${PLAIN} && echo ok` },
  { key: "background", label: "`&` followed by another command is not `&&`", command: `${PLAIN} & wait` },
  { key: "orOr", label: "`||` is not a pipe", command: `${PLAIN} || echo failed` },
  { key: "pipe", label: "`|` is not `||`", command: `${PLAIN} | cat` },
  { key: "redirection", label: "`2>&1 | tail` — the redirection comes before its own `&` and the pipe", command: `${PLAIN} 2>&1 | tail -3` },
  { key: "redirection", label: "an output redirection", command: `${PLAIN} > /srv/example/out.txt` },
  { key: "redirection", label: "an input redirection", command: `${PLAIN} < /dev/null` },
  { key: "semicolon", label: "the STE-802 shape", command: STE_802 },
  { key: "semicolon", label: "`F=<module>; bun run \"$F\" …` — the semicolon comes before the variable", command: `F="${MODULE}"; bun run "$F" ${ARGS}` },
  { key: "variable", label: "an unquoted `${VAR}` module path", command: `bun run \${TOOLKIT_HOME}/${MODULE_REL} ${ARGS}` },
  {
    key: "commandSubstitution",
    label: "a backtick substitution",
    command: `bun run "${MODULE}" ${REPO} ${EPIC} --children \`ls ${LISTING}\``,
  },
  { key: "pipe", label: "a `;` inside double quotes is no construct: the later pipe is named", command: `bun run "${MODULE}" "/srv/example/a;b" ${EPIC} --children ${LISTING} | cat` },
  { key: "semicolon", label: "a `$` inside single quotes is no construct: the later semicolon is named", command: `bun run "${MODULE}" '/srv/example/$be' ${EPIC} --children ${LISTING}; echo done` },
  { key: "shellBody", label: "a `bash -c` body holding `&&` inside its quotes", command: `bash -c 'cd ${REPO} && bun run "${MODULE}" ${ARGS}'` },
  { key: "leadingWord", label: "an environment-variable prefix", command: `DPT_TRACE=1 ${PLAIN}` },
  { key: "modulePath", label: "a `./` module path", command: `bun run ./${MODULE_REL} ${ARGS}` },
];

/** Rejected commands whose member is the implementer's call; each still gets a member of the set. */
const ODD: Array<{ label: string; command: string }> = [
  { label: "a no-break space", command: `${PLAIN} --verbose` },
  { label: "a flag where the module path belongs", command: `bun run --silent "${MODULE}" ${ARGS}` },
  { label: "a `/bin/sh -c` body", command: `/bin/sh -c 'bun run "${MODULE}" ${ARGS}'` },
  { label: "a carriage return between two commands", command: `${PLAIN}\r\necho done` },
  { label: "a look-alike of the plugin-root variable", command: `bun run "$CLAUDE_PLUGIN_ROOTX/${MODULE_REL}" ${ARGS}` },
  { label: "redirection, background and all", command: `bun "${MODULE}" ${ARGS} >/dev/null 2>&1 &` },
];

// ------------------------------------------------------------------- the gate

let w: World;
let baseline = ""; // stderr of the close refused on a transcript with no deciding command

afterAll(() => cleanupTemps());

/** A transcript of Bash calls, each with a successful result carrying no announcement. */
function bashes(...commands: string[]): Transcript {
  const t = new Transcript();
  for (const c of commands) t.bash(c, "done");
  return t;
}

/** The Epic close graded on `t` is an NFR-10 refusal, and the gate did not throw. Returns its stderr. */
async function refusedClose(t: Transcript): Promise<string> {
  const r = await gate(PLUGIN_ROOT, JIRA("transitionJiraIssue"), { cloudId: CLOUD, issueIdOrKey: EPIC, transition: { id: "41" } }, t, w.root);
  expect(refusalProblem(r), show(r)).toBeNull();
  expect(r.stderr).not.toContain("failed while checking this call");
  return r.stderr;
}

beforeAll(async () => {
  w = makeWorld();
  baseline = await refusedClose(new Transcript());
  if (baseline.includes("not a plain invocation, so any receipt")) throw new Error(`fixture: the bare close must carry no note:\n${baseline}`);
});

/**
 * How the note quotes a command: its first 240 characters, then an ellipsis.
 * The refusal is printed one line per part, so a newline inside the quote
 * reaches stderr as a space.
 */
const cited = (command: string): string =>
  (command.length > 240 ? `${command.slice(0, 240)}…` : command).replace(/\r?\n/g, " ");
/** Today's sentence for `count` rejected commands, the latest being `command`. */
const todaysSentence = (count: number, command: string): string =>
  ` ${count} Bash command(s) ran a deciding subcommand in a shape that is not a plain invocation, so any receipt they wrote was ignored — the latest: \`${cited(command)}\`.`;
const ANY_NOTE = "in a shape that is not a plain invocation, so any receipt";

/**
 * What the refusal carries right after today's sentence, inside the same note:
 * "" on the code before the fix. Today's sentence is there byte for byte, and
 * everything before it and after the note is the baseline refusal, unchanged.
 */
function afterSentence(stderr: string, count: number, command: string): string {
  const sentence = todaysSentence(count, command);
  const at = stderr.indexOf(sentence);
  expect(at, `today's sentence is missing or altered:\n${stderr}`).toBeGreaterThanOrEqual(0);
  const before = stderr.slice(0, at);
  expect(baseline.startsWith(before), `the refusal changed before the note:\n${stderr}`).toBe(true);
  const rest = baseline.slice(before.length);
  const after = stderr.slice(at + sentence.length);
  expect(after.endsWith(rest), `the refusal changed after the note:\n${stderr}`).toBe(true);
  return after.slice(0, after.length - rest.length);
}

/** The keys of the closed set whose names `text` carries. */
const namedIn = (text: string): string[] =>
  Object.entries(constructs())
    .filter(([, name]) => typeof name === "string" && name !== "" && text.includes(name))
    .map(([key]) => key);

/** The note for `count` rejected commands, the latest being `command`, names member `key` and no other. */
function expectNamed(stderr: string, count: number, command: string, key: string): void {
  const added = afterSentence(stderr, count, command);
  expect(added.trim(), `the note names no construct:\n${stderr}`).not.toBe("");
  const name = constructs()[key];
  expect(typeof name === "string" && name !== "", `NON_PLAIN_CONSTRUCTS has no name for "${key}"`).toBe(true);
  expect(added).toContain(name as string);
  expect(namedIn(added), `the note must name "${key}" alone: ${JSON.stringify(added)}`).toEqual([key]);
}

// ===========================================================================
// AC-STE-875.1 — the closed set, the helper, and the note that reads it
// ===========================================================================

describe("AC-STE-875.1 — the hook module exports the closed set of non-plain constructs", () => {
  test("AC-STE-875.1 — NON_PLAIN_CONSTRUCTS is a frozen record of non-empty names", () => {
    const set = hook.NON_PLAIN_CONSTRUCTS;
    expect(set !== null && typeof set === "object" && !Array.isArray(set), "NON_PLAIN_CONSTRUCTS must be an exported record").toBe(true);
    expect(Object.isFrozen(set)).toBe(true);
    const bad = Object.entries(set!).filter(([, name]) => typeof name !== "string" || name.trim() === "");
    expect(bad).toEqual([]);
    expect(Object.keys(set!).length).toBeGreaterThan(0);
  });

  test("AC-STE-875.1 — the set is exactly the members this suite has a rejected command for", () => {
    expect(Object.keys(constructs()).sort()).toEqual([...TABLE_KEYS].sort());
  });

  const SPELLED: Array<[string, string]> = [
    ["semicolon", "`;`"],
    ["andAnd", "`&&`"],
    ["orOr", "`||`"],
    ["pipe", "`|`"],
    ["background", "`&`"],
    ["shellBody", "-c"],
    ["variable", "$"],
  ];
  for (const [key, literal] of SPELLED) {
    test(`AC-STE-875.1 — the name of "${key}" spells ${literal}`, () => {
      expect(constructs()[key] ?? `<no member "${key}">`).toContain(literal);
    });
  }

  const DESCRIBED: Array<[string, RegExp]> = [
    ["redirection", /redirect/i],
    ["subshell", /subshell/i],
    ["variable", /variable/i],
  ];
  for (const [key, word] of DESCRIBED) {
    test(`AC-STE-875.1 — the name of "${key}" says ${word}`, () => {
      expect(constructs()[key] ?? `<no member "${key}">`).toMatch(word);
    });
  }

  test("AC-STE-875.1 — no name is contained in another, so a note naming one member names no second", () => {
    const names = Object.entries(constructs());
    expect(names.length).toBe(TABLE_KEYS.length);
    const clashes = names.flatMap(([a, an]) => names.filter(([b, bn]) => a !== b && bn.includes(an)).map(([b]) => `${a} ⊂ ${b}`));
    expect(clashes).toEqual([]);
  });
});

describe("AC-STE-875.1 — nonPlainConstruct is null exactly for a command the grammar reads as plain", () => {
  const PLAIN_SHAPES: Array<[string, string]> = [
    ["the accepted invocation", PLAIN],
    ["the accepted invocation with one final newline", `${PLAIN}\n`],
    ["`bun <module>` with no `run`", `bun "${MODULE}" ${ARGS}`],
    ["the plugin root spelled as ${CLAUDE_PLUGIN_ROOT}", `bun run "\${CLAUDE_PLUGIN_ROOT}/${MODULE_REL}" ${ARGS}`],
    ["a same-named module outside this plugin (plain, though the gate ignores it)", STRAY],
  ];
  for (const [label, command] of PLAIN_SHAPES) {
    test(`AC-STE-875.1 — ${label} → null`, () => {
      expect(keyOf(command)).toBeNull();
    });
  }
});

describe("AC-STE-875.1 — every rejected non-plain command gets a member of the set", () => {
  const all = [...TABLE, ...MORE, ...ODD];
  for (const { label, command } of all) {
    test(`AC-STE-875.1 — ${label}`, () => {
      // The fixture's own claim first: the scan lists this command as rejected.
      expect(hook.scanAnnouncements(bashes(command).lines, SESSION).rejected).toEqual([command]);
      const key = keyOf(command);
      expect(Object.keys(constructs())).toContain(key as string);
    });
  }
});

describe("AC-STE-875.1 — the note names the construct of the latest rejected command, beside its quote", () => {
  test("AC-STE-875.1 — of three rejected commands, the latest one's construct is named and the earlier ones' are not", async () => {
    const latest = `${PLAIN} | tail -5`;
    const stderr = await refusedClose(bashes(`${PLAIN}; echo done`, `cd "${REPO}" && ${PLAIN}`, latest));
    expectNamed(stderr, 3, latest, "pipe");
  });

  test("AC-STE-875.1 — a construct beyond the 240-character cut of the quote is still named", async () => {
    const long = `bun run "${MODULE}" /srv/example/${"d".repeat(260)} ${EPIC} --children ${LISTING}; echo done`;
    expect(long.indexOf(";")).toBeGreaterThan(240);
    expectNamed(await refusedClose(bashes(long)), 1, long, "semicolon");
  });
});

// ===========================================================================
// AC-STE-875.2 — one rejected command per member, and the first of two wins
// ===========================================================================

describe("AC-STE-875.2 — the table covers the closed set", () => {
  test("AC-STE-875.2 — every member of NON_PLAIN_CONSTRUCTS has a row", () => {
    const members = Object.keys(constructs());
    expect(members.length, "NON_PLAIN_CONSTRUCTS is missing or empty").toBeGreaterThan(0);
    expect(members.filter((k) => !TABLE_KEYS.includes(k))).toEqual([]);
  });

  test("AC-STE-875.2 — the table holds one row per member, none twice", () => {
    expect(new Set(TABLE_KEYS).size).toBe(TABLE_KEYS.length);
  });
});

describe("AC-STE-875.2 — nonPlainConstruct returns each row's member", () => {
  for (const { key, label, command } of TABLE) {
    test(`AC-STE-875.2 — ${label} → "${key}"`, () => {
      expect(keyOf(command)).toBe(key);
    });
  }
});

describe("AC-STE-875.2 — the refusal note for each row names that member", () => {
  for (const { key, label, command } of TABLE) {
    test(`AC-STE-875.2 — ${label}: the note names "${key}"`, async () => {
      expectNamed(await refusedClose(bashes(command)), 1, command, key);
    });
  }
});

describe("AC-STE-875.2 — the first construct by position is the one named", () => {
  for (const { key, label, command } of MORE) {
    test(`AC-STE-875.2 — ${label} → "${key}"`, () => {
      expect(keyOf(command)).toBe(key);
    });
  }

  test("AC-STE-875.2 — `… | tee <file>; echo done`: the note names the pipe, not the semicolon", async () => {
    const command = `${PLAIN} | tee /srv/example/close.log; echo done`;
    expectNamed(await refusedClose(bashes(command)), 1, command, "pipe");
  });

  test("AC-STE-875.2 — `…; echo done | cat`: the note names the semicolon, not the pipe", async () => {
    const command = `${PLAIN}; echo done | cat`;
    expectNamed(await refusedClose(bashes(command)), 1, command, "semicolon");
  });

  test("AC-STE-875.2 — `… && echo ok`: the note names `&&`, not the background `&`", async () => {
    const command = `${PLAIN} && echo ok`;
    expectNamed(await refusedClose(bashes(command)), 1, command, "andAnd");
  });

  test("AC-STE-875.2 — `… || echo failed`: the note names `||`, not the pipe", async () => {
    const command = `${PLAIN} || echo failed`;
    expectNamed(await refusedClose(bashes(command)), 1, command, "orOr");
  });
});

// ===========================================================================
// AC-STE-875.3 — Regression: the STE-802 shape names `;`
// ===========================================================================

describe("AC-STE-875.3 — Regression: `bun run <module> <args>; echo \"exit=$?\"` yields a note naming `;`", () => {
  test("AC-STE-875.3 — Regression: the STE-802 command's note names the semicolon beside the quoted command", async () => {
    const stderr = await refusedClose(bashes(STE_802));
    // Today's sentence quotes the command; what follows it in the note is "" before the fix.
    const added = afterSentence(stderr, 1, STE_802);
    expect(added, `the note names no construct:\n${stderr}`).toContain("`;`");
    const name = constructs().semicolon;
    expect(typeof name === "string" && name !== "", "NON_PLAIN_CONSTRUCTS has no semicolon member").toBe(true);
    expect(added).toContain(name as string);
    expect(namedIn(added)).toEqual(["semicolon"]);
  });
});

// ===========================================================================
// AC-STE-875.4 — Unchanged: what is counted, quoted, superseded, and the rest
// of the refusal. Green before the fix by design.
// ===========================================================================

describe("AC-STE-875.4 — Unchanged: which commands the note counts and cites", () => {
  test("AC-STE-875.4 — three rejected commands: the sentence counts 3 and cites the latest", async () => {
    const latest = `${PLAIN} | tail -5`;
    const stderr = await refusedClose(bashes(`${PLAIN}; echo done`, `cd "${REPO}" && ${PLAIN}`, latest));
    expect(stderr).toContain(todaysSentence(3, latest));
  });

  test("AC-STE-875.4 — a rejected command a later accepted run superseded draws no note", async () => {
    const t = bashes(STE_802);
    t.bash(PLAIN, "Exit code 1\nRefusing: one child is open", true);
    expect(await refusedClose(t)).toBe(baseline);
  });

  test("AC-STE-875.4 — of two rejected commands, a later accepted run of the module drops both", async () => {
    expect(await refusedClose(bashes(STE_802, `${PLAIN} | tail -5`, PLAIN))).toBe(baseline);
  });

  test("AC-STE-875.4 — an accepted run BEFORE the rejected command supersedes nothing: the sentence counts 1", async () => {
    expect(await refusedClose(bashes(PLAIN, STE_802))).toContain(todaysSentence(1, STE_802));
  });

  test("AC-STE-875.4 — an accepted plain invocation alone draws no note", async () => {
    expect(await refusedClose(bashes(PLAIN))).toBe(baseline);
  });

  test("AC-STE-875.4 — commands that only grep or echo the module draw no note", async () => {
    const stderr = await refusedClose(
      bashes(`grep -n "epic_close.ts" /srv/example/notes.md`, `echo "bun run ${MODULE} ${ARGS}"`, `bun --version; echo "next: epic_close.ts ${ARGS}"`),
    );
    expect(stderr).toBe(baseline);
  });

  test("AC-STE-875.4 — the scan's accepted/rejected split is unchanged for the table", () => {
    const rejected = [...TABLE, ...MORE].map((r) => r.command);
    const t = new Transcript();
    for (const c of rejected) t.bash(c, "done");
    expect(hook.scanAnnouncements(t.lines, SESSION).rejected).toEqual(rejected);
    t.bash(PLAIN, "done");
    expect(hook.scanAnnouncements(t.lines, SESSION).rejected).toEqual([]);
  });
});

describe("AC-STE-875.4 — Unchanged: the 240-character quote cap", () => {
  const LONG = `bun run "${MODULE}" /srv/example/${"d".repeat(260)} ${EPIC} --children ${LISTING}; echo done`;

  test("AC-STE-875.4 — a rejected command longer than 240 characters is quoted as its first 240 and `…`", async () => {
    const stderr = await refusedClose(bashes(LONG));
    expect(stderr).toContain(`— the latest: \`${LONG.slice(0, 240)}…\`.`);
  });

  test("AC-STE-875.4 — a rejected command of exactly 240 characters is quoted whole, with no `…`", async () => {
    const stem = `bun run "${MODULE}" /srv/example/ ${EPIC} --children ${LISTING} | cat`;
    const exact = stem.replace("/srv/example/ ", `/srv/example/${"d".repeat(240 - stem.length)} `);
    expect(exact.length).toBe(240);
    expect(await refusedClose(bashes(exact))).toContain(`— the latest: \`${exact}\`.`);
  });
});

describe("AC-STE-875.4 — Unchanged: the refusal's other lines", () => {
  test("AC-STE-875.4 — with a note, everything before today's sentence and after the note is the bare refusal", async () => {
    const stderr = await refusedClose(bashes(STE_802));
    const added = afterSentence(stderr, 1, STE_802);
    const sentence = todaysSentence(1, STE_802);
    expect(stderr.replace(sentence + added, "")).toBe(baseline);
    expect(added).not.toContain("\n");
  });

  test("AC-STE-875.4 — the Remedy and Context lines are byte-identical with and without a note", async () => {
    const lines = (s: string): string[] => s.split("\n").filter((l) => /^(Remedy|Context): /.test(l));
    expect(lines(baseline).length).toBe(2);
    expect(lines(await refusedClose(bashes(`cd "${REPO}" && ${PLAIN}`)))).toEqual(lines(baseline));
  });

  test("AC-STE-875.4 — a plain command on a same-named module outside this plugin keeps today's sentence and gains nothing", async () => {
    const stderr = await refusedClose(bashes(STRAY));
    expect(stderr).toContain(todaysSentence(1, STRAY));
    expect(stderr.replace(todaysSentence(1, STRAY), "")).toBe(baseline);
  });

  test("AC-STE-875.4 — the bare refusal carries no note at all", () => {
    expect(baseline).not.toContain(ANY_NOTE);
  });
});

// ===========================================================================
// Hardening — the helper runs inside a hook that must never throw
// ===========================================================================

describe("AC-STE-875.1 — hardening: nonPlainConstruct is total over any string", () => {
  const members = (): string[] => Object.keys(hook.NON_PLAIN_CONSTRUCTS ?? {});
  const ODD_INPUTS: Array<[string, string]> = [
    ["the empty string", ""],
    ["blanks only", " \t "],
    ["a lone dollar", "$"],
    ["a dollar at the end of a word", "bun run /srv/example/x.ts $"],
    ["an unterminated single quote", "bun run '/srv/example/x.ts"],
    ["an unterminated double quote", 'bun run "/srv/example/x.ts'],
    ["a lone high surrogate", "bun run /srv/example/\ud83d.ts"],
    ["a lone low surrogate inside quotes", 'bun run "/srv/example/\udc00.ts"'],
    ["a NUL byte", "bun run /srv/example/x.ts\u0000"],
    ["a megabyte of one word", `bun run /srv/example/${"a".repeat(1_000_000)}.ts`],
    ["a megabyte of quoted text", `bun run "/srv/example/${"b".repeat(1_000_000)}`],
  ];
  for (const [name, command] of ODD_INPUTS) {
    test(`AC-STE-875.1 — ${name}: returns null or a member, and never throws`, () => {
      let key: unknown;
      expect(() => {
        key = hook.nonPlainConstruct(command);
      }).not.toThrow();
      if (key !== null) expect(members()).toContain(key as string);
    });
  }

  test("AC-STE-875.1 — the empty string and a lone dollar are named, not passed as plain", () => {
    expect(hook.nonPlainConstruct("")).toBe("leadingWord");
    expect(hook.nonPlainConstruct("$")).toBe("variable");
  });
});
