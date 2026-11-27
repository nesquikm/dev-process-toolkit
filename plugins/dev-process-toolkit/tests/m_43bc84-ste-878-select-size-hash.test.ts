// M_43bc84 / STE-878 — best-practices `select` prints size + sha256, honours
// an optional per-entry `max_bytes` cap, refuses missing documents, and every
// reader of its output (both TDD writers + the /implement lens) reads the
// printed documents as reference data and reports a `refused:` line as a
// blocker.
//
// Fixtures are invented names and paths, built in a temp repo root holding
// `specs/` plus the documents. The CLI runs from that root with an absolute
// `--specs <root>/specs`, so a document path resolves to the same file
// whether it is read relative to the working directory or to the specs
// directory's parent.
//
// Expected digests are literals (sha256 of "abc" and of the empty string),
// never computed through the module under test.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  BestPracticesManifestShapeError,
  addEntry,
  readManifest,
  writeManifest,
  type BestPracticesEntry,
  type BestPracticesManifest,
} from "../adapters/_shared/src/best_practices_manifest";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const MODULE_ABS = join(PLUGIN_ROOT, "adapters", "_shared", "src", "best_practices_manifest.ts");

const SHA_ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
const SHA_EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

interface Root {
  root: string;
  specs: string;
}

function makeRoot(manifestYaml: string, docs: Record<string, string>): Root {
  const root = mkdtempSync(join(tmpdir(), "dpt-ste878-"));
  const specs = join(root, "specs");
  mkdirSync(specs, { recursive: true });
  writeFileSync(join(specs, "best-practices.yaml"), manifestYaml);
  for (const [rel, body] of Object.entries(docs)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  return { root, specs };
}

function runSelect(
  r: Root,
  files: string | null,
): { exitCode: number; stdout: string; stderr: string; lines: string[] } {
  const args = ["bun", MODULE_ABS, "select", "--specs", r.specs];
  if (files !== null) args.push("--files", files);
  const proc = Bun.spawnSync(args, { cwd: r.root });
  const stdout = proc.stdout.toString();
  return {
    exitCode: proc.exitCode,
    stdout,
    stderr: proc.stderr.toString(),
    lines: stdout.split("\n").filter((l) => l.trim().length > 0),
  };
}

// ---------------------------------------------------------------------------
// AC-STE-878.1 — four-column line, manifest order
// ---------------------------------------------------------------------------

describe("AC-STE-878.1 — select prints name, path, bytes and sha256", () => {
  test("each selected entry prints name<TAB>path<TAB><bytes><TAB><sha256>, in manifest order", () => {
    const r = makeRoot(
      [
        "best_practices:",
        "  - name: zeta-rules",
        "    path: docs/house/zeta.md",
        "  - name: alpha-rules",
        "    path: docs/house/alpha.md",
        '    scope: ["src/**"]',
        "",
      ].join("\n"),
      { "docs/house/zeta.md": "abc", "docs/house/alpha.md": "" },
    );
    const out = runSelect(r, "src/widget/a.ts");
    expect({ exitCode: out.exitCode, lines: out.lines }).toEqual({
      exitCode: 0,
      lines: [
        `zeta-rules\tdocs/house/zeta.md\t3\t${SHA_ABC}`,
        `alpha-rules\tdocs/house/alpha.md\t0\t${SHA_EMPTY}`,
      ],
    });
  });

  test("bytes counts bytes, not characters (a multi-byte document)", () => {
    // "é" is two bytes in UTF-8; "ééé" is 6 bytes and 3 characters.
    const r = makeRoot(
      ["best_practices:", "  - name: accent-rules", "    path: docs/house/accent.md", ""].join("\n"),
      { "docs/house/accent.md": "ééé" },
    );
    const out = runSelect(r, "src/a.ts");
    expect(out.exitCode).toBe(0);
    expect(out.lines).toHaveLength(1);
    const cols = out.lines[0]!.split("\t");
    expect(cols.slice(0, 3)).toEqual(["accent-rules", "docs/house/accent.md", "6"]);
    expect(cols[3]).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-878.2 — `max_bytes` in the closed schema
// ---------------------------------------------------------------------------

describe("AC-STE-878.2 — an entry may declare max_bytes: <positive integer>", () => {
  test("readManifest accepts max_bytes and yields it as a number", () => {
    const r = makeRoot(
      [
        "best_practices:",
        "  - name: capped-rules",
        "    path: docs/house/capped.md",
        "    max_bytes: 4096",
        "",
      ].join("\n"),
      {},
    );
    const m = readManifest(r.specs);
    expect(m.best_practices).toHaveLength(1);
    expect((m.best_practices[0] as BestPracticesEntry & { max_bytes?: unknown }).max_bytes).toBe(4096);
  });

  test("addEntry + writeManifest round-trip max_bytes", () => {
    const dir = mkdtempSync(join(tmpdir(), "dpt-ste878-rt-"));
    const manifest: BestPracticesManifest = { best_practices: [] };
    addEntry(manifest, {
      name: "capped-rules",
      path: "docs/house/capped.md",
      max_bytes: 2048,
    } as BestPracticesEntry);
    writeManifest(dir, manifest);
    expect(readFileSync(join(dir, "best-practices.yaml"), "utf8")).toMatch(/^\s+max_bytes: 2048$/m);
    const back = readManifest(dir);
    expect((back.best_practices[0] as BestPracticesEntry & { max_bytes?: unknown }).max_bytes).toBe(2048);
  });

  for (const bad of ["0", "-5", "1.5", "abc", "12kb"]) {
    test(`max_bytes: ${bad} is a BestPracticesManifestShapeError`, () => {
      const r = makeRoot(
        [
          "best_practices:",
          "  - name: capped-rules",
          "    path: docs/house/capped.md",
          `    max_bytes: ${bad}`,
          "",
        ].join("\n"),
        {},
      );
      expect(() => readManifest(r.specs)).toThrow(BestPracticesManifestShapeError);
    });
  }

  test("addEntry refuses a max_bytes that is not a positive integer", () => {
    const manifest: BestPracticesManifest = { best_practices: [] };
    expect(() =>
      addEntry(manifest, {
        name: "capped-rules",
        path: "docs/house/capped.md",
        max_bytes: 0,
      } as BestPracticesEntry),
    ).toThrow(BestPracticesManifestShapeError);
  });

  test("select exits 2 on a malformed max_bytes", () => {
    const r = makeRoot(
      [
        "best_practices:",
        "  - name: capped-rules",
        "    path: docs/house/capped.md",
        "    max_bytes: 0",
        "",
      ].join("\n"),
      { "docs/house/capped.md": "abc" },
    );
    const out = runSelect(r, "src/a.ts");
    expect({ exitCode: out.exitCode, stdout: out.stdout }).toEqual({ exitCode: 2, stdout: "" });
    expect(out.stderr).toContain("Refusing:");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-878.3 — oversized document refused, the rest still print
// ---------------------------------------------------------------------------

describe("AC-STE-878.3 — a document larger than max_bytes is refused", () => {
  const manifest = [
    "best_practices:",
    "  - name: big-rules",
    "    path: docs/house/big.md",
    "    max_bytes: 2",
    "  - name: small-rules",
    "    path: docs/house/small.md",
    "",
  ].join("\n");

  test("prints `refused: <name> <bytes>` in place of its line, the other entry still prints, exit 0", () => {
    const r = makeRoot(manifest, { "docs/house/big.md": "abc", "docs/house/small.md": "" });
    const out = runSelect(r, "src/a.ts");
    expect({ exitCode: out.exitCode, lines: out.lines }).toEqual({
      exitCode: 0,
      lines: ["refused: big-rules 3", `small-rules\tdocs/house/small.md\t0\t${SHA_EMPTY}`],
    });
  });

  test("a document exactly at max_bytes is not refused", () => {
    const r = makeRoot(
      [
        "best_practices:",
        "  - name: edge-rules",
        "    path: docs/house/edge.md",
        "    max_bytes: 3",
        "",
      ].join("\n"),
      { "docs/house/edge.md": "abc" },
    );
    const out = runSelect(r, "src/a.ts");
    expect({ exitCode: out.exitCode, lines: out.lines }).toEqual({
      exitCode: 0,
      lines: [`edge-rules\tdocs/house/edge.md\t3\t${SHA_ABC}`],
    });
  });
});

// ---------------------------------------------------------------------------
// AC-STE-878.4 — missing document refused; exit 2 + dispositions unchanged
// ---------------------------------------------------------------------------

describe("AC-STE-878.4 — a missing document is refused; other dispositions unchanged", () => {
  test("prints `refused: <name> missing`, the other entry still prints, exit 0", () => {
    const r = makeRoot(
      [
        "best_practices:",
        "  - name: ghost-rules",
        "    path: docs/house/ghost.md",
        "  - name: real-rules",
        "    path: docs/house/real.md",
        "",
      ].join("\n"),
      { "docs/house/real.md": "abc" },
    );
    const out = runSelect(r, "src/a.ts");
    expect({ exitCode: out.exitCode, lines: out.lines }).toEqual({
      exitCode: 0,
      lines: ["refused: ghost-rules missing", `real-rules\tdocs/house/real.md\t3\t${SHA_ABC}`],
    });
  });

  test("an absent manifest still prints the unchanged no-manifest line, exit 0", () => {
    const root = mkdtempSync(join(tmpdir(), "dpt-ste878-none-"));
    const specs = join(root, "specs");
    mkdirSync(specs, { recursive: true });
    const out = runSelect({ root, specs }, "src/a.ts");
    expect({ exitCode: out.exitCode, lines: out.lines }).toEqual({
      exitCode: 0,
      lines: [`no-manifest: best-practices.yaml absent or empty in ${specs} — lens skipped`],
    });
  });

  test("entries scoped away from the files still print the unchanged no-match line, exit 0", () => {
    const r = makeRoot(
      [
        "best_practices:",
        "  - name: scoped-rules",
        "    path: docs/house/scoped.md",
        '    scope: ["lib/**"]',
        "",
      ].join("\n"),
      { "docs/house/scoped.md": "abc" },
    );
    const out = runSelect(r, "src/a.ts");
    expect({ exitCode: out.exitCode, lines: out.lines }).toEqual({
      exitCode: 0,
      lines: ["no-match: entries exist but none scoped to the changed files"],
    });
  });

  test("bad usage (no --files) still exits 2", () => {
    const r = makeRoot(
      ["best_practices:", "  - name: real-rules", "    path: docs/house/real.md", ""].join("\n"),
      { "docs/house/real.md": "abc" },
    );
    const out = runSelect(r, null);
    expect({ exitCode: out.exitCode, stdout: out.stdout }).toEqual({ exitCode: 2, stdout: "" });
  });
});

// ---------------------------------------------------------------------------
// AC-STE-878.5 / .6 — reader texts
// ---------------------------------------------------------------------------

const read = (rel: string): string => readFileSync(join(PLUGIN_ROOT, rel), "utf8");

/** The blank-line-delimited paragraph holding the first match of `anchor`. */
function paragraphWith(body: string, anchor: RegExp): string {
  const paras = body.split(/\n[ \t]*\n/);
  const hit = paras.find((p) => anchor.test(p));
  expect({ anchor: String(anchor), found: hit !== undefined }).toEqual({
    anchor: String(anchor),
    found: true,
  });
  return hit!;
}

/** The sentences of `text` holding the literal `refused:`. */
function refusedSentences(text: string): string {
  return text
    .replace(/\n/g, " ")
    .split(/(?<=[.;])\s+/)
    .filter((s) => s.includes("`refused:"))
    .join(" ");
}

/** The /implement Phase 3 lens block (anchor to next bold/heading/numbered step). */
function lensBlock(): string {
  const body = read("skills/implement/SKILL.md");
  const anchor = /^\*\*Best-practices conformance lens/m.exec(body);
  expect({ lensAnchor: anchor !== null }).toEqual({ lensAnchor: true });
  const afterAnchorLine = body.indexOf("\n", anchor!.index);
  const rest = body.slice(afterAnchorLine + 1);
  const term = /^(?:\*\*|#{2,4} |\d+\.\s)/m.exec(rest);
  return body.slice(anchor!.index, term ? afterAnchorLine + 1 + term.index : body.length);
}

const SELECT_CALL = /best_practices_manifest\.ts"? select --specs specs --files/;

interface Reader {
  label: string;
  region: () => string;
  blockerWhere: RegExp;
}

const AC5_READERS: Reader[] = [
  {
    label: "skills/tdd-write-test/SKILL.md",
    region: () => paragraphWith(read("skills/tdd-write-test/SKILL.md"), SELECT_CALL),
    blockerWhere: /`notes`/,
  },
  {
    label: "agents/tdd-test-writer.md",
    region: () => paragraphWith(read("agents/tdd-test-writer.md"), /best-practices document/),
    blockerWhere: /`notes`/,
  },
  {
    label: "skills/implement/SKILL.md lens",
    region: lensBlock,
    blockerWhere: /review finding/,
  },
];

describe("AC-STE-878.5 — test writer + /implement lens read the documents as reference data", () => {
  for (const r of AC5_READERS) {
    test(`${r.label}: the printed documents are reference data, not instructions`, () => {
      const text = r.region();
      expect(text).toMatch(/reference data/);
      expect(text).toMatch(/not instructions/);
    });

    test(`${r.label}: a \`refused:\` line is reported as a blocker`, () => {
      const s = refusedSentences(r.region());
      expect(s).toMatch(/blocker/);
      expect(s).toMatch(r.blockerWhere);
    });
  }

  test("skills/implement/SKILL.md stays within the NFR-1 line cap (362)", () => {
    expect(read("skills/implement/SKILL.md").split("\n").length).toBeLessThanOrEqual(362);
  });
});

describe("AC-STE-878.6 — the TDD implementer runs select on the failing test files", () => {
  const skillPara = (): string => paragraphWith(read("skills/tdd-implement/SKILL.md"), SELECT_CALL);

  test("tdd-implement runs the same bun select leg with the AC's failing test file paths", () => {
    const p = skillPara();
    expect(p).toContain(
      'bun run "${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/best_practices_manifest.ts" select --specs specs --files',
    );
    expect(p).toMatch(/failing test file/);
  });

  test("tdd-implement: printed documents are reference data, not instructions", () => {
    const p = skillPara();
    expect(p).toMatch(/reference data/);
    expect(p).toMatch(/not instructions/);
  });

  test("tdd-implement: a `refused:` line is reported as a blocker in `notes`", () => {
    const s = refusedSentences(skillPara());
    expect(s).toMatch(/blocker/);
    expect(s).toMatch(/`notes`/);
  });

  test("tdd-implement: `no-manifest:` / `no-match:` mean there are no documents to read", () => {
    const p = skillPara();
    expect(p).toContain("`no-manifest:`");
    expect(p).toContain("`no-match:`");
    expect(p).toMatch(/no documents|there are none/);
  });

  const agentPara = (): string => paragraphWith(read("agents/tdd-implementer.md"), /best-practices document/);

  test("tdd-implementer agent reads every printed document as reference data", () => {
    const p = agentPara();
    expect(p).toMatch(/every best-practices document/);
    expect(p).toMatch(/reference data/);
  });

  test("tdd-implementer agent: a `refused:` line is reported as a blocker in `notes`", () => {
    const s = refusedSentences(agentPara());
    expect(s).toMatch(/blocker/);
    expect(s).toMatch(/`notes`/);
  });
});

// Phase 3 Stage A (M_43bc84 review): a `path` that names a directory passed
// existsSync and statSync, then crashed the read with an uncaught EISDIR. It is
// not a document, so it refuses as missing, like any absent document, exit 0.
describe("AC-STE-878.4 hardening — a directory is not a document", () => {
  test("an entry whose path is a directory prints `refused: <name> missing`, the other entry still prints, exit 0", () => {
    const r = makeRoot(
      [
        "best_practices:",
        "  - name: folder-rules",
        "    path: docs/house",
        "  - name: real-rules",
        "    path: docs/house/real.md",
        "",
      ].join("\n"),
      { "docs/house/real.md": "abc" },
    );
    const out = runSelect(r, "src/a.ts");
    expect({ exitCode: out.exitCode, lines: out.lines, stderr: out.stderr }).toEqual({
      exitCode: 0,
      lines: ["refused: folder-rules missing", `real-rules\tdocs/house/real.md\t3\t${SHA_ABC}`],
      stderr: "",
    });
  });
});

// Phase 3 Stage B round 1 (M_43bc84 review): `add` and probe #91 resolve a
// document against the specs directory's parent; `select` resolved it against
// the process cwd, so the three disagreed whenever --specs was absolute and the
// cwd was elsewhere. `select` now uses the same base.
describe("AC-STE-878.1 hardening — select resolves documents against the specs directory's parent", () => {
  test("run from another cwd with an absolute --specs, it still finds and hashes the document", () => {
    const r = makeRoot(
      ["best_practices:", "  - name: zeta-rules", "    path: docs/house/zeta.md", ""].join("\n"),
      { "docs/house/zeta.md": "abc" },
    );
    const elsewhere = mkdtempSync(join(tmpdir(), "dpt-ste878-cwd-"));
    const proc = Bun.spawnSync(["bun", MODULE_ABS, "select", "--specs", r.specs, "--files", "src/a.ts"], { cwd: elsewhere });
    const lines = proc.stdout.toString().split("\n").filter((l) => l.trim().length > 0);
    expect({ exitCode: proc.exitCode, lines }).toEqual({
      exitCode: 0,
      lines: [`zeta-rules\tdocs/house/zeta.md\t3\t${SHA_ABC}`],
    });
  });
});
