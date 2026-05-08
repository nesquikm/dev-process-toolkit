// markdown_fences — shared helper for extracting fenced ```bash blocks
// from a markdown document. Hoisted (STE-252 refactor pass) out of
// duplicate copies in `auto_approve_marker.ts` (STE-226 probe #38) and
// `conformance_loop_bypass_removed.ts` (STE-252 probe #46) so a single
// implementation owns the fence-scan contract.
//
// Contract: returns each opening-` ```bash`-to-closing-`` ``` ``-line
// pair with (a) the 1-based start line of the opening fence marker,
// (b) the inner body text (joined with `\n`), and (c) the 1-based start
// line of the first body line. Stable across uses; both probes need to
// cite a `file:line` for diagnostics.

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
  const fences: BashFence[] = [];
  const lines = content.split("\n");
  let inFence = false;
  let bufStart = -1;
  let buf: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!inFence && /^```bash\s*$/.test(line)) {
      inFence = true;
      bufStart = i + 1; // 1-based, points at the ```bash line
      buf = [];
      continue;
    }
    if (inFence && /^```\s*$/.test(line)) {
      fences.push({
        startLine: bufStart,
        body: buf.join("\n"),
        bodyStartLine: bufStart + 1,
      });
      inFence = false;
      buf = [];
      continue;
    }
    if (inFence) buf.push(line);
  }
  return fences;
}
