// STE-546 correction round — the two REGION extractors that the surface-agreement
// pins assert over, in one place so both the pin and its mutation proof read the
// SAME code.
//
// Why a shared module rather than a copy in each file: a mutation test that
// proves a LOCAL copy falsifiable proves nothing about the pin in the other file.
// That is the wrong-subject class this repo keeps re-landing — a perfect pin on
// a subject nobody asserts over.

/** Normalizes CRLF so line-index arithmetic and line-anchored slices agree. */
const lf = (text: string): string => text.replace(/\r\n/g, "\n");

/**
 * The `release_surface_agreement.ts` region a "the check no longer locates by
 * position" pin is actually about: `checkReleaseSurfaceAgreement`'s body, ending
 * at the banner that opens the disk-level section.
 *
 * Everything after that banner — `runReleaseSurfaceAgreement` and the
 * `import.meta.main` door — legitimately wants the NEWEST entry when its caller
 * names no version, so a slice running to EOF forbids a correct default and
 * fails for a reason no pin claims.
 */
export const DISK_SECTION_BANNER = "// The disk-level entry both production callers share";

const CHECK_DECL = "export function checkReleaseSurfaceAgreement";

export function checkPortion(source: string): string {
  const text = lf(source);
  const start = text.indexOf(CHECK_DECL);
  if (start === -1) {
    throw new Error(
      `checkPortion: no \`${CHECK_DECL}\` in the source — the region this pin asserts over ` +
        "does not exist, so a passing verdict would be vacuous.",
    );
  }
  const end = text.indexOf(DISK_SECTION_BANNER, start);
  if (end === -1) {
    throw new Error(
      `checkPortion: no \`${DISK_SECTION_BANNER}\` after the check declaration — the end ` +
        "bound is gone, so the region would silently widen back to EOF.",
    );
  }
  return text.slice(start, end);
}

export interface CeremonyWindow {
  /** 0-based line index of the real (non-dry-run) release-file rewrite. */
  readonly write: number;
  /** 0-based line index of the `git add` staging instruction. */
  readonly stage: number;
  /** 0-based line indices of every `release_surface_agreement` mention. */
  readonly agreementLines: number[];
}

// The REAL rewrite, not the step-4 preview: same command, no `--dry-run`.
const WRITE_RE = /release_config\.ts/;
// The staging instruction itself. Prose ABOUT `git add` ("abort before `git add`")
// appears earlier and above the check; anchoring on a bare "git add" substring
// would resolve the bound to that prose and invert the assertion.
const STAGE_RE = /^`git add` the expected-modified set/;

/**
 * Locates the ship-ceremony window in `skills/ship-milestone/SKILL.md`:
 * the last non-dry-run release-file write, and the staging step.
 */
export function shipCeremonyWindow(skill: string): CeremonyWindow {
  const lines = lf(skill).split("\n");
  const writes = lines
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => WRITE_RE.test(l) && !l.includes("--dry-run"))
    .map(({ i }) => i);
  if (writes.length === 0) {
    throw new Error(
      "shipCeremonyWindow: no non-dry-run `release_config.ts` invocation — the release-file " +
        "write bound does not exist, so an ordering verdict would be vacuous.",
    );
  }
  const stages = lines.map((l, i) => ({ l, i })).filter(({ l }) => STAGE_RE.test(l)).map(({ i }) => i);
  if (stages.length !== 1) {
    throw new Error(
      `shipCeremonyWindow: the \`git add\` staging instruction matched ${stages.length} times ` +
        "(expected exactly 1); the window's upper bound is ambiguous.",
    );
  }
  return {
    write: writes[writes.length - 1]!,
    stage: stages[0]!,
    agreementLines: lines
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => l.includes("release_surface_agreement"))
      .map(({ i }) => i),
  };
}
