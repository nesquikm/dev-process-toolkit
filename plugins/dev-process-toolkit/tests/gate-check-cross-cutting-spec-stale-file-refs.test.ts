// STE-215 AC-STE-215.5 — /gate-check probe
// `cross-cutting-spec-stale-file-refs`. Severity: warning (NotesOnly).
//
// Walks `specs/technical-spec.md` and `specs/testing-spec.md` for path-
// references inside triple-backtick directory-tree blocks that don't
// resolve to an existing file on disk. Defense-in-depth read-side check
// for paths that bypass /implement's propagation step (manual deletes,
// `git rm`, downstream toolkit consumers).

import { describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCrossCuttingSpecStaleFileRefsProbe } from "../adapters/_shared/src/cross_cutting_spec_stale_file_refs";
// STE-433 asserts on the exported accept-list constant. A namespace import
// keeps the suite loadable while the export is still missing (a named import
// of a non-existent export is a link-time SyntaxError that would take the
// whole file down instead of failing one test).
import * as staleFileRefsModule from "../adapters/_shared/src/cross_cutting_spec_stale_file_refs";

function makeFixture(opts: {
  technicalSpec?: string;
  testingSpec?: string;
  /**
   * Files to seed on disk under projectRoot/<path>. The probe asserts
   * referenced paths exist; seeding lets us write fixtures whose tree
   * leaves DO resolve.
   */
  seed?: { path: string; content: string }[];
}): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "cc-stale-refs-"));
  const specs = join(root, "specs");
  mkdirSync(specs, { recursive: true });
  if (opts.technicalSpec !== undefined) {
    writeFileSync(join(specs, "technical-spec.md"), opts.technicalSpec);
  }
  if (opts.testingSpec !== undefined) {
    writeFileSync(join(specs, "testing-spec.md"), opts.testingSpec);
  }
  for (const f of opts.seed ?? []) {
    const abs = join(root, f.path);
    const dir = abs.split("/").slice(0, -1).join("/");
    mkdirSync(dir, { recursive: true });
    writeFileSync(abs, f.content);
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe("AC-STE-215.5 — stale-file-ref detection", () => {
  test("directory-tree leaf points at non-existent path ⇒ ADVISORY (not GATE FAILED)", async () => {
    const fx = makeFixture({
      technicalSpec: [
        "# Technical Spec",
        "",
        "```",
        "src/",
        "└── src/nonexistent/missing-file.ts",
        "```",
        "",
      ].join("\n"),
    });
    try {
      const r = await runCrossCuttingSpecStaleFileRefsProbe(fx.root);
      expect(r.violations.length).toBeGreaterThan(0);
      // Severity must be `warning` — never blocks the gate.
      expect(r.violations[0]!.severity).toBe("warning");
    } finally {
      fx.cleanup();
    }
  });

  test("clean tree (every full-path leaf resolves) ⇒ zero violations", async () => {
    const fx = makeFixture({
      technicalSpec: [
        "# Technical Spec",
        "",
        "```",
        "src/",
        "└── src/greet.ts",
        "```",
        "",
      ].join("\n"),
      seed: [{ path: "src/greet.ts", content: "export const greet = 'hi';\n" }],
    });
    try {
      const r = await runCrossCuttingSpecStaleFileRefsProbe(fx.root);
      const offending = r.violations.filter((v) => v.note.includes("src/greet.ts"));
      expect(offending).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("bare-basename leaf (no `/`) is NOT flagged — heuristic skip", async () => {
    const fx = makeFixture({
      technicalSpec: [
        "# Technical Spec",
        "",
        "```",
        "src/",
        "└── greet.ts",
        "```",
        "",
      ].join("\n"),
    });
    try {
      const r = await runCrossCuttingSpecStaleFileRefsProbe(fx.root);
      // Bare basenames in a tree carry no parent context — the probe
      // skips them to avoid false positives.
      expect(r.violations.filter((v) => v.note.includes("greet.ts"))).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("missing technical-spec.md / testing-spec.md ⇒ vacuous pass", async () => {
    const fx = makeFixture({});
    try {
      const r = await runCrossCuttingSpecStaleFileRefsProbe(fx.root);
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("note + message reference both the file and the missing path", async () => {
    const fx = makeFixture({
      testingSpec: [
        "# Testing Spec",
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
      expect(r.violations.length).toBeGreaterThan(0);
      const v = r.violations[0]!;
      expect(v.message).toContain("cross_cutting_spec_stale_file_refs");
      expect(v.note).toContain("testing-spec.md");
      expect(v.note).toContain("tests/fixtures/ghost.test.ts");
    } finally {
      fx.cleanup();
    }
  });

  test("prose mentions outside fences ARE flagged, as `proseMention`", async () => {
    const fx = makeFixture({
      technicalSpec: [
        "# Technical Spec",
        "",
        "We deliberately removed `src/old-helper.ts` last quarter.",
        "",
      ].join("\n"),
    });
    try {
      const r = await runCrossCuttingSpecStaleFileRefsProbe(fx.root);
      // INVERTED BY STE-480. This test used to assert `[]` here, on the
      // reading that prose is operator judgment surface and so must not be
      // scanned at all. That silence WAS the defect: a stale prose path is
      // still stale, and staying quiet about it is what let real drift ship.
      // Prose is now scanned and reported — advisory (`warning`) and tagged
      // `proseMention` so consumers can still tell it from a tree leaf, which
      // is the distinction the old expectation was really reaching for.
      expect(r.violations).toHaveLength(1);
      expect(r.violations[0]!.kind).toBe("proseMention");
      expect(r.violations[0]!.severity).toBe("warning");
      expect(r.violations[0]!.note).toContain("src/old-helper.ts");
    } finally {
      fx.cleanup();
    }
  });

  test("URL-shaped tokens inside fences are NOT flagged", async () => {
    const fx = makeFixture({
      technicalSpec: [
        "# Technical Spec",
        "",
        "```",
        "# canonical config",
        "registry: https://example.com/foo.json",
        "```",
        "",
      ].join("\n"),
    });
    try {
      const r = await runCrossCuttingSpecStaleFileRefsProbe(fx.root);
      // URLs are not local paths — must not trigger the probe.
      expect(r.violations.filter((v) => v.note.includes("foo.json"))).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// STE-433 — the fence scan is gated on the info string.
//
// Probe #37 used to flip a boolean on every triple-backtick line without ever
// reading the info string, so `dart` / `sh` / `yaml` fences were scanned as
// though they were directory trees. Every fixture below whose expectation is
// "zero violations" uses a token that the matcher WOULD have flagged before
// the gate landed (≥ 5 chars, contains `/`, dot-extension, non-URL, does not
// resolve under the fixture root) — otherwise the assertion would be vacuous.
// ---------------------------------------------------------------------------

const pluginRoot = join(import.meta.dir, "..");
const repoRoot = join(import.meta.dir, "..", "..", "..");
const gateCheckSkillPath = join(pluginRoot, "skills", "gate-check", "SKILL.md");
const probeModulePath = join(
  pluginRoot,
  "adapters",
  "_shared",
  "src",
  "cross_cutting_spec_stale_file_refs.ts",
);

/** Entry #37 of /gate-check's probe list, from its heading line to entry #38. */
function readGateCheckEntry37(): string {
  const lines = readFileSync(gateCheckSkillPath, "utf8").split("\n");
  const start = lines.findIndex((l) =>
    /^37\.\s+\*\*`cross-cutting-spec-stale-file-refs`\*\*/.test(l),
  );
  if (start < 0) return "";
  let end = start + 1;
  while (end < lines.length && !/^38\.\s/.test(lines[end]!)) end++;
  return lines.slice(start, end).join("\n");
}

/** The probe module's leading comment header (everything above the imports). */
function readProbeModuleHeader(): string {
  const lines = readFileSync(probeModulePath, "utf8").split("\n");
  const firstImport = lines.findIndex((l) => l.startsWith("import "));
  return lines.slice(0, firstImport < 0 ? lines.length : firstImport).join("\n");
}

describe("AC-STE-433 — fence scan gated on the info string", () => {
  test("AC-STE-433.1 — the accept-list is an exported constant naming bare / `text` / `tree`", () => {
    const exported = (staleFileRefsModule as unknown as Record<string, unknown>)
      .TREE_FENCE_INFO_ACCEPT_LIST;
    expect(exported).toBeDefined();
    // Array or Set — either is fine; the members are the contract.
    const members = [...(exported as Iterable<string>)];
    expect(members.slice().sort()).toEqual(["", "text", "tree"]);
  });

  test("AC-STE-433.1 — a fence with an unlisted info string is not scanned", async () => {
    const fx = makeFixture({
      technicalSpec: [
        "# Technical Spec",
        "",
        "```yaml",
        "paths:",
        "  - config/settings/app.yaml",
        "```",
        "",
      ].join("\n"),
    });
    try {
      const r = await runCrossCuttingSpecStaleFileRefsProbe(fx.root);
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("AC-STE-433.2 — a `dart` fence with a `package:` import yields zero violations", async () => {
    const fx = makeFixture({
      technicalSpec: [
        "# Technical Spec",
        "",
        "```dart",
        "import 'package:my_app/models/user.dart';",
        "```",
        "",
      ].join("\n"),
    });
    try {
      const r = await runCrossCuttingSpecStaleFileRefsProbe(fx.root);
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("AC-STE-433.3 — a `dart` fence with an app-relative asset literal yields zero violations", async () => {
    const fx = makeFixture({
      technicalSpec: [
        "# Technical Spec",
        "",
        "```dart",
        "const kLogo = 'assets/images/logo.png';",
        "```",
        "",
      ].join("\n"),
    });
    try {
      const r = await runCrossCuttingSpecStaleFileRefsProbe(fx.root);
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("AC-STE-433.4 — an `sh` fence with two path arguments yields zero violations", async () => {
    const fx = makeFixture({
      testingSpec: [
        "# Testing Spec",
        "",
        "```sh",
        "cp build/output/app.js dist/bundle/app.js",
        "```",
        "",
      ].join("\n"),
    });
    try {
      const r = await runCrossCuttingSpecStaleFileRefsProbe(fx.root);
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("AC-STE-433.5 — a bare fence whose leaf does not resolve still yields exactly one warning", async () => {
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
      expect(r.violations[0]!.severity).toBe("warning");
      expect(r.violations[0]!.note).toContain("src/removed/gone-widget.ts");
    } finally {
      fx.cleanup();
    }
  });

  test("AC-STE-433.6 — a `text`-tagged fence behaves identically to a bare fence", async () => {
    const fx = makeFixture({
      technicalSpec: [
        "# Technical Spec",
        "",
        "```text",
        "src/",
        "└── src/removed/text-tagged.ts",
        "```",
        "",
      ].join("\n"),
    });
    try {
      const r = await runCrossCuttingSpecStaleFileRefsProbe(fx.root);
      expect(r.violations).toHaveLength(1);
      expect(r.violations[0]!.severity).toBe("warning");
      expect(r.violations[0]!.note).toContain("src/removed/text-tagged.ts");
    } finally {
      fx.cleanup();
    }
  });

  test("AC-STE-433.6 — a `tree`-tagged fence behaves identically to a bare fence", async () => {
    const fx = makeFixture({
      technicalSpec: [
        "# Technical Spec",
        "",
        "```tree",
        "src/",
        "└── src/removed/tree-tagged.ts",
        "```",
        "",
      ].join("\n"),
    });
    try {
      const r = await runCrossCuttingSpecStaleFileRefsProbe(fx.root);
      expect(r.violations).toHaveLength(1);
      expect(r.violations[0]!.severity).toBe("warning");
      expect(r.violations[0]!.note).toContain("src/removed/tree-tagged.ts");
    } finally {
      fx.cleanup();
    }
  });

  test("AC-STE-433.6 — a CRLF file's info string is normalized before the accept-list check", async () => {
    const fx = makeFixture({
      technicalSpec: [
        "# Technical Spec",
        "",
        "```text",
        "src/",
        "└── src/removed/crlf-leaf.ts",
        "```",
        "",
      ].join("\r\n"),
    });
    try {
      const r = await runCrossCuttingSpecStaleFileRefsProbe(fx.root);
      expect(r.violations).toHaveLength(1);
      expect(r.violations[0]!.note).toContain("src/removed/crlf-leaf.ts");
    } finally {
      fx.cleanup();
    }
  });

  test("AC-STE-433.6 — whitespace around the info string is normalized", async () => {
    const fx = makeFixture({
      technicalSpec: [
        "# Technical Spec",
        "",
        "```  tree  ",
        "src/",
        "└── src/removed/padded-info.ts",
        "```",
        "",
      ].join("\n"),
    });
    try {
      const r = await runCrossCuttingSpecStaleFileRefsProbe(fx.root);
      expect(r.violations).toHaveLength(1);
      expect(r.violations[0]!.note).toContain("src/removed/padded-info.ts");
    } finally {
      fx.cleanup();
    }
  });

  // LOAD-BEARING. A line-filtering implementation (skip tagged fence lines
  // instead of tracking the open fence) desynchronizes the toggle: the `dart`
  // fence's CLOSING marker is then read as an OPENING one, so the prose below
  // it lands inside the fence and the real tree fence falls outside one.
  //
  // RE-EXPRESSED BY STE-480, intent intact. Now that prose is in scope, the
  // desync no longer changes the violation COUNT — both lines fire either way
  // — so a count assertion alone would have gone blind to it. What the desync
  // does change is which KIND each line is tagged with: under a desynchronized
  // toggle the prose line reads as `treeLeaf` and the tree leaf as
  // `proseMention`, exactly swapped. Asserting one of each AND which path
  // carries which kind is what keeps this test's teeth.
  test("AC-STE-433.7 — a tagged fence still closes: dart fence + prose + bare tree ⇒ one treeLeaf + one proseMention", async () => {
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
      expect(r.violations).toHaveLength(2);
      const tree = r.violations.filter((v) => v.kind === "treeLeaf");
      const prose = r.violations.filter((v) => v.kind === "proseMention");
      // The bare-fence leaf is a tree leaf...
      expect(tree).toHaveLength(1);
      expect(tree[0]!.note).toContain("lib/widgets/ghost_button.dart");
      // ...the sentence between the fences is prose, not a leaf leaked in by a
      // desynchronized fence toggle...
      expect(prose).toHaveLength(1);
      expect(prose[0]!.note).toContain("lib/legacy/removed_helper.dart");
      // ...and the dart import is scanned under neither kind.
      expect(
        r.violations.filter((v) => v.note.includes("my_app/models/user.dart")),
      ).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("AC-STE-433.8 — the probe returns zero violations on this repo's root", async () => {
    const r = await runCrossCuttingSpecStaleFileRefsProbe(repoRoot);
    expect(r.violations.map((v) => v.note)).toEqual([]);
  });

  test("AC-STE-433.9 — /gate-check entry #37 names the accept-list and the out-of-scope rule", () => {
    const entry = readGateCheckEntry37();
    expect(entry).not.toBe("");
    for (const needle of ["`text`", "`tree`", "language-tagged", "out of scope"]) {
      expect(entry).toContain(needle);
    }
    expect(entry.toLowerCase()).toContain("bare");
  });

  test("AC-STE-433.9 — the probe module header names the accept-list and the out-of-scope rule", () => {
    const header = readProbeModuleHeader();
    expect(header).not.toBe("");
    for (const needle of [
      "TREE_FENCE_INFO_ACCEPT_LIST",
      "`text`",
      "`tree`",
      "language-tagged",
      "out of scope",
    ]) {
      expect(header).toContain(needle);
    }
    expect(header.toLowerCase()).toContain("bare");
  });
});
