// STE-121 — `buildFRFrontmatter(spec, trackerBinding?)` helper.
//
// Covers AC-STE-121.1 (canonical YAML render for both modes), AC-STE-121.4
// (verbose tracker shape rejected), AC-STE-121.5 (em-dash + escape round-trip),
// AC-STE-121.6 (mode-none ULID branch unchanged).

import { describe, expect, test } from "bun:test";
import {
  buildFRFrontmatter,
  FRFrontmatterShapeError,
  InvalidFrontmatterInputError,
  InvalidTrackerShapeError,
  type FRFrontmatterInput,
  type TrackerBinding,
} from "./fr_frontmatter";

const ULID = "fr_01KPTSA7W7NX6R98CBXTVDTAF4";
const ISO = "2026-04-27T08:13:18Z";

function modeNoneInput(overrides: Partial<FRFrontmatterInput> = {}): FRFrontmatterInput {
  return {
    id: ULID,
    title: "Test FR",
    milestone: "M99",
    createdAt: ISO,
    ...overrides,
  };
}

function trackerInput(overrides: Partial<FRFrontmatterInput> = {}): FRFrontmatterInput {
  return {
    title: "Test FR",
    milestone: "M99",
    createdAt: ISO,
    ...overrides,
  };
}

describe("buildFRFrontmatter — mode-none happy path (AC-STE-121.1, AC-STE-121.6)", () => {
  test("renders canonical YAML with id present, no tracker block", () => {
    const out = buildFRFrontmatter(modeNoneInput());
    expect(out).toBe(
      [
        "---",
        "title: Test FR",
        "milestone: M99",
        "status: active",
        "archived_at: null",
        `id: ${ULID}`,
        `created_at: ${ISO}`,
        "---",
        "",
      ].join("\n"),
    );
  });

  test("output has no `tracker:` block at all", () => {
    const out = buildFRFrontmatter(modeNoneInput());
    expect(out).not.toMatch(/^tracker:/m);
  });
});

describe("buildFRFrontmatter — tracker-mode happy path (AC-STE-121.1)", () => {
  test("renders canonical YAML with no id, compact tracker block", () => {
    const binding: TrackerBinding = { key: "linear", id: "STE-121" };
    const out = buildFRFrontmatter(trackerInput(), binding);
    expect(out).toBe(
      [
        "---",
        "title: Test FR",
        "milestone: M99",
        "status: active",
        "archived_at: null",
        "tracker:",
        "  linear: STE-121",
        `created_at: ${ISO}`,
        "---",
        "",
      ].join("\n"),
    );
  });

  test("tracker key with arbitrary string (out-of-tree adapter compat)", () => {
    const binding: TrackerBinding = { key: "github", id: "123" };
    const out = buildFRFrontmatter(trackerInput(), binding);
    expect(out).toMatch(/^tracker:\n  github: 123$/m);
    expect(out).not.toMatch(/^id:/m);
  });
});

describe("buildFRFrontmatter — em-dash + escape rules (AC-STE-121.5)", () => {
  test("em-dash title round-trips byte-identically", () => {
    const title = "M27 — Dart/Python docs parity";
    const out = buildFRFrontmatter(modeNoneInput({ title }));
    expect(out).toContain(`title: ${title}\n`);
  });

  test("title containing double-quote uses JSON-stringified form", () => {
    const title = `Has "quotes" inside`;
    const out = buildFRFrontmatter(modeNoneInput({ title }));
    expect(out).toContain(`title: ${JSON.stringify(title)}\n`);
  });

  test("title containing backslash uses JSON-stringified form", () => {
    const title = "Path C:\\Users\\test";
    const out = buildFRFrontmatter(modeNoneInput({ title }));
    expect(out).toContain(`title: ${JSON.stringify(title)}\n`);
  });

  test("title containing colon uses JSON-stringified form", () => {
    const title = "Key: value notation";
    const out = buildFRFrontmatter(modeNoneInput({ title }));
    expect(out).toContain(`title: ${JSON.stringify(title)}\n`);
  });
});

describe("buildFRFrontmatter — verbose tracker shape rejected (AC-STE-121.4)", () => {
  test("verbose `{ key, id, url }` throws InvalidTrackerShapeError", () => {
    const verbose = { key: "linear", id: "STE-1", url: "https://linear.app/foo/STE-1" } as unknown as TrackerBinding;
    expect(() => buildFRFrontmatter(trackerInput(), verbose)).toThrow(InvalidTrackerShapeError);
    try {
      buildFRFrontmatter(trackerInput(), verbose);
    } catch (e) {
      expect((e as Error).message).toMatch(/STE-110 AC-STE-110\.2/);
    }
  });
});

describe("buildFRFrontmatter — mode/binding consistency (AC-STE-121.1)", () => {
  test("mode-none + binding present throws InvalidFrontmatterInputError", () => {
    const binding: TrackerBinding = { key: "linear", id: "STE-1" };
    expect(() => buildFRFrontmatter(modeNoneInput(), binding)).toThrow(
      InvalidFrontmatterInputError,
    );
  });

  test("tracker-mode + id present throws InvalidFrontmatterInputError", () => {
    const binding: TrackerBinding = { key: "linear", id: "STE-1" };
    const input: FRFrontmatterInput = { ...trackerInput(), id: ULID };
    expect(() => buildFRFrontmatter(input, binding)).toThrow(InvalidFrontmatterInputError);
  });

  test("neither id nor binding throws InvalidFrontmatterInputError", () => {
    expect(() => buildFRFrontmatter(trackerInput())).toThrow(InvalidFrontmatterInputError);
  });
});

describe("buildFRFrontmatter — byte-identity round-trip (AC-STE-121.6)", () => {
  test("mode-none output matches the STE-110 reference shape line-by-line", () => {
    const out = buildFRFrontmatter(modeNoneInput());
    const expected = [
      "---",
      "title: Test FR",
      "milestone: M99",
      "status: active",
      "archived_at: null",
      `id: ${ULID}`,
      `created_at: ${ISO}`,
      "---",
      "",
    ].join("\n");
    expect(out).toBe(expected);
  });
});

describe("FRFrontmatterShapeError — exported error type for post-write self-check (AC-STE-121.3)", () => {
  test("FRFrontmatterShapeError is a constructable Error subclass", () => {
    const err = new FRFrontmatterShapeError("test");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("FRFrontmatterShapeError");
    expect(err.message).toBe("test");
  });
});
