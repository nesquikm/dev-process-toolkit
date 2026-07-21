// M108 STE-392 — the first `kind: "assisted"` registry entry: the monolithic
// specs → per-FR split. Registry registration + the pure mechanics.
//
// Contract pinned by this file (FR § Technical Design, specs/frs/STE-392.md):
//
//   adapters/_shared/src/migrations/monolith_split.ts exports
//     - monolithSplit: MigrationEntry   // id "monolith-split", introduced_in
//                                       // v1.16.0, kind "assisted", NO apply.
//                                       // Registered in MIGRATIONS — and since
//                                       // 1.16.0 predates every seeded entry,
//                                       // it sorts FIRST.
//     - parseMonolithFRSections(md): { frNumber, title, acLines, background }[]
//     - extractPlanCheckboxState(md): AC-ref → "checked" | "unchecked" | "partial"
//     - classifyFRs(sections, state): { frNumber, disposition, evidence }[]
//     - rewriteAcPrefix(lines, prefix): string[]
//
// The AC does not pin the container for the checkbox map (Map vs plain object)
// nor the scalar type of `frNumber`, so this file normalizes those two shapes
// and keeps every value assertion strict. Everything else is asserted as-is.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { MIGRATIONS } from "./index";
import {
  classifyFRs,
  extractPlanCheckboxState,
  monolithSplit,
  parseMonolithFRSections,
  rewriteAcPrefix,
} from "./monolith_split";

const PLUGIN_ROOT = join(import.meta.dir, "..", "..", "..", "..");
const REQUIREMENTS_TEMPLATE = join(
  PLUGIN_ROOT,
  "templates",
  "spec-templates",
  "requirements.md.template",
);

// ---------------------------------------------------------------------------
// Fixtures — the miniature monolith (FR § Testing)
//
// Three LIVE FR sections (8, 12, 31) plus one `> archived:` pointer section
// (FR-9) the parser must skip. FR numbering deliberately gaps (8 → 12 → 31):
// the real tree's FR-31 analog proves nothing renumbers or assumes contiguity.
// Checkbox state lives ONLY in the plan — the split-brain shape.
// ---------------------------------------------------------------------------

const MONOLITH_REQUIREMENTS = [
  "# Requirements",
  "",
  "## 1. Overview",
  "",
  "Stock check app — legacy monolithic layout, retired in v1.16.0.",
  "",
  "## 2. Functional Requirements",
  "",
  "### FR-8: Widget search {#FR-8}",
  "",
  "Background: operators need to find widgets by name.",
  "",
  "- AC-8.1: Query returns matches ranked by score.",
  "- AC-8.2: Empty query returns an empty list.",
  "",
  "### FR-9: Widget export {#FR-9}",
  "",
  "> archived: superseded by FR-12 — see specs/frs/archive/",
  "> Left behind as a pointer when the section was archived by hand.",
  "",
  "### FR-12: Widget import {#FR-12}",
  "",
  "Background: bulk import from CSV.",
  "",
  "- AC-12.1: CSV rows become widgets.",
  "- AC-12.2: Malformed rows are rejected with a message.",
  "- AC-12.3: Import is idempotent.",
  "",
  "### FR-31: Monthly rollup {#FR-31}",
  "",
  "Background: finance needs a monthly report.",
  "",
  "- AC-31.1: Rollup renders every SKU sold in the month.",
  "",
].join("\n");

const MONOLITH_PLAN = [
  "# Plan",
  "",
  "## M1: Search foundation",
  "",
  "- [x] AC-8.1 — Query returns matches ranked by score",
  "- [x] AC-8.2 — Empty query returns an empty list",
  "",
  "## M2: Import pipeline",
  "",
  "- [x] AC-12.1 — CSV rows become widgets",
  "- [ ] AC-12.2 — Malformed rows are rejected with a message",
  "- [~] AC-12.3 — Import is idempotent",
  "",
  "## M3: Reporting",
  "",
  "- [ ] AC-31.1 — Rollup renders every SKU sold in the month",
  "",
].join("\n");

