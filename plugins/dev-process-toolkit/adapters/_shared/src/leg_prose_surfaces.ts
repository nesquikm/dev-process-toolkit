// leg_prose_surfaces — STE-446: the five prose surfaces that must enumerate
// exactly the legs `SMOKE_LEGS` registers.
//
// WHAT THIS MODULE IS. Each surface answers ONE question about a driver
// document: *which leg tokens does this surface's prose actually enumerate?*
// That answer is the ACTUAL side of a comparison whose EXPECTED side is always
// `SMOKE_LEGS`, supplied by the caller. This module never states the expected
// side and never imports it.
//
// THE DIRECTION IS THE OPPOSITE OF `leg_derivation_mutation`'s, AND BOTH ARE
// RIGHT. That module's `CANONICAL_LEG_ERROR_PATTERN` is a hand-written literal
// precisely because the text it asserts against is itself built from the leg
// enum — deriving the expectation there would move both sides together and the
// assertion could never fail. Here the two sides are genuinely different
// artifacts: the TypeScript enum is the authority, the driver markdown is an
// independently hand-maintained document. Deriving is circular only when BOTH
// sides trace to the same source; here they do not, which is what makes these
// bindings real.
//
// THE ONE-WAY RULE IS ENFORCED BY THE API, NOT BY DISCIPLINE. `proseLegs`
// takes exactly one argument — the documents — so a surface structurally
// cannot see the authority set it is being compared against and cannot agree
// with it by construction. This module is also handed document TEXT, never
// document PATHS: it opens no file and names no driver path, which is what
// keeps it eligible for registration in STE-445's `DERIVATION_TARGETS` (whose
// meta-test forbids an expectation-defining module from naming a driver file).

// --- document identity -----------------------------------------------------

/** The two project-local driver documents these surfaces span. */
export type LegProseDocId = "conformance-loop" | "smoke-test";

/** Document TEXT, keyed by driver. Never paths — see the header note. */
export type LegProseDocs = Readonly<Record<LegProseDocId, string>>;

/** One `{ … } &` group of the loop driver's Phase A spawn fence. */
export interface SpawnFenceGroup {
  /** The group's `--tracker <token>` value; `""` when it names none. */
  tracker: string;
  /** Every `<leg>` appearing as `dpt-smoke-verdict-<leg>.json` in the body. */
  verdictLegs: readonly string[];
}

export interface LegProseSurface {
  /** Stable id. */
  id: string;
  /** What is asserted against, IN WORDS — never a file path. */
  asserts: string;
  /** Which driver documents this surface spans. */
  documents: readonly LegProseDocId[];
  /**
   * The leg tokens this surface's prose actually enumerates, deduped, in
   * document order. Deliberately does NOT receive the authority set.
   */
  proseLegs(docs: LegProseDocs): readonly string[];
}

// --- shared text mechanics -------------------------------------------------

/** Order-preserving dedupe; blanks dropped. */
function dedupe(tokens: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of tokens) {
    const t = token.trim();
    if (t === "" || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/**
 * The bodies of every column-0 fenced block, in document order.
 *
 * Column-0 only, because every fence in both drivers opens and closes there;
 * anchoring keeps an indented back-tick run inside a body from being mistaken
 * for a fence boundary and re-pairing the whole document.
 */
function fencedBlocks(doc: string): readonly string[] {
  const re = /^```[^\n]*\n([\s\S]*?)^```/gm;
  const out: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(doc)) !== null) out.push(match[1]!);
  return out;
}

/** The bodies of every `{ … } &` brace group in one fence, in fence order. */
function braceGroups(fence: string): readonly string[] {
  const re = /^\{[ \t]*\n([\s\S]*?)^\}[ \t]*&/gm;
  const out: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(fence)) !== null) out.push(match[1]!);
  return out;
}

/** All capture-group-1 hits of `re` (which must be global) over `text`. */
function captures(text: string, re: RegExp): readonly string[] {
  return [...text.matchAll(re)].map((match) => match[1] ?? "");
}

// --- surface (i): the Phase A spawn fence ----------------------------------

