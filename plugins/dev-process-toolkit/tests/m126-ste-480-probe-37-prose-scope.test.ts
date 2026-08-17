// STE-480 (M126) — Probe #37 must surface stale prose references, not only
// directory-tree leaves.
//
// WHAT IS ACTUALLY BROKEN. The FR's Requirement sentence names
// `scan_cross_cutting_spec_refs.ts` as the thing that must widen. That is not
// where the defect lives. The helper has emitted `proseMention` for every
// out-of-fence line since STE-215 and has NO fence info-string scoping at all
// (it toggles on any ``` line). The M118 / STE-433 accept-list
// (`TREE_FENCE_INFO_ACCEPT_LIST`) and the actual defect both live in the PROBE
// module `adapters/_shared/src/cross_cutting_spec_stale_file_refs.ts`, whose
// scan loop reads:
//
//     if (fenceInfo === null) continue;   // ⇐ prose is never scanned
//
// So the widening is a PROBE change. Every red assertion below is therefore
// aimed at `runCrossCuttingSpecStaleFileRefsProbe`; the helper-facing
// assertions are non-regression pins, explicitly framed as such so a reader
// does not mistake a green-from-birth test for teeth.
//
// DISCRIMINATOR. A widened probe must keep the two reference shapes
// distinguishable in its returned violations, so `/implement` § 4b′ can keep
// its split policy (delete tree leaves, record prose for operator amendment)
// and so an advisory prose row can never be mistaken for a blocking one. These
// tests pin a `kind` field carrying the helper's existing `RefKind` vocabulary
// (`"treeLeaf"` / `"proseMention"`) onto each violation. `kindOf` reads it
// defensively so the suite loads and fails one assertion at a time while the
// field is still missing, rather than taking the whole file down.
//
// FALSIFIABILITY. Every fixture whose expectation is "zero violations" uses a
// token the matcher WOULD flag if the rule under test were absent (≥ 5 chars,
// contains `/`, dot-extension, non-URL, unresolvable under the fixture root).
// Every fixture whose expectation is "zero violations" for a reason unrelated
// to prose ALSO carries a live prose stale path, so the test cannot pass
// merely because the probe still scans nothing.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as staleFileRefsModule from "../adapters/_shared/src/cross_cutting_spec_stale_file_refs";
import { runCrossCuttingSpecStaleFileRefsProbe } from "../adapters/_shared/src/cross_cutting_spec_stale_file_refs";
import { runClaudeMdProbeManagedGuardProbe } from "../adapters/_shared/src/claudemd_probe_managed_guard";
import { scanCrossCuttingSpecRefs } from "../adapters/_shared/src/scan_cross_cutting_spec_refs";

const repoRoot = join(import.meta.dir, "..", "..", "..");

type AnyViolation = { note: string; severity: string; reason?: string };

/**
 * The reference-shape discriminator on a probe violation.
 *
 * Read defensively: while the field is still missing this returns `undefined`,
 * which fails the assertion under test without turning a missing property into
 * a suite-wide load error.
 */
function kindOf(v: unknown): string | undefined {
  return (v as { kind?: string } | null | undefined)?.kind;
}

function ofKind(violations: readonly unknown[], kind: string): unknown[] {
  return violations.filter((v) => kindOf(v) === kind);
}

interface FixtureOpts {
  technicalSpec?: string;
  testingSpec?: string;
  /** Extra files written under `specs/` (used to pin the two-file scan scope). */
  otherSpecs?: { name: string; content: string }[];
  /** Files seeded on disk under the fixture root, so their refs DO resolve. */
  seed?: { path: string; content: string }[];
  /** Skip creating `specs/` entirely (vacuity pin). */
  noSpecsDir?: boolean;
}

