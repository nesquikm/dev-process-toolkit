import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SHIP_CEREMONY_RECIPE } from "../adapters/_shared/src/plan_ship_coherence";

// M99 STE-370 — post-merge ceremony surfacing: grep-based prose pins.
//
// AC-STE-370.1 — /pr gains a SOFT ship-state pre-flight between
//   `## Tracker Mode Probe` and `## Steps`: archive-path moves in
//   `git diff main...HEAD --name-status` minus a `chore(release):` marker
//   in `git log main..HEAD` ⇒ exact prompt `[m]erge later / [s]hip first
//   / [a]bort`. Never auto-blocks; no-archive-move branches (spec-only
//   PRs included) see no prompt. Negative pin: no hard-refusal wording
//   (`refuse` / `GATE FAILED`) inside the pre-flight block.
// AC-STE-370.2 — choosing `m` injects `Follow-up: /ship-milestone M<N>`
//   into the PR body per affected milestone.
// AC-STE-370.3 — bare /ship-milestone with zero `status: active` plans
//   offers archived-unstamped-unparked milestones newest-first via
//   `Unshipped archived milestone M<N> — ship it? [y/N]`; decline
//   preserves today's refusal text + exit code.
// AC-STE-370.4 — post-ship off-trunk opt-in `Open ceremony PR via /pr
//   now? (y/n):`; `y` chains /pr in-process with all gates intact
//   (/ship-milestone itself still never pushes); decline hint `Run: /pr`;
//   chain-start failure ⇒ NFR-10 canonical refusal.
// AC-STE-370.5 — docs/ship-milestone-reference.md gains `## Post-merge
//   ceremony` mirroring SHIP_CEREMONY_RECIPE verbatim (the shared recipe
//   string from plan_ship_coherence.ts), fresh-branch-off-main framing,
//   and the STE-210 + STE-228 already-archived support note.
//   (Runtime leg — one real end-to-end ceremony — ships `[~]`; not
//   testable here.)

const pluginRoot = join(import.meta.dir, "..");
const prSkillPath = join(pluginRoot, "skills", "pr", "SKILL.md");
const shipSkillPath = join(pluginRoot, "skills", "ship-milestone", "SKILL.md");
const docsRefPath = join(pluginRoot, "docs", "ship-milestone-reference.md");

const readPr = (): string => readFileSync(prSkillPath, "utf8");
const readShip = (): string => readFileSync(shipSkillPath, "utf8");
const readDocsRef = (): string => readFileSync(docsRefPath, "utf8");

// The five exact-format strings under pin (AC-numbered; byte-exact).
const PREFLIGHT_PROMPT = "[m]erge later / [s]hip first / [a]bort"; // AC-370.1
const SHIP_FIRST_HINT = "Run /ship-milestone M<N>, then re-run /pr"; // AC-370.1
const FOLLOW_UP_LINE = "Follow-up: /ship-milestone M<N>"; // AC-370.2
const DEBT_OFFER_PROMPT = "Unshipped archived milestone M<N> — ship it? [y/N]"; // AC-370.3
const CHAIN_PROMPT = "Open ceremony PR via /pr now? (y/n):"; // AC-370.4
const CHAIN_DECLINE_HINT = "Run: /pr"; // AC-370.4

/**
 * Slice the enclosing markdown section (`## ` or `### ` fenced) that
 * contains `needle`. Fails the test if the needle is absent — every
 * windowed assertion below therefore doubles as a presence pin.
 */
function headingWindow(body: string, needle: string): string {
  const at = body.indexOf(needle);
  expect(at).toBeGreaterThan(-1);
  const start = Math.max(body.lastIndexOf("\n## ", at), body.lastIndexOf("\n### ", at), 0);
  const nexts = [body.indexOf("\n## ", at), body.indexOf("\n### ", at)].filter((i) => i > -1);
  const end = nexts.length > 0 ? Math.min(...nexts) : body.length;
  return body.slice(start, end);
}

describe("AC-STE-370.1 — /pr ship-state pre-flight (soft)", () => {
  test("pre-flight prompt is byte-exact and sits between Tracker Mode Probe and Steps", () => {
    const body = readPr();
    const promptAt = body.indexOf(PREFLIGHT_PROMPT);
    expect(promptAt).toBeGreaterThan(-1);
    expect(promptAt).toBeGreaterThan(body.indexOf("## Tracker Mode Probe"));
    expect(promptAt).toBeLessThan(body.indexOf("## Steps"));
  });

  test("detection is tree-based: git diff main...HEAD --name-status over the two archive paths", () => {
    const block = headingWindow(readPr(), PREFLIGHT_PROMPT);
    expect(block).toContain("git diff main...HEAD --name-status");
    expect(block).toContain("specs/plan/archive/");
    expect(block).toContain("specs/frs/archive/");
  });

  test("release-marker check: a chore(release) commit in git log main..HEAD suppresses the prompt", () => {
    const block = headingWindow(readPr(), PREFLIGHT_PROMPT);
    expect(block).toContain("git log main..HEAD");
    expect(block).toContain("chore(release");
  });

  test("`s` exits with zero side effects and the exact re-run hint", () => {
    const block = headingWindow(readPr(), PREFLIGHT_PROMPT);
    expect(block).toContain(SHIP_FIRST_HINT);
    expect(block).toMatch(/zero side effects/i);
  });

  test("branches with no archive moves (spec-only PRs included) see no prompt at all", () => {
    const block = headingWindow(readPr(), PREFLIGHT_PROMPT);
    expect(block).toMatch(/spec-only/i);
    expect(block).toMatch(/no prompt/i);
  });

  test("the pre-flight never auto-blocks", () => {
    const block = headingWindow(readPr(), PREFLIGHT_PROMPT);
    expect(block).toMatch(/never (auto-)?block/i);
  });

  test("NEGATIVE: no hard-refusal wording (refuse / GATE FAILED) inside the pre-flight block", () => {
    const block = headingWindow(readPr(), PREFLIGHT_PROMPT);
    expect(block).not.toMatch(/refuse|GATE FAILED/i);
  });
});

