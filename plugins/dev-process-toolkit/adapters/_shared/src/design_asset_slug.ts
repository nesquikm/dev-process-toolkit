// Design-asset slug + target-path helpers (STE-342, AC-STE-342.4 + .1).
//
// Pure, deterministic backing for the /spec-write image-capture step:
//   - designAssetSlug(captionOrOriginalName) → kebab-case stem. A trailing
//     image extension is dropped from the stem (the caller passes the real
//     ext separately); all non-alphanumeric runs collapse to a single hyphen;
//     leading/trailing hyphens are trimmed.
//   - designAssetTargetPath(classification, frId, slug, ext, existing) →
//     a REPO-ROOT-RELATIVE path under specs/design/{system,frs/<id>}/, with a
//     numeric collision suffix (-2, -3, …) when the candidate path is already
//     present in `existing`. Collision is scoped to the target folder: a
//     same-basename file in a different folder does not trigger a suffix
//     because the comparison is over full candidate paths.
//
// No FS, no session, no I/O — `existing` is supplied explicitly so the helper
// stays a referentially-transparent function the /spec-write capture step can
// call and the STE-343 probe can mirror.

/** Recognised trailing image extensions, stripped from the slug stem. */
const IMAGE_EXT_RE = /\.(png|jpe?g|svg|webp|gif)$/i;

/**
 * Derive a kebab-case slug stem from a caption or original filename.
 *
 * Steps (in order):
 *   1. Strip a recognised trailing image extension (case-insensitive).
 *   2. Lowercase.
 *   3. Collapse every run of non-alphanumeric characters (spaces, punctuation,
 *      em-dash, repeats) to a single hyphen.
 *   4. Trim leading/trailing hyphens.
 *   5. Fall back to `"image"` when nothing survives (all-punctuation or a
 *      purely non-ASCII caption like `"图.png"`) — an empty stem would
 *      compose a hidden dotfile path (`specs/design/system/.png`); the
 *      collision suffix then disambiguates repeated fallbacks.
 *
 * Deterministic; no I/O.
 */
export function designAssetSlug(captionOrOriginalName: string): string {
  const slug = captionOrOriginalName
    .replace(IMAGE_EXT_RE, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "image";
}

/**
 * Compose the repo-root-relative target path for a design asset.
 *
 *   - durable      → specs/design/system/<slug>.<ext>           (frId ignored)
 *   - per-feature  → specs/design/frs/<frId>/<slug>.<ext>
 *
 * Collision suffixing: if the bare candidate path is already present in
 * `existing`, append `-2`, `-3`, … to the slug until the candidate is free.
 * Comparison is over full candidate paths, so collision is scoped to the
 * target folder — a same-basename file under a different folder does not
 * trigger a suffix.
 *
 * Deterministic; no I/O.
 */
export function designAssetTargetPath(
  classification: "durable" | "per-feature",
  frId: string,
  slug: string,
  ext: string,
  existing: string[],
): string {
  const folder =
    classification === "durable"
      ? "specs/design/system"
      : `specs/design/frs/${frId}`;

  const taken = new Set(existing);
  let candidate = `${folder}/${slug}.${ext}`;
  let n = 2;
  while (taken.has(candidate)) {
    candidate = `${folder}/${slug}-${n}.${ext}`;
    n++;
  }
  return candidate;
}
