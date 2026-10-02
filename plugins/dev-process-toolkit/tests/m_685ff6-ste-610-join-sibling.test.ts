// STE-610 (M_685ff6) — AC-STE-610.4: the join names its sibling.
//
// In a repository whose binding is shared, the STE-608 decision front door
//
//   bun run adapters/_shared/src/resolve_milestone_identity.ts \
//     <projectRoot> <mode> <project> <listingFile> --join-key <k> | --title <t> [--sibling <path>]
//
// decides a join only when `--sibling <path>` is given. It runs AC-STE-610.1's
// checks as a DRY RUN (the sibling's plan may sit on any worktree, local branch
// or remote-tracking ref), writes nothing into either plan, and puts the
// sibling's tag and path into the `gate=` sentence. A join decided without
// `--sibling` exits 1 naming the key and the two ways forward. An unshared
// repository decides exactly as STE-608 did.
//
// Real git roots (GIT_ENV); the listing is a raw Jira Epic search page.

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { receiptsDir } from "../adapters/_shared/src/dpt_paths";
import { claudeMd } from "./_span_fixture";
import { describeRun, type Run } from "./_sibling_state_fixture";
import {
  DECISION_DOOR,
  SESSION,
  TAG_B,
  commitAll,
  git,
  makeDeclarePair,
  sharedClaudeMd,
  snapshotObject,
  spawnDoor,
  type DeclarePair,
} from "./_span_declare_fixture";

const PROJECT = "GF";
const KEY = "GF-609";
const MILESTONE = "M_GF_609";
const TITLE = "Honest join";

function writeListing(dir: string): string {
  const p = join(dir, "listing.json");
  writeFileSync(
    p,
    JSON.stringify({
      issues: [
        {
          key: KEY,
          fields: {
            summary: TITLE,
            project: { key: PROJECT },
            issuetype: { name: "Epic" },
            status: { name: "In Progress", statusCategory: { key: "indeterminate" } },
            labels: [`milestone-${MILESTONE}`],
          },
        },
      ],
      isLast: true,
    }),
  );
  return p;
}

interface JoinTree extends DeclarePair {
  listing: string;
  extra: string[];
}

async function withJoin<T>(
  body: (t: JoinTree) => Promise<T> | T,
  opts: { shared?: boolean } = {},
): Promise<T> {
  const p = makeDeclarePair(MILESTONE, { mode: "jira", project: PROJECT });
  const extra: string[] = [];
  try {
    if (opts.shared === false) claudeMd(p.a, { mode: "jira", project: PROJECT });
    const dir = mkdtempSync(join(tmpdir(), "dpt-610-listing-"));
    extra.push(dir);
    return await body({ ...p, listing: writeListing(dir), extra });
  } finally {
    try {
      p.cleanup();
    } finally {
      for (const d of extra) rmSync(d, { recursive: true, force: true });
    }
  }
}

const door = (t: JoinTree, ...rest: string[]): Run =>
  spawnDoor(DECISION_DOOR, [t.a, "jira", PROJECT, t.listing, ...rest]);

function fields(r: Run): Map<string, string> {
  expect(r.status, describeRun(r)).toBe(0);
  const m = new Map<string, string>();
  for (const line of r.stdout.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0 && !line.startsWith("dpt-receipt")) m.set(line.slice(0, i), line.slice(i + 1));
  }
  return m;
}

function receipts(root: string): string[] {
  const dir = receiptsDir(root, SESSION);
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")) : [];
}

/** Any spelling of the sibling's path the gate sentence may carry. */
function pathSpellings(t: JoinTree): string[] {
  const real = (p: string): string => realpathSync(p);
  return [t.b, real(t.b), relative(t.a, t.b), relative(real(t.a), real(t.b))];
}

