// STE-573 — a gate that ships unannounced reds the run that ships it.
//
// STE-571 and STE-572 corrected the announcing surfaces for the three blocking
// hooks that ship today. A correction is one edit; the class needs a reader.
// This file is that reader — and the whole point is that it never learns the
// gates from a list. It DERIVES them from the hook entry points themselves, so
// a fourth entry point in the same blocking shape joins the graded set the day
// it lands, and reds the run that adds it rather than the run that trips it.
//
// ---------------------------------------------------------------------------
// THE CONTRACT OF `tests/_blocking_gates.ts` (written by the implementer)
// ---------------------------------------------------------------------------
//
//   export interface BlockingGate {
//     /** The hook's registered name, e.g. `pre-commit-gate-check`. */
//     hook: string;
//     /** The Skill it demands, e.g. `dev-process-toolkit:gate-check`. */
//     skill: string;
//     /** Basename of the entry-point file, e.g. `pre-commit-gate-check.ts`. */
//     entryPoint: string;
//   }
//
//   export function deriveBlockingGates(pluginRoot: string): BlockingGate[];
//
// It reads every `*.ts` under `<pluginRoot>/templates/hooks/_lib/hooks/` and
// selects an entry point as BLOCKING when its source both
//
//   (a) calls `requireSkillToolUse`, and
//   (b) exits blocking on the miss — the shipped shape is
//       `process.exit(found ? 0 : 2)`.
//
// `skill` is the FIRST string argument of the `requireSkillToolUse(...)` call
// and `hook` is the SECOND. The returned array is sorted by hook name.
//
// It MUST NOT contain any hook name or any skill name as a literal. That is the
// entire deliverable — a module carrying `"pre-commit-gate-check"` in its own
// text is a list wearing a derivation's clothes, and the AC.1 leg below reads
// the module's own source to say so.
//
// WHY THE DERIVATION LIVES IN A SEPARATE MODULE. It has to be testable
// separately from its own assertions: the AC.6 fourth-gate mutation points it
// at a DIFFERENT plugin root, which is only possible if it takes one. The
// underscore prefix and the missing `.test.` segment keep it out of `bun test`
// collection, and nothing in markdown orders it, so it adds no record to probe
// #81's ordered-reference inventory — which is the mechanism AC.7 asserts.
// House precedent: `tests/_fence.ts`, `tests/_sited-mutation.ts`.
//
// Every predicate below is PURE OVER A BODY STRING and takes `(body, gate)`, so
// the same reader grades the landed tree and every mutated copy. A mutation is
// only evidence when the thing it reds is the thing the live case greens.

import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
  ORDERED_UNREACHABLE_PIN,
  ORDERED_UNREACHABLE_PIN_LEDGER,
  runModuleReachabilityProbe,
} from "../adapters/_shared/src/module_reachability";
import { deriveBlockingGates, type BlockingGate } from "./_blocking_gates";
import { mutate } from "./_fence";

const pluginRoot = join(import.meta.dir, "..");
const repoRoot = join(pluginRoot, "..", "..");
const read = (p: string) => readFileSync(p, "utf-8");

const HOOKS_DIR = join(pluginRoot, "templates", "hooks", "_lib", "hooks");
const MODULE_PATH = join(pluginRoot, "tests", "_blocking_gates.ts");
const MANUAL_PATH = join(pluginRoot, "docs", "hooks-reference.md");
const CONTRACTS_PATH = join(pluginRoot, "docs", "honored-contracts.md");
const TEMPLATE_PATH = join(pluginRoot, "templates", "CLAUDE.md.template");
const GATE_CHECK_SKILL = join(pluginRoot, "skills", "gate-check", "SKILL.md");

/**
 * The value the down-only pin carried when this FR landed. A FROZEN historical
 * ceiling, never an equality: the pin may fall (that is the whole point of the
 * ledger), it may never rise. AC.7 says this FR adds no ordered unreachable
 * module, which is a statement about the ceiling and nothing else.
 */
const PIN_FROZEN_AT = 129;

const manual = () => read(MANUAL_PATH);
const contracts = () => read(CONTRACTS_PATH);
const template = () => read(TEMPLATE_PATH);

/** The derived subject. Never a literal list — that is the FR. */
const gates = (): BlockingGate[] => deriveBlockingGates(pluginRoot);

// ---------------------------------------------------------------------------
// A SECOND, INDEPENDENTLY WRITTEN SCAN.
//
// AC.1 forbids asserting `=== 3`. The count the derivation returns is graded
// against what the entry points carry, computed here line-by-line rather than
// by the module's own reader, so agreement between the two is evidence and not
// a tautology.
//
// The independence that has to hold is the MECHANISM, not the meaning. An
// earlier draft of this scan tested each line for the verbatim shipped ternary
// (`process.exit(found?0:2)`, whitespace removed) — the very selector the
// module was widened away from, after three shapes a hook author would
// plausibly write were measured silently dropped by it. That left the scan
// STRICTER than its subject: reformat any shipped entry point and the module
// answers 3 while the scan answers 2, redding the count clause with a message
// that names formatting nowhere.
//
// So the scan now asks the same QUESTION the module asks — can this file exit
// with a non-zero status — by a different METHOD: walking lines and following
// one wrapped call across them by paren depth, rather than flattening the whole
// file and running a single regex over it.
// ---------------------------------------------------------------------------

/**
 * Does an entry point exit with a NON-ZERO status, read line-wise?
 *
 * Line-oriented by construction, but a call is allowed to wrap: from each
 * `process.exit(` the accumulator walks forward across lines until that call's
 * parenthesis closes, so a formatter-wrapped exit reads the same as a one-liner
 * (which is the whole point — the trailing comma a formatter adds is exactly
 * what defeated the old verbatim test). Any digit 1-9 in the argument text
 * means the call can leave a refusing status.
 */
