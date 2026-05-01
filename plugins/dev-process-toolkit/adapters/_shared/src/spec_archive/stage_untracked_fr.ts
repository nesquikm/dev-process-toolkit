// stage_untracked_fr — STE-171 AC-STE-171.2 pure decision helper.
//
// Phase 4 § Milestone Archival runs `git status --porcelain <frPath>` and
// feeds the output here to decide whether to `git add <frPath>` before
// `git mv`. Untracked (`??`) FR files dropped through `git mv` would
// fall back to plain `mv` and lose rename history — `git log --follow`
// then can't trace the pre-archive state. Staging first preserves the
// rename so probe #28 + traceability surface stay coherent.
//
// Pure parser: takes the porcelain string + the FR's repo-relative path,
// returns true iff a `?? <path>` line is present. The actual `git add`
// invocation lives in the LLM-as-runtime's Bash step.

const PORCELAIN_LINE_RE = /^\?\?\s+(.+)$/;

function normalize(p: string): string {
  return p.replace(/^\.\//, "").trim();
}

export function isFRUntrackedInPorcelain(porcelain: string, frPath: string): boolean {
  if (porcelain.length === 0) return false;
  const target = normalize(frPath);
  for (const rawLine of porcelain.split("\n")) {
    const m = PORCELAIN_LINE_RE.exec(rawLine);
    if (!m) continue;
    if (normalize(m[1]!) === target) return true;
  }
  return false;
}
