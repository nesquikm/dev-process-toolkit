// M_2306b6 — a Linear binding whose `team:` holds the team's display name.
//
// The create decision (and the ownership and repoint checks) now read a Linear
// row's team from its identifier's prefix (`STE-618` → `STE`), because the
// server sends a row's `team` as the display name and `list_teams` exposes no
// key at all (measured 2026-09-21). A binding must therefore record the team's
// KEY. The template used to document `team: <team-name>`, so a project that
// followed it holds the display name, and every Linear create decision now
// refuses it — fail-closed, but a refusal the operator meets with no reason
// given. This entry makes that state gate-visible (probe #69 renders it on
// every /gate-check) and repairs it where the key is knowable locally.
//
// DETECT. The project is in `mode: linear` and `### Linear`.`team:` is not
// key-shaped (`^[A-Z][A-Z0-9]*$`). NAMED LIMIT: an all-caps display name that
// is not the team's key (a team called `ENG` keyed `EN`) looks key-shaped and
// is NOT detected — the same inference as the identifier-prefix rule, stated so
// a user in that state can read why nothing warned them.
//
// APPLY. The key is derived only from this repository's own Linear-bound FR
// files (active and archived): every `tracker: linear: <KEY>-<n>` prefix. When
// they all agree, the `team:` line is rewritten through the sub-section's one
// writer (`writeTrackerSubsection`). When there is no bound FR, or the prefixes
// disagree, apply REFUSES and names the hand-set remedy — it never guesses a
// key. Reachability: measured on the maintainer's machine only, where the one
// Linear-mode repository already binds the key.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parseFrontmatter } from "../../frontmatter";
import { readTaskTrackingSection } from "../../resolver_config";
import type * as BindingWrite from "../../setup/tracker_binding_write";
import { linearTeamKeyOf } from "../../tracker_answer";
import type * as WorkspaceBinding from "../../workspace_binding";
import type { ApplyResult, DetectResult, MigrationEntry } from "../index";

// The binding reader and its one writer both import `migrations/coverage`,
// which imports this registry: loading them at module load closes an import
// cycle through `migrations/index` and leaves this entry uninitialised when the
// registry reads it. They are loaded when first used instead.
const readWorkspaceBinding: typeof WorkspaceBinding.readWorkspaceBinding = (...a) =>
  (require("../../workspace_binding") as typeof WorkspaceBinding).readWorkspaceBinding(...a);
const writeTrackerSubsection: typeof BindingWrite.writeTrackerSubsection = (...a) =>
  (require("../../setup/tracker_binding_write") as typeof BindingWrite).writeTrackerSubsection(...a);

const KEY_SHAPED = /^[A-Z][A-Z0-9]*$/;

interface TeamKeyPlan {
  rel: string;
  claudeMd: string;
  project: string;
  team: string;
  /** The key every bound FR's identifier agrees on, or null with why. */
  key: string | null;
  why: string;
}

/** Every Linear tracker id bound by an FR file, active and archived. */
function boundLinearIds(projectRoot: string): string[] {
  const ids: string[] = [];
  for (const dir of [join(projectRoot, "specs", "frs"), join(projectRoot, "specs", "frs", "archive")]) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".md")) continue;
      let fm: Record<string, unknown>;
      try {
        fm = parseFrontmatter(readFileSync(join(dir, name), "utf-8"), { lenient: true });
      } catch {
        continue;
      }
      const t = fm.tracker;
      const id = t && typeof t === "object" ? (t as Record<string, unknown>).linear : undefined;
      if (typeof id === "string" && id !== "") ids.push(id);
    }
  }
  return ids;
}

function planTeamKey(projectRoot: string): TeamKeyPlan | null {
  const claudeMd = join(projectRoot, "CLAUDE.md");
  if (!existsSync(claudeMd)) return null;
  let mode: string | undefined;
  try {
    mode = readTaskTrackingSection(claudeMd)["mode"];
  } catch {
    return null;
  }
  if (mode !== "linear") return null;
  let binding: { team?: string; project?: string };
  try {
    binding = readWorkspaceBinding(claudeMd, "linear");
  } catch {
    return null; // a malformed binding is probe #25's to report, not this entry's
  }
  const team = binding.team;
  if (team === undefined || team === "" || KEY_SHAPED.test(team)) return null;
  const rel = relative(projectRoot, claudeMd);
  const base = { rel, claudeMd, project: binding.project ?? "", team };
  const prefixes = new Set<string>();
  const ids = boundLinearIds(projectRoot);
  for (const id of ids) {
    const k = linearTeamKeyOf(id);
    if (k === null) return { ...base, key: null, why: `the bound Linear id ${JSON.stringify(id)} does not parse as <TEAMKEY>-<n>` };
    prefixes.add(k);
  }
  if (ids.length === 0) return { ...base, key: null, why: "no FR in specs/frs/ or specs/frs/archive/ binds a Linear ticket, so the key cannot be derived locally" };
  if (prefixes.size > 1) return { ...base, key: null, why: `the bound Linear ids disagree on the team key (${[...prefixes].sort().join(", ")})` };
  return { ...base, key: [...prefixes][0]!, why: `every bound Linear id (${ids.length}) carries the prefix ${[...prefixes][0]}` };
}

const REMEDY = "set `team:` under `### Linear` to the team's KEY — the prefix of its issue identifiers (e.g. `STE` for `STE-618`) — by hand";

export const linearTeamKey: MigrationEntry = {
  id: "linear-team-key",
  introduced_in: "2.90.0",
  title: "A Linear binding's `team:` must be the team KEY (the issue-identifier prefix), not its display name",
  kind: "script",
  requires_explicit_approval: true,
  detect(projectRoot): DetectResult {
    const plan = planTeamKey(projectRoot);
    if (plan === null) return { applies: false, evidence: [] };
    return {
      applies: true,
      evidence: [
        plan.key === null
          ? `${plan.rel} — \`### Linear\` \`team: ${plan.team}\` is not a team key, so every Linear create decision refuses; ${plan.why}: ${REMEDY}. (An all-caps display name that is not the key looks key-shaped and is not detected.)`
          : `${plan.rel} — \`### Linear\` \`team: ${plan.team}\` is not a team key, so every Linear create decision refuses; ${plan.why}: rewrite it to \`team: ${plan.key}\`. (An all-caps display name that is not the key looks key-shaped and is not detected.)`,
      ],
    };
  },
  apply(projectRoot): ApplyResult {
    const plan = planTeamKey(projectRoot);
    if (plan === null) return { changed: [], summary: "nothing to repair: no Linear binding holds a display-name team" };
    if (plan.key === null) {
      return { changed: [], summary: `Refusing: ${plan.rel} binds \`team: ${plan.team}\`, and ${plan.why}; nothing was written. Remedy: ${REMEDY}.` };
    }
    const r = writeTrackerSubsection(plan.claudeMd, "linear", { project: plan.project, team: plan.key });
    return {
      changed: r.changed ? [plan.rel] : [],
      summary: `${plan.rel}: \`team: ${plan.team}\` → \`team: ${plan.key}\` (${plan.why})`,
    };
  },
};
