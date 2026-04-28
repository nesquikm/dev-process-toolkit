// STE-147 — /spec-write Step 7 (Report) must not leak the toolkit's own
// internal AC identifiers (e.g., `AC-STE-118.4`) into user-facing summary
// prose. Project owners running /spec-write on their own repo see those
// IDs as opaque jargon — they only have meaning to toolkit maintainers
// reading the toolkit's own spec set. This is a doc-conformance probe
// asserting Step 7 carries (a) a hard "no toolkit-meta AC IDs in summary"
// instruction and (b) a static plain-language map keyed by capability
// name so the LLM has a substitute to render instead.
//
// Acceptance criteria:
//   AC-STE-147.1: § 7 prose forbids literal `AC-STE-<N>.<M>` toolkit-meta
//     references in the rendered summary block.
//   AC-STE-147.2: § 7 carries a static plain-language map keyed by
//     capability name (`milestone_attach_unavailable`, `tracker_sync_failed`,
//     etc.) so capability gaps surface as plain prose, not bare AC IDs.
//   AC-STE-147.3: § 7 prose distinguishes toolkit-meta AC IDs (scrubbed)
//     from user-authored AC IDs in the active project's FR markdown bodies
//     (passed through unchanged).
//   AC-STE-147.4: Test fixture covers the milestone-attach-no-op path —
//     asserts the rendered summary path described in § 7 contains no
//     `AC-STE-118` substring.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pluginRoot = join(import.meta.dir, "..");
const skillPath = join(pluginRoot, "skills", "spec-write", "SKILL.md");
const body = readFileSync(skillPath, "utf-8");

function step7Block(): string {
  const start = body.search(/\n### 7\. Report/);
  expect(start).toBeGreaterThan(-1);
  const tail = body.slice(start + 1);
  const endRel = tail.search(/\n## Rules\b/);
  return endRel === -1 ? body.slice(start) : body.slice(start, start + 1 + endRel);
}

describe("STE-147 AC-STE-147.1 — § 7 forbids toolkit-meta AC-STE-<N>.<M> in user-facing summary", () => {
  test("§ 7 prose explicitly forbids `AC-STE-<N>.<M>` literals in the summary block", () => {
    const block = step7Block().toLowerCase();
    // The block must carry a hard "no toolkit-meta AC IDs" instruction.
    expect(block).toMatch(/(no|never|do not|forbid|zero)[^\n]*toolkit/i);
    expect(block).toMatch(/ac-ste|ac-<n>|ac-<tracker>/i);
  });

  test("§ 7 prose names the smoke-test finding F1 origin (audit trail)", () => {
    expect(step7Block().toLowerCase()).toMatch(/finding f1|smoke-test|opaque jargon|paper cut/i);
  });
});

describe("STE-147 AC-STE-147.2 — § 7 provides a plain-language capability-gap map", () => {
  test("§ 7 prose carries a static plain-language map keyed by capability name", () => {
    const block = step7Block();
    expect(block.toLowerCase()).toMatch(/plain.language|plain prose|capability.*name|capability-keyed/);
  });

  test("§ 7 names the milestone-attach-no-op capability with a plain-language string", () => {
    const block = step7Block();
    // The map MUST include a milestone-attach entry, written as plain prose
    // (no toolkit AC-ID literal). The exact wording from the FR example is
    // recommended ("no Linear project milestones available — milestone-attach
    // skipped") but any plain-language phrase that omits the AC ID satisfies
    // the contract.
    expect(block.toLowerCase()).toMatch(/milestone[- ]attach/);
    expect(block.toLowerCase()).toMatch(/milestone_attach_unavailable|milestone-attach skipped|milestone-attach was a no-op|no linear project milestones/);
  });

  test("§ 7 names a second capability key (e.g., tracker_sync_failed) so the map is concrete, not theoretical", () => {
    const block = step7Block().toLowerCase();
    expect(block).toMatch(/tracker_sync_failed|tracker[- ]sync|sync failed|push_ac/);
  });
});

describe("STE-147 AC-STE-147.3 — user-authored AC IDs pass through unchanged", () => {
  test("§ 7 prose explicitly distinguishes toolkit-meta IDs from user-authored AC references", () => {
    const block = step7Block().toLowerCase();
    expect(block).toMatch(/user.authored|user.facing|active project|bound tracker|fr markdown/);
    expect(block).toMatch(/pass.through|preserved|unchanged|legitimate|not scrubbed/);
  });
});

describe("STE-147 AC-STE-147.4 — doc-conformance fixture covering milestone-attach-no-op path", () => {
  test("§ 7 prose carries no `AC-STE-118` substring (milestone-attach-no-op example does not echo the toolkit-meta ID)", () => {
    // The block as a whole may legitimately discuss STE-147 / AC-STE-147.x
    // (this FR's own ACs are user-authored at toolkit-author time), but the
    // milestone-attach-no-op example renderings inside § 7 must not include
    // `AC-STE-118` since that IS the toolkit-meta identifier under scrub.
    const block = step7Block();
    // Find the milestone-attach example region — the prose that demonstrates
    // the rendered output (capability-gap map applied).
    const milestoneRegion = block.toLowerCase();
    // The block should not contain any `AC-STE-118` literal at all — that's
    // the regression signal that the static-map convention is in force.
    expect(milestoneRegion).not.toMatch(/ac-ste-118/);
  });
});
