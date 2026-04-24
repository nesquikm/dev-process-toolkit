import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripUlidFromArchive } from "./strip_ulid";

// STE-86 AC-STE-86.4 — unit tests for the one-shot migration tool.
// Covers: happy path, idempotency, malformed, missing, frontmatter-only,
// NFC-normalized paths.

function mktmp(): string {
  return mkdtempSync(join(tmpdir(), "dpt-stripulid-"));
}

const VALID_FR = `---
id: fr_01KPZT34RG57FE0S0AK4QWHH3Q
title: Example FR
milestone: M21
status: archived
archived_at: 2026-04-24T00:00:00Z
tracker:
  linear: STE-86
created_at: 2026-04-24T00:00:00Z
---

## Requirement

Body content here.
`;

const STRIPPED_FR = `---
title: Example FR
milestone: M21
status: archived
archived_at: 2026-04-24T00:00:00Z
tracker:
  linear: STE-86
created_at: 2026-04-24T00:00:00Z
---

## Requirement

Body content here.
`;

describe("STE-86 AC-STE-86.1/2 — stripUlidFromArchive export + line removal", () => {
  test("happy path: dry-run reports modified without writing", async () => {
    const dir = mktmp();
    try {
      const path = join(dir, "STE-86.md");
      writeFileSync(path, VALID_FR);
      const summary = await stripUlidFromArchive(dir, { dryRun: true });
      expect(summary.modified).toEqual([path]);
      expect(summary.skipped).toEqual([]);
      expect(summary.errors).toEqual([]);
      expect(readFileSync(path, "utf-8")).toBe(VALID_FR);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("happy path: write-mode removes the id line byte-identically otherwise", async () => {
    const dir = mktmp();
    try {
      const path = join(dir, "STE-86.md");
      writeFileSync(path, VALID_FR);
      const summary = await stripUlidFromArchive(dir, { dryRun: false });
      expect(summary.modified).toEqual([path]);
      expect(summary.skipped).toEqual([]);
      expect(summary.errors).toEqual([]);
      expect(readFileSync(path, "utf-8")).toBe(STRIPPED_FR);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("STE-86 AC-STE-86.3 — idempotency", () => {
  test("second run reports every file as skipped", async () => {
    const dir = mktmp();
    try {
      const path = join(dir, "STE-86.md");
      writeFileSync(path, VALID_FR);
      const first = await stripUlidFromArchive(dir, { dryRun: false });
      expect(first.modified).toEqual([path]);
      const second = await stripUlidFromArchive(dir, { dryRun: false });
      expect(second.modified).toEqual([]);
      expect(second.skipped).toEqual([path]);
      expect(second.errors).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("STE-86 AC-STE-86.2 — malformed id line handling", () => {
  test("malformed short id reports error; no write in write-mode", async () => {
    const dir = mktmp();
    try {
      const path = join(dir, "broken.md");
      const bad = `---
id: fr_SHORT
title: Broken
tracker:
  linear: STE-999
---

body
`;
      writeFileSync(path, bad);
      const summary = await stripUlidFromArchive(dir, { dryRun: false });
      expect(summary.modified).toEqual([]);
      expect(summary.errors.length).toBe(1);
      expect(summary.errors[0]!.file).toBe(path);
      expect(summary.errors[0]!.reason).toMatch(/malformed/i);
      expect(readFileSync(path, "utf-8")).toBe(bad);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("non-fr prefix reports error", async () => {
    const dir = mktmp();
    try {
      const path = join(dir, "broken.md");
      const bad = `---
id: foo
title: Broken
tracker:
  linear: STE-999
---

body
`;
      writeFileSync(path, bad);
      const summary = await stripUlidFromArchive(dir, { dryRun: false });
      expect(summary.errors.length).toBe(1);
      expect(summary.errors[0]!.file).toBe(path);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("duplicate id lines report error", async () => {
    const dir = mktmp();
    try {
      const path = join(dir, "dup.md");
      const bad = `---
id: fr_01KPZT34RG57FE0S0AK4QWHH3Q
id: fr_01KPZT34RG57FE0S0AK4QWHH3Q
title: Dup
tracker:
  linear: STE-999
---

body
`;
      writeFileSync(path, bad);
      const summary = await stripUlidFromArchive(dir, { dryRun: false });
      expect(summary.errors.length).toBe(1);
      expect(summary.errors[0]!.reason).toMatch(/duplicate|multiple/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("STE-86 AC-STE-86.2 — missing id line is skipped not errored", () => {
  test("file with no id line reports skipped", async () => {
    const dir = mktmp();
    try {
      const path = join(dir, "no-id.md");
      writeFileSync(path, STRIPPED_FR);
      const summary = await stripUlidFromArchive(dir, { dryRun: false });
      expect(summary.modified).toEqual([]);
      expect(summary.skipped).toEqual([path]);
      expect(summary.errors).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("STE-86 AC-STE-86.4 — frontmatter-only (no body) edge case", () => {
  test("file with only frontmatter and no body still strips correctly", async () => {
    const dir = mktmp();
    try {
      const path = join(dir, "fm-only.md");
      const fmOnly = `---
id: fr_01KPZT34RG57FE0S0AK4QWHH3Q
title: Frontmatter only
tracker:
  linear: STE-999
---
`;
      const expected = `---
title: Frontmatter only
tracker:
  linear: STE-999
---
`;
      writeFileSync(path, fmOnly);
      const summary = await stripUlidFromArchive(dir, { dryRun: false });
      expect(summary.modified).toEqual([path]);
      expect(readFileSync(path, "utf-8")).toBe(expected);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("STE-86 AC-STE-86.4 — recursion + non-.md filtering + NFC paths", () => {
  test("walks subdirectories and skips non-md files", async () => {
    const dir = mktmp();
    try {
      const sub = join(dir, "sub");
      mkdirSync(sub);
      const inSub = join(sub, "STE-99.md");
      const nonMd = join(dir, "README.txt");
      writeFileSync(inSub, VALID_FR);
      writeFileSync(nonMd, "not markdown; has id: fr_XXX in it\n");
      const summary = await stripUlidFromArchive(dir, { dryRun: false });
      expect(summary.modified).toEqual([inSub]);
      expect(readFileSync(nonMd, "utf-8")).toBe("not markdown; has id: fr_XXX in it\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("NFC-normalized paths (macOS / Linux): filename with precomposed accents", async () => {
    const dir = mktmp();
    try {
      // Precomposed é (U+00E9) — NFC form. Files are addressed by the same
      // normalization on both platforms.
      const path = join(dir, "café.md");
      writeFileSync(path, VALID_FR);
      const summary = await stripUlidFromArchive(dir, { dryRun: false });
      expect(summary.modified.length).toBe(1);
      const written = summary.modified[0]!.normalize("NFC");
      expect(written).toBe(path.normalize("NFC"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("STE-86 — mode-none archives are skipped (bimodal-safety)", () => {
  // Tracker-mode FRs carry a non-empty `tracker:` binding; mode-none FRs
  // carry `tracker: {}`. The migration must not strip id: from mode-none
  // archives — mode-none identity IS the id:, and stripping it breaks
  // the bimodal invariant (NFR-15 Invariant #2, mode-scoped).

  const MODE_NONE_FR = `---
id: fr_01KPR3M74XA75GJKT4Z4HG95TH
title: Legacy mode-none archived FR
milestone: M1
status: archived
archived_at: 2026-04-09T00:00:00Z
tracker: {}
created_at: 2026-04-21T13:28:11.653Z
---

Body.
`;

  test("mode-none archive (tracker: {}) is skipped, not modified", async () => {
    const dir = mktmp();
    try {
      const path = join(dir, "HG95TH.md");
      writeFileSync(path, MODE_NONE_FR);
      const summary = await stripUlidFromArchive(dir, { dryRun: false });
      expect(summary.modified).toEqual([]);
      expect(summary.skipped).toEqual([path]);
      expect(summary.errors).toEqual([]);
      // Byte-identical preservation (mode-none regression — AC-STE-76.8).
      expect(readFileSync(path, "utf-8")).toBe(MODE_NONE_FR);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("tracker-mode archive (tracker: <key>: <id>) is modified as expected", async () => {
    const dir = mktmp();
    try {
      const path = join(dir, "STE-1.md");
      writeFileSync(path, VALID_FR);
      const summary = await stripUlidFromArchive(dir, { dryRun: false });
      expect(summary.modified).toEqual([path]);
      expect(readFileSync(path, "utf-8")).toBe(STRIPPED_FR);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("STE-86 AC-STE-86.2 — atomicity on error (no partial writes)", () => {
  test("when one file errors, no files are modified on disk", async () => {
    const dir = mktmp();
    try {
      const ok = join(dir, "ok.md");
      const bad = join(dir, "bad.md");
      writeFileSync(ok, VALID_FR);
      writeFileSync(
        bad,
        `---
id: fr_SHORT
title: Bad
tracker:
  linear: STE-999
---

body
`,
      );
      const summary = await stripUlidFromArchive(dir, { dryRun: false });
      expect(summary.errors.length).toBe(1);
      // All-or-nothing: a file that errors leaves everything unwritten.
      expect(summary.modified).toEqual([]);
      expect(readFileSync(ok, "utf-8")).toBe(VALID_FR);
      expect(readFileSync(bad, "utf-8")).toMatch(/id: fr_SHORT/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
