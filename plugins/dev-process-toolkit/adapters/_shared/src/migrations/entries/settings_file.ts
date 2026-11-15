// M_94e6f7 STE-711 — the `settings-file` migration moves every setting out of
// CLAUDE.md, `specs/tracker-config.yaml` and `.dpt/video/{config,style}.yaml`
// into `specs/settings.yaml`, then removes each old copy.
//
// Registered after every entry that edits CLAUDE.md: those older entries run
// first, so a 2.x tree is brought current on its legacy home before the move.
// The entries after it (capture-registration, retro-priority-default) work on
// the moved tree. The move seeds the default retro order itself (STE-775), so
// the file it creates is already current.
// `requires_explicit_approval` keeps it out of auto-approve runs, because it
// rewrites a file a person edits.

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  DEFAULT_RETRO_PRIORITY,
  detectSettingsSource,
  isForeignSettingsFile,
  loadFromSettingsFile,
  loadProjectSettings,
  PROJECT_SETTINGS_HEADING,
  recognisedHeadingKeys,
  renderSettingsPointer,
  renderTrackingStub,
  SETTINGS_FILE,
  SettingsShapeError,
  settingsKeyOrder,
  validateSettingsShape,
  writeProjectSettings,
} from "../../project_settings";
import {
  MOVED_HEADINGS,
  parseMilestoneScanFetch,
  parseTaskTrackingSection,
  parseTrackerConfigFile,
  parseWorkspaceBinding,
  readLegacyDocs,
  readLegacyOrchestration,
  readLegacyRelease,
  readLegacyTracking,
  readLegacyVerification,
  locateSubsection,
  readLegacyVideo,
  RELEASE_FILES_HEADING,
  sectionEnd,
  trackingStubSlots,
  TASK_TRACKING_HEADING,
  TRACKER_CONFIG,
  TRACKER_SUBSECTION_HEADINGS,
  VIDEO_CONFIG,
  VIDEO_STYLE,
} from "../../project_settings_legacy";
import { syncTrackingStub } from "../../project_settings_writer";
import type * as BindingWrite from "../../setup/tracker_binding_write";
import { compareSemver } from "../coverage";
import type { ApplyResult, DetectResult, MigrationEntry } from "../index";
import { LEGACY_TEMPLATE_COMMENT_BLOCKS, SETTINGS_COMMENT_POINTER } from "../legacy_paths";

const CLAUDE_MD = "CLAUDE.md";
// Read at call time: project_settings_legacy sits in an import cycle with the
// registry, so its constants are not initialised when this module loads.
const legacyFiles = (): readonly string[] => [TRACKER_CONFIG, VIDEO_CONFIG, VIDEO_STYLE];
const MSF_PREFIX = "milestone_scan_fetch:";
// The binding writer imports `migrations/coverage`, which imports this
// registry: loading it at module load closes an import cycle. Loaded when used.
const bindingWrite = (): typeof BindingWrite => require("../../setup/tracker_binding_write") as typeof BindingWrite;
const KEY_LINE_RE = /^([a-z][a-z0-9_]*)\s*:/;

interface ClaudeMd {
  mdPath: string;
  /** The file's text, or null when absent. */
  original: string | null;
  /** Raw lines (CR kept): what the rewrite emits. */
  lines: string[];
  /** Lines with CR stripped: what the classification reads. */
  norm: string[];
}

function readClaudeMd(projectRoot: string): ClaudeMd {
  const mdPath = join(projectRoot, CLAUDE_MD);
  const original = existsSync(mdPath) ? readFileSync(mdPath, "utf8") : null;
  const lines = original === null ? [] : original.split("\n");
  return { mdPath, original, lines, norm: lines.map((l) => l.replace(/\r$/, "")) };
}

/** CLAUDE.md as raw lines (CR stripped), or null when absent. */
function claudeMdLines(projectRoot: string): string[] | null {
  const md = readClaudeMd(projectRoot);
  return md.original === null ? null : md.norm;
}

/** Does a line open or close an HTML comment? Such a line cannot be removed without breaking its comment. */
function hasCommentMarker(line: string): boolean {
  return line.includes("<!--") || line.includes("-->");
}

/** Each standalone `milestone_scan_fetch:` line goes, with one blank line beside it. */
function removeMsfLines(norm: readonly string[], msfLines: readonly number[], remove: Set<number>): void {
  for (const i of msfLines) {
    remove.add(i);
    if (i > 0 && norm[i - 1]!.trim() === "" && norm[i + 1]?.trim() === "") remove.add(i + 1);
  }
}

/**
 * The key-line grammar of a non-stub moved section (`start` is its heading):
 * fenced lines are skipped, except under `## Release Files`; a key line whose
 * key is in `keys` is removed — under `## Release Files`, the whole fence when
 * `files:` sits in one, else the key and its indented items. Returns the keys
 * found; `onUnrecognised` sees each unfenced key line whose key is not in `keys`.
 */