function exitsBlockingLineWise(lines: string[]): boolean {
  const CALL = "process.exit(";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // Every occurrence on the line, not just the first: two exits on one line
    // is legal, and stopping at the first would be a silent false negative.
    for (let at = line.indexOf(CALL); at !== -1; at = line.indexOf(CALL, at + 1)) {
      let depth = 1;
      let args = "";
      for (const chunk of [line.slice(at + CALL.length), ...lines.slice(i + 1)]) {
        for (const ch of chunk) {
          if (ch === "(") depth++;
          else if (ch === ")" && --depth === 0) break;
          args += ch;
        }
        if (depth === 0) break;
        args += "\n";
      }
      if (/[1-9]/.test(args)) return true;
    }
  }
  return false;
}

/** Entry-point basenames that carry the blocking shape, by a line-wise scan. */
function independentBlockingScan(hooksDir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(hooksDir).sort()) {
    if (!name.endsWith(".ts")) continue;
    const lines = read(join(hooksDir, name)).split("\n");
    const callsRequire = lines.some((l) => l.includes("requireSkillToolUse("));
    if (callsRequire && exitsBlockingLineWise(lines)) found.push(name);
  }
  return found;
}

/** Every `*.ts` entry point in a hooks directory. */
const entryPointFiles = (hooksDir: string): string[] =>
  readdirSync(hooksDir)
    .filter((n) => n.endsWith(".ts"))
    .sort();

// ---------------------------------------------------------------------------
// Per-surface predicates — pure over a body, one per graded surface.
// ---------------------------------------------------------------------------

/** The `### <hook>` section of the hooks manual, heading included, or "". */
function manualSection(body: string, hook: string): string {
  const parts = body.split(/^### /m);
  for (let i = 1; i < parts.length; i++) {
    const whole = `### ${parts[i]!}`;
    const heading = whole.split("\n", 1)[0]!.slice(4).trim();
    if (heading === hook) return whole;
  }
  return "";
}

/**
 * AC.2 — the manual documents one gate, naming the hook AND the Skill.
 *
 * Sliced per-`###`-section rather than by whole-file substring: a hook named in
 * passing inside a NEIGHBOURING section must not stand in for a section of its
 * own, and the Skill the section is graded on has to be that section's.
 */
function manualDocumentsGate(body: string, gate: BlockingGate): boolean {
  const section = manualSection(body, gate.hook);
  if (section === "") return false;
  if (!section.includes(gate.hook)) return false;
  return section.includes(gate.skill);
}

/** The `## …` catalog entry that names a hook, or "". */
function contractEntry(body: string, hook: string): string {
  const parts = body.split(/^## /m);
  for (let i = 1; i < parts.length; i++) {
    const whole = `## ${parts[i]!}`;
    if (whole.includes(hook)) return whole;
  }
  return "";
}

/** AC.3 — the honored-contracts catalog carries an entry naming one gate. */
function contractsDocumentGate(body: string, gate: BlockingGate): boolean {
  const entry = contractEntry(body, gate.hook);
  if (entry === "") return false;
  if (!entry.includes("**Mandate.**")) return false;
  return entry.includes(gate.skill);
}

/**
 * The markdown list item naming `needle`, with its wrapped continuation lines.
 *
 * Per-ITEM, not per-block: the template's announcement is one unbroken bullet
 * list, so a blank-line-delimited block would carry all three gates and all
 * three skills, and a gate whose skill line was deleted would still read as
 * announced.
 */
function bulletItem(body: string, needle: string): string {
  const lines = body.split("\n");
  const i = lines.findIndex((l) => /^\s*-\s/.test(l) && l.includes(needle));
  if (i === -1) return "";
  const out = [lines[i]!];
  for (let j = i + 1; j < lines.length; j++) {
    const l = lines[j]!;
    if (l.trim() === "" || /^\s*-\s/.test(l)) break;
    out.push(l);
  }
  return out.join("\n");
}

/** AC.4 — `templates/CLAUDE.md.template` announces one gate, with its Skill. */
function templateAnnouncesGate(body: string, gate: BlockingGate): boolean {
  const item = bulletItem(body, gate.hook);
  if (item === "") return false;
  return item.includes(gate.skill);
}

/** All-three roll-ups. Announcing two of three is a fail, per the FR. */
const manualDocumentsEveryGate = (body: string, gs: BlockingGate[]): boolean =>
  gs.length > 0 && gs.every((g) => manualDocumentsGate(body, g));
const contractsDocumentEveryGate = (body: string, gs: BlockingGate[]): boolean =>
  gs.length > 0 && gs.every((g) => contractsDocumentGate(body, g));
const templateAnnouncesEveryGate = (body: string, gs: BlockingGate[]): boolean =>
  gs.length > 0 && gs.every((g) => templateAnnouncesGate(body, g));

// ---------------------------------------------------------------------------
// AC.5 — the manual is reachable from a surface a reader actually visits.
// ---------------------------------------------------------------------------

const MANUAL_FILENAME = "hooks-reference.md";

/** Every `*.md` under `dir`, recursively, as absolute paths. */
function markdownUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith(".md")) out.push(p);
    }
  };
  walk(dir);
  return out;
}

/** The surfaces a reader reaches, EXCLUDING the manual itself. */
function citingSurfaceCandidates(): string[] {
  return [
    join(repoRoot, "README.md"),
    join(repoRoot, "CLAUDE.md"),
    ...markdownUnder(join(pluginRoot, "docs")),
    ...markdownUnder(join(pluginRoot, "skills")),
  ].filter((p) => p !== MANUAL_PATH);
}

/** AC.5 — one body cites the manual by filename. */
const bodyCitesManual = (body: string): boolean => body.includes(MANUAL_FILENAME);

/** The citing surfaces, as repo-relative paths, so a failure NAMES them. */
const citingSurfaces = (): string[] =>
  citingSurfaceCandidates()
    .filter((p) => bodyCitesManual(read(p)))
    .map((p) => relative(repoRoot, p));

// ---------------------------------------------------------------------------
// AC.6 leg (a) — the synthetic fourth gate.
//
// A hook and a Skill that NO shipped surface mentions. Both are asserted absent
// from the graded surfaces before the leg runs, because a synthetic gate that
// happened to be documented would make the leg pass for the wrong reason.
// ---------------------------------------------------------------------------