/**
 * Structured view of the loop driver's Phase A spawn fence.
 *
 * The fence is located by SHAPE, not by leg name: it is the one fenced block
 * that both mentions `--tracker` and contains at least one `{ … } &` brace
 * group. Locating it by a hardcoded leg would reinstate exactly the slicing
 * technique STE-446 exists to retire — and would quietly stop finding the fence
 * the day that leg is renamed.
 */
export function parseSpawnFenceGroups(
  conformanceLoopDoc: string,
): readonly SpawnFenceGroup[] {
  const fence = fencedBlocks(conformanceLoopDoc).find(
    (block) => block.includes("--tracker") && braceGroups(block).length > 0,
  );
  if (fence === undefined) return [];
  return braceGroups(fence).map((body) => ({
    // A templated `--tracker ${X}` deliberately does not match: it names no
    // leg, so the group reports `""` rather than a phantom token.
    tracker: /--tracker[ \t]+([A-Za-z][A-Za-z0-9_-]*)/.exec(body)?.[1] ?? "",
    verdictLegs: dedupe(
      captures(body, /dpt-smoke-verdict-([A-Za-z][A-Za-z0-9_-]*)\.json/g),
    ),
  }));
}

// --- surface (ii): pre-flight #6's basename allow-list ---------------------

/**
 * The shell `case` arm the smoke driver's pre-flight #6 ships, e.g.
 * `dpt-test-project-linear|dpt-test-project-jira) ;;`. One arm, one line.
 */
const PREFLIGHT_CASE_ARM_RE =
  /^[ \t]*(dpt-test-project-[A-Za-z0-9_|-]*)\)[ \t]*;;/m;

const TEST_PROJECT_PREFIX = "dpt-test-project-";

// --- surface (iii): the `green` probe's findings-file list ------------------

/**
 * The `green` termination probe, located by the status it assigns rather than
 * by any leg it names. Scoping to this fence is what keeps the surface honest:
 * the same findings-file paths appear in the aggregation section, and a
 * whole-document scan would report that list instead of this probe's.
 */
const GREEN_PROBE_MARKER = "STATUS=green";

/** `/tmp/dpt-smoke-findings-<date>-<leg>.md`, in any of the drivers' date forms. */
const FINDINGS_FILE_RE =
  /dpt-smoke-findings-(?:\$\{DATE\}|\$DATE|<date>|<DATE>)-([A-Za-z][A-Za-z0-9_-]*)\.md/g;

// --- surface (iv): the closing-summary table columns -----------------------

/** The summary table's header row, identified by its leading `iter` column. */
const SUMMARY_HEADER_RE = /\|\s*iter\s*\|/;

/** `high (<leg>)` — one column per leg. */
const HIGH_COLUMN_RE = /high\s*\(([^)]*)\)/g;

// --- surface (v): the pidfile globs ----------------------------------------

/**
 * A loop-driver pidfile path. The leg is the LAST `-` segment before `.pid`,
 * either spelled out or written as a `{a,b}` brace expansion. A `*` glob and a
 * `${LEG}` template name no leg and contribute nothing, which is correct: they
 * are leg-agnostic by construction and there is nothing there to drift.
 */