function expectRefusal(r: Run, root: string, ...needles: Array<string | RegExp>): void {
  expect(r.status, describeRun(r)).toBe(1);
  expect(r.stdout, describeRun(r)).toBe("");
  expect(r.stderr, describeRun(r)).toMatch(/^Remedy: /m);
  expect(r.stderr, describeRun(r)).toMatch(/^Context: /m);
  for (const n of needles) {
    if (typeof n === "string") expect(r.stderr, describeRun(r)).toContain(n);
    else expect(r.stderr, describeRun(r)).toMatch(n);
  }
  expect(receipts(root), "a refused decision wrote a receipt").toEqual([]);
}

describe("AC-STE-610.4 — in a shared repository a join names its sibling", () => {
  test("--join-key with --sibling decides the join, puts the sibling's tag and path into gate=, and writes nothing into either plan", async () => {
    await withJoin((t) => {
      const beforeA = snapshotObject(t.a);
      const beforeB = snapshotObject(t.b);
      const f = fields(door(t, "--join-key", KEY, "--sibling", t.b));
      expect(f.get("act")).toBe("join");
      expect(f.get("key")).toBe(KEY);
      expect(f.get("milestoneId")).toBe(MILESTONE);
      const gate = f.get("gate") ?? "";
      expect(gate).toContain(TAG_B);
      expect(
        pathSpellings(t).some((s) => gate.includes(s)),
        `gate= names no spelling of the sibling path: ${gate}`,
      ).toBe(true);
      expect(snapshotObject(t.a), "the dry run wrote into the invoking repository").toEqual(beforeA);
      expect(snapshotObject(t.b), "the dry run wrote into the sibling").toEqual(beforeB);
    });
  }, 30_000);

  test("the dry run stops at the git-state reader: a sibling plan held only on a branch still decides the join", async () => {
    await withJoin((t) => {
      git(t.b, "checkout", "-q", "-b", "plan-only-610");
      commitAll(t.b, "fixture: plan on a branch");
      git(t.b, "checkout", "-q", "main");
      git(t.b, "rm", "-q", join("specs", "plan", `${MILESTONE}.md`));
      commitAll(t.b, "fixture: main holds no plan");
      const f = fields(door(t, "--join-key", KEY, "--sibling", t.b));
      expect(f.get("act")).toBe("join");
      expect(f.get("gate") ?? "").toContain(TAG_B);
    });
  }, 30_000);

  test("a join by key without --sibling exits 1, naming the key and both ways forward, and writes no receipt", async () => {
    await withJoin((t) => {
      expectRefusal(door(t, "--join-key", KEY), t.a, KEY, "--sibling", /title/i);
    });
  }, 30_000);

  test("a join by title without --sibling exits 1, naming the key and both ways forward", async () => {
    await withJoin((t) => {
      expectRefusal(door(t, "--title", TITLE), t.a, KEY, "--sibling", /title/i);
    });
  }, 30_000);

  test("the dry run refuses a sibling holding no plan for the milestone, naming the plan, and writes no receipt", async () => {
    await withJoin((t) => {
      git(t.b, "rm", "-q", join("specs", "plan", `${MILESTONE}.md`));
      commitAll(t.b, "fixture: B has no plan");
      expectRefusal(door(t, "--join-key", KEY, "--sibling", t.b), t.a, /plan/i, MILESTONE);
    });
  }, 30_000);

  test("the dry run refuses a sibling that is not a git repository", async () => {
    await withJoin((t) => {
      const plain = mkdtempSync(join(tmpdir(), "dpt-610-plain-"));
      t.extra.push(plain);
      sharedClaudeMd(plain, TAG_B, { mode: "jira", project: PROJECT });
      expectRefusal(door(t, "--join-key", KEY, "--sibling", plain), t.a, /git repositor/i);
    });
  }, 30_000);

  test("the dry run refuses a sibling that is the invoking repository itself", async () => {
    await withJoin((t) => {
      expectRefusal(door(t, "--join-key", KEY, "--sibling", t.a), t.a, /same repositor/i);
    });
  }, 30_000);

  test("(control) a create needs no sibling in a shared repository", async () => {
    await withJoin((t) => {
      const f = fields(door(t, "--title", "A brand new milestone"));
      expect(f.get("act")).toBe("create");
    });
  }, 30_000);

  test("(control) an unshared repository decides a join exactly as STE-608 did, with no --sibling", async () => {
    await withJoin(
      (t) => {
        const r = door(t, "--join-key", KEY);
        expect(r.status, describeRun(r)).toBe(0);
        const printed = r.stdout.split("\n").filter((l) => l !== "" && !l.startsWith("dpt-receipt"));
        expect(printed).toEqual([
          "act=join",
          "via=key",
          `key=${KEY}`,
          `milestoneId=${MILESTONE}`,
          "listing=1 rows, 0 closed excluded",
          `gate=join the existing Epic ${KEY} "${TITLE}" (status In Progress) in project ${PROJECT} via key; nothing is created.`,
          "default=allowed",
          "labels=unchanged",
        ]);
      },
      { shared: false },
    );
  }, 30_000);
});