const SYNTHETIC_HOOK = "pre-merge-cartography-audit";
const SYNTHETIC_SKILL = "dev-process-toolkit:cartography";

/** The shipped blocking shape, verbatim in structure, with novel names. */
const SYNTHETIC_ENTRY_POINT = `// Synthetic fourth blocking entry point — AC-STE-573.6 fixture.

import { parseHookPayload, requireSkillToolUse } from "../session.ts";

const stdin = await Bun.stdin.text();
const payload = parseHookPayload(stdin);
if (!payload) {
  process.exit(0);
}
const cmd = payload.tool_input?.command ?? "";
if (!/^git merge\\b/.test(cmd)) {
  process.exit(0);
}
const { found } = requireSkillToolUse(
  "${SYNTHETIC_SKILL}",
  "${SYNTHETIC_HOOK}",
  payload,
);
process.exit(found ? 0 : 2);
`;

const tempRoots: string[] = [];

/** A throwaway plugin root holding a COPY of the shipped hooks directory. */
function stagePluginRoot(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `ste-573-${label}-`));
  tempRoots.push(root);
  const lib = join(root, "templates", "hooks", "_lib");
  mkdirSync(lib, { recursive: true });
  cpSync(HOOKS_DIR, join(lib, "hooks"), { recursive: true });
  return root;
}

afterAll(() => {
  // Never a repository file: every mutation above writes into a temp copy.
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
});

// ===========================================================================
// Zero-hit guards — every reader is pointed at a real surface, and each is
// exercised on something this FR does not touch, so a silently-empty
// extraction fails loudly here instead of quietly satisfying an `every()`.
// ===========================================================================

describe("the readers are pointed at real, non-trivial surfaces", () => {
  test("the four subject files are real and non-trivial", () => {
    for (const [label, body] of [
      ["hooks-reference.md", manual()],
      ["honored-contracts.md", contracts()],
      ["CLAUDE.md.template", template()],
      ["gate-check/SKILL.md", read(GATE_CHECK_SKILL)],
    ] as const) {
      expect(body.length, label).toBeGreaterThan(500);
    }
  });

  test("the hooks directory holds MORE entry points than it holds gates", () => {
    // If every file were blocking, the AC.1 exclusion legs would be vacuous.
    const all = entryPointFiles(HOOKS_DIR);
    expect(all.length).toBeGreaterThan(independentBlockingScan(HOOKS_DIR).length);
  });

  test("the `###` section reader finds a section this FR does not touch", () => {
    const advisory = manualSection(manual(), "pre-spec-write-brainstorm-reminder");
    expect(advisory, "the advisory hook's manual section is unreachable").not.toBe("");
  });

  test("the `##` catalog reader finds the catalog's pre-existing first entry", () => {
    const entry = contractEntry(contracts(), "/implement → /tdd");
    expect(entry, "the catalog's existing first entry is unreachable").not.toBe("");
    expect(entry).toContain("**Mandate.**");
  });

  test("the bullet reader isolates ONE item, not the whole list", () => {
    const body = template();
    const item = bulletItem(body, "pre-commit-gate-check");
    expect(item).not.toBe("");
    expect(item.length).toBeLessThan(body.length);
    // Isolation: the neighbouring bullets are NOT swept in.
    expect(item).not.toContain("pre-pr-spec-review");
    expect(item).not.toContain("pre-commit-tdd-orchestrator");
  });

  test("the markdown walker reaches both roots", () => {
    expect(markdownUnder(join(pluginRoot, "docs")).length).toBeGreaterThan(3);
    expect(markdownUnder(join(pluginRoot, "skills")).length).toBeGreaterThan(3);
  });
});

// ===========================================================================
// AC-STE-573.1 — the blocking set is DERIVED, by structure, not enumerated
// ===========================================================================

describe("AC-STE-573.1 — the gates are derived from the entry points", () => {
  test("the count matches a second, independently written scan — not a literal", () => {
    const scanned = independentBlockingScan(HOOKS_DIR);
    expect(scanned.length, "the line-wise scan found no blocking entry point").toBeGreaterThan(
      0,
    );
    expect(
      gates().length,
      `the module derived ${gates().length} blocking gates; the line-wise scan found ` +
        `${scanned.length}. Both read the same entry points, so a disagreement is either ` +
        `a NEW entry point in a shape one of them does not understand, or a FORMATTING ` +
        `change — a wrapped exit call, a renamed binding — that one selector follows ` +
        `and the other does not`,
    ).toBe(scanned.length);
    expect(
      gates()
        .map((g) => g.entryPoint)
        .sort(),
      "the two scans disagree about WHICH entry points block — compare the named files; " +
        "a reformatted exit call is a candidate cause",
    ).toEqual(scanned);
  });

  test("it resolves exactly the gates that ship today, with hook + skill", () => {
    // The three below are EXPECTATIONS OF THIS TEST, not inputs to the reader:
    // the module is graded on deriving them from the entry-point text.
    expect(gates()).toEqual([
      {
        hook: "pre-commit-gate-check",
        skill: "dev-process-toolkit:gate-check",
        entryPoint: "pre-commit-gate-check.ts",
      },
      {
        hook: "pre-commit-tdd-orchestrator",
        skill: "dev-process-toolkit:tdd",
        entryPoint: "pre-commit-tdd-orchestrator.ts",
      },
      {
        hook: "pre-pr-spec-review",
        skill: "dev-process-toolkit:spec-review",
        entryPoint: "pre-pr-spec-review.ts",
      },
    ]);
  });

  test("the result is sorted by hook name", () => {
    const hooks = gates().map((g) => g.hook);
    expect(hooks).toEqual([...hooks].sort());
  });

  test("the ADVISORY and CAPTURE entry points are excluded", () => {
    // Returning five would be as wrong as returning two: the advisory reminder
    // calls `findSkillToolUse` and exits 0, and the ledger never refuses.
    const excluded = ["pre-spec-write-brainstorm-reminder", "session-token-ledger"];
    for (const name of excluded) {
      expect(
        entryPointFiles(HOOKS_DIR),
        `${name}.ts is not in the hooks directory — re-measure this leg`,
      ).toContain(`${name}.ts`);
      expect(gates().map((g) => g.hook), name).not.toContain(name);
      expect(gates().map((g) => g.entryPoint), name).not.toContain(`${name}.ts`);
    }
  });

  test("the derivation module carries NO hook or skill name as a literal", () => {
    // The whole FR. A module that names its answers is a hard-coded list, and
    // would survive the AC.6 fourth-gate mutation below.
    const src = read(MODULE_PATH);
    for (const gate of gates()) {
      expect(src, `_blocking_gates.ts hard-codes the hook ${gate.hook}`).not.toContain(
        gate.hook,
      );
      expect(src, `_blocking_gates.ts hard-codes the skill ${gate.skill}`).not.toContain(
        gate.skill,
      );
    }
  });
});

