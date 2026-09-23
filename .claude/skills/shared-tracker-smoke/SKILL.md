---
name: shared-tracker-smoke
description: Build two throwaway repositories bound to one real Jira space or Linear project, run every live shared-tracker scenario through real claude -p child sessions, and grade the run from the recorded tool calls, tracker answers, receipts and git state — never from what a child says. Maintainer-only, started by keystrokes, one tracker per invocation. Real tracker writes.
argument-hint: '--tracker jira|linear [--jira-project KEY] [--jira-repoint-from KEY] [--linear-team KEY] [--old-client <plugin dir>] [--keep]'
disable-model-invocation: true
---

# /shared-tracker-smoke

Two repositories, `../dpt-shared-<tracker>-a` (A) and `../dpt-shared-<tracker>-b` (B), are bound to one real tracker container. Each shared-tracker scenario of the registry (`adapters/_shared/src/shared_tracker_scenarios.ts`) that applies live is run as one or more `claude -p` children, serially, one scenario marker per child. A program, `adapters/_shared/src/shared_tracker_live_grader.ts`, then turns the ledgered sessions' transcripts into an evidence bundle and grades it. The grader reads tool_use / tool_result pairs, receipts and git state only; it never reads assistant text, so nothing a child says can pass or fail the run.

**This is a project-local skill.** It lives in `.claude/skills/` of the dev-process-toolkit repository, not in the plugin, and `disable-model-invocation: true` means only a person typing `/shared-tracker-smoke` starts it. The live proof it produces is graded by the release gate, not by this document.

## Invocation

`/shared-tracker-smoke --tracker jira|linear` runs ONE tracker per invocation. Two terminals may run both trackers at once: every per-run path carries the tracker segment.

- **Jira.** `--jira-project <KEY>` (default `DST`) is the shared space. `--jira-repoint-from <KEY>` names a second throwaway space (for example `DST2`) that the operator creates by hand and that B starts bound to; the repoint scenario (S8) moves B from it into the shared space. The Atlassian MCP can neither create nor delete a space, so the shared space alone cannot host a repoint. With the flag, S8 is REQUIRED: not observed or failed fails the run. Without it, S8 is the named, reported skip `repoint-space-not-given` — in Phase 0, in the verdict artifact and in the closing summary — never silently omitted.
- **Linear.** `--linear-team <KEY>` (default `STE`). The skill creates the shared throwaway project and B's pre-repoint project itself, so S8 always runs on Linear.
- `--old-client <plugin dir>` defaults to the newest cached plugin that lacks the tracker-write hook.
- `--keep` skips the teardown prompts.

**Three client shapes, isolated by `--plugin-dir`.** Every child loads its plugin through `--plugin-dir`, which shadows the installed copy of the same plugin. The tree under test serves the normal scenarios. A scratch copy that differs only in its `plugin.json` version serves the below-floor client. The `--old-client` directory serves the old client. The intruder gets a plugin directory with no hooks at all, named `dev-process-toolkit` like the others: `--plugin-dir` shadows an installed plugin only by name, so under any other name the installed toolkit would load beside it with its hook (the 2026-09-23 Jira run lost its intruder that way). Isolation is graded, not assumed: the old client and the intruder carry no tracker-write hook, so a hook refusal in either session is `isolation-broken`.

**Paths.** Every per-run scratch path is `/tmp/dpt-shared-<tracker>-…`. The run state lives in `/tmp/dpt-shared-<tracker>-run.env`, which every fence after Phase 0.5 sources. Each such fence reads it only through the same run-state preamble, the lines between `# run-state preamble: begin` and `# run-state preamble: end`, byte-identical in every fence. The two lines above the preamble declare what that fence needs: `RUN_STATE_NEEDS` on every run, and `RUN_STATE_NEEDS_LINEAR` on a Linear run as well. The preamble refuses `run-state-missing` in the NFR-10 shape, before the fence does anything, when the run state is missing or unreadable, when its `TRACKER` is not exactly `jira` or `linear` and the tracker the fence was written for, or when a declared variable is empty. An empty path variable would otherwise mean "here" to `git -C` and `cd`, or "/" as a path prefix, so every variable a fence interpolates into such a place is declared. Substitute `<tracker>` before you write a fence to its file.

## Running a fence

Run every fence from THIS FILE, never from the text a session has loaded. The loader substitutes the invocation's arguments for this document's positional parameters before the text reaches a session, so a fence copied from the loaded skill runs with its `$1`, `$2` and `$3` already replaced: refusals print an empty message and every `case` reads the wrong word. Measured on 2026-09-23, when a refusal read `/shared-tracker-smoke: ` and named nothing. Each fence carries a canary and refuses `loader-substituted` when it happens, before doing anything, so this is a stop rather than a silent misrun.

Extract the fence by its tag comment — its first `# shared-tracker-smoke: …` line — and run the file:

```bash
# shared-tracker-smoke: extract one fence from this document and run it
SKILL=.claude/skills/shared-tracker-smoke/SKILL.md
TAG='# shared-tracker-smoke: pre-flight'    # the fence you want, by its tag comment
TICKS=$(printf '\140\140\140')            # the fence delimiter, spelled so this fence can name it
# A fence is identified by its FIRST tag line, never by text anywhere inside it: this fence
# names other fences' tags, and a contains-match would hand you this one and recurse.
#
# AN AMBIGUOUS TAG REFUSES. The match is by prefix, so a SHORTENED tag can hit more than
# one fence — `phase 0` hits Phase 0 and Phase 0.5, `extract` hits Phase 6 and this fence,
# `S5` hits both S5 fences. Concatenating them used to be silent: on 2026-09-23 an operator
# extracted `phase 0` and ran Phase 0.5 BEFORE the approval gate Phase 0 exists to hold, and
# an `extract` match would have ended in this fence's own `bash /tmp/dpt-fence.sh`, re-running
# whatever was extracted last, at the step that produces the evidence. So: count the matches,
# and refuse rather than write a file when the count is not exactly one.
MATCHES=$(awk -v tag="${TAG}" -v t="${TICKS}" '
  $0 == t "bash" { first = ""; inb = 1; next }
  inb && $0 == t { if (first != "" && index(first, tag) == 1) print first; inb = 0; next }
  inb { if (first == "" && $0 ~ /^# shared-tracker-smoke:/) first = $0 }
' "${SKILL}")
COUNT=$(printf '%s' "${MATCHES}" | grep -c . || true)
if [ "${COUNT}" != 1 ]; then
  printf '/shared-tracker-smoke: %s\nRemedy: %s\nContext: skill=shared-tracker-smoke, phase=extract-fence, check=tag-ambiguous, tracker=<tracker>\n' \
    "the tag ${TAG} matches ${COUNT} fences, not exactly one; nothing was extracted and nothing was run." \
    "use the fence's FULL first tag line. The matches were:${MATCHES:+$(printf '\n  %s' ${MATCHES})}" >&2
  exit 1
fi
awk -v tag="${TAG}" -v t="${TICKS}" '
  $0 == t "bash" { buf = ""; first = ""; inb = 1; next }
  inb && $0 == t { if (first != "" && index(first, tag) == 1) printf "%s", buf; inb = 0; next }
  inb { if (first == "" && $0 ~ /^# shared-tracker-smoke:/) first = $0; buf = buf $0 "\n" }
' "${SKILL}" > /tmp/dpt-fence.sh
[ -s /tmp/dpt-fence.sh ] || { echo "no fence carries the tag ${TAG}" >&2; exit 1; }
# Substitute <tracker> (and any other <…> placeholder the fence documents) in /tmp/dpt-fence.sh, then:
bash /tmp/dpt-fence.sh
```

## Phase 0 — Pre-approval

Nothing here calls a tracker. Run this fence from the toolkit checkout's top level, print its output, and wait for the operator to type approval. A tracker other than `jira` or `linear` refuses `tracker-unknown` before any plan is written. On a Jira run without `--jira-repoint-from` it prints `S8 skipped: repoint-space-not-given`. The numbers are derived by command, never typed: `spawnCeiling(tracker)` is the tracker's live steps plus the two audits.

**The item counts are the tracker's own.** The registry holds a Linear issue budget but no Jira item count, so the fence derives both from the tracker items the § Phase 3 steps create on the expected path, listed once in `CREATES` below, and checks the Linear column against the registry's `LINEAR_ISSUE_BUDGET` (a drift refuses). The two trackers differ in the milestone: on Jira a milestone is an Epic, which is an issue, and on Linear it is a milestone, which is not. So on Jira every FR that names a milestone nothing has created yet costs TWO items, the FR and that milestone's Epic — measured on 2026-09-23, when step 1 on an empty DST2 created Epic `DST2-1` besides FR `DST2-2`, and the table, counting the FR alone, had told the operator to expect one. The S8 legacy item is not created on a Jira run without `--jira-repoint-from`. The worst case adds each live scenario's `worstCaseExtraIssues` from the registry — one item each for S6, S7 and S14, whose guards, if broken, would let one create through — so on Linear it equals `linearWorstCase()`. That field counts LINEAR issues, so the Jira worst case takes the same re-costing the expected path did: S6's create is an FR answered with the next free milestone, so on Jira it would mint that milestone's Epic as well and costs two, while S7's bare issue and S14's Epic cost one each.

```bash
# shared-tracker-smoke: phase 0 — the plan the operator approves
TRACKER="<tracker>"
case "${TRACKER}" in
  jira | linear) ;;
  *)
    printf '/shared-tracker-smoke: %s\nRemedy: %s\nContext: skill=shared-tracker-smoke, phase=0, check=tracker-unknown, tracker=%s\n' "the tracker is ${TRACKER:-empty}, not jira or linear; no plan was written." "substitute <tracker> with jira or linear in this fence and run Phase 0 again." "${TRACKER:-unset}" >&2
    exit 1 ;;
esac
JIRA_PROJECT="${JIRA_PROJECT:-DST}"
JIRA_REPOINT_FROM="${JIRA_REPOINT_FROM:-}"
LINEAR_TEAM="${LINEAR_TEAM:-STE}"
TOPLEVEL=$(git rev-parse --show-toplevel)
PARENT=$(dirname "${TOPLEVEL}")
PLAN=$(TRACKER="${TRACKER}" REPOINT="${JIRA_REPOINT_FROM}" REGISTRY="${TOPLEVEL}/plugins/dev-process-toolkit/adapters/_shared/src/shared_tracker_scenarios.ts" bun -e '
const r = await import(process.env.REGISTRY);
const t = process.env.TRACKER;
const s8 = r.SHARED_TRACKER_SCENARIOS.find((s) => s.id === "S8");
const skip = t === "jira" && !process.env.REPOINT;
const ceiling = r.spawnCeiling(t);
// The tracker items the Phase 3 steps create on the expected path.
const CREATES = [
  { id: "S8", what: "S8 legacy item (step 1): its FR, and on Jira the Epic of the new milestone it names", jira: 2, linear: 1 },
  { id: "intruder", what: "intruder untagged item (step 3): a bare issue, in no milestone", jira: 1, linear: 1 },
  { id: "S1", what: "S1 same-title FRs (steps 4-5): two FRs, and on Jira a new milestone Epic for each", jira: 4, linear: 2 },
  { id: "S3", what: "S3 span milestone (step 6): a Jira Epic; a Linear milestone, not an issue", jira: 1, linear: 0 },
  { id: "S2", what: "S2 joined-title FRs (steps 10-11): two FRs inside the milestone S3 already created, so no new Epic", jira: 2, linear: 2 },
  { id: "S10", what: "S10 old-client FR (step 20): its FR, and on Jira its new milestone Epic", jira: 2, linear: 1 },
];
const linearAll = CREATES.reduce((n, c) => n + c.linear, 0);
if (linearAll !== r.LINEAR_ISSUE_BUDGET) {
  console.error(`/shared-tracker-smoke: the steps create ${linearAll} Linear issues, but the registry budget is ${r.LINEAR_ISSUE_BUDGET}; reconcile the step table and the registry first.`);
  process.exit(1);
}
const expected = CREATES.filter((c) => !(skip && c.id === "S8")).reduce((n, c) => n + c[t], 0);
const extra = r.SHARED_TRACKER_SCENARIOS.filter((s) => s.live && s.trackers.includes(t)).reduce((n, s) => n + s.worstCaseExtraIssues, 0);
// worstCaseExtraIssues counts LINEAR issues, as the registry says. On Jira the same
// re-costing the expected path needed applies: S6 worst case is an FR answered with
// "accept the recommended next free milestone" (the answer steps 1, 4-5 and 20 give),
// so it would mint that milestone Epic too and cost two. S7 creates a bare issue and
// S14 a milestone Epic, one each.
const JIRA_WORST_EXTRA_EPIC = ["S6"];
const extraJira = extra + r.SHARED_TRACKER_SCENARIOS.filter((s) => s.live && s.trackers.includes(t) && JIRA_WORST_EXTRA_EPIC.includes(s.id)).length;
console.log(`SPAWN_CEILING=${ceiling}`);
console.log(`EXPECTED_CHILDREN=${ceiling - (skip ? s8.liveSteps : 0)}`);
console.log(`EXPECTED_ITEMS=${expected}`);
console.log(`WORST_CASE_ITEMS=${t === "linear" ? r.linearWorstCase() : expected + extraJira}`);
console.log(`ITEM_UNIT="${t === "linear" ? "Linear issues (the free-plan budget)" : "Jira issues, the S3 Epic included"}"`);
console.log(`S8=${skip ? "skipped" : "run"}`);
') || { echo "/shared-tracker-smoke: phase 0 could not derive the plan from the registry; nothing was approved." >&2; exit 1; }
printf '%s\n' "${PLAN}" > /tmp/dpt-shared-<tracker>-plan.env
echo "tracker: ${TRACKER}"
if [ "${TRACKER}" = jira ]; then
  echo "writes to: Jira space ${JIRA_PROJECT}${JIRA_REPOINT_FROM:+ and Jira space ${JIRA_REPOINT_FROM} (repoint-from)}"
else
  echo "writes to: Linear team ${LINEAR_TEAM} — two projects this run creates: dpt-shared-<nonce> (shared) and dpt-shared-<nonce>-pre (B's pre-repoint), and two issue labels this run creates: shr-<nonce>-a and shr-<nonce>-b (the repo tags)"
fi
echo "throwaway repositories: ${PARENT}/dpt-shared-${TRACKER}-a ${PARENT}/dpt-shared-${TRACKER}-b"
printf '%s\n' "${PLAN}" | sed 's/^/  /'
echo "no child may be relaunched: the spawn ceiling covers every step and both audits exactly, with no slack, so a crashed or relaunched step costs the teardown audit its slot and the leg is lost (run § Phase 5 — Teardown and start a new run)"
case "${TRACKER}:${JIRA_REPOINT_FROM}" in
  jira:) echo "S8 skipped: repoint-space-not-given" ;;
  *) echo "S8 runs" ;;
esac
```

The operator is shown, and approves, all of:

1. every container the run writes to — the Jira keys, the repoint-from space included when given, or the Linear team, the two project names the run creates and the two repo-tag labels it creates in that team (`shr-<nonce>-a`, `shr-<nonce>-b`);
2. whether S8 runs or is skipped as `repoint-space-not-given`;
3. `EXPECTED_ITEMS` and `WORST_CASE_ITEMS`, in the tracker's own unit (`ITEM_UNIT`): on Jira the issues the run creates, the S3 Epic included; on Linear the issues the free plan will be asked for, the worst case being `linearWorstCase()`;
4. `EXPECTED_CHILDREN`, the number of children the run starts, and `SPAWN_CEILING`, the most it may ever start.

No approval, no run. There is no auto-approve path at this gate.

## Phase 0.5 — Clear this tracker's stale scratch

Only this tracker's paths are touched, so a run on the other tracker in another terminal is unaffected. The fence then mints the run id and the nonce and writes the run state. It refuses, removing nothing, when the tracker is not `jira` or `linear` (`tracker-unknown`) or when Phase 0's approved plan is missing or carries no whole-number `SPAWN_CEILING` (`plan-missing`), since the run state would then carry no ceiling.

**The working directory is checked before anything is removed.** Run from a subdirectory such as `plugins/dev-process-toolkit`, a `../dpt-shared-*` path lands inside the repository tree; that trap once broke `/conformance-loop`. So the fence first refuses unless the working directory is `git rev-parse --show-toplevel`, then checks every path it would remove, and removes nothing at all if any of them sits in, or resolves into, the toolkit checkout (a link into the tree included).

**Run it from a file.** Write the fence to a file and run `bash <file>`; never feed it to `bash`, `sh` or `zsh` through stdin.