/** A tree that already conforms: cross-cutting requirements + per-FR files. */
const POST_SPLIT_REQUIREMENTS = [
  "# Requirements",
  "",
  "## 1. Overview",
  "",
  "Stock check app.",
  "",
  "## 2. Functional Requirements (cross-cutting only)",
  "",
  "- **Authentication scheme:** session cookies, HttpOnly + SameSite=Lax.",
  "",
].join("\n");

function makeTree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "ste-392-monolith-"));
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, ...rel.split("/"));
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  return root;
}

function withTree<T>(files: Record<string, string>, fn: (root: string) => T): T {
  const root = makeTree(files);
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Recursive `path → bytes` snapshot, for proving a detector mutated nothing. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string, prefix: string): void => {
    for (const name of readdirSync(d, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const rel = prefix === "" ? name.name : `${prefix}/${name.name}`;
      if (name.isDirectory()) walk(join(d, name.name), rel);
      else out[rel] = readFileSync(join(d, name.name), "utf-8");
    }
  };
  walk(dir, "");
  return out;
}

/** The AC pins neither Map nor plain object for the checkbox state. */
function asRecord(state: unknown): Record<string, string> {
  if (state instanceof Map) return Object.fromEntries(state) as Record<string, string>;
  if (state !== null && typeof state === "object" && !Array.isArray(state)) {
    return state as Record<string, string>;
  }
  throw new Error(`extractPlanCheckboxState must return a Map or plain object, got ${typeof state}`);
}

/** `frNumber` may be 8, "8", or "FR-8" — the AC does not say. Compare digits. */
const frNum = (value: unknown): string => String(value).replace(/^FR-/, "");

/** `evidence` may be one string or a list of them. */
const evidenceText = (value: unknown): string =>
  Array.isArray(value) ? value.join(" ") : String(value);

// ---------------------------------------------------------------------------
// AC-STE-392.1 — registry registration
// ---------------------------------------------------------------------------