// ===========================================================================
// AC-STE-573.2 — the manual documents every derived gate
// ===========================================================================

describe("AC-STE-573.2 — docs/hooks-reference.md documents every derived gate", () => {
  for (const gate of gates()) {
    test(`${gate.hook} has a manual section naming the hook and ${gate.skill}`, () => {
      const section = manualSection(manual(), gate.hook);
      expect(section, `${gate.hook} has no \`### \` section in the manual`).not.toBe("");
      expect(section, `${gate.hook}: its section never names the required Skill`).toContain(
        gate.skill,
      );
      expect(manualDocumentsGate(manual(), gate)).toBe(true);
    });
  }

  test("every derived gate together", () => {
    expect(manualDocumentsEveryGate(manual(), gates())).toBe(true);
  });
});

// ===========================================================================
// AC-STE-573.3 — the honored-contracts catalog carries an entry per gate
// ===========================================================================

describe("AC-STE-573.3 — docs/honored-contracts.md names every derived gate", () => {
  for (const gate of gates()) {
    test(`${gate.hook} has a catalog entry`, () => {
      const entry = contractEntry(contracts(), gate.hook);
      expect(entry, `${gate.hook} has no catalog entry`).not.toBe("");
      expect(entry, `${gate.hook}: the entry omits its Skill`).toContain(gate.skill);
      expect(contractsDocumentGate(contracts(), gate)).toBe(true);
    });
  }

  test("every derived gate together", () => {
    expect(contractsDocumentEveryGate(contracts(), gates())).toBe(true);
  });
});

// ===========================================================================
// AC-STE-573.4 — the bootstrapped CLAUDE.md announces every gate
// ===========================================================================

describe("AC-STE-573.4 — templates/CLAUDE.md.template announces every derived gate", () => {
  test("the announcement says the hooks BLOCK, not that they remind", () => {
    const body = template();
    expect(body).toMatch(/block/i);
    expect(body).toContain("exits 2");
  });

  for (const gate of gates()) {
    test(`${gate.hook} is announced with ${gate.skill}`, () => {
      const item = bulletItem(template(), gate.hook);
      expect(item, `${gate.hook} is never announced in the template`).not.toBe("");
      expect(item, `${gate.hook}: the bullet omits its Skill`).toContain(gate.skill);
      expect(templateAnnouncesGate(template(), gate)).toBe(true);
    });
  }

  test("every derived gate together", () => {
    expect(templateAnnouncesEveryGate(template(), gates())).toBe(true);
  });
});

// ===========================================================================
// AC-STE-573.5 — the manual is reachable from somewhere other than itself
// ===========================================================================

describe("AC-STE-573.5 — the manual is linked from a surface a reader reaches", () => {
  test("at least one OTHER surface cites hooks-reference.md, and it is named", () => {
    const surfaces = citingSurfaces();
    expect(
      surfaces,
      "nothing outside the manual itself cites docs/hooks-reference.md",
    ).not.toEqual([]);
    // Named, so a later removal reports WHICH surface disappeared.
    expect(surfaces.length).toBeGreaterThanOrEqual(1);
    for (const s of surfaces) expect(s).not.toBe("plugins/dev-process-toolkit/docs/hooks-reference.md");
  });

  test("the manual citing its OWN filename does not satisfy the clause", () => {
    // The exclusion is the clause. Measured: the manual is not in the candidate
    // set at all, whatever its own text says about itself.
    expect(citingSurfaceCandidates()).not.toContain(MANUAL_PATH);
  });
});

// ===========================================================================
// AC-STE-573.7 — this FR moves neither the probe count nor the pin
// ===========================================================================

