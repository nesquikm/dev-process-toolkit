// STE-735 (M_b2fdc0) — the spawn allow-list probe grades only repositories
// that spawn children.
//
// AC-STE-735.1  `runSpawnPatternAllowlistProbe` scans `.claude/settings.json`
//               only when `.claude/skills/smoke-test/SKILL.md` exists;
//               otherwise the report is vacuous, with a note naming the
//               missing scaffold as the reason.
// AC-STE-735.2  With the scaffold present, every verdict equals v3.3.0's,
//               malformed settings included (pinned grid below, captured from
//               the v3.3.0 module before the change).
// AC-STE-735.3  The module header and line 149 of skills/gate-check/SKILL.md
//               say the probe is scoped to the scaffold, in place, cap 358.
// AC-STE-735.4  Twins + a sited mutation removing the scaffold condition.
//
// Report shape fixed by this suite: `{ violations, vacuous: boolean,
// notes: string[] }`. Temporary project roots only; the real tree is never
// mutated (porcelain compared before/after the mutation battery).

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runSpawnPatternAllowlistProbe } from "../adapters/_shared/src/spawn_pattern_allowlist";
import { mutateInRegion } from "./_sited-mutation";

setDefaultTimeout(120_000);

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const MODULE_REL = "adapters/_shared/src/spawn_pattern_allowlist.ts";
const GATE_CHECK_SKILL = join(PLUGIN_ROOT, "skills", "gate-check", "SKILL.md");
const SCAFFOLD_REL = ".claude/skills/smoke-test/SKILL.md";
const SETTINGS_REL = ".claude/settings.json";
const P = "Bash(claude:*)";

type Probe = typeof runSpawnPatternAllowlistProbe;
interface Report {
  violations: { file: string; line: number; note: string; message: string; severity: string }[];
  vacuous?: unknown;
  notes?: unknown;
}

// ---------- fixture shapes ----------

const settings = (allow: string[]) => JSON.stringify({ permissions: { allow } }, null, 2);
const heredoc = (withPattern: boolean) => [
  "   ```bash",
  "   mkdir -p .claude",
  "   cat > .claude/settings.json <<'EOF'",
  "   {",
  '     "permissions": {',
  '       "allow": [',
  withPattern ? `         "Bash(git *)", "${P}"` : '         "Bash(git *)"',
  "       ]",
  "     }",
  "   }",
  "   EOF",
  "   ```",
];

const SETTINGS: Record<string, string | null> = {
  absent: null,
  with: settings(["Bash(bun:*)", P, "Read"]),
  without: settings(["Bash(bun:*)", "Bash(git:*)", "Read"]),
  malformed: '{ "permissions": { "allow": [ oops',
  noAllow: JSON.stringify({ permissions: {} }, null, 2),
  allowNotArray: JSON.stringify({ permissions: { allow: P } }, null, 2),
  topArray: JSON.stringify([P]),
};

const SCAFFOLDS: Record<string, string> = {
  with: ["6. **Pre-create.**", "", ...heredoc(true)].join("\n"),
  without: ["6. **Pre-create.**", "", ...heredoc(false)].join("\n"),
  noHeredoc: ["# smoke-test", "", `Spawn lines match \`${P}\`.`].join("\n"),
  mixed: ["# two", "", ...heredoc(true), "", ...heredoc(false)].join("\n"),
  empty: "",
};

const temps: string[] = [];
function project(opts: { settings?: string | null; scaffold?: string | null }): string {
  const root = mkdtempSync(join(tmpdir(), "ste735-"));
  temps.push(root);
  if (opts.settings != null) {
    mkdirSync(join(root, ".claude"), { recursive: true });
    writeFileSync(join(root, SETTINGS_REL), opts.settings);
  }
  if (opts.scaffold != null) {
    mkdirSync(join(root, ".claude", "skills", "smoke-test"), { recursive: true });
    writeFileSync(join(root, SCAFFOLD_REL), opts.scaffold);
  }
  return root;
}
afterAll(() => {
  for (const t of temps) rmSync(t, { recursive: true, force: true });
});