function makeFixture(opts: FixtureOpts): {
  root: string;
  specsDir: string;
  cleanup: () => void;
} {
  const root = mkdtempSync(join(tmpdir(), "ste480-prose-scope-"));
  const specsDir = join(root, "specs");
  if (!opts.noSpecsDir) {
    mkdirSync(specsDir, { recursive: true });
    if (opts.technicalSpec !== undefined) {
      writeFileSync(join(specsDir, "technical-spec.md"), opts.technicalSpec);
    }
    if (opts.testingSpec !== undefined) {
      writeFileSync(join(specsDir, "testing-spec.md"), opts.testingSpec);
    }
    for (const f of opts.otherSpecs ?? []) {
      writeFileSync(join(specsDir, f.name), f.content);
    }
  }
  for (const f of opts.seed ?? []) {
    const abs = join(root, f.path);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, f.content);
  }
  return {
    root,
    specsDir,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

// ---------------------------------------------------------------------------
// AC-STE-480.1 — prose hits are produced from outside fences; existing
// `treeLeaf` behaviour and the M118 fence info-string scoping are unchanged.
//
// The FR attributes both halves to the helper. Only the first half is the
// helper's; the info-string scoping is the probe's. Both halves are pinned
// where they actually live.
// ---------------------------------------------------------------------------

describe("AC-STE-480.1 — prose is in scope, treeLeaf and the M118 accept-list are not disturbed", () => {
  test("NON-REGRESSION (green since STE-215): the helper already returns both shapes from one file", () => {
    const fx = makeFixture({
      technicalSpec: [
        "# Technical Spec",
        "",
        "The Bun stack ships `tests/.placeholder.test.ts` on bootstrap.",
        "",
        "```",
        "tests/",
        "└── .placeholder.test.ts",
        "```",
        "",
      ].join("\n"),
    });
    try {
      const r = scanCrossCuttingSpecRefs("tests/.placeholder.test.ts", fx.specsDir);
      const kinds = r.technicalSpec.map((h) => h.kind);
      expect(kinds).toEqual(["proseMention", "treeLeaf"]);
      expect(r.technicalSpec[0]!.line).toBe(3);
      expect(r.technicalSpec[1]!.line).toBe(7);
    } finally {
      fx.cleanup();
    }
  });

  test("the M118 accept-list constant is untouched — still exactly bare / `text` / `tree`", () => {
    const exported = (staleFileRefsModule as unknown as Record<string, unknown>)
      .TREE_FENCE_INFO_ACCEPT_LIST;
    expect(exported).toBeDefined();
    expect([...(exported as Iterable<string>)].slice().sort()).toEqual([
      "",
      "text",
      "tree",
    ]);
  });

  test("a language-tagged fence stays out of scope even though prose is now in scope", async () => {
    // Both stale paths are matcher-eligible. Only the prose one may fire: a
    // widening that drops the `fenceInfo === null` guard by deleting the
    // accept-list check alongside it would flag `config/settings/app.yaml` too.
    const fx = makeFixture({
      technicalSpec: [
        "# Technical Spec",
        "",
        "```yaml",
        "paths:",
        "  - config/settings/app.yaml",
        "```",
        "",
        "The old resolver lived at `lib/legacy/removed_resolver.ts` until M40.",
        "",
      ].join("\n"),
    });
    try {
      const r = await runCrossCuttingSpecStaleFileRefsProbe(fx.root);
      const notes = (r.violations as AnyViolation[]).map((v) => v.note);
      expect(notes.filter((n) => n.includes("config/settings/app.yaml"))).toEqual([]);
      expect(r.violations).toHaveLength(1);
      expect(notes[0]).toContain("lib/legacy/removed_resolver.ts");
      expect(kindOf(r.violations[0])).toBe("proseMention");
    } finally {
      fx.cleanup();
    }
  });

  test("existing treeLeaf behaviour is unchanged and now self-identifies as `treeLeaf`", async () => {
    const fx = makeFixture({
      technicalSpec: [
        "# Technical Spec",
        "",
        "```",
        "src/",
        "└── src/removed/gone-widget.ts",
        "```",
        "",
      ].join("\n"),
    });
    try {
      const r = await runCrossCuttingSpecStaleFileRefsProbe(fx.root);
      expect(r.violations).toHaveLength(1);
      const v = r.violations[0] as unknown as AnyViolation;
      expect(v.severity).toBe("warning");
      expect(v.note).toContain("src/removed/gone-widget.ts");
      expect(kindOf(v)).toBe("treeLeaf");
    } finally {
      fx.cleanup();
    }
  });

  test("a tagged fence still closes: the toggle does not desynchronize once prose is scanned", async () => {
    // The STE-433 desync guard, re-expressed for a prose-scanning probe. A
    // line-filtering implementation reads the `dart` fence's CLOSING marker as
    // an OPENER, which would put the prose line INSIDE a bare fence (⇒ kind
    // `treeLeaf`, wrong) and the real tree fence OUTSIDE one (⇒ kind
    // `proseMention`, wrong). Asserting counts alone cannot see that; the
    // per-hit `kind` is what makes the desync visible.
    const fx = makeFixture({
      technicalSpec: [
        "# Technical Spec",
        "",
        "```dart",
        "import 'package:my_app/models/user.dart';",
        "```",
        "",
        "The helper at `lib/legacy/removed_helper.dart` was deleted last quarter.",
        "",
        "```",
        "lib/",
        "└── lib/widgets/ghost_button.dart",
        "```",
        "",
      ].join("\n"),
    });
    try {
      const r = await runCrossCuttingSpecStaleFileRefsProbe(fx.root);
      const notes = (r.violations as AnyViolation[]).map((v) => v.note);
      expect(notes.filter((n) => n.includes("my_app/models/user.dart"))).toEqual([]);
      expect(r.violations).toHaveLength(2);
      const prose = ofKind(r.violations, "proseMention");
      const tree = ofKind(r.violations, "treeLeaf");
      expect(prose).toHaveLength(1);
      expect(tree).toHaveLength(1);
      expect((prose[0] as AnyViolation).note).toContain("lib/legacy/removed_helper.dart");
      expect((tree[0] as AnyViolation).note).toContain("lib/widgets/ghost_button.dart");
    } finally {
      fx.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// AC-STE-480.2 — prose hits are ADVISORY, tree leaves keep their current
// severity, and the two kinds stay distinguishable.
//
// Tree leaves are `warning` today. "Advisory" for prose therefore also lands on
// `warning`; severity alone cannot tell the shapes apart, which is exactly why
// `kind` has to carry the split. What severity DOES pin is the one-way door:
// a prose hit must never be `error`.
// ---------------------------------------------------------------------------

describe("AC-STE-480.2 — severity split: prose advisory, tree leaves unchanged, kinds distinguishable", () => {
  test("a mixed file yields one violation of each kind, both at warning severity", async () => {
    const fx = makeFixture({
      testingSpec: [
        "# Testing Spec",
        "",
        "Coverage used to live in `tests/legacy/old_suite.test.ts`.",
        "",
        "```",
        "tests/",
        "└── tests/fixtures/ghost.test.ts",
        "```",
        "",
      ].join("\n"),
    });
    try {
      const r = await runCrossCuttingSpecStaleFileRefsProbe(fx.root);
      expect(r.violations).toHaveLength(2);
      const prose = ofKind(r.violations, "proseMention") as AnyViolation[];
      const tree = ofKind(r.violations, "treeLeaf") as AnyViolation[];
      expect(prose).toHaveLength(1);
      expect(tree).toHaveLength(1);
      // Tree leaves keep their CURRENT severity — unchanged by this FR.
      expect(tree[0]!.severity).toBe("warning");
      // Prose is advisory.
      expect(prose[0]!.severity).toBe("warning");
    } finally {
      fx.cleanup();
    }
  });

  test("prose hits never carry `error` — they cannot silently begin blocking", async () => {
    const fx = makeFixture({
      technicalSpec: [
        "# Technical Spec",
        "",
        "Removed in M40: `lib/legacy/alpha_helper.ts`.",
        "Removed in M41: `lib/legacy/beta_helper.ts`.",
        "",
      ].join("\n"),
      testingSpec: [
        "# Testing Spec",
        "",
        "Removed in M42: `tests/legacy/gamma_suite.test.ts`.",
        "",
      ].join("\n"),
    });
    try {
      const r = await runCrossCuttingSpecStaleFileRefsProbe(fx.root);
      const prose = ofKind(r.violations, "proseMention") as AnyViolation[];
      // Guard: without this the severity sweep below passes over an empty list.
      expect(prose).toHaveLength(3);
      expect(prose.map((v) => v.severity)).toEqual(["warning", "warning", "warning"]);
      expect(prose.filter((v) => v.severity === "error")).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("the two kinds read differently in the operator-facing note", async () => {
    // A prose row that reuses the tree-leaf sentence ("directory-tree leaf
    // references missing path …") would be actively misleading — it tells the
    // operator to rewrite a directory-tree block that does not exist.
    const fx = makeFixture({
      technicalSpec: [
        "# Technical Spec",
        "",
        "The old resolver lived at `lib/legacy/removed_resolver.ts`.",
        "",
        "```",
        "src/",
        "└── src/removed/gone-widget.ts",
        "```",
        "",
      ].join("\n"),
    });
    try {
      const r = await runCrossCuttingSpecStaleFileRefsProbe(fx.root);
      const prose = ofKind(r.violations, "proseMention") as AnyViolation[];
      const tree = ofKind(r.violations, "treeLeaf") as AnyViolation[];
      expect(prose).toHaveLength(1);
      expect(tree).toHaveLength(1);
      expect(tree[0]!.note).toContain("directory-tree leaf");
      expect(prose[0]!.note).not.toContain("directory-tree leaf");
      expect(prose[0]!.note).toContain("lib/legacy/removed_resolver.ts");
    } finally {
      fx.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// AC-STE-480.3 — this repo's own cross-cutting specs carry no surviving stale
// reference once the probe widens.
//
// The FR also asks for the literal sentence "Delete it then, not before" to be
// gone. That string has never existed anywhere in THIS repo — it was
// LLM-authored prose in the conformance run's CONSUMER project
// (`dpt-test-project-none/specs/testing-spec.md`). A test asserting a string is
// absent when it was never present is a vacuous pin, so it is deliberately not
// written. What IS pinned is the satisfiable half: the placeholder reference in
// this repo's specs, and the whole-repo dogfood run.
// ---------------------------------------------------------------------------

describe("AC-STE-480.3 — the repo's own cross-cutting specs are clean", () => {
  test("no surviving reference to the deleted placeholder file in either cross-cutting spec", () => {
    const r = scanCrossCuttingSpecRefs(
      "tests/.placeholder.test.ts",
      join(repoRoot, "specs"),
    );
    // Today: technical-spec.md:472 names it in a table row describing a file
    // `/setup` generates in CONSUMER projects, so it resolves nowhere at this
    // repo's root. Either the row is requalified or it goes; it cannot stay as
    // an unqualified repo-root-relative path.
    expect(r.technicalSpec.map((h) => `${h.line}:${h.kind}`)).toEqual([]);
    expect(r.testingSpec.map((h) => `${h.line}:${h.kind}`)).toEqual([]);
  });

  test("DOGFOOD — probe #37 is clean on this repo, with prose scanning proven live first", async () => {
    // Guard half. Without it the dogfood half stays trivially green: a probe
    // that scans no prose at all reports zero on this repo for the wrong
    // reason. The guard makes the dogfood assertion load-bearing.
    const guard = makeFixture({
      technicalSpec: [
        "# Technical Spec",
        "",
        "Removed last quarter: `lib/legacy/dogfood_guard.ts`.",
        "",
      ].join("\n"),
    });
    try {
      const g = await runCrossCuttingSpecStaleFileRefsProbe(guard.root);
      expect(ofKind(g.violations, "proseMention")).toHaveLength(1);
    } finally {
      guard.cleanup();
    }

    // Dogfood half.
    const r = await runCrossCuttingSpecStaleFileRefsProbe(repoRoot);
    expect((r.violations as AnyViolation[]).map((v) => v.note)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-480.4 — exact counts on a prose-only fixture, in both mutation
// directions.
// ---------------------------------------------------------------------------

describe("AC-STE-480.4 — prose-only fixture: exactly one proseMention, zero treeLeaf", () => {
  test("probe: one proseMention / zero treeLeaf, and removing the line reports none", async () => {
    const body = (withRef: boolean) =>
      [
        "# Technical Spec",
        "",
        withRef
          ? "The old resolver lived at `lib/legacy/removed_resolver.ts` until M40."
          : "The old resolver was retired in M40.",
        "",
      ].join("\n");

    const present = makeFixture({ technicalSpec: body(true) });
    try {
      const r = await runCrossCuttingSpecStaleFileRefsProbe(present.root);
      expect(ofKind(r.violations, "proseMention")).toHaveLength(1);
      expect(ofKind(r.violations, "treeLeaf")).toHaveLength(0);
      expect(r.violations).toHaveLength(1);
    } finally {
      present.cleanup();
    }

    // Mutation, other direction: the reference is the only thing that changed.
    const absent = makeFixture({ technicalSpec: body(false) });
    try {
      const r = await runCrossCuttingSpecStaleFileRefsProbe(absent.root);
      expect(r.violations).toEqual([]);
    } finally {
      absent.cleanup();
    }
  });

  test("probe: a prose path that DOES resolve on disk is not reported", async () => {
    const fx = makeFixture({
      technicalSpec: [
        "# Technical Spec",
        "",
        "The greeter lives at `src/greet.ts` and is load-bearing.",
        "The retired one was `src/removed/old_greet.ts`.",
        "",
      ].join("\n"),
      seed: [{ path: "src/greet.ts", content: "export const greet = 'hi';\n" }],
    });
    try {
      const r = await runCrossCuttingSpecStaleFileRefsProbe(fx.root);
      const notes = (r.violations as AnyViolation[]).map((v) => v.note);
      expect(notes.filter((n) => n.includes("src/greet.ts"))).toEqual([]);
      // Paired live hit — proves the fixture is being scanned at all.
      expect(r.violations).toHaveLength(1);
      expect(notes[0]).toContain("src/removed/old_greet.ts");
    } finally {
      fx.cleanup();
    }
  });

  test("NON-REGRESSION (green since STE-215): the helper already reports exactly one proseMention, both directions", () => {
    const present = makeFixture({
      testingSpec: [
        "# Testing Spec",
        "",
        "We delete `.placeholder.test.ts` once the first real test ships.",
        "",
      ].join("\n"),
    });
    try {
      const r = scanCrossCuttingSpecRefs("tests/.placeholder.test.ts", present.specsDir);
      expect(r.testingSpec.map((h) => h.kind)).toEqual(["proseMention"]);
      expect(r.technicalSpec).toEqual([]);
    } finally {
      present.cleanup();
    }

    const absent = makeFixture({
      testingSpec: "# Testing Spec\n\nWe delete the bootstrap stub once a real test ships.\n",
    });
    try {
      const r = scanCrossCuttingSpecRefs("tests/.placeholder.test.ts", absent.specsDir);
      expect(r.testingSpec).toEqual([]);
      expect(r.technicalSpec).toEqual([]);
    } finally {
      absent.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// AC-STE-480.5 — widening the scan does not widen the blast radius.
//
// HONEST READING. There is no unmanaged-tree guard on probe #37 to preserve.
// STE-434 shipped `claudemd_probe_managed_guard.ts` — probe #74, a DIFFERENT
// probe, and a structural fuse over modules that resolve a CLAUDE.md path.
// Probe #37 resolves no CLAUDE.md path, has no `isToolkitManaged` call, and
// `/gate-check` has no global unmanaged-tree short-circuit that reaches it (the
// only Step-0 applicability short-circuit in SKILL.md belongs to probe #69).
// So this AC is pinned as what it can actually mean: the widening must not
// enlarge what the probe reads, what it can flag, or where its severity can
// land — plus probe #74 must stay clean, which is the real "STE-434 guard"
// obligation the widened probe could break (by adding an ungated CLAUDE.md
// read to decide managed-ness).
// ---------------------------------------------------------------------------

describe("AC-STE-480.5 — blast radius stays where it was", () => {
  test("prose scanning reaches only technical-spec.md and testing-spec.md", async () => {
    const fx = makeFixture({
      technicalSpec: [
        "# Technical Spec",
        "",
        "Removed in M40: `lib/legacy/in_scope_helper.ts`.",
        "",
      ].join("\n"),
      otherSpecs: [
        {
          name: "requirements.md",
          content:
            "# Requirements\n\nHistorical note: `lib/legacy/out_of_scope_helper.ts` was removed in M12.\n",
        },
        {
          name: "testing-strategy.md",
          content:
            "# Strategy\n\nSee `tests/legacy/out_of_scope_suite.test.ts` for the retired shape.\n",
        },
      ],
    });
    try {
      const r = await runCrossCuttingSpecStaleFileRefsProbe(fx.root);
      const notes = (r.violations as AnyViolation[]).map((v) => v.note);
      expect(notes.filter((n) => n.includes("out_of_scope"))).toEqual([]);
      // Paired live hit — the in-scope file IS scanned, so the exclusions above
      // are exclusions and not a dead probe.
      expect(r.violations).toHaveLength(1);
      expect(notes[0]).toContain("lib/legacy/in_scope_helper.ts");
    } finally {
      fx.cleanup();
    }
  });

  test("the token rules are unchanged for prose: bare basenames and URLs stay skipped", async () => {
    const fx = makeFixture({
      technicalSpec: [
        "# Technical Spec",
        "",
        "The `greet.ts` module carried the old entry point.",
        "The manifest lived at https://example.com/registry/foo.json before M30.",
        "The retired resolver was `lib/legacy/slashed_helper.ts`.",
        "",
      ].join("\n"),
    });
    try {
      const r = await runCrossCuttingSpecStaleFileRefsProbe(fx.root);
      const notes = (r.violations as AnyViolation[]).map((v) => v.note);
      expect(notes.filter((n) => n.includes("greet.ts"))).toEqual([]);
      expect(notes.filter((n) => n.includes("foo.json"))).toEqual([]);
      // Paired live hit.
      expect(r.violations).toHaveLength(1);
      expect(notes[0]).toContain("lib/legacy/slashed_helper.ts");
    } finally {
      fx.cleanup();
    }
  });

  test("vacuity is preserved: no specs dir, and both spec files absent, still report nothing", async () => {
    const noDir = makeFixture({ noSpecsDir: true });
    try {
      const r = await runCrossCuttingSpecStaleFileRefsProbe(noDir.root);
      expect(r.violations).toEqual([]);
    } finally {
      noDir.cleanup();
    }

    const emptySpecs = makeFixture({
      otherSpecs: [
        {
          name: "requirements.md",
          content: "# Requirements\n\nGone in M12: `lib/legacy/ignored_helper.ts`.\n",
        },
      ],
    });
    try {
      const r = await runCrossCuttingSpecStaleFileRefsProbe(emptySpecs.root);
      expect(r.violations).toEqual([]);
    } finally {
      emptySpecs.cleanup();
    }
  });

  test("probe #74 (STE-434) stays clean — the widened probe adds no ungated CLAUDE.md read", async () => {
    const guard = await runClaudeMdProbeManagedGuardProbe(repoRoot);
    expect(guard.vacuous).toBe(false);
    expect(guard.violations.map((v) => v.note)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-480.5 (blast radius) — the two NEW resolution rules the widening
// introduced are pinned here.
//
// Both were added to keep the dogfood honest: the marketplace sub-root rule
// removes 29 of the 32 false positives on this repo, and the placeholder rule
// removes the rest. An independent audit mutated each one and the whole suite
// stayed green, which means the rules that do almost all of the suppression
// were the two nothing was watching. A suppression rule with no test is the
// exact shape that turns a probe vacuous on the project that owns it, so each
// is pinned in BOTH directions below.
// ---------------------------------------------------------------------------

describe("AC-STE-480.5 — the new resolution rules are load-bearing, not blanket suppression", () => {
  const prose = (p: string) => `# Technical Spec\n\nThe module lives at \`${p}\` today.\n`;

  test("sub-root resolution is gated on the plugin MANIFEST, not on the `plugins/` name", async () => {
    // Without a manifest a `plugins/<x>/` directory is just a directory, and a
    // path under it must still be resolved against the project root — where it
    // does not exist. Mutating the manifest check into a blanket
    // "anything under plugins/ resolves" is what this reddens on.
    const noManifest = makeFixture({
      technicalSpec: prose("adapters/_shared/src/gone.ts"),
      seed: [
        { path: "plugins/notaplugin/adapters/_shared/src/gone.ts", content: "x" },
      ],
    });
    try {
      expect(staleFileRefsModule.resolutionRoots(noManifest.root)).toEqual([
        noManifest.root,
      ]);
      const r = await runCrossCuttingSpecStaleFileRefsProbe(noManifest.root);
      expect(r.violations).toHaveLength(1);
      expect(kindOf(r.violations[0])).toBe("proseMention");
    } finally {
      noManifest.cleanup();
    }
  });

  test("the SAME path resolves once the directory carries a plugin manifest", async () => {
    // One variable changed against the fixture above: the manifest exists.
    const withManifest = makeFixture({
      technicalSpec: prose("adapters/_shared/src/gone.ts"),
      seed: [
        { path: "plugins/realplugin/adapters/_shared/src/gone.ts", content: "x" },
        { path: "plugins/realplugin/.claude-plugin/plugin.json", content: "{}" },
      ],
    });
    try {
      expect(staleFileRefsModule.resolutionRoots(withManifest.root)).toHaveLength(2);
      const r = await runCrossCuttingSpecStaleFileRefsProbe(withManifest.root);
      expect(r.violations).toEqual([]);
    } finally {
      withManifest.cleanup();
    }
  });

  test("a stale path UNDER a manifest-bearing sub-root still fires — the rule resolves, it does not exempt", async () => {
    const fx = makeFixture({
      technicalSpec: prose("adapters/_shared/src/never_existed.ts"),
      seed: [{ path: "plugins/realplugin/.claude-plugin/plugin.json", content: "{}" }],
    });
    try {
      const r = await runCrossCuttingSpecStaleFileRefsProbe(fx.root);
      expect(r.violations).toHaveLength(1);
      expect((r.violations[0] as AnyViolation).note).toContain(
        "adapters/_shared/src/never_existed.ts",
      );
    } finally {
      fx.cleanup();
    }
  });

  test("the placeholder skip is EXPRESSION-scoped: a real stale path on the same line still fires", async () => {
    // The disguised-suppression failure mode is line-scoping. Under it, one
    // `<id>` anywhere in a sentence silences every real stale path beside it.
    // Both tokens sit on one line and exactly one of them is a template.
    const fx = makeFixture({
      technicalSpec:
        "# Technical Spec\n\nFragments land at `docs/.pending/<fr-id>.md` and the writer is `lib/legacy/gone_helper.ts`.\n",
    });
    try {
      const r = await runCrossCuttingSpecStaleFileRefsProbe(fx.root);
      const notes = (r.violations as AnyViolation[]).map((v) => v.note);
      // The template is skipped...
      expect(notes.filter((n) => n.includes(".pending"))).toEqual([]);
      // ...and its line-mate is NOT.
      expect(r.violations).toHaveLength(1);
      expect(notes[0]).toContain("lib/legacy/gone_helper.ts");
    } finally {
      fx.cleanup();
    }
  });

  test("a templated path alone reports nothing — the skip is real, not incidental", async () => {
    const fx = makeFixture({
      technicalSpec: "# Technical Spec\n\nFragments land at `docs/.pending/<fr-id>.md`.\n",
    });
    try {
      expect((await runCrossCuttingSpecStaleFileRefsProbe(fx.root)).violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });
});