describe("AC-STE-573.7 — no probe, no ordered module", () => {
  test("the /gate-check probe registry is unmoved", () => {
    // DERIVED, never restated. The count already has three homes (README,
    // docs/workflow-overview.md twice); this milestone's refactor pass spent
    // its effort REMOVING duplicate count homes, so planting a fourth one in
    // the suite that guards the milestone would be the milestone doing its own
    // trick. The registry is the source of truth for the run; the shape asserted
    // is gaplessness, and the number is cross-checked against the doc using the
    // mechanism already shipped at tests/m_645517-ste-568-docs-tree.test.ts.
    const registry = read(GATE_CHECK_SKILL);
    const registrations = registry.split("\n").flatMap((line) => {
      const m = /^(\d+)\. \*\*/.exec(line);
      return m === null ? [] : [Number(m[1])];
    });
    // Non-vacuous: a regex that stopped matching would report a clean gapless
    // run over the empty list.
    expect(registrations.length).toBeGreaterThan(50);
    expect(
      registrations,
      `the registry numbering is not a gapless 1..${registrations.length} run`,
    ).toEqual(Array.from({ length: registrations.length }, (_, i) => i + 1));

    // Same regex the shipped docs-tree sweep uses, so the two agree by
    // construction rather than by two hand-kept literals.
    const observed = (registry.match(/^\d+[a-z]?\. \*\*/gm) ?? []).length;
    expect(observed).toBe(registrations.length);
    const overview = read(join(pluginRoot, "docs", "workflow-overview.md"));
    expect(
      overview,
      `measured ${observed} probe registrations — docs/workflow-overview.md states a different count`,
    ).toContain(`typecheck + lint + tests + ${observed} probes`);
    expect(overview).toContain(`| ${observed} conformance probes (NFR-15) |`);
  });

  test("ORDERED_UNREACHABLE_PIN is unmoved, and is the ledger head", () => {
    // DOWN-ONLY. `toBe(<literal>)` is forbidden tree-wide (a suite that pins the
    // live pin to a literal reds every later LOWERING in a file it does not
    // name — see tests/m_8f8e25-ste-557-pin-ledger.test.ts). The sanctioned way
    // to say "never raised" is a bound against a frozen historical value, and
    // that is exactly AC.7's meaning: this FR may not RAISE the pin.
    expect(
      ORDERED_UNREACHABLE_PIN,
      `the pin rose above ${PIN_FROZEN_AT} — this FR adds no ordered unreachable module`,
    ).toBeLessThanOrEqual(PIN_FROZEN_AT);
    expect(ORDERED_UNREACHABLE_PIN).toBe(ORDERED_UNREACHABLE_PIN_LEDGER[0]!.value);
  });

  test("the module-reachability probe is green over the landed tree", async () => {
    // `violations` is NOT the assertion: the probe always emits one
    // warning-severity catalogue row while `ok` is true — measured identical
    // with and without `_blocking_gates.ts` present, so an empty-violations
    // clause never described this change. The house idiom grades the MEASURED
    // count against the pin.
    const report = await runModuleReachabilityProbe(repoRoot);
    expect(
      report.orderedUnreachable,
      `measured ${report.orderedUnreachable} against pin ${ORDERED_UNREACHABLE_PIN} — ` +
        `re-measure and move the pin per the probe's own remedy; never raise it`,
    ).toBe(ORDERED_UNREACHABLE_PIN);
    expect(report.violations.filter((v) => v.severity === "error")).toEqual([]);
    expect(report.ok).toBe(true);
  }, 120_000);

  test("THE MECHANISM — nothing in skills/ or docs/ orders `_blocking_gates.ts`", () => {
    // Asserting the mechanism is stronger than asserting the number: the pin
    // counts ORDERED references to modules nothing runnable reaches, so a
    // support module no markdown names cannot enter the counted set at all.
    const surfaces = [
      ...markdownUnder(join(pluginRoot, "skills")),
      ...markdownUnder(join(pluginRoot, "docs")),
    ];
    expect(surfaces.length).toBeGreaterThan(10);
    for (const p of surfaces) {
      expect(read(p), `${relative(repoRoot, p)} references _blocking_gates`).not.toContain(
        "_blocking_gates",
      );
    }
  });

  test("the support module is not collected by `bun test`", () => {
    expect(MODULE_PATH.endsWith("/_blocking_gates.ts")).toBe(true);
    expect(MODULE_PATH).not.toContain(".test.");
  });
});

// ===========================================================================
// AC-STE-573.6 — falsifiability. The load-bearing clause.
//
// Every leg measures the landed tree CLEAN first, then mutates through the
// throwing `mutate`, so a pattern that stopped matching raises instead of
// reading as a green test asserting that a guard it never removed still works.
// Nothing here writes to a repository file: the fourth-gate leg stages a temp
// plugin root, and the surface legs mutate body STRINGS.
// ===========================================================================

