// M121 / STE-460 — AC.1, AC.2, AC.3.
//
// THE DEFECT, stated as it was measured rather than as it reads. The shipped
// fence negative amends a claim commit's subject by ONE BYTE (`claim lock` →
// `claim Lock`) and asserts the fence finds nothing. That proves the pattern is
// not `.*`. It does not prove the pattern's `^` or its trailing space are doing
// any work — and both were measured GREEN under exactly the two widenings
// STE-461 is about to perform.
//
// The repair is not a stronger assertion; it is a discriminating INPUT. A
// subject that only an anchored pattern rejects, and a subject that only a
// space-terminated pattern rejects. Each is then shown to FLIP when its
// widening is applied, because a rejection on its own proves nothing: a subject
// that matches nothing ever is rejected by a healthy pattern and by a widened
// one alike, which is precisely how the one-byte rewording stayed green.
//
// AC.3 is the other half. A negative strengthened past the real defect turns a
// healthy run into a false RED, and a fixture that false-REDs on a healthy run
// gets disabled within two releases — strictly worse than the hole it closed.
// Every negative here is run against the real `LocalProvider.claimLock` subject
// and asserted NOT to reject it.

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bashFences } from "./_fence";
import { CLAIM_FENCE_NEGATIVES } from "./_claim-fence-negatives";
import { LocalProvider } from "../adapters/_shared/src/local_provider";
import { mintId } from "../adapters/_shared/src/ulid";

