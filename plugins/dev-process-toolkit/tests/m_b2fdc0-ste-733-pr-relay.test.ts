// STE-733 (M_b2fdc0) — AC-STE-733.3 / .4 / .5 / .6: a worker's spec review
// vouches for the pull request its owner opens.
//
// Every leg drives the SHIPPED `pre-pr-spec-review.sh` wrapper (AC-STE-733.6)
// as the OPENING session (s-733-self), whose transcript carries no spec-review
// Skill call. The worker (s-733-owner) ran the review: its transcript sits at
// `<projects>/<slug>/s-733-owner.jsonl`, a sibling slug directory of the
// opener's, and holds the spec-review Skill call followed by the front-door
// run that announced the receipt it minted in the target checkout. The branch
// carries code, so the archive-only pass never applies; the remote is a local
// bare repository, so the remote branch head can equal HEAD.
//
// Each twin differs from the permit in exactly one condition of AC-STE-733.3,
// and is one of the refusals AC-STE-733.4 lists.

import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  cleanupTemps,
  makeRelayWorld,
  PLUGIN_ROOT,
  relayLegs,
  runRelay,
  show,
  type RelayWorld,
} from "./_m_b2fdc0_ste733_fixture";

const T = 120_000;

afterAll(() => cleanupTemps());

const LEGS = relayLegs();

describe("AC-STE-733.3 — the owner's announced spec-review receipt permits the opener's request", () => {
  for (const l of LEGS.filter((x) => x.expect === "permit")) {
    test(l.name, async () => {
      expect(await l.check(PLUGIN_ROOT)).toBeNull();
    }, T);
  }
});

describe("AC-STE-733.4 / AC-STE-733.6 — each twin differs in one condition and is refused", () => {
  for (const l of LEGS.filter((x) => x.expect === "refuse")) {
    test(l.name, async () => {
      expect(await l.check(PLUGIN_ROOT)).toBeNull();
    }, T);
  }

  test("AC-STE-733.6 — every condition of AC .3 has a twin", () => {
    const conditions = new Set(
      LEGS.filter((l) => l.expect === "refuse").map((l) => /TWIN \(([^)]+)\)/.exec(l.name)?.[1]),
    );
    expect([...conditions].sort()).toEqual(
      ["clean tree", "digest", "front door", "head", "parse", "projects root", "skill call", "store", "transcript"].sort(),
    );
  });
});

