// Tests for requireCommittableBranch + findFreeBranchName (STE-228).
//
// Covers:
//   AC-STE-228.1 — helper signature, outcomes, git side-effects
//   AC-STE-228.2 — TRUNK_OK_TYPES = ["ci"]
//   AC-STE-228.3 — PROTECTED_TRUNKS = ["main", "master"]
//   AC-STE-228.5 — gate prompt UX (Y / e / n)
//   AC-STE-228.6 — silent no-op when current branch is non-protected
//   AC-STE-228.7 — auto-mode default-apply
//   AC-STE-228.10 — staging rollback on n decline
//   AC-STE-228.11 — collision-suffix probe (local + remote, fallback, length cap)

import { describe, expect, test } from "bun:test";
import {
  CommitGateError,
  findFreeBranchName,
  PROTECTED_TRUNKS,
  requireCommittableBranch,
  TRUNK_OK_TYPES,
  type GateDeps,
  type RequireCommittableBranchOpts,
} from "./require_committable_branch";

// -----------------------------------------------------------------------------
// Test scaffolding
// -----------------------------------------------------------------------------

interface FakeGit {
  /** Branch names that exist locally. */
  localBranches: Set<string>;
  /** Branch names that exist on remote `origin`. */
  remoteBranches: Set<string>;
  /** When true, remote-probe throws — fallback path exercised. */
  remoteProbeFails: boolean;
  /** Recorded `git checkout -b <name>` calls. */
  checkoutCalls: string[];
}

function makeFakeGit(overrides: Partial<FakeGit> = {}): FakeGit {
  return {
    localBranches: new Set(),
    remoteBranches: new Set(),
    remoteProbeFails: false,
    checkoutCalls: [],
    ...overrides,
  };
}

function makeDeps(
  fake: FakeGit,
  promptResponses: string[] = [],
): GateDeps & { promptCalls: string[]; rollbackCalls: string[][] } {
  const promptQueue = [...promptResponses];
  const promptCalls: string[] = [];
  const rollbackCalls: string[][] = [];
  return {
    branchExistsLocally(name: string): boolean {
      return fake.localBranches.has(name);
    },
    branchExistsRemotely(name: string): boolean {
      if (fake.remoteProbeFails) {
        throw new Error("remote probe failed");
      }
      return fake.remoteBranches.has(name);
    },
    checkoutNewBranch(name: string): void {
      fake.checkoutCalls.push(name);
      fake.localBranches.add(name);
    },
    prompt(message: string): string {
      promptCalls.push(message);
      const next = promptQueue.shift();
      if (next === undefined) {
        throw new Error(`prompt called more than expected: ${message}`);
      }
      return next;
    },
    rollbackStaging(paths: string[]): void {
      rollbackCalls.push(paths);
    },
    promptCalls,
    rollbackCalls,
  };
}

function defaultOpts(
  overrides: Partial<RequireCommittableBranchOpts> = {},
): RequireCommittableBranchOpts {
  return {
    commitType: "feat",
    proposedBranchName: "feat/m61-add-gate",
    currentBranch: "main",
    isAutoMode: false,
    stagedPaths: [],
    ...overrides,
  };
}

// -----------------------------------------------------------------------------
// Constants (AC-STE-228.2, AC-STE-228.3)
// -----------------------------------------------------------------------------

describe("constants — AC-STE-228.2 / AC-STE-228.3", () => {
  test("TRUNK_OK_TYPES is exactly ['ci']", () => {
    expect([...TRUNK_OK_TYPES]).toEqual(["ci"]);
  });

  test("TRUNK_OK_TYPES does NOT include 'chore' (was removed)", () => {
    expect(TRUNK_OK_TYPES).not.toContain("chore");
  });

  test("TRUNK_OK_TYPES does NOT include 'docs' (was removed)", () => {
    expect(TRUNK_OK_TYPES).not.toContain("docs");
  });

  test("PROTECTED_TRUNKS is exactly ['main', 'master']", () => {
    expect([...PROTECTED_TRUNKS]).toEqual(["main", "master"]);
  });
});

// -----------------------------------------------------------------------------
// AC-STE-228.6 — silent no-op on non-protected branch
// -----------------------------------------------------------------------------