```bash
# shared-tracker-smoke: phase 0.5 — stale scratch out, run state in
# loader canary: this document's text reaches a session with the invocation's arguments already
# substituted for its positional parameters, so a fence RUN FROM THE LOADED TEXT would refuse with an
# empty message and read the wrong word in every `case`. The left side below is spelled so the loader
# rewrites it and the right side so it cannot, which is why the two agree only off disk. The right
# side spells its dollar as an octal escape, which also keeps the line free of the two characters a
# string replacement would read as "everything after the match".
LOADER_CANARY='$1'
LOADER_EXPECT="$(printf '\044')1"
[ "${LOADER_CANARY}" = "${LOADER_EXPECT}" ] || { printf '/shared-tracker-smoke: %s\nRemedy: %s\nContext: skill=shared-tracker-smoke, phase=fence, check=loader-substituted, tracker=<tracker>\n' "this fence was copied from the loaded skill text, where the loader had already substituted its positional parameters; nothing was run and nothing was written." "take the fence from the document on disk instead: extract it from .claude/skills/shared-tracker-smoke/SKILL.md into a file (§ Running a fence) and run that file." >&2; exit 1; }
TRACKER="<tracker>"
refuse() {
  printf '/shared-tracker-smoke: %s\nRemedy: %s\nContext: skill=shared-tracker-smoke, phase=0.5, check=%s, tracker=%s\n' "$2" "$3" "$1" "${TRACKER}" >&2
  exit 1
}
case "${TRACKER}" in
  jira | linear) ;;
  *) refuse tracker-unknown "the tracker is ${TRACKER:-empty}, not jira or linear; nothing was removed." "substitute <tracker> with jira or linear in this fence and run Phase 0.5 again." ;;
esac
# 0. The plan the operator approved, before any rm: without it the run state would carry no SPAWN_CEILING.
grep -Eqx 'SPAWN_CEILING=[0-9]+' /tmp/dpt-shared-<tracker>-plan.env 2>/dev/null \
  || refuse plan-missing "/tmp/dpt-shared-<tracker>-plan.env is missing, unreadable or holds no whole-number SPAWN_CEILING; nothing was removed and no run state was written." "run Phase 0, have the operator approve its plan, then run Phase 0.5 again."
# 1. The cwd, before any rm.
TOPLEVEL=$(git rev-parse --show-toplevel 2>/dev/null)
if [ -z "${TOPLEVEL}" ] || [ "$(pwd -P)" != "$(cd "${TOPLEVEL}" 2>/dev/null && pwd -P)" ]; then
  refuse cwd-not-toplevel "the working directory $(pwd -P) is not the toolkit checkout's top level; nothing was removed." "cd to the output of git rev-parse --show-toplevel and run Phase 0.5 again."
fi
TOP_REAL=$(cd "${TOPLEVEL}" && pwd -P)
PARENT=$(dirname "${TOP_REAL}")
# 2. Every path this fence would remove, checked before any is removed.
where() { # the physical path $1 names, and (for a link to a directory) the one it resolves to
  printf '%s/%s\n' "$(cd "$(dirname "$1")" 2>/dev/null && pwd -P)" "$(basename "$1")"
  [ -d "$1" ] && (cd "$1" && pwd -P)
}
DOOMED=()
for P in /tmp/dpt-shared-<tracker>-* "${PARENT}/dpt-shared-${TRACKER}-a" "${PARENT}/dpt-shared-${TRACKER}-b"; do
  [ -e "${P}" ] || [ -L "${P}" ] || continue
  case "${P}" in /tmp/dpt-shared-<tracker>-plan.env) continue ;; esac
  while IFS= read -r R; do
    case "${R}/" in
      "${TOP_REAL}/"*) refuse rm-inside-toolkit "${P} resolves to ${R}, inside the toolkit checkout ${TOP_REAL}; nothing was removed." "remove or re-point ${P} by hand, then run Phase 0.5 again." ;;
    esac
  done < <(where "${P}")
  DOOMED+=("${P}")
done
# 3. Only now, remove.
for P in "${DOOMED[@]}"; do rm -rf "${P}"; done
# The trust entry S11 seeds for B's relocated checkout names a path this fence just
# deleted, so it is stale config debris from here on. Dropped for both sides; the ROOTS'
# own entries are left alone, because the pre-flight requires them and the operator
# accepted them by hand.
CFG05="${CLAUDE_CONFIG_DIR:-${HOME}/.claude}"
if [ -f "${CFG05}/.claude.json" ]; then
  TRUST_TMP05=$(mktemp)
  jq --arg a "${PARENT}/dpt-shared-${TRACKER}-a/.s11/relocated" --arg b "${PARENT}/dpt-shared-${TRACKER}-b/.s11/relocated" \
    'del(.projects[$a]) | del(.projects[$b])' "${CFG05}/.claude.json" > "${TRUST_TMP05}" \
    && mv "${TRUST_TMP05}" "${CFG05}/.claude.json" \
    || echo "warning: the stale relocated-checkout trust entries could not be removed from ${CFG05}/.claude.json" >&2
fi
{
  cat /tmp/dpt-shared-<tracker>-plan.env
  echo "TRACKER=${TRACKER}"
  echo "TOPLEVEL=${TOPLEVEL}"
  echo "ROOT_A=${PARENT}/dpt-shared-${TRACKER}-a"
  echo "ROOT_B=${PARENT}/dpt-shared-${TRACKER}-b"
  echo "PLUGIN_TREE=${TOPLEVEL}/plugins/dev-process-toolkit"
  echo "PLUGIN_BELOW_FLOOR=/tmp/dpt-shared-${TRACKER}-below-floor"
  echo "PLUGIN_INTRUDER=/tmp/dpt-shared-${TRACKER}-intruder-plugin"
  echo "DPT_SMOKE_RUN_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')"
  echo "NONCE=shr$(uuidgen | tr -d '-' | tr '[:upper:]' '[:lower:]' | cut -c1-8)"
  echo "RUN_START_MS=$(($(date +%s) * 1000))"
} > /tmp/dpt-shared-<tracker>-run.env
cat /tmp/dpt-shared-<tracker>-run.env
```

## Phase 1 — Pre-flights

Every refusal below comes before any spawn and before any tracker write, and each is printed in the three-line NFR-10 shape (`/shared-tracker-smoke: …`, `Remedy: …`, `Context: …`) on stderr, exit 1:

1. the working directory is not `git rev-parse --show-toplevel`;
2. `--tracker` is absent or `none`;
3. on Jira, `--jira-repoint-from` is given and equals `--jira-project`;
4. either throwaway path lacks workspace trust (the refusal names the path);
5. the toolkit tree is dirty;
6. no old client resolves, or the resolved one is not below the floor, or it carries the tracker-write hook;
7. the behaviour digest cannot be computed;
8. the tracker server registered under the second name does not answer one read call;
9. on Jira, the shared space, or the repoint-from space when given, does not answer a read, or its create metadata offers no Epic or no task type;
10. on Linear, `--linear-team` is not a team key (`linear-team-not-a-key`: the binding records the key, never a display name), or the saved team lookup carries no team id (`linear-team-unresolved`).

**The tracker answers come from this session, saved before the fence runs.** The fence cannot call MCP. Before running it, make these READ calls from this operator session and save each answer, verbatim, into the answers directory `/tmp/dpt-shared-<tracker>-answers`:

- `second-server-read.json` — one read call on the second server name (`claude_ai_Atlassian` for Jira, `claude_ai_Linear` for Linear) that returns something: `getAccessibleAtlassianResources` on Jira (a bare array) or `list_teams` on Linear, saved verbatim. If the call errors, save `{"error": "<the error text>"}`. An empty answer (`{}`, `[]`, `null`) is refused like an error: a read that returns nothing proves nothing. **The second name is not registered by default** (measured 2026-09-23): this operator session cannot make that read until the server is added under that exact name, normally at user scope. Adding it there reaches every session on this machine, so before `--strict-mcp-config` it also loaded into every child and changed what the run was testing; every spawn now passes that flag, so a child sees only the servers its `--mcp-config` names.
- Jira: `jira-space-<KEY>.json`, the answer of `mcp__atlassian__getVisibleJiraProjects(searchString: <KEY>)` (`{"values":[…],…}`), and `jira-createmeta-<KEY>.json`, the answer of `mcp__atlassian__getJiraProjectIssueTypesMetadata(projectIdOrKey: <KEY>)` (`{"issueTypes":[…],…}`), each saved verbatim, for the shared space and, when given, the repoint-from space.
- Linear: `linear-team.json`, the answer of `mcp__linear__get_team(query: <LINEAR_TEAM>)`, saved verbatim. It carries the team's `id` and display `name` but no `key` field, so the fence checks that `LINEAR_TEAM` is key-shaped and that the answer is an object with a non-empty string `id` and no `error`.

The only `bun` the fence runs is the grader's read-only `digest`; it starts no `claude`. It reads its inputs from the environment: `TRACKER`, `JIRA_PROJECT`, `JIRA_REPOINT_FROM`, `LINEAR_TEAM`, `OLD_CLIENT`, `CLAUDE_CONFIG_DIR` and `PREFLIGHT_ANSWERS`. Run it from the toolkit checkout's top level. On success it writes the resolved old client, floor and digest, on Linear the checked team key as `LINEAR_TEAM` and the team's id as `LINEAR_TEAM_ID` (both empty on Jira), and the absolute answers directory it read as `PREFLIGHT_ANSWERS`, to `/tmp/dpt-shared-<tracker>-preflight.env`, which Phase 2 appends to the run state. Phase 2's project and label creates take that id as their team, and Phase 2 saves its own answers into that same directory, where § Linear containers reads them.

**Between legs.** When the other tracker's leg already ran, commit its evidence bundle (a commit touching only that leg's bundle directory under `plugins/dev-process-toolkit/tests/fixtures/shared-tracker-live/`, which lies outside the behaviour digest) before this pre-flight, since the pre-flight refuses an untracked bundle (check 5).

**Run it from a file.** Write the fence to a file and run `bash <file>` with those variables in its environment; never feed it to `bash`, `sh` or `zsh` through stdin.

```bash
# shared-tracker-smoke: pre-flight
# loader canary: this document's text reaches a session with the invocation's arguments already
# substituted for its positional parameters, so a fence RUN FROM THE LOADED TEXT would refuse with an
# empty message and read the wrong word in every `case`. The left side below is spelled so the loader
# rewrites it and the right side so it cannot, which is why the two agree only off disk. The right
# side spells its dollar as an octal escape, which also keeps the line free of the two characters a
# string replacement would read as "everything after the match".
LOADER_CANARY='$1'
LOADER_EXPECT="$(printf '\044')1"
[ "${LOADER_CANARY}" = "${LOADER_EXPECT}" ] || { printf '/shared-tracker-smoke: %s\nRemedy: %s\nContext: skill=shared-tracker-smoke, phase=fence, check=loader-substituted, tracker=<tracker>\n' "this fence was copied from the loaded skill text, where the loader had already substituted its positional parameters; nothing was run and nothing was written." "take the fence from the document on disk instead: extract it from .claude/skills/shared-tracker-smoke/SKILL.md into a file (§ Running a fence) and run that file." >&2; exit 1; }
refuse() {
  printf '/shared-tracker-smoke: %s\nRemedy: %s\nContext: skill=shared-tracker-smoke, phase=pre-flight, check=%s, tracker=%s\n' "$2" "$3" "$1" "${TRACKER:-unset}" >&2
  exit 1
}
# Oldest first: 0 when $1 is strictly below $2.
version_below() {
  [ "$1" != "$2" ] && [ "$(printf '%s\n%s\n' "$1" "$2" | sort -t. -k1,1n -k2,2n -k3,3n | head -n 1)" = "$1" ]
}
has_hook() {
  grep -q 'pre-tracker-write-gate' "$1/hooks/hooks.json" 2>/dev/null
}

# 1. cwd is the checkout's top level
TOPLEVEL=$(git rev-parse --show-toplevel 2>/dev/null)
if [ -z "${TOPLEVEL}" ] || [ "$(pwd -P)" != "$(cd "${TOPLEVEL}" 2>/dev/null && pwd -P)" ]; then
  refuse cwd-not-toplevel "the working directory $(pwd -P) is not the toolkit checkout's top level." "cd to the output of git rev-parse --show-toplevel and run the pre-flight again."
fi
PLUGIN_TREE="${TOPLEVEL}/plugins/dev-process-toolkit"

# 2. one tracker, named
case "${TRACKER:-}" in
  jira | linear) ;;
  "" | none) refuse tracker-absent "--tracker is ${TRACKER:-absent}; this smoke needs a real tracker." "run /shared-tracker-smoke --tracker jira or --tracker linear." ;;
  *) refuse tracker-unknown "--tracker ${TRACKER} is not jira or linear." "run /shared-tracker-smoke --tracker jira or --tracker linear." ;;
esac
JIRA_PROJECT="${JIRA_PROJECT:-DST}"
LINEAR_TEAM="${LINEAR_TEAM:-STE}"

# 3. the repoint-from space is a second space
if [ "${TRACKER}" = jira ] && [ -n "${JIRA_REPOINT_FROM:-}" ] && [ "${JIRA_REPOINT_FROM}" = "${JIRA_PROJECT}" ]; then
  refuse repoint-from-equals-project "--jira-repoint-from ${JIRA_REPOINT_FROM} is the shared space itself." "create a second throwaway space and pass its key, or omit the flag and accept S8 as the skip repoint-space-not-given."
fi

# 4. workspace trust for both throwaway paths
CFG="${CLAUDE_CONFIG_DIR:-${HOME}/.claude}"
PARENT=$(dirname "${TOPLEVEL}")
for SIDE in a b; do
  P="${PARENT}/dpt-shared-${TRACKER}-${SIDE}"
  T=$(jq -r --arg p "${P}" '.projects[$p].hasTrustDialogAccepted // false' "${CFG}/.claude.json" 2>/dev/null)
  [ "${T}" = true ] || refuse trust-missing "the throwaway path ${P} has no workspace trust in ${CFG}/.claude.json." "open an interactive claude session in ${P} once and accept the trust dialog, then run the pre-flight again."
done

# 5. a clean tree under test
if [ -n "$(git -C "${TOPLEVEL}" status --porcelain 2>/dev/null)" ]; then
  refuse tree-dirty "the toolkit tree at ${TOPLEVEL} has uncommitted or untracked changes." "commit or stash them: the behaviour digest must describe a committed tree."
fi

# 6. the old client: below the floor, and hook-less
FLOOR=$(jq -r '.version // empty' "${PLUGIN_TREE}/.claude-plugin/plugin.json" 2>/dev/null)
[ -n "${FLOOR}" ] || refuse floor-unreadable "the version under test cannot be read from ${PLUGIN_TREE}/.claude-plugin/plugin.json." "restore the plugin manifest and run the pre-flight again."
if [ -z "${OLD_CLIENT:-}" ]; then
  BEST=""
  BEST_V=""
  for D in "${CFG}"/plugins/cache/dev-process-toolkit/dev-process-toolkit/*/; do
    D="${D%/}"
    V=$(jq -r '.version // empty' "${D}/.claude-plugin/plugin.json" 2>/dev/null)
    [ -n "${V}" ] || continue
    has_hook "${D}" && continue
    if [ -z "${BEST_V}" ] || version_below "${BEST_V}" "${V}"; then
      BEST="${D}"
      BEST_V="${V}"
    fi
  done
  OLD_CLIENT="${BEST}"
fi
[ -n "${OLD_CLIENT}" ] || refuse old-client-none "no cached dev-process-toolkit version lacks the tracker-write hook." "pass --old-client <plugin dir> naming a plugin copy older than ${FLOOR} without the hook."
OLD_V=$(jq -r '.version // empty' "${OLD_CLIENT}/.claude-plugin/plugin.json" 2>/dev/null)
[ -n "${OLD_V}" ] || refuse old-client-none "the old client ${OLD_CLIENT} has no readable plugin manifest." "pass --old-client <plugin dir> naming a plugin copy older than ${FLOOR} without the hook."
# --plugin-dir shadows an installed plugin BY NAME (the property the 2026-09-23 run
# lost its intruder to). The old client is the one shape the bootstrap does not write,
# so its name is checked here rather than assumed.
OLD_NAME=$(jq -r '.name // empty' "${OLD_CLIENT}/.claude-plugin/plugin.json" 2>/dev/null)
[ "${OLD_NAME}" = dev-process-toolkit ] \
  || refuse old-client-not-named "the old client ${OLD_CLIENT} is named ${OLD_NAME:-none}, not dev-process-toolkit, so --plugin-dir would load it BESIDE the installed toolkit instead of shadowing it, and the installed hook would grade this session." "pass --old-client <plugin dir> whose .claude-plugin/plugin.json is named dev-process-toolkit."
version_below "${OLD_V}" "${FLOOR}" || refuse old-client-not-below-floor "the old client ${OLD_CLIENT} is ${OLD_V}, not below the floor ${FLOOR}." "pass --old-client <plugin dir> naming a plugin copy older than ${FLOOR}."
if has_hook "${OLD_CLIENT}"; then
  refuse old-client-has-hook "the old client ${OLD_CLIENT} registers the tracker-write hook." "pass --old-client <plugin dir> naming a plugin copy whose hooks/hooks.json has no pre-tracker-write-gate."
fi

# 7. the behaviour digest (the one bun run a pre-flight may make)
DIGEST_JSON=$(bun "${PLUGIN_TREE}/adapters/_shared/src/shared_tracker_live_grader.ts" digest "${PLUGIN_TREE}" 2>/dev/null) \
  || refuse digest-unavailable "the behaviour digest of ${PLUGIN_TREE} cannot be computed." "run bun plugins/dev-process-toolkit/adapters/_shared/src/shared_tracker_live_grader.ts digest plugins/dev-process-toolkit and fix what it names."
DIGEST=$(printf '%s' "${DIGEST_JSON}" | jq -r '.digest // empty' 2>/dev/null)
[ -n "${DIGEST}" ] || refuse digest-unavailable "the digest command answered no digest for ${PLUGIN_TREE}." "run the digest command by hand and fix what it names."

# 8. the second server name answers a read — with something: {}, [], null or "" prove nothing
A="${PREFLIGHT_ANSWERS:-/nonexistent}"
jq -e '(type == "object" and length > 0 and (has("error") | not)) or (type == "array" and length > 0)' "${A}/second-server-read.json" >/dev/null 2>&1 \
  || refuse second-server-silent "the tracker server under its second name gave no usable answer to one read call (${A}/second-server-read.json)." "authenticate the second server name in this session, repeat the read call, save its answer, and run the pre-flight again."

# 9. / 10. the containers (LINEAR_TEAM_ID is set only by a resolved Linear team, never inherited)
LINEAR_TEAM_ID=""
if [ "${TRACKER}" = jira ]; then
  for KEY in "${JIRA_PROJECT}" ${JIRA_REPOINT_FROM:+"${JIRA_REPOINT_FROM}"}; do
    jq -e --arg k "${KEY}" '[.values[]? | select(.key == $k)] | length > 0' "${A}/jira-space-${KEY}.json" >/dev/null 2>&1 \
      || refuse jira-space-unreadable "the Jira space ${KEY} did not answer a read." "check the key and your access, repeat the read call, save its answer as jira-space-${KEY}.json, and run the pre-flight again."
    jq -e '[.issueTypes[]?.name] | index("Epic") != null' "${A}/jira-createmeta-${KEY}.json" >/dev/null 2>&1 \
      || refuse jira-no-epic "the Jira space ${KEY} offers no Epic issue type." "use a space whose create metadata offers Epic and Task."
    jq -e '[.issueTypes[]?.name | ascii_downcase] | index("task") != null' "${A}/jira-createmeta-${KEY}.json" >/dev/null 2>&1 \
      || refuse jira-no-task "the Jira space ${KEY} offers no task issue type." "use a space whose create metadata offers Epic and Task."
  done
  # The type's EXACT spelling, from the shared space's measured answer: the repoint check compares
  # `jira_issue_type` against that list byte for byte, so "Task" typed by hand would refuse on a
  # space that spells it "task". Both declarations get this value at bootstrap.
  ISSUE_TYPE=$(jq -r '[.issueTypes[]?.name | select(ascii_downcase == "task")] | first' "${A}/jira-createmeta-${JIRA_PROJECT}.json")
  [ -n "${ISSUE_TYPE}" ] && [ "${ISSUE_TYPE}" != null ] \
    || refuse jira-no-task "the Jira space ${JIRA_PROJECT} offers no task issue type to declare." "use a space whose create metadata offers Epic and Task."
else
  # The binding records the team KEY (team: <KEY>), so a display name or an issue key refuses here.
  printf '%s' "${LINEAR_TEAM}" | grep -Eqx '[A-Z][A-Z0-9]*' \
    || refuse linear-team-not-a-key "--linear-team ${LINEAR_TEAM} is not a Linear team key (^[A-Z][A-Z0-9]*$); both declarations record the key as team:." "pass the team's key, such as STE, never its display name."
  # linear-team.json is the mcp__linear__get_team(query: <LINEAR_TEAM>) answer: {id, name, …}, no key field.
  jq -e 'type == "object" and (has("error") | not) and (.id | type == "string" and length > 0)' "${A}/linear-team.json" >/dev/null 2>&1 \
    || refuse linear-team-unresolved "--linear-team ${LINEAR_TEAM} did not resolve: the saved mcp__linear__get_team answer (${A}/linear-team.json) carries no team id." "call mcp__linear__get_team(query: ${LINEAR_TEAM}) from this session, save its answer verbatim as linear-team.json, and run the pre-flight again; pass the key of a team this workspace holds."
  LINEAR_TEAM_ID=$(jq -r '.id' "${A}/linear-team.json")
fi

{
  printf 'OLD_CLIENT=%q\n' "${OLD_CLIENT}"
  printf 'OLD_CLIENT_VERSION=%s\n' "${OLD_V}"
  printf 'FLOOR=%s\n' "${FLOOR}"
  printf 'DIGEST_AT_START=%s\n' "${DIGEST}"
  printf 'LINEAR_TEAM=%q\n' "$([ "${TRACKER}" = linear ] && echo "${LINEAR_TEAM}")"
  printf 'LINEAR_TEAM_ID=%q\n' "${LINEAR_TEAM_ID:-}"
  printf 'ISSUE_TYPE=%q\n' "${ISSUE_TYPE:-}"
  # The answers directory this pre-flight read, so § Linear containers reads Phase 2's answers from the same place.
  printf 'PREFLIGHT_ANSWERS=%q\n' "$(cd "${A}" && pwd -P)"
} > "/tmp/dpt-shared-${TRACKER}-preflight.env"
echo "pre-flight ok: tracker=${TRACKER} floor=${FLOOR} old_client=${OLD_CLIENT} (${OLD_V}) digest=${DIGEST}${LINEAR_TEAM_ID:+ linear_team_id=${LINEAR_TEAM_ID}}"
```