describe("AC-STE-733.5 — the refusal names the relay route; the reference documents both carve-outs", () => {
  test("a refused request's remedy names the relay: another session's spec-review receipt", async () => {
    const w = makeRelayWorld({ transcript: "missing" });
    const r = await runRelay(PLUGIN_ROOT, w);
    expect(r.exitCode).toBe(2);
    const remedy = r.stderr.split("\n").filter((l) => l.startsWith("Remedy:")).join("\n");
    expect({
      namesAnotherSession: /another session|other session|worker session|owning session/i.test(remedy),
      namesReceipt: /receipt/i.test(remedy),
    }).toEqual({ namesAnotherSession: true, namesReceipt: true });
  }, T);

  const doc = readFileSync(join(PLUGIN_ROOT, "docs", "hooks-reference.md"), "utf-8");
  function section(heading: string): string {
    const start = doc.indexOf(`### ${heading}\n`);
    if (start < 0) return "";
    const next = doc.indexOf("\n### ", start + 1);
    return doc.slice(start, next < 0 ? doc.length : next);
  }

  test("§ pre-commit-gate-check documents the spec-only pass and what qualifies", () => {
    const s = section("pre-commit-gate-check");
    expect({
      ticket: s.includes("STE-733"),
      rule: s.includes("isSpecPath"),
      plain: /`-a`/.test(s) && /pathspec/.test(s) && /--amend/.test(s),
      cleanTree: /working tree/.test(s),
    }).toEqual({ ticket: true, rule: true, plain: true, cleanTree: true });
  });

  test("§ pre-commit-gate-check names the spec-only pass's residual: the staged set is read before the command runs", () => {
    const s = section("pre-commit-gate-check");
    const start = s.indexOf("**Spec-only pass (STE-733):**");
    expect(start).toBeGreaterThanOrEqual(0);
    const next = s.indexOf("\n- **", start + 1);
    const bullet = s.slice(start, next < 0 ? s.length : next);
    const sentences = bullet.split(/(?<=[.!?])\s+/);
    const residual = sentences.filter(
      (x) =>
        (/pre-commit hook/i.test(x) || /concurrent/i.test(x)) &&
        (/before the command runs/i.test(x) || /staged set/i.test(x)),
    );
    expect(residual.length).toBeGreaterThan(0);
  });

  test("§ pre-pr-spec-review documents the relay and what counts as its evidence", () => {
    const s = section("pre-pr-spec-review");
    expect({
      ticket: s.includes("STE-733"),
      transcript: /<S>\.jsonl/.test(s) && /projects root/.test(s),
      skill: s.includes("dev-process-toolkit:spec-review"),
      frontDoor: s.includes("gate_receipt.ts"),
      digest: /digest/.test(s),
      head: s.includes("evidence.head") && /remote/.test(s),
      cleanTree: /working tree/.test(s),
    }).toEqual({ ticket: true, transcript: true, skill: true, frontDoor: true, digest: true, head: true, cleanTree: true });
  });

  test("§ pre-pr-spec-review names the relay's residual: a transcript planted inside the projects root is trusted", () => {
    const s = section("pre-pr-spec-review");
    const sentences = s.split(/(?<=[.!?])\s+/);
    const residual = sentences.filter(
      (x) => /projects root/.test(x) && /\btrust(ed|s)?\b/i.test(x) && /transcript/.test(x) && /writ(e|er|es|ing)\b/i.test(x),
    );
    expect(residual.length).toBeGreaterThan(0);
  });

  test("§ pre-pr-spec-review says plainly that the opening agent itself can plant the evidence, the same trust class as v3.3.0 (review I1)", () => {
    const s = section("pre-pr-spec-review");
    const sentences = s.split(/(?<=[.!?])\s+/);
    expect({
      openerPlants: sentences.some((x) => /\bopening (session|agent)\b/i.test(x) && /\bplant(s|ed|ing)?\b/i.test(x)),
      sameAsV330: sentences.some((x) => x.includes("v3.3.0") && /\bsame\b/i.test(x) && /\btrust\b/i.test(x)),
    }).toEqual({ openerPlants: true, sameAsV330: true });
  });
});

// Review finding (ordering): the relay's one network call — `git ls-remote`,
// asked by isRemoteHeadEqualToHead — must come AFTER the cheap local checks.
// The instrument is the remote's `uploadpack` program: a shim that records
// every ls-remote against origin, then runs the real git-upload-pack, so the
// remote answers exactly as before. The control proves the shim records the
// call the permit cannot do without.
describe("relay ordering — no other session's receipt means the remote is never contacted", () => {
  function instrument(w: RelayWorld): string {
    const marker = join(dirname(w.repo), "ls-remote.calls");
    const shim = join(dirname(w.repo), "upload-pack-shim.sh");
    writeFileSync(shim, `#!/bin/sh\necho call >> '${marker}'\nexec git-upload-pack "$@"\n`);
    chmodSync(shim, 0o755);
    const r = spawnSync("git", ["-C", w.repo, "config", "remote.origin.uploadpack", shim], { encoding: "utf-8" });
    if (r.status !== 0) throw new Error(`fixture: git config failed: ${r.stderr}`);
    return marker;
  }

  test("control — the permitted relay does contact the remote through the shim", async () => {
    const w = makeRelayWorld();
    const marker = instrument(w);
    const r = await runRelay(PLUGIN_ROOT, w);
    expect({ exit: r.exitCode, contacted: existsSync(marker) }, show(r)).toEqual({ exit: 0, contacted: true });
  }, T);

  test("the receipt sits only in another checkout: the request is refused and ls-remote never runs", async () => {
    const w = makeRelayWorld({ store: "other-checkout" });
    const marker = instrument(w);
    const r = await runRelay(PLUGIN_ROOT, w);
    expect({ exit: r.exitCode, refusing: r.stderr.includes("Refusing:"), contacted: existsSync(marker) }, show(r)).toEqual({
      exit: 2,
      refusing: true,
      contacted: false,
    });
  }, T);
});
