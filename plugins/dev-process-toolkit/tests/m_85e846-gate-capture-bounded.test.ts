// The gate capture must come back. A hung runner is a real, measured shape:
// `bun test --reporter=junit` stalled at 0% CPU with no children twice on this
// machine, and an unbounded `spawnSync` turned that into a gate that never
// returns — blocking every commit, every release ceremony and the live proof.
//
// A verdict beats a hang: the run is cut at a bound, and the caller is told the
// run did not finish rather than being handed a confident-looking nothing.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { skipIdentityCommand } from "../adapters/_shared/src/skip_identities";
import {
  GATE_RUN_TIMEOUT_MS,
  gateRunTimeoutMs,
  runGateNamingSkips,
  TIMED_OUT_MARKER,
} from "../adapters/_shared/src/gate_identity_run";

describe("M_85e846 — a gate run is bounded, so a hung runner is a verdict and not a hang", () => {
  const root = mkdtempSync(join(tmpdir(), "gate-bound-"));

  test("a runner that never exits is cut at the bound and SAYS it did not finish", () => {
    const started = Date.now();
    // `unknown` stack ⇒ no identity command ⇒ the runner's own argv is run.
    const run = runGateNamingSkips(root, "unknown", ["/bin/sh", "-c", "sleep 600"], 1500);
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(60_000);
    expect(run.output).toContain(TIMED_OUT_MARKER);
    // The identities half never claims a reading it does not have.
    expect(run.identities === null || run.identities.status === "unavailable").toBe(true);
  }, 120_000);

  test("CONTROL — a runner that exits in time is untouched, and its output is carried whole", () => {
    const run = runGateNamingSkips(root, "unknown", ["/bin/sh", "-c", "echo 3 pass; echo 0 fail"], 30_000);
    expect(run.output).toContain("3 pass");
    expect(run.output).not.toContain(TIMED_OUT_MARKER);
  }, 60_000);

  test("a grandchild that outlives the run never holds the capture open", () => {
    const started = Date.now();
    const run = runGateNamingSkips(root, "unknown", ["/bin/sh", "-c", "( sleep 45 & ) ; echo 1 pass"], 30_000);
    expect(Date.now() - started).toBeLessThan(30_000);
    expect(run.output).toContain("1 pass");
  }, 60_000);

  test("the default bound is generous but finite, and an env override is honoured", () => {
    expect(GATE_RUN_TIMEOUT_MS).toBeGreaterThanOrEqual(10 * 60_000);
    expect(Number.isFinite(GATE_RUN_TIMEOUT_MS)).toBe(true);
    const saved = process.env.DPT_GATE_TIMEOUT_MS;
    try {
      process.env.DPT_GATE_TIMEOUT_MS = "90000";
      expect(gateRunTimeoutMs()).toBe(90_000);
      process.env.DPT_GATE_TIMEOUT_MS = "not-a-number";
      expect(gateRunTimeoutMs()).toBe(GATE_RUN_TIMEOUT_MS);
      delete process.env.DPT_GATE_TIMEOUT_MS;
      expect(gateRunTimeoutMs()).toBe(GATE_RUN_TIMEOUT_MS);
    } finally {
      if (saved === undefined) delete process.env.DPT_GATE_TIMEOUT_MS;
      else process.env.DPT_GATE_TIMEOUT_MS = saved;
    }
  });

  // MEASURED: the full suite under `--reporter=junit` stalled at 0% CPU after a
  // storm of 5-second per-test timeouts on a loaded machine; the SAME suite with
  // `--timeout 30000` completed in 380s (15217 pass, 16 skip, 0 fail). The
  // identity run therefore carries a per-test deadline that survives load. It
  // grades the same tests: only the deadline each one is given changes.
  test("the bun identity command gives each test a deadline that survives a loaded machine", () => {
    const composed = skipIdentityCommand("bun", "/tmp/report.xml");
    expect(composed).toContain("--reporter=junit");
    expect(composed).toContain("--timeout 30000");
  });

  test("CONTROL — a stack with no machine-readable report still composes nothing", () => {
    expect(skipIdentityCommand("unknown", "/tmp/report.xml")).toBe(null);
  });

  test("cleanup", () => {
    rmSync(root, { recursive: true, force: true });
    expect(true).toBe(true);
  });
});