// Orchestrator addition (AC-STE-608.6 ∘ AC-STE-610.4): a shared title join that
// names its sibling still has no safe default. The STE-608 front-door leg that
// graded `default=forbidden` without `--sibling` now refuses first, so the
// forbidden default is graded here, on the form that reaches it.
describe("AC-STE-610.4 — a shared title join with --sibling keeps default=forbidden", () => {
  test("title join + --sibling in a shared repository → act=join, via=title, default=forbidden", async () => {
    await withJoin((t) => {
      const f = fields(door(t, "--title", TITLE, "--sibling", t.b));
      expect(f.get("act")).toBe("join");
      expect(f.get("via")).toBe("title");
      expect(f.get("default")).toBe("forbidden");
      // AC-STE-643.6 — a forbidden default prints the consent options and
      // records the same labels in the receipt's evidence.
      const labels = [`Join \`${KEY}\``, `Skip \`${KEY}\``];
      expect(f.get("options")).toBe(JSON.stringify(labels));
      const files = receipts(t.a);
      expect(files.length).toBe(1);
      const receipt = JSON.parse(readFileSync(join(receiptsDir(t.a, SESSION), files[0]!), "utf-8")) as { evidence: Record<string, unknown> };
      expect(receipt.evidence.options).toEqual(labels);
    });
  }, 30_000);

  test("(control) key join + --sibling in a shared repository → default=allowed", async () => {
    await withJoin((t) => {
      const f = fields(door(t, "--join-key", KEY, "--sibling", t.b));
      expect(f.get("default")).toBe("allowed");
      // AC-STE-643.6 control — no `options=` beside `default=allowed`.
      expect(f.has("options")).toBe(false);
      const receipt = JSON.parse(readFileSync(join(receiptsDir(t.a, SESSION), receipts(t.a)[0]!), "utf-8")) as { evidence: Record<string, unknown> };
      expect("options" in receipt.evidence).toBe(false);
    });
  }, 30_000);
});

// ===========================================================================
// STE-651 (M_a85e46) — the join names WHERE it found the sibling's plan:
// in its gate= line and in the receipt's evidence.sibling.planSource.
// ===========================================================================

/** The one milestone-decision receipt the join wrote, parsed. */
function onlyReceipt(root: string): { evidence: Record<string, unknown> } {
  const files = receipts(root);
  expect(files.length, "the join wrote no single receipt").toBe(1);
  return JSON.parse(readFileSync(join(receiptsDir(root, SESSION), files[0]!), "utf-8")) as { evidence: Record<string, unknown> };
}

/** Which of `spellings` the gate line names; fails when none. */
function namedSource(gate: string, spellings: string[]): string {
  const hit = spellings.find((s) => gate.includes(s));
  expect(hit, `gate= names none of ${JSON.stringify(spellings)}: ${gate}`).toBeDefined();
  return hit!;
}

