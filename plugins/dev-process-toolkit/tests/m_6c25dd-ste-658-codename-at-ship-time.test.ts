import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPlanCodename } from "../adapters/_shared/src/milestone_codename";
import { stampShipCodename, stampShippedIn } from "../adapters/_shared/src/plan_ship_stamp";

// STE-658 (M_6c25dd) — /ship-milestone reads the codename instead of asking.
//
// AC.1-AC.4 and AC.7 are prose contracts on `skills/ship-milestone/SKILL.md`
// (the skill is plugin-authored; its steps are executed by the model). AC.5
// is driven through the real `release_config.ts` front door — see
// `adapters/_shared/src/release_config.test.ts`. AC.6 targets the function
// that owns the `shipped_in:` stamp today, `stampShippedIn` in
// `adapters/_shared/src/plan_ship_stamp.ts`, which gains an optional third
// argument `{ value, source }` naming the resolved codename and where it came
// from; only `source: "composed"` writes the plan's `codename:` key.

const PLUGIN_ROOT = join(import.meta.dir, "..");
const SKILLS_DIR = join(PLUGIN_ROOT, "skills");
const SHIP_SKILL = join(SKILLS_DIR, "ship-milestone", "SKILL.md");
const RETIRED_PROMPT = "Enter milestone codename";

const skill = (): string => readFileSync(SHIP_SKILL, "utf-8").replace(/\r\n/g, "\n");

