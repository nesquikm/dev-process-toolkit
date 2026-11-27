// M_43bc84 / STE-879 — best-practices CLI `add` / `remove` legs, the optional
// per-entry `sha256` key, the digest-match /gate-check probe (#91), and
// `select` refusing a document whose digest no longer matches.
//
// Fixtures are invented names and paths, built in a temp repo root holding
// `specs/` plus the documents. The CLI runs from that root with an absolute
// `--specs <root>/specs`, so a document path resolves to the same file whether
// it is read relative to the working directory or to the specs directory's
// parent (the STE-878 suite's convention).
//
// Expected digests are literals (sha256 of "abc" and of the empty string),
// never computed through the module under test. Every refusal compares the
// manifest bytes before and after.
//
// The probe module is loaded with a dynamic import so the CLI and schema legs
// still run while it does not exist yet. Its name is fixed here:
//   adapters/_shared/src/best_practices_digest_match.ts
//   export async function runBestPracticesDigestMatchProbe(projectRoot)
//     => Promise<{ violations: Violation[]; notes: string[] }>
//   probe id `best_practices_digest_match`, row 91, Severity: error.

import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  BestPracticesManifestShapeError,
  KNOWN_KEYS,
  addEntry,
  readManifest,
  writeManifest,
  type BestPracticesEntry,
  type BestPracticesManifest,
} from "../adapters/_shared/src/best_practices_manifest";
import { GATE_PROBES } from "../adapters/_shared/src/gate_probe_runner";
import { runModuleReachabilityProbe } from "../adapters/_shared/src/module_reachability";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO = join(PLUGIN_ROOT, "..", "..");
const MODULE_ABS = join(PLUGIN_ROOT, "adapters", "_shared", "src", "best_practices_manifest.ts");
const PROBE_MODULE_REL = "adapters/_shared/src/best_practices_digest_match.ts";
const PROBE_MODULE_ABS = join(PLUGIN_ROOT, ...PROBE_MODULE_REL.split("/"));
const PROBE_ID = "best_practices_digest_match";
const PROBE_FN = "runBestPracticesDigestMatchProbe";
const GATE_CHECK_REL = "plugins/dev-process-toolkit/skills/gate-check/SKILL.md";
const GATE_CHECK_ABS = join(REPO, ...GATE_CHECK_REL.split("/"));
const BP_SKILL_ABS = join(PLUGIN_ROOT, "skills", "best-practices", "SKILL.md");

const SHA_ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
const SHA_EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const T = 120_000;

interface Root {
  root: string;
  specs: string;
  manifest: string;
}