describe("AC-STE-651.11 / AC-STE-651.12 — a shared --sibling join names the sibling plan's source", () => {
  test("AC-STE-651.11 AC-STE-651.12 plan only in a linked worktree of the sibling: gate= names `worktree <wt>`, and the receipt's evidence.sibling.planSource equals it", async () => {
    await withJoin((t) => {
      git(t.b, "rm", "-q", join("specs", "plan", `${MILESTONE}.md`));
      commitAll(t.b, "fixture: main holds no plan");
      const parent = mkdtempSync(join(tmpdir(), "dpt-651-wt-"));
      t.extra.push(parent);
      const wt = join(parent, "b-wt");
      git(t.b, "worktree", "add", "-q", "-b", "plan-wt-651", wt);
      mkdirSync(join(wt, "specs", "plan"), { recursive: true });
      writeFileSync(
        join(wt, "specs", "plan", `${MILESTONE}.md`),
        ["---", `milestone: ${MILESTONE}`, "status: active", "archived_at: null", "shipped_in: null", "---", "", `# ${MILESTONE}`, ""].join("\n"),
      );
      const f = fields(door(t, "--join-key", KEY, "--sibling", t.b));
      expect(f.get("act")).toBe("join");
      const gate = f.get("gate") ?? "";
      const source = namedSource(gate, [`worktree ${wt}`, `worktree ${realpathSync(wt)}`]);
      const sibling = onlyReceipt(t.a).evidence.sibling as Record<string, unknown> | undefined;
      expect(sibling?.planSource).toBe(source);
    });
  }, 30_000);

  test("AC-STE-651.11 AC-STE-651.12 plan in the sibling's main checkout (and also on a branch): the main-worktree copy is named, `worktree <main>`", async () => {
    await withJoin((t) => {
      git(t.b, "branch", "also-holds-plan-651");
      const f = fields(door(t, "--join-key", KEY, "--sibling", t.b));
      const gate = f.get("gate") ?? "";
      const source = namedSource(gate, [`worktree ${t.b}`, `worktree ${realpathSync(t.b)}`]);
      expect(gate).not.toContain("branch also-holds-plan-651");
      expect((onlyReceipt(t.a).evidence.sibling as Record<string, unknown> | undefined)?.planSource).toBe(source);
    });
  }, 30_000);

  test("AC-STE-651.11 AC-STE-651.12 plan only on a local branch: gate= names `branch <name>`, and the receipt carries it", async () => {
    await withJoin((t) => {
      git(t.b, "checkout", "-q", "-b", "plan-only-651");
      commitAll(t.b, "fixture: plan on a branch");
      git(t.b, "checkout", "-q", "main");
      git(t.b, "rm", "-q", join("specs", "plan", `${MILESTONE}.md`));
      commitAll(t.b, "fixture: main holds no plan");
      const f = fields(door(t, "--join-key", KEY, "--sibling", t.b));
      const gate = f.get("gate") ?? "";
      const source = namedSource(gate, ["branch plan-only-651"]);
      expect((onlyReceipt(t.a).evidence.sibling as Record<string, unknown> | undefined)?.planSource).toBe(source);
    });
  }, 30_000);
});

describe("AC-STE-651.13 — an unshared join without --sibling keeps its gate= line byte-identical", () => {
  test("AC-STE-651.13 (control) the unshared join gate is byte-identical to HEAD", async () => {
    await withJoin(
      (t) => {
        const f = fields(door(t, "--join-key", KEY));
        expect(f.get("gate")).toBe(
          `join the existing Epic ${KEY} "${TITLE}" (status In Progress) in project ${PROJECT} via key; nothing is created.`,
        );
        expect("sibling" in onlyReceipt(t.a).evidence).toBe(false);
      },
      { shared: false },
    );
  }, 30_000);
});
