// best_practices_digest_match — /gate-check probe #91 (STE-879).
//
// Invariant (AC-STE-879.4): every `specs/best-practices.yaml` entry that
// declares `sha256` must match the digest of its document's bytes. Each
// mismatch is one ERROR-severity violation naming the entry, the path, the
// declared and the actual digest.
//
// Vacuous when the manifest is absent or empty, and for every entry without
// the key. A malformed manifest or a dangling `path` is probe #76's
// (`best_practices_manifest_hygiene`) to report, so this probe skips both
// rather than reporting them twice.
//
// The digest comes from `documentSha256` in `best_practices_manifest.ts`, the
// helper the `select` leg uses, so the probe and `select` cannot disagree.

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  BestPracticesManifestShapeError,
  documentSha256,
  isRegularDocument,
  readManifest,
} from "./best_practices_manifest";

const PROBE = "best_practices_digest_match";
const MANIFEST_REL = "specs/best-practices.yaml";

export interface BestPracticesDigestMatchViolation {
  file: string;
  line: number;
  reason: string;
  note: string; // `file:line — reason` per STE-82
  message: string; // NFR-10 canonical multi-line shape
}

export interface BestPracticesDigestMatchReport {
  violations: BestPracticesDigestMatchViolation[];
  notes: string[];
}

/** 1-based line of the `name: <name>` entry line; 1 when it cannot be found. */
function findNameLine(rawText: string, name: string): number {
  const lines = rawText.replace(/\r\n/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*(?:-\s+)?name:\s*(.*)$/.exec(lines[i]!);
    if (!m) continue;
    const value = m[1]!.trim().replace(/^(["'])(.*)\1$/, "$2");
    if (value === name) return i + 1;
  }
  return 1;
}

/**
 * Compare each entry's declared `sha256` with its document's digest. Pure —
 * reads the manifest and the documents, writes nothing.
 *
 * Call site: `/gate-check` conformance probe #91 + the STE-879 suite at
 * `tests/m_43bc84-ste-879-cli-sha256-probe.test.ts`.
 */
export async function runBestPracticesDigestMatchProbe(
  projectRoot: string,
): Promise<BestPracticesDigestMatchReport> {
  const manifestAbs = join(projectRoot, "specs", "best-practices.yaml");
  const violations: BestPracticesDigestMatchViolation[] = [];
  const notes: string[] = [];
  if (!existsSync(manifestAbs)) return { violations, notes };

  let entries;
  try {
    entries = readManifest(join(projectRoot, "specs")).best_practices;
  } catch (err) {
    if (err instanceof BestPracticesManifestShapeError) return { violations, notes };
    throw err;
  }

  const rawText = readFileSync(manifestAbs, "utf8");
  for (const entry of entries) {
    if (entry.sha256 === undefined) continue;
    const docAbs = join(projectRoot, entry.path);
    if (!isRegularDocument(docAbs)) continue;
    // An unreadable document (EACCES, deleted mid-run) is skipped like a
    // missing one: probe #76 owns document existence, this probe grades digests.
    let actual: string;
    try {
      actual = documentSha256(docAbs);
    } catch {
      continue;
    }
    if (actual === entry.sha256) continue;
    const line = findNameLine(rawText, entry.name);
    const reason = `manifest entry \`${entry.name}\` declares sha256 ${entry.sha256} for ${entry.path}, but the document's digest is ${actual}`;
    violations.push({
      file: manifestAbs,
      line,
      reason,
      note: `${MANIFEST_REL}:${line} — ${reason}`,
      message: [
        `${PROBE}: ${reason}`,
        `Remedy: review the changed ${entry.path}, then set the entry's \`sha256\` to ${actual} via /dev-process-toolkit:best-practices edit, or restore the document.`,
        `Context: file=${MANIFEST_REL}, entry=${entry.name}, probe=${PROBE}`,
      ].join("\n"),
    });
  }
  return { violations, notes };
}

if (import.meta.main) {
  const report = await runBestPracticesDigestMatchProbe(resolve(process.argv[2] || process.cwd()));
  for (const v of report.violations) console.log(v.message);
  for (const n of report.notes) console.log(n);
  process.exit(report.violations.length > 0 ? 1 : 0);
}
