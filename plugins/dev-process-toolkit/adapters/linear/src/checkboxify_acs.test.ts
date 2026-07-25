// STE-416 (M114) — Linear push path emits AC task-list checkboxes.
//
// The Linear adapter writes acceptance criteria into the issue description
// as plain bullets. Linear renders a native, togglable checkbox only when
// the source line carries markdown task-list syntax, so the documented
// `pull_acs` / `push_ac_toggle` round-trip (adapters/linear.md § Operations)
// has no box to read and no box to flip.
//
// `checkboxifyLinearACs(body)` is the push-side transform that closes the
// gap: inside the `## Acceptance Criteria` section only, a plain bullet
// (`- <text>` / `* <text>`) becomes an unchecked checkbox (`- [ ] <text>`);
// an existing box keeps its state (`- [x]` is never reset to `- [ ]`), and
// every byte outside the section is left alone. It is a whole-body
// transform applied alongside `formatLinearDescription` on the create /
// upsert composition — NOT a section extractor, so a body with no AC
// section comes back byte-identical (contrast `normalize`, which returns
// the empty string in that case).
//
// Coverage: AC-STE-416.1 (emission + preservation + section scoping) and
// AC-STE-416.2 (the pull → toggle → pull round-trip the capabilities drive).

import { describe, expect, test } from "bun:test";
import {
  checkboxifyLinearACs,
  formatLinearDescription,
  stripLinearACFences,
} from "./format_description";
import { normalize } from "./normalize";

// ---------------------------------------------------------------------------
// AC-STE-416.1 — plain bullets inside the AC section become unchecked boxes
// ---------------------------------------------------------------------------

describe("AC-STE-416.1 — checkboxifyLinearACs emits unchecked task-list boxes", () => {
  test("a single plain dash bullet inside the AC section becomes `- [ ]`", () => {
    const body = "## Acceptance Criteria\n- AC-STE-416.1: first\n";
    expect(checkboxifyLinearACs(body)).toBe(
      "## Acceptance Criteria\n- [ ] AC-STE-416.1: first\n",
    );
  });

  test("every criterion in a multi-AC section becomes a checkbox", () => {
    const body =
      "## Acceptance Criteria\n" +
      "- AC-STE-416.1: first\n" +
      "- AC-STE-416.2: second\n" +
      "- AC-STE-416.3: third\n";
    const out = checkboxifyLinearACs(body);
    expect(out).toBe(
      "## Acceptance Criteria\n" +
        "- [ ] AC-STE-416.1: first\n" +
        "- [ ] AC-STE-416.2: second\n" +
        "- [ ] AC-STE-416.3: third\n",
    );
    // No plain `- AC-…` bullet survives inside the section.
    expect(out).not.toContain("\n- AC-STE-");
  });

  test("star bullets inside the AC section are converted to `- [ ]` too", () => {
    // The FR spells the target form as `- [ ] <text>` for both `- <text>`
    // and `* <text>` inputs — the marker is canonicalized to `-`, matching
    // `normalize`'s canonical emission.
    const body = "## Acceptance Criteria\n* AC-STE-416.1: first\n* AC-STE-416.2: second\n";
    expect(checkboxifyLinearACs(body)).toBe(
      "## Acceptance Criteria\n- [ ] AC-STE-416.1: first\n- [ ] AC-STE-416.2: second\n",
    );
  });

  test("an already-checked AC line is preserved as `- [x]` (no state reset)", () => {
    const body =
      "## Acceptance Criteria\n" +
      "- [x] AC-STE-416.1: done\n" +
      "- AC-STE-416.2: todo\n";
    const out = checkboxifyLinearACs(body);
    expect(out).toBe(
      "## Acceptance Criteria\n" +
        "- [x] AC-STE-416.1: done\n" +
        "- [ ] AC-STE-416.2: todo\n",
    );
    expect(out).not.toContain("- [ ] AC-STE-416.1");
  });

  test("an already-unchecked AC line stays `- [ ]` (no double box)", () => {
    const body = "## Acceptance Criteria\n- [ ] AC-STE-416.1: first\n";
    const out = checkboxifyLinearACs(body);
    expect(out).toBe(body);
    expect(out).not.toContain("[ ] [ ]");
  });

  test("non-bullet prose inside the AC section is untouched", () => {
    const body =
      "## Acceptance Criteria\n" +
      "\n" +
      "Intro prose line, not a bullet.\n" +
      "- AC-STE-416.1: first\n";
    expect(checkboxifyLinearACs(body)).toBe(
      "## Acceptance Criteria\n" +
        "\n" +
        "Intro prose line, not a bullet.\n" +
        "- [ ] AC-STE-416.1: first\n",
    );
  });

  // -------------------------------------------------------------------------
  // REGRESSION PIN — the push-side "is this already a box" predicate must stay
  // as wide as `normalize`'s pull-side one.
  //
  // `EXISTING_CHECKBOX_RE` deliberately mirrors `normalize`'s bracket body
  // (`\[\s*(x|X|\s)\s*\]`) instead of the tighter `\[[ xX]\]`. Slack forms —
  // `[x ]`, `[ x]`, `[X ]`, `[  ]`, `[<tab>]` — are exactly what `normalize`
  // canonicalizes on pull. Under the narrow predicate each one misses here,
  // falls through to `PLAIN_BULLET_RE`, and gets a SECOND box prefixed onto it
  // (`- [ ] [x ] …`): nested markup, checked state dropped, and the two sides
  // of the round-trip disagreeing about what a box is. These assertions fail
  // loudly if the widening is ever reverted.
  // -------------------------------------------------------------------------

  const SLACK_BOX_BODY =
    "## Acceptance Criteria\n" +
    "- [x ] AC-STE-416.1: trailing space\n" +
    "- [ x] AC-STE-416.2: leading space\n" +
    "- [X ] AC-STE-416.3: upper plus space\n" +
    "- [  ] AC-STE-416.4: two spaces\n" +
    "- [\t] AC-STE-416.5: tab\n";

  test("slack-bracket boxes are recognized as boxes — never double-boxed", () => {
    const out = checkboxifyLinearACs(SLACK_BOX_BODY);
    // No emitted line may carry a box wrapping another bracket.
    expect(out).not.toContain("- [ ] [");
    expect(out).not.toMatch(/^\s*[-*]\s*\[[^\]]*\]\s*\[/m);
    // Each slack input still contributes exactly one bullet line.
    expect(out.split("\n").filter((l) => /^\s*[-*+]/.test(l)).length).toBe(5);
  });

  test("slack-bracket checked state survives the push transform (normalize agreement)", () => {
    // `normalize` is the pull-side reader. Whatever the push side emits for a
    // slack box must read back with the SAME state the slack form carried.
    expect(normalize(checkboxifyLinearACs(SLACK_BOX_BODY))).toBe(
      "## Acceptance Criteria\n" +
        "- [x] AC-STE-416.1: trailing space\n" +
        "- [x] AC-STE-416.2: leading space\n" +
        "- [x] AC-STE-416.3: upper plus space\n" +
        "- [ ] AC-STE-416.4: two spaces\n" +
        "- [ ] AC-STE-416.5: tab\n",
    );
  });
});

