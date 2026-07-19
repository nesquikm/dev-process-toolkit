import { describe, expect, test } from "bun:test";
import { formatLinearDescription, stripLinearACFences } from "./format_description";

describe("STE-211 — formatLinearDescription (AC-STE-211.1)", () => {
  test("wraps a single AC prefix in backticks", () => {
    const out = formatLinearDescription("- AC-STE-203.1: foo");
    expect(out).toBe("- AC-`STE-203`.1: foo");
  });

  test("wraps multiple AC prefixes on multiple lines", () => {
    const input = "- AC-STE-203.1: foo\n- AC-STE-204.2: bar\n";
    const expected = "- AC-`STE-203`.1: foo\n- AC-`STE-204`.2: bar\n";
    expect(formatLinearDescription(input)).toBe(expected);
  });

  test("idempotent: applying twice produces identical output", () => {
    const input = "- AC-STE-203.1: foo";
    const once = formatLinearDescription(input);
    const twice = formatLinearDescription(once);
    expect(twice).toBe(once);
  });

  test("STE-211 AC-STE-211 prose-bare references are NOT wrapped (only AC- prefix shape)", () => {
    // `Refs: STE-205` is a legitimate bare reference; the format helper
    // must NOT match it (the regex requires `AC-` lookbehind + `.\d+`).
    const input = "Refs: STE-205\nSee STE-201 for details.";
    expect(formatLinearDescription(input)).toBe(input);
  });

  test("does not wrap when the AC body lacks a `.<N>` suffix", () => {
    // `AC-STE-203` without the `.N` suffix is malformed; the regex
    // requires `\.\d+` so we leave it alone.
    const input = "AC-STE-203 without suffix";
    expect(formatLinearDescription(input)).toBe(input);
  });
});

describe("STE-211 — stripLinearACFences (AC-STE-211.3 / AC-STE-211.4)", () => {
  test("AC-STE-211.3: strips backtick-wrapped AC prefixes", () => {
    const out = stripLinearACFences("- AC-`STE-203`.1: foo");
    expect(out).toBe("- AC-STE-203.1: foo");
  });

  test("AC-STE-211.4: strips legacy <issue id> XML wrappers", () => {
    const input = '- AC-<issue id="abc-def">STE-203</issue>.1: foo';
    expect(stripLinearACFences(input)).toBe("- AC-STE-203.1: foo");
  });

  test("AC-STE-211.4: bare `<issue id>` references (no AC- prefix) keep their wrapper", () => {
    const input = 'See <issue id="abc">STE-205</issue> for details.';
    expect(stripLinearACFences(input)).toBe(input);
  });

  test("strips both backtick AND XML forms in the same body", () => {
    const input =
      '- AC-`STE-203`.1: from-fence\n- AC-<issue id="x">STE-204</issue>.2: from-xml\n';
    const expected = "- AC-STE-203.1: from-fence\n- AC-STE-204.2: from-xml\n";
    expect(stripLinearACFences(input)).toBe(expected);
  });
});

describe("STE-398 — stripLinearACFences tolerates Linear's href attribute", () => {
  test("AC-STE-398.1: strips id+href wrapper (href present, id first)", () => {
    const input =
      '- AC-<issue id="752f4657-b359-4e75-b942-e9d47cbf782a" href="https://linear.app/x/issue/STE-203/foo">STE-203</issue>.1: foo';
    expect(stripLinearACFences(input)).toBe("- AC-STE-203.1: foo");
  });

  test("AC-STE-398.2: strips regardless of attribute order (href before id)", () => {
    const input =
      '- AC-<issue href="https://linear.app/x/issue/STE-204/bar" id="abc-def">STE-204</issue>.2: bar';
    expect(stripLinearACFences(input)).toBe("- AC-STE-204.2: bar");
  });

  test("AC-STE-398.2: strips with additional attributes present", () => {
    const input =
      '- AC-<issue id="abc" href="https://linear.app/x" data-mention="1">STE-205</issue>.3: baz';
    expect(stripLinearACFences(input)).toBe("- AC-STE-205.3: baz");
  });

  test("AC-STE-398.2: strips multiple href-carrying wrappers on multiple lines", () => {
    const input =
      '- AC-<issue id="a" href="https://x/STE-203">STE-203</issue>.1: foo\n' +
      '- AC-<issue id="b" href="https://x/STE-204">STE-204</issue>.2: bar\n';
    const expected = "- AC-STE-203.1: foo\n- AC-STE-204.2: bar\n";
    expect(stripLinearACFences(input)).toBe(expected);
  });

  test("AC-STE-398.3: bare href-carrying issue reference (no AC- prefix) keeps its wrapper", () => {
    const input =
      'See <issue id="abc" href="https://linear.app/x/issue/STE-205/foo">STE-205</issue> for details.';
    expect(stripLinearACFences(input)).toBe(input);
  });

  test("AC-STE-398.4: round-trip strip(format(x)) === x still holds with href-adjacent bodies", () => {
    const inputs = [
      "AC-STE-203.1: foo",
      "- AC-STE-204.5: bar\nRefs: STE-205 (see https://linear.app/x)",
      "Mixed: AC-STE-1.1, AC-DPT-99.7",
    ];
    for (const x of inputs) {
      expect(stripLinearACFences(formatLinearDescription(x))).toBe(x);
    }
  });
});

describe("STE-211 — round-trip property (AC-STE-211 design contract)", () => {
  test("strip(format(x)) === x for AC-prefix bodies", () => {
    const inputs = [
      "AC-STE-203.1: foo",
      "- AC-STE-204.5: bar baz\n- AC-STE-205.10: qux",
      "Mixed: AC-STE-1.1, AC-DPT-99.7",
      "Plain text with no AC.",
      "Refs: STE-205\nAC-STE-203.1: foo",
    ];
    for (const x of inputs) {
      expect(stripLinearACFences(formatLinearDescription(x))).toBe(x);
    }
  });

  test("format(strip(x)) === format(x) for already-pushed (Linear-side) bodies", () => {
    const linearSide = '- AC-`STE-203`.1: foo\n- AC-<issue id="x">STE-204</issue>.2: bar\n';
    const stripped = stripLinearACFences(linearSide);
    expect(formatLinearDescription(stripped)).toBe("- AC-`STE-203`.1: foo\n- AC-`STE-204`.2: bar\n");
  });
});
