import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// STE-252 AC-STE-252.3 + AC-STE-252.6 — prose contracts for the new
// permission-hardening posture in the project-local skills.
//
// AC-STE-252.3: /conformance-loop Phase 0 carries a pre-flight step
//   that reads `.claude/settings.json`, JSON-parses it, asserts
//   `.permissions.allow` is a non-empty array. Miss → NFR-10 canonical
//   refusal naming the file + remedy. Hit → log
//   `permissions_allow_present` and proceed.
//
// AC-STE-252.6: threat-model prose updates to the new posture —
//   tracked `permissions.allow` is the per-tool-call enforcement
//   mechanism; the realpath cwd allow-list (`/smoke-test` pre-flight
//   #6) stays but no longer "justifies bypassPermissions".

const repoRoot = join(import.meta.dir, "..", "..", "..");
const conformanceLoopPath = join(
  repoRoot,
  ".claude",
  "skills",
  "conformance-loop",
  "SKILL.md",
);
const smokeTestPath = join(repoRoot, ".claude", "skills", "smoke-test", "SKILL.md");

function readIfPresent(p: string): string | null {
  if (!existsSync(p)) return null;
  return readFileSync(p, "utf8");
}

const cl = readIfPresent(conformanceLoopPath);
const st = readIfPresent(smokeTestPath);

const describeConformance = cl === null ? describe.skip : describe;
const describeSmoke = st === null ? describe.skip : describe;

describeConformance(
  "AC-STE-252.3 — /conformance-loop Phase 0 pre-flight on .permissions.allow",
  () => {
    test("Phase 0 pre-flight section names `.claude/settings.json` and `.permissions.allow`", () => {
      const body = cl!;
      // The pre-flight is documented in Phase 0 (the operator-approval
      // gate runs before any spawn). Locate the Phase 0 heading and
      // assert the new pre-flight prose lives within it OR within the
      // dedicated `## Pre-flight refusals` section that already exists.
      const phase0 = body.indexOf("Phase 0");
      const preflight = body.indexOf("Pre-flight");
      expect(Math.max(phase0, preflight)).toBeGreaterThan(-1);
      expect(body).toContain(".claude/settings.json");
      // Must mention the JSON-parse + non-empty-array assertion shape.
      expect(body).toMatch(/permissions\.allow/);
      expect(body).toMatch(/non-empty|length\s*>\s*0|length > 0/i);
    });

    test("pre-flight refusal carries NFR-10 canonical shape (Refused / Remedy / Context)", () => {
      const body = cl!;
      // The refusal block must name the file + remedy (populate the
      // allow-list) per the technical-design § Phase 0 pre-flight
      // worked-example. Style is the established NFR-10 shape used by
      // the other (a)–(e) refusals in the same skill.
      expect(body).toMatch(
        /permissions\.allow[\s\S]{0,400}(empty|missing)[\s\S]{0,400}\.claude\/settings\.json/i,
      );
      expect(body).toMatch(/Remedy:[\s\S]{0,400}allow-list|allowlist|permissions\.allow/i);
      expect(body).toMatch(/Context:[\s\S]{0,400}skill=conformance-loop/);
      expect(body).toMatch(/permissions_allow_check|permissions_allow/);
    });

    test("pre-flight hit-path emits the `permissions_allow_present` log token", () => {
      const body = cl!;
      // Capability-row token convention: a literal byte-checkable string
      // that downstream gate-checks / smoke probes can grep for. Same
      // shape as `spec_write_draft_default_applied` etc.
      expect(body).toContain("permissions_allow_present");
    });

    test("pre-flight runs BEFORE any `claude -p` spawn (sequencing constraint)", () => {
      const body = cl!;
      // The pre-flight is named as a Phase 0 step; the Phase A spawn
      // reference snippet must appear AFTER the Phase 0 pre-flight
      // mention (file order = execution order in the skill prose).
      const preflightIdx = body.search(/permissions\.allow[\s\S]{0,200}(non-empty|length)/i);
      const firstSpawnIdx = body.search(/```bash[\s\S]{0,800}claude\s+-p\b/);
      expect(preflightIdx).toBeGreaterThan(-1);
      expect(firstSpawnIdx).toBeGreaterThan(-1);
      expect(preflightIdx).toBeLessThan(firstSpawnIdx);
    });
  },
);

describeConformance(
  "AC-STE-252.6 — /conformance-loop threat-model paragraph updated to the new posture",
  () => {
    test("the path-safety paragraph (~L171) names tracked `permissions.allow` as the per-tool enforcement mechanism", () => {
      const body = cl!;
      // The "Path-safety guard delegated to children" paragraph (formerly
      // arguing the realpath cwd-scope justifies bypassPermissions) must
      // now name `permissions.allow` as the per-tool-call enforcement
      // and clarify the realpath check stays as a cwd guard, not a
      // bypass justification.
      expect(body).toMatch(/Path-safety[\s\S]{0,1200}permissions\.allow/);
      expect(body).toMatch(/permissions\.allow[\s\S]{0,600}(per-tool|allow-list|enforcement)/i);
    });

    test("/conformance-loop prose no longer claims the realpath check `justifies bypassPermissions`", () => {
      const body = cl!;
      // The legacy phrase was "scopes bypassPermissions" / "justifies
      // bypassPermissions". The new posture removes the bypass entirely,
      // so neither phrase should appear in the threat-model area.
      expect(body).not.toMatch(/justif(?:y|ies|ied)\s+bypassPermissions/i);
      expect(body).not.toMatch(/scopes\s+bypassPermissions/i);
    });
  },
);

describeSmoke(
  "AC-STE-252.6 — /smoke-test threat-model section updated to the new posture",
  () => {
    test("threat-model section near L1024 names `permissions.allow` as the per-tool enforcement mechanism", () => {
      const body = st!;
      const threatIdx = body.indexOf("## Threat model");
      expect(threatIdx).toBeGreaterThan(-1);
      const tail = body.slice(threatIdx);
      const next = tail.search(/\n## \S/);
      const block = next === -1 ? tail : tail.slice(0, next);
      expect(block).toMatch(/permissions\.allow/);
      expect(block).toMatch(/permissions\.allow[\s\S]{0,600}(per-tool|allow-list|enforcement|tracked)/i);
    });

    test("/smoke-test threat-model no longer leads with `bypassPermissions ... is a sharp combination`", () => {
      const body = st!;
      // The legacy paragraph opened with that phrase to justify the
      // bypass. The new posture removes the bypass, so the lead must
      // re-frame around the tracked allowlist. We assert the legacy
      // exact phrasing is gone.
      expect(body).not.toMatch(
        /bypassPermissions[\s\S]{0,80}sharp combination/i,
      );
    });

    test("realpath cwd-scoping pre-flight stays in prose (it remains as a cwd guard)", () => {
      const body = st!;
      // Per the spec § Notes: the realpath pre-flight (#6) stays. The
      // prose must still reference it; the change is only in the
      // *justification language*, not in the existence of the guard.
      expect(body).toMatch(/realpath/);
      expect(body).toMatch(/dpt-test-project-(linear|jira)/);
    });

    test("/smoke-test prose no longer claims pre-flight #6 `justifies bypassPermissions`", () => {
      const body = st!;
      // Mirrors the same falsified-phrase check on /conformance-loop.
      expect(body).not.toMatch(/justif(?:y|ies|ied)\s+bypassPermissions/i);
    });
  },
);