function makeRoot(manifestYaml: string | null, docs: Record<string, string>): Root {
  const root = mkdtempSync(join(tmpdir(), "dpt-ste879-"));
  const specs = join(root, "specs");
  mkdirSync(specs, { recursive: true });
  const manifest = join(specs, "best-practices.yaml");
  if (manifestYaml !== null) writeFileSync(manifest, manifestYaml);
  for (const [rel, body] of Object.entries(docs)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  return { root, specs, manifest };
}

interface Run {
  exitCode: number;
  stdout: string;
  stderr: string;
  lines: string[];
}

function runCli(r: Root, command: string, args: string[]): Run {
  const proc = Bun.spawnSync(["bun", MODULE_ABS, command, "--specs", r.specs, ...args], { cwd: r.root });
  const stdout = proc.stdout.toString();
  return {
    exitCode: proc.exitCode,
    stdout,
    stderr: proc.stderr.toString(),
    lines: stdout.split("\n").filter((l) => l.trim().length > 0),
  };
}

const bytes = (path: string): Buffer => readFileSync(path);

/** The NFR-10 canonical refusal: all three lines, in order, somewhere in the output. */
function expectNfr10Refusal(run: Run): void {
  const out = `${run.stdout}\n${run.stderr}`;
  expect(out).toMatch(/^Refusing: .+\nRemedy: .+\nContext: .+$/m);
}

const ONE_ENTRY = ["best_practices:", "  - name: kettle-rules", "    path: docs/house/kettle.md", ""].join("\n");

// ---------------------------------------------------------------------------
// AC-STE-879.1 — `add` leg
// ---------------------------------------------------------------------------

describe("AC-STE-879.1 — `add` appends through addEntry + writeManifest", () => {
  test("add with every optional flag exits 0 and appends the entry after the existing one", () => {
    const r = makeRoot(ONE_ENTRY, { "docs/house/kettle.md": "", "docs/house/teapot.md": "abc" });
    const run = runCli(r, "add", [
      "--name", "teapot-rules",
      "--path", "docs/house/teapot.md",
      "--scope", "src/**/*.ts",
      "--topics", "errors,logging",
      "--notes", "house rules for brewing",
      "--max-bytes", "4096",
      "--sha256", SHA_ABC,
    ]);
    expect({ exitCode: run.exitCode, stderr: run.stderr }).toEqual({ exitCode: 0, stderr: "" });
    expect(readManifest(r.specs)).toEqual({
      best_practices: [
        { name: "kettle-rules", path: "docs/house/kettle.md" },
        {
          name: "teapot-rules",
          path: "docs/house/teapot.md",
          scope: ["src/**/*.ts"],
          topics: ["errors", "logging"],
          notes: "house rules for brewing",
          max_bytes: 4096,
          sha256: SHA_ABC,
        },
      ],
    });
  });

  test("add with only --name and --path writes an entry carrying no optional key", () => {
    const r = makeRoot(ONE_ENTRY, { "docs/house/kettle.md": "", "docs/house/mug.md": "x" });
    const run = runCli(r, "add", ["--name", "mug-rules", "--path", "docs/house/mug.md"]);
    expect(run.exitCode).toBe(0);
    expect(readManifest(r.specs).best_practices[1]).toEqual({ name: "mug-rules", path: "docs/house/mug.md" });
  });

  test("a duplicate name prints the NFR-10 refusal, exits 2, manifest byte-identical", () => {
    const r = makeRoot(ONE_ENTRY, { "docs/house/kettle.md": "", "docs/house/other.md": "x" });
    const before = bytes(r.manifest);
    const run = runCli(r, "add", ["--name", "kettle-rules", "--path", "docs/house/other.md"]);
    expect(run.exitCode).toBe(2);
    expectNfr10Refusal(run);
    expect(`${run.stdout}${run.stderr}`).toContain("kettle-rules");
    expect(bytes(r.manifest).equals(before)).toBe(true);
  });

  test("a missing document prints the NFR-10 refusal, exits 2, manifest byte-identical", () => {
    const r = makeRoot(ONE_ENTRY, { "docs/house/kettle.md": "" });
    const before = bytes(r.manifest);
    const run = runCli(r, "add", ["--name", "ghost-rules", "--path", "docs/house/ghost.md"]);
    expect(run.exitCode).toBe(2);
    expectNfr10Refusal(run);
    expect(`${run.stdout}${run.stderr}`).toContain("docs/house/ghost.md");
    expect(bytes(r.manifest).equals(before)).toBe(true);
  });

  const shapeErrors: [string, string[]][] = [
    ["an uppercase --sha256", ["--name", "n1", "--path", "docs/house/mug.md", "--sha256", SHA_ABC.toUpperCase()]],
    ["a 63-character --sha256", ["--name", "n2", "--path", "docs/house/mug.md", "--sha256", SHA_ABC.slice(1)]],
    ["a zero --max-bytes", ["--name", "n3", "--path", "docs/house/mug.md", "--max-bytes", "0"]],
    ["a non-numeric --max-bytes", ["--name", "n4", "--path", "docs/house/mug.md", "--max-bytes", "lots"]],
    ["an absolute --path to an existing document", ["--name", "n5", "--path", "<ROOT>/docs/house/mug.md"]],
    ["a traversing --path", ["--name", "n6", "--path", "docs/../docs/house/mug.md"]],
    ["a missing --name", ["--path", "docs/house/mug.md"]],
  ];
  for (const [label, args] of shapeErrors) {
    test(`shape error (${label}) prints the NFR-10 refusal, exits 2, manifest byte-identical`, () => {
      const r = makeRoot(ONE_ENTRY, { "docs/house/kettle.md": "", "docs/house/mug.md": "abc" });
      const before = bytes(r.manifest);
      const run = runCli(r, "add", args.map((a) => a.replace("<ROOT>", r.root)));
      expect(run.exitCode).toBe(2);
      expectNfr10Refusal(run);
      expect(bytes(r.manifest).equals(before)).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// AC-STE-879.2 — `remove` leg
// ---------------------------------------------------------------------------

describe("AC-STE-879.2 — `remove` removes through removeEntry", () => {
  const TWO = [
    "best_practices:",
    "  - name: kettle-rules",
    "    path: docs/house/kettle.md",
    "  - name: teapot-rules",
    "    path: docs/house/teapot.md",
    "    topics: [brewing]",
    "",
  ].join("\n");

  test("remove of a present name exits 0 and leaves only the other entry", () => {
    const r = makeRoot(TWO, { "docs/house/kettle.md": "", "docs/house/teapot.md": "" });
    const run = runCli(r, "remove", ["--name", "kettle-rules"]);
    expect({ exitCode: run.exitCode, stderr: run.stderr }).toEqual({ exitCode: 0, stderr: "" });
    expect(readManifest(r.specs)).toEqual({
      best_practices: [{ name: "teapot-rules", path: "docs/house/teapot.md", topics: ["brewing"] }],
    });
  });

  test("remove of an unknown name prints the NFR-10 refusal, exits 2, manifest byte-identical", () => {
    const r = makeRoot(TWO, { "docs/house/kettle.md": "", "docs/house/teapot.md": "" });
    const before = bytes(r.manifest);
    const run = runCli(r, "remove", ["--name", "saucer-rules"]);
    expect(run.exitCode).toBe(2);
    expectNfr10Refusal(run);
    expect(`${run.stdout}${run.stderr}`).toContain("saucer-rules");
    expect(bytes(r.manifest).equals(before)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-879.3 — optional `sha256` key
// ---------------------------------------------------------------------------

describe("AC-STE-879.3 — entries may declare sha256: <64 lowercase hex>", () => {
  test("the closed schema lists sha256 among the known keys", () => {
    expect(KNOWN_KEYS).toContain("sha256");
  });

  test("readManifest accepts a declared sha256 and returns it on the entry", () => {
    const r = makeRoot(
      ["best_practices:", "  - name: kettle-rules", "    path: docs/house/kettle.md", `    sha256: ${SHA_ABC}`, ""].join("\n"),
      { "docs/house/kettle.md": "abc" },
    );
    expect(readManifest(r.specs).best_practices[0]).toEqual({
      name: "kettle-rules",
      path: "docs/house/kettle.md",
      sha256: SHA_ABC,
    });
  });

  test("addEntry + writeManifest round-trip a declared sha256 through readManifest", () => {
    const r = makeRoot(null, {});
    const entry: BestPracticesEntry = { name: "kettle-rules", path: "docs/house/kettle.md", max_bytes: 10, sha256: SHA_EMPTY };
    const m: BestPracticesManifest = { best_practices: [] };
    addEntry(m, entry);
    writeManifest(r.specs, m);
    expect(readFileSync(r.manifest, "utf8")).toContain(`    sha256: ${SHA_EMPTY}\n`);
    expect(readManifest(r.specs)).toEqual({ best_practices: [entry] });
  });

  const BAD = [
    ["uppercase hex", SHA_ABC.toUpperCase()],
    ["63 characters", SHA_ABC.slice(1)],
    ["65 characters", `${SHA_ABC}0`],
    ["a non-hex character", `${SHA_ABC.slice(0, 63)}g`],
    ["an empty value", ""],
  ] as const;

  for (const [label, value] of BAD) {
    test(`readManifest refuses sha256 with ${label} as a BestPracticesManifestShapeError`, () => {
      const r = makeRoot(
        ["best_practices:", "  - name: kettle-rules", "    path: docs/house/kettle.md", `    sha256: ${value}`, ""].join("\n"),
        { "docs/house/kettle.md": "abc" },
      );
      expect(() => readManifest(r.specs)).toThrow(BestPracticesManifestShapeError);
    });

    test(`addEntry refuses sha256 with ${label} as a BestPracticesManifestShapeError`, () => {
      const m: BestPracticesManifest = { best_practices: [] };
      expect(() => addEntry(m, { name: "kettle-rules", path: "docs/house/kettle.md", sha256: value })).toThrow(
        BestPracticesManifestShapeError,
      );
      expect(m.best_practices).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// AC-STE-879.4 — the digest-match /gate-check probe (#91)
// ---------------------------------------------------------------------------

interface ProbeReport {
  violations: unknown[];
  notes: string[];
}

async function runProbe(root: string): Promise<ProbeReport> {
  const mod = (await import(PROBE_MODULE_ABS)) as Record<string, (root: string) => Promise<ProbeReport>>;
  const fn = mod[PROBE_FN];
  if (typeof fn !== "function") throw new Error(`${PROBE_MODULE_REL} does not export ${PROBE_FN}`);
  return fn(root);
}

describe("AC-STE-879.4 — probe reports one violation per entry whose declared sha256 differs", () => {
  test("a declared sha256 that matches the document is no violation", async () => {
    const r = makeRoot(
      ["best_practices:", "  - name: kettle-rules", "    path: docs/house/kettle.md", `    sha256: ${SHA_ABC}`, ""].join("\n"),
      { "docs/house/kettle.md": "abc" },
    );
    expect((await runProbe(r.root)).violations).toEqual([]);
  });

  test("a mismatch is one violation naming the entry, the path, the declared and the actual digest", async () => {
    const r = makeRoot(
      ["best_practices:", "  - name: kettle-rules", "    path: docs/house/kettle.md", `    sha256: ${SHA_EMPTY}`, ""].join("\n"),
      { "docs/house/kettle.md": "abc" },
    );
    const report = await runProbe(r.root);
    expect(report.violations.length).toBe(1);
    const text = JSON.stringify(report.violations[0]);
    expect(text).toContain("kettle-rules");
    expect(text).toContain("docs/house/kettle.md");
    expect(text).toContain(SHA_EMPTY);
    expect(text).toContain(SHA_ABC);
  });

  test("one violation per mismatching entry; matching entries and entries without the key add none", async () => {
    const r = makeRoot(
      [
        "best_practices:",
        "  - name: kettle-rules",
        "    path: docs/house/kettle.md",
        `    sha256: ${SHA_EMPTY}`,
        "  - name: teapot-rules",
        "    path: docs/house/teapot.md",
        `    sha256: ${SHA_ABC}`,
        "  - name: mug-rules",
        "    path: docs/house/mug.md",
        "  - name: saucer-rules",
        "    path: docs/house/saucer.md",
        `    sha256: ${SHA_ABC}`,
        "",
      ].join("\n"),
      { "docs/house/kettle.md": "abc", "docs/house/teapot.md": "abc", "docs/house/mug.md": "abc", "docs/house/saucer.md": "" },
    );
    const report = await runProbe(r.root);
    const texts = report.violations.map((v) => JSON.stringify(v));
    expect(texts.length).toBe(2);
    expect(texts.filter((t) => t.includes("kettle-rules")).length).toBe(1);
    expect(texts.filter((t) => t.includes("saucer-rules")).length).toBe(1);
  });

  test("entries without the key are vacuous even when they differ from any digest", async () => {
    const r = makeRoot(ONE_ENTRY, { "docs/house/kettle.md": "abc" });
    expect(await runProbe(r.root)).toEqual({ violations: [], notes: [] });
  });

  test("an absent manifest is vacuous", async () => {
    const r = makeRoot(null, {});
    expect(await runProbe(r.root)).toEqual({ violations: [], notes: [] });
  });

  test("an empty manifest is vacuous", async () => {
    const r = makeRoot("best_practices: []\n", {});
    expect(await runProbe(r.root)).toEqual({ violations: [], notes: [] });
  });
});

describe("AC-STE-879.4 — probe #91 is registered", () => {
  const rows = (): string[] => readFileSync(GATE_CHECK_ABS, "utf8").split("\n").filter((l) => /^\d+\. \*\*/.test(l));

  test("gate-check SKILL.md row 91 names the probe, its call, its module and error severity", () => {
    const row = rows().find((l) => l.startsWith("91. ")) ?? "";
    expect(row.startsWith(`91. **\`${PROBE_ID}\`**`)).toBe(true);
    expect(row).toContain(`\`${PROBE_FN}(projectRoot)\``);
    expect(row).toContain(PROBE_MODULE_REL);
    expect(row).toMatch(/\*\*Severity: error\.?\*\*/);
  });

  test("the runner registers probe 91 with the probe id and error severity, after row 90", () => {
    const entry = GATE_PROBES.find((p) => p.n === 91);
    expect(entry?.id).toBe(PROBE_ID);
    expect(entry?.severity).toBe("error");
    expect(GATE_PROBES.map((p) => p.n).slice(-2)).toEqual([90, 91]);
  });

  test(
    "probe #81 classifies the row-91 reference as ordered and reachable, and stays ok",
    async () => {
      const report = await runModuleReachabilityProbe(REPO);
      const lineNo = readFileSync(GATE_CHECK_ABS, "utf8").split("\n").findIndex((l) => l.startsWith("91. ")) + 1;
      const recs = report.records.filter(
        (rec) => rec.surface === GATE_CHECK_REL && rec.line === lineNo && rec.module.includes("best_practices_digest_match.ts"),
      );
      expect(recs.length).toBeGreaterThan(0);
      for (const rec of recs) expect({ refClass: rec.refClass, reachable: rec.reachable }).toEqual({ refClass: "ordered", reachable: true });
      expect(report.ok).toBe(true);
    },
    T,
  );
});

// ---------------------------------------------------------------------------
// AC-STE-879.5 — select refuses a document whose digest no longer matches
// ---------------------------------------------------------------------------

describe("AC-STE-879.5 — select prints `refused: <name> sha256 <actual>` for a digest mismatch", () => {
  test("the mismatching entry's line is replaced; the matching and keyless entries still print", () => {
    const r = makeRoot(
      [
        "best_practices:",
        "  - name: kettle-rules",
        "    path: docs/house/kettle.md",
        `    sha256: ${SHA_ABC}`,
        "  - name: teapot-rules",
        "    path: docs/house/teapot.md",
        `    sha256: ${SHA_EMPTY}`,
        "  - name: mug-rules",
        "    path: docs/house/mug.md",
        "",
      ].join("\n"),
      { "docs/house/kettle.md": "abc", "docs/house/teapot.md": "abc", "docs/house/mug.md": "" },
    );
    const run = runCli(r, "select", ["--files", "src/a.ts"]);
    expect(run.exitCode).toBe(0);
    expect(run.lines).toEqual([
      `kettle-rules\tdocs/house/kettle.md\t3\t${SHA_ABC}`,
      `refused: teapot-rules sha256 ${SHA_ABC}`,
      `mug-rules\tdocs/house/mug.md\t0\t${SHA_EMPTY}`,
    ]);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-879.6 — the /best-practices skill text
// ---------------------------------------------------------------------------

function skillSection(heading: string): string {
  const lines = readFileSync(BP_SKILL_ABS, "utf8").split("\n");
  const start = lines.indexOf(heading);
  if (start < 0) throw new Error(`no ${heading} heading in skills/best-practices/SKILL.md`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i]!.startsWith("## ")) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

describe("AC-STE-879.6 — /best-practices add and edit accept max_bytes and sha256; CLI legs named", () => {
  test("the add leg accepts max_bytes", () => {
    expect(skillSection("## add")).toContain("max_bytes");
  });

  test("the add leg accepts sha256", () => {
    expect(skillSection("## add")).toContain("sha256");
  });

  test("the edit leg's editable fields include max_bytes", () => {
    expect(skillSection("## edit")).toContain("max_bytes");
  });

  test("the edit leg's editable fields include sha256", () => {
    expect(skillSection("## edit")).toContain("sha256");
  });

  test("the skill names the CLI add and remove legs as the way for other tools to write the manifest", () => {
    const body = readFileSync(BP_SKILL_ABS, "utf8");
    expect(body).toMatch(/best_practices_manifest\.ts"?\s+add\b/);
    expect(body).toMatch(/best_practices_manifest\.ts"?\s+remove\b/);
    expect(body).toMatch(/other tools/i);
  });
});

// Phase 3 Stage A (M_43bc84 review): a declared sha256 on a directory path
// crashed the probe with EISDIR. Probe #76 owns the existence of documents; this
// probe grades digests of regular files only, so a directory is skipped.
describe("AC-STE-879.4 hardening — the probe never reads a directory as a document", () => {
  test("a declared sha256 whose path is a directory is no violation and no crash", async () => {
    const r = makeRoot(
      ["best_practices:", "  - name: folder-rules", "    path: docs/house", `    sha256: ${SHA_ABC}`, ""].join("\n"),
      { "docs/house/kettle.md": "abc" },
    );
    expect((await runProbe(r.root)).violations).toEqual([]);
  });
});

describe("AC-STE-879.1 hardening — `add` refuses a directory as the document", () => {
  test("a --path that names a directory prints the NFR-10 refusal, exits 2, manifest byte-identical", () => {
    const r = makeRoot(ONE_ENTRY, { "docs/house/kettle.md": "", "docs/house/sub/mug.md": "" });
    const before = bytes(r.manifest);
    const run = runCli(r, "add", ["--name", "folder-rules", "--path", "docs/house/sub"]);
    expect(run.exitCode).toBe(2);
    expectNfr10Refusal(run);
    expect(`${run.stdout}${run.stderr}`).toContain("docs/house/sub");
    expect(bytes(r.manifest).equals(before)).toBe(true);
  });
});

describe("AC-STE-879.1 hardening — a non-numeric --max-bytes is quoted in the refusal", () => {
  test("`--max-bytes lots` refuses, exits 2, names `lots`, and never says `got null`", () => {
    const r = makeRoot(ONE_ENTRY, { "docs/house/kettle.md": "", "docs/house/mug.md": "" });
    const before = bytes(r.manifest);
    const run = runCli(r, "add", ["--name", "mug-rules", "--path", "docs/house/mug.md", "--max-bytes", "lots"]);
    expect(run.exitCode).toBe(2);
    expectNfr10Refusal(run);
    expect(`${run.stdout}${run.stderr}`).toContain("lots");
    expect(`${run.stdout}${run.stderr}`).not.toContain("got null");
    expect(bytes(r.manifest).equals(before)).toBe(true);
  });
});

describe("AC-STE-879.4 hardening — an unreadable document is skipped, never a crash", () => {
  test("a declared sha256 on a document that cannot be read is no violation and no throw", async () => {
    const r = makeRoot(
      ["best_practices:", "  - name: locked-rules", "    path: docs/house/locked.md", `    sha256: ${SHA_ABC}`, ""].join("\n"),
      { "docs/house/locked.md": "abc" },
    );
    const doc = join(r.root, "docs/house/locked.md");
    chmodSync(doc, 0o000);
    try {
      expect((await runProbe(r.root)).violations).toEqual([]);
    } finally {
      chmodSync(doc, 0o644);
    }
  });
});

// Supervisor review (M_43bc84): the parser trims and strips quotes on read, so
// a value `add` wrote verbatim could read back as something else — `kettle `
// beside `kettle` wrote a manifest every later read refused as a duplicate,
// and neither add nor remove could repair it. `add` now refuses any entry the
// would-be manifest does not round-trip through readManifest exactly.
describe("AC-STE-879.1 hardening — `add` never writes a manifest that reads back differently", () => {
  const KETTLE = ["best_practices:", "  - name: kettle", "    path: docs/house/kettle.md", ""].join("\n");
  const refusals: [string, string[]][] = [
    ["a name with a trailing space beside an existing `kettle`", ["--name", "kettle ", "--path", "docs/house/mug.md"]],
    ["a quoted name that reads back as `kettle`", ["--name", '"kettle"', "--path", "docs/house/mug.md"]],
    ["a single-quoted name", ["--name", "'mug-rules'", "--path", "docs/house/mug.md"]],
    ["a name with a leading space", ["--name", " mug-rules", "--path", "docs/house/mug.md"]],
  ];
  for (const [label, args] of refusals) {
    test(`${label}: NFR-10 refusal, exit 2, manifest byte-identical, and the manifest still reads`, () => {
      const r = makeRoot(KETTLE, { "docs/house/kettle.md": "", "docs/house/mug.md": "" });
      const before = bytes(r.manifest);
      const run = runCli(r, "add", args);
      expect(run.exitCode).toBe(2);
      expectNfr10Refusal(run);
      expect(bytes(r.manifest).equals(before)).toBe(true);
      expect(runCli(r, "remove", ["--name", "kettle"]).exitCode).toBe(0);
    });
  }

  test("a plain name still adds, and the written manifest reads back with that exact entry", () => {
    const r = makeRoot(KETTLE, { "docs/house/kettle.md": "", "docs/house/mug.md": "" });
    expect(runCli(r, "add", ["--name", "mug-rules", "--path", "docs/house/mug.md", "--notes", "keep it short"]).exitCode).toBe(0);
    const text = readFileSync(r.manifest, "utf8");
    expect(text).toContain("  - name: mug-rules\n    path: docs/house/mug.md\n    notes: keep it short\n");
  });
});