## Phase 2 — Bootstrap

`../dpt-shared-<tracker>-a` and `-b` become git repositories. Each declaration — the repository's tag, the floor (the version under test) and the stop paragraph, and on Linear the team — is written by the M_947c79 declaration front door, `adapters/_shared/src/setup/tracker_binding_write.ts --shared <tag>` (plus `--team <LINEAR_TEAM>` on Linear); this document never writes a declaration line by hand. On Linear every create payload takes its team from the declaration's `team:`, so a declaration without it fails every create: the fence refuses `binding-team-missing` unless each CLAUDE.md carries exactly `team: <LINEAR_TEAM>` under `### Linear`. Jira takes no team. Before any write it also refuses `preflight-missing` when the pre-flight env is gone, and `container-unset` when the hand-typed `SHARED`, or on Linear `PRE`, is empty or still holds its `<…>` placeholder; whether those names are real projects in the team is § Linear containers' check. Each repository gets a wrapped MCP config; B's also registers the tracker server under a second name (`claude_ai_Atlassian` / `claude_ai_Linear`), and both repositories' settings allow the tools of both server names. A gets a trivial passing test command and a clean tree, so `/ship-milestone`'s refusals #1 to #3 cannot be the ones that fire in the sibling-busy scenario. The run nonce goes into every title the smoke writes, so no ticket from an earlier run can ever match.

On Linear, create the two throwaway projects first, from this session, with `mcp__linear__save_project` and no `id` (which makes the call a create). Its schema requires, on a create, `name` and at least one team through `addTeams` or `setTeams`, each "Team name or ID"; pass the id the pre-flight resolved, `LINEAR_TEAM_ID` read from `/tmp/dpt-shared-<tracker>-preflight.env`, so the project lands in the team the declarations name. First call `mcp__linear__save_project(name: "dpt-shared-<nonce>", addTeams: ["<LINEAR_TEAM_ID>"])` (shared). That is the run's first tracker write, so write the marker right after it and before any second write, with `: > /tmp/dpt-shared-<tracker>-teardown-owed`: from here on Phase 5 teardown is owed on every outcome, even if a later create fails. Only then call `mcp__linear__save_project(name: "dpt-shared-<nonce>-pre", addTeams: ["<LINEAR_TEAM_ID>"])` (B's pre-repoint project). Then create the two repo-tag labels in the team, also from this session: a Linear `save_issue` naming a label the team does not hold fails, so both must exist before any child creates. Call `mcp__linear__save_issue_label(name: "shr-<nonce>-a", teamId: <LINEAR_TEAM_ID>)` and `mcp__linear__save_issue_label(name: "shr-<nonce>-b", teamId: <LINEAR_TEAM_ID>)`, with no `id` and the same `LINEAR_TEAM_ID`; never the deprecated `create_issue_label`. Record every create. Then save, verbatim, into the answers directory the pre-flight read (`PREFLIGHT_ANSWERS`, recorded in the pre-flight env and so in the run state; normally `/tmp/dpt-shared-<tracker>-answers`): `mcp__linear__get_project(query: dpt-shared-<nonce>)` as `project-shared.json`, `mcp__linear__get_project(query: dpt-shared-<nonce>-pre)` as `project-pre.json`, `mcp__linear__list_issue_labels(team: <LINEAR_TEAM>, name: shr-<nonce>-a)` as `labels-a.json` and `mcp__linear__list_issue_labels(team: <LINEAR_TEAM>, name: shr-<nonce>-b)` as `labels-b.json`. § Linear containers checks all four before the first spawn. Jira's bootstrap writes nothing to the tracker; there the first scenario spawn writes the marker (§ Phase 5).

**Run it from a file.** Write the fence to a file and run `bash <file>`; never feed it to `bash`, `sh` or `zsh` through stdin.

```bash
# shared-tracker-smoke: bootstrap
set -e
RUN_STATE_NEEDS="TRACKER NONCE TOPLEVEL ROOT_A ROOT_B PLUGIN_TREE PLUGIN_BELOW_FLOOR PLUGIN_INTRUDER"
RUN_STATE_NEEDS_LINEAR=""
# run-state preamble: begin — the same lines in every fence that reads the run state
# loader canary: this document's text reaches a session with the invocation's arguments already
# substituted for its positional parameters, so a fence RUN FROM THE LOADED TEXT would refuse with an
# empty message and read the wrong word in every `case`. The left side below is spelled so the loader
# rewrites it and the right side so it cannot, which is why the two agree only off disk. The right
# side spells its dollar as an octal escape, which also keeps the line free of the two characters a
# string replacement would read as "everything after the match".
LOADER_CANARY='$1'
LOADER_EXPECT="$(printf '\044')1"
[ "${LOADER_CANARY}" = "${LOADER_EXPECT}" ] || { printf '/shared-tracker-smoke: %s\nRemedy: %s\nContext: skill=shared-tracker-smoke, phase=fence, check=loader-substituted, tracker=<tracker>\n' "this fence was copied from the loaded skill text, where the loader had already substituted its positional parameters; nothing was run and nothing was written." "take the fence from the document on disk instead: extract it from .claude/skills/shared-tracker-smoke/SKILL.md into a file (§ Running a fence) and run that file." >&2; exit 1; }
RUN_ENV="/tmp/dpt-shared-<tracker>-run.env"
run_state_refuse() {
  printf '/shared-tracker-smoke: %s\nRemedy: %s\nContext: skill=shared-tracker-smoke, phase=run-state, check=run-state-missing, tracker=<tracker>\n' "$1" "restore the line by hand from its source (Phase 0's plan /tmp/dpt-shared-<tracker>-plan.env, the pre-flight env /tmp/dpt-shared-<tracker>-preflight.env, or the values Phase 2 recorded) and run this fence again; never re-run Phase 0.5 mid-run, which mints a new nonce and wipes this run's scratch. This fence started nothing and wrote nothing. If the run state cannot be restored and /tmp/dpt-shared-<tracker>-teardown-owed exists, run § Phase 5 — Teardown now, then start a new run from Phase 0." >&2
  exit 1
}
{ [ -f "${RUN_ENV}" ] && [ -r "${RUN_ENV}" ]; } || run_state_refuse "the run state ${RUN_ENV} is missing or unreadable."
. "${RUN_ENV}"
case "${TRACKER:-}:<tracker>" in
  jira:jira | linear:linear) ;;
  *) run_state_refuse "the run state ${RUN_ENV} records TRACKER=${TRACKER:-unset}; it must be exactly jira or linear, and the tracker this fence was written for." ;;
esac
[ "${TRACKER}" != linear ] || RUN_STATE_NEEDS="${RUN_STATE_NEEDS} ${RUN_STATE_NEEDS_LINEAR}"
for RUN_STATE_VAR in ${RUN_STATE_NEEDS}; do
  [ -n "${!RUN_STATE_VAR:-}" ] || run_state_refuse "the run state ${RUN_ENV} records no ${RUN_STATE_VAR}, which this fence needs (${RUN_STATE_NEEDS})."
done
# run-state preamble: end
refuse() {
  printf '/shared-tracker-smoke: %s\nRemedy: %s\nContext: skill=shared-tracker-smoke, phase=bootstrap, check=%s, tracker=%s\n' "$2" "$3" "$1" "${TRACKER}" >&2
  exit 1
}
PREFLIGHT_ENV="/tmp/dpt-shared-<tracker>-preflight.env"
[ -r "${PREFLIGHT_ENV}" ] || refuse preflight-missing "the pre-flight env ${PREFLIGHT_ENV} is missing or unreadable; nothing was written." "run Phase 1 (pre-flight) for this run, then this bootstrap again."
cat "${PREFLIGHT_ENV}" >> "${RUN_ENV}"
. "${PREFLIGHT_ENV}"
SHARED="<shared space key, or the shared Linear project name>"
PRE="<the repoint-from space key, or B's pre-repoint Linear project name; empty on a Jira run without the flag>"
# LINEAR_TEAM (the key the pre-flight checked) and LINEAR_TEAM_ID (the uuid its lookup answered) came with
# the pre-flight env above — never retyped here, so the declarations' team: is the key the pre-flight proved.
# It is written into both Linear declarations as team:, and recorded in the run state below.
if [ "${TRACKER}" = linear ] && [ -z "${LINEAR_TEAM}" ]; then
  printf '/shared-tracker-smoke: %s\nRemedy: %s\nContext: skill=shared-tracker-smoke, phase=bootstrap, check=linear-team-unset, tracker=%s\n' "LINEAR_TEAM is empty on a Linear run; nothing was written." "the key comes from the pre-flight env, not from your shell: run Phase 1 (pre-flight) again for this Linear run so it records the key it checks, then this bootstrap again." "${TRACKER}" >&2
  exit 1
fi
# The same rule on Jira: the issue type comes from the pre-flight's measurement of the shared space,
# never retyped, and both declarations carry it so the repoint step has nothing to refuse about the peer.
if [ "${TRACKER}" = jira ] && [ -z "${ISSUE_TYPE}" ]; then
  printf '/shared-tracker-smoke: %s\nRemedy: %s\nContext: skill=shared-tracker-smoke, phase=bootstrap, check=issue-type-unset, tracker=%s\n' "ISSUE_TYPE is empty on a Jira run; nothing was written." "the type comes from the pre-flight env, not from your shell: run Phase 1 (pre-flight) again for this Jira run so it records the type it measured, then this bootstrap again." "${TRACKER}" >&2
  exit 1
fi
# SHARED and PRE are typed by hand above and flow into both declarations: an empty or unfilled one refuses here,
# before any write. That they name real projects in LINEAR_TEAM is checked by § Linear containers, from saved answers.
case "${SHARED}" in
  "" | *"<"* | *">"*) refuse container-unset "SHARED is ${SHARED:-empty}, not the shared container's key or name; nothing was written." "fill SHARED with the shared space key (Jira) or dpt-shared-${NONCE} (Linear), then run this bootstrap again." ;;
esac
case "${TRACKER}:${PRE}" in
  linear: | *"<"* | *">"*) refuse container-unset "PRE is ${PRE:-empty}, not the pre-repoint container's key or name; nothing was written." "fill PRE with the --jira-repoint-from key, or leave it empty on a Jira run without the flag, or dpt-shared-${NONCE}-pre on Linear, then run this bootstrap again." ;;
esac
# --plugin-dir shadows plugin-loaded MCP servers, so each child gets a wrapped config.
case "${TRACKER}" in
  jira)
    SERVER=atlassian; SECOND=claude_ai_Atlassian
    SERVER_JSON='{"type":"http","url":"https://mcp.atlassian.com/v1/mcp/authv2"}' ;;
  linear)
    SERVER=linear; SECOND=claude_ai_Linear
    SERVER_JSON=$(jq -c '.linear' ~/.claude-st/plugins/marketplaces/claude-plugins-official/external_plugins/linear/.mcp.json) ;;
esac
WRITE_BINDING="${PLUGIN_TREE}/adapters/_shared/src/setup/tracker_binding_write.ts"

# The below-floor client: the tree under test, differing only in its plugin.json version.
mkdir -p "${PLUGIN_BELOW_FLOOR}"
git -C "${TOPLEVEL}" ls-files -z -- plugins/dev-process-toolkit | (cd "${TOPLEVEL}" && xargs -0 tar -cf -) | tar -xf - -C "${PLUGIN_BELOW_FLOOR}" --strip-components 2
git -C "${PLUGIN_TREE}" ls-files > "/tmp/dpt-shared-${TRACKER}-tracked-files.txt"
jq --arg v "0.0.1" '.version = $v' "${PLUGIN_TREE}/.claude-plugin/plugin.json" > "${PLUGIN_BELOW_FLOOR}/.claude-plugin/plugin.json"
# The intruder: a plugin directory with no hooks at all, named dev-process-toolkit so --plugin-dir shadows
# the installed toolkit, which --plugin-dir replaces by name only; under another name its hook loads too.
mkdir -p "${PLUGIN_INTRUDER}/.claude-plugin"
printf '{"name":"dev-process-toolkit","version":"0.0.1"}\n' > "${PLUGIN_INTRUDER}/.claude-plugin/plugin.json"

for SIDE in A B; do
  ROOT=$([ "${SIDE}" = A ] && echo "${ROOT_A}" || echo "${ROOT_B}")
  TAG="shr-${NONCE}-$(echo "${SIDE}" | tr '[:upper:]' '[:lower:]')"
  PROJECT=$([ "${SIDE}" = B ] && [ -n "${PRE}" ] && echo "${PRE}" || echo "${SHARED}")
  mkdir -p "${ROOT}/specs/frs" "${ROOT}/specs/plan" "${ROOT}/.claude"
  git -C "${ROOT}" init -q -b main
  # `## Docs` too: probe #18 is error-severity on any tree the toolkit MANAGES, and a
  # `## Task Tracking` heading is what makes a tree managed — so a bootstrap that wrote
  # the one and not the other refused every gated commit in both repositories (measured
  # on live leg 2, 2026-09-23). The three keys are /setup's own, from the template.
  printf '# dpt-shared-%s-%s\n\n## Task Tracking\n\nmode: %s\nmcp_server: %s\n\n## Docs\n\nuser_facing_mode: false\npackages_mode: false\nchangelog_ci_owned: false\n' "${TRACKER}" "${SIDE}" "${TRACKER}" "${SERVER}" > "${ROOT}/CLAUDE.md"
  # On Linear every create takes its team from the declaration's team:, so the key goes in; Jira takes no team.
  if [ "${TRACKER}" = linear ]; then
    bun "${WRITE_BINDING}" "${ROOT}" "${TRACKER}" --project "${PROJECT}" --shared "${TAG}" --team "${LINEAR_TEAM}"
    TEAM_LINES=$(awk '$0 == "### Linear" { inside = 1; next } inside && /^#/ { exit } inside && /^team[[:space:]]*:/' "${ROOT}/CLAUDE.md")
    if [ "${TEAM_LINES}" != "team: ${LINEAR_TEAM}" ]; then
      printf '/shared-tracker-smoke: %s\nRemedy: %s\nContext: skill=shared-tracker-smoke, phase=bootstrap, check=binding-team-missing, side=%s, tracker=%s\n' "${ROOT}/CLAUDE.md does not carry exactly team: ${LINEAR_TEAM} under ### Linear (found: ${TEAM_LINES:-none}); every Linear create from it would fail." "fix the binding write so both declarations carry team: ${LINEAR_TEAM}, then start the run again by the one legal path: § Phase 5 — Teardown (Phase 2's creates made it owed, and they carry this run's nonce), then Phase 0.5, Phase 1 (pre-flight) and Phase 2; never Phase 0.5 and the bootstrap alone, since Phase 0.5 deletes the pre-flight env and mints a new nonce." "${SIDE}" "${TRACKER}" >&2
      exit 1
    fi
  else
    # Both sides declare the issue type the pre-flight measured. An undeclared peer is what the
    # first live Jira leg (2026-09-23) met at repoint row 3, and the child answered that refusal
    # by editing the PEER's CLAUDE.md. A fully declared pair gives no child that reason.
    bun "${WRITE_BINDING}" "${ROOT}" "${TRACKER}" --project "${PROJECT}" --issue-type "${ISSUE_TYPE}" --shared "${TAG}"
    TYPE_LINES=$(awk '$0 == "### Jira" { inside = 1; next } inside && /^#/ { exit } inside && /^jira_issue_type[[:space:]]*:/' "${ROOT}/CLAUDE.md")
    if [ "${TYPE_LINES}" != "jira_issue_type: ${ISSUE_TYPE}" ]; then
      printf '/shared-tracker-smoke: %s\nRemedy: %s\nContext: skill=shared-tracker-smoke, phase=bootstrap, check=binding-issue-type-missing, side=%s, tracker=%s\n' "${ROOT}/CLAUDE.md does not carry exactly jira_issue_type: ${ISSUE_TYPE} under ### Jira (found: ${TYPE_LINES:-none}); the repoint step would refuse, naming the other root." "fix the binding write so both declarations carry jira_issue_type: ${ISSUE_TYPE}, then start the run again by the one legal path: § Phase 5 — Teardown if it is owed, then Phase 0.5, Phase 1 (pre-flight) and Phase 2; never Phase 0.5 and the bootstrap alone, since Phase 0.5 deletes the pre-flight env and mints a new nonce." "${SIDE}" "${TRACKER}" >&2
      exit 1
    fi
  fi
  if [ "${SIDE}" = B ]; then
    jq -n --arg a "${SERVER}" --arg b "${SECOND}" --argjson s "${SERVER_JSON}" '{mcpServers: {($a): $s, ($b): $s}}' > "/tmp/dpt-shared-${TRACKER}-mcp-${SIDE}.json"
  else
    jq -n --arg a "${SERVER}" --argjson s "${SERVER_JSON}" '{mcpServers: {($a): $s}}' > "/tmp/dpt-shared-${TRACKER}-mcp-${SIDE}.json"
  fi
  # The same file inside the root, where the repoint step's row 5 looks for it: that row compares
  # THIS repository's `mcp_server:` entry with the peer's, and an absent file is a refusal naming
  # the other root — the shape that sent a child into the sibling on the first live Jira leg.
  # It is data for the checks and never live configuration: every spawn names its servers with
  # --mcp-config and --strict-mcp-config, so no child loads this file or is asked to approve it.
  cp "/tmp/dpt-shared-${TRACKER}-mcp-${SIDE}.json" "${ROOT}/.mcp.json"
  # Each side may cd into, and write into, its sibling (S12, S17); S11 makes a declaration unreadable with chmod.
  jq -n --arg a "${SERVER}" --arg b "${SECOND}" --arg other "$([ "${SIDE}" = A ] && echo "${ROOT_B}" || echo "${ROOT_A}")" \
    '{permissions: {allow: ["Bash(bun:*)", "Bash(git:*)", "Bash(gh:*)", "Bash(cd:*)", "Bash(chmod:*)", "mcp__\($a)__*", "mcp__\($b)__*"], additionalDirectories: [$other]}}' > "${ROOT}/.claude/settings.json"
  printf '{"name":"dpt-shared-%s","scripts":{"test":"true"}}\n' "${SIDE}" > "${ROOT}/package.json"
  git -C "${ROOT}" add -A
  git -C "${ROOT}" -c commit.gpgsign=false commit -qm "chore: bootstrap dpt-shared-${SIDE}"
  [ -z "$(git -C "${ROOT}" status --porcelain)" ]