describe("AC-STE-392.1 — the registry gains its first `assisted` entry", () => {
  test("`monolith-split` is registered in MIGRATIONS", () => {
    expect(MIGRATIONS.map((e) => e.id)).toContain("monolith-split");
  });

  test("the exported entry is the one the registry carries", () => {
    expect(MIGRATIONS.find((e) => e.id === "monolith-split")).toBe(monolithSplit);
  });

  test("introduced_in is v1.16.0 — the convention-pivot release", () => {
    expect(monolithSplit.introduced_in.replace(/^v/, "")).toBe("1.16.0");
  });

  test("kind is `assisted` and it carries NO apply (assisted entries have no scripted fix)", () => {
    expect(monolithSplit.kind).toBe("assisted");
    expect(monolithSplit.apply).toBeUndefined();
  });

  test("it is the registry's first assisted entry", () => {
    expect(MIGRATIONS.filter((e) => e.kind === "assisted").map((e) => e.id)).toEqual([
      "monolith-split",
    ]);
  });

  test("v1.16.0 predates every seeded entry, so it sorts FIRST", () => {
    // The registry's ascending-`introduced_in` invariant is load-bearing here:
    // a careless append would throw at module load rather than sort silently.
    expect(MIGRATIONS[0]!.id).toBe("monolith-split");
  });

  test("it carries a non-empty title", () => {
    expect(typeof monolithSplit.title).toBe("string");
    expect(monolithSplit.title.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-392.1 — the detector, both polarities
// ---------------------------------------------------------------------------

describe("AC-STE-392.1 — detect fires on a monolithic tree", () => {
  test("FR sections present + specs/frs/ ABSENT ⇒ applies, with evidence", () => {
    withTree(
      { "specs/requirements.md": MONOLITH_REQUIREMENTS, "specs/plan.md": MONOLITH_PLAN },
      (root) => {
        const res = monolithSplit.detect(root);
        expect(res.applies).toBe(true);
        expect(res.evidence.length).toBeGreaterThan(0);
      },
    );
  });

  test("FR sections present + specs/frs/ EMPTY ⇒ applies (the AC's second limb)", () => {
    const root = makeTree({
      "specs/requirements.md": MONOLITH_REQUIREMENTS,
      "specs/plan.md": MONOLITH_PLAN,
    });
    try {
      mkdirSync(join(root, "specs", "frs"), { recursive: true });
      expect(monolithSplit.detect(root).applies).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("evidence names the section count (3 live sections) and the plan shape", () => {
    withTree(
      { "specs/requirements.md": MONOLITH_REQUIREMENTS, "specs/plan.md": MONOLITH_PLAN },
      (root) => {
        const text = monolithSplit.detect(root).evidence.join(" ");
        // The archived-pointer section (FR-9) is not live work: 3, not 4.
        expect(text).toMatch(/\b3\b/);
        expect(text).toMatch(/section/i);
        expect(text).toMatch(/plan/i);
      },
    );
  });
});

describe("AC-STE-392.1 — detect stays quiet on a conforming tree", () => {
  test("post-split fixture (cross-cutting requirements + per-FR files) ⇒ false", () => {
    withTree(
      {
        "specs/requirements.md": POST_SPLIT_REQUIREMENTS,
        "specs/frs/STE-500.md": "---\ntitle: Widget import\n---\n\n# STE-500\n",
        "specs/plan/M2.md": "# M2\n\n- [ ] AC-STE-500.1 — CSV rows become widgets\n",
      },
      (root) => {
        expect(monolithSplit.detect(root).applies).toBe(false);
      },
    );
  });

  test("re-run semantics: a split tree that still has the FR sections does NOT re-fire", () => {
    // The post-split detector "goes quiet" because `specs/frs/` is populated —
    // proving the second limb of the conjunction is load-bearing, not decorative.
    withTree(
      {
        "specs/requirements.md": MONOLITH_REQUIREMENTS,
        "specs/frs/STE-500.md": "---\ntitle: Widget import\n---\n",
      },
      (root) => {
        expect(monolithSplit.detect(root).applies).toBe(false);
      },
    );
  });

  test("the SHIPPED fresh requirements template does not trip the detector", () => {
    // The template's HTML comment mentions `### FR-N: [Feature Name]` while
    // forbidding it. A detector that matches that comment would fire on every
    // freshly-bootstrapped tree.
    withTree({ "specs/requirements.md": readFileSync(REQUIREMENTS_TEMPLATE, "utf-8") }, (root) => {
      expect(monolithSplit.detect(root).applies).toBe(false);
    });
  });

  test("no specs/ tree at all ⇒ false", () => {
    withTree({ "README.md": "# x\n" }, (root) => {
      expect(monolithSplit.detect(root).applies).toBe(false);
    });
  });
});

describe("AC-STE-392.1 — detect is pure, deterministic, and non-mutating", () => {
  test("two runs over the same tree agree", () => {
    withTree(
      { "specs/requirements.md": MONOLITH_REQUIREMENTS, "specs/plan.md": MONOLITH_PLAN },
      (root) => {
        expect(monolithSplit.detect(root)).toEqual(monolithSplit.detect(root));
      },
    );
  });

  test("detecting a monolith leaves the tree byte-identical", () => {
    withTree(
      { "specs/requirements.md": MONOLITH_REQUIREMENTS, "specs/plan.md": MONOLITH_PLAN },
      (root) => {
        const before = snapshot(root);
        monolithSplit.detect(root);
        expect(snapshot(root)).toEqual(before);
      },
    );
  });

  test("detect is synchronous — the registry walk is a plain loop", () => {
    withTree({ "specs/requirements.md": MONOLITH_REQUIREMENTS }, (root) => {
      const res = monolithSplit.detect(root) as unknown as { then?: unknown };
      expect(typeof res.then).not.toBe("function");
    });
  });
});

// ---------------------------------------------------------------------------
// AC-STE-392.3 — parseMonolithFRSections
// ---------------------------------------------------------------------------

describe("AC-STE-392.3 — parseMonolithFRSections", () => {
  const sections = () => parseMonolithFRSections(MONOLITH_REQUIREMENTS);

  test("returns the 3 LIVE sections, skipping the `> archived:` pointer", () => {
    expect(sections().map((s) => frNum(s.frNumber))).toEqual(["8", "12", "31"]);
  });

  test("FR-number gaps are preserved verbatim — nothing renumbers to 1..N", () => {
    // The real tree gaps at FR-31. A parser that indexed by position would
    // silently rewrite every downstream AC id.
    expect(sections().map((s) => frNum(s.frNumber))).not.toEqual(["1", "2", "3"]);
  });

  test("title excludes the `FR-N:` prefix and the `{#FR-N}` anchor", () => {
    expect(sections().map((s) => s.title)).toEqual([
      "Widget search",
      "Widget import",
      "Monthly rollup",
    ]);
  });

  test("acLines collect that section's AC bullets, in order", () => {
    const fr12 = sections().find((s) => frNum(s.frNumber) === "12")!;
    expect(fr12.acLines.length).toBe(3);
    expect(fr12.acLines[0]).toMatch(/AC-12\.1\b.*CSV rows become widgets/);
    expect(fr12.acLines[1]).toMatch(/AC-12\.2\b.*Malformed rows are rejected/);
    expect(fr12.acLines[2]).toMatch(/AC-12\.3\b.*Import is idempotent/);
  });

  test("a section's acLines never bleed into the next section", () => {
    const fr8 = sections().find((s) => frNum(s.frNumber) === "8")!;
    expect(fr8.acLines.length).toBe(2);
    expect(fr8.acLines.join("\n")).not.toMatch(/AC-12\./);
  });

  test("background carries the section's prose", () => {
    const fr8 = sections().find((s) => frNum(s.frNumber) === "8")!;
    expect(fr8.background).toMatch(/operators need to find widgets by name/);
  });

  test("the archived-pointer section contributes nothing at all", () => {
    const all = JSON.stringify(sections());
    expect(all).not.toMatch(/Widget export/);
    expect(all).not.toMatch(/archived:/);
  });

  test("a requirements file with no FR sections yields none", () => {
    expect(parseMonolithFRSections(POST_SPLIT_REQUIREMENTS)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-392.3 — extractPlanCheckboxState
// ---------------------------------------------------------------------------

describe("AC-STE-392.3 — extractPlanCheckboxState", () => {
  const state = () => asRecord(extractPlanCheckboxState(MONOLITH_PLAN));

  test("`[x]` rows read as checked", () => {
    expect(state()["AC-8.1"]).toBe("checked");
    expect(state()["AC-8.2"]).toBe("checked");
    expect(state()["AC-12.1"]).toBe("checked");
  });

  test("`[ ]` rows read as unchecked", () => {
    expect(state()["AC-12.2"]).toBe("unchecked");
    expect(state()["AC-31.1"]).toBe("unchecked");
  });

  test("`[~]` rows read as partial — not silently rounded to either pole", () => {
    expect(state()["AC-12.3"]).toBe("partial");
  });

  test("every checkbox row is captured and nothing else is", () => {
    expect(Object.keys(state()).sort()).toEqual([
      "AC-12.1",
      "AC-12.2",
      "AC-12.3",
      "AC-31.1",
      "AC-8.1",
      "AC-8.2",
    ]);
  });

  test("a plan with no checkbox rows yields an empty map", () => {
    expect(Object.keys(asRecord(extractPlanCheckboxState("# Plan\n\n## M1\n\nProse only.\n")))).toEqual(
      [],
    );
  });
});

// ---------------------------------------------------------------------------
// AC-STE-392.3 — classifyFRs
// ---------------------------------------------------------------------------

describe("AC-STE-392.3 — classifyFRs (split-brain tolerant)", () => {
  const classify = () =>
    classifyFRs(
      parseMonolithFRSections(MONOLITH_REQUIREMENTS),
      extractPlanCheckboxState(MONOLITH_PLAN),
    );

  const dispositionOf = (fr: string): string =>
    classify().find((c) => frNum(c.frNumber) === fr)!.disposition;

  test("an FR whose every AC is checked ⇒ shipped", () => {
    expect(dispositionOf("8")).toBe("shipped");
  });

  test("an FR with an unchecked AC ⇒ open", () => {
    expect(dispositionOf("31")).toBe("open");
  });

  test("an FR with a `[~]` partial AC ⇒ open — partial work is not shipped", () => {
    // FR-12 mixes checked (12.1), unchecked (12.2) and partial (12.3).
    expect(dispositionOf("12")).toBe("open");
  });

  test("split-brain: state lives ONLY in the plan, and the plan decides", () => {
    // The monolith's own AC bullets carry no checkboxes at all — the classifier
    // must read the plan rather than concluding "no checkbox ⇒ not shipped".
    expect(MONOLITH_REQUIREMENTS).not.toMatch(/\[x\]/);
    expect(dispositionOf("8")).toBe("shipped");
  });

  test("one classification per live section, in section order", () => {
    expect(classify().map((c) => frNum(c.frNumber))).toEqual(["8", "12", "31"]);
  });

  test("every classification carries evidence naming a deciding AC", () => {
    for (const c of classify()) {
      expect(evidenceText(c.evidence).length).toBeGreaterThan(0);
    }
    expect(evidenceText(classify().find((c) => frNum(c.frNumber) === "12")!.evidence)).toMatch(
      /AC-12\.(2|3)/,
    );
  });

  test("an FR the plan never mentions ⇒ open, and says so — never assumed shipped", () => {
    // Conservative default: freezing work that cannot be PROVEN shipped would
    // bury it in the read-only archive. Triage exists because state lies.
    const orphan = parseMonolithFRSections(
      ["### FR-40: Audit log {#FR-40}", "", "- AC-40.1: Every write is logged.", ""].join("\n"),
    );
    const [result] = classifyFRs(orphan, extractPlanCheckboxState(MONOLITH_PLAN));
    expect(result!.disposition).toBe("open");
    expect(evidenceText(result!.evidence)).toMatch(/no|absent|missing|unknown|not found/i);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-392.4 — rewriteAcPrefix
// ---------------------------------------------------------------------------

describe("AC-STE-392.4 — rewriteAcPrefix (tracker mode)", () => {
  const LINES = [
    "- AC-8.1: Query returns matches ranked by score.",
    "- AC-8.2: Empty query returns an empty list.",
  ];

  test("`AC-8.1` → `AC-STE-500.1`, dotted suffix preserved", () => {
    const out = rewriteAcPrefix(LINES, "STE-500");
    expect(out[0]).toMatch(/AC-STE-500\.1\b/);
    expect(out[1]).toMatch(/AC-STE-500\.2\b/);
  });

  test("no legacy dotted AC id survives the rewrite", () => {
    expect(rewriteAcPrefix(LINES, "STE-500").join("\n")).not.toMatch(/AC-8\.\d/);
  });

  test("order is preserved and the AC prose is untouched", () => {
    const out = rewriteAcPrefix(LINES, "STE-500");
    expect(out[0]).toMatch(/Query returns matches ranked by score\./);
    expect(out[1]).toMatch(/Empty query returns an empty list\./);
  });

  test("a provenance line naming the legacy FR number is appended", () => {
    const out = rewriteAcPrefix(LINES, "STE-500");
    expect(out.length).toBe(3);
    const provenance = out[out.length - 1]!;
    expect(provenance).toMatch(/\bFR-8\b/);
    expect(provenance).toMatch(/legacy|split|migrat/i);
  });

  test("the provenance line lands AFTER the ACs, not among them", () => {
    const out = rewriteAcPrefix(LINES, "STE-500");
    expect(out.slice(0, 2).join("\n")).not.toMatch(/legacy|split|migrat/i);
  });
});

describe("AC-STE-392.4 — rewriteAcPrefix (mode: none short-ULID prefix)", () => {
  test("a 6-char short-ULID tail works exactly as a tracker id does", () => {
    const out = rewriteAcPrefix(["- AC-12.3: Import is idempotent."], "K3M9QX");
    expect(out[0]).toMatch(/AC-K3M9QX\.3\b/);
    expect(out[0]).not.toMatch(/AC-12\.3/);
  });

  test("the derived provenance still names the legacy FR", () => {
    const out = rewriteAcPrefix(["- AC-12.3: Import is idempotent."], "K3M9QX");
    expect(out[out.length - 1]).toMatch(/\bFR-12\b/);
  });
});

describe("AC-STE-392.4 — rewriteAcPrefix leaves non-AC content alone", () => {
  test("prose that merely mentions a version number is not rewritten", () => {
    const out = rewriteAcPrefix(
      ["Background: retired in v1.16.0 — see 8.1 of the old design note.", "- AC-8.1: Ships."],
      "STE-500",
    );
    expect(out[0]).toBe("Background: retired in v1.16.0 — see 8.1 of the old design note.");
  });

  test("an inline cross-reference to the same FR's AC IS re-keyed", () => {
    const out = rewriteAcPrefix(["- AC-8.2: Same ranking rule as AC-8.1."], "STE-500");
    expect(out[0]).toMatch(/AC-STE-500\.2:.*AC-STE-500\.1/);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-392.8 — non-vacuity + no-probe-regression proxies
//
// The "full gate green" AC is validated by the gate itself; these are the
// deterministic proxies. (Detector polarity is proven both ways above.)
// ---------------------------------------------------------------------------

describe("AC-STE-392.8 — the registry's own invariants survive the new entry", () => {
  test("ids stay unique", () => {
    const ids = MIGRATIONS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("introduced_in stays ascending across the whole list", () => {
    const tuple = (v: string): number[] => v.replace(/^v/, "").split(".").map(Number);
    for (let i = 1; i < MIGRATIONS.length; i++) {
      const [a, b] = [tuple(MIGRATIONS[i - 1]!.introduced_in), tuple(MIGRATIONS[i]!.introduced_in)];
      expect(a[0]! < b[0]! || (a[0] === b[0] && (a[1]! < b[1]! || (a[1] === b[1] && a[2]! <= b[2]!)))).toBe(
        true,
      );
    }
  });

  test("`apply` is present iff kind is `script` — the assisted entry included", () => {
    for (const e of MIGRATIONS) {
      if (e.kind === "script") expect(typeof e.apply).toBe("function");
      else expect(e.apply).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// AC-STE-409.1 … .6 — content-aware emptiness limb
//
// Today the detector's second limb is `split.length > 0` (monolith_split.ts:235):
// specs/frs/ counts as "already split" the moment `readdirSync` returns ANY
// entry — so a `.gitkeep`-only or /setup-scaffold-shaped folder silently
// disables the migration. STE-409 replaces that with a recursive,
// dot-entry-skipping, `.md`-only content check: only real per-FR markdown counts
// as evidence of a completed split. These fixtures pin every shape.
// ---------------------------------------------------------------------------

/** The live-monolith precondition every STE-409 shape shares (both files). */
const LIVE_MONOLITH: Record<string, string> = {
  "specs/requirements.md": MONOLITH_REQUIREMENTS,
  "specs/plan.md": MONOLITH_PLAN,
};

/** A real per-FR markdown body — the only thing that evidences a split. */
const PER_FR_FILE = "---\ntitle: Widget import\n---\n\n# STE-500\n";

/** AC-STE-409.5 — the present-but-contentless evidence line, byte-for-byte. */
const SCAFFOLD_EVIDENCE =
  "specs/frs/ carries only scaffold artifacts — no FR has been split out into a per-FR file yet";

/** The absent/unreadable branch keeps today's wording, byte-for-byte. */
const ABSENT_EVIDENCE = "specs/frs/ is absent — no FR has been split out into a per-FR file yet";

describe("AC-STE-409.1 — a `.gitkeep`-only specs/frs/ is not-split", () => {
  test("live FR sections + specs/frs/ holding only `.gitkeep` ⇒ applies", () => {
    // A recursive scan that skips dot-entries finds no regular `.md` file, so the
    // emptiness limb still holds. Today `readdirSync` returns [".gitkeep"], so the
    // `split.length > 0` limb reads this as "already split" — this is RED now.
    withTree({ ...LIVE_MONOLITH, "specs/frs/.gitkeep": "" }, (root) => {
      expect(monolithSplit.detect(root).applies).toBe(true);
    });
  });
});

describe("AC-STE-409.2 — the exact /setup scaffold shape is not-split", () => {
  test("specs/frs/.gitkeep + specs/frs/archive/.gitkeep, live sections ⇒ applies", () => {
    // The scaffold listing is [".gitkeep", "archive"]; a plain dotfile filter
    // still leaves `archive`, so the check must recurse and find NO `.md`. Today
    // `split.length > 0` is 2 > 0 ⇒ reads as split — RED now.
    withTree(
      { ...LIVE_MONOLITH, "specs/frs/.gitkeep": "", "specs/frs/archive/.gitkeep": "" },
      (root) => {
        expect(monolithSplit.detect(root).applies).toBe(true);
      },
    );
  });
});

describe("AC-STE-409.3 — a real per-FR .md preserves STE-392 re-run semantics", () => {
  test("(a) a real top-level per-FR .md ⇒ does NOT re-fire (applies false)", () => {
    withTree({ ...LIVE_MONOLITH, "specs/frs/STE-500.md": PER_FR_FILE }, (root) => {
      expect(monolithSplit.detect(root).applies).toBe(false);
    });
  });

  test("(b) an archive-only real .md (specs/frs/ otherwise .gitkeep-only) ⇒ applies false", () => {
    // The recursive scan reaches specs/frs/archive/STE-500.md — a real `.md`
    // under a non-dot subdirectory — so the split reads as done and stays quiet.
    withTree(
      {
        ...LIVE_MONOLITH,
        "specs/frs/.gitkeep": "",
        "specs/frs/archive/STE-500.md": PER_FR_FILE,
      },
      (root) => {
        expect(monolithSplit.detect(root).applies).toBe(false);
      },
    );
  });
});

describe("AC-STE-409.4 — purity + throw-guard on a non-directory specs/frs/", () => {
  test("specs/frs is a regular FILE ⇒ degrades to not-split WITHOUT throwing", () => {
    // The ENOTDIR the readdir would raise must be caught and treated as "no
    // content seen": live sections + no readable frs content ⇒ applies true.
    withTree({ ...LIVE_MONOLITH, "specs/frs": "i am a file, not a directory\n" }, (root) => {
      expect(() => monolithSplit.detect(root)).not.toThrow();
      expect(monolithSplit.detect(root).applies).toBe(true);
    });
  });

  test("detect stays synchronous on the non-directory shape", () => {
    withTree({ ...LIVE_MONOLITH, "specs/frs": "regular file\n" }, (root) => {
      const res = monolithSplit.detect(root) as unknown as { then?: unknown };
      expect(typeof res.then).not.toBe("function");
    });
  });

  test("detect mutates nothing on the non-directory shape", () => {
    withTree({ ...LIVE_MONOLITH, "specs/frs": "regular file\n" }, (root) => {
      const before = snapshot(root);
      monolithSplit.detect(root);
      expect(snapshot(root)).toEqual(before);
    });
  });
});

describe("AC-STE-409.5 — present-but-contentless evidence names scaffold artifacts", () => {
  test("scaffold-shape tree emits the scaffold-artifacts line byte-for-byte", () => {
    // RED now: on a scaffold-shape tree today's detector returns applies:false
    // with evidence:[], so no entry equals this string.
    withTree(
      { ...LIVE_MONOLITH, "specs/frs/.gitkeep": "", "specs/frs/archive/.gitkeep": "" },
      (root) => {
        expect(monolithSplit.detect(root).evidence).toContain(SCAFFOLD_EVIDENCE);
      },
    );
  });

  test("`.gitkeep`-only tree emits the same scaffold-artifacts line byte-for-byte", () => {
    withTree({ ...LIVE_MONOLITH, "specs/frs/.gitkeep": "" }, (root) => {
      expect(monolithSplit.detect(root).evidence).toContain(SCAFFOLD_EVIDENCE);
    });
  });

  test("the absent branch keeps today's `is absent` wording, byte-for-byte", () => {
    withTree({ ...LIVE_MONOLITH }, (root) => {
      expect(monolithSplit.detect(root).evidence).toContain(ABSENT_EVIDENCE);
    });
  });
});

describe("AC-STE-409.6 — every specs/frs/ shape maps to the exact `applies` verdict", () => {
  test("(1) `.gitkeep`-only ⇒ applies true", () => {
    withTree({ ...LIVE_MONOLITH, "specs/frs/.gitkeep": "" }, (root) => {
      expect(monolithSplit.detect(root).applies).toBe(true);
    });
  });

  test("(2) full scaffold shape (.gitkeep + archive/.gitkeep) ⇒ applies true", () => {
    withTree(
      { ...LIVE_MONOLITH, "specs/frs/.gitkeep": "", "specs/frs/archive/.gitkeep": "" },
      (root) => {
        expect(monolithSplit.detect(root).applies).toBe(true);
      },
    );
  });

  test("(3) a real top-level per-FR .md ⇒ applies false", () => {
    withTree({ ...LIVE_MONOLITH, "specs/frs/STE-500.md": PER_FR_FILE }, (root) => {
      expect(monolithSplit.detect(root).applies).toBe(false);
    });
  });

  test("(4) an archive-only real .md ⇒ applies false", () => {
    withTree(
      { ...LIVE_MONOLITH, "specs/frs/.gitkeep": "", "specs/frs/archive/STE-500.md": PER_FR_FILE },
      (root) => {
        expect(monolithSplit.detect(root).applies).toBe(false);
      },
    );
  });

  test("(5) a plain-empty specs/frs/ directory ⇒ applies true (existing case stays green)", () => {
    const root = makeTree({ ...LIVE_MONOLITH });
    try {
      mkdirSync(join(root, "specs", "frs"), { recursive: true });
      expect(monolithSplit.detect(root).applies).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("(6) an absent specs/frs/ directory ⇒ applies true (existing case stays green)", () => {
    withTree({ ...LIVE_MONOLITH }, (root) => {
      expect(monolithSplit.detect(root).applies).toBe(true);
    });
  });
});

describe("AC-STE-409.1 hardening — only a REGULAR `.md` file is real content", () => {
  test("a symlink named `*.md` under specs/frs/ does NOT count as a split (applies stays true)", () => {
    // Phase-3 Pass-2 review finding: the leaf check is `isFile()`, not
    // `!isDirectory()`. AC-STE-409.1 pins "a regular `.md` file"; a symlink (or
    // FIFO/device) named `*.md` is not one, so a crafted `specs/frs/` entry must
    // not silence the monolith advisory on a hostile consumer tree. `Dirent`
    // reports the entry's own type, so the symlink is neither a dir nor a file
    // and the recursive scan skips it — no content seen ⇒ the split still pends.
    const root = makeTree({ ...LIVE_MONOLITH, "target-outside.md": PER_FR_FILE });
    try {
      mkdirSync(join(root, "specs", "frs"), { recursive: true });
      symlinkSync(join(root, "target-outside.md"), join(root, "specs", "frs", "ghost.md"));
      expect(monolithSplit.detect(root).applies).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