describe("requireCommittableBranch — non-protected branch is silent no-op (AC-STE-228.6)", () => {
  test("on feat/foo with feat type → no-op, no git side effects, no prompt", () => {
    const fake = makeFakeGit();
    const deps = makeDeps(fake);
    const result = requireCommittableBranch(
      defaultOpts({ currentBranch: "feat/foo" }),
      deps,
    );
    expect(result.outcome).toBe("no-op");
    expect(fake.checkoutCalls).toEqual([]);
    expect(deps.promptCalls).toEqual([]);
  });

  test("on develop branch with chore type → no-op", () => {
    const fake = makeFakeGit();
    const deps = makeDeps(fake);
    const result = requireCommittableBranch(
      defaultOpts({ currentBranch: "develop", commitType: "chore" }),
      deps,
    );
    expect(result.outcome).toBe("no-op");
    expect(fake.checkoutCalls).toEqual([]);
  });

  test("on release/v1.0.0 branch with docs type → no-op", () => {
    const fake = makeFakeGit();
    const deps = makeDeps(fake);
    const result = requireCommittableBranch(
      defaultOpts({ currentBranch: "release/v1.0.0", commitType: "docs" }),
      deps,
    );
    expect(result.outcome).toBe("no-op");
  });

  test("on trunk (non-protected name) with feat type → no-op", () => {
    // 'trunk' is intentionally NOT in PROTECTED_TRUNKS per AC-STE-228.3.
    const fake = makeFakeGit();
    const deps = makeDeps(fake);
    const result = requireCommittableBranch(
      defaultOpts({ currentBranch: "trunk" }),
      deps,
    );
    expect(result.outcome).toBe("no-op");
  });
});

// -----------------------------------------------------------------------------
// AC-STE-228.3 — both 'main' and 'master' trigger the gate
// -----------------------------------------------------------------------------

describe("requireCommittableBranch — protected trunks (AC-STE-228.3)", () => {
  test("on main + non-trunk-OK type → gate fires (prompt invoked)", () => {
    const fake = makeFakeGit();
    const deps = makeDeps(fake, ["Y"]);
    const result = requireCommittableBranch(
      defaultOpts({ currentBranch: "main", commitType: "feat" }),
      deps,
    );
    expect(result.outcome).toBe("created");
    expect(deps.promptCalls.length).toBeGreaterThan(0);
  });

  test("on master + non-trunk-OK type → gate fires (prompt invoked)", () => {
    const fake = makeFakeGit();
    const deps = makeDeps(fake, ["Y"]);
    const result = requireCommittableBranch(
      defaultOpts({ currentBranch: "master", commitType: "feat" }),
      deps,
    );
    expect(result.outcome).toBe("created");
    expect(deps.promptCalls.length).toBeGreaterThan(0);
  });
});

// -----------------------------------------------------------------------------
// AC-STE-228.2 — trunk-OK type bypasses the gate even on main
// -----------------------------------------------------------------------------

describe("requireCommittableBranch — trunk-OK type bypass (AC-STE-228.2)", () => {
  test("on main + ci type → no-op, no git side effects", () => {
    const fake = makeFakeGit();
    const deps = makeDeps(fake);
    const result = requireCommittableBranch(
      defaultOpts({ currentBranch: "main", commitType: "ci" }),
      deps,
    );
    expect(result.outcome).toBe("no-op");
    expect(fake.checkoutCalls).toEqual([]);
    expect(deps.promptCalls).toEqual([]);
  });

  test("on main + chore type → gate FIRES (chore is no longer trunk-OK)", () => {
    const fake = makeFakeGit();
    const deps = makeDeps(fake, ["Y"]);
    const result = requireCommittableBranch(
      defaultOpts({ currentBranch: "main", commitType: "chore" }),
      deps,
    );
    expect(result.outcome).toBe("created");
    expect(fake.checkoutCalls).toEqual(["feat/m61-add-gate"]);
  });

  test("on main + docs type → gate FIRES (docs is no longer trunk-OK)", () => {
    const fake = makeFakeGit();
    const deps = makeDeps(fake, ["Y"]);
    const result = requireCommittableBranch(
      defaultOpts({ currentBranch: "main", commitType: "docs" }),
      deps,
    );
    expect(result.outcome).toBe("created");
    expect(fake.checkoutCalls).toEqual(["feat/m61-add-gate"]);
  });
});

// -----------------------------------------------------------------------------
// AC-STE-228.5 — interactive prompt UX (Y / e / n)
// -----------------------------------------------------------------------------