done
# S17: a topic branch in B for `merge --no-ff` to merge, and `ci` configured in B as an alias of commit.
git -C "${ROOT_B}" branch feature-s17
git -C "${ROOT_B}" checkout -q feature-s17
git -C "${ROOT_B}" -c commit.gpgsign=false commit -q --allow-empty -m "chore: s17 topic"
git -C "${ROOT_B}" checkout -q main
git -C "${ROOT_B}" config alias.ci commit
# The containers and the Linear team, for the privacy dry run, the audits and Phase 6.
printf 'SHARED=%q\nPRE=%q\nLINEAR_TEAM=%q\n' "${SHARED}" "${PRE}" "${LINEAR_TEAM}" >> /tmp/dpt-shared-<tracker>-run.env
echo "bootstrapped: ${ROOT_A} ${ROOT_B} nonce=${NONCE}"
```

### Linear containers — before the privacy dry run (operator, no child)

Phase 2 creates four Linear containers: the two throwaway projects and the two repo-tag labels. All four are checked here, the same way, before any child starts. A project's name is typed by hand into the bootstrap as `SHARED` / `PRE` and flows into both declarations and every create payload; a `save_issue` naming a label the team does not hold fails. So, after bootstrap and before the privacy dry run, this fence reads the four answers Phase 2 saved in the answers directory the pre-flight read (`PREFLIGHT_ANSWERS`, which the pre-flight recorded and Phase 2 appended to the run state), and refuses in the NFR-10 shape:

- `linear-project-unverified` unless `project-shared.json` and `project-pre.json` (the `mcp__linear__get_project` answers) each have a `name` exactly equal to the run state's `SHARED` / `PRE` and a `teams[]` entry whose `key` equals `LINEAR_TEAM`;
- `linear-tag-label-missing` unless each of `labels-a.json` / `labels-b.json` holds, in `labels[]`, an entry whose `name` is exactly that side's tag.

A missing, unreadable or error answer refuses the same way. It opens with the run-state preamble, so a missing run state, a `TRACKER` that is not exactly `jira` or `linear`, or an empty `NONCE`, `SHARED`, `PRE`, `LINEAR_TEAM` or `PREFLIGHT_ANSWERS` on a Linear run refuses as `run-state-missing`. Only a Jira run takes the no-check branch: Jira's bootstrap creates no container, and a Jira label needs no create. It starts no child and writes nothing to the tracker.

**Run it from a file.** Write the fence to a file and run `bash <file>`; never feed it to `bash`, `sh` or `zsh` through stdin.

```bash
# shared-tracker-smoke: linear containers — both projects and both repo-tag labels exist before any spawn
RUN_STATE_NEEDS="TRACKER"
RUN_STATE_NEEDS_LINEAR="NONCE SHARED PRE LINEAR_TEAM PREFLIGHT_ANSWERS"
# run-state preamble: begin — the same lines in every fence that reads the run state
# loader canary: this document's text reaches a session with the invocation's arguments already
# substituted for its positional parameters, so a fence RUN FROM THE LOADED TEXT would refuse with an
# empty message and read the wrong word in every `case`. The left side below is spelled so the loader
# rewrites it and the right side so it cannot, which is why the two agree only off disk. The right
# side spells its dollar as an octal escape, which also keeps the line free of the two characters a
# string replacement would read as "everything after the match".
LOADER_CANARY='$1'
LOADER_EXPECT="$(printf '\044')1"
[ "${LOADER_CANARY}" = "${LOADER_EXPECT}" ] || { printf '/shared-tracker-smoke: %s\nRemedy: %s\nContext: skill=shared-tracker-smoke, phase=fence, check=loader-substituted, tracker=<tracker>\n' "this fence was copied from the loaded skill text, where the loader had already substituted its positional parameters; nothing was run and nothing was written." "take the fence from the document on disk instead: extract it from .claude/skills/shared-tracker-smoke/SKILL.md into a file (§ Running a fence) and run that file." >&2; exit 1; }
RUN_ENV="/tmp/dpt-shared-<tracker>-run.env"
run_state_refuse() {
  printf '/shared-tracker-smoke: %s\nRemedy: %s\nContext: skill=shared-tracker-smoke, phase=run-state, check=run-state-missing, tracker=<tracker>\n' "$1" "restore the line by hand from its source (Phase 0's plan /tmp/dpt-shared-<tracker>-plan.env, the pre-flight env /tmp/dpt-shared-<tracker>-preflight.env, or the values Phase 2 recorded) and run this fence again; never re-run Phase 0.5 mid-run, which mints a new nonce and wipes this run's scratch. This fence started nothing and wrote nothing. If the run state cannot be restored and /tmp/dpt-shared-<tracker>-teardown-owed exists, run § Phase 5 — Teardown now, then start a new run from Phase 0." >&2
  exit 1
}
{ [ -f "${RUN_ENV}" ] && [ -r "${RUN_ENV}" ]; } || run_state_refuse "the run state ${RUN_ENV} is missing or unreadable."
. "${RUN_ENV}"
case "${TRACKER:-}:<tracker>" in
  jira:jira | linear:linear) ;;
  *) run_state_refuse "the run state ${RUN_ENV} records TRACKER=${TRACKER:-unset}; it must be exactly jira or linear, and the tracker this fence was written for." ;;
esac
[ "${TRACKER}" != linear ] || RUN_STATE_NEEDS="${RUN_STATE_NEEDS} ${RUN_STATE_NEEDS_LINEAR}"
for RUN_STATE_VAR in ${RUN_STATE_NEEDS}; do
  [ -n "${!RUN_STATE_VAR:-}" ] || run_state_refuse "the run state ${RUN_ENV} records no ${RUN_STATE_VAR}, which this fence needs (${RUN_STATE_NEEDS})."
done
# run-state preamble: end
refuse() {
  printf '/shared-tracker-smoke: %s\nRemedy: %s\nContext: skill=shared-tracker-smoke, phase=linear-containers, check=%s, tracker=%s\n' "$2" "$3" "$1" "${TRACKER}" >&2
  exit 1
}
if [ "${TRACKER}" = jira ]; then
  echo "linear containers: a Jira run; its bootstrap creates no container and a Jira label needs no create, so nothing is checked"
  exit 0
fi
ANSWERS="${PREFLIGHT_ANSWERS}"
LEGAL_PATH="if the name or the team is wrong, the declarations already carry it: run § Phase 5 — Teardown (Phase 2's creates made it owed), then Phase 0.5, Phase 1 (pre-flight) and Phase 2 again"
for PAIR in "shared:${SHARED}" "pre:${PRE}"; do
  SIDE="${PAIR%%:*}"
  NAME="${PAIR#*:}"
  jq -e --arg n "${NAME}" --arg k "${LINEAR_TEAM}" 'type == "object" and (has("error") | not) and .name == $n and ([.teams[]? | select(type == "object" and .key == $k)] | length > 0)' "${ANSWERS}/project-${SIDE}.json" >/dev/null 2>&1 \
    || refuse linear-project-unverified "the saved answer ${ANSWERS}/project-${SIDE}.json does not show a Linear project named ${NAME} in team ${LINEAR_TEAM} (missing, unreadable, an error, another name, or no teams[] entry with key ${LINEAR_TEAM}); no child was started." "when the project exists under that name in that team, save mcp__linear__get_project(query: ${NAME}) verbatim as project-${SIDE}.json and run this fence again; ${LEGAL_PATH}."
done
for SIDE in a b; do
  TAG="shr-${NONCE}-${SIDE}"
  jq -e --arg t "${TAG}" '(.labels | type == "array") and ([.labels[] | select(type == "object" and .name == $t)] | length > 0)' "${ANSWERS}/labels-${SIDE}.json" >/dev/null 2>&1 \
    || refuse linear-tag-label-missing "the Linear label ${TAG} is not in the saved listing ${ANSWERS}/labels-${SIDE}.json (missing, unreadable, or holding no label named ${TAG}); every create carrying it would fail, and no child was started." "create it with mcp__linear__save_issue_label(name: \"${TAG}\", teamId: <LINEAR_TEAM_ID>), save mcp__linear__list_issue_labels(team: ${LINEAR_TEAM}, name: ${TAG}) verbatim as labels-${SIDE}.json, and run this fence again; run § Phase 5 — Teardown if you abandon the run, since Phase 2's creates made it owed."
done
echo "linear containers ok: projects ${SHARED} and ${PRE}, labels shr-${NONCE}-a and shr-${NONCE}-b, all in Linear team ${LINEAR_TEAM}"
```

### Privacy dry run — before the first spawn (operator, no child)

Phase 6's `extract` refuses to write a bundle holding a home-directory path, an email address, an account id or a tracker site host, and a bundle re-extracted after a fix changes its digest. A leak found only at Phase 6 therefore throws away the whole run. So, right after bootstrap and before the first scenario spawn, this fence runs the same `extract` over the bootstrap state, into a throwaway directory under `/tmp`, never into the fixtures tree. When it reports a privacy refusal it refuses in the NFR-10 shape, before any child starts and before any budget is spent. It also refuses when `extract` fails for any other reason, since Phase 6 would fail the same way. It starts no child and writes nothing to the tracker. On Linear, Phase 2's project and label creates have already made teardown owed, so a refusal sends the operator to § Phase 5 — Teardown.

**What each pass can see.** Run before the first spawn, this dry run checks the bootstrap state only: the ledger holds no session yet, so no child transcript and no tracker answer passes through it, and it catches only what bootstrap alone would leak (the roots, the receipts, the git history). That is why § Phase 3 says to run it again after step 1, when the ledger holds one real child transcript: the first live Jira run (2026-09-23) refused its bundle at Phase 6 on 41 personal-data matches in ordinary child records, a class the early pass cannot see by construction. The second pass catches that class after ONE step instead of after twenty-six. Phase 6's `extract` remains the pass over the whole run.

**Run it from a file.** Write the fence to a file and run `bash <file>`; never feed it to `bash`, `sh` or `zsh` through stdin.

```bash
# shared-tracker-smoke: privacy dry run — extract over the bootstrap state, before any spawn
RUN_STATE_NEEDS="TRACKER TOPLEVEL DPT_SMOKE_RUN_ID NONCE ROOT_A ROOT_B DIGEST_AT_START SHARED PLUGIN_BELOW_FLOOR RUN_START_MS"
RUN_STATE_NEEDS_LINEAR="PRE LINEAR_TEAM"
# run-state preamble: begin — the same lines in every fence that reads the run state
# loader canary: this document's text reaches a session with the invocation's arguments already
# substituted for its positional parameters, so a fence RUN FROM THE LOADED TEXT would refuse with an
# empty message and read the wrong word in every `case`. The left side below is spelled so the loader
# rewrites it and the right side so it cannot, which is why the two agree only off disk. The right
# side spells its dollar as an octal escape, which also keeps the line free of the two characters a
# string replacement would read as "everything after the match".
LOADER_CANARY='$1'
LOADER_EXPECT="$(printf '\044')1"
[ "${LOADER_CANARY}" = "${LOADER_EXPECT}" ] || { printf '/shared-tracker-smoke: %s\nRemedy: %s\nContext: skill=shared-tracker-smoke, phase=fence, check=loader-substituted, tracker=<tracker>\n' "this fence was copied from the loaded skill text, where the loader had already substituted its positional parameters; nothing was run and nothing was written." "take the fence from the document on disk instead: extract it from .claude/skills/shared-tracker-smoke/SKILL.md into a file (§ Running a fence) and run that file." >&2; exit 1; }
RUN_ENV="/tmp/dpt-shared-<tracker>-run.env"
run_state_refuse() {
  printf '/shared-tracker-smoke: %s\nRemedy: %s\nContext: skill=shared-tracker-smoke, phase=run-state, check=run-state-missing, tracker=<tracker>\n' "$1" "restore the line by hand from its source (Phase 0's plan /tmp/dpt-shared-<tracker>-plan.env, the pre-flight env /tmp/dpt-shared-<tracker>-preflight.env, or the values Phase 2 recorded) and run this fence again; never re-run Phase 0.5 mid-run, which mints a new nonce and wipes this run's scratch. This fence started nothing and wrote nothing. If the run state cannot be restored and /tmp/dpt-shared-<tracker>-teardown-owed exists, run § Phase 5 — Teardown now, then start a new run from Phase 0." >&2
  exit 1
}
{ [ -f "${RUN_ENV}" ] && [ -r "${RUN_ENV}" ]; } || run_state_refuse "the run state ${RUN_ENV} is missing or unreadable."
. "${RUN_ENV}"
case "${TRACKER:-}:<tracker>" in
  jira:jira | linear:linear) ;;
  *) run_state_refuse "the run state ${RUN_ENV} records TRACKER=${TRACKER:-unset}; it must be exactly jira or linear, and the tracker this fence was written for." ;;
esac
[ "${TRACKER}" != linear ] || RUN_STATE_NEEDS="${RUN_STATE_NEEDS} ${RUN_STATE_NEEDS_LINEAR}"
for RUN_STATE_VAR in ${RUN_STATE_NEEDS}; do
  [ -n "${!RUN_STATE_VAR:-}" ] || run_state_refuse "the run state ${RUN_ENV} records no ${RUN_STATE_VAR}, which this fence needs (${RUN_STATE_NEEDS})."
done
# run-state preamble: end
refuse() {
  printf '/shared-tracker-smoke: %s\nRemedy: %s\nContext: skill=shared-tracker-smoke, phase=privacy-dry-run, check=%s, tracker=%s\n' "$2" "$3" "$1" "${TRACKER:-unset}" >&2
  exit 1
}
# How many children the ledger already holds: the first pass covers the bootstrap state alone, a later
# pass covers every child transcript so far, and the refusal must not claim no child was started.
LEDGER_OUT=$(bun "${TOPLEVEL}/plugins/dev-process-toolkit/adapters/_shared/src/smoke_run_ledger.ts" sessions --project-root "${TOPLEVEL}" --run "${DPT_SMOKE_RUN_ID}" --leg "shared-${TRACKER}") \
  || refuse ledger-unreadable "the run ledger for run ${DPT_SMOKE_RUN_ID} could not be read; a failed read is not zero sessions." "fix what the ledger read names, then run this fence again."
LEDGERED=$(printf '%s' "${LEDGER_OUT}" | grep -c .)
DRY_OUT="/tmp/dpt-shared-${TRACKER}-dry-run/"
DRY_ERR="/tmp/dpt-shared-${TRACKER}-dry-run.err"
rm -rf "${DRY_OUT}"
if bun "${TOPLEVEL}/plugins/dev-process-toolkit/adapters/_shared/src/shared_tracker_live_grader.ts" extract \
  --project-root "${TOPLEVEL}" --run "${DPT_SMOKE_RUN_ID}" --leg "shared-${TRACKER}" --tracker "${TRACKER}" \
  --nonce "${NONCE}" --root-a "${ROOT_A}" --root-b "${ROOT_B}" --config-dir "${CLAUDE_CONFIG_DIR:-${HOME}/.claude-st}" \
  --digest-at-start "${DIGEST_AT_START}" --out "${DRY_OUT}" \
  --container "${SHARED}" ${PRE:+--repoint-from "${PRE}"} ${LINEAR_TEAM:+--linear-team "${LINEAR_TEAM}"} \
  --below-floor "${PLUGIN_BELOW_FLOOR}" --tracked-list "/tmp/dpt-shared-${TRACKER}-tracked-files.txt" \
  --started-at-ms "${RUN_START_MS}" > /dev/null 2> "${DRY_ERR}"; then
  rm -rf "${DRY_OUT}"
  echo "privacy dry run ok: the bootstrap state extracts with no personal data"
else
  sed 's/^/  extract: /' "${DRY_ERR}"
  if grep -q 'holds personal data' "${DRY_ERR}"; then
    refuse privacy-leak "the dry-run extract over the bootstrap state refused its bundle for personal data (the matches are listed above); ${LEDGERED} children have already run (no child was started when that count is 0)." "make the grader rewrite what it names (committed, since the pre-flight refuses a dirty tree), then start the run again by the legal path: on Linear § Phase 5 — Teardown first, since Phase 2's project and label creates made it owed, then Phase 0.5, Phase 1 (pre-flight), Phase 2 and this dry run; never Phase 2 alone, since the bootstrap cannot run over repositories it already made."
  fi
  refuse dry-run-failed "the dry-run extract over the bootstrap state failed (its error is listed above), so Phase 6 would fail too; no child was started." "fix what the extract names, then run this dry run again; on Linear run § Phase 5 — Teardown if you abandon the run, since Phase 2's project and label creates made it owed."
