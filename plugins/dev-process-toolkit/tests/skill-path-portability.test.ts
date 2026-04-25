import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SKILLS_DIR = join(import.meta.dir, "..", "skills");
const DOCS_DIR = join(import.meta.dir, "..", "docs");

function listSkillMds(): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(SKILLS_DIR)) {
    const skillPath = join(SKILLS_DIR, entry);
    if (!statSync(skillPath).isDirectory()) continue;
    const mdPath = join(skillPath, "SKILL.md");
    try {
      statSync(mdPath);
      out.push(mdPath);
    } catch {
      /* no SKILL.md in this dir */
    }
  }
  return out;
}

function listDocsMds(): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(DOCS_DIR)) {
    const full = join(DOCS_DIR, entry);
    if (!statSync(full).isFile()) continue;
    if (!entry.endsWith(".md")) continue;
    out.push(full);
  }
  return out;
}

describe("skill-path-portability (AC-STE-53.1, AC-STE-53.3)", () => {
  const skillMdFiles = listSkillMds();

  it("finds SKILL.md files to inspect", () => {
    expect(skillMdFiles.length).toBeGreaterThan(0);
  });

  it.each(skillMdFiles)(
    "every `bun run adapters/` invocation in %s uses ${CLAUDE_PLUGIN_ROOT}/",
    (mdPath) => {
      const contents = readFileSync(mdPath, "utf8");
      const lines = contents.split("\n");
      const offenders: string[] = [];
      lines.forEach((line, idx) => {
        const needle = "bun run adapters/";
        const i = line.indexOf(needle);
        if (i < 0) return;
        // Narrative matches are guarded by the literal string "bun run " —
        // only invocation-context lines contain it. AC-STE-53.2 allows bare
        // narrative paths but not bare `bun run` invocations.
        const before = line.slice(Math.max(0, i - "${CLAUDE_PLUGIN_ROOT}/".length), i);
        if (!before.includes("${CLAUDE_PLUGIN_ROOT}/")) {
          offenders.push(`${idx + 1}: ${line.trim()}`);
        }
      });
      if (offenders.length > 0) {
        throw new Error(
          `Found bare \`bun run adapters/...\` invocation(s) in ${mdPath} — must use \`bun run \${CLAUDE_PLUGIN_ROOT}/adapters/...\`:\n${offenders.join("\n")}`,
        );
      }
    },
  );

  const docsMdFiles = listDocsMds();

  it("finds docs/*.md files to inspect (STE-100 AC-STE-100.3 scope)", () => {
    expect(docsMdFiles.length).toBeGreaterThan(0);
  });

  it.each(docsMdFiles)(
    "every `bun run adapters/` invocation in %s uses ${CLAUDE_PLUGIN_ROOT}/",
    (mdPath) => {
      const contents = readFileSync(mdPath, "utf8");
      const lines = contents.split("\n");
      const offenders: string[] = [];
      lines.forEach((line, idx) => {
        const needle = "bun run adapters/";
        const i = line.indexOf(needle);
        if (i < 0) return;
        const before = line.slice(Math.max(0, i - "${CLAUDE_PLUGIN_ROOT}/".length), i);
        if (!before.includes("${CLAUDE_PLUGIN_ROOT}/")) {
          offenders.push(`${idx + 1}: ${line.trim()}`);
        }
      });
      if (offenders.length > 0) {
        throw new Error(
          `Found bare \`bun run adapters/...\` invocation(s) in ${mdPath} — must use \`bun run \${CLAUDE_PLUGIN_ROOT}/adapters/...\`:\n${offenders.join("\n")}`,
        );
      }
    },
  );

  it("detects a deliberate regression in a synthetic fixture string", () => {
    // Guards the detector itself: if someone swaps the needle, this fails.
    const synthetic = "Example: run `bun run adapters/_shared/src/x.ts` here.";
    const needle = "bun run adapters/";
    const i = synthetic.indexOf(needle);
    expect(i).toBeGreaterThan(-1);
    const before = synthetic.slice(Math.max(0, i - "${CLAUDE_PLUGIN_ROOT}/".length), i);
    expect(before.includes("${CLAUDE_PLUGIN_ROOT}/")).toBe(false);

    const fixed = "Example: run `bun run ${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/x.ts` here.";
    const j = fixed.indexOf(needle);
    const beforeFixed = fixed.slice(Math.max(0, j - "${CLAUDE_PLUGIN_ROOT}/".length), j);
    expect(beforeFixed.includes("${CLAUDE_PLUGIN_ROOT}/")).toBe(true);
  });
});