function scanSectionKeys(
  norm: readonly string[],
  heading: string,
  start: number,
  end: number,
  keys: readonly string[] | undefined,
  remove: Set<number>,
  opts: {
    skip?: (i: number) => boolean;
    onUnrecognised?: (i: number) => void;
    /** True for a line inside a custom comment block: only a recognised key line there is read. */
    inComment?: (i: number) => boolean;
    /** A recognised commented key line that cannot leave its comment alone (it carries a marker, or sits in a Release Files block). */
    onUnmovable?: (i: number) => void;
  } = {},
): string[] {
  const release = heading === RELEASE_FILES_HEADING;
  const found: string[] = [];
  let fence: number | null = null;
  for (let i = start + 1; i < end; i++) {
    if (opts.skip?.(i)) continue;
    const l = norm[i]!;
    if (opts.inComment?.(i)) {
      // The v2.101.5 readers match raw lines, so a column-0 key line inside a
      // comment is a setting: its value moves and only that line leaves the
      // comment (review B2). Anything else in the comment stays.
      const m = KEY_LINE_RE.exec(l);
      if (!m || !keys?.includes(m[1]!)) continue;
      if (release || hasCommentMarker(l)) {
        opts.onUnmovable?.(i);
        continue;
      }
      found.push(m[1]!);
      remove.add(i);
      continue;
    }
    if (l.startsWith("```")) {
      fence = fence === null ? i : null;
      continue;
    }
    if (fence !== null && !release) continue;
    const m = KEY_LINE_RE.exec(l);
    if (!m) continue;
    if (!keys?.includes(m[1]!)) {
      if (fence === null) opts.onUnrecognised?.(i);
      continue;
    }
    found.push(m[1]!);
    if (!release) {
      remove.add(i);
    } else if (fence !== null) {
      let close = i + 1;
      while (close < end && !norm[close]!.startsWith("```")) close++;
      for (let k = fence; k <= Math.min(close, end - 1); k++) remove.add(k);
      i = close;
      fence = null;
    } else {
      remove.add(i);
      for (let k = i + 1; k < end && /^\s+\S/.test(norm[k]!); k++) remove.add(k);
    }
  }
  return found;
}

function legacyFileEvidence(projectRoot: string, verb: string): string[] {
  return legacyFiles().filter((rel) => existsSync(join(projectRoot, rel))).map((rel) => `${rel}:1 — ${verb}`);
}

/** Move: every legacy home in a tree with no settings file. */
function moveEvidence(projectRoot: string): string[] {
  const evidence: string[] = [];
  const lines = claudeMdLines(projectRoot) ?? [];
  const cls = classifyMove(lines, commentBlocks(lines));
  evidence.push(...cls.offending, ...cls.floorless);
  lines.forEach((l, i) => {
    if ((MOVED_HEADINGS as readonly string[]).includes(l)) {
      evidence.push(`${CLAUDE_MD}:${i + 1} — \`${l}\` moves to specs/settings.yaml`);
    } else if (l.startsWith(MSF_PREFIX)) {
      evidence.push(`${CLAUDE_MD}:${i + 1} — \`${MSF_PREFIX}\` moves to specs/settings.yaml`);
    }
  });
  evidence.push(...legacyFileEvidence(projectRoot, "moves to specs/settings.yaml, then is deleted"));
  // Informational only: a kept block never by itself makes detect apply.
  if (evidence.length > 0) evidence.push(...keptBlockEvidence(lines, cls.remove));
  return evidence;
}

/** Cleanup: each leftover legacy home beside the settings file (the stub slot never counts). */
function cleanupEvidence(projectRoot: string): string[] {
  const evidence: string[] = [];
  const keysByHeading = recognisedHeadingKeys();
  const lines = claudeMdLines(projectRoot) ?? [];
  lines.forEach((l, i) => {
    if (l.startsWith(MSF_PREFIX)) {
      evidence.push(`${CLAUDE_MD}:${i + 1} — leftover \`${MSF_PREFIX}\` beside specs/settings.yaml`);
      return;
    }
    const keys = keysByHeading[l];
    if (!keys) return;
    for (let j = i + 1; j < lines.length && !/^#{1,2} /.test(lines[j]!); j++) {
      const m = KEY_LINE_RE.exec(lines[j]!);
      if (m && keys.includes(m[1]!)) {
        evidence.push(`${CLAUDE_MD}:${j + 1} — leftover \`${l}\` key \`${m[1]}\` beside specs/settings.yaml`);
      }
    }
  });
  evidence.push(...legacyFileEvidence(projectRoot, "leftover beside specs/settings.yaml"));
  return evidence;
}

/** Stub repair: the `## Task Tracking` stub slot missing, duplicated, drifted, or left under `mode: none`. */
function stubEvidence(projectRoot: string): string[] {
  const lines = claudeMdLines(projectRoot);
  if (lines === null) return [];
  const render = renderTrackingStub(loadProjectSettings(projectRoot).settings);
  const slots = trackingStubSlots(lines.join("\n"));
  if (render === "") {
    return slots.map((s) => `${CLAUDE_MD}:${s.line} — tracking stub left under \`mode: none\``);
  }
  if (slots.length === 0) {
    const anchor = lines.findIndex((l) => l === "## Project Settings");
    return [`${CLAUDE_MD}:${anchor >= 0 ? anchor + 1 : 1} — tracking stub missing`];
  }
  if (slots.length > 1) return slots.map((s) => `${CLAUDE_MD}:${s.line} — tracking stub duplicated`);
  const only = slots[0]!;
  return `${only.text}\n` === render ? [] : [`${CLAUDE_MD}:${only.line} — tracking stub differs from its render`];
}

