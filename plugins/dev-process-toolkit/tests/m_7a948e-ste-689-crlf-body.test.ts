// M_7a948e STE-689 review (Phase 3): a CRLF changelog body merges into
// `## [Unreleased]` exactly as its LF twin does. Without folding line endings,
// `### Added\r` misses the subsection-heading match and the duplicate-line
// check, so a second run would append the same FR line again.

import { describe, expect, test } from "bun:test";
import { bumpChangelogUnreleased } from "../adapters/_shared/src/release_config";

const CHANGELOG = "# Changelog\n\n## [Unreleased]\n\n### Added\n\n- STE-1 earlier\n\n## [1.0.0] — 2026-01-01\n\n- first\n";
const LF_BODY = "### Added\n\n- STE-689 a release without a version\n";
const CRLF_BODY = LF_BODY.replace(/\n/g, "\r\n");

describe("AC-STE-689.4/.5 — a CRLF body merges like its LF twin", () => {
  test("the CRLF body lands under the existing ### Added, byte-identical to the LF merge", () => {
    expect(bumpChangelogUnreleased(CHANGELOG, CRLF_BODY)).toBe(bumpChangelogUnreleased(CHANGELOG, LF_BODY));
  });

  test("a second CRLF run adds nothing", () => {
    const once = bumpChangelogUnreleased(CHANGELOG, CRLF_BODY);
    expect(bumpChangelogUnreleased(once, CRLF_BODY)).toBe(once);
  });
});
