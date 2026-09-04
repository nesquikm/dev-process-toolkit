// check_external_link (STE-542 AC-STE-542.4 / AC-STE-542.6) — external-link
// reachability classifier.
//
// Pure function `classifyLinkVerdict(probe)` returns one of
// `"reachable" | "dead" | "unchecked"` from ONE run-level connectivity
// preflight plus the single response the probe observed:
//
//   preflight "offline" → "unchecked" for EVERY row (short-circuit; never
//     "dead"). Per-URL error-code sniffing cannot tell a dead host from an
//     absent network — `ENOTFOUND` reads identically in both — so when the
//     run could not reach the network at all, nothing is asserted.
//   preflight "online"  → an HTTP answer of any kind proves the host is
//     live, EXCEPT absence (404/410) and server error (5xx); a transport
//     failure (no HTTP answer at all) is dead.
//
// The 401-vs-403 split: both are authorization CHALLENGES from a live host
// and read `reachable`. The "refusal" that reads `dead` is the transport
// refusal (`ECONNREFUSED`), not HTTP 403.
//
// CLI shim: `bun run check_external_link.ts <online|offline> <status-or-code>`
//   - prints `REACHABLE`, `DEAD` or `UNCHECKED` on a single line of stdout
//   - exits 0 on success, non-zero on argument errors

/** Run-level connectivity preflight — decided once per run, not per URL. */
export type LinkPreflight = "online" | "offline";

/** What the probe observed: an HTTP status, or a transport-level error code. */
export type LinkProbeResponse = { status: number } | { code: string };

export type LinkVerdict = "reachable" | "dead" | "unchecked";

export type LinkProbe = { preflight: LinkPreflight } & LinkProbeResponse;

/** HTTP statuses that mean the resource is absent even though the host answered. */
const ABSENT_STATUSES: ReadonlySet<number> = new Set([404, 410]);

/**
 * Pure classifier. No network, no FS, no env reads — the caller performs the
 * preflight and the probe, this decides the verdict.
 */
export function classifyLinkVerdict(probe: LinkProbe): LinkVerdict {
  // AC-STE-542.6 — the preflight dominates: an offline run asserts nothing.
  if (probe.preflight === "offline") return "unchecked";

  // AC-STE-542.4 — transport failure: no HTTP answer at all.
  if (!("status" in probe)) return "dead";

  const { status } = probe;
  // Absence (404/410) and server error (5xx) are dead; every other HTTP
  // answer — 2xx, 3xx, and the 401/403 authorization challenges — proves a
  // live host and reads reachable.
  if (ABSENT_STATUSES.has(status)) return "dead";
  if (status >= 500) return "dead";
  return "reachable";
}

const VERDICT_TOKEN: Record<LinkVerdict, string> = {
  reachable: "REACHABLE",
  dead: "DEAD",
  unchecked: "UNCHECKED",
};

function buildUsageErrorMessage(reason: string): string {
  return [
    `check_external_link: argument error: ${reason}.`,
    `Remedy: invoke as \`bun run check_external_link.ts <online|offline> ` +
      `<http-status|error-code>\` (e.g. \`online 404\`, \`online ENOTFOUND\`).`,
    `Context: helper=check_external_link, severity=error`,
  ].join("\n");
}

function main(argv: string[]): number {
  const preflight = argv[2];
  const observed = argv[3];
  if (preflight !== "online" && preflight !== "offline") {
    process.stderr.write(
      buildUsageErrorMessage(
        `argv[2] must be 'online' or 'offline' (got ${
          preflight === undefined ? "nothing" : `'${preflight}'`
        })`,
      ) + "\n",
    );
    return 2;
  }
  if (observed === undefined || observed === "") {
    process.stderr.write(
      buildUsageErrorMessage(
        "argv[3] must be an HTTP status or a transport error code",
      ) + "\n",
    );
    return 2;
  }
  const response: LinkProbeResponse = /^[0-9]+$/.test(observed)
    ? { status: Number(observed) }
    : { code: observed };
  const verdict = classifyLinkVerdict({ preflight, ...response });
  process.stdout.write(`${VERDICT_TOKEN[verdict]}\n`);
  return 0;
}

// Bun entry guard: only run main when the module is invoked directly, not
// when it is imported by a test or by the /spec-write flow.
if (import.meta.main) {
  process.exit(main(process.argv));
}

// ---------------------------------------------------------------------------
// Authoring-time helpers: run the checks, format the recorded line, write the
// rows back into an FR body. `formatExternalReferenceLine` is the emit side of
// the round-trip whose parse side is `scanExternalReferences`
// (adapters/_shared/src/scan_design_references.ts).
// ---------------------------------------------------------------------------

/** How the author classified the link when it was supplied. */
export type LinkClassification = "required" | "informational";

/** One external link as supplied during a run, before it is checked. */
export interface ExternalLinkRow {
  url: string;
  caption: string;
  classification: LinkClassification;
}

/** One external link after the reachability check. */
export interface ExternalLinkCheck extends ExternalLinkRow {
  verdict: LinkVerdict;
  checkedAt: string;
}

export interface ExternalLinkCheckOptions {
  /** Injected fetch. Never called when `preflight` is "offline". */
  fetchImpl: (url: string) => Promise<{ status: number }>;
  /** Run-level connectivity preflight, decided once per run. */
  preflight: LinkPreflight;
  /** Injected clock. */
  now: () => Date;
}