function detectSettingsFile(projectRoot: string): DetectResult {
  try {
    const source = detectSettingsSource(projectRoot);
    let evidence: string[] = [];
    if (source === "legacy") {
      evidence = moveEvidence(projectRoot);
      // The move's step 0 refuses beside a project's own settings file (review R2-B3); say so up front.
      if (evidence.length > 0 && isForeignSettingsFile(projectRoot)) {
        evidence.unshift(
          `${SETTINGS_FILE} — exists and is not a toolkit settings file (on a tree that has not been migrated only a file with a column-0 \`min_dpt_version:\` line is the toolkit's); the move refuses until it is renamed`,
        );
      }
    }
    else if (source === "both") evidence = cleanupEvidence(projectRoot);
    else if (source === "settings") evidence = stubEvidence(projectRoot);
    return evidence.length > 0 ? { applies: true, evidence } : { applies: false, evidence: [] };
  } catch {
    // detect never throws: an unreadable or malformed home is the loader's to refuse.
    return { applies: false, evidence: [] };
  }
}

// ---------------------------------------------------------------------------
// Apply (move)
// ---------------------------------------------------------------------------

const MOVE_FLOOR = "3.0.0";

type Obj = Record<string, unknown>;

/** A JSON-clean copy: undefined and null values dropped (the settings file holds neither). */
function clean(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(clean);
  if (v !== null && typeof v === "object") {
    const out: Obj = {};
    for (const [k, x] of Object.entries(v as Obj)) if (x !== null && x !== undefined) out[k] = clean(x);
    return out;
  }
  return v;
}

function refusal(reason: string, remedy: string, context: string): ApplyResult {
  return { changed: [], summary: new SettingsShapeError(reason, remedy, context).message };
}

interface CommentBlock {
  start: number;
  end: number;
  text: string;
  matched: boolean;
}

function blockAt(blocks: readonly CommentBlock[], i: number): CommentBlock | undefined {
  return blocks.find((b) => i >= b.start && i <= b.end);
}

function commentBlocks(lines: readonly string[]): CommentBlock[] {
  const known = new Set(LEGACY_TEMPLATE_COMMENT_BLOCKS.map((b) => b.text.replace(/\n$/, "")));
  const out: CommentBlock[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i]!.startsWith("<!--")) continue;
    let j = i;
    while (j < lines.length && !lines[j]!.includes("-->")) j++;
    if (j >= lines.length) break;
    const text = lines.slice(i, j + 1).join("\n");
    out.push({ start: i, end: j, text, matched: known.has(text) });
    i = j;
  }
  return out;
}

/** Every key the move takes out of CLAUDE.md. */
function movedKeys(): string[] {
  const keys = new Set<string>([...settingsKeyOrder("task_tracking"), ...settingsKeyOrder("task_tracking.linear")]);
  for (const ks of Object.values(recognisedHeadingKeys())) for (const k of ks) keys.add(k);
  return [...keys];
}

/**
 * Does a kept comment block name a moved heading (`## Docs`, `### Linear`) or a
 * moved key in its `key:` form — a key line, at the start of a block line? A
 * mid-sentence `mode: none` is prose, not a key.
 */
function namesMoved(text: string): boolean {
  const headings = [...MOVED_HEADINGS, ...Object.values(TRACKER_SUBSECTION_HEADINGS)];
  if (headings.some((h) => text.includes(h))) return true;
  return movedKeys().some((k) => new RegExp(`^\\s*(<!--\\s*)?([-*]\\s+)?${k}\\s*:`, "m").test(text));
}

/** Preview rows for the comment blocks the move keeps that name a moved heading or key (informational). */
function keptBlockEvidence(lines: readonly string[], remove: ReadonlySet<number>): string[] {
  return commentBlocks(lines)
    .filter((b) => !b.matched && b.text !== SETTINGS_COMMENT_POINTER && namesMoved(b.text))
    .map((b) => {
      let hosts = false;
      for (let k = b.start; k <= b.end; k++) if (remove.has(k) || lines[k]!.startsWith(MSF_PREFIX)) hosts = true;
      return `${CLAUDE_MD}:${b.start + 1} — comment block kept${hosts ? ", its moved key lines removed" : " byte-identical"} (it matches no template block); a pointer follows it`;
    });
}

interface MovedSpan {
  heading: string;
  start: number;
  end: number;
  /** The comment block the heading sits in: the v2.101.4 readers match raw lines, so it is still a home. */
  block?: CommentBlock;
}

