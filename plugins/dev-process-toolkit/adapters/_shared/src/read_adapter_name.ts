// readAdapterName — STE-321 (M84) shared helper.
//
// Architectural twin of `buildResolverConfig` from `resolver_config.ts`:
// reads `<adaptersDir>/<mode>.md` frontmatter and returns the canonical
// adapter `name:` value. The shape-probe path (probe #52
// `tracker_config_shape`) cross-checks `specs/tracker-config.yaml`
// `tracker_key:` against this value instead of a hard-coded
// `{linear, jira}` allowlist — that's the AC-STE-321.1 ↔ AC-STE-321.2
// pairing.
//
// Throws `MalformedAdapterMetadataError` (re-used from `resolver_config.ts`
// so callers get a single error class regardless of which adapter-shape
// fault tripped) when the adapter file is absent, the frontmatter cannot
// be parsed, or the `name:` key is missing/non-string. The error message
// is in NFR-10 canonical refusal shape (`Refusing: / Remedy: / Context:`).
//
// `claudeMdPath` is accepted to keep the signature parallel with
// `buildResolverConfig(claudeMdPath, adaptersDir)`. It is currently used
// only for the NFR-10 `Context:` line; the call site already has it on
// hand, so threading it through the helper costs nothing and keeps future
// `mode:` re-derivation inside this module if needed.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "./frontmatter";
import { MalformedAdapterMetadataError } from "./resolver_config";

/**
 * Read the canonical adapter `name:` field from
 * `<adaptersDir>/<mode>.md` frontmatter.
 *
 * @param claudeMdPath — absolute path to the project's `CLAUDE.md`. Used
 *   only for the NFR-10 `Context:` line in error messages.
 * @param adaptersDir — absolute path to the directory holding adapter
 *   `.md` files (typically `plugins/dev-process-toolkit/adapters`).
 * @param mode — the `mode:` value from `CLAUDE.md`'s `## Task Tracking`
 *   section. The helper resolves `<adaptersDir>/<mode>.md`.
 *
 * @returns The `name:` value from the adapter's frontmatter.
 *
 * @throws MalformedAdapterMetadataError when the adapter file does not
 *   exist, lacks YAML frontmatter, or has no `name:` key.
 */
export function readAdapterName(
  claudeMdPath: string,
  adaptersDir: string,
  mode: string,
): string {
  const adapterPath = join(adaptersDir, `${mode}.md`);
  if (!existsSync(adapterPath)) {
    throw new MalformedAdapterMetadataError(
      mode,
      [
        `${adapterPath}:1:1 — adapter file not found`,
        `Refusing: cannot resolve adapter \`name:\` for mode \`${mode}\`.`,
        `Remedy: create \`${adapterPath}\` with a \`name: ${mode}\` frontmatter key, or update \`CLAUDE.md\` \`## Task Tracking\` \`mode:\` to a configured adapter.`,
        `Context: claudeMdPath=${claudeMdPath}`,
      ].join("\n"),
    );
  }
  let frontmatter: Record<string, unknown>;
  try {
    frontmatter = parseFrontmatter(readFileSync(adapterPath, "utf8"));
  } catch (err) {
    throw new MalformedAdapterMetadataError(
      mode,
      [
        `${adapterPath}:1:1 — frontmatter could not be parsed`,
        `Refusing: adapter metadata is unreadable.`,
        `Remedy: ensure \`${adapterPath}\` opens with a \`---\` YAML frontmatter block.`,
        `Context: ${err instanceof Error ? err.message : String(err)}`,
      ].join("\n"),
    );
  }
  const name = frontmatter["name"];
  if (typeof name !== "string" || name.length === 0) {
    throw new MalformedAdapterMetadataError(
      mode,
      [
        `${adapterPath}:1:1 — frontmatter missing required \`name:\` key`,
        `Refusing: adapter \`name:\` is the canonical identifier (STE-10 AC.2) — cross-checks against \`specs/tracker-config.yaml\` \`tracker_key:\` rely on it.`,
        `Remedy: add a \`name: ${mode}\` line to the frontmatter of \`${adapterPath}\`.`,
        `Context: claudeMdPath=${claudeMdPath}`,
      ].join("\n"),
    );
  }
  return name;
}