/**
 * Check every supplied row, in order. A run citing no external link performs
 * ZERO requests (AC-STE-542.7); an offline run short-circuits to "unchecked"
 * for every row and never touches the network (AC-STE-542.6).
 */
export async function runExternalLinkChecks(
  rows: readonly ExternalLinkRow[],
  options: ExternalLinkCheckOptions,
): Promise<ExternalLinkCheck[]> {
  const { fetchImpl, preflight, now } = options;
  const out: ExternalLinkCheck[] = [];
  for (const row of rows) {
    let response: LinkProbeResponse;
    if (preflight === "offline") {
      // Nothing is asserted, so nothing is requested.
      response = { code: "OFFLINE" };
    } else {
      try {
        const answer = await fetchImpl(row.url);
        response = { status: answer.status };
      } catch (err) {
        response = {
          code: (err as { code?: string })?.code ?? "ETRANSPORT",
        };
      }
    }
    out.push({
      ...row,
      verdict: classifyLinkVerdict({ preflight, ...response }),
      checkedAt: now().toISOString(),
    });
  }
  return out;
}

/** The recorded line shape: `` - `<url>` — <caption> (checked <ISO>: <verdict>) ``. */
export function formatExternalReferenceLine(entry: {
  url: string;
  caption: string;
  checkedAt: string;
  verdict: LinkVerdict;
}): string {
  return `- \`${entry.url}\` — ${entry.caption} (checked ${entry.checkedAt}: ${entry.verdict})`;
}

// The heading grammar is a LOCAL copy of the three regexes in
// `scan_design_references.ts` rather than a shared import.
//
// The original reason is SPENT, and is recorded here rather than quietly left
// standing: this copy existed because importing the scanner from a module with
// an `import.meta.main` front door would make the scanner transitively
// reachable and move probe #81's pin. `external_link_verdicts.ts` has since
// done precisely that, and the pin was lowered 130 → 129 to record it. So the
// cost this copy was avoiding has already been paid, and nothing keeps the two
// copies in sync — which is the producer/consumer asymmetry M140's own FR says
// has shipped in this repository three times.
//
// Not consolidated here because collapsing it means adding another import edge,
// and probe #81's pin moves on import topology: that is a second pin move in
// one milestone, unrelated to either FR's ACs. Left as an M140 follow-up.
const H2_RE = /^## /;
const DESIGN_REFS_HEADING_RE = /^##[ \t]+Design References[ \t]*$/;
const EXTERNAL_REFS_HEADING_RE = /^##[ \t]+External References[ \t]*$/;

/** Index of the first line after the section opened at `headingIdx`. */
function sectionEnd(lines: readonly string[], headingIdx: number): number {
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (H2_RE.test(lines[i]!)) return i;
  }
  return lines.length;
}

/** Insertion point inside a section: after its last non-blank line. */
function appendPoint(lines: readonly string[], headingIdx: number): number {
  let at = sectionEnd(lines, headingIdx);
  while (at - 1 > headingIdx && lines[at - 1]!.trim() === "") at--;
  return at;
}

function headingIndex(lines: readonly string[], re: RegExp): number {
  return lines.findIndex((l) => re.test(l));
}

/**
 * Append `rendered` under the section `headingRe` opens, creating that section
 * (heading + blank line) at `createAt()` when the body has none. `createAt` is
 * evaluated lazily and against the CURRENT `lines`, so an earlier append that
 * itself created a section is visible to a later one.
 */
function appendUnderSection(
  lines: string[],
  headingRe: RegExp,
  heading: string,
  rendered: readonly string[],
  createAt: () => number,
): void {
  const idx = headingIndex(lines, headingRe);
  if (idx !== -1) {
    lines.splice(appendPoint(lines, idx), 0, ...rendered);
    return;
  }
  lines.splice(createAt(), 0, heading, "", ...rendered, "");
}

/**
 * Write checked external links back into an FR body. Required links join
 * `## Design References`; informational links join `## External References`,
 * created immediately after `## Design References` when absent
 * (AC-STE-542.2). An empty `checks` list returns the body byte-identical and
 * emits no heading (AC-STE-542.7).
 */
export function recordExternalReferences(
  body: string,
  checks: readonly ExternalLinkCheck[],
): string {
  if (checks.length === 0) return body;

  const rowsFor = (c: LinkClassification): string[] =>
    checks
      .filter((check) => check.classification === c)
      .map(formatExternalReferenceLine);

  const required = rowsFor("required");
  const informational = rowsFor("informational");
  const lines = body.split("\n");

  if (required.length > 0) {
    // A body with no `## Design References` gets one at the end.
    appendUnderSection(
      lines,
      DESIGN_REFS_HEADING_RE,
      "## Design References",
      required,
      () => lines.length,
    );
  }

  if (informational.length > 0) {
    // `## External References` is created immediately after the
    // `## Design References` section (AC-STE-542.2), or at the end when there
    // is no design section to sit behind.
    appendUnderSection(
      lines,
      EXTERNAL_REFS_HEADING_RE,
      "## External References",
      informational,
      () => {
        const designIdx = headingIndex(lines, DESIGN_REFS_HEADING_RE);
        return designIdx === -1 ? lines.length : sectionEnd(lines, designIdx);
      },
    );
  }

  return lines.join("\n");
}
