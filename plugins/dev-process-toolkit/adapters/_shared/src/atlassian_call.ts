// atlassian_call.ts — STE-865: the ONE translator of an Atlassian write call,
// direct or (STE-866) wrapped in a generic execute tool. The v2 tools name some
// inputs differently; the tracker-write hook (pre-tracker-write-gate.ts) and
// the live grader (shared_tracker_live_grader.ts) read every call through it, so their rules keep the v1 vocabulary
// (`addCommentToJiraIssue`, `issueTypeName`, `transition`, `fields`).
//
// Pure: the input is never mutated. A key that cannot be placed is KEPT in the
// canonical input and listed in `unplaced`, so each allowlist still refuses it.
// This module imports nothing, so the hook stays import-light.

type Input = Record<string, unknown>;

export interface CanonicalAtlassianCall {
  /** The bare v1 tool name. */
  tool: string;
  input: Input;
  /** Translatable keys left as they were: their value or a second spelling makes the call ambiguous. */
  unplaced: string[];
  /** Keys beside `name` and `inputs` that the execute tools' schema does not have; absent when there are none. */
  wrapperKeys?: string[];
}

const has = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
const isBlock = (v: unknown): v is Input => v !== null && typeof v === "object" && !Array.isArray(v);
const isName = (v: unknown): v is string => typeof v === "string" && v !== "";

/** `transitionId` / `transitionName` → `transition: {id}` / `{name}`, when it is the only designator. */
function canonicalTransition(input: Input): Omit<CanonicalAtlassianCall, "tool"> {
  const { transitionId, transitionName, ...rest } = input;
  const v2 = ["transitionId", "transitionName"].filter((k) => has(input, k));
  if (v2.length === 0) return { input, unplaced: [] };
  if (v2.length === 1 && !has(input, "transition")) {
    if (isName(transitionId)) return { input: { ...rest, transition: { id: transitionId } }, unplaced: [] };
    if (isName(transitionName)) return { input: { ...rest, transition: { name: transitionName } }, unplaced: [] };
  }
  return { input, unplaced: v2 };
}

/** `project` / `issuetype` inside `additional_fields`, and `labels` / `parent` given there and at the top level with different values. */
function createConflicts(input: Input): string[] {
  const extra = input.additional_fields;
  if (!isBlock(extra)) return [];
  const nested = ["project", "issuetype"].filter((k) => has(extra, k));
  const keyOf = (v: unknown): unknown => (isBlock(v) && typeof v.key === "string" ? v.key : v);
  const twice = ["labels", "parent"].filter((k) => has(extra, k) && has(input, k) && JSON.stringify(keyOf(extra[k])) !== JSON.stringify(keyOf(input[k])));
  return [...nested, ...twice].map((k) => `additional_fields.${k}`);
}

/** A create in the v1 vocabulary, its project key trimmed, with the fields it names twice listed as unplaced. */
function canonicalCreate(input: Input): Omit<CanonicalAtlassianCall, "tool"> {
  const { projectKey } = input;
  const trimmed = typeof projectKey === "string" && projectKey !== projectKey.trim() ? { ...input, projectKey: projectKey.trim() } : input;
  const { input: typed, unplaced } = canonicalType(trimmed);
  return { input: typed, unplaced: [...unplaced, ...createConflicts(input)] };
}

/** `issueType` → `issueTypeName`, unless the call also names a different type. */
function canonicalType(input: Input): Omit<CanonicalAtlassianCall, "tool"> {
  if (!has(input, "issueType")) return { input, unplaced: [] };
  const { issueType, ...rest } = input;
  if (!isName(issueType)) return { input, unplaced: ["issueType"] };
  if (!has(input, "issueTypeName")) return { input: { ...rest, issueTypeName: issueType }, unplaced: [] };
  const v1 = input.issueTypeName;
  const agrees = typeof v1 === "string" && v1.trim().toLowerCase() === issueType.trim().toLowerCase();
  return agrees ? { input: rest, unplaced: [] } : { input, unplaced: ["issueType"] };
}

/** An edit's `additional_fields` join `fields`, unless a field is named in both blocks. */
function canonicalEdit(input: Input): Omit<CanonicalAtlassianCall, "tool"> {
  if (!has(input, "additional_fields")) return { input, unplaced: [] };
  const { additional_fields: extra, ...rest } = input;
  const fields = has(input, "fields") ? input.fields : {};
  if (!isBlock(extra) || !isBlock(fields) || Object.keys(extra).some((k) => has(fields, k))) {
    return { input, unplaced: ["additional_fields"] };
  }
  return { input: { ...rest, fields: { ...fields, ...extra } }, unplaced: [] };
}