const LOOP_PIDFILE_RE = /\/tmp\/dpt-conformance-loop-[^\s`'")]*\.pid/g;
const PIDFILE_BRACE_LEGS_RE = /-\{([^}]*)\}\.pid$/;
const PIDFILE_LITERAL_LEG_RE = /-([A-Za-z][A-Za-z0-9_]*)\.pid$/;

/** The poll loop's word list, e.g. `for LEG in linear jira none; do`. */
const POLL_LOOP_WORDS_RE = /for[ \t]+LEG[ \t]+in[ \t]+([^\n;]+?)[ \t]*;?[ \t]*do/;

/**
 * A smoke-driver pidfile path. Here the leg is the FIRST segment instead — the
 * family is `/tmp/dpt-smoke-<tracker>-<skill>.pid` — and in the shipped driver
 * that segment is always `<tracker>`-templated, so this half contributes no
 * literal legs. That is deliberate and load-bearing: STE-423's scan requires
 * every `dpt-smoke-` literal in that driver to carry a tracker segment its own
 * closed alternation recognizes, so per-leg ENUMERATION belongs in the loop
 * driver, which STE-423 declares out of scope. The half is still read rather
 * than assumed: a literal leg appearing here would be reported, not ignored.
 */
const SMOKE_PIDFILE_RE = /\/tmp\/dpt-smoke-[^\s`'")]*\.pid/g;
const SMOKE_PIDFILE_SEGMENT_RE = /^\/tmp\/dpt-smoke-([^-/]+)-/;
const BARE_LEG_TOKEN_RE = /^[a-z][a-z0-9_]*$/;

// --- the registry ----------------------------------------------------------

/**
 * One entry per Requirement bullet. Every `proseLegs` is arity 1 by
 * construction — a second parameter would be the authority set, and a surface
 * that can see what it is compared against can agree with it for free.
 */
export const LEG_PROSE_SURFACES: readonly LegProseSurface[] = [
  {
    id: "spawn-fence-brace-groups",
    asserts:
      "the loop driver's Phase A spawn fence — the --tracker token of each " +
      "brace group, in fence order",
    documents: ["conformance-loop"],
    proseLegs: (docs) =>
      dedupe(
        parseSpawnFenceGroups(docs["conformance-loop"]).map(
          (group) => group.tracker,
        ),
      ),
  },
  {
    id: "preflight-6-basename-allowlist",
    asserts:
      "the smoke driver's pre-flight #6 shell case arm — the leg suffix of " +
      "each dpt-test-project-<leg> alternative",
    documents: ["smoke-test"],
    proseLegs: (docs) => {
      const arm = PREFLIGHT_CASE_ARM_RE.exec(docs["smoke-test"]);
      if (arm === null) return [];
      return dedupe(
        arm[1]!
          .split("|")
          .filter((alt) => alt.startsWith(TEST_PROJECT_PREFIX))
          .map((alt) => alt.slice(TEST_PROJECT_PREFIX.length)),
      );
    },
  },
  {
    id: "green-probe-findings-files",
    asserts:
      "the loop driver's green termination probe — the leg segment of each " +
      "per-leg findings file it counts high-severity lines in",
    documents: ["conformance-loop"],
    proseLegs: (docs) => {
      const fence = fencedBlocks(docs["conformance-loop"]).find((block) =>
        block.includes(GREEN_PROBE_MARKER),
      );
      if (fence === undefined) return [];
      return dedupe(captures(fence, FINDINGS_FILE_RE));
    },
  },
  {
    id: "closing-summary-columns",
    asserts:
      "the loop driver's closing-summary table — the leg of each high (<leg>) column",
    documents: ["conformance-loop"],
    proseLegs: (docs) => {
      const header =
        docs["conformance-loop"]
          .split(/\r?\n/)
          .find((line) => SUMMARY_HEADER_RE.test(line)) ?? "";
      return dedupe(captures(header, HIGH_COLUMN_RE));
    },
  },
  {
    id: "pidfile-globs",
    asserts:
      "both drivers' pidfile paths — the loop driver's per-leg pidfiles and " +
      "poll-loop word list, plus the smoke driver's tracker segment",
    documents: ["conformance-loop", "smoke-test"],
    proseLegs: (docs) => {
      const loop = docs["conformance-loop"];
      const legs: string[] = [];

      for (const path of loop.match(LOOP_PIDFILE_RE) ?? []) {
        const brace = PIDFILE_BRACE_LEGS_RE.exec(path);
        if (brace !== null) {
          legs.push(...brace[1]!.split(","));
          continue;
        }
        const literal = PIDFILE_LITERAL_LEG_RE.exec(path);
        if (literal !== null) legs.push(literal[1]!);
      }

      const words = POLL_LOOP_WORDS_RE.exec(loop);
      if (words !== null) legs.push(...words[1]!.trim().split(/\s+/));

      for (const path of docs["smoke-test"].match(SMOKE_PIDFILE_RE) ?? []) {
        const segment = SMOKE_PIDFILE_SEGMENT_RE.exec(path)?.[1] ?? "";
        if (BARE_LEG_TOKEN_RE.test(segment)) legs.push(segment);
      }

      return dedupe(legs);
    },
  },
];
