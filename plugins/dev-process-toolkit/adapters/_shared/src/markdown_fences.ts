// markdown_fences — shared fenced-block scanning for markdown/report text.
// Hoisted (STE-252 refactor pass) out of duplicate copies in
// `auto_approve_marker.ts` (STE-226 probe #38) and
// `conformance_loop_bypass_removed.ts` (STE-252 probe #46) so a single
// implementation owns the fence-scan contract.
//
// STE-492 refactor pass generalized the scanner: `findFences` is the one
// line-state machine, and the tag-specific readers are thin policies over
// it — `extractBashFences` here, `extractFencedBlock` in `tdd_fence_yaml.ts`
// (the `tdd-result` / `tdd-spec-review-result` blocks), and
// `verifyDeliverStageCapture` in `deliver_stage_capture.ts` (the
// `deliver-stage-result` stage hand-off). Each of those had re-derived the
// same open/close walk with its own subtly different edge handling.
//
// Contract: returns each opening-fence-to-closing-fence pair with (a) the
// 1-based start line of the opening marker, (b) the inner body text (joined
// with `\n`), and (c) the 1-based start line of the first body line. Stable
// across uses; the probes need to cite a `file:line` for diagnostics.

/** Default closing marker: a bare ` ``` ` at column 0. */
export const DEFAULT_FENCE_CLOSE = /^```\s*$/;

export interface Fence {
  /** 1-based; line of the opening fence marker. */
  startLine: number;
  /**
   * 1-based line of the closing marker, or `-1` when EOF arrived first.
   * Callers that treat an unterminated fence as "no fence at all" filter on
   * `endLine > 0`; callers that must diagnose it (a truncated hand-off is a
   * contract violation worth naming) read the `-1`.
   */
  endLine: number;
  /** Inner lines, verbatim, between the markers. */
  lines: string[];
  /** Inner block text (`lines` joined with `\n`). */
  body: string;
  /** 1-based; line of the first inner-body line (i.e. `startLine + 1`). */
  bodyStartLine: number;
}

/**
 * Extract every fenced block whose opening line matches `open`, closed by
 * `close` (default: a bare column-0 ` ``` `). The opening pattern is tested
 * only when not already inside a fence, so an opener appearing in a fence
 * body is body text, not a nested fence.
 *
 * Both patterns must be `g`-flag-free — a stateful regex would skip lines
 * between calls to `test`.
 */
export function findFences(
  content: string,
  open: RegExp,
  close: RegExp = DEFAULT_FENCE_CLOSE,
): Fence[] {
  const fences: Fence[] = [];
  const lines = content.split("\n");
  let openIndex = -1;
  let buf: string[] = [];
  const flush = (endLine: number): void => {
    fences.push({
      startLine: openIndex + 1,
      endLine,
      lines: buf,
      body: buf.join("\n"),
      bodyStartLine: openIndex + 2,
    });
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (openIndex < 0) {
      if (open.test(line)) {
        openIndex = i;
        buf = [];
      }
      continue;
    }
    if (close.test(line)) {
      flush(i + 1);
      openIndex = -1;
      buf = [];
      continue;
    }
    buf.push(line);
  }
  if (openIndex >= 0) flush(-1);
  return fences;
}

export interface BashFence {
  /** 1-based; line of the opening ` ```bash ` marker. */
  startLine: number;
  /** Inner block text (between fence markers), joined with `\n`. */
  body: string;
  /** 1-based; line of the first inner-body line (i.e. `startLine + 1`). */
  bodyStartLine: number;
}

/**
 * Extract every fenced ```bash block from a markdown document.
 *
 * Only `` ```bash `` opens a fence (other languages and bare ` ``` `
 * fences are ignored). Closing line is bare ` ``` ` (any trailing
 * whitespace tolerated). Unterminated fences (EOF before closing) are
 * dropped silently — both call sites prefer "skip malformed input" over
 * "throw on malformed input" because the probes run in `/gate-check`'s
 * fail-soft list.
 */
export function extractBashFences(content: string): BashFence[] {
  return findFences(content, /^```bash\s*$/)
    .filter((fence) => fence.endLine > 0)
    .map(({ startLine, body, bodyStartLine }) => ({
      startLine,
      body,
      bodyStartLine,
    }));
}