interface MoveClassification {
  spans: MovedSpan[];
  /** Line indices the move removes (key lines, structural lines). */
  remove: Set<number>;
  /** One `CLAUDE.md:<n> — …` row per line the move does not recognise. */
  offending: string[];
  homes: Set<string>;
  /** The `### Linear` / `### Jira` sub-sections the `## Task Tracking` span holds. */
  subsections: Set<"linear" | "jira">;
  /** One row per binding declaring `repo_tag` with no `min_dpt_version` (the move invents no floor). */
  floorless: string[];
}

/**
 * Step 0's line grammar over every moved span. In `## Task Tracking`: blank
 * lines, the `### Linear` / `### Jira` headings and the shared stop paragraph
 * are structural; a key line is recognised when its key belongs to the scope it
 * sits in (the section's keys above the first sub-heading, the binding keys
 * under `### Linear` / `### Jira`); any other `###` heading and every line under
 * it is unrecognised, as is every other line.
 */
function classifyMove(norm: readonly string[], blocks: readonly CommentBlock[]): MoveClassification {
  const { SHARED_TRACKER_MARKER } = bindingWrite();
  const inBlock = (i: number): CommentBlock | undefined => blockAt(blocks, i);
  const spans: MovedSpan[] = [];
  const offending: string[] = [];
  norm.forEach((l, i) => {
    if (!(MOVED_HEADINGS as readonly string[]).includes(l)) return;
    const block = inBlock(i);
    if (block !== undefined && l === TASK_TRACKING_HEADING) {
      // A commented `## Task Tracking` span: its markers would strand the stub inside a comment.
      for (const k of [block.start, block.end]) {
        offending.push(`${CLAUDE_MD}:${k + 1} — \`${norm[k]}\` comments out ${l}; remove the comment markers around ${l} first`);
      }
      return;
    }
    spans.push({ heading: l, start: i, end: sectionEnd(norm, i), block });
  });
  const keysByHeading = recognisedHeadingKeys();
  const sectionKeys = new Set(settingsKeyOrder("task_tracking"));
  const bindingKeys = new Set(settingsKeyOrder("task_tracking.linear"));
  const adapterOf = new Map(Object.entries(TRACKER_SUBSECTION_HEADINGS).map(([a, h]) => [h, a as "linear" | "jira"]));

  const remove = new Set<number>();
  const homes = new Set<string>();
  const subsections = new Set<"linear" | "jira">();
  let stopParagraph = false;
  const floorless: string[] = [];
  const notKey = (i: number, heading: string): string =>
    `${CLAUDE_MD}:${i + 1} — \`${norm[i]}\` is not a ${heading} key; move it to a prose section outside ${heading} first`;

  for (const span of spans) {
    if (span.heading !== TASK_TRACKING_HEADING) {
      const found = scanSectionKeys(norm, span.heading, span.start, span.end, keysByHeading[span.heading], remove, {
        // A template block is removed whole; the pointer is not a setting.
        skip: (i) => {
          const b = inBlock(i);
          return b !== undefined && b !== span.block && (b.matched || b.text === SETTINGS_COMMENT_POINTER);
        },
        inComment: (i) => {
          const b = inBlock(i);
          return b !== undefined && b !== span.block;
        },
        onUnmovable: (i) =>
          offending.push(
            `${CLAUDE_MD}:${i + 1} — \`${norm[i]}\` is a ${span.heading} key inside a comment that the move cannot take out alone; put it on its own line inside the comment, or out of the comment, first`,
          ),
        onUnrecognised: (i) =>
          offending.push(`${CLAUDE_MD}:${i + 1} — \`${norm[i]}\` is not a recognised ${span.heading} key; move it to a prose section outside ${span.heading} first`),
      });
      if (found.length > 0) homes.add(span.heading);
      continue;
    }
    // `## Task Tracking` scope: "section" above the first sub-heading, an adapter, or "other".
    let scope: "section" | "linear" | "jira" | "other" = "section";
    const bindingLines = new Map<"linear" | "jira", Map<string, number>>();
    for (let i = span.start + 1; i < span.end; i++) {
      const l = norm[i]!;
      const b = inBlock(i);
      if (b !== undefined && b !== span.block) {
        // A comment block no template entry matches is a line the move does not recognise.
        if (!b.matched && b.text !== SETTINGS_COMMENT_POINTER) offending.push(notKey(i, span.heading));
        continue;
      }
      const adapter = adapterOf.get(l);
      if (adapter !== undefined) {
        scope = adapter;
        subsections.add(adapter);
        remove.add(i);
      } else if (/^###\s/.test(l)) {
        scope = "other";
        offending.push(notKey(i, span.heading));
      } else if (l.trim() === "") {
        remove.add(i);
      } else if (scope === "other") {
        offending.push(notKey(i, span.heading));
      } else if (l === SHARED_TRACKER_MARKER || (l.startsWith(">") && remove.has(i - 1) && stopParagraph)) {
        stopParagraph = true;
        remove.add(i);
      } else {
        const m = KEY_LINE_RE.exec(l);
        if (m && (scope === "section" ? sectionKeys : bindingKeys).has(m[1]!)) {
          remove.add(i);
          if (scope !== "section") {
            if (!bindingLines.has(scope)) bindingLines.set(scope, new Map());
            bindingLines.get(scope)!.set(m[1]!, i);
          }
        } else offending.push(notKey(i, span.heading));
      }
    }
    for (const [adapter, keys] of bindingLines) {
      const tag = keys.get("repo_tag");
      if (tag === undefined || keys.has("min_dpt_version")) continue;
      floorless.push(
        `${CLAUDE_MD}:${tag + 1} — \`${norm[tag]}\` under ${TRACKER_SUBSECTION_HEADINGS[adapter]} declares repo_tag with no min_dpt_version`,
      );
    }
    homes.add(span.heading);
  }
  // A commented `milestone_scan_fetch:` line is read by the v2.101.5 reader, so it
  // moves like a live one; one that carries a comment marker cannot leave alone.
  norm.forEach((l, i) => {
    if (l.startsWith(MSF_PREFIX) && inBlock(i) !== undefined && hasCommentMarker(l)) {
      offending.push(
        `${CLAUDE_MD}:${i + 1} — \`${l}\` is a setting inside a comment that the move cannot take out alone; put it on its own line, then re-run`,
      );
    }
  });
  return { spans, remove, offending, homes, subsections, floorless };
}