/** A Jira `/browse/<KEY>` URL. Twins: `BROWSE_URL` in pre-tracker-write-gate.ts and shared_tracker_live_grader.ts, which read a link's sides. */
const BROWSE_URL = /^https?:\/\/[^/?#\s]+\/browse\/([A-Za-z][A-Za-z0-9]*-\d+)\/?(?:[?#]\S*)?$/;

/** `linkType` → `type`, unless the call carries both; the two sides and the comment keep their names. */
function canonicalLink(input: Input): Omit<CanonicalAtlassianCall, "tool"> {
  if (!has(input, "linkType")) return { input, unplaced: [] };
  if (has(input, "type")) return { input, unplaced: ["linkType"] };
  const { linkType, ...rest } = input;
  return { input: { ...rest, type: linkType }, unplaced: [] };
}

/** A ticket key anywhere in the rest of a URL. */
const ANY_KEY = /[A-Za-z][A-Za-z0-9]*-\d+/;

/**
 * An `issueIdOrKey` that is a browse URL becomes its key; any other value stays
 * as it is. So does a URL with userinfo, or whose query or fragment names a key too:
 * which of the two the server would write is unmeasured.
 */
function canonicalSubject(input: Input): Input {
  const { issueIdOrKey } = input;
  const url = typeof issueIdOrKey === "string" ? issueIdOrKey.trim() : "";
  const key = BROWSE_URL.exec(url)?.[1];
  if (key !== undefined) {
    const path = `/browse/${key}`;
    const at = url.indexOf(path);
    const authority = url.slice(0, at);
    if (authority.includes("@") || ANY_KEY.test(url.slice(at + path.length))) return input;
  }
  return key === undefined ? input : { ...input, issueIdOrKey: key.toUpperCase() };
}

/** STE-866 — the generic v2 tools, which run the operation `name` on `inputs`. */
export const ATLASSIAN_EXECUTE_TOOLS: readonly string[] = ["executeRead", "executeWrite", "executeDestructive"];

/** The execute tools' own input keys. */
const WRAPPER_KEYS: readonly string[] = ["name", "inputs", "cloudId", "responseFields", "view"];

/** The v1 graph keys and the relationship types whose both sides are Jira items. */
const GRAPH_KEYS: readonly string[] = ["cloudId", "actionSource", "objectIdentifier", "targetObjectIdentifier", "relationshipType"];
const GRAPH_ITEM_TYPES: readonly unknown[] = ["jira-work-item-links-jira-work-item", "jira-work-item-blocks-jira-work-item"];

/** The v2 `addGraphContext` schema is unrecorded: every key the v1 rules cannot read, and a relationship type they do not know. */
function unreadGraphKeys(input: Input): string[] {
  const unread = Object.keys(input).filter((k) => !GRAPH_KEYS.includes(k));
  return GRAPH_ITEM_TYPES.includes(input.relationshipType) ? unread : [...unread, "relationshipType"];
}

/** One direct Atlassian write call, v1 or v2, in the v1 vocabulary. */
function canonicalDirect(tool: string, input: Input): CanonicalAtlassianCall {
  switch (tool) {
    case "transitionJiraIssue":
      return { tool, ...canonicalTransition(canonicalSubject(input)) };
    case "createJiraIssue":
      return { tool, ...canonicalCreate(input) };
    case "editJiraIssue":
      return { tool, ...canonicalEdit(canonicalSubject(input)) };
    case "addCommentToJiraIssue":
    case "addOrEditJiraIssueComment":
      return { tool: "addCommentToJiraIssue", input: canonicalSubject(input), unplaced: [] };
    case "addWorklogToJiraIssue":
    case "addOrEditJiraIssueWorklog":
      return { tool: "addWorklogToJiraIssue", input: canonicalSubject(input), unplaced: [] };
    case "createJiraIssueLink":
      return { tool: "createIssueLink", ...canonicalLink(input) };
    case "getJiraIssue":
      return { tool, input: canonicalSubject(input), unplaced: [] };
    case "addGraphContext":
      return { tool: "addTeamworkGraphContext", input, unplaced: unreadGraphKeys(input) };
    default:
      return { tool, input, unplaced: [] };
  }
}

/**
 * One Atlassian call in the v1 vocabulary. `tool` is the bare name; any other
 * call comes back as it is. An execute call `{name, inputs, cloudId}` is
 * unwrapped once to the call it names; `cloudId` may sit beside `inputs` or
 * inside it, and two different values leave it unplaced. Any other key beside
 * `inputs` is never read as an input: it comes back in `wrapperKeys`.
 */
export function canonicalAtlassianCall(tool: string, input: Input): CanonicalAtlassianCall {
  if (!ATLASSIAN_EXECUTE_TOOLS.includes(tool)) return canonicalDirect(tool, input);
  const { name, inputs } = input;
  if (!isName(name) || !isBlock(inputs)) return { tool, input, unplaced: [] };
  const beside = has(input, "cloudId");
  const call = canonicalDirect(name, beside && !has(inputs, "cloudId") ? { ...inputs, cloudId: input.cloudId } : inputs);
  const twoSites = beside && has(inputs, "cloudId") && input.cloudId !== inputs.cloudId;
  const extra = Object.keys(input).filter((k) => !WRAPPER_KEYS.includes(k));
  return {
    ...call,
    ...(twoSites ? { unplaced: [...call.unplaced, "cloudId"] } : {}),
    ...(extra.length > 0 ? { wrapperKeys: extra } : {}),
  };
}
