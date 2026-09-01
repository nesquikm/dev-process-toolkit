// markdown_section_walk — the ONE heading walk both altitude scanners run on.
//
// `scan_fr_summary_altitude.ts` and `scan_plan_narrative_altitude.ts` each
// answer a different question (is this FR's `## Summary` over its per-name cap?
// is this plan's level-3 subsection narrative and over the narrative cap?) but
// both reach it the same way: split a markdown file into lines, decide which
// lines are headings, and hand each heading the body that follows it. STE-535's
// Technical Design named that overlap and asked for one helper rather than two
// copies. This is it.
//
// The two walks differ on exactly three axes, and all three are DECLARED here
// as data rather than lived in control flow — the same move STE-534 made when
// it pushed the FR scanner's per-section asymmetry into `SECTION_RULES`:
//
//   opens  — which heading STARTS a section, and where its text is. The FR
//            walk opens on any level-2 heading; the plan walk opens on any
//            level-3 one.
//   closes — which heading ENDS an open section without starting another.
//            The FR walk sets this `null`: there, one level-2 heading both
//            ends the previous section and starts the next, so the opener is
//            the only closer. The plan walk closes on level-1 and level-2
//            headings, which outrank its level-3 openers.
//   fenceAware — whether a heading inside a MATCHED fence pair counts. The
//            plan walk says yes: a plan quoting `### Tasks` inside a fence is
//            showing sample text, not opening a subsection. The FR walk has
//            never been fence-aware and stays that way here. Writing that
//            down as `false` is the point: it turns a silent omission into a
//            reviewable choice that a later FR can flip in ONE place.
//
// A fourth difference did NOT survive into a knob. The FR scanner used to
// decide its rules line-by-line as it walked and the plan scanner had to
// buffer each body (its classifier is a function of the WHOLE body), so the
// two looked incompatible. They are not: buffering is strictly more general,
// and because sections are disjoint and yielded in file order, a caller that
// replays a buffered body emits violations in the same increasing-line order
// the streaming walk did. Both callers now buffer, and there is no
// streaming/buffered flag to get wrong.
//
// What deliberately stays OUT of this module: anything that decides whether a
// section is over its cap. This walk finds sections; it never grades them.
// `classifySectionBody` in particular stays in the plan scanner, where
// AC-STE-535.1's structural teeth can keep reading its one-parameter
// declaration out of that file's source.
//
// No `import.meta.main` entry, and none is owed: this module is a library the
// two scanners import, not a check a /gate-check registration ever orders a
// reader to run by hand. Probe #81 grades ORDERED references, and nothing
// orders this one.

/** A fence line, either flavor, at any indent. Group 1 is the marker run,
 *  group 2 the info string. */