function applyMove(projectRoot: string): ApplyResult {
  const { renderSharedTrackerSentinel } = bindingWrite();
  // Step 0 — refusals, before any write.
  if (isForeignSettingsFile(projectRoot)) {
    return refusal(
      `${SETTINGS_FILE} exists and is not a toolkit settings file; the move never overwrites it`,
      `rename ${SETTINGS_FILE} (it holds no toolkit marker key), then re-run /dev-process-toolkit:upgrade.`,
      `file=${SETTINGS_FILE}`,
    );
  }
  const { mdPath, original, lines, norm } = readClaudeMd(projectRoot);
  const blocks = commentBlocks(norm);
  const inBlock = (i: number): CommentBlock | undefined => blockAt(blocks, i);

  const { spans, remove, offending, homes, subsections, floorless } = classifyMove(norm, blocks);
  if (offending.length > 0) {
    return refusal(
      `CLAUDE.md holds lines the move does not recognise in a moved section:\n${offending.join("\n")}`,
      "move each named line to a prose section outside the moved headings, then re-run /dev-process-toolkit:upgrade.",
      `file=${CLAUDE_MD}, lines=${offending.length}`,
    );
  }
  if (floorless.length > 0) {
    return refusal(
      `a shared tracker binding declares repo_tag with no min_dpt_version; the move invents no floor:\n${floorless.join("\n")}`,
      `add \`min_dpt_version: ${MOVE_FLOOR}\` (or later) beside each named \`repo_tag\`, or remove \`repo_tag\`, then re-run /dev-process-toolkit:upgrade.`,
      `file=${CLAUDE_MD}, bindings=${floorless.length}`,
    );
  }

  // Step 1 — the settings, from the loader's legacy reading; only the homes that existed.
  // Commented ones included: the v2.101.5 reader reads them (review B2).
  const msfLines = norm.map((l, i) => (l.startsWith(MSF_PREFIX) ? i : -1)).filter((i) => i >= 0);
  // Every legacy read below can refuse (a malformed section, an unreadable tracker config,
  // an inactive adapter's bad declaration); each becomes this entry's refusal, before any write.
  let settings: Obj;
  try {
    const legacy = loadProjectSettings(projectRoot).settings;
    const hasTrackerConfig = existsSync(join(projectRoot, TRACKER_CONFIG));
    const built: Obj = { schema_version: 1, min_dpt_version: MOVE_FLOOR };
    let tt: Obj | null = null;
    if (homes.has(TASK_TRACKING_HEADING) || msfLines.length > 0 || hasTrackerConfig) {
      tt = {};
      if (homes.has(TASK_TRACKING_HEADING)) {
        Object.assign(tt, parseTaskTrackingSection(mdPath));
        tt.mode = legacy.task_tracking.mode;
        const mode = legacy.task_tracking.mode;
        if ((mode === "linear" || mode === "jira") && legacy.task_tracking[mode] !== undefined) {
          const binding = clean(legacy.task_tracking[mode]) as Obj;
          // Step 4 — a shared container's floor rises to at least the move's floor.
          if (typeof binding.repo_tag === "string" && typeof binding.min_dpt_version === "string") {
            const cmp = compareSemver(binding.min_dpt_version, MOVE_FLOOR);
            if (cmp === null || cmp < 0) binding.min_dpt_version = MOVE_FLOOR;
          }
          tt[mode] = inKeyOrder({ ...binding, ...unparsedBindingKeys(norm, mode, binding) }, mode);
        }
        // An inactive adapter's sub-section moves too, into its own mapping.
        for (const adapter of subsections) {
          if (adapter === mode) continue;
          const { shared: _shared, ...b } = parseWorkspaceBinding(mdPath, adapter);
          const snaked: Obj = {};
          for (const [k, v] of Object.entries(b)) snaked[k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)] = v;
          tt[adapter] = clean(inKeyOrder({ ...snaked, ...unparsedBindingKeys(norm, adapter, snaked) }, adapter));
        }
      }
      if (msfLines.length > 0) tt.milestone_scan_fetch = legacy.task_tracking.milestone_scan_fetch;
      if (hasTrackerConfig) tt.status_vocabulary = legacy.task_tracking.status_vocabulary;
      built.task_tracking = clean(tt);
    }
    if (homes.has(MOVED_HEADINGS[1])) built.verification = clean(legacy.verification);
    if (homes.has(MOVED_HEADINGS[2])) built.docs = clean(legacy.docs);
    if (homes.has(MOVED_HEADINGS[3])) built.orchestration = clean(legacy.orchestration);
    if (homes.has(MOVED_HEADINGS[4])) built.tracking = { token_stats: clean(legacy.tracking.token_stats) };
    if (homes.has(MOVED_HEADINGS[5])) built.release = { files: clean(legacy.release.files) };
    const hasVideoConfig = existsSync(join(projectRoot, VIDEO_CONFIG));
    const hasVideoStyle = existsSync(join(projectRoot, VIDEO_STYLE));
    if (hasVideoConfig || hasVideoStyle) {
      const video: Obj = {};
      if (hasVideoConfig) video.config = clean(legacy.video.config);
      if (hasVideoStyle) video.style = clean(legacy.video.style);
      built.video = video;
    }
    // STE-775 AC-.4 — the file this move creates is current: it carries the retro default.
    built.retro = { priority: [...DEFAULT_RETRO_PRIORITY] };
    validateSettingsShape(built);
    settings = built;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (/^Refusing:/m.test(message)) return { changed: [], summary: message };
    return refusal(
      `a moved setting cannot be read, so nothing was moved: ${message}`,
      "fix the named value in CLAUDE.md (or the named file), then re-run /dev-process-toolkit:upgrade.",
      `file=${CLAUDE_MD}`,
    );
  }

  // Step 2 — the standalone `milestone_scan_fetch:` line(s), and one blank line beside each.
  removeMsfLines(norm, msfLines, remove);

  // Step 2 — template comment blocks: the first matched one becomes the pointer, later ones go.
  const replaceAt = new Map<number, string[]>();
  const insertAfter = new Map<number, string[]>();
  const kept: string[] = [];
  let firstMatched = true;
  for (const b of blocks) {
    if (b.matched) {
      for (let k = b.start; k <= b.end; k++) remove.add(k);
      if (firstMatched) replaceAt.set(b.start, [SETTINGS_COMMENT_POINTER]);
      firstMatched = false;
    } else if (b.text !== SETTINGS_COMMENT_POINTER && namesMoved(b.text)) {
      let hosts = false;
      for (let k = b.start; k <= b.end; k++) if (remove.has(k)) hosts = true;
      kept.push(`${CLAUDE_MD}:${b.start + 1} — comment block kept${hosts ? ", its moved key lines removed" : " byte-identical"} (it matches no template block); a pointer follows it`);
      if (norm[b.end + 1] !== SETTINGS_COMMENT_POINTER) insertAfter.set(b.end, [SETTINGS_COMMENT_POINTER]);
    }
  }

  // Step 2 — a moved heading whose body holds only blank lines and comment blocks loses its heading.
  let insertAt: number | null = null;
  for (const span of spans) {
    // A heading inside a comment keeps its comment: only its key lines move.
    if (span.block !== undefined) continue;
    let emptied = true;
    for (let i = span.start + 1; i < span.end; i++) {
      if (remove.has(i) || norm[i]!.trim() === "" || inBlock(i) !== undefined) continue;
      emptied = false;
      break;
    }
    if (!emptied) continue;
    for (let i = span.start; i < span.end; i++) {
      const b = inBlock(i);
      if (b !== undefined && !b.matched && b.text !== SETTINGS_COMMENT_POINTER) continue;
      remove.add(i);
      replaceAt.delete(i);
    }
    if (insertAt === null) insertAt = span.start;
  }

  // Step 3 — `## Project Settings` where the first removed section stood, else after the first top-level section.
  if (insertAt === null) {
    const h1 = norm.findIndex((l) => /^# /.test(l));
    insertAt = h1 >= 0 ? sectionEnd(norm, h1) : norm.length;
  }
  const ttSettings = (settings.task_tracking as Obj | undefined) ?? {};
  const mode = typeof ttSettings.mode === "string" ? ttSettings.mode : "none";
  const section = [PROJECT_SETTINGS_HEADING, "", ...renderSettingsPointer(MOVE_FLOOR).replace(/\n+$/, "").split("\n"), ""];
  const binding = (mode === "linear" || mode === "jira" ? ttSettings[mode] : undefined) as Obj | undefined;
  if (binding !== undefined && typeof binding.repo_tag === "string" && typeof binding.min_dpt_version === "string") {
    section.push(
      ...renderSharedTrackerSentinel({
        adapter: mode as "linear" | "jira",
        project: String(binding.project ?? ""),
        repoTag: binding.repo_tag,
        minDptVersion: binding.min_dpt_version,
      }).split("\n"),
      "",
    );
  }
  const stub = renderTrackingStub({ task_tracking: { ...ttSettings, mode } });
  if (stub !== "") section.push(...stub.replace(/\n+$/, "").split("\n"), "");

  const out: string[] = [];
  for (let i = 0; i <= lines.length; i++) {
    if (i === insertAt) out.push(...section);
    if (i === lines.length) break;
    const rep = replaceAt.get(i);
    if (rep !== undefined) out.push(...rep);
    if (!remove.has(i)) out.push(lines[i]!);
    const ins = insertAfter.get(i);
    if (ins !== undefined) out.push(...ins);
  }
  if (insertAt === lines.length && out[out.length - 1] === "" && original !== null && original.endsWith("\n")) {
    // The section was appended at end of file: keep a single trailing newline.
    while (out.length > 1 && out[out.length - 1] === "" && out[out.length - 2] === "") out.pop();
  }

  // Writes: settings file (create), CLAUDE.md, then the retired files.
  const changed: string[] = [];
  writeProjectSettings(projectRoot, settings, { create: true });
  changed.push(SETTINGS_FILE);
  if (original !== null) {
    let next = out.join("\n");
    // An emptied last section takes the file's final newline with its blank lines: keep it.
    if (original.endsWith("\n") && !next.endsWith("\n")) next += "\n";
    if (next !== original) {
      writeFileSync(mdPath, next);
      changed.push(CLAUDE_MD);
    }
  }
  for (const rel of legacyFiles()) {
    const abs = join(projectRoot, rel);
    if (existsSync(abs)) {
      rmSync(abs);
      changed.push(rel);
    }
  }
  const summary = [
    `settings-file: moved ${[...homes, ...(msfLines.length > 0 ? ["milestone_scan_fetch:"] : [])].join(", ") || "legacy files"} into ${SETTINGS_FILE}`,
    ...kept,
  ].join("\n");
  return { changed, summary };
}

