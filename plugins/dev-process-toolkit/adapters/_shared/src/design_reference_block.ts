// design_reference_block — the SOLE renderer of the design-reference block
// that /implement Phase 4b" hands to a project's resolved check skill, and
// that the `manual`-mode reminder prints. One definition of the block's shape:
// every caller renders through `renderDesignReferenceBlock`, nobody re-emits
// the header or the row shape by hand.
//
// Pure + total: it takes rows (already scanned and FR-scoped by the caller),
// never opens a file, and never throws. An unresolved path renders as skipped
// rather than failing — the /gate-check `design_references_resolve` probe
// already owns that condition at error severity.
//
// Zero rows render the EMPTY STRING: an FR that cites no reference invokes the
// check skill byte-identically to a project that never adopted the capability.

import { resolve } from "node:path";

import {
  scanDesignReferences,
  type DesignReferenceRow,
} from "./scan_design_references";

/**
 * One design reference, as the scanner emits it (caption included).
 *
 * The shape IS the scanner's row — a name for it on the consumer side, never a
 * restatement of its fields. Re-declaring even one field here (`caption`, say)
 * would give the consumer a second definition that a scanner-side rename could
 * silently satisfy; aliasing means a field the scanner adds, drops or retypes
 * arrives here instead of drifting.
 */
export type DesignReferenceBlockRow = DesignReferenceRow;

/** The rendered block plus the counts + capability token its caller reports. */
export interface DesignReferenceBlock {
  /** The block's lines; `[]` when nothing is rendered. */
  lines: readonly string[];
  /** `lines.join("\n")`; the empty string when nothing is rendered. */
  text: string;
  /** The capability token the step-14 closing summary emits for this block. */
  token: string;
  /** Rows handed to the check skill as usable images. */
  rendered: number;
  /** Rows named but skipped because the path does not resolve on disk. */
  skipped: number;
}

/**
 * The capability-token pair for the design-reference hand-off: `passed` when
 * the FR cited at least one reference, `none` when it cited none. Exactly one
 * fires per run.
 */
export const DESIGN_REFERENCE_CAPABILITY_TOKENS = {
  passed: "design_references_passed",
  none: "design_references_none_cited",
} as const;

/**
 * The FR's own design references: the scanner's rows narrowed to the entries
 * authored in one spec file.
 *
 * The consumer side opens no file and parses no heading — `scanDesignReferences`
 * is the only reader, and `DesignReferenceRow.file` is the only key the
 * narrowing uses, so an FR sees its own citations and nothing else.
 *
 * @param projectRoot absolute path of the project root the scanner walks
 * @param specFile    repo-root-relative path of the FR's spec file
 * @returns the rows authored in `specFile`, in scan order; `[]` when it cites
 *          nothing (or does not exist)
 */
export function designReferencesForSpec(
  projectRoot: string,
  specFile: string,
): DesignReferenceBlockRow[] {
  // Filter only — the scanner's rows are handed on as they were emitted. No
  // per-field rebuild, no defaulted `caption`: a copy written here is a second
  // place the row shape is decided, and it defaults away exactly the field the
  // scanner learned to parse.
  return scanDesignReferences(projectRoot).filter(
    (row) => row.file === specFile,
  );
}

/** The block header — declared here, and only here. */
const BLOCK_HEADER = "Design references:";
/**
 * Marker for a row the check skill cannot open, written BEFORE the path.
 *
 * Position, not wording, is what makes it unambiguous. As a trailing suffix it
 * sat in the caption's own slot, so a resolved row whose author wrote a caption
 * quoting this text rendered one em dash away from a genuinely unresolved row —
 * and the block is prose read by an LLM, which has nothing but those bytes. The
 * marker slot is ahead of the code span, where a caption can never appear,
 * because a caption is by construction what follows the path.
 */
const UNRESOLVED_MARKER = "[unresolved on disk — skipped]";