// ---------------------------------------------------------------------------
// AC-STE-416.1 — section scoping: bullets outside `## Acceptance Criteria`
// ---------------------------------------------------------------------------

describe("AC-STE-416.1 — bullets outside the AC section are left untouched", () => {
  test("bullets BEFORE the AC heading keep their plain form", () => {
    const body =
      "## Summary\n" +
      "- a summary bullet\n" +
      "* a star summary bullet\n" +
      "\n" +
      "## Acceptance Criteria\n" +
      "- AC-STE-416.1: first\n";
    expect(checkboxifyLinearACs(body)).toBe(
      "## Summary\n" +
        "- a summary bullet\n" +
        "* a star summary bullet\n" +
        "\n" +
        "## Acceptance Criteria\n" +
        "- [ ] AC-STE-416.1: first\n",
    );
  });

  test("the section ends at the next `##` heading — `## Notes` bullets untouched", () => {
    const body =
      "## Acceptance Criteria\n" +
      "- AC-STE-416.1: first\n" +
      "\n" +
      "## Notes\n" +
      "- a note bullet\n" +
      "* another note\n";
    expect(checkboxifyLinearACs(body)).toBe(
      "## Acceptance Criteria\n" +
        "- [ ] AC-STE-416.1: first\n" +
        "\n" +
        "## Notes\n" +
        "- a note bullet\n" +
        "* another note\n",
    );
  });

  test("the section also ends at an H3 heading (`normalize` boundary parity)", () => {
    const body =
      "## Acceptance Criteria\n" +
      "- AC-STE-416.1: first\n" +
      "### Sub-section\n" +
      "- a sub bullet\n";
    expect(checkboxifyLinearACs(body)).toBe(
      "## Acceptance Criteria\n" +
        "- [ ] AC-STE-416.1: first\n" +
        "### Sub-section\n" +
        "- a sub bullet\n",
    );
  });

  test("full FR-shaped body: only the AC section changes", () => {
    const body =
      "# STE-416: title\n" +
      "\n" +
      "## Summary\n" +
      "- context bullet\n" +
      "\n" +
      "## Acceptance Criteria\n" +
      "- AC-STE-416.1: first\n" +
      "- AC-STE-416.2: second\n" +
      "\n" +
      "## Notes\n" +
      "- Refs: STE-190\n" +
      "\n" +
      "Spec: specs/frs/STE-416.md\n";
    const out = checkboxifyLinearACs(body);
    expect(out).toBe(
      "# STE-416: title\n" +
        "\n" +
        "## Summary\n" +
        "- context bullet\n" +
        "\n" +
        "## Acceptance Criteria\n" +
        "- [ ] AC-STE-416.1: first\n" +
        "- [ ] AC-STE-416.2: second\n" +
        "\n" +
        "## Notes\n" +
        "- Refs: STE-190\n" +
        "\n" +
        "Spec: specs/frs/STE-416.md\n",
    );
    expect(out).toContain("- context bullet");
    expect(out).toContain("- Refs: STE-190");
    expect(out).not.toContain("- [ ] context bullet");
    expect(out).not.toContain("- [ ] Refs: STE-190");
  });

  test("a body with NO AC section comes back byte-identical", () => {
    // Push-side whole-body transform, not a section extractor: unlike
    // `normalize` (which returns "" when the heading is absent), the
    // description must survive untouched or the create call would wipe it.
    const body = "# Title\n\n- a bullet\n* another bullet\n\nRefs: STE-416\n";
    expect(checkboxifyLinearACs(body)).toBe(body);
  });

  test("an empty AC section leaves the rest of the body intact", () => {
    const body = "## Acceptance Criteria\n\n## Notes\n- a note\n";
    expect(checkboxifyLinearACs(body)).toBe(body);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-416.1 — idempotency (re-push after a toggle must not reset state)
// ---------------------------------------------------------------------------

describe("AC-STE-416.1 — idempotent: f(f(x)) === f(x), checked state never reset", () => {
  const bodies: Array<{ name: string; body: string }> = [
    {
      name: "plain-bullet body",
      body: "## Acceptance Criteria\n- AC-STE-416.1: first\n- AC-STE-416.2: second\n",
    },
    {
      name: "already-checkbox body",
      body: "## Acceptance Criteria\n- [ ] AC-STE-416.1: first\n- [x] AC-STE-416.2: second\n",
    },
    {
      name: "mixed body (plain + checked + unchecked)",
      body:
        "## Acceptance Criteria\n" +
        "- AC-STE-416.1: plain\n" +
        "- [x] AC-STE-416.2: checked\n" +
        "* AC-STE-416.3: star\n" +
        "- [ ] AC-STE-416.4: unchecked\n" +
        "\n" +
        "## Notes\n" +
        "- untouched\n",
    },
    { name: "no AC section", body: "# Title\n- a bullet\n" },
  ];

  for (const { name, body } of bodies) {
    test(`${name}: applying twice equals applying once`, () => {
      const once = checkboxifyLinearACs(body);
      expect(checkboxifyLinearACs(once)).toBe(once);
    });
  }

  test("re-applying to a toggled body preserves every `- [x]`", () => {
    const toggled =
      "## Acceptance Criteria\n" +
      "- [x] AC-STE-416.1: done\n" +
      "- [ ] AC-STE-416.2: todo\n" +
      "- [x] AC-STE-416.3: also done\n";
    const out = checkboxifyLinearACs(checkboxifyLinearACs(toggled));
    expect(out).toBe(toggled);
    expect(out).toContain("- [x] AC-STE-416.1: done");
    expect(out).toContain("- [x] AC-STE-416.3: also done");
    expect(out).not.toContain("- [ ] AC-STE-416.1");
    expect(out).not.toContain("- [ ] AC-STE-416.3");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-416.1 — commutes with formatLinearDescription (FR § Wiring claim)
// ---------------------------------------------------------------------------

describe("AC-STE-416.1 — the transform commutes with formatLinearDescription", () => {
  const bodies = [
    "## Acceptance Criteria\n- AC-STE-416.1: first\n",
    "## Acceptance Criteria\n- AC-STE-416.1: first\n- [x] AC-STE-416.2: second\n",
    "## Summary\n- ctx\n\n## Acceptance Criteria\n* AC-DPT-99.7: star\n\n## Notes\n- Refs: STE-190\n",
    "# Title\nNo AC section here. Refs: STE-416\n",
  ];

  test("either order yields the same bytes", () => {
    for (const body of bodies) {
      expect(checkboxifyLinearACs(formatLinearDescription(body))).toBe(
        formatLinearDescription(checkboxifyLinearACs(body)),
      );
    }
  });

  test("the composed push form carries BOTH the box prefix and the AC-ID fence", () => {
    const body = "## Acceptance Criteria\n- AC-STE-416.1: first\n";
    expect(formatLinearDescription(checkboxifyLinearACs(body))).toBe(
      "## Acceptance Criteria\n- [ ] AC-`STE-416`.1: first\n",
    );
  });

  test("the pull-side strip still round-trips: strip(format(checkbox(x))) === checkbox(x)", () => {
    for (const body of bodies) {
      const boxed = checkboxifyLinearACs(body);
      expect(stripLinearACFences(formatLinearDescription(boxed))).toBe(boxed);
    }
  });
});

// ---------------------------------------------------------------------------
// AC-STE-416.2 — pull → toggle → pull round-trip on the checkbox form
// ---------------------------------------------------------------------------

/**
 * Parse a canonical `## Acceptance Criteria` block (the output of
 * `normalize`, i.e. what `pull_acs` step 4 parses) into `AC id → completed`.
 */
function parseACStates(canonical: string): Record<string, boolean> {
  const states: Record<string, boolean> = {};
  for (const line of canonical.split("\n")) {
    const m = line.match(/^\s*- \[([ x])\] (AC-[A-Z]+-\d+\.\d+):/);
    if (!m) continue;
    states[m[2] as string] = m[1] === "x";
  }
  return states;
}

/**
 * Simulate `push_ac_toggle`'s semantic markdown diff: flip the box of the
 * single bullet whose AC id matches, leaving every other line byte-identical.
 * The capability itself is LLM-emulated over `mcp__linear__save_issue`, so
 * the test drives the pure surface it operates on.
 */
function pushACToggle(body: string, acId: string, completed: boolean): string {
  const mark = completed ? "x" : " ";
  return body
    .split("\n")
    .map((line) => {
      const m = line.match(/^(\s*)- \[[ xX]\] (AC-[A-Z]+-\d+\.\d+)(:.*)$/);
      if (!m || m[2] !== acId) return line;
      return `${m[1]}- [${mark}] ${m[2]}${m[3]}`;
    })
    .join("\n");
}

describe("AC-STE-416.2 — AC completion-state round-trip is operative on Linear", () => {
  // What /spec-write composes locally for a three-criterion FR.
  const local =
    "## Acceptance Criteria\n" +
    "- AC-STE-416.1: first\n" +
    "- AC-STE-416.2: second\n" +
    "- AC-STE-416.3: third\n";

  /** upsert_ticket_metadata composition: checkbox transform + AC-ID fences. */
  const push = (body: string) => formatLinearDescription(checkboxifyLinearACs(body));
  /** pull_acs: strip Linear's fences/auto-link wrappers, then normalize. */
  const pull = (stored: string) => normalize(stripLinearACFences(stored));

  test("the seeded body pulls back with every criterion as an unchecked box", () => {
    const pulled = pull(push(local));
    expect(pulled).toContain("- [ ] AC-STE-416.1: first");
    expect(pulled).toContain("- [ ] AC-STE-416.2: second");
    expect(pulled).toContain("- [ ] AC-STE-416.3: third");
    expect(parseACStates(pulled)).toEqual({
      "AC-STE-416.1": false,
      "AC-STE-416.2": false,
      "AC-STE-416.3": false,
    });
  });

  test("flipping exactly one criterion is exactly what the next pull reports", () => {
    const pulled = pull(push(local));
    const toggled = pushACToggle(pulled, "AC-STE-416.2", true);
    const rePulled = pull(push(toggled));

    const states = parseACStates(rePulled);
    // The flipped criterion — asserted by identity, not by count.
    expect(states["AC-STE-416.2"]).toBe(true);
    // Every other criterion stays unchecked.
    expect(states["AC-STE-416.1"]).toBe(false);
    expect(states["AC-STE-416.3"]).toBe(false);
    // No criterion is dropped or invented by the round-trip.
    expect(Object.keys(states).sort()).toEqual([
      "AC-STE-416.1",
      "AC-STE-416.2",
      "AC-STE-416.3",
    ]);
    // Byte-level shape of the re-read block.
    expect(rePulled).toBe(
      "## Acceptance Criteria\n" +
        "- [ ] AC-STE-416.1: first\n" +
        "- [x] AC-STE-416.2: second\n" +
        "- [ ] AC-STE-416.3: third\n",
    );
  });

  test("the re-push composition never resets the operator's toggle", () => {
    const toggled = pushACToggle(pull(push(local)), "AC-STE-416.3", true);
    // Re-pushing the whole description (create → update path) is a fixpoint.
    expect(checkboxifyLinearACs(toggled)).toBe(toggled);
    const afterTwoMoreRoundTrips = pull(push(pull(push(toggled))));
    expect(parseACStates(afterTwoMoreRoundTrips)).toEqual({
      "AC-STE-416.1": false,
      "AC-STE-416.2": false,
      "AC-STE-416.3": true,
    });
  });

  test("toggling back to unchecked round-trips too (the `[ ]` ⇄ `[x]` flip)", () => {
    const checked = pushACToggle(pull(push(local)), "AC-STE-416.1", true);
    expect(parseACStates(pull(push(checked)))["AC-STE-416.1"]).toBe(true);
    const unchecked = pushACToggle(pull(push(checked)), "AC-STE-416.1", false);
    expect(parseACStates(pull(push(unchecked)))["AC-STE-416.1"]).toBe(false);
  });

  test("without the push-side transform there would be no box to read (regression anchor)", () => {
    // The pre-STE-416 push path: fences only, no checkbox synthesis. The
    // pulled block then carries zero `[ ]`/`[x]` state — the exact defect.
    const legacyPulled = pull(formatLinearDescription(local));
    expect(parseACStates(legacyPulled)).toEqual({});
    // …whereas the new composition yields three readable boxes.
    expect(Object.keys(parseACStates(pull(push(local)))).length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-416.1 — the EMITTED form must be GFM-valid task-list syntax
//
// AC-STE-416.1 requires each criterion to be "emitted as an unchecked markdown
// task-list checkbox". Per GFM (§ 5.3 Task list items), a task-list marker is
// a list item whose content begins with `[ ]`, `[x]`, or `[X]` — EXACTLY ONE
// character between the brackets, followed by whitespace. `- [x ]`, `- [ x]`,
// and `- [  ]` are therefore NOT task markers: a renderer emits them as
// literal text, so Linear shows no togglable box and the `pull_acs` /
// `push_ac_toggle` round-trip is inoperative on that line.
//
// Skipping an existing box preserves its state but does NOT make it valid.
// The push side is the last writer before the description reaches Linear, so
// it must CANONICALIZE a slack box (state preserved) rather than pass it
// through — otherwise the AC's "emitted as … checkbox" clause is unmet for
// exactly the inputs `normalize` is lenient about on pull.
// ---------------------------------------------------------------------------

/** GFM task-list item: ≤3 leading spaces, bullet, `[ ]`/`[x]`/`[X]`, space. */
const GFM_TASK_ITEM_RE = /^\s{0,3}[-*+]\s+\[[ xX]\]\s/;

/** Lines of the `## Acceptance Criteria` section (same boundary as `normalize`). */
function acSectionLines(body: string): string[] {
  const lines = body.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+Acceptance\s+Criteria\s*$/.test((lines[i] ?? "").trim())) {
      start = i + 1;
      break;
    }
  }
  if (start === -1) return [];
  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    if (/^#{1,3}\s/.test((lines[i] ?? "").trim())) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end);
}

/** The bullet lines of the AC section — the ones Linear must render as boxes. */
function acBulletLines(body: string): string[] {
  return acSectionLines(body).filter((l) => /^\s*[-*+]/.test(l));
}

/** Slack-bracket boxes: state-bearing, but NOT GFM task markers as written. */
const SLACK_BODY =
  "## Acceptance Criteria\n" +
  "- [x ] AC-STE-416.1: trailing space\n" +
  "- [ x] AC-STE-416.2: leading space\n" +
  "- [X ] AC-STE-416.3: upper plus space\n" +
  "- [  ] AC-STE-416.4: two spaces\n" +
  "- [\t] AC-STE-416.5: tab\n";

/** Canonical target: one char in the brackets, `-` marker, state preserved. */
const SLACK_BODY_CANONICAL =
  "## Acceptance Criteria\n" +
  "- [x] AC-STE-416.1: trailing space\n" +
  "- [x] AC-STE-416.2: leading space\n" +
  "- [x] AC-STE-416.3: upper plus space\n" +
  "- [ ] AC-STE-416.4: two spaces\n" +
  "- [ ] AC-STE-416.5: tab\n";

describe("AC-STE-416.1 — every emitted AC line is GFM-valid task-list syntax", () => {
  test("the helpers see the section they claim to (non-vacuity)", () => {
    // If `acBulletLines` returned [] the per-line loops below would pass
    // trivially, so pin the count on a body whose shape is already covered.
    const plain = "## Acceptance Criteria\n- AC-STE-416.1: a\n- AC-STE-416.2: b\n";
    expect(acBulletLines(plain)).toEqual([
      "- AC-STE-416.1: a",
      "- AC-STE-416.2: b",
    ]);
    // …and the predicate genuinely rejects a non-task-marker line.
    expect("- [x ] AC-STE-416.1: a").not.toMatch(GFM_TASK_ITEM_RE);
    expect("- AC-STE-416.1: a").not.toMatch(GFM_TASK_ITEM_RE);
    expect("- [x] AC-STE-416.1: a").toMatch(GFM_TASK_ITEM_RE);
  });

  test("slack-bracket boxes are emitted as GFM task-list items", () => {
    const bullets = acBulletLines(checkboxifyLinearACs(SLACK_BODY));
    expect(bullets.length).toBe(5);
    for (const line of bullets) expect(line).toMatch(GFM_TASK_ITEM_RE);
  });

  test("slack-bracket boxes are canonicalized with their state preserved", () => {
    expect(checkboxifyLinearACs(SLACK_BODY)).toBe(SLACK_BODY_CANONICAL);
  });

  test("a mixed section emits GFM task items for plain, star, and slack bullets", () => {
    const body =
      "## Acceptance Criteria\n" +
      "- AC-STE-416.1: plain\n" +
      "* AC-STE-416.2: star\n" +
      "- [x] AC-STE-416.3: canonical checked\n" +
      "- [ ] AC-STE-416.4: canonical unchecked\n" +
      "- [x ] AC-STE-416.5: slack checked\n" +
      "*  [ x] AC-STE-416.6: slack star checked\n";
    const out = checkboxifyLinearACs(body);
    expect(out).toBe(
      "## Acceptance Criteria\n" +
        "- [ ] AC-STE-416.1: plain\n" +
        "- [ ] AC-STE-416.2: star\n" +
        "- [x] AC-STE-416.3: canonical checked\n" +
        "- [ ] AC-STE-416.4: canonical unchecked\n" +
        "- [x] AC-STE-416.5: slack checked\n" +
        "- [x] AC-STE-416.6: slack star checked\n",
    );
    const bullets = acBulletLines(out);
    expect(bullets.length).toBe(6);
    for (const line of bullets) expect(line).toMatch(GFM_TASK_ITEM_RE);
  });

  test("an indented slack box keeps its indent and becomes a GFM task item", () => {
    const body =
      "## Acceptance Criteria\n" +
      "- [ ] AC-STE-416.1: parent\n" +
      "  - [x ] AC-STE-416.2: indented slack child\n";
    expect(checkboxifyLinearACs(body)).toBe(
      "## Acceptance Criteria\n" +
        "- [ ] AC-STE-416.1: parent\n" +
        "  - [x] AC-STE-416.2: indented slack child\n",
    );
  });

  test("already-canonical boxes come back byte-identical (no churn)", () => {
    const canonical =
      "## Acceptance Criteria\n" +
      "- [ ] AC-STE-416.1: first\n" +
      "- [x] AC-STE-416.2: second\n" +
      "  - [ ] AC-STE-416.3: indented child\n";
    expect(checkboxifyLinearACs(canonical)).toBe(canonical);
    for (const line of acBulletLines(canonical)) {
      expect(line).toMatch(GFM_TASK_ITEM_RE);
    }
  });

  test("idempotency survives canonicalization: f(f(x)) === f(x)", () => {
    const bodies = [
      SLACK_BODY,
      "## Acceptance Criteria\n- AC-STE-416.1: plain\n- [ x] AC-STE-416.2: slack\n",
      "## Summary\n- [x ] outside\n\n## Acceptance Criteria\n- [  ] AC-STE-416.1: a\n",
    ];
    for (const body of bodies) {
      const once = checkboxifyLinearACs(body);
      expect(checkboxifyLinearACs(once)).toBe(once);
      // …and one application already reaches the GFM-valid form.
      for (const line of acBulletLines(once)) expect(line).toMatch(GFM_TASK_ITEM_RE);
    }
  });

  test("push output is already canonical: normalize(f(x)) === f(x)", () => {
    // `normalize` is the pull-side canonicalizer. If the push side emitted a
    // slack box, the very next `pull_acs` would report drift against what was
    // just written. AC-section-only bodies, so `normalize`'s section-extractor
    // return value is comparable byte for byte.
    const bodies = [
      SLACK_BODY,
      "## Acceptance Criteria\n- AC-STE-416.1: plain\n- [x ] AC-STE-416.2: slack\n",
      "## Acceptance Criteria\n* AC-STE-416.1: star\n*  [ x] AC-STE-416.2: slack star\n",
    ];
    for (const body of bodies) {
      const pushed = checkboxifyLinearACs(body);
      expect(normalize(pushed)).toBe(pushed);
    }
  });

  test("the composed push form (fences + boxes) is still GFM-valid", () => {
    const composed = formatLinearDescription(checkboxifyLinearACs(SLACK_BODY));
    const bullets = acBulletLines(composed);
    expect(bullets.length).toBe(5);
    for (const line of bullets) expect(line).toMatch(GFM_TASK_ITEM_RE);
    expect(composed).toContain("- [x] AC-`STE-416`.1: trailing space");
  });

  test("slack boxes OUTSIDE the AC section stay byte-identical", () => {
    const body =
      "## Summary\n" +
      "- [x ] not an AC, slack box\n" +
      "- [  ] also not an AC\n" +
      "\n" +
      "## Acceptance Criteria\n" +
      "- [x ] AC-STE-416.1: slack\n" +
      "\n" +
      "## Notes\n" +
      "* [ x] a slack note\n";
    expect(checkboxifyLinearACs(body)).toBe(
      "## Summary\n" +
        "- [x ] not an AC, slack box\n" +
        "- [  ] also not an AC\n" +
        "\n" +
        "## Acceptance Criteria\n" +
        "- [x] AC-STE-416.1: slack\n" +
        "\n" +
        "## Notes\n" +
        "* [ x] a slack note\n",
    );
  });

  test("a body with NO AC section is never canonicalized", () => {
    const body = "# Title\n\n- [x ] a slack box outside any AC section\n";
    expect(checkboxifyLinearACs(body)).toBe(body);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-416.1 — CRLF-sourced bodies convert exactly like their LF equivalents
//
// THE DEFECT. `checkboxifyLinearACs` splits on `"\n"` with no CRLF→LF pass, so
// on a `\r\n` body every split line keeps a trailing `\r`. Both line predicates
// (`EXISTING_CHECKBOX_RE`, `PLAIN_BULLET_RE`) end in `(.*)$` with NO `m` flag:
// `$` is the true end of string and `.` never matches `\r`, so a line ending in
// a bare `\r` cannot satisfy either pattern. Empirically confirmed —
// `"- [ ] AC-STE-416.1: foo\r"` and `"- AC-STE-416.1: foo\r"` BOTH fail to
// match, while their `\r`-free twins match fine. The heading scan and the
// section terminator survive only because they `.trim()` first, so the section
// is located, entered, and then every bullet in it silently declines to
// convert. No crash, no error — the whole transform degrades to a no-op and
// the pushed description reaches Linear with plain bullets, which is precisely
// the state STE-416 exists to eliminate.
//
// It is also a push/pull ASYMMETRY: `normalize` — the pull side — opens with
// "Step 1: CRLF -> LF" (`md.replace(/\r\n/g, "\n")`) and has a dedicated CRLF
// case in `normalize.test.ts`. The reader tolerates CRLF; the writer does not.
//
// ---- LINE-ENDING CONTRACT PINNED HERE -------------------------------------
//
// `checkboxifyLinearACs` NORMALIZES CRLF→LF, matching `normalize`, but ONLY on
// the path where it actually transforms — i.e. when an `## Acceptance Criteria`
// section is present. Stated as two clauses that must both hold:
//
//   (1) AC section present  ⇒ the returned body is LF-only. The transform is a
//       whole-body rewrite, and emitting mixed endings would leave the very
//       drift `normalize` exists to suppress: the next `pull_acs` would
//       canonicalize away bytes that were just written.
//   (2) AC section absent   ⇒ the body is returned BYTE-IDENTICAL, `\r`s and
//       all (the existing "a body with NO AC section comes back byte-identical"
//       guarantee, unweakened).
//
// The two interact cleanly because they are the two arms of the same early
// return: nothing is normalized on a body nothing is transformed on. Concretely
// the implementation must compute the LF view for scanning/joining but hand
// back the ORIGINAL `body` on the `start === -1` branch — returning the
// LF-normalized view there would silently rewrite a description the helper
// declined to touch, which is exactly the wipe risk the byte-identity guarantee
// was written to prevent.
//
// No existing assertion in this file or in `tests/linear-ac-token-round-trip.ts`
// pins byte-identical passthrough of a CRLF body with an AC section — the only
// `\r` in the adapter's tests is `normalize.test.ts`'s CRLF case, which asserts
// LF output. So (1) extends the established contract rather than contradicting
// one.
// ---------------------------------------------------------------------------

/** An FR-shaped body covering plain, star, canonical-checked and slack bullets. */
const LF_FR_BODY =
  "# STE-416: title\n" +
  "\n" +
  "## Summary\n" +
  "- context bullet\n" +
  "\n" +
  "## Acceptance Criteria\n" +
  "- AC-STE-416.1: first\n" +
  "- [x] AC-STE-416.2: already done\n" +
  "* AC-STE-416.3: star\n" +
  "- [x ] AC-STE-416.4: slack checked\n" +
  "\n" +
  "## Notes\n" +
  "- Refs: STE-190\n";

/** The same bytes as Linear/Windows/a pasted diff would deliver them. */
const CRLF_FR_BODY = LF_FR_BODY.replace(/\n/g, "\r\n");

/** What the LF body already converts to today — the CRLF body must match it. */
const FR_BODY_CONVERTED =
  "# STE-416: title\n" +
  "\n" +
  "## Summary\n" +
  "- context bullet\n" +
  "\n" +
  "## Acceptance Criteria\n" +
  "- [ ] AC-STE-416.1: first\n" +
  "- [x] AC-STE-416.2: already done\n" +
  "- [ ] AC-STE-416.3: star\n" +
  "- [x] AC-STE-416.4: slack checked\n" +
  "\n" +
  "## Notes\n" +
  "- Refs: STE-190\n";

describe("AC-STE-416.1 — CRLF line endings do not defeat the checkbox transform", () => {
  test("the fixture really is CRLF (non-vacuity)", () => {
    // Guards the whole block: if the fixture lost its `\r\n`s these tests would
    // silently re-assert the LF cases already covered above.
    expect(CRLF_FR_BODY).toContain("\r\n");
    expect(CRLF_FR_BODY.split("\r\n").length).toBe(LF_FR_BODY.split("\n").length);
    expect(LF_FR_BODY).not.toContain("\r");
  });

  test("a CRLF body converts plain bullets to `- [ ]` exactly as the LF body does", () => {
    expect(checkboxifyLinearACs(CRLF_FR_BODY)).toBe(FR_BODY_CONVERTED);
    // …and stated as the equivalence the defect breaks: the two inputs differ
    // only in line endings, so their outputs must not differ at all.
    expect(checkboxifyLinearACs(CRLF_FR_BODY)).toBe(
      checkboxifyLinearACs(LF_FR_BODY),
    );
  });

  test("no plain `- AC-…` bullet survives inside a CRLF body's AC section", () => {
    const out = checkboxifyLinearACs(CRLF_FR_BODY);
    expect(out).not.toMatch(/^[-*] AC-STE-416\./m);
    expect(out).toContain("- [ ] AC-STE-416.1: first");
    expect(out).toContain("- [ ] AC-STE-416.3: star");
  });

  test("existing `- [x]` state is preserved on CRLF input (never reset)", () => {
    const body =
      "## Acceptance Criteria\r\n" +
      "- [x] AC-STE-416.1: done\r\n" +
      "- AC-STE-416.2: todo\r\n" +
      "- [x ] AC-STE-416.3: slack done\r\n";
    const out = checkboxifyLinearACs(body);
    expect(out).toBe(
      "## Acceptance Criteria\n" +
        "- [x] AC-STE-416.1: done\n" +
        "- [ ] AC-STE-416.2: todo\n" +
        "- [x] AC-STE-416.3: slack done\n",
    );
    expect(out).not.toContain("- [ ] AC-STE-416.1");
    expect(out).not.toContain("- [ ] AC-STE-416.3");
  });

  test("a mixed CRLF/LF body converts every bullet and emits LF throughout", () => {
    const body =
      "## Acceptance Criteria\r\n" +
      "- AC-STE-416.1: crlf plain\n" +
      "- [x] AC-STE-416.2: lf checked\r\n" +
      "* AC-STE-416.3: crlf star\n" +
      "  - [ x] AC-STE-416.4: crlf indented slack\r\n";
    expect(checkboxifyLinearACs(body)).toBe(
      "## Acceptance Criteria\n" +
        "- [ ] AC-STE-416.1: crlf plain\n" +
        "- [x] AC-STE-416.2: lf checked\n" +
        "- [ ] AC-STE-416.3: crlf star\n" +
        "  - [x] AC-STE-416.4: crlf indented slack\n",
    );
  });

  test("contract (1): a transformed body carries no `\\r` at all", () => {
    expect(checkboxifyLinearACs(CRLF_FR_BODY)).not.toContain("\r");
    expect(
      checkboxifyLinearACs("## Acceptance Criteria\r\n- AC-STE-416.1: a\r\n"),
    ).not.toContain("\r");
  });

  test("contract (2): a CRLF body with NO AC section is still byte-identical", () => {
    // The two clauses of the pinned contract meet here. Normalization is a
    // consequence of transforming, never a thing done to a body left alone —
    // so the `start === -1` branch must hand back the ORIGINAL bytes, not the
    // LF view computed for the scan.
    const body =
      "# Title\r\n\r\n- a bullet\r\n* another bullet\r\n\r\nRefs: STE-416\r\n";
    expect(checkboxifyLinearACs(body)).toBe(body);
    expect(checkboxifyLinearACs(body)).toContain("\r\n");
  });

  test("bullets outside the AC section keep their plain form on CRLF input", () => {
    const out = checkboxifyLinearACs(CRLF_FR_BODY);
    expect(out).toContain("- context bullet");
    expect(out).toContain("- Refs: STE-190");
    expect(out).not.toContain("- [ ] context bullet");
    expect(out).not.toContain("- [ ] Refs: STE-190");
  });

  test("idempotency holds on CRLF input: f(f(x)) === f(x)", () => {
    const bodies = [
      CRLF_FR_BODY,
      "## Acceptance Criteria\r\n- AC-STE-416.1: a\r\n- [x] AC-STE-416.2: b\r\n",
      "## Acceptance Criteria\r\n- [x ] AC-STE-416.1: slack\r\n\r\n## Notes\r\n- n\r\n",
      "# Title\r\n- a bullet\r\n", // no AC section
    ];
    for (const body of bodies) {
      const once = checkboxifyLinearACs(body);
      expect(checkboxifyLinearACs(once)).toBe(once);
    }
  });

  test("push output is already canonical on CRLF input: normalize(f(x)) === f(x)", () => {
    // The push/pull asymmetry stated as an equation. `normalize` strips `\r`,
    // so any `\r` the push side leaves behind is drift the very next `pull_acs`
    // reports against bytes that were just written. AC-section-only bodies, so
    // `normalize`'s section-extractor output is comparable byte for byte.
    const bodies = [
      "## Acceptance Criteria\r\n- AC-STE-416.1: a\r\n- [x ] AC-STE-416.2: b\r\n",
      "## Acceptance Criteria\r\n* AC-STE-416.1: star\r\n",
      "## Acceptance Criteria\r\n- [ ] AC-STE-416.1: a\n- [x] AC-STE-416.2: b\r\n",
    ];
    for (const body of bodies) {
      const pushed = checkboxifyLinearACs(body);
      expect(normalize(pushed)).toBe(pushed);
    }
  });

  test("every emitted AC line of a CRLF body is GFM-valid task-list syntax", () => {
    const bullets = acBulletLines(checkboxifyLinearACs(CRLF_FR_BODY));
    expect(bullets.length).toBe(4);
    for (const line of bullets) expect(line).toMatch(GFM_TASK_ITEM_RE);
  });

  test("commutes with formatLinearDescription on CRLF bodies too", () => {
    // Drift guard for the FR's commutativity claim — it must survive the
    // line-ending fix, including on the no-AC-section arm where the CRLF bytes
    // pass through untouched on both sides.
    const bodies = [
      CRLF_FR_BODY,
      "## Acceptance Criteria\r\n- AC-STE-416.1: first\r\n",
      "# Title\r\nNo AC section here. Refs: STE-416\r\n",
    ];
    for (const body of bodies) {
      expect(checkboxifyLinearACs(formatLinearDescription(body))).toBe(
        formatLinearDescription(checkboxifyLinearACs(body)),
      );
    }
  });

  test("the full push → pull round-trip reads real state off a CRLF-sourced body", () => {
    const push = (body: string) =>
      formatLinearDescription(checkboxifyLinearACs(body));
    const pull = (stored: string) => normalize(stripLinearACFences(stored));
    const crlfLocal =
      "## Acceptance Criteria\r\n" +
      "- AC-STE-416.1: first\r\n" +
      "- AC-STE-416.2: second\r\n" +
      "- AC-STE-416.3: third\r\n";

    const pulled = pull(push(crlfLocal));
    expect(parseACStates(pulled)).toEqual({
      "AC-STE-416.1": false,
      "AC-STE-416.2": false,
      "AC-STE-416.3": false,
    });

    const rePulled = pull(push(pushACToggle(pulled, "AC-STE-416.2", true)));
    expect(parseACStates(rePulled)).toEqual({
      "AC-STE-416.1": false,
      "AC-STE-416.2": true,
      "AC-STE-416.3": false,
    });
  });
});