describe("requireCommittableBranch — interactive prompt (AC-STE-228.5)", () => {
  test("response 'Y' → outcome 'created', git checkout -b called once with proposed name", () => {
    const fake = makeFakeGit();
    const deps = makeDeps(fake, ["Y"]);
    const result = requireCommittableBranch(
      defaultOpts({ proposedBranchName: "feat/m61-add-gate" }),
      deps,
    );
    expect(result.outcome).toBe("created");
    expect(result.branchName).toBe("feat/m61-add-gate");
    expect(fake.checkoutCalls).toEqual(["feat/m61-add-gate"]);
  });

  test("prompt message displays the FINAL branch name (after collision probe)", () => {
    // AC-STE-228.5 — "the prompt always shows the **final** name the gate
    // will use after collision probe — no surprise rename between Y and
    // git checkout -b."
    const fake = makeFakeGit({
      localBranches: new Set(["feat/m61-add-gate"]),
    });
    const deps = makeDeps(fake, ["Y"]);
    requireCommittableBranch(
      defaultOpts({ proposedBranchName: "feat/m61-add-gate" }),
      deps,
    );
    expect(deps.promptCalls.length).toBeGreaterThan(0);
    const firstPrompt = deps.promptCalls[0]!;
    expect(firstPrompt).toContain("feat/m61-add-gate-2");
    expect(fake.checkoutCalls).toEqual(["feat/m61-add-gate-2"]);
  });

  test("response 'n' → outcome 'declined', no git checkout, no commit side effects", () => {
    const fake = makeFakeGit();
    const deps = makeDeps(fake, ["n"]);
    const result = requireCommittableBranch(defaultOpts(), deps);
    expect(result.outcome).toBe("declined");
    expect(fake.checkoutCalls).toEqual([]);
  });

  test("response 'e' then valid edited name → outcome 'edited' with operator name", () => {
    const fake = makeFakeGit();
    const deps = makeDeps(fake, ["e", "feat/custom-branch"]);
    const result = requireCommittableBranch(defaultOpts(), deps);
    expect(result.outcome).toBe("edited");
    expect(result.branchName).toBe("feat/custom-branch");
    expect(fake.checkoutCalls).toEqual(["feat/custom-branch"]);
  });

  test("response 'e' then invalid pattern → re-prompts for a name; eventually accepts valid", () => {
    // Edited names must match `^[a-z][a-z0-9._/-]*$`. 'BadName' (capital) fails;
    // 'good/name' passes.
    const fake = makeFakeGit();
    const deps = makeDeps(fake, ["e", "BadName", "good/name"]);
    const result = requireCommittableBranch(defaultOpts(), deps);
    expect(result.outcome).toBe("edited");
    expect(result.branchName).toBe("good/name");
    expect(fake.checkoutCalls).toEqual(["good/name"]);
  });

  test("response 'e' then a protected name ('main') is rejected; re-prompts", () => {
    const fake = makeFakeGit();
    const deps = makeDeps(fake, ["e", "main", "feat/safe"]);
    const result = requireCommittableBranch(defaultOpts(), deps);
    expect(result.outcome).toBe("edited");
    expect(result.branchName).toBe("feat/safe");
  });

  test("response 'e' then existing branch name is rejected; re-prompts", () => {
    const fake = makeFakeGit({ localBranches: new Set(["feat/already-here"]) });
    const deps = makeDeps(fake, ["e", "feat/already-here", "feat/fresh"]);
    const result = requireCommittableBranch(defaultOpts(), deps);
    expect(result.outcome).toBe("edited");
    expect(result.branchName).toBe("feat/fresh");
  });
});

// -----------------------------------------------------------------------------
// AC-STE-228.7 — auto-mode default-apply
// -----------------------------------------------------------------------------

describe("requireCommittableBranch — auto-mode default-apply (AC-STE-228.7)", () => {
  test("isAutoMode=true on main + feat → auto-creates branch, no prompt invoked", () => {
    const fake = makeFakeGit();
    const deps = makeDeps(fake, []); // no prompt responses prepared
    const result = requireCommittableBranch(
      defaultOpts({ isAutoMode: true, proposedBranchName: "feat/m61-add-gate" }),
      deps,
    );
    expect(result.outcome).toBe("created");
    expect(result.branchName).toBe("feat/m61-add-gate");
    expect(fake.checkoutCalls).toEqual(["feat/m61-add-gate"]);
    expect(deps.promptCalls).toEqual([]);
  });

  test("auto-mode result signals `branch_gate_default_applied` capability", () => {
    // The closing summary must surface a `branch_gate_default_applied`
    // capability row per AC-STE-228.8. The result must therefore expose
    // a flag the caller can branch on.
    const fake = makeFakeGit();
    const deps = makeDeps(fake, []);
    const result = requireCommittableBranch(
      defaultOpts({ isAutoMode: true }),
      deps,
    );
    expect(result.defaultApplied).toBe(true);
  });

  test("interactive Y does NOT signal defaultApplied", () => {
    const fake = makeFakeGit();
    const deps = makeDeps(fake, ["Y"]);
    const result = requireCommittableBranch(defaultOpts(), deps);
    expect(result.defaultApplied).toBeFalsy();
  });
});