describe("AC-STE-573.6 — the reader is mutation-tested", () => {
  test("(a) A SYNTHETIC FOURTH GATE joins the derived set and reds every surface", () => {
    // THIS IS THE LEG THAT SEPARATES A READER FROM A LIST. A derivation built
    // on a hard-coded list of three hook names returns three here and passes
    // every surface assertion — the mutation would be invisible. Only a reader
    // that derives from the entry points returns four and reds.

    // 1. CLEAN, measured on the landed tree.
    const live = gates();
    expect(manualDocumentsEveryGate(manual(), live)).toBe(true);
    expect(contractsDocumentEveryGate(contracts(), live)).toBe(true);
    expect(templateAnnouncesEveryGate(template(), live)).toBe(true);

    // 2. CLEAN, measured on an unmutated COPY — so a difference below is the
    //    synthetic entry point and not the copying.
    const control = stagePluginRoot("control");
    expect(deriveBlockingGates(control)).toEqual(live);

    // 3. The synthetic names must be absent from every graded surface, or the
    //    leg would pass for the wrong reason.
    for (const [label, body] of [
      ["hooks-reference.md", manual()],
      ["honored-contracts.md", contracts()],
      ["CLAUDE.md.template", template()],
    ] as const) {
      expect(body, `${label} already mentions the synthetic hook`).not.toContain(
        SYNTHETIC_HOOK,
      );
      expect(body, `${label} already mentions the synthetic skill`).not.toContain(
        SYNTHETIC_SKILL,
      );
    }

    // 4. MUTATE: a fourth entry point in the shipped blocking shape.
    const mutatedRoot = stagePluginRoot("fourth");
    writeFileSync(
      join(mutatedRoot, "templates", "hooks", "_lib", "hooks", `${SYNTHETIC_HOOK}.ts`),
      SYNTHETIC_ENTRY_POINT,
    );

    const derived = deriveBlockingGates(mutatedRoot);
    expect(
      derived.length,
      "the derivation ignored a new blocking entry point — it is a hard-coded list",
    ).toBe(live.length + 1);

    const synthetic = derived.find((g) => g.hook === SYNTHETIC_HOOK);
    expect(synthetic, "the fourth gate was not derived").toBeDefined();
    expect(synthetic!.skill).toBe(SYNTHETIC_SKILL);
    expect(synthetic!.entryPoint).toBe(`${SYNTHETIC_HOOK}.ts`);

    // 5. The AC.2 / AC.3 / AC.4 predicates RED for it against the real surfaces.
    expect(manualDocumentsGate(manual(), synthetic!)).toBe(false);
    expect(contractsDocumentGate(contracts(), synthetic!)).toBe(false);
    expect(templateAnnouncesGate(template(), synthetic!)).toBe(false);

    // 6. And the roll-ups red, which is the run this FR exists to fail.
    expect(manualDocumentsEveryGate(manual(), derived)).toBe(false);
    expect(contractsDocumentEveryGate(contracts(), derived)).toBe(false);
    expect(templateAnnouncesEveryGate(template(), derived)).toBe(false);

    // 7. ISOLATION: the three shipped gates still green under the same reader.
    for (const gate of live) {
      expect(manualDocumentsGate(manual(), gate), gate.hook).toBe(true);
      expect(contractsDocumentGate(contracts(), gate), gate.hook).toBe(true);
      expect(templateAnnouncesGate(template(), gate), gate.hook).toBe(true);
    }
  });

  test("(b) removing ONE gate's mention from the MANUAL reds only that gate", () => {
    const clean = manual();
    const live = gates();
    expect(manualDocumentsEveryGate(clean, live)).toBe(true);

    for (const dropped of live) {
      // Global: the manual names each hook in a heading AND in its refusal
      // block, so a first-occurrence mutation would leave the section findable.
      const mutated = mutate(clean, new RegExp(dropped.hook, "g"), "pre-removed-hook");
      expect(manualDocumentsGate(mutated, dropped), dropped.hook).toBe(false);
      expect(manualDocumentsEveryGate(mutated, live), dropped.hook).toBe(false);
      for (const kept of live.filter((g) => g.hook !== dropped.hook)) {
        expect(manualDocumentsGate(mutated, kept), `kept ${kept.hook}`).toBe(true);
      }
    }
  });

  test("(b) removing ONE gate's mention from the CATALOG reds only that gate", () => {
    const clean = contracts();
    const live = gates();
    expect(contractsDocumentEveryGate(clean, live)).toBe(true);

    for (const dropped of live) {
      const mutated = mutate(clean, new RegExp(dropped.hook, "g"), "pre-removed-hook");
      expect(contractsDocumentGate(mutated, dropped), dropped.hook).toBe(false);
      expect(contractsDocumentEveryGate(mutated, live), dropped.hook).toBe(false);
      for (const kept of live.filter((g) => g.hook !== dropped.hook)) {
        expect(contractsDocumentGate(mutated, kept), `kept ${kept.hook}`).toBe(true);
      }
    }
  });

  test("(b) removing ONE gate's mention from the TEMPLATE reds only that gate", () => {
    const clean = template();
    const live = gates();
    expect(templateAnnouncesEveryGate(clean, live)).toBe(true);

    for (const dropped of live) {
      const mutated = mutate(clean, new RegExp(dropped.hook, "g"), "pre-removed-hook");
      expect(templateAnnouncesGate(mutated, dropped), dropped.hook).toBe(false);
      expect(templateAnnouncesEveryGate(mutated, live), dropped.hook).toBe(false);
      for (const kept of live.filter((g) => g.hook !== dropped.hook)) {
        expect(templateAnnouncesGate(mutated, kept), `kept ${kept.hook}`).toBe(true);
      }
    }
  });

  test("(b) dropping the SKILL from a section reds it, not just the hook name", () => {
    // A surface can name the hook and never say which Skill discharges it —
    // the exact half-announcement AC.2 and AC.4 exist to reject.
    const live = gates();
    for (const [label, clean, predicate, slice] of [
      [
        "hooks-reference.md",
        manual(),
        manualDocumentsGate,
        (b: string, g: BlockingGate) => manualSection(b, g.hook),
      ],
      [
        "CLAUDE.md.template",
        template(),
        templateAnnouncesGate,
        (b: string, g: BlockingGate) => bulletItem(b, g.hook),
      ],
    ] as const) {
      const gate = live[0]!;
      expect(predicate(clean, gate), label).toBe(true);
      const region = slice(clean, gate);
      expect(region, `${label}: empty region`).not.toBe("");
      const stripped = mutate(region, new RegExp(gate.skill, "g"), "some:other-skill");
      const mutated = clean.replace(region, stripped);
      expect(predicate(mutated, gate), label).toBe(false);
      for (const kept of live.filter((g) => g.hook !== gate.hook)) {
        expect(predicate(mutated, kept), `${label} / kept ${kept.hook}`).toBe(true);
      }
    }
  });

  test("(b) removing the manual's filename from a citing surface reds AC.5", () => {
    const surfaces = citingSurfaceCandidates().filter((p) => bodyCitesManual(read(p)));
    expect(surfaces.length, "no citing surface to mutate").toBeGreaterThan(0);
    for (const p of surfaces) {
      const clean = read(p);
      expect(bodyCitesManual(clean), relative(repoRoot, p)).toBe(true);
      const mutated = mutate(clean, new RegExp(MANUAL_FILENAME, "g"), "some-other-file.md");
      expect(bodyCitesManual(mutated), relative(repoRoot, p)).toBe(false);
    }
  });

  test("(c) the mutation helper itself refuses a mutation that never applied", () => {
    // The guard that stops every leg above from passing vacuously.
    expect(() => mutate(manual(), /this string is not in the hooks manual/, "x")).toThrow(
      /mutation did not apply/,
    );
  });
});

// ===========================================================================
// AC-STE-573.1 / .6 — THE BLOCKING-EXIT SELECTOR, PINNED IN BOTH DIRECTIONS.
//
// WHY THIS BLOCK EXISTS — the measurement, not the rule.
//
// `_blocking_gates.ts` first selected an entry point on the VERBATIM shipped
// ternary (`process.exit(found?0:2)`, whitespace removed). Three shapes a hook
// author would plausibly write were then measured SILENTLY DROPPED by it:
//
//   1. a guarded refusal — `if (!found) process.exit(2)`;
//   2. a renamed destructured binding — `const { found: hasEvidence } = …`;
//   3. that same shipped ternary once a formatter wraps it, because wrapping
//      adds the magic trailing comma and `(found?0:2,)` is not `(found?0:2)`.
//
// A refactor pass widened the selector to "an exit that can leave a non-zero
// status". Nothing pinned the widening. The one synthetic entry point above
// uses the verbatim shipped ternary, so narrowing the regex back leaves every
// other test in this file green — the fix was protected by nothing, and a
// silently dropped gate is precisely the failure this FR exists to prevent.
//
// The NEGATIVES are the other half, and they are not decoration: a selector
// that admitted everything would pass all three positives and be WORSE than the
// brittle one, because it would demand announcements for hooks that refuse
// nothing. Each negative isolates one clause — the demand call, or the exit.
// ===========================================================================