const FENCE_RE = /^\s*(`{3,}|~{3,})(.*)$/;

/**
 * The opener a fence line begins, or `null` when it cannot open one.
 *
 * CommonMark: a fence opens on three or more backticks or tildes, optionally
 * followed by an info string. A BACKTICK opener's info string may not itself
 * contain a backtick — that is what keeps inline code from opening a block.
 */
function fenceOpener(line: string): { char: string; run: number } | null {
  const m = FENCE_RE.exec(line);
  if (m === null) return null;
  const marker = m[1]!;
  const char = marker[0]!;
  if (char === "`" && m[2]!.includes("`")) return null;
  return { char, run: marker.length };
}

/**
 * Whether `line` CLOSES a fence opened by `opener`.
 *
 * THREE CONDITIONS, and every one of them was missing. The previous version
 * closed on any fence-shaped line at all — flavor-blind, run-length-blind and
 * info-string-blind — so ```` ```bash ````, which is an OPENER, was read as the
 * closer of the block above it. Every span after that point shifted by one, and
 * with `fenceAware: true` on the FR walk a real `## Summary` could land inside
 * a phantom span and NEVER OPEN. Probe #67 then went silent on that whole FR —
 * not merely `word_cap`, but the four error-severity M105 rules that
 * grandfathering deliberately never touches. One forgotten closing fence
 * retired all five. Reproduced before this was written.
 */
function closesFence(line: string, opener: { char: string; run: number }): boolean {
  const m = FENCE_RE.exec(line);
  if (m === null) return false;
  const marker = m[1]!;
  // Same flavor: a `~~~` never closes a ``` block.
  if (marker[0] !== opener.char) return false;
  // At least as long as the opener: ``` never closes ````.
  if (marker.length < opener.run) return false;
  // A closer carries NO info string. This is the clause that matters here:
  // it is what makes ```bash an opener rather than a closer.
  return m[2]!.trim() === "";
}

/**
 * Per-line flags for lines inside a MATCHED fence pair (markers included).
 *
 * An opener with no closer pairs with nothing and flags nothing, so an
 * unterminated fence cannot swallow the rest of the file into one section.
 */
export function fencedFlags(lines: readonly string[]): boolean[] {
  const flags: boolean[] = new Array(lines.length).fill(false);
  let i = 0;
  while (i < lines.length) {
    const opener = fenceOpener(lines[i]!);
    if (opener === null) {
      i++;
      continue;
    }
    let close = i + 1;
    while (close < lines.length && !closesFence(lines[close]!, opener)) close++;
    // No closer anywhere below: nothing left to pair, and this opener is inert.
    if (close >= lines.length) break;
    for (let k = i; k <= close; k++) flags[k] = true;
    i = close + 1;
  }
  return flags;
}

/** Whitespace-delimited token count of one line. */
export function countWords(line: string): number {
  const trimmed = line.trim();
  if (trimmed === "") return 0;
  return trimmed.split(/\s+/).filter(Boolean).length;
}

/** How one caller's headings behave. Every axis is data, never control flow. */
export interface SectionWalkSpec {
  /** Matches a heading that OPENS a section; capture group 1 is its text. */
  readonly opens: RegExp;
  /**
   * Matches a heading that CLOSES an open section without opening one, or
   * `null` when the opener is the only closer.
   */
  readonly closes: RegExp | null;
  /** When true, a heading inside a MATCHED fence pair is sample text. */
  readonly fenceAware: boolean;
}

/** One section, with its body kept beside the file lines the body came from. */
export interface WalkedSection {
  /** Exact heading text — `opens` group 1, already trimmed by that regex. */
  heading: string;
  /** 1-indexed file line of the heading itself. */
  line: number;
  /** Body lines, verbatim, in file order. The heading is NOT included. */
  body: string[];
  /** 1-indexed file line of each body line, parallel to `body`. */
  bodyLines: number[];
}

/**
 * Every section of `lines`, in file order.
 *
 * Lines before the first opener belong to no section and are dropped. A
 * section runs to the next opener, the next closer, or EOF. Openers are tested
 * before closers, so a spec whose two regexes overlap still opens.
 *
 * Neither regex may carry the `g` or `y` flag: both make `exec`/`test`
 * stateful across calls, and this walk calls each once per line.
 */
export function walkSections(
  lines: readonly string[],
  spec: SectionWalkSpec,
): WalkedSection[] {
  const out: WalkedSection[] = [];
  const fenced = spec.fenceAware ? fencedFlags(lines) : null;
  let open: WalkedSection | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (fenced === null || fenced[i] !== true) {
      const opener = spec.opens.exec(line);
      if (opener !== null) {
        if (open !== null) out.push(open);
        open = { heading: opener[1] ?? "", line: i + 1, body: [], bodyLines: [] };
        continue;
      }
      if (spec.closes !== null && spec.closes.test(line)) {
        if (open !== null) out.push(open);
        open = null;
        continue;
      }
    }
    if (open === null) continue;
    open.body.push(line);
    open.bodyLines.push(i + 1);
  }
  if (open !== null) out.push(open);
  return out;
}