/**
 * Render the design-reference block for one FR's rows.
 *
 * PATH INVARIANT, and where it is enforced. Each path is written into a
 * backtick code span verbatim, so a path containing a backtick would break the
 * span. Nothing is validated here on purpose: the only producer of these rows
 * is `scanDesignReferences`, whose `FIRST_BACKTICK_RE` captures `[^`]+` and
 * therefore cannot emit one — the invariant holds at the single place that can
 * enforce it, and is pinned by a test against the scanner rather than by a
 * branch here that no reachable input could take. A future second producer
 * inherits the obligation, which is why it is written down.
 *
 * The CAPTION carries no such invariant and is not given one: it is free prose
 * the scanner copies verbatim, so an odd backtick in it leaves the row's
 * trailing text inside an unclosed span. It cannot forge a row — the skip
 * marker sits ahead of the code span and the path is the first closed token
 * regardless — and sanitizing it would mean rewriting authored text, which is
 * what this renderer exists not to do. Measured and pinned as known, not
 * silently handled.
 *
 * @param rows the FR's design references, already scoped to its spec file
 * @returns the block text/lines, the rendered/skipped counts, and the
 *          capability token for the closing summary
 */
export function renderDesignReferenceBlock(
  rows: readonly DesignReferenceBlockRow[],
): DesignReferenceBlock {
  if (rows.length === 0) {
    return {
      lines: [],
      text: "",
      token: DESIGN_REFERENCE_CAPABILITY_TOKENS.none,
      rendered: 0,
      skipped: 0,
    };
  }

  const lines: string[] = [BLOCK_HEADER];
  let rendered = 0;
  let skipped = 0;

  for (const row of rows) {
    const parts: string[] = ["-"];
    if (row.resolves) {
      rendered += 1;
    } else {
      skipped += 1;
      parts.push(UNRESOLVED_MARKER);
    }
    parts.push(`\`${row.path}\``);
    if (row.caption !== null && row.caption !== "") {
      parts.push(`— ${row.caption}`);
    }
    lines.push(parts.join(" "));
  }

  return {
    lines,
    text: lines.join("\n"),
    token: DESIGN_REFERENCE_CAPABILITY_TOKENS.passed,
    rendered,
    skipped,
  };
}

// The command-line front door, mirroring `gate_capture.ts`'s. Imported by
// consumers wanting the two functions above, `import.meta.main` is false and
// this block never runs, so the module stays side-effect-free at import. Usage:
//
//   bun run design_reference_block.ts <projectRoot> <frSpecFile>
//
// WHY IT EXISTS, and it is not convenience. Phase 4b″'s consumer is PROSE run
// by an LLM, not a TypeScript caller. Without an entry point the only way to
// obtain the block is to re-emit the header and the row shape by hand at the
// moment of use — a second definition of the shape, which is the one thing
// AC-STE-596.2 forbids. A runnable order hands the executor the renderer's own
// bytes instead, so the producer and any grader read the same function.
//
// It also makes the module REACHABLE in the `module_reachability` sense (probe
// #81), which is what lets Phase 4b″ name this path on an ordered line at all:
// a front-door-less module named on an ordered line raises that probe's pin,
// and the pin ledger refuses a recorded raise.
//
// The token is printed on its own line, ALWAYS — including the cites-none case,
// where the block itself is empty. A run that printed nothing would leave the
// caller unable to tell "cited none" from "the command failed", which is the
// distinction the token pair exists to carry.
if (import.meta.main) {
  const [projectRoot, specFile] = [process.argv[2], process.argv[3]];
  if (projectRoot === undefined || specFile === undefined) {
    console.error(
      "design_reference_block: usage: bun run design_reference_block.ts <projectRoot> <frSpecFile>",
    );
    process.exitCode = 1;
  } else {
    const block = renderDesignReferenceBlock(
      designReferencesForSpec(resolve(projectRoot), specFile),
    );
    if (block.text !== "") console.log(block.text);
    console.log(
      `design_reference_block: ${block.token} (${block.rendered} rendered, ${block.skipped} skipped)`,
    );
  }
}
