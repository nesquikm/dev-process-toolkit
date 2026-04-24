import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ensureCanonicalLayout,
  type DocsConfig,
} from "../adapters/_shared/src/docs_layout";
import { validateNavContract } from "../adapters/_shared/src/docs_nav_contract";

// Integration guard for STE-69 — the shipped `docs-README.md.template`
// must satisfy `validateNavContract` when seeded into a fresh tree. If a
// contributor edits the template and accidentally drops an anchor, adds
// an extra `##`-level heading, or breaks a relative link, this test
// fails before the drift reaches a downstream project's `/gate-check`.

const pluginRoot = join(import.meta.dir, "..");
const templatesDir = join(pluginRoot, "templates");

let work: string;
let projectRoot: string;

const modes: Array<{ name: string; cfg: DocsConfig }> = [
  {
    name: "user-facing only",
    cfg: { userFacingMode: true, packagesMode: false, changelogCiOwned: false },
  },
  {
    name: "packages only",
    cfg: { userFacingMode: false, packagesMode: true, changelogCiOwned: false },
  },
  {
    name: "mixed",
    cfg: { userFacingMode: true, packagesMode: true, changelogCiOwned: false },
  },
];

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "dpt-tpl-nav-"));
  projectRoot = join(work, "project");
  mkdirSync(projectRoot, { recursive: true });
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

describe("shipped docs-README.md.template satisfies validateNavContract", () => {
  for (const { name, cfg } of modes) {
    test(`${name} mode — seeded tree passes nav contract`, () => {
      ensureCanonicalLayout(projectRoot, cfg, templatesDir);
      const result = validateNavContract(join(projectRoot, "docs/README.md"));
      if (!result.ok) {
        throw new Error(`nav contract violated: ${result.reason}`);
      }
      expect(result.ok).toBe(true);
    });
  }
});