interface ExitShapeFixture {
  /** Why this shape is staged. Printed in the test name. */
  label: string;
  /** Hook name AND fixture basename. Novel: asserted absent from every surface. */
  hook: string;
  /** Skill name. Equally novel. */
  skill: string;
  /** MUST the derivation select it? */
  blocking: boolean;
  /** The entry-point source, built from the names so the two cannot drift. */
  source: (skill: string, hook: string) => string;
}

/** The head every shipped entry point shares: parse stdin, ignore other tools. */
const entryHead = (imported: string, verb: string) => `import { ${imported} } from "../session.ts";

const stdin = await Bun.stdin.text();
const payload = parseHookPayload(stdin);
if (!payload) {
  process.exit(0);
}
const cmd = payload.tool_input?.command ?? "";
if (!/^git ${verb}\\b/.test(cmd)) {
  process.exit(0);
}
`;

const EXIT_SHAPE_FIXTURES: ExitShapeFixture[] = [
  {
    label: "POSITIVE — a guarded refusal, `if (!found) process.exit(2)`",
    hook: "pre-push-provenance-guard",
    skill: "dev-process-toolkit:provenance",
    blocking: true,
    source: (skill, hook) => `// Fixture: the guarded shape. The verbatim-ternary selector dropped it.

${entryHead("parseHookPayload, requireSkillToolUse", "push")}const { found } = requireSkillToolUse(
  "${skill}",
  "${hook}",
  payload,
);
if (!found) {
  process.exit(2);
}
process.exit(0);
`,
  },
  {
    label: "POSITIVE — a renamed destructured binding, `const { found: hasEvidence }`",
    hook: "pre-tag-attestation-guard",
    skill: "dev-process-toolkit:attestation",
    blocking: true,
    source: (skill, hook) => `// Fixture: the shipped ternary over a RENAMED binding. Nothing about a gate
// depends on what its author called the flag.

${entryHead("parseHookPayload, requireSkillToolUse", "tag")}const { found: hasEvidence } = requireSkillToolUse(
  "${skill}",
  "${hook}",
  payload,
);
process.exit(hasEvidence ? 0 : 2);
`,
  },
  {
    label: "POSITIVE — the shipped ternary WRAPPED by a formatter, trailing comma and all",
    hook: "pre-rebase-lineage-guard",
    skill: "dev-process-toolkit:lineage",
    blocking: true,
    source: (skill, hook) => `// Fixture: byte-for-byte the shipped refusal, reformatted. This is the one
// that settles the argument — a derivation that goes blind when a file is
// reformatted is the hand-kept list it was built to replace.

${entryHead("parseHookPayload, requireSkillToolUse", "rebase")}const { found } = requireSkillToolUse(
  "${skill}",
  "${hook}",
  payload,
);
process.exit(
  found ? 0 : 2,
);
`,
  },
  {
    label: "NEGATIVE — advisory: it looks the Skill up with the SILENT sibling and exits 0",
    hook: "post-merge-almanac-notice",
    skill: "dev-process-toolkit:almanac",
    blocking: false,
    source: (skill, hook) => `// Fixture: the advisory shape. It asks with the lookup that never emits a
// refusal, and every exit it can reach is 0. It owes no announcement because it
// takes nothing away.

import { emitNFR10, findSkillToolUse, parseHookPayload } from "../session.ts";

const stdin = await Bun.stdin.text();
const payload = parseHookPayload(stdin);
if (!payload) {
  process.exit(0);
}
const { found } = findSkillToolUse("${skill}", payload);
if (found) {
  process.exit(0);
}
emitNFR10(
  "Reminder",
  "an advisory notice, not a refusal.",
  "consider running the Skill first.",
  "${skill}",
  "${hook}",
);
process.exit(0);
`,
  },
  {
    label: "NEGATIVE — it exits NON-ZERO for an unrelated reason and demands no Skill",
    hook: "pre-fetch-weathervane-notice",
    skill: "dev-process-toolkit:weathervane",
    blocking: false,
    source: (_skill, hook) => `// Fixture: a non-zero exit is not by itself a gate. This one fails when a
// subprocess fails and never demands a Skill of anyone — isolating the demand
// clause, which a selector widened only on the exit would drop.

import { parseHookPayload } from "../session.ts";

const HOOK = "${hook}";

const stdin = await Bun.stdin.text();
const payload = parseHookPayload(stdin);
if (!payload) {
  process.exit(0);
}
const probe = Bun.spawnSync(["git", "remote"]);
if (probe.exitCode !== 0) {
  console.error(HOOK + ": the remote probe failed");
  process.exit(3);
}
process.exit(0);
`,
  },
  {
    label: "NEGATIVE — it demands the Skill and then never exits: a hook that asks and shrugs",
    hook: "pre-stash-sundial-notice",
    skill: "dev-process-toolkit:sundial",
    blocking: false,
    source: (skill, hook) => `// Fixture: the demand call alone is not the gate. Nothing here can leave a
// non-zero status, so nothing refuses — isolating the exit clause.

import { parseHookPayload, requireSkillToolUse } from "../session.ts";

const stdin = await Bun.stdin.text();
const payload = parseHookPayload(stdin);
if (payload) {
  const cmd = payload.tool_input?.command ?? "";
  if (/^git stash\\b/.test(cmd)) {
    const { found } = requireSkillToolUse(
      "${skill}",
      "${hook}",
      payload,
    );
    if (!found) {
      console.error("${hook}: no evidence — carrying on anyway.");
    }
  }
}
`,
  },
];

// ---------------------------------------------------------------------------
// AC-STE-573.1 — "under `templates/hooks/_lib/hooks/`" INCLUDES SUBDIRECTORIES.
//
// The AC scopes the reader to the entry points under that tree. The walk lists
// the directory once and skips every directory entry, so a blocking entry point
// one level down is under the tree by the AC's own wording and is dropped in
// SILENCE — the hand-kept list's failure mode, arriving by a different route.
// ---------------------------------------------------------------------------