// ---------------------------------------------------------------------------
// Apply (cleanup)
// ---------------------------------------------------------------------------

/** The settings path each non-stub moved heading's keys live under. */
const CLEANUP_PATHS: Readonly<Record<string, string>> = {
  "## Verification": "verification",
  "## Docs": "docs",
  "## Orchestration": "orchestration",
  "## Token Stats": "tracking.token_stats",
  "## Release Files": "release",
};

function at(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o !== null && typeof o === "object" ? (o as Obj)[k] : undefined), obj);
}

/** The key paths under `path` where `a` and `b` differ; arrays compare whole. */
function differingPaths(a: unknown, b: unknown, path: string): string[] {
  const isMap = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);
  if (isMap(a) && isMap(b)) {
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((k) => differingPaths(a[k], b[k], `${path}.${k}`));
  }
  return JSON.stringify(clean(a)) === JSON.stringify(clean(b)) ? [] : [path];
}

function applyCleanup(projectRoot: string): ApplyResult {
  const current = loadFromSettingsFile(projectRoot);
  const { mdPath, original, lines, norm } = readClaudeMd(projectRoot);
  const keysByHeading = recognisedHeadingKeys();
  const legacyReaders: Record<string, () => unknown> = {
    "## Verification": () => readLegacyVerification(projectRoot),
    "## Docs": () => readLegacyDocs(projectRoot),
    "## Orchestration": () => readLegacyOrchestration(projectRoot),
    "## Token Stats": () => readLegacyTracking(projectRoot).token_stats,
    "## Release Files": () => readLegacyRelease(projectRoot),
  };

  const remove = new Set<number>();
  const diffs: string[] = [];
  const spans: { start: number; end: number }[] = [];
  norm.forEach((l, i) => {
    const keys = keysByHeading[l];
    const base = CLEANUP_PATHS[l];
    if (!keys || base === undefined) return;
    const end = sectionEnd(norm, i);
    const found = scanSectionKeys(norm, l, i, end, keys, remove);
    if (found.length === 0) return;
    const legacy = legacyReaders[l]!();
    for (const k of found) diffs.push(...differingPaths(at(legacy, k), at(current, `${base}.${k}`), `${base}.${k}`).map((p) => `${CLAUDE_MD} \`${l}\`: ${p}`));
    spans.push({ start: i, end });
  });

  const msfLines = norm.map((l, i) => (l.startsWith(MSF_PREFIX) ? i : -1)).filter((i) => i >= 0);
  if (msfLines.length > 0) {
    const legacy = parseMilestoneScanFetch(mdPath);
    const path = "task_tracking.milestone_scan_fetch";
    diffs.push(...differingPaths(legacy, at(current, path) ?? false, path).map((p) => `${CLAUDE_MD} \`${MSF_PREFIX}\`: ${p}`));
    removeMsfLines(norm, msfLines, remove);
  }

  const files: string[] = [];
  const fileValues: [string, string, () => unknown][] = [
    [TRACKER_CONFIG, "task_tracking.status_vocabulary", () => parseTrackerConfigFile(join(projectRoot, "specs"))],
    [VIDEO_CONFIG, "video.config", () => readLegacyVideo(projectRoot).config],
    [VIDEO_STYLE, "video.style", () => readLegacyVideo(projectRoot).style],
  ];
  for (const [rel, path, read] of fileValues) {
    if (!existsSync(join(projectRoot, rel))) continue;
    files.push(rel);
    diffs.push(...differingPaths(read(), at(current, path), path).map((p) => `${rel}: ${p}`));
  }

  if (diffs.length > 0) {
    return refusal(
      `a leftover legacy home holds values that differ from ${SETTINGS_FILE}:\n${diffs.join("\n")}`,
      `make each named key in the leftover equal to ${SETTINGS_FILE} (or delete the leftover by hand), then re-run /dev-process-toolkit:upgrade.`,
      `homes=${SETTINGS_FILE}, ${[...new Set(diffs.map((d) => d.split(/[ :]/)[0]))].join(", ")}`,
    );
  }

  // An emptied heading goes with its blank lines, as the move's step 2 rule.
  for (const s of spans) {
    let emptied = true;
    for (let i = s.start + 1; i < s.end; i++) {
      if (!remove.has(i) && norm[i]!.trim() !== "") {
        emptied = false;
        break;
      }
    }
    if (emptied) for (let i = s.start; i < s.end; i++) remove.add(i);
  }

  const changed: string[] = [];
  if (original !== null && remove.size > 0) {
    const out = lines.filter((_, i) => !remove.has(i));
    if (original.endsWith("\n")) {
      while (out.length > 1 && out[out.length - 1] === "" && out[out.length - 2] === "") out.pop();
    }
    const next = out.join("\n");
    if (next !== original) {
      writeFileSync(mdPath, next);
      changed.push(CLAUDE_MD);
    }
  }
  for (const rel of files) {
    rmSync(join(projectRoot, rel));
    changed.push(rel);
  }
  return { changed, summary: `settings-file: removed leftover ${changed.join(", ")} (values equal ${SETTINGS_FILE})` };
}

