import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// STE-342 — image-capture step in /spec-write (the sole persister) and
// /brainstorm (capture + classify + hand-off, never writes). These are
// PROSE-CONTRACT meta-tests over the two SKILL.md surfaces (modelled on
// tests/brainstorm-doc-conformance.test.ts and the /spec-write § 0b slice
// helper used in tests/design-references-convention.test.ts). The deep
// slug/collision behaviour is unit-tested separately in
// adapters/_shared/src/design_asset_slug.test.ts.

const pluginRoot = join(import.meta.dir, "..");
const specWritePath = join(pluginRoot, "skills", "spec-write", "SKILL.md");
const brainstormPath = join(pluginRoot, "skills", "brainstorm", "SKILL.md");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

/**
 * Slice § 0b (FR creation path) out of /spec-write SKILL.md so the capture-step
 * assertions are scoped to the body-section contract, not the whole file
 * (the file mentions AskUserQuestion elsewhere — first-turn block + Rules —
 * which must NOT satisfy a § 0b capture-step assertion).
 */
function specWriteSection0b(body: string): string {
  const start = body.indexOf("### 0b. FR creation path");
  const end = body.indexOf("### 1. Assess current state");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return body.slice(start, end);
}

describe("STE-342 — capture step in /spec-write + /brainstorm", () => {
  test("AC-STE-342.1 — /spec-write § 0b documents classify → save → reference (AskUserQuestion, default per-feature, designAssetTargetPath, ## Design References)", () => {
    const sec0b = specWriteSection0b(read(specWritePath));

    // (a) Classification asked via AskUserQuestion (the § 0b slice — not the
    // file's first-turn block — must carry it; it is absent today).
    expect(sec0b).toContain("AskUserQuestion");

    // (b) The two classifications are named, with per-feature the default.
    expect(sec0b).toMatch(/durable/i);
    expect(sec0b).toMatch(/per[- ]feature/i);
    expect(sec0b).toMatch(
      /default[\s\S]{0,60}per[- ]feature|per[- ]feature[\s\S]{0,60}(is\s+(the\s+)?)?default/i,
    );

    // (c) Save target uses the deterministic helper + both subtrees are named.
    expect(sec0b).toContain("designAssetTargetPath");
    expect(sec0b).toContain("specs/design/system/");
    expect(sec0b).toContain("specs/design/frs/");

    // (d) The <id> for the per-feature folder is the FR filename stem.
    expect(sec0b).toMatch(/filenameFor/);

    // (e) The reference lands in the (auto-created-after-AC) section.
    expect(sec0b).toContain("## Design References");
    expect(sec0b).toContain("## Acceptance Criteria");
  });

  test("AC-STE-342.2 — /brainstorm captures + classifies + threads into hand-off, writes nothing itself, lists images in standalone summary", () => {
    const body = read(brainstormPath);

    // (a) A design-image capture step exists (bare 'captur' already appears
    // for gist-context capture, so require it co-located with design/image).
    expect(body).toMatch(
      /design[- ]image|image[\s\S]{0,40}captur|captur[\s\S]{0,40}(image|mockup|screenshot|design)/i,
    );

    // (b) It classifies durable vs per-feature.
    expect(body).toMatch(/classif/i);
    expect(body).toMatch(/durable/i);
    expect(body).toMatch(/per[- ]feature/i);

    // (c) The {path, classification, caption} records thread into the Step 4
    // hand-off to /spec-write (the literal record shape pins the contract).
    const recordMatch = body.match(
      /\{\s*path\s*,\s*classification\s*,\s*caption\s*\}/,
    );
    expect(recordMatch).not.toBeNull();
    const recordIdx = body.indexOf(recordMatch![0]);
    const recordWindow = body.slice(
      Math.max(0, recordIdx - 400),
      recordIdx + 400,
    );
    expect(recordWindow).toMatch(/Step 4|hand[- ]?off/i);

    // (d) No-write contract intact: brainstorm does NOT write the image /
    // markdown itself; /spec-write is the persister. (Distinct from the
    // existing global "Do NOT write code or spec content" rule — this names
    // the image/markdown + names /spec-write as the writer.)
    expect(body).toMatch(
      /(does not|never|do not)[\s\S]{0,60}writ[\s\S]{0,60}(image|markdown|file)/i,
    );
    expect(body).toMatch(
      /\/(dev-process-toolkit:)?spec-write[\s\S]{0,80}(persist|writes|saves)/i,
    );

    // (e) Standalone /brainstorm lists the captured images in its closing
    // summary so they can be re-supplied at /spec-write time.
    expect(body).toMatch(
      /standalone[\s\S]{0,200}(closing )?summary[\s\S]{0,160}(image|captur)|closing summary[\s\S]{0,160}(image|captur|design)/i,
    );
  });

  test("AC-STE-342.3 — /spec-write § 0b sequences per-feature capture AFTER FR-id allocation (Provider.sync / mintId)", () => {
    const sec0b = specWriteSection0b(read(specWritePath));

    // The capture step references the deterministic helper (new in STE-342);
    // its position marks where capture happens in the § 0b ordering.
    const captureIdx = sec0b.indexOf("designAssetTargetPath");
    expect(captureIdx).toBeGreaterThan(-1);

    // The allocation call site is step 4's `Provider.sync(spec)` ("no-op in
    // `LocalProvider`…" is unique to that line). Capture must come AFTER it.
    const allocIdx = sec0b.indexOf("no-op in");
    expect(allocIdx).toBeGreaterThan(-1);
    expect(captureIdx).toBeGreaterThan(allocIdx);

    // Prose states the after-allocation ordering for per-feature images
    // ("per-feature" is new to § 0b, so this cannot false-green on old prose).
    expect(sec0b).toMatch(
      /per[- ]feature[\s\S]{0,400}(after|once)[\s\S]{0,200}(Provider\.sync|mintId|allocat|FR[- ]?id)/i,
    );

    // …never against a <tracker-id> placeholder.
    expect(sec0b).toMatch(/<tracker-id>/);

    // Durable images carry no FR-id dependency, so they may persist before
    // allocation — the carve-out the capture step must state.
    expect(sec0b).toMatch(
      /durable[\s\S]{0,240}(before|as soon as|prior to|immediately|once[\s\S]{0,30}classif|without[\s\S]{0,30}allocat)/i,
    );
  });

  test("AC-STE-342.4 — § 0b capture prose: repo-root-relative + probe-resolvable + deterministic helper-derived slug with collision suffix", () => {
    const sec0b = specWriteSection0b(read(specWritePath));

    // Paths are repo-root-relative (byte-identical to STE-343's probe).
    expect(sec0b).toMatch(/repo[- ]root[- ]relative/i);

    // …and resolve on disk to the saved file (probe-resolvable contract).
    expect(sec0b).toMatch(
      /resolv[\s\S]{0,40}(on disk|to the (saved|just-saved) file)|probe[- ]?resolv/i,
    );

    // The slug is derived via the deterministic helper (kebab, ext preserved).
    expect(sec0b).toMatch(/designAssetSlug|designAssetTargetPath/);

    // …with a numeric collision suffix on a same-folder name clash.
    expect(sec0b).toMatch(/collision[\s\S]{0,80}(suffix|-2|numeric)|numeric[\s\S]{0,40}suffix/i);
  });
});
