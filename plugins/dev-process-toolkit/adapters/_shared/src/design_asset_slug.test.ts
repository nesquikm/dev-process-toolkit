// STE-342 AC-STE-342.4 (+ .1 path composition) — design_asset_slug.ts.
//
// Pure, deterministic helpers that back the /spec-write capture step:
//   - designAssetSlug(captionOrOriginalName) → kebab-case stem (extension
//     dropped from the stem; the caller passes the real ext separately).
//   - designAssetTargetPath(classification, frId, slug, ext, existing) →
//     a REPO-ROOT-RELATIVE path under specs/design/{system,frs/<id>}/, with a
//     numeric collision suffix (-2, -3, …) when the would-be path is already
//     taken in `existing`.
//
// This unit test IS the contract the TDD implementer builds to: no session,
// no real FS — `existing` is supplied explicitly so the helper stays pure.

import { describe, expect, test } from "bun:test";
import { designAssetSlug, designAssetTargetPath } from "./design_asset_slug";

describe("designAssetSlug — kebab-case stem derivation (AC-STE-342.4)", () => {
  test("spaces + extension: 'Login Screen.png' → 'login-screen' (ext dropped, lowercased, spaces → hyphen)", () => {
    expect(designAssetSlug("Login Screen.png")).toBe("login-screen");
  });

  test("punctuation + repeats + case: 'Foo  Bar!!.JPG' → 'foo-bar'", () => {
    // Double space collapses to one hyphen; '!!' → hyphen then trimmed; the
    // trailing extension is not part of the slug; case is lowered.
    expect(designAssetSlug("Foo  Bar!!.JPG")).toBe("foo-bar");
  });

  test("caption (no extension) with em-dash + spaces collapses to single hyphens", () => {
    expect(designAssetSlug("Login screen — error state")).toBe(
      "login-screen-error-state",
    );
  });

  test("leading/trailing separators are trimmed", () => {
    expect(designAssetSlug("  --Trim Me--  ")).toBe("trim-me");
  });

  test("plain multi-word caption → kebab", () => {
    expect(designAssetSlug("color tokens")).toBe("color-tokens");
  });

  test("single clean word is unchanged", () => {
    expect(designAssetSlug("dashboard")).toBe("dashboard");
  });

  test("empty / all-punctuation / pure-non-ASCII caption falls back to 'image' (never an empty stem)", () => {
    // An empty stem would compose a hidden dotfile path
    // (`specs/design/system/.png`); the fallback keeps the path well-formed.
    expect(designAssetSlug("")).toBe("image");
    expect(designAssetSlug("!!!")).toBe("image");
    expect(designAssetSlug("—")).toBe("image");
    expect(designAssetSlug("图.png")).toBe("image"); // ext stripped, then empty
    // …and the composed path is well-formed, not a degenerate dotfile.
    expect(
      designAssetTargetPath("durable", "STE-341", designAssetSlug("!!!"), "png", []),
    ).toBe("specs/design/system/image.png");
  });
});

describe("designAssetTargetPath — durable vs per-feature composition (AC-STE-342.1 / .4)", () => {
  test("durable → specs/design/system/<slug>.<ext> (frId ignored)", () => {
    const got = designAssetTargetPath(
      "durable",
      "STE-341",
      "color-tokens",
      "png",
      [],
    );
    expect(got).toBe("specs/design/system/color-tokens.png");
    // Durable assets are not keyed by FR; the id must not leak into the path.
    expect(got).not.toContain("STE-341");
  });

  test("per-feature → specs/design/frs/<frId>/<slug>.<ext>", () => {
    expect(
      designAssetTargetPath("per-feature", "STE-341", "login", "png", []),
    ).toBe("specs/design/frs/STE-341/login.png");
  });

  test("extension is preserved verbatim (passed separately from the slug)", () => {
    expect(designAssetTargetPath("durable", "STE-341", "flow", "svg", [])).toBe(
      "specs/design/system/flow.svg",
    );
  });
});

describe("designAssetTargetPath — collision suffixing (AC-STE-342.4)", () => {
  const folder = "specs/design/frs/STE-341";

  test("no collision → bare path (first free wins)", () => {
    expect(
      designAssetTargetPath("per-feature", "STE-341", "login", "png", []),
    ).toBe(`${folder}/login.png`);
  });

  test("basename taken → second gets -2", () => {
    expect(
      designAssetTargetPath("per-feature", "STE-341", "login", "png", [
        `${folder}/login.png`,
      ]),
    ).toBe(`${folder}/login-2.png`);
  });

  test("basename + -2 taken → third gets -3", () => {
    expect(
      designAssetTargetPath("per-feature", "STE-341", "login", "png", [
        `${folder}/login.png`,
        `${folder}/login-2.png`,
      ]),
    ).toBe(`${folder}/login-3.png`);
  });

  test("durable collision suffixes under specs/design/system/", () => {
    expect(
      designAssetTargetPath("durable", "STE-341", "color-tokens", "png", [
        "specs/design/system/color-tokens.png",
      ]),
    ).toBe("specs/design/system/color-tokens-2.png");
  });

  test("collision is scoped to the target folder — a same-named file in another folder does not suffix", () => {
    // login.png exists under system/, but the per-feature target is under
    // frs/STE-341/ — a different folder, so no suffix is applied.
    expect(
      designAssetTargetPath("per-feature", "STE-341", "login", "png", [
        "specs/design/system/login.png",
      ]),
    ).toBe(`${folder}/login.png`);
  });
});
