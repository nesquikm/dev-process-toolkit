import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// FR-65 AC-65.5 conformance — the three resolver-calling skills must
// instruct "call buildResolverConfig once at entry, pass result to
// resolveFRArgument" instead of telling skill authors to hand-assemble
// a ResolverConfig inline. Removing the buildResolverConfig reference
// from any of these SKILL.md files regresses AC-65.5.

const pluginRoot = join(import.meta.dir, "..");
const RESOLVER_CALLERS = ["spec-write", "implement", "spec-archive"] as const;

function readSkill(name: string): string {
  return readFileSync(join(pluginRoot, "skills", name, "SKILL.md"), "utf8");
}

describe("FR-65 AC-65.5 — resolver-calling skills reference buildResolverConfig", () => {
  for (const skill of RESOLVER_CALLERS) {
    test(`${skill}: SKILL.md instructs calling buildResolverConfig before resolveFRArgument`, () => {
      const body = readSkill(skill);
      expect(body).toContain("buildResolverConfig");
    });
  }
});