fi
```

## Phase 3 — Scenarios

One `claude -p` child per scenario step, serial: start a step, wait for it to exit, then start the next. Each child's prompt carries one scenario marker line, written by the fence, never by the child:

    dpt-shared-tracker-scenario: <marker>[ client=<client>]

`<marker>` is a registry id or one of the reserved markers `audit` and `intruder`; `client=` is omitted for the tree under test and is `below-floor`, `old-client` or `intruder` otherwise. The grader maps each ledgered session to exactly one scenario from that line in its transcript's first user message.

**After step 1, run § Privacy dry run again, before step 2.** The same fence, over a ledger that now holds one real child transcript. The pass before the first spawn sees the bootstrap state alone; this one sees a child's own records, which is where the first live Jira run's 41 personal-data matches lived. Catching that class after one step costs one fence; catching it at Phase 6 costs the whole leg, which is what happened on 2026-09-23.

**Also after step 1: check the child could reach its tracker at all.** `--strict-mcp-config` is new and has never run live (it was added so the operator's user-scope registration of the second server name stops loading into every child). If it is wrong, a child gets NO tracker server and the failure is silent-looking: step 1 creates no item, and its log holds no `mcp__` tool call at all. So before step 2, read `/tmp/dpt-shared-<tracker>-1-S8.log` for one `mcp__` call and confirm the step's item exists in the tracker. Zero calls means the config, not the guard under test: stop the leg there rather than spending twenty-five more steps on a run whose children cannot write. One child, one check, at the first step that writes.

**The ceiling.** The run starts at most `SPAWN_CEILING` children (the registry's live steps plus the two audits). The fence counts the run ledger before every spawn and refuses instead of spawning when one more child would exceed it.

**The steps**, in order. Each row is one run of the step fence below. The prompt names the work only; it never names the verdict the grader expects.

| # | marker | root | client | the step's prompt |
|---|---|---|---|---|
| 1 | S8 | B | tree | Create one FR titled `<nonce> S8 legacy item` in B's current container through `/spec-write`. (Skipped with S8 on a Jira run without `--jira-repoint-from`.) |
| 2 | S8 | B | tree | Repoint B into the shared container with `repoint_tracker_binding.ts`; when it refuses, fix what it names and repoint again. Row 7 reads the WORKING TREE, so archiving the step-1 FR by moving the file is enough and NO COMMIT is required for the repoint to pass — if you commit anyway and a commit gate refuses, that refusal blocked the whole command, so run the repoint on its own afterwards rather than treating it as a deadlock. Run the repoint as its own command, never chained after a git command. |
| 3 | intruder | A | intruder | Create one issue titled `<nonce> intruder untagged item` in the shared container. |
| 4–5 | S1 | A, then B | tree | Create an FR titled `<nonce> S1 same title` through `/spec-write`. |
| 6 | S3 | A | tree | Plan a milestone titled `<nonce> S3 span` spanning B, through `/spec-write`. |
| 7 | S14 | B | tree | Before B has decided any join for A's milestone `<nonce> S3 span`: write B's plan `<B>/specs/plan/<token>.md` for it, naming A's milestone container and no `spans_repos:` entry for A; save the container's milestone listing to `<B>/.dpt/tmp/listing.json`; and run `attach_project_milestone.ts <B> <tracker> <container> <B>/specs/plan/<token>.md <B>/.dpt/tmp/listing.json`. When it refuses, stop: this session creates nothing (no FR file, no tracker item, no milestone) and decides no join. |
| 8 | S14 | A | tree | Before B's plan names A back: run `sibling_release.ts <A> <A>/specs/plan/<token>.md <token> --offer` once for the span milestone, then stop. Release nothing and commit nothing. |
| 9 | S3 | B | tree | List the container's milestones to the last page, then join A's milestone `<nonce> S3 span` by its key through the decision front door (`resolve_milestone_identity.ts` with `--join-key <KEY>`). Then make B's plan name A back: `spans_repos.ts <B>/specs/plan/<token>.md <token> --declare <A>`. |
| 10–11 | S2 | A, then B | tree | Create an FR titled `<nonce> S2 joined title` inside the joined milestone through `/spec-write`. B's create (step 11) is S14's permit twin: the create under B's decided join, so S14 spends no extra issue. |
| 12–13 | S4 | A, then B | tree | Run the orphan listing and the untagged detector over the shared container. |
| 14 | S5 | A | tree | A's own span FR is archived (§ Before step 14 ran), so A is idle on the span milestone. Run `/ship-milestone` for the span milestone while B's FR is active. |
| 15 | S5 | A | tree | B's span FR is archived now (§ Between step 14 and step 15 ran). Run `/ship-milestone` for the span milestone again. |
| 16 | S6 | B | below-floor | Create one FR titled `<nonce> S6 below floor` through `/spec-write`, using the `claude_ai_*` tracker tools. |
| 17 | S7 | A | tree | Create one tracker issue directly, with no front-door run before it. |
| 18 | S9 | A | tree | Edit B's S1 ticket to carry A's tag. |
| 19 | S11 | B-relocated | tree | This session starts in `<B>/.s11/relocated`, a worktree of B at another path (§ Before step 19). (1) Run `git rev-parse --show-toplevel` and check that it prints that path. (2) Transition A's S1 ticket `<A's S1 key>` to In Progress directly, with no front-door run before it. (3) Run `chmod 000 CLAUDE.md` in this worktree, so its declaration exists but cannot be read, and try the same transition again. (4) Run `chmod 644 CLAUDE.md`. |
| 20 | S10 | A | old-client | Create one FR titled `<nonce> S10 old client` in this repository's tracker through `/spec-write`. |
| 21 | S10 | A | tree | Run the untagged detector over the shared container. |
| 22 | S13 | B | tree | Claim A's S1 ticket `<A's S1 key>` by key, import it, then import the intruder's untagged item `<intruder key>` through `/spec-write`'s orphan listing. Its import question is answered by this prompt's answers block (`tracker_orphan_import`), with the printed `Import <intruder key>` label. |
| 23 | S12 | A | tree | (1) Run `git -C <B> commit --allow-empty -m "s12: commit into B"`, then `cd <B> && gh pr create --title s12 --body s12`. (2) Create B's own gate evidence in this session: run `/dev-process-toolkit:gate-check <B>`, which records the run with `gate_receipt.ts gate-check <B>` and prints its `dpt-receipt:` line, then `/dev-process-toolkit:spec-review <B>`. (3) Run `git -C <B> commit --allow-empty -m "s12: commit into B"` again, then `cd <B> && gh pr create --title s12 --body s12` again. |
| 24 | S17 | A | tree | (1) Run `git -C <B> merge --no-ff feature-s17 -m "s17: merge"`, then the aliased commit `git -C <B> ci --allow-empty -m "s17: aliased commit"` (bootstrap made the branch `feature-s17` in B and configured `ci` there as an alias of commit). (2) Create B's own gate evidence in this session: run `/dev-process-toolkit:gate-check <B>`, which records the run with `gate_receipt.ts gate-check <B>`. (3) Run `git -C <B> merge --no-ff feature-s17 -m "s17: merge"` again, then `git -C <B> ci --allow-empty -m "s17: aliased commit"` again. Run no other git command that writes into <B>. |
| 25–26 | S16 | A, then B | tree | Write `specs/plan/M999.md` by hand through the typed `M<N>` door, then run gate probe #73. |

On Linear the run never retries a create the free plan refused with a 400: the step ends there, no further step is started, and the run goes straight to § Phase 5 — Teardown, then the second audit, Phase 6 (which aborts the leg as `linear-free-issue-limit`) and the closing accounting.

Before you write a prompt into the step fence, fill in every `<…>` placeholder: `<nonce>`, `<A>` and `<B>` as the absolute paths of the two repositories, `<tracker>`, `<container>` (the shared space key or project name), `<token>` (the span milestone's plan token, from A's `specs/plan/` after step 6), and the ticket keys earlier steps' logs returned. The grader reads commands into B by B's path, so `<B>` must be written out, never abbreviated.

### The interview answers

Under `claude -p` the child has no `AskUserQuestion` tool. The auto-approve marker relaxes only the gates that have a safe default, and a clarifying question has none, so without answers every `/spec-write` step would refuse at its first question. Those steps create every tracker item the run is graded on. So the step fence puts a sanctioned `<dpt:answers>v1` … `</dpt:answers>` block below the marker in every child's prompt, one `key: value` per line, parsed by `extractAutoAnswers` / `resolveInterviewAnswer` in `plugins/dev-process-toolkit/adapters/_shared/src/auto_answers.ts` (contract: `docs/auto-mode-protocol.md` § Sanctioned Answers Block). It carries `/spec-write`'s twelve interview keys, and `tracker_orphan_import` for the orphan-import question that § 0.5 asks on every tracker-mode run once the intruder's untagged item exists (step 3 on).

Ten keys are the same on every step and are written in the fence. The three below change per step: fill them into the fence's answers heredoc, written out without backticks and with every `<…>` placeholder filled. A step that creates an FR answers `feature_summary` with the exact title its prompt names, because the title is what the grader counts. Only step 22 answers `tracker_orphan_import` with an `Import <KEY>` label. The tracker-write hook reads that key from the prompt as the import consent. Every other step names no key in it, so no step before S13 can import the intruder's item.

| step | feature_summary | milestone | tracker_orphan_import |
|---|---|---|---|
| step 1 | `<nonce> S8 legacy item` | accept the recommended next free milestone | Skip every orphan; import nothing |
| step 2 | none — this step creates no FR | none — this step creates no FR | Skip every orphan; import nothing |
| step 3 | none — this step creates no FR | none — this step creates no FR | Skip every orphan; import nothing |
| step 4–5 | `<nonce> S1 same title` | accept the recommended next free milestone | Skip every orphan; import nothing |
| step 6 | none — plan the milestone only; create no FR | create the new milestone `<nonce> S3 span`, spanning `<B>` | Skip every orphan; import nothing |
| step 7 | none — this step creates nothing | none — this step decides no join | Skip every orphan; import nothing |
| step 8 | none — this step creates no FR | none — this step creates no FR | Skip every orphan; import nothing |
| step 9 | none — this step creates no FR | join the milestone `<nonce> S3 span` by its key | Skip every orphan; import nothing |
| step 10–11 | `<nonce> S2 joined title` | the joined milestone `<token>` (`<nonce> S3 span`), by its key | Skip every orphan; import nothing |
| step 12–13 | none — this step creates no FR | none — this step creates no FR | Skip every orphan; import nothing |
| step 14 | none — this step creates no FR | none — this step creates no FR | Skip every orphan; import nothing |
| step 15 | none — this step creates no FR | none — this step creates no FR | Skip every orphan; import nothing |
| step 16 | `<nonce> S6 below floor` | accept the recommended next free milestone | Skip every orphan; import nothing |
| step 17 | none — this step creates no FR | none — this step creates no FR | Skip every orphan; import nothing |
| step 18 | none — this step creates no FR | none — this step creates no FR | Skip every orphan; import nothing |
| step 19 | none — this step creates no FR | none — this step creates no FR | Skip every orphan; import nothing |
| step 20 | `<nonce> S10 old client` | accept the recommended next free milestone | Skip every orphan; import nothing |
| step 21 | none — this step creates no FR | none — this step creates no FR | Skip every orphan; import nothing |
| step 22 | none — this step creates no FR | none — this step creates no FR | `Import <intruder key>` |
| step 23 | none — this step creates no FR | none — this step creates no FR | Skip every orphan; import nothing |
| step 24 | none — this step creates no FR | none — this step creates no FR | Skip every orphan; import nothing |
| step 25–26 | none — this step creates no FR | none — this step creates no FR | Skip every orphan; import nothing |

### Running a step

**Three steps need operator setup, and none starts a child:** § Before step 14 archives A's own span FR, so A's `/ship-milestone` gets past its unshipped-FR refusal to the sibling gate; § Between step 14 and step 15 archives B's span FR, which the S5 permit twin needs; and § Before step 19 builds the worktree S11 runs in.

**S11 tests the pre-declaration branch offline only.** S11's registry property also covers a worktree of B on a branch that predates the declaration. By contract that worktree is an undeclared repository, so its write is permitted and the untagged ticket it creates is left to the detector (AC-STE-616.10). The live grader's S11 predicate fails any S11 write the tracker-write hook did not refuse. Its run-wide gated-writes check would also flag that unreceipted create as `ungated-write`, and the Linear budget does not fund it. So the live S11 step exercises only the relocated worktree and the unreadable declaration, and the pre-declaration half stays with the offline suite.

> ⛔ **Wait in the foreground.** Do not await a child through the Bash tool's `run_in_background`, the `Monitor` tool, a background-task notification, or by ending the turn. The only sanctioned wait is the bounded `kill -0` poll in § Waiting for a child.

**Run it from a file (STE-595).** Write the step fence to a file and run `bash <file>`; never feed it to `bash`, `sh` or `zsh` through stdin, whether by heredoc, pipe or `bash -s`. A stdin-fed spawn script looped to ~1.5k sessions on 2026-09-11. The heredoc below feeds the CHILD's prompt on the child's stdin; the fence itself still runs from a file.

```bash
# shared-tracker-smoke: scenario step — one child, one marker
rm -f /tmp/dpt-shared-<tracker>-step.pid  # first, before anything can refuse: the wait fence must never read the previous step's pid
RUN_STATE_NEEDS="TRACKER TOPLEVEL DPT_SMOKE_RUN_ID SPAWN_CEILING ROOT_A ROOT_B PLUGIN_TREE PLUGIN_BELOW_FLOOR PLUGIN_INTRUDER OLD_CLIENT"
RUN_STATE_NEEDS_LINEAR=""
# run-state preamble: begin — the same lines in every fence that reads the run state
# loader canary: this document's text reaches a session with the invocation's arguments already
# substituted for its positional parameters, so a fence RUN FROM THE LOADED TEXT would refuse with an
# empty message and read the wrong word in every `case`. The left side below is spelled so the loader
# rewrites it and the right side so it cannot, which is why the two agree only off disk. The right
# side spells its dollar as an octal escape, which also keeps the line free of the two characters a
# string replacement would read as "everything after the match".
LOADER_CANARY='$1'
LOADER_EXPECT="$(printf '\044')1"
[ "${LOADER_CANARY}" = "${LOADER_EXPECT}" ] || { printf '/shared-tracker-smoke: %s\nRemedy: %s\nContext: skill=shared-tracker-smoke, phase=fence, check=loader-substituted, tracker=<tracker>\n' "this fence was copied from the loaded skill text, where the loader had already substituted its positional parameters; nothing was run and nothing was written." "take the fence from the document on disk instead: extract it from .claude/skills/shared-tracker-smoke/SKILL.md into a file (§ Running a fence) and run that file." >&2; exit 1; }
RUN_ENV="/tmp/dpt-shared-<tracker>-run.env"
run_state_refuse() {
  printf '/shared-tracker-smoke: %s\nRemedy: %s\nContext: skill=shared-tracker-smoke, phase=run-state, check=run-state-missing, tracker=<tracker>\n' "$1" "restore the line by hand from its source (Phase 0's plan /tmp/dpt-shared-<tracker>-plan.env, the pre-flight env /tmp/dpt-shared-<tracker>-preflight.env, or the values Phase 2 recorded) and run this fence again; never re-run Phase 0.5 mid-run, which mints a new nonce and wipes this run's scratch. This fence started nothing and wrote nothing. If the run state cannot be restored and /tmp/dpt-shared-<tracker>-teardown-owed exists, run § Phase 5 — Teardown now, then start a new run from Phase 0." >&2
  exit 1
}
{ [ -f "${RUN_ENV}" ] && [ -r "${RUN_ENV}" ]; } || run_state_refuse "the run state ${RUN_ENV} is missing or unreadable."
. "${RUN_ENV}"
case "${TRACKER:-}:<tracker>" in
  jira:jira | linear:linear) ;;
  *) run_state_refuse "the run state ${RUN_ENV} records TRACKER=${TRACKER:-unset}; it must be exactly jira or linear, and the tracker this fence was written for." ;;
esac
[ "${TRACKER}" != linear ] || RUN_STATE_NEEDS="${RUN_STATE_NEEDS} ${RUN_STATE_NEEDS_LINEAR}"
for RUN_STATE_VAR in ${RUN_STATE_NEEDS}; do
  [ -n "${!RUN_STATE_VAR:-}" ] || run_state_refuse "the run state ${RUN_ENV} records no ${RUN_STATE_VAR}, which this fence needs (${RUN_STATE_NEEDS})."
done
# run-state preamble: end
export CLAUDE_CONFIG_DIR=~/.claude-st
DPT_SMOKE_LEG="shared-<tracker>"
STEP_NAME="<step number>-<marker>"
STEP_MARKER="<marker>"
STEP_ROOT="<A|B|B-relocated>"
STEP_CLIENT="<tree|below-floor|old-client|intruder>"
# The prompt goes through a file: bash 3.2 cannot parse an apostrophe inside a heredoc nested in $( ).
cat > "/tmp/dpt-shared-<tracker>-step.prompt" <<'STEP_EOF'
<the step's prompt from the table, every <…> placeholder written out>
STEP_EOF
STEP_PROMPT=$(cat "/tmp/dpt-shared-<tracker>-step.prompt")
# The interview answers (§ The interview answers): three per-step values, ten fixed. The block's delimiters are written below, never by hand.
cat > "/tmp/dpt-shared-<tracker>-step.answers" <<'ANSWERS_EOF'
feature_summary: <the step's feature_summary from § The interview answers>
milestone: <the step's milestone from § The interview answers>
tracker_orphan_import: <the step's tracker_orphan_import from § The interview answers>
acceptance_criteria: one AC — the FR exists in the tracker under exactly its title, carrying this repository's tag
implementation_file: none — a tracker-binding smoke FR changes no code
test_file: none — a tracker-binding smoke FR changes no code
changelog_category: Added
technical_design: none — the FR is a tracker record of a throwaway smoke repository; no code changes
testing: none beyond the live grader's records of this run
cross_cutting_requirements: none — the FR is self-contained
out_of_scope: any code change, any release, and any tracker write the step's prompt does not name
non_functional_requirements: none beyond the repository's existing gate
risks: none — throwaway repositories and a throwaway tracker container
ANSWERS_EOF
STEP_ANSWERS=$(cat "/tmp/dpt-shared-<tracker>-step.answers")
refuse_step() {
  printf '/shared-tracker-smoke: %s\nRemedy: %s\nContext: skill=shared-tracker-smoke, phase=scenarios, check=%s, step=%s, tracker=%s\n' "$2" "$3" "$1" "${STEP_NAME}" "${TRACKER:-unset}" >&2
  exit 1
}
case "${STEP_ROOT}" in
  A) STEP_CWD="${ROOT_A}"; STEP_MCP=A ;;
  B) STEP_CWD="${ROOT_B}"; STEP_MCP=B ;;
  B-relocated) STEP_CWD="${ROOT_B}/.s11/relocated"; STEP_MCP=B ;;
  *) echo "step: unknown root ${STEP_ROOT}" >&2; exit 2 ;;
esac
case "${STEP_CLIENT}" in
  tree) STEP_PLUGIN="${PLUGIN_TREE}" ;;
  below-floor) STEP_PLUGIN="${PLUGIN_BELOW_FLOOR}" ;;
  old-client) STEP_PLUGIN="${OLD_CLIENT}" ;;
  intruder) STEP_PLUGIN="${PLUGIN_INTRUDER}" ;;
  *) echo "step: unknown client ${STEP_CLIENT}" >&2; exit 2 ;;