const NESTED_SUBDIR = "process";
const NESTED_HOOK = "pre-archive-cadastre-audit";
const NESTED_SKILL = "dev-process-toolkit:cadastre";
const NESTED_ENTRY_POINT = `// Synthetic blocking entry point, one level down.

import { parseHookPayload, requireSkillToolUse } from "../../session.ts";

const stdin = await Bun.stdin.text();
const payload = parseHookPayload(stdin);
if (!payload) {
  process.exit(0);
}
const cmd = payload.tool_input?.command ?? "";
if (!/^git archive\\b/.test(cmd)) {
  process.exit(0);
}
const { found } = requireSkillToolUse(
  "${NESTED_SKILL}",
  "${NESTED_HOOK}",
  payload,
);
process.exit(found ? 0 : 2);
`;

/** The hooks directory inside a staged temp plugin root. */
const stagedHooksDir = (root: string) =>
  join(root, "templates", "hooks", "_lib", "hooks");

describe("AC-STE-573.1 — the blocking-exit selector admits three shapes and refuses three", () => {
  test("every fixture name is NOVEL — absent from the shipped tree and every graded surface", () => {
    // A fixture whose name already appeared somewhere would make the positives
    // pass, or the negatives fail, for a reason that is not the selector.
    const surfaces: [string, string][] = [
      ["hooks-reference.md", manual()],
      ["honored-contracts.md", contracts()],
      ["CLAUDE.md.template", template()],
      ...entryPointFiles(HOOKS_DIR).map(
        (n) => [n, read(join(HOOKS_DIR, n))] as [string, string],
      ),
    ];
    expect(surfaces.length, "the surface list is short — re-measure").toBeGreaterThan(5);

    const synthetic = [
      ...EXIT_SHAPE_FIXTURES.map((f) => ({ hook: f.hook, skill: f.skill })),
      { hook: NESTED_HOOK, skill: NESTED_SKILL },
    ];
    for (const { hook, skill } of synthetic) {
      for (const [label, body] of surfaces) {
        expect(body, `${label} already names ${hook}`).not.toContain(hook);
        expect(body, `${label} already names ${skill}`).not.toContain(skill);
      }
    }
    // Distinct from each other, or one fixture could stand in for another.
    const hooks = synthetic.map((s) => s.hook);
    expect(new Set(hooks).size, "two fixtures share a hook name").toBe(hooks.length);
  });

  for (const fixture of EXIT_SHAPE_FIXTURES) {
    test(`${fixture.blocking ? "DERIVED" : "EXCLUDED"} — ${fixture.label}`, () => {
      const live = gates();
      const root = stagePluginRoot(`shape-${fixture.hook}`);
      const hooksDir = stagedHooksDir(root);

      // CONTROL: the copy reads identically before the fixture lands, so the
      // difference below is the fixture and never the copying.
      expect(deriveBlockingGates(root), "the unmutated copy already differs").toEqual(live);

      writeFileSync(
        join(hooksDir, `${fixture.hook}.ts`),
        fixture.source(fixture.skill, fixture.hook),
      );
      const derived = deriveBlockingGates(root);

      if (fixture.blocking) {
        // Extraction is graded, not merely non-emptiness: hook, Skill and
        // entry point, in the module's own sorted order, alongside an
        // untouched shipped three.
        const expected: BlockingGate = {
          hook: fixture.hook,
          skill: fixture.skill,
          entryPoint: `${fixture.hook}.ts`,
        };
        expect(
          derived,
          `${fixture.label}: the derivation did not pick this shape up — the ` +
            `selector has narrowed back toward the verbatim shipped ternary`,
        ).toEqual(
          [...live, expected].sort((a, b) => (a.hook < b.hook ? -1 : a.hook > b.hook ? 1 : 0)),
        );
      } else {
        expect(
          derived,
          `${fixture.label}: the derivation selected an entry point that refuses ` +
            `nothing — a selector that admits everything is worse than a brittle one`,
        ).toEqual(live);
      }

      // The independent line-wise scan reads the same fixture the same way. If
      // it did not, the AC.1 count clause would red the day such a shape shipped.
      expect(
        independentBlockingScan(hooksDir).includes(`${fixture.hook}.ts`),
        `${fixture.label}: the line-wise scan disagrees with the module about this shape`,
      ).toBe(fixture.blocking);
    });
  }
});

describe("AC-STE-573.1 — a blocking entry point in a SUBDIRECTORY is derived", () => {
  test("a gate one level down is under the hooks tree, and joins the derived set", () => {
    const live = gates();
    const root = stagePluginRoot("nested");
    const dir = join(stagedHooksDir(root), NESTED_SUBDIR);

    // CONTROL, before the nested file lands.
    expect(deriveBlockingGates(root)).toEqual(live);

    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${NESTED_HOOK}.ts`), NESTED_ENTRY_POINT);

    const derived = deriveBlockingGates(root);
    expect(
      derived.length,
      `${NESTED_SUBDIR}/${NESTED_HOOK}.ts refuses commits and is under ` +
        `templates/hooks/_lib/hooks/ — the walk skips directories and never ` +
        `recurses, so it is dropped in silence`,
    ).toBe(live.length + 1);

    const nested = derived.find((g) => g.hook === NESTED_HOOK);
    expect(nested, "the nested gate was not derived").toBeDefined();
    expect(nested!.skill, "the nested gate's Skill was misread").toBe(NESTED_SKILL);
    expect(
      nested!.entryPoint.endsWith(`${NESTED_HOOK}.ts`),
      `entryPoint was ${nested!.entryPoint} — basename or subdirectory-qualified ` +
        `path both satisfy this; naming a different file does not`,
    ).toBe(true);

    // ISOLATION: the shipped three are unchanged by the recursion.
    expect(derived.filter((g) => g.hook !== NESTED_HOOK)).toEqual(live);
  });
});