function notesOf(r: Report): string[] {
  return Array.isArray(r.notes) ? (r.notes as unknown[]).map(String) : [];
}

// ---------- the twins (AC-STE-735.4), shared with the mutation battery ----------

const TWIN_NO_SCAFFOLD = "AC-STE-735.4 twin: settings lacking the pattern, no scaffold ⇒ vacuous";
const TWIN_WITH_SCAFFOLD = "AC-STE-735.4 twin: same settings, scaffold present ⇒ fails";

/** Returns null when the leg holds, else a reason. */
const LEGS: Record<string, (probe: Probe) => Promise<string | null>> = {
  [TWIN_NO_SCAFFOLD]: async (probe) => {
    const root = project({ settings: SETTINGS.without });
    const r = (await probe(root)) as Report;
    if (r.violations.length !== 0) return `expected zero violations, got ${r.violations.map((v) => v.note).join(" | ")}`;
    if (r.vacuous !== true) return `expected vacuous: true, got ${String(r.vacuous)}`;
    if (!notesOf(r).some((n) => n.includes(SCAFFOLD_REL))) return `expected a note naming ${SCAFFOLD_REL}, got ${JSON.stringify(r.notes)}`;
    return null;
  },
  [TWIN_WITH_SCAFFOLD]: async (probe) => {
    const root = project({ settings: SETTINGS.without, scaffold: SCAFFOLDS.with });
    const r = (await probe(root)) as Report;
    if (r.vacuous !== false) return `expected vacuous: false, got ${String(r.vacuous)}`;
    const notes = r.violations.map((v) => v.note);
    if (r.violations.length !== 1 || !notes[0]!.startsWith(`${SETTINGS_REL}:3 — permissions.allow lacks`)) {
      return `expected exactly the settings violation at line 3, got ${JSON.stringify(notes)}`;
    }
    return null;
  },
};

// ---------- AC-STE-735.1 ----------

describe("AC-STE-735.1 — settings graded only where the smoke-test scaffold exists", () => {
  for (const [name, body] of Object.entries(SETTINGS)) {
    test(`no scaffold, settings=${name} ⇒ vacuous, zero violations, note names the missing scaffold`, async () => {
      const r = (await runSpawnPatternAllowlistProbe(project({ settings: body }))) as Report;
      expect(r.violations).toEqual([]);
      expect(r.vacuous).toBe(true);
      const notes = notesOf(r);
      expect(notes.length).toBeGreaterThan(0);
      expect(notes.some((n) => n.includes(SCAFFOLD_REL))).toBe(true);
    });
  }

  test("the vacuous note says WHY — the scaffold is missing / absent", async () => {
    const r = (await runSpawnPatternAllowlistProbe(project({ settings: SETTINGS.without }))) as Report;
    const note = notesOf(r).find((n) => n.includes(SCAFFOLD_REL)) ?? "";
    expect(note).toMatch(/absent|missing|not found|does not exist|no /i);
  });

  test("a .claude/skills/smoke-test directory WITHOUT SKILL.md is still no scaffold ⇒ vacuous", async () => {
    const root = project({ settings: SETTINGS.malformed });
    mkdirSync(join(root, ".claude", "skills", "smoke-test"), { recursive: true });
    const r = (await runSpawnPatternAllowlistProbe(root)) as Report;
    expect(r.violations).toEqual([]);
    expect(r.vacuous).toBe(true);
  });

  test("scaffold present ⇒ not vacuous, even when every verdict passes", async () => {
    const r = (await runSpawnPatternAllowlistProbe(project({ settings: SETTINGS.with, scaffold: SCAFFOLDS.with }))) as Report;
    expect(r.violations).toEqual([]);
    expect(r.vacuous).toBe(false);
  });

  test("this repository still carries the scaffold, so it is still graded (and green)", async () => {
    expect(existsSync(join(REPO_ROOT, SCAFFOLD_REL))).toBe(true);
    const r = (await runSpawnPatternAllowlistProbe(REPO_ROOT)) as Report;
    expect(r.vacuous).toBe(false);
    expect(r.violations.map((v) => v.note)).toEqual([]);
  });
});