esac
MARKER_LINE="dpt-shared-tracker-scenario: ${STEP_MARKER}"
[ "${STEP_CLIENT}" = tree ] || MARKER_LINE="${MARKER_LINE} client=${STEP_CLIENT}"
# The ceiling, fail closed: an unset ceiling or an unreadable ledger refuses; it never reads as room to spawn.
case "${SPAWN_CEILING:-}" in
  "" | *[!0-9]*) refuse_step ceiling-unset "SPAWN_CEILING is ${SPAWN_CEILING:-unset}, not the whole number Phase 0 derived; nothing started." "restore it from Phase 0's plan, which Phase 0.5 keeps: append the SPAWN_CEILING line of /tmp/dpt-shared-${TRACKER}-plan.env to the run state, then run this step again; never Phase 0.5 mid-run, which wipes the teardown-owed marker, the step logs and the answers. If that plan is gone too, run § Phase 5 — Teardown now if a scenario child was already spawned, then start a new run from Phase 0." ;;
esac
LEDGER_OUT=$(bun "${TOPLEVEL}/plugins/dev-process-toolkit/adapters/_shared/src/smoke_run_ledger.ts" sessions --project-root "${TOPLEVEL}" --run "${DPT_SMOKE_RUN_ID}" --leg "${DPT_SMOKE_LEG}") \
  || refuse_step ledger-unreadable "the run ledger for run ${DPT_SMOKE_RUN_ID:-unset}, leg ${DPT_SMOKE_LEG}, could not be read; a failed read is not zero sessions, so nothing started." "fix what the ledger read names, then run § Phase 5 — Teardown now: it is owed once a scenario child was spawned."
LEDGERED=$(printf '%s' "${LEDGER_OUT}" | grep -c .)
if [ "${LEDGERED}" -ge "${SPAWN_CEILING}" ]; then
  refuse_step spawn-overrun "${LEDGERED} sessions are already ledgered, the ceiling is ${SPAWN_CEILING}; nothing started." "start no further child; run § Phase 5 — Teardown now, then Phase 6, which grades the run as an abort (spawn-overrun)."
fi
# From this spawn on, Phase 5 teardown is owed on every outcome.
: > "/tmp/dpt-shared-${TRACKER}-teardown-owed"
LAUNCHED=0
PIDS=""
cd "${STEP_CWD}" || exit 1
SID_STEP=$(uuidgen | tr '[:upper:]' '[:lower:]')
bun "${TOPLEVEL}/plugins/dev-process-toolkit/adapters/_shared/src/smoke_run_ledger.ts" append \
  --project-root "${TOPLEVEL}" \
  --run "${DPT_SMOKE_RUN_ID}" --leg "${DPT_SMOKE_LEG}" --session "${SID_STEP}"
claude -p \
  --session-id "${SID_STEP}" \
  --output-format stream-json --verbose \
  --plugin-dir "${STEP_PLUGIN}" \
  --mcp-config "/tmp/dpt-shared-${TRACKER}-mcp-${STEP_MCP}.json" --strict-mcp-config \
  > "/tmp/dpt-shared-${TRACKER}-${STEP_NAME}.log" 2>&1 <<PROMPT_EOF &
<dpt:auto-approve>v1</dpt:auto-approve>
${MARKER_LINE}
The toolkit under test is ${STEP_PLUGIN}. Run every toolkit script from exactly that path, as bun "${STEP_PLUGIN}/adapters/_shared/src/<name>.ts", and never from a plugin cache, an installed copy, or a path you resolve yourself: \$CLAUDE_PLUGIN_ROOT is empty inside a Bash call, so a bare script name is yours to resolve, and resolving it elsewhere grades a version nobody is testing.
${STEP_PROMPT}

<dpt:answers>v1
${STEP_ANSWERS}
</dpt:answers>
PROMPT_EOF
echo $! > "/tmp/dpt-shared-${TRACKER}-step.pid"
LAUNCHED=$((LAUNCHED + 1)); PIDS="${PIDS} $!"
# STE-595: the live-child count, before anything below can exit.
for TRY in $(seq 1 18); do
  LIVE=0
  P=$(cat "/tmp/dpt-shared-${TRACKER}-step.pid" 2>/dev/null)
  kill -0 "${P}" 2>/dev/null && case "$(ps -p "${P}" -o comm=)" in claude|*/claude) LIVE=$((LIVE + 1)) ;; esac
  [ "${LIVE}" -eq "${LAUNCHED}" ] && break
  sleep 0.1
done
echo "launched=${LAUNCHED} live=${LIVE}"
if [ "${LIVE}" -ne "${LAUNCHED}" ]; then
  for P in $(printf '%s\n' "${PIDS}"); do
    kill -0 "${P}" 2>/dev/null && case "$(ps -p "${P}" -o comm=)" in claude|*/claude) kill "${P}" ;; esac
  done
  rm -f "/tmp/dpt-shared-${TRACKER}-step.pid"
  echo "ABORT: /shared-tracker-smoke step ${STEP_NAME} spawn count mismatch — reaped; run § Phase 5 — Teardown now"
  exit 1
fi
```

### Waiting for a child

Poll in bounded foreground calls until the child exits, then start the next step. Each call runs from a file, like every fence here.

```bash
# shared-tracker-smoke: wait — bounded, foreground
# Both spawn fences clear the pidfile as their first line, before anything can refuse, and write it only
# when a child launches; so a missing or empty pidfile means no step is running (never launched, refused,
# or aborted) and is never read as "exited" — and a refused step never leaves the previous step's pid.
P=$(cat /tmp/dpt-shared-<tracker>-step.pid 2>/dev/null)
if [ -z "${P}" ]; then
  printf '/shared-tracker-smoke: %s\nRemedy: %s\nContext: skill=shared-tracker-smoke, phase=wait, check=step-pid-missing\n' "no step pidfile at /tmp/dpt-shared-<tracker>-step.pid: no step was launched, or its launch was aborted, so there is nothing to wait for." "read the step fence's last output: an ABORT line means run § Phase 5 — Teardown; otherwise launch the step again." >&2
  exit 1
fi
for TRY in $(seq 1 20); do
  kill -0 "${P}" 2>/dev/null || { echo "exited: ${P}"; exit 0; }
  sleep 15
done
echo "still running: ${P} — poll again"
```

### Before step 14 — archive A's span FR (operator, no child)

Step 10 leaves A's own S2 FR active in the span milestone. `/ship-milestone` refuses a milestone with an unshipped FR (its refusal #1) before it reaches the sibling gate, so without this fence step 14 would stop there, `sibling_release.ts` would never run, and S5 would be `not-observed`. After step 13's child has exited and before step 14 starts, this fence archives every active FR in A bound to the span token, flips its frontmatter with the toolkit's own `archive_fr.ts` helper, and commits the move in A with an `archive` subject. A is then idle on the span milestone, and B's FR is still active. The commit lands before step 14's `sibling_release.ts` run, so it is not a commit during the busy-sibling step. It starts no child and writes nothing to the tracker. It refuses, and commits nothing, when A holds no active FR bound to the token.

**Run it from a file.** Write the fence to a file and run `bash <file>`; never feed it to `bash`, `sh` or `zsh` through stdin.

```bash
# shared-tracker-smoke: S5 idle A — A's span FR, before step 14
RUN_STATE_NEEDS="TRACKER ROOT_A PLUGIN_TREE"
RUN_STATE_NEEDS_LINEAR=""
# run-state preamble: begin — the same lines in every fence that reads the run state
# loader canary: this document's text reaches a session with the invocation's arguments already
# substituted for its positional parameters, so a fence RUN FROM THE LOADED TEXT would refuse with an
# empty message and read the wrong word in every `case`. The left side below is spelled so the loader
# rewrites it and the right side so it cannot, which is why the two agree only off disk. The right
# side spells its dollar as an octal escape, which also keeps the line free of the two characters a
# string replacement would read as "everything after the match".
LOADER_CANARY='$1'
LOADER_EXPECT="$(printf '\044')1"
[ "${LOADER_CANARY}" = "${LOADER_EXPECT}" ] || { printf '/shared-tracker-smoke: %s\nRemedy: %s\nContext: skill=shared-tracker-smoke, phase=fence, check=loader-substituted, tracker=<tracker>\n' "this fence was copied from the loaded skill text, where the loader had already substituted its positional parameters; nothing was run and nothing was written." "take the fence from the document on disk instead: extract it from .claude/skills/shared-tracker-smoke/SKILL.md into a file (§ Running a fence) and run that file." >&2; exit 1; }
RUN_ENV="/tmp/dpt-shared-<tracker>-run.env"
run_state_refuse() {
  printf '/shared-tracker-smoke: %s\nRemedy: %s\nContext: skill=shared-tracker-smoke, phase=run-state, check=run-state-missing, tracker=<tracker>\n' "$1" "restore the line by hand from its source (Phase 0's plan /tmp/dpt-shared-<tracker>-plan.env, the pre-flight env /tmp/dpt-shared-<tracker>-preflight.env, or the values Phase 2 recorded) and run this fence again; never re-run Phase 0.5 mid-run, which mints a new nonce and wipes this run's scratch. This fence started nothing and wrote nothing. If the run state cannot be restored and /tmp/dpt-shared-<tracker>-teardown-owed exists, run § Phase 5 — Teardown now, then start a new run from Phase 0." >&2
  exit 1
}
{ [ -f "${RUN_ENV}" ] && [ -r "${RUN_ENV}" ]; } || run_state_refuse "the run state ${RUN_ENV} is missing or unreadable."
. "${RUN_ENV}"
case "${TRACKER:-}:<tracker>" in
  jira:jira | linear:linear) ;;
  *) run_state_refuse "the run state ${RUN_ENV} records TRACKER=${TRACKER:-unset}; it must be exactly jira or linear, and the tracker this fence was written for." ;;
esac
[ "${TRACKER}" != linear ] || RUN_STATE_NEEDS="${RUN_STATE_NEEDS} ${RUN_STATE_NEEDS_LINEAR}"
for RUN_STATE_VAR in ${RUN_STATE_NEEDS}; do
  [ -n "${!RUN_STATE_VAR:-}" ] || run_state_refuse "the run state ${RUN_ENV} records no ${RUN_STATE_VAR}, which this fence needs (${RUN_STATE_NEEDS})."
done
# run-state preamble: end
SPAN_TOKEN="<the span milestone's token: the basename, without .md, of its plan file under specs/plan/>"
refuse() {
  printf '/shared-tracker-smoke: %s\nRemedy: %s\nContext: skill=shared-tracker-smoke, phase=scenarios, check=%s, step=s5-idle-a, tracker=%s\n' "$2" "$3" "$1" "${TRACKER:-unset}" >&2
  exit 1
}
git -C "${ROOT_A}" rev-parse --git-dir >/dev/null 2>&1 \
  || refuse a-not-a-repository "${ROOT_A} is not a git repository; nothing was archived." "this run cannot reach its S5 busy-sibling step; scenario children have already run, so the bootstrap cannot be re-run over this run: run § Phase 5 — Teardown now (it is owed), then Phase 6, which grades the missing scenario as not observed, and start a new run from Phase 0.5."
FRS=()
for F in "${ROOT_A}"/specs/frs/*.md; do
  [ -f "${F}" ] || continue
  FM=$(awk 'NR == 1 && $0 == "---" { inside = 1; next } inside && $0 == "---" { exit } inside' "${F}")
  printf '%s\n' "${FM}" | grep -Eqx "milestone: [\"']?${SPAN_TOKEN}[\"']?" || continue
  printf '%s\n' "${FM}" | grep -qx 'status: active' || continue
  FRS+=("${F##*/}")
done
[ "${#FRS[@]}" -gt 0 ] \
  || refuse no-active-span-fr "A holds no active FR bound to ${SPAN_TOKEN}; nothing was archived or committed." "check SPAN_TOKEN against A's specs/plan/ and specs/frs/; step 10 should have left A's S2 FR active there."
AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
mkdir -p "${ROOT_A}/specs/frs/archive"
for N in "${FRS[@]}"; do
  mv "${ROOT_A}/specs/frs/${N}" "${ROOT_A}/specs/frs/archive/${N}"
  ARCHIVE_PATH="${ROOT_A}/specs/frs/archive/${N}" ARCHIVED_AT="${AT}" MODULE="${PLUGIN_TREE}/adapters/_shared/src/archive_fr.ts" \
    bun -e 'const m = await import(process.env.MODULE); await m.flipArchivedFrontmatter(process.env.ARCHIVE_PATH, process.env.ARCHIVED_AT);' \
    || refuse frontmatter-flip-failed "the archived FR ${N} could not be flipped to status: archived." "restore specs/frs/${N} in A by hand and run this fence again."
done
# Stage what the RUN legitimately leaves, so the clean-tree assertion below can stay
# strict: `specs` (the plan step 6 wrote and the FRs just archived) and `.dpt` (the
# receipts A's own front-door runs announced). Anything else dirty still refuses — the
# assertion is unchanged, and a check that stopped checking would hide a real dirty tree.
# Each path only if it exists: a run that wrote no receipt has no `.dpt`, and an
# absent directory is not an error — `git add` would refuse the whole commit on it.
for P in specs .dpt; do
  if [ -e "${ROOT_A}/${P}" ]; then git -C "${ROOT_A}" add -A "${P}"; fi
done
git -C "${ROOT_A}" -c commit.gpgsign=false commit -qm "docs(specs): archive ${FRS[*]} (A idle before S5)" \
  || refuse archive-commit-failed "the archive of ${FRS[*]} could not be committed in A." "commit it in A by hand with an archive subject before step 14."
[ -z "$(git -C "${ROOT_A}" status --porcelain)" ] \
  || refuse a-tree-dirty "A's tree is not clean after the archive; /ship-milestone would stop at its clean-tree refusal." "commit or remove what git -C ${ROOT_A} status names before step 14."
echo "archived in A: ${FRS[*]}"
```

### Between step 14 and step 15 — archive B's span FR (operator, no child)

The S5 permit twin (step 15) needs B idle on the span milestone: no active FR bound to it, at least one archived. The grader also requires an archive commit in B before the twin's `sibling_release.ts` run. After step 14's child has exited and before step 15 starts, this fence archives every active FR in B bound to the span token, flips its frontmatter with the toolkit's own `archive_fr.ts` helper, and commits the move in B with an `archive` subject. It starts no child and writes nothing to the tracker. It refuses, and commits nothing, when B holds no active FR bound to the token.

**Run it from a file.** Write the fence to a file and run `bash <file>`; never feed it to `bash`, `sh` or `zsh` through stdin.

```bash
# shared-tracker-smoke: S5 archive — B's span FR, between step 14 and step 15
RUN_STATE_NEEDS="TRACKER ROOT_B PLUGIN_TREE"
RUN_STATE_NEEDS_LINEAR=""
# run-state preamble: begin — the same lines in every fence that reads the run state
# loader canary: this document's text reaches a session with the invocation's arguments already
# substituted for its positional parameters, so a fence RUN FROM THE LOADED TEXT would refuse with an
# empty message and read the wrong word in every `case`. The left side below is spelled so the loader
# rewrites it and the right side so it cannot, which is why the two agree only off disk. The right
# side spells its dollar as an octal escape, which also keeps the line free of the two characters a
# string replacement would read as "everything after the match".
LOADER_CANARY='$1'
LOADER_EXPECT="$(printf '\044')1"
[ "${LOADER_CANARY}" = "${LOADER_EXPECT}" ] || { printf '/shared-tracker-smoke: %s\nRemedy: %s\nContext: skill=shared-tracker-smoke, phase=fence, check=loader-substituted, tracker=<tracker>\n' "this fence was copied from the loaded skill text, where the loader had already substituted its positional parameters; nothing was run and nothing was written." "take the fence from the document on disk instead: extract it from .claude/skills/shared-tracker-smoke/SKILL.md into a file (§ Running a fence) and run that file." >&2; exit 1; }
RUN_ENV="/tmp/dpt-shared-<tracker>-run.env"
run_state_refuse() {
  printf '/shared-tracker-smoke: %s\nRemedy: %s\nContext: skill=shared-tracker-smoke, phase=run-state, check=run-state-missing, tracker=<tracker>\n' "$1" "restore the line by hand from its source (Phase 0's plan /tmp/dpt-shared-<tracker>-plan.env, the pre-flight env /tmp/dpt-shared-<tracker>-preflight.env, or the values Phase 2 recorded) and run this fence again; never re-run Phase 0.5 mid-run, which mints a new nonce and wipes this run's scratch. This fence started nothing and wrote nothing. If the run state cannot be restored and /tmp/dpt-shared-<tracker>-teardown-owed exists, run § Phase 5 — Teardown now, then start a new run from Phase 0." >&2
  exit 1
}
{ [ -f "${RUN_ENV}" ] && [ -r "${RUN_ENV}" ]; } || run_state_refuse "the run state ${RUN_ENV} is missing or unreadable."
. "${RUN_ENV}"
case "${TRACKER:-}:<tracker>" in
  jira:jira | linear:linear) ;;
  *) run_state_refuse "the run state ${RUN_ENV} records TRACKER=${TRACKER:-unset}; it must be exactly jira or linear, and the tracker this fence was written for." ;;
esac
[ "${TRACKER}" != linear ] || RUN_STATE_NEEDS="${RUN_STATE_NEEDS} ${RUN_STATE_NEEDS_LINEAR}"
for RUN_STATE_VAR in ${RUN_STATE_NEEDS}; do
  [ -n "${!RUN_STATE_VAR:-}" ] || run_state_refuse "the run state ${RUN_ENV} records no ${RUN_STATE_VAR}, which this fence needs (${RUN_STATE_NEEDS})."
done
# run-state preamble: end
SPAN_TOKEN="<the span milestone's token: the basename, without .md, of its plan file under specs/plan/>"
refuse() {
  printf '/shared-tracker-smoke: %s\nRemedy: %s\nContext: skill=shared-tracker-smoke, phase=scenarios, check=%s, step=s5-archive, tracker=%s\n' "$2" "$3" "$1" "${TRACKER:-unset}" >&2
  exit 1
}
git -C "${ROOT_B}" rev-parse --git-dir >/dev/null 2>&1 \
  || refuse b-not-a-repository "${ROOT_B} is not a git repository; nothing was archived." "this run cannot reach its S5 permit twin; scenario children have already run, so the bootstrap cannot be re-run over this run: run § Phase 5 — Teardown now (it is owed), then Phase 6, which grades the missing scenario as not observed, and start a new run from Phase 0.5."
FRS=()
for F in "${ROOT_B}"/specs/frs/*.md; do
  [ -f "${F}" ] || continue
  FM=$(awk 'NR == 1 && $0 == "---" { inside = 1; next } inside && $0 == "---" { exit } inside' "${F}")
  printf '%s\n' "${FM}" | grep -Eqx "milestone: [\"']?${SPAN_TOKEN}[\"']?" || continue
  printf '%s\n' "${FM}" | grep -qx 'status: active' || continue
  FRS+=("${F##*/}")
done
[ "${#FRS[@]}" -gt 0 ] \
  || refuse no-active-span-fr "B holds no active FR bound to ${SPAN_TOKEN}; nothing was archived or committed." "check SPAN_TOKEN against B's specs/plan/ and specs/frs/; without an archived FR the S5 permit twin cannot pass."
AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
mkdir -p "${ROOT_B}/specs/frs/archive"
for N in "${FRS[@]}"; do
  mv "${ROOT_B}/specs/frs/${N}" "${ROOT_B}/specs/frs/archive/${N}"
  ARCHIVE_PATH="${ROOT_B}/specs/frs/archive/${N}" ARCHIVED_AT="${AT}" MODULE="${PLUGIN_TREE}/adapters/_shared/src/archive_fr.ts" \
    bun -e 'const m = await import(process.env.MODULE); await m.flipArchivedFrontmatter(process.env.ARCHIVE_PATH, process.env.ARCHIVED_AT);' \
    || refuse frontmatter-flip-failed "the archived FR ${N} could not be flipped to status: archived." "restore specs/frs/${N} in B by hand and run this fence again."
done
# `specs`, not `specs/frs`: the grader reads each repository's plans from `git ls-files`,
# and nothing else in the run ever stages B's plan — so B's plan was invisible at Phase 6
# and S3's join had no common milestone token to find. Staging it here is bookkeeping the
# run owes, not a change to what S3 proves.
# Each path only if it exists: a run that wrote no receipt has no `.dpt`, and an
# absent directory is not an error — `git add` would refuse the whole commit on it.
for P in specs .dpt; do
  if [ -e "${ROOT_B}/${P}" ]; then git -C "${ROOT_B}" add -A "${P}"; fi
done
git -C "${ROOT_B}" -c commit.gpgsign=false commit -qm "docs(specs): archive ${FRS[*]} (S5 permit twin)" \
  || refuse archive-commit-failed "the archive of ${FRS[*]} could not be committed in B." "commit it in B by hand with an archive subject before step 15."
echo "archived in B: ${FRS[*]}"
```

### Before step 19 — B's relocated worktree (operator, no child)

S11's step runs in `<B>/.s11/relocated`: a git worktree of B at another path, detached at B's HEAD. It lives inside B's directory so the grader maps its session to B, and `.s11/` goes into B's `info/exclude` so B's own tree stays clean. S8's repoint rewrites B's declaration without committing it, and a worktree reads only committed files, so the fence first commits B's current `CLAUDE.md` when it differs from HEAD. Without that, the worktree would carry the stale pre-repoint declaration. It starts no child and writes nothing to the tracker.

**Run it from a file.** Write the fence to a file and run `bash <file>`; never feed it to `bash`, `sh` or `zsh` through stdin.

```bash
# shared-tracker-smoke: S11 worktree — B's relocated checkout, before step 19
RUN_STATE_NEEDS="TRACKER ROOT_B"
RUN_STATE_NEEDS_LINEAR=""
# run-state preamble: begin — the same lines in every fence that reads the run state
# loader canary: this document's text reaches a session with the invocation's arguments already
# substituted for its positional parameters, so a fence RUN FROM THE LOADED TEXT would refuse with an
# empty message and read the wrong word in every `case`. The left side below is spelled so the loader
# rewrites it and the right side so it cannot, which is why the two agree only off disk. The right
# side spells its dollar as an octal escape, which also keeps the line free of the two characters a
# string replacement would read as "everything after the match".
LOADER_CANARY='$1'
LOADER_EXPECT="$(printf '\044')1"
[ "${LOADER_CANARY}" = "${LOADER_EXPECT}" ] || { printf '/shared-tracker-smoke: %s\nRemedy: %s\nContext: skill=shared-tracker-smoke, phase=fence, check=loader-substituted, tracker=<tracker>\n' "this fence was copied from the loaded skill text, where the loader had already substituted its positional parameters; nothing was run and nothing was written." "take the fence from the document on disk instead: extract it from .claude/skills/shared-tracker-smoke/SKILL.md into a file (§ Running a fence) and run that file." >&2; exit 1; }
RUN_ENV="/tmp/dpt-shared-<tracker>-run.env"
run_state_refuse() {
  printf '/shared-tracker-smoke: %s\nRemedy: %s\nContext: skill=shared-tracker-smoke, phase=run-state, check=run-state-missing, tracker=<tracker>\n' "$1" "restore the line by hand from its source (Phase 0's plan /tmp/dpt-shared-<tracker>-plan.env, the pre-flight env /tmp/dpt-shared-<tracker>-preflight.env, or the values Phase 2 recorded) and run this fence again; never re-run Phase 0.5 mid-run, which mints a new nonce and wipes this run's scratch. This fence started nothing and wrote nothing. If the run state cannot be restored and /tmp/dpt-shared-<tracker>-teardown-owed exists, run § Phase 5 — Teardown now, then start a new run from Phase 0." >&2
  exit 1
}
{ [ -f "${RUN_ENV}" ] && [ -r "${RUN_ENV}" ]; } || run_state_refuse "the run state ${RUN_ENV} is missing or unreadable."
. "${RUN_ENV}"
case "${TRACKER:-}:<tracker>" in
  jira:jira | linear:linear) ;;
  *) run_state_refuse "the run state ${RUN_ENV} records TRACKER=${TRACKER:-unset}; it must be exactly jira or linear, and the tracker this fence was written for." ;;
esac
[ "${TRACKER}" != linear ] || RUN_STATE_NEEDS="${RUN_STATE_NEEDS} ${RUN_STATE_NEEDS_LINEAR}"
for RUN_STATE_VAR in ${RUN_STATE_NEEDS}; do
  [ -n "${!RUN_STATE_VAR:-}" ] || run_state_refuse "the run state ${RUN_ENV} records no ${RUN_STATE_VAR}, which this fence needs (${RUN_STATE_NEEDS})."
done
# run-state preamble: end
W="${ROOT_B}/.s11/relocated"
refuse() {
  printf '/shared-tracker-smoke: %s\nRemedy: %s\nContext: skill=shared-tracker-smoke, phase=scenarios, check=%s, step=s11-worktree, tracker=%s\n' "$2" "$3" "$1" "${TRACKER:-unset}" >&2
  exit 1
}
# B must be its OWN repository: a git directory somewhere above B would pass a
# plain rev-parse and turn the commit below into a commit to that foreign repository.
B_TOP=$(git -C "${ROOT_B}" rev-parse --show-toplevel 2>/dev/null) || B_TOP=""
[ -n "${B_TOP}" ] && [ "$(cd "${B_TOP}" && pwd -P)" = "$(cd "${ROOT_B}" && pwd -P)" ] \
  || refuse b-not-a-repository "${ROOT_B} is not its own git repository (its top level is ${B_TOP:-none}); no worktree was made and nothing was committed." "S11 cannot run without B; scenario children have already run, so the bootstrap cannot be re-run over this run: run § Phase 5 — Teardown now (it is owed), then Phase 6, which grades the missing scenario as not observed, and start a new run from Phase 0.5."
[ ! -e "${W}" ] || refuse worktree-exists "${W} already exists; nothing was changed." "remove it with git -C ${ROOT_B} worktree remove --force ${W}, then run this fence again."
if [ -n "$(git -C "${ROOT_B}" status --porcelain -- CLAUDE.md)" ]; then
  git -C "${ROOT_B}" add CLAUDE.md
  git -C "${ROOT_B}" -c commit.gpgsign=false commit -qm "docs(claude): commit B's shared tracker binding"
fi
COMMON=$(cd "${ROOT_B}" && cd "$(git rev-parse --git-common-dir)" && pwd -P)
grep -qx '/.s11/' "${COMMON}/info/exclude" 2>/dev/null || printf '/.s11/\n' >> "${COMMON}/info/exclude"
git -C "${ROOT_B}" worktree add -q --detach "${W}" HEAD 2>/dev/null \
  || refuse worktree-add-failed "git could not add the worktree ${W}." "run git -C ${ROOT_B} worktree add --detach ${W} HEAD by hand and read its error."
# WORKSPACE TRUST for the relocated checkout. The pre-flight checks trust for the two
# roots and tells the operator to accept the dialog there; this path does not exist until
# now, so no dialog can ever have been accepted for it. Whether a headless child is
# gated on trust for its working directory was NOT determined — seeding costs one jq write and removes
# the question, and leaving it risks S11 landing not-observed, which by AC-STE-617.8
# fails the whole run. Phase 0.5 drops the entry again when it clears this run's scratch.
CFG="${CLAUDE_CONFIG_DIR:-${HOME}/.claude}"
mkdir -p "${CFG}"
[ -f "${CFG}/.claude.json" ] || printf '{}\n' > "${CFG}/.claude.json"
W_REAL=$(cd "${W}" && pwd -P)
TRUST_TMP=$(mktemp)
jq --arg p "${W_REAL}" '.projects[$p].hasTrustDialogAccepted = true' "${CFG}/.claude.json" > "${TRUST_TMP}" \
  && mv "${TRUST_TMP}" "${CFG}/.claude.json" \
  || refuse trust-seed-failed "workspace trust for ${W_REAL} could not be written to ${CFG}/.claude.json; the worktree exists." "fix what jq reported, or add .projects[\"${W_REAL}\"].hasTrustDialogAccepted = true by hand, before step 19."
cmp -s "${ROOT_B}/CLAUDE.md" "${W}/CLAUDE.md" \
  || refuse worktree-declaration-differs "${W}/CLAUDE.md differs from B's current declaration." "commit B's CLAUDE.md, remove the worktree, and run this fence again."
echo "relocated worktree of B: ${W}"
```

## Phase 4 — Audit

A read-only child runs the fixed nonce query this fence writes into its prompt, pages it to the last page, then reads back by key every item any scenario's tool_results report as created. It requests exactly the fields the grader counts by: `summary, labels, status, parent, issuetype, project` on Jira, `id, title, labels, status, project, projectMilestone` on Linear. An answer without `labels` or `project` could not be attributed to a repository or a container. On Linear the first audit also reads the shared project's milestones, with `list_milestones` and one `get_milestone` per created milestone id, since S3 is graded by the milestone containers the audit holds and an issue search never returns a milestone. Those two calls take no field list. On Jira a milestone is an Epic, which the issue search and read-backs already return. The grader's `AUDIT_REQUEST_FIELDS` declares all of this, and a test holds this fence's prompt equal to it. The grader checks that the query it ran is byte-equal to the one written here, that it reached its last page, and that its answer holds every created key; otherwise the run aborts as `audit-incomplete`.

Before running it, write to `/tmp/dpt-shared-<tracker>-created-keys.txt` every key a step log's create answer returned, one per line.

**Run it from a file (STE-595).** Write the audit fence to a file and run `bash <file>`; never feed it to `bash`, `sh` or `zsh` through stdin. The heredoc feeds the child's prompt on the child's stdin. Wait for it with § Waiting for a child.

```bash
# shared-tracker-smoke: audit — read-only, marker audit
rm -f /tmp/dpt-shared-<tracker>-step.pid  # first, before anything can refuse: the wait fence must never read the previous step's pid
RUN_STATE_NEEDS="TRACKER TOPLEVEL DPT_SMOKE_RUN_ID SPAWN_CEILING NONCE ROOT_A PLUGIN_TREE"
RUN_STATE_NEEDS_LINEAR=""
# run-state preamble: begin — the same lines in every fence that reads the run state
# loader canary: this document's text reaches a session with the invocation's arguments already
# substituted for its positional parameters, so a fence RUN FROM THE LOADED TEXT would refuse with an
# empty message and read the wrong word in every `case`. The left side below is spelled so the loader
# rewrites it and the right side so it cannot, which is why the two agree only off disk. The right
# side spells its dollar as an octal escape, which also keeps the line free of the two characters a
# string replacement would read as "everything after the match".
LOADER_CANARY='$1'
LOADER_EXPECT="$(printf '\044')1"
[ "${LOADER_CANARY}" = "${LOADER_EXPECT}" ] || { printf '/shared-tracker-smoke: %s\nRemedy: %s\nContext: skill=shared-tracker-smoke, phase=fence, check=loader-substituted, tracker=<tracker>\n' "this fence was copied from the loaded skill text, where the loader had already substituted its positional parameters; nothing was run and nothing was written." "take the fence from the document on disk instead: extract it from .claude/skills/shared-tracker-smoke/SKILL.md into a file (§ Running a fence) and run that file." >&2; exit 1; }
RUN_ENV="/tmp/dpt-shared-<tracker>-run.env"
run_state_refuse() {
  printf '/shared-tracker-smoke: %s\nRemedy: %s\nContext: skill=shared-tracker-smoke, phase=run-state, check=run-state-missing, tracker=<tracker>\n' "$1" "restore the line by hand from its source (Phase 0's plan /tmp/dpt-shared-<tracker>-plan.env, the pre-flight env /tmp/dpt-shared-<tracker>-preflight.env, or the values Phase 2 recorded) and run this fence again; never re-run Phase 0.5 mid-run, which mints a new nonce and wipes this run's scratch. This fence started nothing and wrote nothing. If the run state cannot be restored and /tmp/dpt-shared-<tracker>-teardown-owed exists, run § Phase 5 — Teardown now, then start a new run from Phase 0." >&2
  exit 1
}
{ [ -f "${RUN_ENV}" ] && [ -r "${RUN_ENV}" ]; } || run_state_refuse "the run state ${RUN_ENV} is missing or unreadable."
. "${RUN_ENV}"
case "${TRACKER:-}:<tracker>" in
  jira:jira | linear:linear) ;;
  *) run_state_refuse "the run state ${RUN_ENV} records TRACKER=${TRACKER:-unset}; it must be exactly jira or linear, and the tracker this fence was written for." ;;
esac
[ "${TRACKER}" != linear ] || RUN_STATE_NEEDS="${RUN_STATE_NEEDS} ${RUN_STATE_NEEDS_LINEAR}"
for RUN_STATE_VAR in ${RUN_STATE_NEEDS}; do
  [ -n "${!RUN_STATE_VAR:-}" ] || run_state_refuse "the run state ${RUN_ENV} records no ${RUN_STATE_VAR}, which this fence needs (${RUN_STATE_NEEDS})."
done
# run-state preamble: end
export CLAUDE_CONFIG_DIR=~/.claude-st
DPT_SMOKE_LEG="shared-<tracker>"
AUDIT_PASS="<1 after the scenarios, 2 after teardown>"
# The fields are the grader's contract: an answer without labels or project cannot be counted.
if [ "${TRACKER}" = jira ]; then
  AUDIT_QUERY="summary ~ \"${NONCE}\" ORDER BY key ASC"
  AUDIT_FIELDS="summary, labels, status, parent, issuetype, project"
  AUDIT_READ_TOOL="mcp__atlassian__getJiraIssue"
else
  AUDIT_QUERY="${NONCE}"
  AUDIT_FIELDS="id, title, labels, status, project, projectMilestone"
  AUDIT_READ_TOOL="mcp__linear__get_issue"
fi
CREATED_KEYS=$(cat "/tmp/dpt-shared-${TRACKER}-created-keys.txt" 2>/dev/null)
refuse_audit() {
  printf '/shared-tracker-smoke: %s\nRemedy: %s\nContext: skill=shared-tracker-smoke, phase=audit, check=%s, pass=%s, tracker=%s\n' "$2" "$3" "$1" "${AUDIT_PASS}" "${TRACKER:-unset}" >&2
  exit 1
}
# An issue search never returns a milestone: the first Linear audit lists the shared project's milestones (AUDIT_REQUEST_FIELDS.linear.milestone).
MILESTONE_READS=""
if [ "${TRACKER}" = linear ] && [ "${AUDIT_PASS}" = 1 ]; then
  [ -n "${SHARED:-}" ] \
    || refuse_audit projects-unknown "the run state names no shared project (SHARED=${SHARED:-unset}); the first audit could not read its milestones, so it was not started." "restore SHARED in /tmp/dpt-shared-${TRACKER}-run.env from Phase 2's project creates, then run the audit again."
  MILESTONE_READS="Then read the shared project's milestones: call mcp__linear__list_milestones once for the project named ${SHARED}, and call mcp__linear__get_milestone once per created milestone id above (project ${SHARED}, query the id). These calls take no field list."
fi
# Linear teardown completes two projects, and an issue listing never reads a project: the second audit reads both back by name.
PROJECT_READS=""
if [ "${TRACKER}" = linear ] && [ "${AUDIT_PASS}" = 2 ]; then
  [ -n "${SHARED:-}" ] && [ -n "${PRE:-}" ] \
    || refuse_audit projects-unknown "the run state names no shared project (SHARED=${SHARED:-unset}) or no pre-repoint project (PRE=${PRE:-unset}); the second audit could not read teardown back, so it was not started." "restore SHARED and PRE in /tmp/dpt-shared-${TRACKER}-run.env from Phase 2's project creates, then run the second audit again."
  PROJECT_READS="Then call mcp__linear__get_project once for the project named ${SHARED} and once for the project named ${PRE}, by name, one call each."
fi
# The ceiling, fail closed: an unset ceiling or an unreadable ledger refuses; it never reads as room to spawn.
case "${SPAWN_CEILING:-}" in
  "" | *[!0-9]*) refuse_audit ceiling-unset "SPAWN_CEILING is ${SPAWN_CEILING:-unset}, not the whole number Phase 0 derived; the audit was not started." "restore it from Phase 0's plan, which Phase 0.5 keeps: append the SPAWN_CEILING line of /tmp/dpt-shared-${TRACKER}-plan.env to the run state, then run the audit again; never Phase 0.5 mid-run, which wipes the teardown-owed marker, the step logs and the created-key list. If that plan is gone too, run § Phase 5 — Teardown now if it has not run (it is owed on every outcome), then start a new run from Phase 0." ;;
esac
LEDGER_OUT=$(bun "${TOPLEVEL}/plugins/dev-process-toolkit/adapters/_shared/src/smoke_run_ledger.ts" sessions --project-root "${TOPLEVEL}" --run "${DPT_SMOKE_RUN_ID}" --leg "${DPT_SMOKE_LEG}") \
  || refuse_audit ledger-unreadable "the run ledger for run ${DPT_SMOKE_RUN_ID:-unset}, leg ${DPT_SMOKE_LEG}, could not be read; a failed read is not zero sessions, so the audit was not started." "fix what the ledger read names, and run § Phase 5 — Teardown now if it has not run: it is owed on every outcome."
LEDGERED=$(printf '%s' "${LEDGER_OUT}" | grep -c .)
if [ "${LEDGERED}" -ge "${SPAWN_CEILING}" ]; then
  refuse_audit spawn-overrun "${LEDGERED} sessions are already ledgered, the ceiling is ${SPAWN_CEILING}; the audit was not started." "start no further child; run § Phase 5 — Teardown now if it has not run, then Phase 6, which grades the run as an abort (spawn-overrun)."
fi
LAUNCHED=0
PIDS=""
cd "${ROOT_A}" || exit 1
SID_AUDIT=$(uuidgen | tr '[:upper:]' '[:lower:]')
bun "${TOPLEVEL}/plugins/dev-process-toolkit/adapters/_shared/src/smoke_run_ledger.ts" append \
  --project-root "${TOPLEVEL}" \
  --run "${DPT_SMOKE_RUN_ID}" --leg "${DPT_SMOKE_LEG}" --session "${SID_AUDIT}"