// ---------------------------------------------------------------------------
// Apply (stub repair)
// ---------------------------------------------------------------------------

function applyStubRepair(projectRoot: string): ApplyResult {
  const mdPath = join(projectRoot, CLAUDE_MD);
  if (!existsSync(mdPath)) return { changed: [], summary: "settings-file: nothing to repair" };
  const original = readFileSync(mdPath, "utf8");
  const render = renderTrackingStub(loadProjectSettings(projectRoot).settings);
  // Every slot past the first goes (all of them under `mode: none`); the writer's sync renders the one left.
  const lines = original.split("\n");
  const extra = trackingStubSlots(original).slice(render === "" ? 0 : 1).reverse();
  for (const s of extra) {
    const start = s.line - 1;
    const from = start > 0 && lines[start - 1]!.trim() === "" ? start - 1 : start;
    lines.splice(from, start + s.lines.length - from);
  }
  const trimmed = lines.join("\n");
  if (trimmed !== original) writeFileSync(mdPath, trimmed);
  if (render !== "") syncTrackingStub(projectRoot, render);
  const changed = readFileSync(mdPath, "utf8") === original ? [] : [CLAUDE_MD];
  return { changed, summary: `settings-file: ${render === "" ? "removed the tracking stub under `mode: none`" : "re-rendered the tracking stub"}` };
}