/** One `### N.` section of the skill body, up to the next `##`/`###` heading. */
function section(re: RegExp): string {
  const lines = skill().split("\n");
  const start = lines.findIndex((l) => re.test(l));
  expect(start, `no heading matching ${re} in skills/ship-milestone/SKILL.md`).toBeGreaterThanOrEqual(0);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^###?\s/.test(lines[i]!)) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

const step3 = (): string => section(/^###\s+3\./);
const step6 = (): string => section(/^###\s+6\./);
const step7 = (): string => section(/^###\s+7\./);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) out.push(...walk(abs));
    else out.push(abs);
  }
  return out;
}

// ---------------------------------------------------------------------------
// AC-STE-658.1 — step 3 is "Resolve codename", with the three-source precedence
// ---------------------------------------------------------------------------

describe("AC-STE-658.1 — step 3 resolves the codename by precedence", () => {
  test("step 3 is titled `Resolve codename`", () => {
    const heading = skill().split("\n").find((l) => /^###\s+3\./.test(l));
    expect(heading).toMatch(/^###\s+3\.\s+Resolve codename\s*$/);
  });

  test("step 3 names all three sources: --codename, the plan key via the front door, and a composed value", () => {
    const three = step3();
    expect(three).toContain("--codename");
    expect(three).toContain("codename:");
    expect(three).toContain("milestone_codename.ts");
    expect(three).toMatch(/compos/i);
    expect(three).toMatch(/Goal/);
    expect(three).toMatch(/FR titles?/i);
  });

  test("step 3 states the precedence in order: flag, then plan key, then composed", () => {
    const three = step3();
    const flag = three.indexOf("--codename");
    const plan = three.indexOf("milestone_codename.ts");
    const composed = three.search(/compos/i);
    expect(flag).toBeGreaterThanOrEqual(0);
    expect(plan).toBeGreaterThan(flag);
    expect(composed).toBeGreaterThan(plan);
  });

  test("the retired prompt string appears nowhere under skills/", () => {
    const files = walk(SKILLS_DIR);
    // Control: the walk actually reaches the ship-milestone skill.
    expect(files).toContain(SHIP_SKILL);
    const hits = files.filter((f) => readFileSync(f, "utf-8").includes(RETIRED_PROMPT));
    expect(hits).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-658.2 — a valid plan key ships without a question; the flag overrides
// ---------------------------------------------------------------------------

describe("AC-STE-658.2 — plan codename ships as-is; --codename overrides it", () => {
  test("step 3 says a valid plan codename ships with no question", () => {
    const three = step3();
    expect(three).toMatch(/valid/i);
    expect(three).toMatch(/no question|without (a question|asking)|never asks?|not asked/i);
  });

  test("step 3 says --codename overrides the plan's codename", () => {
    const three = step3();
    expect(three).toMatch(/--codename[^\n]*overrid|overrid[^\n]*--codename/i);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-658.3 — bounded compose for a plan with no key
// ---------------------------------------------------------------------------

describe("AC-STE-658.3 — a missing key is composed, checked, recomposed at most once, then refused", () => {
  test("the flag and composed values are checked by RUNNING the front door's --check mode", () => {
    // Phase 3 review: the plan-path door cannot check a value no plan holds,
    // so a sentence naming the in-process validateCodename was not runnable.
    const three = step3();
    expect(three).toContain("bun run ${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/milestone_codename.ts --check");
    expect(three).not.toMatch(/bun run adapters\//);
  });

  test("the composed value is checked through the front door", () => {
    const three = step3();
    expect(three).toMatch(/compos[^\n]*(front door|milestone_codename\.ts)|(front door|milestone_codename\.ts)[^\n]*compos/i);
  });

  test("recompose at most once, then refuse in the NFR-10 shape", () => {
    const three = step3();
    expect(three).toMatch(/recompos/i);
    expect(three).toMatch(/at most once/i);
    expect(three).toMatch(/NFR-10/);
  });

  test("never prompted for, never written as a placeholder", () => {
    const three = step3();
    expect(three).toMatch(/never (be )?prompt|not prompt|no prompt/i);
    expect(three).toMatch(/placeholder/i);
    expect(three).not.toMatch(/re-?prompt/i);
    expect(three).not.toContain(RETIRED_PROMPT);
  });

  test("the Rules section no longer tells the agent to re-prompt", () => {
    expect(skill()).not.toMatch(/Re-prompt on invalid/);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-658.4 — the approval preview shows the codename and its source
// ---------------------------------------------------------------------------

describe("AC-STE-658.4 — step-6 preview names the codename and its source", () => {
  test("step 6 carries a `Codename: <value> (source: flag|plan|composed)` line", () => {
    expect(step6()).toMatch(/Codename: <[^>\n]+> \(source: flag\|plan\|composed\)/);
  });

  test("the preview line sits inside the proposed-diff block, before `Apply?`", () => {
    const six = step6();
    const line = six.search(/Codename: <[^>\n]+> \(source:/);
    const apply = six.indexOf("=== Apply? [y/N] ===");
    expect(apply).toBeGreaterThanOrEqual(0);
    expect(line).toBeGreaterThanOrEqual(0);
    expect(line).toBeLessThan(apply);
  });

  test("the approval offers no codename edit", () => {
    const six = step6();
    // Control: step 6 still documents its options (y/yes and the `e` CHANGELOG edit).
    expect(six).toMatch(/`y` \/ `yes`/);
    const editLines = six.split("\n").filter((l) => /\bedit\b|`e`|\$EDITOR/i.test(l));
    expect(editLines.length).toBeGreaterThan(0);
    for (const l of editLines) {
      expect(l, `step 6 offers a codename edit: ${l}`).not.toMatch(/codename/i);
    }
  });
});

// ---------------------------------------------------------------------------
// AC-STE-658.6 — a composed codename is written into the plan with the stamp
// ---------------------------------------------------------------------------

const PLAN_NULL_KEY = [
  "---",
  "milestone: M_6c25dd",
  "status: active",
  "codename: null",
  "frozen_at: null",
  "---",
  "",
  "# Plan",
  "",
  "---",
  "",
  "body after an HR",
  "",
].join("\n");

const PLAN_NO_KEY = PLAN_NULL_KEY.replace("codename: null\n", "");
const PLAN_WITH_KEY = PLAN_NULL_KEY.replace("codename: null", "codename: Recorded Name");

const dirs: string[] = [];
function planFile(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), "ste-658-"));
  dirs.push(dir);
  const p = join(dir, "M_6c25dd.md");
  writeFileSync(p, body);
  return p;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const codenameLines = (text: string): string[] =>
  (text.split("\n---\n")[0] ?? "").split("\n").filter((l) => /^codename\s*:/.test(l));

describe("AC-STE-658.6 — stampShipCodename writes `codename:` for a composed source only, beside stampShippedIn", () => {
  test("composed source over `codename: null` sets the key in place, beside shipped_in", async () => {
    const p = planFile(PLAN_NULL_KEY);
    await stampShippedIn(p, "2.94.0");
    await stampShipCodename(p, { value: "Lantern Hall", source: "composed" });
    const after = readFileSync(p, "utf-8");
    expect(after).toContain("shipped_in: v2.94.0");
    expect(codenameLines(after)).toHaveLength(1);
    expect(readPlanCodename(p)).toBe("Lantern Hall");
    // The key keeps its position: the line after it is still `frozen_at: null`.
    const fm = after.split("\n");
    expect(fm[fm.findIndex((l) => l.startsWith("codename:")) + 1]).toBe("frozen_at: null");
    // Body untouched.
    expect(after.endsWith("# Plan\n\n---\n\nbody after an HR\n")).toBe(true);
  });

  test("composed source on a plan with no key adds exactly one `codename:` line", async () => {
    const p = planFile(PLAN_NO_KEY);
    expect(readPlanCodename(p)).toBeNull(); // control: no key before
    await stampShippedIn(p, "2.94.0");
    await stampShipCodename(p, { value: "Lantern Hall", source: "composed" });
    const after = readFileSync(p, "utf-8");
    expect(after).toContain("shipped_in: v2.94.0");
    expect(codenameLines(after)).toHaveLength(1);
    expect(readPlanCodename(p)).toBe("Lantern Hall");
  });

  test("plan source leaves the key untouched — only the shipped_in line changes", async () => {
    const p = planFile(PLAN_WITH_KEY);
    await stampShippedIn(p, "2.94.0");
    await stampShipCodename(p, { value: "Recorded Name", source: "plan" });
    const after = readFileSync(p, "utf-8");
    expect(after).toContain("shipped_in: v2.94.0");
    expect(after.replace("shipped_in: v2.94.0\n", "")).toBe(PLAN_WITH_KEY);
  });

  test("flag source leaves the plan's own codename untouched even when the flag differs", async () => {
    const p = planFile(PLAN_WITH_KEY);
    await stampShippedIn(p, "2.94.0");
    await stampShipCodename(p, { value: "Flag Override", source: "flag" });
    const after = readFileSync(p, "utf-8");
    expect(readPlanCodename(p)).toBe("Recorded Name");
    expect(after).not.toContain("Flag Override");
    expect(after.replace("shipped_in: v2.94.0\n", "")).toBe(PLAN_WITH_KEY);
  });

  test("flag source on a null key does not fill it in", async () => {
    const p = planFile(PLAN_NULL_KEY);
    await stampShippedIn(p, "2.94.0");
    await stampShipCodename(p, { value: "Flag Override", source: "flag" });
    expect(readPlanCodename(p)).toBeNull();
    expect(readFileSync(p, "utf-8")).not.toContain("Flag Override");
  });

  test("a composed value YAML would misread round-trips through readPlanCodename", async () => {
    for (const value of ["Rule: One", "#Hash Start", "[Bracket]", "null", "true"]) {
      const p = planFile(PLAN_NULL_KEY);
      await stampShipCodename(p, { value, source: "composed" });
      expect(readPlanCodename(p), value).toBe(value);
    }
  });

  test("a composed value the plan already records writes nothing (idempotent)", async () => {
    const p = planFile(PLAN_NULL_KEY);
    await stampShipCodename(p, { value: "Lantern Hall", source: "composed" });
    const once = readFileSync(p, "utf-8");
    await stampShipCodename(p, { value: "Lantern Hall", source: "composed" });
    expect(readFileSync(p, "utf-8")).toBe(once);
  });

  test("stampShippedIn itself is left as it was: no codename parameter", () => {
    // AC-STE-589.8 freezes stampShippedIn's body; the codename rides its own writer.
    expect(stampShippedIn.length).toBe(2);
  });

  test("step 7's stamp paragraph tells the ceremony to pass a composed codename", () => {
    const seven = step7();
    const stamp = seven.split("\n").find((l) => l.startsWith("**Stamp the resolved plan.**")) ?? "";
    expect(stamp).toContain("stampShippedIn");
    expect(stamp).toContain("stampShipCodename");
    expect(stamp).toMatch(/codename:/);
    expect(stamp).toMatch(/composed/i);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-658.7 — argument hint + flags line describe --codename as an override
// ---------------------------------------------------------------------------

describe("AC-STE-658.7 — --codename is described as an override of the plan's codename", () => {
  test("the flags line describes --codename as overriding the plan's codename, not skipping a prompt", () => {
    const flagsLine = skill().split("\n").find((l) => l.startsWith("- Optional flags:")) ?? "";
    expect(flagsLine).toContain("--codename");
    const after = flagsLine.slice(flagsLine.indexOf("--codename"));
    const desc = after.slice(0, after.indexOf("`--summary") === -1 ? undefined : after.indexOf("`--summary"));
    expect(desc).toMatch(/overrid/i);
    expect(desc).toMatch(/plan/i);
    expect(desc).not.toMatch(/skip prompt/i);
  });

  test("the argument hint describes --codename as an override and carries no prompt wording", () => {
    const hint = skill().split("\n").find((l) => l.startsWith("argument-hint:")) ?? "";
    expect(hint).toContain("--codename");
    expect(hint).toMatch(/--codename[^\]]*overrid/i);
    expect(hint).not.toMatch(/prompt/i);
  });

  test("no `skip prompt` description of --codename survives anywhere in the skill", () => {
    expect(skill()).not.toMatch(/--codename[^\n]{0,40}skip prompt/i);
  });
});