claude -p \
  --session-id "${SID_AUDIT}" \
  --output-format stream-json --verbose \
  --plugin-dir "${PLUGIN_TREE}" \
  --mcp-config "/tmp/dpt-shared-${TRACKER}-mcp-A.json" --strict-mcp-config \
  > "/tmp/dpt-shared-${TRACKER}-audit-${AUDIT_PASS}.log" 2>&1 <<PROMPT_EOF &
<dpt:auto-approve>v1</dpt:auto-approve>
dpt-shared-tracker-scenario: audit
Read only: make no create, edit, transition, comment, link or import call.
Run this exact search, byte for byte, and page it to its last page: ${AUDIT_QUERY}
Run no other search: the grader compares every search in this session with the one above, and any other aborts the leg.
Request exactly these fields on the search and on every read-back: ${AUDIT_FIELDS}
Then read back each of these keys by key, one ${AUDIT_READ_TOOL} call per key, never a search:
${CREATED_KEYS}
${MILESTONE_READS}
${PROJECT_READS}
PROMPT_EOF
echo $! > "/tmp/dpt-shared-${TRACKER}-step.pid"
LAUNCHED=$((LAUNCHED + 1)); PIDS="${PIDS} $!"
for TRY in $(seq 1 18); do
  LIVE=0
  P=$(cat "/tmp/dpt-shared-${TRACKER}-step.pid" 2>/dev/null)
  kill -0 "${P}" 2>/dev/null && case "$(ps -p "${P}" -o comm=)" in claude|*/claude) LIVE=$((LIVE + 1)) ;; esac
  [ "${LIVE}" -eq "${LAUNCHED}" ] && break
  sleep 0.1
done
echo "launched=${LAUNCHED} live=${LIVE}"
if [ "${LIVE}" -ne "${LAUNCHED}" ]; then
  for P in $(printf '%s\n' "${PIDS}"); do
    kill -0 "${P}" 2>/dev/null && case "$(ps -p "${P}" -o comm=)" in claude|*/claude) kill "${P}" ;; esac
  done
  rm -f "/tmp/dpt-shared-${TRACKER}-step.pid"
  echo "ABORT: /shared-tracker-smoke audit ${AUDIT_PASS} spawn count mismatch — reaped; run § Phase 5 — Teardown now if it has not run"
  exit 1
fi
```

## Phase 5 — Teardown

**When teardown is owed.** It is keyed on the first scenario spawn. Jira's bootstrap writes nothing to the tracker, so a trigger keyed on bootstrap would never fire there. The step fence writes the marker `/tmp/dpt-shared-<tracker>-teardown-owed` just before it appends the first ledger row and spawns. On Linear, Phase 2 writes the marker earlier, right after its first project create and before its second write, because that create is the run's first tracker write: a failure between Phase 2's first and fourth create still leaves teardown owed. Once the marker exists, teardown runs on every outcome: pass, fail, abort, a step or audit refusal (`spawn-overrun`, an unreadable ledger, an unset ceiling), a spawn-count mismatch, and the Linear free-issue-limit stop. `--keep` only skips the prompts. From this operator session:

- **Jira:** transition every nonce item, Epics included, in the shared space and, when given, the repoint-from space, to Done.
- **Linear:** complete both throwaway projects, `dpt-shared-<nonce>` and `dpt-shared-<nonce>-pre` (the run state's `SHARED` and `PRE`), each with `mcp__linear__save_project(id: <project name>, state: "completed")`. Complete whichever of them exists when Phase 2 stopped part-way. No MCP tool archives or deletes a Linear issue; the closing summary names every issue the run created so the operator can archive them by hand. A Linear label cannot be deleted through the MCP either: after teardown, retire both tag labels, `shr-<nonce>-a` and `shr-<nonce>-b`, with `mcp__linear__retire_issue_label(id: <label id>)`. That tool takes the label's `id` ("Label or label group ID"), never its name. Read each id from the listing Phase 2 saved in the answers directory (`PREFLIGHT_ANSWERS`): `jq -r --arg t shr-<nonce>-a '.labels[] | select(.name == $t) | .id' labels-a.json`, and the same for `-b` from `labels-b.json`. When a listing was never saved, take the id from that label's `save_issue_label` create answer, which Phase 2 recorded. The label retirement is not graded: the second audit reads no label, so it stays outside the evidence.

Then run the § Phase 4 audit fence again with `AUDIT_PASS=2`: the second audit re-reads the nonce items and, on Linear, reads both throwaway projects back with one `mcp__linear__get_project` call each, by the names Phase 2 recorded in the run state (an issue listing never reads a project), and the grader fails the run as `teardown-incomplete` naming any item it still reads as open (Jira) or either project not completed (Linear). Teardown is therefore inside the evidence the release gate re-grades.

## Phase 6 — Extract and grade

The grader turns the ledgered sessions' transcripts, both audits included, into the evidence bundle, grades it and writes the verdict into the bundle directory as `verdict.json`, beside `bundle.json`: the release gate reads the recorded outcome and scenario set from there. The fence records its path in the run state as `VERDICT_FILE`, which Phase 7 reads. The bundle is a projection, not a copy: only the fields the predicates read survive, absolute paths are rewritten relative to the run's roots, and the grader refuses to write a bundle holding an email address, an Atlassian account id, a tracker site host or a home-directory path. It is written to the directory `plugins/dev-process-toolkit/tests/fixtures/shared-tracker-live/<tracker>-<date>-<nonce>/` before any cleanup.

**Run it from a file.** Write the fence to a file and run `bash <file>`; never feed it to `bash`, `sh` or `zsh` through stdin.

```bash
# shared-tracker-smoke: extract and grade
RUN_STATE_NEEDS="TRACKER TOPLEVEL DPT_SMOKE_RUN_ID NONCE ROOT_A ROOT_B DIGEST_AT_START PLUGIN_BELOW_FLOOR RUN_START_MS"
RUN_STATE_NEEDS_LINEAR=""
# run-state preamble: begin — the same lines in every fence that reads the run state
# loader canary: this document's text reaches a session with the invocation's arguments already
# substituted for its positional parameters, so a fence RUN FROM THE LOADED TEXT would refuse with an
# empty message and read the wrong word in every `case`. The left side below is spelled so the loader
# rewrites it and the right side so it cannot, which is why the two agree only off disk. The right
# side spells its dollar as an octal escape, which also keeps the line free of the two characters a
# string replacement would read as "everything after the match".
LOADER_CANARY='$1'
LOADER_EXPECT="$(printf '\044')1"
[ "${LOADER_CANARY}" = "${LOADER_EXPECT}" ] || { printf '/shared-tracker-smoke: %s\nRemedy: %s\nContext: skill=shared-tracker-smoke, phase=fence, check=loader-substituted, tracker=<tracker>\n' "this fence was copied from the loaded skill text, where the loader had already substituted its positional parameters; nothing was run and nothing was written." "take the fence from the document on disk instead: extract it from .claude/skills/shared-tracker-smoke/SKILL.md into a file (§ Running a fence) and run that file." >&2; exit 1; }
RUN_ENV="/tmp/dpt-shared-<tracker>-run.env"
run_state_refuse() {
  printf '/shared-tracker-smoke: %s\nRemedy: %s\nContext: skill=shared-tracker-smoke, phase=run-state, check=run-state-missing, tracker=<tracker>\n' "$1" "restore the line by hand from its source (Phase 0's plan /tmp/dpt-shared-<tracker>-plan.env, the pre-flight env /tmp/dpt-shared-<tracker>-preflight.env, or the values Phase 2 recorded) and run this fence again; never re-run Phase 0.5 mid-run, which mints a new nonce and wipes this run's scratch. This fence started nothing and wrote nothing. If the run state cannot be restored and /tmp/dpt-shared-<tracker>-teardown-owed exists, run § Phase 5 — Teardown now, then start a new run from Phase 0." >&2
  exit 1
}
{ [ -f "${RUN_ENV}" ] && [ -r "${RUN_ENV}" ]; } || run_state_refuse "the run state ${RUN_ENV} is missing or unreadable."
. "${RUN_ENV}"
case "${TRACKER:-}:<tracker>" in
  jira:jira | linear:linear) ;;
  *) run_state_refuse "the run state ${RUN_ENV} records TRACKER=${TRACKER:-unset}; it must be exactly jira or linear, and the tracker this fence was written for." ;;
esac
[ "${TRACKER}" != linear ] || RUN_STATE_NEEDS="${RUN_STATE_NEEDS} ${RUN_STATE_NEEDS_LINEAR}"
for RUN_STATE_VAR in ${RUN_STATE_NEEDS}; do
  [ -n "${!RUN_STATE_VAR:-}" ] || run_state_refuse "the run state ${RUN_ENV} records no ${RUN_STATE_VAR}, which this fence needs (${RUN_STATE_NEEDS})."
done
# run-state preamble: end
# SHARED, PRE and LINEAR_TEAM come from the run state bootstrap wrote, never retyped: a retyped value can
# silently differ from the spaces the run actually used. An empty one refuses rather than degrading.
if [ -z "${SHARED:-}" ]; then
  printf '/shared-tracker-smoke: %s\nRemedy: %s\nContext: skill=shared-tracker-smoke, phase=extract, check=shared-unset, tracker=%s\n' "the run state records no SHARED; nothing was extracted." "restore SHARED in /tmp/dpt-shared-${TRACKER}-run.env from bootstrap, then run Phase 6 again." "${TRACKER}" >&2
  exit 1
fi
if [ "${TRACKER}" = linear ] && [ -z "${PRE:-}" ]; then
  printf '/shared-tracker-smoke: %s\nRemedy: %s\nContext: skill=shared-tracker-smoke, phase=extract, check=pre-unset, tracker=%s\n' "the run state records no PRE on a Linear run, whose pre-repoint project always exists; nothing was extracted." "restore PRE in /tmp/dpt-shared-${TRACKER}-run.env from bootstrap, then run Phase 6 again." "${TRACKER}" >&2
  exit 1
fi
if [ "${TRACKER}" = linear ] && [ -z "${LINEAR_TEAM:-}" ]; then
  printf '/shared-tracker-smoke: %s\nRemedy: %s\nContext: skill=shared-tracker-smoke, phase=extract, check=linear-team-unset, tracker=%s\n' "the run state records no LINEAR_TEAM on a Linear run; nothing was extracted." "restore LINEAR_TEAM in /tmp/dpt-shared-${TRACKER}-run.env from bootstrap, then run Phase 6 again." "${TRACKER}" >&2
  exit 1
fi
BUNDLE_NAME="${TRACKER}-$(date -u +%Y-%m-%d)-${NONCE}"
BUNDLE_DIR="${TOPLEVEL}/plugins/dev-process-toolkit/tests/fixtures/shared-tracker-live/${BUNDLE_NAME}/"
bun "${TOPLEVEL}/plugins/dev-process-toolkit/adapters/_shared/src/shared_tracker_live_grader.ts" extract \
  --project-root "${TOPLEVEL}" --run "${DPT_SMOKE_RUN_ID}" --leg "shared-${TRACKER}" --tracker "${TRACKER}" \
  --nonce "${NONCE}" --root-a "${ROOT_A}" --root-b "${ROOT_B}" --config-dir "${CLAUDE_CONFIG_DIR:-${HOME}/.claude-st}" \
  --digest-at-start "${DIGEST_AT_START}" --out "${BUNDLE_DIR}" \
  --container "${SHARED}" ${PRE:+--repoint-from "${PRE}"} ${LINEAR_TEAM:+--linear-team "${LINEAR_TEAM}"} \
  --below-floor "${PLUGIN_BELOW_FLOOR}" --tracked-list "/tmp/dpt-shared-${TRACKER}-tracked-files.txt" \
  --started-at-ms "${RUN_START_MS}"
bun "${TOPLEVEL}/plugins/dev-process-toolkit/adapters/_shared/src/shared_tracker_live_grader.ts" grade \
  --bundle "${BUNDLE_DIR}" --verdict "${BUNDLE_DIR}verdict.json"
echo "VERDICT_FILE=${BUNDLE_DIR}verdict.json" >> /tmp/dpt-shared-<tracker>-run.env
echo "verdict: $(bun "${TOPLEVEL}/plugins/dev-process-toolkit/adapters/_shared/src/smoke_verdict.ts" outcome --artifact "${BUNDLE_DIR}verdict.json")"
```

The verdict is `pass` only when every applicable scenario passes; `not-observed` counts as a failure. The artifact lists each offline-only id as `offline-only` and, on a Jira run without `--jira-repoint-from`, S8 as `skipped` with reason `repoint-space-not-given`.

## Phase 7 — Session cleanup

The STE-593 delete mode, on `pass` only, after extraction, handed exactly the run ledger's session ids for leg `shared-<tracker>`. The cleanup module's window inference is never used here: it cannot see these sessions.

**Run it from a file.** Write the fence to a file and run `bash <file>`; never feed it to `bash`, `sh` or `zsh` through stdin.

```bash
# shared-tracker-smoke: session cleanup — pass only, after extraction
RUN_STATE_NEEDS="TRACKER TOPLEVEL DPT_SMOKE_RUN_ID VERDICT_FILE"
RUN_STATE_NEEDS_LINEAR=""
# run-state preamble: begin — the same lines in every fence that reads the run state
# loader canary: this document's text reaches a session with the invocation's arguments already
# substituted for its positional parameters, so a fence RUN FROM THE LOADED TEXT would refuse with an
# empty message and read the wrong word in every `case`. The left side below is spelled so the loader
# rewrites it and the right side so it cannot, which is why the two agree only off disk. The right
# side spells its dollar as an octal escape, which also keeps the line free of the two characters a
# string replacement would read as "everything after the match".
LOADER_CANARY='$1'
LOADER_EXPECT="$(printf '\044')1"
[ "${LOADER_CANARY}" = "${LOADER_EXPECT}" ] || { printf '/shared-tracker-smoke: %s\nRemedy: %s\nContext: skill=shared-tracker-smoke, phase=fence, check=loader-substituted, tracker=<tracker>\n' "this fence was copied from the loaded skill text, where the loader had already substituted its positional parameters; nothing was run and nothing was written." "take the fence from the document on disk instead: extract it from .claude/skills/shared-tracker-smoke/SKILL.md into a file (§ Running a fence) and run that file." >&2; exit 1; }
RUN_ENV="/tmp/dpt-shared-<tracker>-run.env"
run_state_refuse() {
  printf '/shared-tracker-smoke: %s\nRemedy: %s\nContext: skill=shared-tracker-smoke, phase=run-state, check=run-state-missing, tracker=<tracker>\n' "$1" "restore the line by hand from its source (Phase 0's plan /tmp/dpt-shared-<tracker>-plan.env, the pre-flight env /tmp/dpt-shared-<tracker>-preflight.env, or the values Phase 2 recorded) and run this fence again; never re-run Phase 0.5 mid-run, which mints a new nonce and wipes this run's scratch. This fence started nothing and wrote nothing. If the run state cannot be restored and /tmp/dpt-shared-<tracker>-teardown-owed exists, run § Phase 5 — Teardown now, then start a new run from Phase 0." >&2
  exit 1
}
{ [ -f "${RUN_ENV}" ] && [ -r "${RUN_ENV}" ]; } || run_state_refuse "the run state ${RUN_ENV} is missing or unreadable."
. "${RUN_ENV}"
case "${TRACKER:-}:<tracker>" in
  jira:jira | linear:linear) ;;
  *) run_state_refuse "the run state ${RUN_ENV} records TRACKER=${TRACKER:-unset}; it must be exactly jira or linear, and the tracker this fence was written for." ;;
esac
[ "${TRACKER}" != linear ] || RUN_STATE_NEEDS="${RUN_STATE_NEEDS} ${RUN_STATE_NEEDS_LINEAR}"
for RUN_STATE_VAR in ${RUN_STATE_NEEDS}; do
  [ -n "${!RUN_STATE_VAR:-}" ] || run_state_refuse "the run state ${RUN_ENV} records no ${RUN_STATE_VAR}, which this fence needs (${RUN_STATE_NEEDS})."
done
# run-state preamble: end
SIDS=$(bun "${TOPLEVEL}/plugins/dev-process-toolkit/adapters/_shared/src/smoke_run_ledger.ts" sessions --project-root "${TOPLEVEL}" --run "${DPT_SMOKE_RUN_ID}" --leg "shared-${TRACKER}")
set --
for SID in ${SIDS}; do
  set -- "$@" --session "${SID}"
done
OUTCOME=$(bun "${TOPLEVEL}/plugins/dev-process-toolkit/adapters/_shared/src/smoke_verdict.ts" outcome --artifact "${VERDICT_FILE}")
if [ "${OUTCOME}" = "pass" ]; then
  bun "${TOPLEVEL}/plugins/dev-process-toolkit/adapters/_shared/src/smoke_session_cleanup.ts" --config-dir "${CLAUDE_CONFIG_DIR:-${HOME}/.claude-st}" --project-root "${TOPLEVEL}" "$@" --delete
else
  echo "kept: outcome=${OUTCOME}; nothing deleted. Manual cleanup once the evidence is read:"
  echo "  bun plugins/dev-process-toolkit/adapters/_shared/src/smoke_session_cleanup.ts --config-dir <config dir> --project-root ${TOPLEVEL} $* --delete"
fi
```

## Phase 8 — Closing accounting

Print, in this order:

1. **Verdict** — the outcome, and per scenario its outcome with the record references it was decided on. On a Jira run without `--jira-repoint-from`, the line `S8 skipped: repoint-space-not-given`.
2. **Children** — sessions ledgered against `SPAWN_CEILING` and `EXPECTED_CHILDREN`. Any session whose transcript's cwd is one of the run's throwaway roots but which the ledger lacks is listed as `unledgered-session` and fails the run; it is never silently kept or deleted.
3. **Tracker writes** — every item the run created, by key. On Linear, the budget declared and spent, and every issue created, for archiving by hand, and the two tag labels Phase 5 retired.
4. **Teardown** — what Phase 5 closed, and anything the second audit still read as open.
5. **Run artifacts** — the evidence bundle directory `plugins/dev-process-toolkit/tests/fixtures/shared-tracker-live/<tracker>-<date>-<nonce>/`, the verdict artifact, and the step logs under `/tmp/dpt-shared-<tracker>-*`. The `bundle-hash=` line Phase 6's grade printed is the hash the plan's Live proof row records; it is taken after the verdict is written into the bundle directory, so it covers the recorded verdict.
6. **Session cleanup** — on `pass`, the deleted sessions. On `fail` or `abort` nothing was deleted; print the manual command, `bun plugins/dev-process-toolkit/adapters/_shared/src/smoke_session_cleanup.ts --config-dir <config dir> --project-root <toolkit root> --session <sid>… --delete`, with every ledgered id for leg `shared-<tracker>` written out.
