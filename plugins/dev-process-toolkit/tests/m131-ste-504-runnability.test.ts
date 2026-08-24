// STE-504 (M131) — `detectRunnability(projectRoot)` module behaviour.
//
// "A project that documents how to run itself must declare it."
//
// The failure mode this FR is designed against is NOT a missed detection but an
// OVER-EAGER one (FR ## Notes). A detector that fires on every library trains
// the author to write `run_cmd: none` without reading the question, and a
// contract everyone silences is worse than no contract because it looks like
// coverage. Every clause below therefore comes in a pair: the positive fixture
// carries ONLY its own source (so a clause that fires on nothing else is
// proved), and the near-miss fixture is asserted to yield `runnable: false`
// with an EMPTY sources list (so a clause that fires on everything cannot
// pass). Isolation is only half the test.
//
// EXACT MATCH, NEVER SUBSTRING, is the load-bearing rule the FR states in prose:
// a `build` script is not a `dev` script, a `run-tests` target is not a `run`
// target, and "Running the test suite" is not "Running".
//
// RED-state until the implementation lands at:
//   plugins/dev-process-toolkit/adapters/_shared/src/detect_runnability.ts
//
// AC coverage:
//   AC-STE-504.1 — `detectRunnability(projectRoot)` returns
//                  `{ runnable, sources: { source, evidence }[] }`.
//   AC-STE-504.2 — the source set is exactly the four named sources, and it is
//                  CLOSED (a fifth id cannot appear).
//   AC-STE-504.5 — every source mutation-verified in both directions.
//   (AC-STE-504.3 / .4 / .6 live in tests/gate-check-runnability-declared.test.ts.)
//
// Plus the probe-#74 bookkeeping this module requires: `detect_runnability`
// reads CLAUDE.md as an INPUT DOCUMENT (it scans for a run block; it is not
// asking whether the tree is managed), so it takes a recorded
// `CLAUDEMD_GUARD_EXEMPT` entry rather than an `isToolkitManaged` import.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

// Module not yet present — this import drives the RED state.
import {
  RUNNABILITY_SOURCE_IDS,
  detectRunnability,
  type RunnabilityReport,
  type RunnabilitySourceId,
} from "../adapters/_shared/src/detect_runnability";
import { CLAUDEMD_GUARD_EXEMPT } from "../adapters/_shared/src/claudemd_probe_managed_guard";

const pluginRoot = join(import.meta.dir, "..");
const repoRoot = join(pluginRoot, "..", "..");

// ─────────────────────────────────────────────────────────────────────────────
// Fixture helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a throwaway project root containing exactly `files` and hand it to
 * `fn`. Nothing here ever touches this repository's own tree.
 */