// -----------------------------------------------------------------------------
// AC-STE-228.10 — staging rollback on decline
// -----------------------------------------------------------------------------

describe("requireCommittableBranch — staging rollback on decline (AC-STE-228.10)", () => {
  test("'n' decline calls rollback with the explicit staged paths", () => {
    const fake = makeFakeGit();
    const deps = makeDeps(fake, ["n"]);
    const stagedPaths = ["specs/frs/STE-228.md", "CHANGELOG.md"];
    const result = requireCommittableBranch(
      defaultOpts({ stagedPaths }),
      deps,
    );
    expect(result.outcome).toBe("declined");
    expect(deps.rollbackCalls).toEqual([stagedPaths]);
  });

  test("'n' decline with empty stagedPaths → no rollback call (nothing to undo)", () => {
    const fake = makeFakeGit();
    const deps = makeDeps(fake, ["n"]);
    requireCommittableBranch(defaultOpts({ stagedPaths: [] }), deps);
    expect(deps.rollbackCalls).toEqual([]);
  });

  test("'Y' accept does NOT trigger rollback", () => {
    const fake = makeFakeGit();
    const deps = makeDeps(fake, ["Y"]);
    requireCommittableBranch(
      defaultOpts({ stagedPaths: ["a.md", "b.md"] }),
      deps,
    );
    expect(deps.rollbackCalls).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
// findFreeBranchName — collision-suffix probe (AC-STE-228.11)
// -----------------------------------------------------------------------------

describe("findFreeBranchName — clean path (AC-STE-228.11)", () => {
  test("name unique locally and remotely → returns it unchanged with suffixApplied=0", () => {
    const fake = makeFakeGit();
    const deps = makeDeps(fake);
    const result = findFreeBranchName("feat/m61-add-gate", deps);
    expect(result.name).toBe("feat/m61-add-gate");
    expect(result.suffixApplied).toBe(0);
    expect(result.remoteProbeSkipped).toBeFalsy();
  });
});

describe("findFreeBranchName — local collision (AC-STE-228.11)", () => {
  test("local collision only → returns name-2 with suffixApplied=2", () => {
    const fake = makeFakeGit({
      localBranches: new Set(["feat/m61-add-gate"]),
    });
    const deps = makeDeps(fake);
    const result = findFreeBranchName("feat/m61-add-gate", deps);
    expect(result.name).toBe("feat/m61-add-gate-2");
    expect(result.suffixApplied).toBe(2);
  });

  test("local collision on -2 too → returns -3", () => {
    const fake = makeFakeGit({
      localBranches: new Set([
        "feat/m61-add-gate",
        "feat/m61-add-gate-2",
      ]),
    });
    const deps = makeDeps(fake);
    const result = findFreeBranchName("feat/m61-add-gate", deps);
    expect(result.name).toBe("feat/m61-add-gate-3");
    expect(result.suffixApplied).toBe(3);
  });
});

describe("findFreeBranchName — remote collision (AC-STE-228.11)", () => {
  test("remote collision only → returns -2", () => {
    const fake = makeFakeGit({
      remoteBranches: new Set(["feat/m61-add-gate"]),
    });
    const deps = makeDeps(fake);
    const result = findFreeBranchName("feat/m61-add-gate", deps);
    expect(result.name).toBe("feat/m61-add-gate-2");
    expect(result.suffixApplied).toBe(2);
  });

  test("local + remote collision (proposed AND -2) → returns -3", () => {
    const fake = makeFakeGit({
      localBranches: new Set(["feat/m61-add-gate-2"]),
      remoteBranches: new Set(["feat/m61-add-gate"]),
    });
    const deps = makeDeps(fake);
    const result = findFreeBranchName("feat/m61-add-gate", deps);
    expect(result.name).toBe("feat/m61-add-gate-3");
    expect(result.suffixApplied).toBe(3);
  });
});

describe("findFreeBranchName — remote-probe failure fallback (AC-STE-228.11)", () => {
  test("remote probe throws → falls back to local-only check, returns remoteProbeSkipped=true", () => {
    const fake = makeFakeGit({ remoteProbeFails: true });
    const deps = makeDeps(fake);
    const result = findFreeBranchName("feat/m61-add-gate", deps);
    expect(result.name).toBe("feat/m61-add-gate");
    expect(result.suffixApplied).toBe(0);
    expect(result.remoteProbeSkipped).toBe(true);
  });

  test("remote-probe failure + local collision → still increments suffix locally", () => {
    const fake = makeFakeGit({
      remoteProbeFails: true,
      localBranches: new Set(["feat/m61-add-gate"]),
    });
    const deps = makeDeps(fake);
    const result = findFreeBranchName("feat/m61-add-gate", deps);
    expect(result.name).toBe("feat/m61-add-gate-2");
    expect(result.suffixApplied).toBe(2);
    expect(result.remoteProbeSkipped).toBe(true);
  });
});

describe("findFreeBranchName — 60-char length cap (AC-STE-228.11)", () => {
  test("suffix that fits within 60-char cap is appended cleanly", () => {
    const fake = makeFakeGit({
      localBranches: new Set(["feat/short"]),
    });
    const deps = makeDeps(fake);
    const result = findFreeBranchName("feat/short", deps);
    expect(result.name).toBe("feat/short-2");
    expect(result.name.length).toBeLessThanOrEqual(60);
  });

  test("suffix needed AND base already at 60 chars → slug truncated to make room", () => {
    // Base is exactly 60 chars; appending '-2' would overshoot, so the
    // slug-bearing suffix must be truncated. Result must still be <= 60.
    const sixtyCharBase = "feat/" + "a".repeat(55); // 5 + 55 = 60
    const fake = makeFakeGit({
      localBranches: new Set([sixtyCharBase]),
    });
    const deps = makeDeps(fake);
    const result = findFreeBranchName(sixtyCharBase, deps);
    expect(result.name.length).toBeLessThanOrEqual(60);
    expect(result.name.endsWith("-2")).toBe(true);
    expect(result.name.endsWith("--2")).toBe(false); // no double-hyphen
  });

  test("name where truncation would leave a trailing-hyphen branch raises CommitGateError", () => {
    // If truncation forces the slug to a hyphen-only / trailing-hyphen
    // tail, the gate must refuse rather than ship a malformed branch
    // like `prefix/-2`.
    //
    // Construct a 60-char base whose final slug character is `-a`; when
    // the suffix `-2` (2 chars) is appended, truncation eats `-a`,
    // leaving `prefix/x...x-` which ends in a hyphen.
    const trickyBase = "feat/" + "x".repeat(54) + "-a"; // 60 chars, ends `-a`
    const fake = makeFakeGit({ localBranches: new Set([trickyBase]) });
    const deps = makeDeps(fake);
    expect(() => findFreeBranchName(trickyBase, deps)).toThrow(CommitGateError);
  });
});

// -----------------------------------------------------------------------------
// AC-STE-228.1 — return shape contract
// -----------------------------------------------------------------------------

describe("requireCommittableBranch — return shape (AC-STE-228.1)", () => {
  test("no-op outcome carries no branchName", () => {
    const fake = makeFakeGit();
    const deps = makeDeps(fake);
    const result = requireCommittableBranch(
      defaultOpts({ currentBranch: "feat/foo" }),
      deps,
    );
    expect(result.outcome).toBe("no-op");
    expect(result.branchName).toBeUndefined();
  });

  test("created outcome carries the final branchName", () => {
    const fake = makeFakeGit();
    const deps = makeDeps(fake, ["Y"]);
    const result = requireCommittableBranch(
      defaultOpts({ proposedBranchName: "feat/x" }),
      deps,
    );
    expect(result.outcome).toBe("created");
    expect(result.branchName).toBe("feat/x");
  });

  test("declined outcome carries no branchName", () => {
    const fake = makeFakeGit();
    const deps = makeDeps(fake, ["n"]);
    const result = requireCommittableBranch(defaultOpts(), deps);
    expect(result.outcome).toBe("declined");
    expect(result.branchName).toBeUndefined();
  });
});