// ---------- AC-STE-735.2 ----------

// Pinned from the v3.3.0 module (captured before the change): S = settings
// surface, K = scaffold surface; line; reason code.
type Row = ["S" | "K", number, "SETTINGS_LACKS" | "MALFORMED" | "HEREDOC_LACKS" | "NO_HEREDOC"];
const V330: Record<string, Row[]> = {
  "absent|with": [],
  "absent|without": [["K", 5, "HEREDOC_LACKS"]],
  "absent|noHeredoc": [["K", 1, "NO_HEREDOC"]],
  "absent|mixed": [["K", 18, "HEREDOC_LACKS"]],
  "absent|empty": [["K", 1, "NO_HEREDOC"]],
  "with|with": [],
  "with|without": [["K", 5, "HEREDOC_LACKS"]],
  "with|noHeredoc": [["K", 1, "NO_HEREDOC"]],
  "with|mixed": [["K", 18, "HEREDOC_LACKS"]],
  "with|empty": [["K", 1, "NO_HEREDOC"]],
  "without|with": [["S", 3, "SETTINGS_LACKS"]],
  "without|without": [["S", 3, "SETTINGS_LACKS"], ["K", 5, "HEREDOC_LACKS"]],
  "without|noHeredoc": [["S", 3, "SETTINGS_LACKS"], ["K", 1, "NO_HEREDOC"]],
  "without|mixed": [["S", 3, "SETTINGS_LACKS"], ["K", 18, "HEREDOC_LACKS"]],
  "without|empty": [["S", 3, "SETTINGS_LACKS"], ["K", 1, "NO_HEREDOC"]],
  "malformed|with": [["S", 1, "MALFORMED"]],
  "malformed|without": [["S", 1, "MALFORMED"], ["K", 5, "HEREDOC_LACKS"]],
  "malformed|noHeredoc": [["S", 1, "MALFORMED"], ["K", 1, "NO_HEREDOC"]],
  "malformed|mixed": [["S", 1, "MALFORMED"], ["K", 18, "HEREDOC_LACKS"]],
  "malformed|empty": [["S", 1, "MALFORMED"], ["K", 1, "NO_HEREDOC"]],
  "noAllow|with": [["S", 1, "SETTINGS_LACKS"]],
  "noAllow|without": [["S", 1, "SETTINGS_LACKS"], ["K", 5, "HEREDOC_LACKS"]],
  "noAllow|noHeredoc": [["S", 1, "SETTINGS_LACKS"], ["K", 1, "NO_HEREDOC"]],
  "noAllow|mixed": [["S", 1, "SETTINGS_LACKS"], ["K", 18, "HEREDOC_LACKS"]],
  "noAllow|empty": [["S", 1, "SETTINGS_LACKS"], ["K", 1, "NO_HEREDOC"]],
  "allowNotArray|with": [["S", 3, "SETTINGS_LACKS"]],
  "allowNotArray|without": [["S", 3, "SETTINGS_LACKS"], ["K", 5, "HEREDOC_LACKS"]],
  "allowNotArray|noHeredoc": [["S", 3, "SETTINGS_LACKS"], ["K", 1, "NO_HEREDOC"]],
  "allowNotArray|mixed": [["S", 3, "SETTINGS_LACKS"], ["K", 18, "HEREDOC_LACKS"]],
  "allowNotArray|empty": [["S", 3, "SETTINGS_LACKS"], ["K", 1, "NO_HEREDOC"]],
  "topArray|with": [["S", 1, "SETTINGS_LACKS"]],
  "topArray|without": [["S", 1, "SETTINGS_LACKS"], ["K", 5, "HEREDOC_LACKS"]],
  "topArray|noHeredoc": [["S", 1, "SETTINGS_LACKS"], ["K", 1, "NO_HEREDOC"]],
  "topArray|mixed": [["S", 1, "SETTINGS_LACKS"], ["K", 18, "HEREDOC_LACKS"]],
  "topArray|empty": [["S", 1, "SETTINGS_LACKS"], ["K", 1, "NO_HEREDOC"]],
};