function withFixture<T>(files: Record<string, string>, fn: (root: string) => T): T {
  const root = mkdtempSync(join(tmpdir(), "ste504-runnability-"));
  try {
    for (const [rel, body] of Object.entries(files)) {
      const abs = join(root, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, body, "utf-8");
    }
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** The sorted set of source ids a report names. */
function idsOf(report: RunnabilityReport): string[] {
  return report.sources.map((s) => s.source).sort();
}

/** The single source of a report expected to carry exactly one. */
function onlySource(report: RunnabilityReport): { source: RunnabilitySourceId; evidence: string } {
  expect(report.sources).toHaveLength(1);
  return report.sources[0]!;
}

/**
 * Assert the shared negative shape: detection did NOT fire, and it fired on
 * NOTHING — not merely `runnable: false` with a source quietly recorded.
 */
function expectSilent(report: RunnabilityReport): void {
  expect(report.runnable).toBe(false);
  expect(report.sources).toEqual([]);
}

const PKG_DEV = JSON.stringify({ name: "fx", scripts: { dev: "vite dev --port 4321" } }, null, 2);
const PKG_START = JSON.stringify({ name: "fx", scripts: { start: "node server.js" } }, null, 2);
const MAKEFILE_RUN = ".PHONY: run\n\nrun:\n\tnode server.js\n";

// ─────────────────────────────────────────────────────────────────────────────
// AC-STE-504.1 — shape of the report
// ─────────────────────────────────────────────────────────────────────────────

describe("AC-STE-504.1 — detectRunnability reports discoverable run instructions", () => {
  test("an empty project root is not runnable and names no source", () => {
    withFixture({}, (root) => expectSilent(detectRunnability(root)));
  });

  test("a firing project reports runnable:true plus a source/evidence pair", () => {
    withFixture({ "package.json": PKG_DEV }, (root) => {
      const report = detectRunnability(root);
      expect(report.runnable).toBe(true);
      const src = onlySource(report);
      expect(typeof src.source).toBe("string");
      expect(typeof src.evidence).toBe("string");
      expect(src.evidence.length).toBeGreaterThan(0);
    });
  });

  test("runnable is exactly `sources.length > 0` on both a positive and a negative", () => {
    withFixture({ "package.json": PKG_DEV }, (root) => {
      const r = detectRunnability(root);
      expect(r.runnable).toBe(r.sources.length > 0);
      expect(r.sources.length).toBeGreaterThan(0);
    });
    withFixture({ "package.json": '{"scripts":{"build":"tsc"}}' }, (root) => {
      const r = detectRunnability(root);
      expect(r.runnable).toBe(r.sources.length > 0);
      expect(r.sources).toHaveLength(0);
    });
  });

  test("a nonexistent project root does not throw and does not fire", () => {
    const missing = join(tmpdir(), "ste504-does-not-exist-a7f3");
    expect(() => detectRunnability(missing)).not.toThrow();
    expectSilent(detectRunnability(missing));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-STE-504.2 — the source set is exactly four, and it is CLOSED
// ─────────────────────────────────────────────────────────────────────────────

describe("AC-STE-504.2 — the source set is closed and named", () => {
  const EXPECTED_IDS = [
    "claude_md_run_block",
    "makefile_run_target",
    "package_json_script",
    "readme_run_heading",
  ];

  test("RUNNABILITY_SOURCE_IDS is exactly the four named sources", () => {
    expect(RUNNABILITY_SOURCE_IDS).toHaveLength(4);
    expect([...RUNNABILITY_SOURCE_IDS].sort()).toEqual(EXPECTED_IDS);
  });

  test("a project carrying all four sources reports all four ids and no others", () => {
    withFixture(
      {
        "package.json": PKG_DEV,
        Makefile: MAKEFILE_RUN,
        "README.md": "# fx\n\n## Running\n\nRun it.\n",
        "CLAUDE.md": "# fx\n\n## Development\n\nDev it.\n",
      },
      (root) => {
        const report = detectRunnability(root);
        expect(report.runnable).toBe(true);
        expect(idsOf(report)).toEqual(EXPECTED_IDS);
      },
    );
  });

  test("every reported source id is drawn from the closed set", () => {
    withFixture(
      {
        "package.json": PKG_START,
        makefile: MAKEFILE_RUN,
        "README.md": "## Getting Started\n",
        "CLAUDE.md": "## Running\n",
      },
      (root) => {
        for (const s of detectRunnability(root).sources) {
          expect(RUNNABILITY_SOURCE_IDS).toContain(s.source);
        }
      },
    );
  });

  // The real closure test: a repo stuffed with plausible-but-out-of-set run
  // documentation. Nothing here is one of the four named sources, so an
  // implementation that grew a fifth clause fails right here.
  test("out-of-set run documentation invents no fifth source", () => {
    withFixture(
      {
        Dockerfile: 'FROM node:22\nCMD ["node", "server.js"]\n',
        "docker-compose.yml": "services:\n  web:\n    command: node server.js\n",
        Procfile: "web: node server.js\n",
        justfile: "run:\n  node server.js\n",
        "Taskfile.yml": "tasks:\n  run:\n    cmds:\n      - node server.js\n",
        "package.json": JSON.stringify({ scripts: { serve: "node server.js", build: "tsc" } }),
        "README.md": "# fx\n\n## Usage\n\n## Quickstart\n\n## Installation\n",
        "CLAUDE.md": "# fx\n\n## Commands\n\n## Key Commands\n",
      },
      (root) => expectSilent(detectRunnability(root)),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-STE-504.5 — package_json_script, both directions
// ─────────────────────────────────────────────────────────────────────────────

describe("AC-STE-504.5 — package_json_script fires on a real positive", () => {
  test("`scripts.dev` fires, and ONLY package_json_script fires", () => {
    withFixture({ "package.json": PKG_DEV }, (root) => {
      const report = detectRunnability(root);
      expect(report.runnable).toBe(true);
      expect(onlySource(report).source).toBe("package_json_script");
    });
  });

  test("`scripts.start` fires, and ONLY package_json_script fires", () => {
    withFixture({ "package.json": PKG_START }, (root) => {
      const report = detectRunnability(root);
      expect(report.runnable).toBe(true);
      expect(onlySource(report).source).toBe("package_json_script");
    });
  });

  test("the evidence names the file and the script key that fired", () => {
    withFixture({ "package.json": PKG_DEV }, (root) => {
      const { evidence } = onlySource(detectRunnability(root));
      expect(evidence).toContain("package.json");
      expect(evidence).toMatch(/\bdev\b/);
    });
    withFixture({ "package.json": PKG_START }, (root) => {
      const { evidence } = onlySource(detectRunnability(root));
      expect(evidence).toContain("package.json");
      expect(evidence).toMatch(/\bstart\b/);
    });
  });
});

describe("AC-STE-504.5 — package_json_script does NOT fire on a near-miss", () => {
  // The FR names this one explicitly: "A `build` script is not a `dev` script."
  test("`scripts.build` alone does not fire", () => {
    withFixture({ "package.json": '{"scripts":{"build":"tsc -p ."}}' }, (root) =>
      expectSilent(detectRunnability(root)),
    );
  });

  test("keys that merely CONTAIN dev/start do not fire (exact match, never substring)", () => {
    withFixture(
      {
        "package.json": JSON.stringify({
          scripts: {
            "dev:watch": "vite",
            predev: "echo",
            "start:prod": "node .",
            prestart: "echo",
            devserver: "vite",
            restart: "pm2 restart",
          },
        }),
      },
      (root) => expectSilent(detectRunnability(root)),
    );
  });

  test("a `dev`/`start` key outside `scripts` does not fire", () => {
    withFixture(
      { "package.json": JSON.stringify({ bin: { dev: "./cli.js" }, config: { start: "x" } }) },
      (root) => expectSilent(detectRunnability(root)),
    );
  });

  test("package.json with no scripts block does not fire", () => {
    withFixture({ "package.json": '{"name":"fx","version":"0.0.0"}' }, (root) =>
      expectSilent(detectRunnability(root)),
    );
  });

  test("a malformed package.json neither throws nor fires", () => {
    withFixture({ "package.json": '{"scripts": {"dev": "vite"' }, (root) => {
      expect(() => detectRunnability(root)).not.toThrow();
      expectSilent(detectRunnability(root));
    });
  });

  test("a package.json that is not an object neither throws nor fires", () => {
    withFixture({ "package.json": '["dev","start"]' }, (root) => {
      expect(() => detectRunnability(root)).not.toThrow();
      expectSilent(detectRunnability(root));
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-STE-504.5 — makefile_run_target, both directions
// ─────────────────────────────────────────────────────────────────────────────

describe("AC-STE-504.5 — makefile_run_target fires on a real positive", () => {
  test("a `run:` target fires, and ONLY makefile_run_target fires", () => {
    withFixture({ Makefile: MAKEFILE_RUN }, (root) => {
      const report = detectRunnability(root);
      expect(report.runnable).toBe(true);
      expect(onlySource(report).source).toBe("makefile_run_target");
    });
  });

  test("a `run: <deps>` target fires", () => {
    withFixture({ Makefile: "build:\n\ttsc\n\nrun: build\n\tnode .\n" }, (root) => {
      expect(onlySource(detectRunnability(root)).source).toBe("makefile_run_target");
    });
  });

  test("lowercase `makefile` and `GNUmakefile` are recognized too", () => {
    withFixture({ makefile: MAKEFILE_RUN }, (root) => {
      expect(onlySource(detectRunnability(root)).source).toBe("makefile_run_target");
    });
    withFixture({ GNUmakefile: MAKEFILE_RUN }, (root) => {
      expect(onlySource(detectRunnability(root)).source).toBe("makefile_run_target");
    });
  });

  test("the evidence names the makefile and the target that fired", () => {
    withFixture({ Makefile: MAKEFILE_RUN }, (root) => {
      const { evidence } = onlySource(detectRunnability(root));
      expect(evidence).toMatch(/Makefile/i);
      expect(evidence).toMatch(/\brun\b/);
    });
  });
});

describe("AC-STE-504.5 — makefile_run_target does NOT fire on a near-miss", () => {
  // The FR names this one explicitly: "A Makefile `run-tests` target is not a
  // `run` target."
  test("a `run-tests:` target does not fire", () => {
    withFixture({ Makefile: ".PHONY: run-tests\n\nrun-tests:\n\tbun test\n" }, (root) =>
      expectSilent(detectRunnability(root)),
    );
  });

  test("targets that merely contain `run` do not fire (exact match, never substring)", () => {
    withFixture(
      {
        Makefile: [
          "prerun:",
          "\techo pre",
          "",
          "dry-run:",
          "\techo dry",
          "",
          "run_all:",
          "\techo all",
          "",
          "runner:",
          "\techo runner",
          "",
        ].join("\n"),
      },
      (root) => expectSilent(detectRunnability(root)),
    );
  });

  // ── Variable assignments are not targets ────────────────────────────────
  //
  // FALSIFIABILITY (leg 2): this clause protects the `(?!=)` lookahead in
  //   const RUN_TARGET_RE = /^run[ \t]*:(?!=)/;
  // in adapters/_shared/src/detect_runnability.ts. Delete the lookahead and
  // the surviving `^run[ \t]*:` matches the `run :` prefix of `run := node .`,
  // makefile_run_target fires, and this test goes red. Verified by executing
  // both regex variants against the fixture line before writing the test.
  test("`run := node .` is a variable assignment, not a `run` target", () => {
    withFixture({ Makefile: "run := node .\n\nbuild:\n\ttsc\n" }, (root) =>
      expectSilent(detectRunnability(root)),
    );
  });

  // FALSIFIABILITY (leg 2, second deletion): this clause protects the LITERAL
  // `:` in `RUN_TARGET_RE`, NOT the `(?!=)` lookahead — `run ?= node .` carries
  // no `:` at all, so deleting `(?!=)` leaves it silent. The deletion this one
  // catches is a widening of the separator class (e.g. `^run[ \t]*[:?]?=`),
  // which would swallow GNU make's conditional-assignment operator.
  test("`run ?= node .` (conditional assignment) is not a `run` target", () => {
    withFixture({ Makefile: "run ?= node .\n\nbuild:\n\ttsc\n" }, (root) =>
      expectSilent(detectRunnability(root)),
    );
  });

  // Protects the `:?` inside `RUN_TARGET_RE`'s `(?!:?=)` lookahead. Narrowing
  // that lookahead back to `(?!=)` makes `run ::=` fire again, so this leg dies
  // on exactly that deletion. The twin below keeps the narrowing honest in the
  // other direction: `run::` is make's real double-colon TARGET syntax and must
  // still fire, so the lookahead may not simply swallow every `run ::`.
  test("`run ::= node .` (simply-expanded assignment) is not a `run` target", () => {
    withFixture({ Makefile: "run ::= node .\n\nbuild:\n\ttsc\n" }, (root) =>
      expectSilent(detectRunnability(root)),
    );
  });

  test("`run::` (double-colon target) IS a `run` target", () => {
    withFixture({ Makefile: "run::\n\tnode .\n" }, (root) => {
      const report = detectRunnability(root);
      expect(report.runnable).toBe(true);
      expect(report.sources.map((s) => s.source)).toEqual(["makefile_run_target"]);
    });
  });

  test("a makefile with no targets at all does not fire", () => {
    withFixture({ Makefile: "CC = gcc\nCFLAGS = -O2\n" }, (root) =>
      expectSilent(detectRunnability(root)),
    );
  });

  test("a `run:` line inside a non-makefile file does not fire", () => {
    withFixture({ "ci.yml": "jobs:\n  run:\n    steps: []\n" }, (root) =>
      expectSilent(detectRunnability(root)),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-STE-504.5 — makefile resolution order: FIRST PRESENT WINS
//
// GNU make reads exactly one makefile, resolved in the order GNUmakefile,
// makefile, Makefile. A second file is NOT a fallback for a first one that
// simply has no `run` target — the target in the shadowed file is never
// reachable, so reporting it would be an over-eager detection of a run command
// that does not exist.
//
// FALSIFIABILITY (leg 3): the negative clause protects the bare
//   return null;   // "First makefile present wins, target or not"
// at the end of the first iteration of `detectMakefileRunTarget`'s
// `for (const name of MAKEFILE_NAMES)` loop. Delete that statement and the loop
// falls through to `Makefile`, whose `run:` target fires — turning the negative
// clause red. The positive twin is what keeps the negative from being satisfied
// by a detector that never reads GNUmakefile at all.
// ─────────────────────────────────────────────────────────────────────────────

describe("AC-STE-504.5 — the first makefile present wins, target or not", () => {
  test("a GNUmakefile without a `run` target shadows a Makefile that has one", () => {
    withFixture(
      { GNUmakefile: "build:\n\ttsc\n", Makefile: MAKEFILE_RUN },
      (root) => expectSilent(detectRunnability(root)),
    );
  });

  test("the positive twin: a GNUmakefile that DOES declare `run:` fires", () => {
    withFixture(
      { GNUmakefile: MAKEFILE_RUN, Makefile: "build:\n\ttsc\n" },
      (root) => {
        const src = onlySource(detectRunnability(root));
        expect(src.source).toBe("makefile_run_target");
        // The evidence must name the file that actually resolved, not the
        // shadowed one — otherwise the operator is sent to the wrong file.
        expect(src.evidence).toContain("GNUmakefile");
      },
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-STE-504.5 — readme_run_heading, both directions
// ─────────────────────────────────────────────────────────────────────────────

describe("AC-STE-504.5 — readme_run_heading fires on a real positive", () => {
  test("`## Running` fires, and ONLY readme_run_heading fires", () => {
    withFixture({ "README.md": "# fx\n\n## Running\n\nbun start\n" }, (root) => {
      const report = detectRunnability(root);
      expect(report.runnable).toBe(true);
      expect(onlySource(report).source).toBe("readme_run_heading");
    });
  });

  test("each phrase of the closed set fires: Running / Getting Started / Development", () => {
    for (const heading of ["## Running", "## Getting Started", "## Development"]) {
      withFixture({ "README.md": `# fx\n\n${heading}\n\nbody\n` }, (root) => {
        expect(onlySource(detectRunnability(root)).source).toBe("readme_run_heading");
      });
    }
  });

  test("heading level is irrelevant; case and trailing punctuation are trimmed", () => {
    for (const heading of ["# Running", "### getting started", "## Getting Started:", "## Development."]) {
      withFixture({ "README.md": `${heading}\n\nbody\n` }, (root) => {
        expect(onlySource(detectRunnability(root)).source).toBe("readme_run_heading");
      });
    }
  });

  test("the evidence names the README and the heading text that fired", () => {
    withFixture({ "README.md": "# fx\n\n## Running\n" }, (root) => {
      const { evidence } = onlySource(detectRunnability(root));
      expect(evidence).toMatch(/README\.md/i);
      expect(evidence).toContain("Running");
    });
  });
});

describe("AC-STE-504.5 — readme_run_heading does NOT fire on a near-miss", () => {
  // The FR names this one explicitly: 'A README heading "Running the test
  // suite" is not "Running".' A substring match WOULD fire here — which is
  // exactly why exact-match is the load-bearing rule.
  test("`## Running the test suite` does not fire", () => {
    withFixture({ "README.md": "# fx\n\n## Running the test suite\n\nbun test\n" }, (root) =>
      expectSilent(detectRunnability(root)),
    );
  });

  test("headings that merely contain a closed phrase do not fire", () => {
    withFixture(
      {
        "README.md": [
          "# fx",
          "",
          "## Running the test suite",
          "## Getting Started with plugins",
          "## Development process",
          "## Developer Guide",
          "## Get Started",
          "## Local Development Notes",
          "",
        ].join("\n"),
      },
      (root) => expectSilent(detectRunnability(root)),
    );
  });

  test("a closed phrase in prose rather than a heading does not fire", () => {
    withFixture(
      { "README.md": "# fx\n\nRunning this is easy. Getting Started is covered elsewhere.\n" },
      (root) => expectSilent(detectRunnability(root)),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-STE-504.5 — claude_md_run_block, both directions
// ─────────────────────────────────────────────────────────────────────────────

describe("AC-STE-504.5 — claude_md_run_block fires on a real positive", () => {
  test("`## Development` fires, and ONLY claude_md_run_block fires", () => {
    withFixture({ "CLAUDE.md": "# fx\n\n## Development\n\nbun dev\n" }, (root) => {
      const report = detectRunnability(root);
      expect(report.runnable).toBe(true);
      expect(onlySource(report).source).toBe("claude_md_run_block");
    });
  });

  test("each phrase of the closed set fires in CLAUDE.md too", () => {
    for (const heading of ["## Running", "## Getting Started", "## Development"]) {
      withFixture({ "CLAUDE.md": `# fx\n\n${heading}\n\nbody\n` }, (root) => {
        expect(onlySource(detectRunnability(root)).source).toBe("claude_md_run_block");
      });
    }
  });

  test("the evidence names CLAUDE.md and the heading text that fired", () => {
    withFixture({ "CLAUDE.md": "# fx\n\n## Development\n" }, (root) => {
      const { evidence } = onlySource(detectRunnability(root));
      expect(evidence).toContain("CLAUDE.md");
      expect(evidence).toContain("Development");
    });
  });
});

describe("AC-STE-504.5 — claude_md_run_block does NOT fire on a near-miss", () => {
  test("`## Development process` does not fire", () => {
    withFixture({ "CLAUDE.md": "# fx\n\n## Development process\n\nWe use TDD.\n" }, (root) =>
      expectSilent(detectRunnability(root)),
    );
  });

  test("the toolkit's own CLAUDE.md section vocabulary does not fire", () => {
    withFixture(
      {
        "CLAUDE.md": [
          "# fx",
          "",
          "## What This Is",
          "## Structure",
          "## How It Works",
          "## Core Principles",
          "## Task Tracking",
          "## Docs",
          "## Orchestration",
          "## Verification",
          "",
        ].join("\n"),
      },
      (root) => expectSilent(detectRunnability(root)),
    );
  });

  test("a closed phrase in CLAUDE.md prose rather than a heading does not fire", () => {
    withFixture(
      { "CLAUDE.md": "# fx\n\nDevelopment happens on feature branches. Running is out of scope.\n" },
      (root) => expectSilent(detectRunnability(root)),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The repo as its own negative fixture (FR ## Technical Design)
// ─────────────────────────────────────────────────────────────────────────────

describe("this repository is its own negative fixture", () => {
  test("detectRunnability does not fire on the toolkit repo root", () => {
    expectSilent(detectRunnability(repoRoot));
  });

  /**
   * Headings of `body`, normalized exactly as `detect_runnability` normalizes
   * them: `#`s stripped, trimmed, trailing sentence punctuation dropped,
   * re-trimmed, lowercased. Mirroring the module's own `.trim()` AFTER the
   * punctuation strip is deliberate — it folds MORE headings into the closed
   * phrase set, so the precondition below is strictly harder to satisfy.
   */
  function normalizedHeadings(body: string): string[] {
    return body
      .split("\n")
      .filter((l) => /^#{1,6} /.test(l.replace(/\r$/, "")))
      .map((l) =>
        l
          .replace(/\r$/, "")
          .replace(/^#{1,6}\s+/, "")
          .trim()
          .replace(/[.:!?]+$/, "")
          .trim()
          .toLowerCase(),
      );
  }

  const RUN_HEADING_PHRASES = ["running", "getting started", "development"];

  test("all FOUR preconditions that make it a negative fixture still hold", () => {
    // If any of these stops being true the assertion above becomes a false
    // green (or a confusing red) — pin the reasons, not just the verdict. One
    // precondition per source of the closed set, so the verdict above can never
    // go red with half its surface unexplained.

    // Source 1 — package_json_script.
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf-8")) as {
      scripts?: Record<string, string>;
    };
    expect(Object.keys(pkg.scripts ?? {})).not.toContain("dev");
    expect(Object.keys(pkg.scripts ?? {})).not.toContain("start");

    // Source 2 — makefile_run_target. Not "no makefile exists" (that would go
    // vacuously green the moment one appeared without a run target): the list
    // of repo-root makefiles that DECLARE a `run` target must be empty, and the
    // assertion runs whether or not any makefile is present.
    const makefilesWithRunTarget = ["GNUmakefile", "makefile", "Makefile"].filter((name) => {
      let body: string;
      try {
        body = readFileSync(join(repoRoot, name), "utf-8");
      } catch {
        return false;
      }
      return body.split("\n").some((l) => /^run[ \t]*:(?!=)/.test(l.replace(/\r$/, "")));
    });
    expect(makefilesWithRunTarget).toEqual([]);

    // Source 3 — readme_run_heading.
    const readmeHeadings = normalizedHeadings(readFileSync(join(repoRoot, "README.md"), "utf-8"));
    for (const phrase of RUN_HEADING_PHRASES) {
      expect(readmeHeadings).not.toContain(phrase);
    }

    // Source 4 — claude_md_run_block. The repo root CLAUDE.md is read here as
    // an INPUT DOCUMENT (the same way the detector reads it) and never written.
    const claudeMdHeadings = normalizedHeadings(
      readFileSync(join(repoRoot, "CLAUDE.md"), "utf-8"),
    );
    expect(claudeMdHeadings.length).toBeGreaterThan(0);
    for (const phrase of RUN_HEADING_PHRASES) {
      expect(claudeMdHeadings).not.toContain(phrase);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Probe #74 bookkeeping — detect_runnability reads CLAUDE.md as an INPUT
// DOCUMENT, so it is a recorded exemption, not a toolkit_managed consumer.
// ─────────────────────────────────────────────────────────────────────────────

describe("probe #74 — detect_runnability carries a recorded CLAUDEMD_GUARD_EXEMPT entry", () => {
  test("the exemption key exists and carries a non-empty reason", () => {
    expect(Object.hasOwn(CLAUDEMD_GUARD_EXEMPT, "detect_runnability")).toBe(true);
    const reason = CLAUDEMD_GUARD_EXEMPT["detect_runnability"]!;
    expect(typeof reason).toBe("string");
    expect(reason.trim().length).toBeGreaterThan(0);
  });

  test("the reason records the input-document rationale, not a blanket waiver", () => {
    const reason = CLAUDEMD_GUARD_EXEMPT["detect_runnability"]!.toLowerCase();
    expect(reason).toContain("input document");
  });

  test("detect_runnability does NOT route through the managed-ness predicate", () => {
    // The exemption is only honest if the module really is exempt: routing the
    // scan through `isToolkitManaged` would change its semantics (it would stop
    // reading unmanaged trees at all), which is precisely why the entry exists.
    const body = readFileSync(
      join(pluginRoot, "adapters", "_shared", "src", "detect_runnability.ts"),
      "utf-8",
    );
    expect(body).not.toMatch(/from\s+["']\.\/toolkit_managed(?:\.[jt]s)?["']/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-STE-504.5 — `findRunHeading` is MARKDOWN-FENCE-AWARE
//
// A `#`-prefixed line inside a fenced code block is a shell comment, not an ATX
// heading. CommonMark §4.5 (fenced code blocks) is explicit that the content of
// a fence is literal text; §4.2 (ATX headings) only recognizes a heading in a
// leaf-block position, which the inside of a fence is not.
//
// This is the FR's own stated failure mode arriving for real. The SHIPPED
// `templates/CLAUDE.md.template` carries, under `## Key Commands`:
//
//     ```bash
//     # Development
//     # npm run dev / fvm flutter run / python manage.py runserver
//
// so a fence-blind scan classifies EVERY project bootstrapped from the shipped
// template as runnable, and probe #80 reds it until someone writes `run_cmd`.
// That is precisely "a probe that reds a library repo trains the author to
// write `run_cmd: none` without reading the question".
//
// Both heading sources share `findRunHeading`, so every clause below is
// asserted against README.md AND CLAUDE.md — a fix applied to one caller is not
// a fix. And every "does not fire" clause has a twin that DOES fire on the same
// text with the fence markers removed: the correct fix is fence-awareness, not
// "stop detecting headings".
// ─────────────────────────────────────────────────────────────────────────────

/** The two sources that share `findRunHeading`, with the file each one reads. */
const HEADING_SOURCES = [
  { file: "README.md", source: "readme_run_heading" },
  { file: "CLAUDE.md", source: "claude_md_run_block" },
] as const;

/** The three closed phrases, spelled as an author would spell them. */
const CLOSED_PHRASES = ["Running", "Getting Started", "Development"] as const;

/** Run `body` through BOTH heading sources, one fixture each. */
function forEachHeadingSource(
  body: string,
  fn: (report: RunnabilityReport, expectedSource: RunnabilitySourceId, file: string) => void,
): void {
  for (const { file, source } of HEADING_SOURCES) {
    withFixture({ [file]: body }, (root) => fn(detectRunnability(root), source, file));
  }
}

/** The shipped template's shape: a closed phrase as a shell comment in a fence. */
function fencedBody(open: string, phrase: string): string {
  const close = open.startsWith("~") ? "~~~" : "```";
  return [
    "# Fixture",
    "",
    "## Key Commands",
    "",
    open,
    `# ${phrase}`,
    "# npm run dev / fvm flutter run",
    close,
    "",
    "Some prose.",
    "",
  ].join("\n");
}

/**
 * The twin of `fencedBody`: byte-for-byte the same document with ONLY the two
 * fence markers removed, so `# ${phrase}` is now a real ATX heading. If this
 * stops firing, the "fix" was to stop detecting headings.
 */
function unfencedBody(phrase: string): string {
  return [
    "# Fixture",
    "",
    "## Key Commands",
    "",
    `# ${phrase}`,
    "# npm run dev / fvm flutter run",
    "",
    "Some prose.",
    "",
  ].join("\n");
}

/** Fence openers that must all suppress detection, info string or not. */
const FENCE_OPENERS = ["```", "```bash", "```sh", "~~~", "~~~bash"] as const;

describe("AC-STE-504.5 — a closed phrase INSIDE a fenced code block does not fire", () => {
  for (const open of FENCE_OPENERS) {
    for (const phrase of CLOSED_PHRASES) {
      test(`\`# ${phrase}\` inside a ${JSON.stringify(open)} fence is a comment, not a heading`, () => {
        forEachHeadingSource(fencedBody(open, phrase), (report) => expectSilent(report));
      });
    }
  }

  test("the exact shipped-template shape does not fire on either source", () => {
    // Copied from templates/CLAUDE.md.template `## Key Commands`, verbatim.
    const body = [
      "# Project Name",
      "",
      "## Key Commands",
      "",
      "<!-- Uncomment and adapt the lines for your stack -->",
      "```bash",
      "# Development",
      "# npm run dev / fvm flutter run / python manage.py runserver",
      "",
      "# Build",
      "# npm run build / fvm flutter build / python -m build",
      "```",
      "",
    ].join("\n");
    forEachHeadingSource(body, (report) => expectSilent(report));
  });
});

describe("AC-STE-504.5 — the twin: the SAME line OUTSIDE any fence still fires", () => {
  for (const phrase of CLOSED_PHRASES) {
    test(`\`# ${phrase}\` unfenced fires, on both sources, with quotable evidence`, () => {
      forEachHeadingSource(unfencedBody(phrase), (report, expectedSource, file) => {
        expect(report.runnable).toBe(true);
        const src = onlySource(report);
        expect(src.source).toBe(expectedSource);
        expect(src.evidence).toContain(file);
        expect(src.evidence).toContain(`# ${phrase}`);
      });
    });
  }

  test("fenced and unfenced differ ONLY by the fence markers, and differ in verdict", () => {
    // The pair that proves the rule is about fences and nothing else.
    const fenced = fencedBody("```bash", "Development");
    const unfenced = unfencedBody("Development");
    expect(fenced.split("\n").filter((l) => !/^(```|~~~)/.test(l))).toEqual(
      unfenced.split("\n").filter((l) => !/^(```|~~~)/.test(l)),
    );
    forEachHeadingSource(fenced, (report) => expectSilent(report));
    forEachHeadingSource(unfenced, (report) => expect(report.runnable).toBe(true));
  });
});

describe("AC-STE-504.5 — the scanner RESUMES after a closed fence", () => {
  test("a closed fence suppresses only its own contents; a later heading fires", () => {
    const body = [
      "# Fixture",
      "",
      "```bash",
      "# Development",
      "```",
      "",
      "## Running",
      "",
      "npm start",
      "",
    ].join("\n");
    forEachHeadingSource(body, (report, expectedSource) => {
      expect(report.runnable).toBe(true);
      const src = onlySource(report);
      expect(src.source).toBe(expectedSource);
      // The heading that fired must be the REAL one after the fence, not the
      // shell comment inside it. A fence-blind scan reports `# Development`
      // here — the right verdict for the wrong reason.
      expect(src.evidence).toContain("## Running");
      expect(src.evidence).not.toContain("# Development");
    });
  });

  test("two fences in a row do not confuse the open/closed state", () => {
    const body = [
      "# Fixture",
      "",
      "```",
      "# Development",
      "```",
      "",
      "```sh",
      "# Getting Started",
      "```",
      "",
      "### Running",
      "",
    ].join("\n");
    forEachHeadingSource(body, (report) => {
      expect(report.runnable).toBe(true);
      expect(onlySource(report).evidence).toContain("### Running");
    });
  });

  test("a fence that opens and closes with NO closed phrase inside stays silent", () => {
    const body = ["# Fixture", "", "```bash", "npm run build", "```", "", "## Install", ""].join(
      "\n",
    );
    forEachHeadingSource(body, (report) => expectSilent(report));
  });
});

describe("AC-STE-504.5 — fence termination rules (CommonMark §4.5)", () => {
  /**
   * MY READING, stated so the next reader can argue with it rather than guess:
   *
   * CommonMark §4.5 — "If the end of the containing block (or document) is
   * reached and no closing code fence has been found, the code block contains
   * all of the lines after the opening code fence until the end of the
   * containing block (or document)."
   *
   * So an UNCLOSED fence really does swallow the rest of the document: nothing
   * after it is a heading, and detection is therefore silent. That is markdown's
   * answer, and it is also the conservative one for THIS detector — the failure
   * mode the FR is designed against is over-eagerness, so when the two candidate
   * readings are "swallow (silent)" and "recover (fire)", markdown and the FR's
   * ## Notes point the same way. Pinned either way, per the FR's own rule that an
   * unpinned edge is how the next over-eagerness ships.
   */
  test("an UNCLOSED fence swallows the rest of the document — silent, not firing", () => {
    const body = [
      "# Fixture",
      "",
      "```bash",
      "# Development",
      "",
      "## Running",
      "",
      "npm start",
      "",
    ].join("\n"); // no closing fence, deliberately
    forEachHeadingSource(body, (report) => expectSilent(report));
  });

  test("the twin: closing that same fence lets the later heading fire", () => {
    const body = [
      "# Fixture",
      "",
      "```bash",
      "# Development",
      "```",
      "",
      "## Running",
      "",
      "npm start",
      "",
    ].join("\n");
    forEachHeadingSource(body, (report) => {
      expect(report.runnable).toBe(true);
      expect(onlySource(report).evidence).toContain("## Running");
    });
  });

  test("a `~~~` line does not close a ``` fence — the block runs on", () => {
    const body = [
      "# Fixture",
      "",
      "```bash",
      "# Development",
      "~~~",
      "## Running",
      "```",
      "",
      "done",
      "",
    ].join("\n");
    forEachHeadingSource(body, (report) => expectSilent(report));
  });

  test("a shorter fence does not close a longer one", () => {
    const body = [
      "# Fixture",
      "",
      "````bash",
      "# Development",
      "```",
      "## Running",
      "````",
      "",
      "done",
      "",
    ].join("\n");
    forEachHeadingSource(body, (report) => expectSilent(report));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Regression — the REAL shipped template, not a paraphrase of it
//
// A hand-written fixture would drift from the template and stop protecting it.
// This leg reads the shipped bytes.
// ─────────────────────────────────────────────────────────────────────────────

const claudeMdTemplatePath = join(pluginRoot, "templates", "CLAUDE.md.template");

describe("regression — the shipped CLAUDE.md template does not make detection fire", () => {
  test("the template still carries the fenced `# Development` comment that caused this", () => {
    // If this precondition ever stops holding, the assertion below goes
    // vacuously green — pin the subject, not just the verdict.
    const body = readFileSync(claudeMdTemplatePath, "utf-8").replace(/\r\n/g, "\n");
    expect(body).toContain("```bash\n# Development\n");
  });

  test("copied out as CLAUDE.md, the shipped template is NOT runnable", () => {
    const body = readFileSync(claudeMdTemplatePath, "utf-8");
    withFixture({ "CLAUDE.md": body }, (root) => expectSilent(detectRunnability(root)));
  });

  test("copied out as README.md either — the same scan backs both sources", () => {
    const body = readFileSync(claudeMdTemplatePath, "utf-8");
    withFixture({ "README.md": body }, (root) => expectSilent(detectRunnability(root)));
  });

  test("the template's own REAL headings are still seen (the fix is not blindness)", () => {
    // Append a genuine run heading to the shipped bytes: detection must fire on
    // THAT, proving the silence above comes from fence-awareness and not from a
    // scanner that gave up on the file.
    const body = readFileSync(claudeMdTemplatePath, "utf-8") + "\n## Running\n\nnpm run dev\n";
    withFixture({ "CLAUDE.md": body }, (root) => {
      const report = detectRunnability(root);
      expect(report.runnable).toBe(true);
      expect(onlySource(report).evidence).toContain("## Running");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tripwire — no SHIPPED template or example lands a runnable CLAUDE.md/README.md
//
// This is the leg that would have caught the defect. Scope is deliberately the
// ROOT copy-out set: the detector reads only `<root>/CLAUDE.md` and
// `<root>/README.md`, so a template that lands anywhere else (e.g.
// `docs-README.md.template` → `docs/README.md`) is out of its reach, and
// asserting on it would be the same over-eagerness this FR is designed against.
// ─────────────────────────────────────────────────────────────────────────────

/** Every file under `dir`, recursively; `[]` when `dir` is absent. */
function walkFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: ReturnType<typeof readdirSync>;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(abs));
    else if (entry.isFile()) out.push(abs);
  }
  return out;
}

/**
 * The root filename this shipped file would be copied out as, or `null` when it
 * is not a root copy-out at all. `.template` is stripped; nothing else is.
 */
function rootCopyOutName(absPath: string): "CLAUDE.md" | "README.md" | null {
  const base = basename(absPath).replace(/\.template$/, "");
  if (base === "CLAUDE.md") return "CLAUDE.md";
  if (base === "README.md") return "README.md";
  return null;
}

const shippedRootCopyOuts = [
  ...walkFiles(join(pluginRoot, "templates")),
  ...walkFiles(join(pluginRoot, "examples")),
]
  .map((abs) => ({ abs, target: rootCopyOutName(abs) }))
  .filter((c): c is { abs: string; target: "CLAUDE.md" | "README.md" } => c.target !== null)
  .sort((a, b) => a.abs.localeCompare(b.abs));

describe("tripwire — no shipped root copy-out is classified runnable", () => {
  test("the walk finds the shipped CLAUDE.md template (guards a vacuous glob)", () => {
    expect(shippedRootCopyOuts.length).toBeGreaterThan(0);
    const rels = shippedRootCopyOuts.map((c) => c.abs.slice(pluginRoot.length + 1));
    expect(rels).toContain("templates/CLAUDE.md.template");
  });

  test("the walk itself is not empty-by-accident: templates/ and examples/ both exist", () => {
    expect(walkFiles(join(pluginRoot, "templates")).length).toBeGreaterThan(0);
    expect(walkFiles(join(pluginRoot, "examples")).length).toBeGreaterThan(0);
  });

  for (const { abs, target } of shippedRootCopyOuts) {
    test(`${abs.slice(pluginRoot.length + 1)} → ${target} is not runnable`, () => {
      const body = readFileSync(abs, "utf-8");
      withFixture({ [target]: body }, (root) => expectSilent(detectRunnability(root)));
    });
  }
});

// ---------------------------------------------------------------------------
// THIRD RED PASS — pre-PR spec-review finding (MEDIUM 3).
//
// `run_cmd` is read by TWO layers with two different notions of the `none`
// sentinel:
//
//   * `resolveVerifyMode` (adapters/_shared/src/verification_config.ts)
//     compares against the LITERAL lowercase `"none"`;
//   * `hasRunCmdAnswer` inside probe #80 (runnability_declared.ts) only asks
//     whether the trimmed value is non-empty.
//
// MEASURED, on a managed fixture whose README carries a `## Running` heading
// so detection fires, with `verify_mode` absent:
//
//     run_cmd            resolveVerifyMode   probe #80
//     -----------------  -----------------   -----------
//     none               advisory            silent
//     None               BLOCKING            silent
//     NONE               BLOCKING            silent
//     "  none  "         advisory            silent
//     bun run dev        blocking            silent
//
// So `run_cmd: None` silences the probe as an ANSWER *and* resolves to
// `blocking` — mandating a drive of a command literally named "None", on a
// project whose author was declaring it cannot be run. The two layers disagree
// about the same four bytes. It is the quiet direction that makes this worth a
// gate: nothing errors, the probe goes green, and Phase 4b" then blocks the
// step-15 commit on a drive that can never pass.
//
// The inconsistency is also internal to the section's own grammar:
// `verify_mode` REJECTS a non-lowercase value loudly
// (`MalformedVerificationConfigError`), so two keys in the same closed set
// treat casing in opposite ways.
//
// BINDING DECISION (operator): both layers treat `none` CASE-INSENSITIVELY, so
// they agree by construction. Deliberately NOT a throw — a project that works
// today must not start failing its gate on a casing nit, and the whole point
// of this FR family is that silencing the probe must stay cheap for a project
// that genuinely cannot be run.
//
// The last two describes are ORACLE comparisons rather than two restatements
// of the same rule: one asserts that inputs equal after trim+lowercase are
// indistinguishable to BOTH layers, the other ties the two layers' verdicts
// together on every input at once.
// ---------------------------------------------------------------------------

import { runRunnabilityDeclaredProbe } from "../adapters/_shared/src/runnability_declared";
import { resolveVerifyMode } from "../adapters/_shared/src/verification_config";

/**
 * A toolkit-managed project whose README documents how to run it (so probe #80
 * is live), carrying `run_cmd` exactly as `written` — or omitting the key
 * entirely when `written` is `null`. `verify_mode` is deliberately ABSENT, so
 * `resolveVerifyMode` answers from `run_cmd` alone.
 *
 * The `## Running` heading lives in README.md, never in this CLAUDE.md, so the
 * managed-ness signal and the detection signal stay independent.
 */
async function withRunCmd<T>(
  written: string | null,
  fn: (ctx: { root: string; claudeMd: string }) => Promise<T> | T,
): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), "ste504-runcmd-case-"));
  try {
    const runCmdLine = written === null ? "" : `run_cmd: ${written}\n`;
    writeFileSync(
      join(root, "CLAUDE.md"),
      `# Fixture\n\n## Task Tracking\n\nmode: none\n\n## Verification\n\nverify_skill: fixture-drive\n${runCmdLine}`,
      "utf-8",
    );
    writeFileSync(join(root, "README.md"), "# Fixture\n\n## Running\n\n`node server.js`\n", "utf-8");
    return await fn({ root, claudeMd: join(root, "CLAUDE.md") });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** `true` when probe #80 accepted the value as an ANSWER (no violation raised). */
async function probeAnswered(written: string | null): Promise<boolean> {
  return withRunCmd(written, async ({ root }) => {
    const report = await runRunnabilityDeclaredProbe(root);
    // Guard the fixture itself: a vacuous run would make every verdict below
    // "silent" for the wrong reason, and an empty source list would make the
    // probe silent whatever `run_cmd` said.
    expect(report.vacuous).toBe(false);
    expect(detectRunnability(root).runnable).toBe(true);
    return report.violations.length === 0;
  });
}

/** `true` when the resolved effective mode is `blocking` — i.e. a drive is mandated. */
async function resolverBlocking(written: string | null): Promise<boolean> {
  return withRunCmd(written, ({ claudeMd }) => resolveVerifyMode(claudeMd) === "blocking");
}

/** Every spelling of the `none` ANSWER that the closed set must treat alike. */
const NONE_SPELLINGS = ["none", "None", "NONE", "NoNe", "  none  ", "\tNONE  "] as const;

describe("MEDIUM 3 — `resolveVerifyMode` reads the `none` answer case-insensitively", () => {
  for (const written of NONE_SPELLINGS) {
    test(`run_cmd: ${JSON.stringify(written)} resolves to advisory, exactly as lowercase \`none\` does`, async () => {
      expect(await resolverBlocking(written)).toBe(false);
    });
  }

  test("a real command is untouched — the fold applies to the sentinel, not to the mode", async () => {
    expect(await resolverBlocking("bun run dev")).toBe(true);
    expect(await resolverBlocking("NODE_ENV=dev node server.js")).toBe(true);
  });
});

describe("MEDIUM 3 — probe #80 reads the `none` answer case-insensitively", () => {
  for (const written of NONE_SPELLINGS) {
    test(`run_cmd: ${JSON.stringify(written)} silences the probe, exactly as lowercase \`none\` does`, async () => {
      expect(await probeAnswered(written)).toBe(true);
    });
  }

  test("the probe is still LIVE on this fixture — an absent or empty value fires", async () => {
    expect(await probeAnswered(null)).toBe(false);
    expect(await probeAnswered("")).toBe(false);
    expect(await probeAnswered("   ")).toBe(false);
  });
});

/** Every input the two layers are compared on, absent key included. */
const RUN_CMD_INPUTS: readonly (string | null)[] = [
  null,
  "",
  "   ",
  ...NONE_SPELLINGS,
  "bun run dev",
  "  bun run dev  ",
  "Bun Run Dev",
];

/** The canonical form both layers must be blind to the difference from. */
const canonical = (written: string | null): string | null =>
  written === null ? null : written.trim().toLowerCase();

describe("MEDIUM 3 — oracle: inputs equal after trim+lowercase are indistinguishable to BOTH layers", () => {
  // No restatement of either implementation: the invariant is that neither
  // layer partitions the input space more finely than canonicalization does.
  const groups = new Map<string, (string | null)[]>();
  for (const written of RUN_CMD_INPUTS) {
    const key = canonical(written) ?? " absent";
    groups.set(key, [...(groups.get(key) ?? []), written]);
  }

  for (const [key, members] of groups) {
    if (members.length < 2) continue;
    test(`the ${JSON.stringify(key)} class is one class to the resolver and to the probe`, async () => {
      const modes = new Set<boolean>();
      const answers = new Set<boolean>();
      for (const written of members) {
        modes.add(await resolverBlocking(written));
        answers.add(await probeAnswered(written));
      }
      expect([...modes]).toHaveLength(1);
      expect([...answers]).toHaveLength(1);
    });
  }
});

describe("MEDIUM 3 — oracle: the two layers agree on every input", () => {
  // The joint invariant. A drive is mandated exactly when the probe saw an
  // ANSWER *and* that answer, in canonical form, is not the `none` sentinel.
  // Today `None` breaks it in the dangerous direction: the probe answered,
  // canonical `none` resolves advisory, yet the resolver returns blocking.
  for (const written of RUN_CMD_INPUTS) {
    test(`run_cmd: ${JSON.stringify(written)} — probe verdict and resolver verdict cannot disagree`, async () => {
      const answered = await probeAnswered(written);
      const expected = answered && (await resolverBlocking(canonical(written)));
      expect(await resolverBlocking(written)).toBe(expected);
    });
  }
});
