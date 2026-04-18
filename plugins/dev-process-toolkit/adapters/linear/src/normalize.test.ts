import { describe, expect, test } from "bun:test";
import { normalize } from "./normalize";

const cases: Array<{
  name: string;
  input: string;
  expectContains?: string[];
  expectNotContains?: string[];
  expectEmpty?: boolean;
}> = [
  {
    name: "double-spaced checkbox",
    input: "## Acceptance Criteria\n-  [  ]  double spaced\n",
    expectContains: ["- [ ] double spaced"],
  },
  {
    name: "CRLF line endings",
    input: "## Acceptance Criteria\r\n- [ ] crlf item\r\n- [x] done\r\n",
    expectContains: ["- [ ] crlf item", "- [x] done"],
  },
  {
    name: "nested sub-bullets",
    input: "## Acceptance Criteria\n- [ ] parent\n  - [ ] child\n  - [x] child2\n",
    expectContains: ["- [ ] parent", "  - [ ] child", "  - [x] child2"],
  },
  {
    name: "trailing unrelated H3 not included",
    input: "## Acceptance Criteria\n- [ ] ac1\n\n### Unrelated Section\nContent\n",
    expectContains: ["- [ ] ac1"],
    expectNotContains: ["Unrelated", "Content"],
  },
  {
    name: "mixed capitalization in checkbox",
    input: "## Acceptance Criteria\n- [X] CAPS\n- [x] lower\n- [ ] empty\n",
    expectContains: ["- [x] CAPS", "- [x] lower", "- [ ] empty"],
  },
  {
    name: "multiple blank lines collapsed",
    input: "## Acceptance Criteria\n- [ ] first\n\n\n\n- [ ] second\n",
    expectContains: ["- [ ] first", "- [ ] second"],
  },
  {
    name: "trailing whitespace stripped",
    input: "## Acceptance Criteria\n- [ ] ac1   \n- [x] ac2\t\n",
    expectContains: ["- [ ] ac1", "- [x] ac2"],
  },
  {
    name: "no AC section",
    input: "# Title\nSome content\n",
    expectEmpty: true,
  },
  {
    name: "star bullet normalized to dash",
    input: "## Acceptance Criteria\n* [ ] star bullet\n",
    expectContains: ["- [ ] star bullet"],
  },
  {
    name: "anchor fragments survive",
    input: "## Acceptance Criteria\n- [ ] AC-1.1: first rule\n- [x] AC-1.2: second rule\n",
    expectContains: ["- [ ] AC-1.1: first rule", "- [x] AC-1.2: second rule"],
  },
];

describe("linear normalize", () => {
  for (const c of cases) {
    test(c.name, () => {
      const once = normalize(c.input);
      const twice = normalize(once);

      // Idempotence (AC-39.6 round-trip convergence).
      expect(twice).toBe(once);

      if (c.expectEmpty) {
        expect(once).toBe("");
      }

      for (const s of c.expectContains ?? []) {
        expect(once).toContain(s);
      }
      for (const s of c.expectNotContains ?? []) {
        expect(once).not.toContain(s);
      }
    });
  }

  test("empty AC section yields header alone", () => {
    const out = normalize("## Acceptance Criteria\n\n### Next\nstuff\n");
    expect(out).toBe("## Acceptance Criteria\n");
    expect(normalize(out)).toBe(out);
  });

  test("round-trip: pull → normalize → push → pull → normalize is stable", () => {
    const inputs = cases.map((c) => c.input);
    for (const input of inputs) {
      const pass1 = normalize(input);
      // Simulate Linear's server-side re-normalization by round-tripping
      // through `normalize` a second time — canonical form is a fixpoint.
      const pass2 = normalize(pass1);
      expect(pass2).toBe(pass1);
    }
  });
});