describe("AC-STE-370.2 — PR-body follow-up stamp on `m`", () => {
  test("the Follow-up line shape is byte-exact in the /pr skill", () => {
    expect(readPr()).toContain(FOLLOW_UP_LINE);
  });

  test("the line is injected into the PR body, one per affected milestone", () => {
    const window = headingWindow(readPr(), FOLLOW_UP_LINE);
    expect(window).toMatch(/PR body/i);
    expect(window).toMatch(/each affected milestone|per affected milestone/i);
  });
});

describe("AC-STE-370.3 — /ship-milestone ship-debt offer", () => {
  test("debt-offer prompt is byte-exact in ship-milestone SKILL.md", () => {
    expect(readShip()).toContain(DEBT_OFFER_PROMPT);
  });

  test("offer triggers on the no-arg form when zero plans are status: active", () => {
    const window = headingWindow(readShip(), DEBT_OFFER_PROMPT);
    expect(window).toContain("status: active");
    expect(window).toMatch(/no-arg|no argument|bare/i);
  });

  test("candidates are archived plans lacking shipped_in and not parked, newest-first", () => {
    const window = headingWindow(readShip(), DEBT_OFFER_PROMPT);
    expect(window).toContain("shipped_in");
    // Literal key pin: the parked opt-out must name STE-369's exact
    // frontmatter predicate, not a paraphrase (caught drift: `parked: true`).
    expect(window).toContain("ship_state: parked");
    expect(window).toMatch(/newest-first|archived_at[\s\S]{0,60}descending|descending/i);
  });

  test("decline preserves today's refusal text and exit code", () => {
    const window = headingWindow(readShip(), DEBT_OFFER_PROMPT);
    expect(window).toMatch(/decline/i);
    expect(window).toMatch(/refus/i);
  });
});

describe("AC-STE-370.4 — opt-in /pr chain after the release commit", () => {
  test("chain prompt is byte-exact in ship-milestone SKILL.md", () => {
    expect(readShip()).toContain(CHAIN_PROMPT);
  });

  test("fires only after a successful release commit landing off-trunk", () => {
    const window = headingWindow(readShip(), CHAIN_PROMPT);
    expect(window).toMatch(/off-trunk/i);
    expect(window).toMatch(/release commit|commit (lands|succeeds)/i);
  });

  test("`y` chains /pr in-process with all /pr gates intact", () => {
    const window = headingWindow(readShip(), CHAIN_PROMPT);
    expect(window).toMatch(/in-process/i);
    expect(window).toMatch(/gates?[\s\S]{0,80}intact|intact[\s\S]{0,80}gates?/i);
  });

  test("/ship-milestone itself still never pushes — the chain does not erode the invariant", () => {
    const window = headingWindow(readShip(), CHAIN_PROMPT);
    expect(window).toMatch(/never push|does not push|still never pushes|push remains/i);
  });

  test("decline prints the exact hint `Run: /pr`", () => {
    const window = headingWindow(readShip(), CHAIN_PROMPT);
    expect(window).toContain(CHAIN_DECLINE_HINT);
  });

  test("chain-start failure surfaces the NFR-10 canonical refusal", () => {
    const window = headingWindow(readShip(), CHAIN_PROMPT);
    expect(window).toMatch(/NFR-10/);
  });
});

describe("AC-STE-370.5 — Post-merge ceremony recipe docs", () => {
  function postMergeSection(): string {
    const body = readDocsRef();
    const at = body.indexOf("## Post-merge ceremony");
    expect(at).toBeGreaterThan(-1);
    const end = body.indexOf("\n## ", at);
    return body.slice(at, end > -1 ? end : body.length);
  }

  test("docs/ship-milestone-reference.md carries the `## Post-merge ceremony` heading", () => {
    expect(readDocsRef()).toContain("## Post-merge ceremony");
  });

  test("the section mirrors SHIP_CEREMONY_RECIPE verbatim (shared string from plan_ship_coherence.ts)", () => {
    const section = postMergeSection();
    for (const line of SHIP_CEREMONY_RECIPE.split("\n")) {
      expect(section).toContain(line);
    }
  });

  test("recipe starts from a fresh branch off main and ends with the chained /pr", () => {
    const section = postMergeSection();
    expect(section).toMatch(/fresh branch off main|branch off `?main`?/i);
    expect(section).toMatch(/chain(ed)? `?\/pr`?/i);
  });

  test("already-archived case documented as supported today via STE-210 fallback + STE-228 no-op", () => {
    const section = postMergeSection();
    expect(section).toContain("STE-210");
    expect(section).toContain("STE-228");
    expect(section).toMatch(/already[- ]archived/i);
  });
});

describe("STE-370 — NFR-1 pressure point stays green on the edited skills", () => {
  // Redundant with skill-nfr-1-length.test.ts's all-skills loop, but pinned
  // here explicitly per FR § Testing: ship-milestone SKILL.md is the NFR-1
  // pressure point for this FR — detail overflows to
  // docs/ship-milestone-reference.md, never past the 351-line cap.
  const SKILL_LINE_CAP = 351;

  test.each([
    ["pr", prSkillPath],
    ["ship-milestone", shipSkillPath],
  ])("%s/SKILL.md is ≤ 351 lines", (_name, path) => {
    expect(readFileSync(path as string, "utf8").split("\n").length).toBeLessThanOrEqual(
      SKILL_LINE_CAP,
    );
  });
});