const REASONS: Record<Row[2], string> = {
  SETTINGS_LACKS: `permissions.allow lacks the child-spawn pattern "${P}"`,
  MALFORMED:
    `settings JSON is malformed — presence of the child-spawn pattern "${P}" ` +
    `in permissions.allow cannot be verified (fail-closed)`,
  HEREDOC_LACKS: `settings-writing scaffold heredoc lacks the child-spawn pattern "${P}" in its allow-list`,
  NO_HEREDOC:
    "no settings-writing scaffold heredoc (`cat > .claude/settings.json <<'EOF'`) found — " +
    `presence of the child-spawn pattern "${P}" cannot be verified (fail-closed)`,
};

describe("AC-STE-735.2 — scaffold present ⇒ every verdict equals v3.3.0", () => {
  test("the grid covers every settings shape × every scaffold shape", () => {
    expect(Object.keys(V330).sort()).toEqual(
      Object.keys(SETTINGS).flatMap((s) => Object.keys(SCAFFOLDS).map((k) => `${s}|${k}`)).sort(),
    );
  });

  for (const [key, rows] of Object.entries(V330)) {
    test(`settings|scaffold = ${key}`, async () => {
      const [s, k] = key.split("|") as [string, string];
      const root = project({ settings: SETTINGS[s]!, scaffold: SCAFFOLDS[k]! });
      const r = (await runSpawnPatternAllowlistProbe(root)) as Report;
      const expected = rows.map(([surf, line, code]) => {
        const rel = surf === "S" ? SETTINGS_REL : SCAFFOLD_REL;
        return { file: join(root, rel), line, note: `${rel}:${line} — ${REASONS[code]}`, severity: "error" };
      });
      expect(r.violations.map(({ file, line, note, severity }) => ({ file, line, note, severity }))).toEqual(expected);
      for (const v of r.violations) {
        expect(v.message.startsWith(`spawn_pattern_allowlist: ${v.note}\n`)).toBe(true);
        expect(v.message).toMatch(/\nRemedy: /);
        expect(v.message).toMatch(/\nContext: /);
      }
      expect(r.vacuous).toBe(false);
    });
  }
});

// ---------- AC-STE-735.3 ----------

function moduleHeader(): string {
  const lines = readFileSync(join(PLUGIN_ROOT, MODULE_REL), "utf-8").split("\n");
  const out: string[] = [];
  for (const l of lines) {
    if (!l.startsWith("//")) break;
    out.push(l.replace(/^\/\/ ?/, ""));
  }
  return out.join(" ").replace(/\s+/g, " ");
}

/** A sentence saying the settings surface is graded only when/where the scaffold exists. */
function scopedSentence(text: string): string | undefined {
  return text
    .split(/(?<=[.;])\s+/)
    .find(
      (s) =>
        /\bonly (when|where|if)\b/i.test(s) &&
        s.includes("settings.json") &&
        s.includes("smoke-test/SKILL.md"),
    );
}

describe("AC-STE-735.3 — header and gate-check line 149 say the probe is scaffold-scoped", () => {
  test("module header states the settings surface is graded only when the scaffold exists", () => {
    const h = moduleHeader();
    expect(h.length).toBeGreaterThan(0);
    expect(scopedSentence(h)).toBeDefined();
  });

  test("module header no longer claims per-surface vacuity for an absent settings file", () => {
    expect(moduleHeader()).not.toContain("Vacuous when a surface's file is absent");
  });

  test("gate-check SKILL.md line 149 is still probe #62, edited in place", () => {
    const lines = readFileSync(GATE_CHECK_SKILL, "utf-8").split("\n");
    expect(lines[148]!.startsWith("62. **`spawn_pattern_allowlist`**")).toBe(true);
    expect(lines[149]!.startsWith("63. ")).toBe(true);
    expect(lines.filter((l) => l.includes("`spawn_pattern_allowlist`")).length).toBe(1);
  });

  test("gate-check SKILL.md line 149 states the scaffold scope and drops the old vacuity clause", () => {
    const line = readFileSync(GATE_CHECK_SKILL, "utf-8").split("\n")[148]!;
    expect(scopedSentence(line)).toBeDefined();
    expect(line).not.toContain("Vacuous when a surface's file is absent (toolkit consumers ship neither)");
    expect(line).toContain("tests/m_b2fdc0-ste-735-scaffold-scope.test.ts");
  });

  test("gate-check SKILL.md stays within the NFR-1 line cap (358)", () => {
    const n = readFileSync(GATE_CHECK_SKILL, "utf-8").split("\n").length;
    expect(n).toBeLessThanOrEqual(358);
  });
});