const TESTS_DIR = import.meta.dir;
const PLUGIN_ROOT = join(TESTS_DIR, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const SMOKE_SKILL = join(REPO_ROOT, ".claude/skills/smoke-test/SKILL.md");
const SUITE_456 = join(TESTS_DIR, "m121-ste-456-two-sided-lock-evidence.test.ts");

function read(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

const smokeDoc = read(SMOKE_SKILL);
const describeIfSkills = smokeDoc === null ? describe.skip : describe;

describe("STE-460 fence negatives — the driver under test was actually found", () => {
  test("the smoke driver resolves, so nothing below is a silent skip", () => {
    expect(smokeDoc).not.toBeNull();
    expect(smokeDoc!.length).toBeGreaterThan(10_000);
  });
});

// ══════════════════════════ the executed harness ═════════════════════════════

const GROUP10_RE = /#### Fixture group 10 — [\s\S]*?(?=\n#### |\n### |$)/;
const SAMPLE_LOG_LITERAL = "/tmp/dpt-smoke-<tracker>-ste451-lock-samples.log";

/** The two shipped fences that carry the claim-subject `--grep` pattern. */
const CLAIM_FENCE_INDICES = [1, 2] as const;

function group10Fences(): string[] {
  return bashFences(GROUP10_RE.exec(smokeDoc ?? "")?.[0] ?? "");
}

interface Fixture {
  root: string;
  frId: string;
  branch: string;
  log: string;
}

function git(cwd: string, ...args: string[]): string {
  const p = Bun.spawnSync({ cmd: ["git", ...args], cwd });
  if (p.exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed in ${cwd}: ${new TextDecoder().decode(p.stderr)}`,
    );
  }
  return new TextDecoder().decode(p.stdout).trim();
}

function buildFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "ste460-fence-"));
  const branch = "feat/m121-ste-460-fixture";
  git(root, "init", "--quiet");
  git(root, "symbolic-ref", "HEAD", `refs/heads/${branch}`);
  git(root, "config", "user.email", "ste460@example.invalid");
  git(root, "config", "user.name", "STE-460 Fixture");
  const frId = mintId();
  mkdirSync(join(root, "specs", "frs"), { recursive: true });
  writeFileSync(
    join(root, "specs", "frs", `${frId.slice(23, 29)}.md`),
    [
      "---",
      'title: "Fence negative fixture FR"',
      `id: ${frId}`,
      "milestone: M_FIXTURE",
      "status: active",
      "---",
      "",
      "# Fence negative fixture FR",
      "",
    ].join("\n"),
  );
  git(root, "add", "-A");
  git(root, "commit", "--quiet", "-m", "chore: seed the tracker-less fixture");
  return { root, frId, branch, log: join(root, "samples.log") };
}

function cleanup(f: Fixture): void {
  rmSync(f.root, { recursive: true, force: true });
}

async function claim(f: Fixture): Promise<void> {
  await new LocalProvider({ repoRoot: f.root, skipFetch: true }).claimLock(f.frId, f.branch);
}

/**
 * Aim a fence at a real tree and ASSERT the substitution landed.
 *
 * follow-ups § 0b: a substitution that silently misses puts every artifact where
 * no assertion looks, and the run then reads as "the code under test does
 * nothing" rather than "the harness is misconfigured".
 */
function aim(fence: string, f: Fixture): string {
  let out = fence.replace("TP=../dpt-test-project-none", `TP=${f.root}`);
  out = out.replace(SAMPLE_LOG_LITERAL, f.log);
  if (out === fence) {
    throw new Error("aim: neither substitution applied — a fence changed shape");
  }
  return out;
}

function runBash(script: string): { code: number; out: string; err: string } {
  const p = Bun.spawnSync({ cmd: ["bash", "-c", script] });
  return {
    code: p.exitCode ?? -1,
    out: new TextDecoder().decode(p.stdout),
    err: new TextDecoder().decode(p.stderr),
  };
}

function grepPattern(fence: string): string {
  const m = /--grep="([^"]*)"/.exec(fence);
  expect({ fenceCarriesAGrep: m !== null }).toEqual({ fenceCarriesAGrep: true });
  return m![1]!;
}

/**
 * Run one claim fence against a fixture and report whether it RESOLVED the claim
 * commit.
 *
 * Both shipped fences are reduced to the same boolean so the negative table can
 * be scored against either without a per-fence special case: the sampler
 * (index 1) latches its verdict into the durable log, 10b (index 2) prints the
 * retrieved blob. The log is removed before each run so an earlier call's line
 * can never be read as this one's answer.
 */
function witnessFound(f: Fixture, idx: number, fence: string): boolean {
  const fences = group10Fences();
  rmSync(f.log, { force: true });
  if (idx === 1) {
    runBash(`${aim(fences[0]!, f)}\n${aim(fence, f)}`);
    // THE SAMPLER MUST HAVE RUN AND OBSERVED SOMETHING. An absent or contentless
    // log is "no observation", not "no witness", and returning `false` for it
    // makes every reject arm pass against a dead harness — § 0m(a)'s one-sided
    // latch ("an append-on-hit log cannot be read for absence") reappearing one
    // layer down, in the very test written to guard the fence it was fixed in.
    //
    // WHAT THIS CATCHES: the sampler not running at all, and the sampler running
    // without reaching its lock observation. Callers reach here only after
    // `claim()`, so the lock is on disk and a live sampler MUST report it.
    //
    // WHAT THIS DOES NOT CATCH — named rather than smoothed over, because a hole
    // a reader can see is worth more than one they discover. A break confined to
    // the fence's own `CLAIM_SHA` capture (SKILL.md:1367-1369) is INVISIBLE from
    // out here: that line is wrapped in `2>/dev/null || true` BY DESIGN, and the
    // `lock-present` line is already written above it, so a broken `git` there
    // yields a present log, an observed lock, empty stderr, and a trailing
    // `claim-commit none` — byte-identical to a healthy miss (measured; compare
    // the genuine-miss output recorded in m121-ste-456). No signal survives the
    // fence's own redirect, so this is a limit of black-box observation, not an
    // oversight. The accept arm is what covers it: a widened pattern must return
    // TRUE on the same fixture, which a dead capture cannot produce.
    if (!existsSync(f.log)) {
      throw new Error(
        `witnessFound: sampler produced no log at ${f.log} — the fence did not run. ` +
          `This is a broken harness, not a negative result; failing loudly rather ` +
          `than reporting "no witness".`,
      );
    }
    const sampled = readFileSync(f.log, "utf8");
    if (!sampled.includes(`lock-present ${f.frId}`)) {
      throw new Error(
        `witnessFound: sampler ran but never observed the lock for ${f.frId}. ` +
          `The caller claims before sampling, so a live sampler must report it. ` +
          `Broken harness, not a negative result.\n${sampled}`,
      );
    }
    return readFileSync(f.log, "utf8")
      .split("\n")
      .some((l) => /^claim-commit [0-9a-f]{40}$/.test(l));
  }
  // THE 10b FENCE MUST HAVE RUN — the same obligation as the sampler above, and
  // it was missed here on the first pass while being fixed there. `code` cannot
  // carry it: measured, 10b exits 1 on every LEGITIMATE miss (`SHA` empty ⇒ the
  // `[ -n "${SHA}" ] &&` short-circuits), so a non-zero exit is the healthy
  // negative, not the broken one. stderr is the discriminator: a genuine miss
  // resolves silently, while a broken interpolation or a hostile git config
  // writes there. Without this, a dead harness scores `false` and the reject arm
  // passes on a run that observed nothing.
  const r = runBash(`${aim(fences[0]!, f)}\n${fence}`);
  if (r.err.trim().length > 0) {
    throw new Error(
      `witnessFound: the 10b fence wrote to stderr — the harness is broken, not ` +
        `the witness absent. Failing loudly rather than reporting "no witness".\n${r.err}`,
    );
  }
  return r.out.includes(`ulid: ${f.frId}`);
}

// ═════════════════════ AC-STE-460.1 / .2 — the two widenings ═════════════════

describeIfSkills("AC-STE-460.1 / .2 — the fence negative sees the anchor and the space", () => {
  test("the negative table names both widenings and its labels identify", () => {
    const labels = CLAIM_FENCE_NEGATIVES.map((n) => n.label);
    expect(labels).toContain("anchor-drop");
    expect(labels).toContain("trailing-space-drop");
    // Additive to what shipped — the one-byte rewording is not traded away for
    // the two new arms.
    expect(labels.length).toBeGreaterThanOrEqual(3);
    expect(new Set(labels).size).toBe(labels.length);
  });

  test("each widening is EXACTLY the widening its label names, on the shipped pattern", () => {
    // The labels are a contract, so they are checked against the bytes rather
    // than trusted. A "trailing-space-drop" that in fact dropped the anchor
    // would score identically in every behavioural arm below, and the FR would
    // ship with one of its two criteria unguarded.
    const fences = group10Fences();
    const anchorDrop = CLAIM_FENCE_NEGATIVES.find((n) => n.label === "anchor-drop")!;
    const spaceDrop = CLAIM_FENCE_NEGATIVES.find((n) => n.label === "trailing-space-drop")!;
    for (const idx of CLAIM_FENCE_INDICES) {
      const fence = fences[idx]!;
      const shipped = grepPattern(fence);
      expect({ idx, anchored: shipped.startsWith("^") }).toEqual({ idx, anchored: true });
      expect({ idx, spaceTerminated: shipped.endsWith(" ") }).toEqual({
        idx,
        spaceTerminated: true,
      });
      expect(grepPattern(anchorDrop.widen(fence))).toBe(shipped.slice(1));
      expect(grepPattern(spaceDrop.widen(fence))).toBe(shipped.slice(0, -1));
    }
  });

  test("EXECUTED: every negative subject is REJECTED by both shipped fences", async () => {
    // Each arm stages its own tree, because the discriminating subject is built
    // from that fixture's own minted id and branch.
    for (const negative of CLAIM_FENCE_NEGATIVES) {
      const f = buildFixture();
      try {
        await claim(f);
        const subject = negative.subject(f.frId, f.branch);
        git(f.root, "commit", "--quiet", "--amend", "-m", subject);
        expect(git(f.root, "log", "--format=%s", "-1")).toBe(subject); // applied
        const fences = group10Fences();
        for (const idx of CLAIM_FENCE_INDICES) {
          expect({
            label: negative.label,
            fence: idx,
            found: witnessFound(f, idx, fences[idx]!),
          }).toEqual({ label: negative.label, fence: idx, found: false });
        }
      } finally {
        cleanup(f);
      }
    }
  });

  test("EXECUTED: each negative subject is ACCEPTED once its widening is applied", async () => {
    // THE FALSIFIABILITY ARM, and the reason this FR exists. Without it a
    // "negative" is only a subject nothing matches, which is exactly what the
    // shipped one-byte rewording turned out to be with respect to `^` and the
    // trailing space.
    for (const negative of CLAIM_FENCE_NEGATIVES) {
      const f = buildFixture();
      try {
        await claim(f);
        const subject = negative.subject(f.frId, f.branch);
        git(f.root, "commit", "--quiet", "--amend", "-m", subject);
        const fences = group10Fences();
        for (const idx of CLAIM_FENCE_INDICES) {
          const widened = negative.widen(fences[idx]!);
          expect({ label: negative.label, fence: idx, applied: widened !== fences[idx]! }).toEqual({
            label: negative.label,
            fence: idx,
            applied: true,
          });
          expect({
            label: negative.label,
            fence: idx,
            found: witnessFound(f, idx, widened),
          }).toEqual({ label: negative.label, fence: idx, found: true });
        }
      } finally {
        cleanup(f);
      }
    }
  });
});

// ═══════════════ AC-STE-460.3 — the strengthening does not overshoot ═════════

describeIfSkills("AC-STE-460.3 — no strengthened negative turns a healthy run RED", () => {
  test("EXECUTED: the real claimLock subject is still ACCEPTED by both shipped fences", async () => {
    const f = buildFixture();
    try {
      await claim(f);
      expect(git(f.root, "log", "--format=%s", "-1")).toBe(
        `chore(locks): claim lock for ${f.frId} on ${f.branch}`,
      );
      for (const idx of CLAIM_FENCE_INDICES) {
        expect({ fence: idx, found: witnessFound(f, idx, group10Fences()[idx]!) }).toEqual({
          fence: idx,
          found: true,
        });
      }
    } finally {
      cleanup(f);
    }
  });

  test("EXECUTED: no negative subject collides with the healthy one", async () => {
    // The overshoot the table itself could introduce: a "negative" subject that
    // is in fact the healthy subject would make the rejection arm above assert
    // that a HEALTHY run is unwitnessed — a false RED wearing a green label.
    const f = buildFixture();
    try {
      await claim(f);
      const healthy = git(f.root, "log", "--format=%s", "-1");
      for (const negative of CLAIM_FENCE_NEGATIVES) {
        expect({
          label: negative.label,
          isHealthy: negative.subject(f.frId, f.branch) === healthy,
        }).toEqual({ label: negative.label, isHealthy: false });
      }
    } finally {
      cleanup(f);
    }
  });

  test("EXECUTED: every widening really is a WIDENING — the healthy subject still matches", async () => {
    // If a "widening" rejected the healthy subject it would be a rewrite, and
    // the flip measured in AC.1/.2 would say nothing about the shipped pattern's
    // `^` or its trailing space.
    const f = buildFixture();
    try {
      await claim(f);
      const fences = group10Fences();
      for (const negative of CLAIM_FENCE_NEGATIVES) {
        for (const idx of CLAIM_FENCE_INDICES) {
          expect({
            label: negative.label,
            fence: idx,
            found: witnessFound(f, idx, negative.widen(fences[idx]!)),
          }).toEqual({ label: negative.label, fence: idx, found: true });
        }
      }
    } finally {
      cleanup(f);
    }
  });

  test("the shipped negative is WIRED to the table, not a private second copy", () => {
    // STE-451's correction #40 applied to the surface this FR creates: two
    // private copies of a guard list mean editing one leaves the other green.
    //
    // STATED LIMIT, because this milestone punishes pins that overstate what
    // they see: this is source text, and source text cannot tell "imported"
    // from "imported and iterated". The behavioural arms above are what prove
    // the table is right; this only stops the table becoming a second, unread
    // definition beside a surviving inline copy.
    const suite = read(SUITE_456);
    expect(suite).not.toBeNull();
    expect(suite!).toContain("./_claim-fence-negatives");
    expect(suite!).toContain("CLAIM_FENCE_NEGATIVES");
    expect(suite!).not.toContain('original.replace("claim lock", "claim Lock")');
  });
});