/**
 * The binding keys a `### Linear` / `### Jira` line declares that the legacy binding
 * parser does not model (`jira_issue_type`, or a bug key under the other adapter's
 * heading), as their verbatim string values. The move removes every recognised
 * binding line from CLAUDE.md, so each must land in the settings file, never vanish.
 */
function unparsedBindingKeys(lines: string[], adapter: "linear" | "jira", have: Obj): Obj {
  const sub = locateSubsection(lines, adapter);
  if (sub === null) return {};
  const known = new Set(settingsKeyOrder(`task_tracking.${adapter}`));
  const out: Obj = {};
  for (const raw of sub) {
    const m = /^([a-z_][a-z0-9_]*)\s*:\s*(.*)$/.exec(raw);
    if (!m) continue;
    const key = m[1]!;
    const value = m[2]!.trim();
    if (!known.has(key) || key in have || key === "default_labels" || value === "") continue;
    out[key] = value;
  }
  return out;
}

/** A binding mapping with its keys in the schema's order, so the stub rendered now equals the one rendered from the written file. */
function inKeyOrder(binding: Obj, adapter: "linear" | "jira"): Obj {
  const order = settingsKeyOrder(`task_tracking.${adapter}`);
  const out: Obj = {};
  for (const k of order) if (k in binding) out[k] = binding[k];
  for (const k of Object.keys(binding)) if (!(k in out)) out[k] = binding[k];
  return out;
}

export const settingsFile: MigrationEntry = {
  id: "settings-file",
  introduced_in: "3.0.0",
  title: "every setting moves into `specs/settings.yaml`",
  kind: "script",
  requires_explicit_approval: true,
  detect(projectRoot: string): DetectResult {
    return detectSettingsFile(projectRoot);
  },
  apply(projectRoot: string): ApplyResult {
    const source = detectSettingsSource(projectRoot);
    if (source === "legacy") return applyMove(projectRoot);
    if (source === "both") return applyCleanup(projectRoot);
    if (source === "settings") return applyStubRepair(projectRoot);
    return { changed: [], summary: "settings-file: nothing to move" };
  },
};