// ---------- AC-STE-735.4 ----------

describe("AC-STE-735.4 — twins", () => {
  for (const [name, leg] of Object.entries(LEGS)) {
    test(name, async () => {
      expect(await leg(runSpawnPatternAllowlistProbe)).toBeNull();
    });
  }
});

// Mutation battery. SITING (the implementer's half): `find` / `replace` are
// null until the shipped code exists. Site the row against the shipped
// spawn_pattern_allowlist.ts with ONE exact anchor inside
// runSpawnPatternAllowlistProbe whose replacement removes ONLY the
// scaffold-existence condition (so the settings surface is scanned
// unconditionally again). A null row FAILS, naming itself.
const MUTATION = {
  id: "drop-scaffold-condition",
  find: "if (!existsSync(scaffoldPath)) {" as string | null,
  replace: "if (false) {" as string | null,
  kills: [TWIN_NO_SCAFFOLD],
  survives: [TWIN_WITH_SCAFFOLD],
};

function porcelain(): string {
  const p = Bun.spawnSync(["git", "-C", PLUGIN_ROOT, "status", "--porcelain", "--", MODULE_REL], { stdout: "pipe", stderr: "pipe" });
  return p.stdout.toString();
}

async function probeFrom(label: string, mutate?: (doc: string) => string): Promise<Probe> {
  const root = join(mkdtempSync(join(tmpdir(), `ste735-mut-${label}-`)), "plugin");
  temps.push(join(root, ".."));
  mkdirSync(join(root, "adapters", "_shared"), { recursive: true });
  cpSync(join(PLUGIN_ROOT, "adapters", "_shared", "src"), join(root, "adapters", "_shared", "src"), { recursive: true, dereference: true });
  const target = join(root, MODULE_REL);
  if (mutate) writeFileSync(target, mutate(readFileSync(target, "utf-8")));
  const mod = (await import(target)) as { runSpawnPatternAllowlistProbe: Probe };
  return mod.runSpawnPatternAllowlistProbe;
}

describe("AC-STE-735.4 — removing the scaffold condition turns a named test red", () => {
  let before = "";
  beforeAll(() => {
    before = porcelain();
  });

  test(`row ${MUTATION.id} is sited`, () => {
    expect({ row: MUTATION.id, sited: MUTATION.find !== null && MUTATION.replace !== null }).toEqual({ row: MUTATION.id, sited: true });
  });

  test(`row ${MUTATION.id}: every named leg passes unmutated, the kill leg fails on the mutant, the survivor holds`, async () => {
    expect(MUTATION.find).not.toBeNull();
    const pristine = await probeFrom("pristine");
    for (const name of [...MUTATION.kills, ...MUTATION.survives]) {
      expect({ leg: name, pristine: await LEGS[name]!(pristine) }).toEqual({ leg: name, pristine: null });
    }
    const mutant = await probeFrom(MUTATION.id, (doc) => {
      const from = doc.indexOf("export async function runSpawnPatternAllowlistProbe");
      expect(from).toBeGreaterThanOrEqual(0);
      return mutateInRegion(doc, from, doc.length, MUTATION.find!, MUTATION.replace!, { label: "runSpawnPatternAllowlistProbe" });
    });
    for (const name of MUTATION.kills) {
      expect({ leg: name, killed: (await LEGS[name]!(mutant)) !== null }).toEqual({ leg: name, killed: true });
    }
    for (const name of MUTATION.survives) {
      expect({ leg: name, mutant: await LEGS[name]!(mutant) }).toEqual({ leg: name, mutant: null });
    }
  });

  test("the real module is never mutated", () => {
    expect(porcelain()).toBe(before);
  });
});
