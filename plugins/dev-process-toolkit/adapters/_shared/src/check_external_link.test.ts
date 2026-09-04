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
import { spawnSync } from "node:child_process";
import { join } from "node:path";

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

// ---------------------------------------------------------------------------
// THE CLI FRONT DOOR
//
// The shim is not decoration: probe #81 grades a registration whose module
// lacks an `import.meta.main` entry as an unreachable order, and this module's
// door is what made `scan_design_references.ts` reachable and moved
// ORDERED_UNREACHABLE_PIN 130 -> 129. A door nothing exercises is exactly the
// defect this repository keeps shipping, so it is driven for real here —
// spawned as a subprocess rather than by exporting `main`, because the thing
// worth pinning is that `bun run <module>` actually works, exit codes and all.
// ---------------------------------------------------------------------------

describe("the `import.meta.main` CLI shim actually runs", () => {
  const MODULE = join(import.meta.dir, "check_external_link.ts");

  const run = (...args: string[]) => {
    const r = spawnSync("bun", ["run", MODULE, ...args], { encoding: "utf-8" });
    return {
      code: r.status,
      stdout: (r.stdout ?? "").trim(),
      stderr: (r.stderr ?? "").trim(),
    };
  };

  test("a reachable case prints REACHABLE and exits 0", () => {
    expect(run("online", "200")).toMatchObject({ code: 0, stdout: "REACHABLE" });
  });

  test("403 prints REACHABLE — the authorization-challenge split survives the shim", () => {
    expect(run("online", "403")).toMatchObject({ code: 0, stdout: "REACHABLE" });
  });

  test("a dead case prints DEAD and exits 0", () => {
    expect(run("online", "404")).toMatchObject({ code: 0, stdout: "DEAD" });
  });

  test("a transport code is routed as a code, not parsed as a status", () => {
    expect(run("online", "ENOTFOUND")).toMatchObject({ code: 0, stdout: "DEAD" });
  });

  test("offline prints UNCHECKED even for a status that reads dead online", () => {
    // The offline/online pair is the mutation control: without the online leg
    // above, a shim hard-coded to UNCHECKED would pass this.
    expect(run("offline", "404")).toMatchObject({ code: 0, stdout: "UNCHECKED" });
  });

  test("a bad preflight exits 2 with the NFR-10 three-part shape on stderr", () => {
    const r = run("sideways", "200");
    expect(r.code).toBe(2);
    expect(r.stdout).toBe("");
    // Positive control for the two absence-ish claims below: the error really
    // was rendered, so `Remedy:`/`Context:` are read off real output.
    expect(r.stderr).toContain("check_external_link: argument error:");
    expect(r.stderr).toContain("Remedy:");
    expect(r.stderr).toContain("Context:");
    expect(r.stderr).toContain("'sideways'");
  });

  test("a missing observation exits 2 and names which argument is wrong", () => {
    const r = run("online");
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("argv[3]");
    // Distinct from the preflight error, or one generic message would satisfy
    // both legs — the same distinctness rule AC-STE-543.3 applies to reasons.
    expect(r.stderr).not.toContain("argv[2]");
  });
});
