// STE-542 AC-STE-542.4 / AC-STE-542.6 — check_external_link.ts.
//
// Pure, deterministic classifier backing the /spec-write external-link
// reachability check:
//
//   classifyLinkVerdict({ preflight, status? , code? })
//     => "reachable" | "dead" | "unchecked"
//
// The verdict is decided by ONE run-level connectivity preflight plus the
// single response the probe observed. Per-URL error-code sniffing is
// explicitly rejected (`ENOTFOUND` reads identically when the whole host has
// no DNS), so `preflight: "offline"` short-circuits EVERY row to
// `"unchecked"` — never `"dead"`.
//
// This unit test IS the contract the TDD implementer builds to: no network,
// no session, no FS. Modelled on `adapters/_shared/src/design_asset_slug.test.ts`.

import { describe, expect, test } from "bun:test";
import { classifyLinkVerdict } from "./check_external_link";

/** What the probe observed: an HTTP status, or a transport-level error code. */
type ProbeResponse = { status: number } | { code: string };

type OnlineVerdict = "reachable" | "dead";

/**
 * The FULL response mapping named by AC-STE-542.4, one row per named case.
 *
 * The 401-vs-403 split is spelled out in words here because the M140 plan's
 * verify line ("an authorization challenge reads reachable; refusal, absence
 * and server error read dead") is ambiguous: "refusal" can be read as HTTP 403
 * OR as transport `ECONNREFUSED`. This table picks the SECOND reading, and the
 * three named tests below state it in prose so the row is falsifiable by
 * review as well as by execution:
 *
 *   - 401 Unauthorized  → an authorization CHALLENGE  → reachable
 *   - 403 Forbidden     → an authorization CHALLENGE  → reachable
 *   - ECONNREFUSED      → the connection REFUSAL      → dead
 */
const CASES: readonly { input: ProbeResponse; expected: OnlineVerdict }[] = [
  // 2xx — plain success.
  { input: { status: 200 }, expected: "reachable" },
  { input: { status: 204 }, expected: "reachable" },
  // 3xx — a redirect still proves the host answered.
  { input: { status: 301 }, expected: "reachable" },
  { input: { status: 302 }, expected: "reachable" },
  // 401/403 — an authorization challenge is a LIVE host, not a dead link.
  { input: { status: 401 }, expected: "reachable" },
  { input: { status: 403 }, expected: "reachable" },
  // 404/410 — absence.
  { input: { status: 404 }, expected: "dead" },
  { input: { status: 410 }, expected: "dead" },
  // 5xx — server error.
  { input: { status: 500 }, expected: "dead" },
  { input: { status: 503 }, expected: "dead" },
  // Transport failures — DNS resolution failure and connection refused.
  { input: { code: "ENOTFOUND" }, expected: "dead" },
  { input: { code: "ECONNREFUSED" }, expected: "dead" },
] as const;

const online = (input: ProbeResponse) =>
  classifyLinkVerdict({ preflight: "online", ...input });

const offline = (input: ProbeResponse) =>
  classifyLinkVerdict({ preflight: "offline", ...input });

describe("AC-STE-542.4 — response mapping is exact (preflight online)", () => {
  test("the table is intact — a deleted row is not a silent pass", () => {
    // Guards the table-driven legs below: without this, removing the only
    // `{status:410}` row would leave every remaining assertion green.
    expect(CASES.length).toBe(12);
  });

  for (const { input, expected } of CASES) {
    test(`${JSON.stringify(input)} → ${expected}`, () => {
      // `{input, verdict}` rather than a bare verdict so a wrong answer names
      // its own input in the failure diff.
      expect({ input, verdict: online(input) }).toEqual({ input, verdict: expected });
    });
  }

  test("closed union — online classification never emits a third value", () => {
    // Mapped over the CLASSIFIER's outputs, never over the table's `expected`
    // column: mapping the column would assert the literal against itself.
    expect(new Set(CASES.map((c) => online(c.input)))).toEqual(
      new Set<string>(["reachable", "dead"]),
    );
  });

  test("401 is an AUTHORIZATION CHALLENGE and therefore reachable — the host answered", () => {
    expect(online({ status: 401 })).toBe("reachable");
  });

  test("403 is ALSO an authorization challenge and therefore reachable — 403 is NOT the 'refusal' that reads dead", () => {
    expect(online({ status: 403 })).toBe("reachable");
    // Stated against its opposite so the ambiguity cannot resolve the wrong way.
    expect(online({ status: 403 })).not.toBe("dead");
  });

  test("ECONNREFUSED is the REFUSAL that reads dead — connection refused, not an HTTP answer", () => {
    expect(online({ code: "ECONNREFUSED" })).toBe("dead");
    // …and it is distinguishable from the 403 challenge above.
    expect(online({ code: "ECONNREFUSED" })).not.toBe(
      online({ status: 403 }),
    );
  });

  test("DNS resolution failure (ENOTFOUND) reads dead while the run is online", () => {
    expect(online({ code: "ENOTFOUND" })).toBe("dead");
  });
});

describe("AC-STE-542.6 — an offline preflight records unchecked, never dead", () => {
  test("EVERY row of the AC.4 table returns 'unchecked' when the preflight is offline", () => {
    const verdicts = CASES.map((c) => ({
      input: c.input,
      verdict: offline(c.input),
    }));
    expect(verdicts).toEqual(
      CASES.map((c) => ({ input: c.input, verdict: "unchecked" })),
    );
    // Closed union on the offline leg too — no row leaks a reachable/dead.
    expect(new Set(verdicts.map((v) => v.verdict))).toEqual(
      new Set<string>(["unchecked"]),
    );
  });

  test("404 offline is UNCHECKED, not dead — the check could not run, so it reports nothing", () => {
    expect(offline({ status: 404 })).toBe("unchecked");
    expect(offline({ status: 404 })).not.toBe("dead");
    // MUTATION CONTROL: the same input online still reads `dead`. Without this
    // pair, a classifier hard-coded to return `"unchecked"` passes the whole
    // offline describe block.
    expect(online({ status: 404 })).toBe("dead");
  });

  test("ENOTFOUND offline is UNCHECKED, not dead — absent DNS looks identical to a dead host", () => {
    expect(offline({ code: "ENOTFOUND" })).toBe("unchecked");
    expect(offline({ code: "ENOTFOUND" })).not.toBe("dead");
    // MUTATION CONTROL, as above.
    expect(online({ code: "ENOTFOUND" })).toBe("dead");
  });

  test("a reachable-online row also degrades to unchecked offline (the preflight dominates)", () => {
    expect(online({ status: 200 })).toBe("reachable");
    expect(offline({ status: 200 })).toBe("unchecked");
  });
});
