// STE-697 — an interactively approved spec commit passes the
// socratic_first_turn_post_hoc_drift probe.
//
// The probe reads only HEAD and accepts two default-applied markers or a
// refusal block. The interactive `y` at the /spec-write § 7a commit gate
// wrote neither, so every hand-approved spec commit red the gate. The fix
// adds a third marker (`spec_write_commit_operator_approved`) to the probe
// and an instruction at the § 7a interactive-yes branch that writes it.
//
// Synthetic ids only (STE-900); temp git repos only.

import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  inspectCommit,
  runSocraticFirstTurnPostHocDriftProbe,
} from "../adapters/_shared/src/socratic_first_turn_post_hoc_drift";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const PROBE_SRC = join(
  PLUGIN_ROOT,
  "adapters/_shared/src/socratic_first_turn_post_hoc_drift.ts",
);
const SPEC_WRITE_SKILL = join(PLUGIN_ROOT, "skills/spec-write/SKILL.md");

const MARKER = "spec_write_commit_operator_approved";
const ALL_MARKERS = [
  "spec_write_draft_default_applied",
  "spec_write_commit_default_applied",
  MARKER,
];

const SUBJECT = "chore(specs): write FR STE-900";
const APPROVED_BODY = [
  "Adds the FR so the gate can read an approved spec commit.",
  "",
  MARKER,
  "",
  "Refs: STE-900",
].join("\n");
const UNMARKED_BODY = [
  "Adds the FR so the gate can read an approved spec commit.",
  "",
  "Refs: STE-900",
].join("\n");

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length > 0) {
    const d = tempDirs.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

function git(cwd: string, args: string[]): string {
  return execFileSync(
    "git",
    [
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      ...args,
    ],
    { cwd, encoding: "utf-8" },
  );
}

/** Temp repo whose HEAD commit carries `subject` + `body`. */
function repoWithHeadCommit(subject: string, body: string): string {
  const dir = mkdtempSync(join(tmpdir(), "ste697-"));
  tempDirs.push(dir);
  git(dir, ["init", "-q"]);
  const msgFile = join(dir, ".commit-msg.txt");
  writeFileSync(msgFile, `${subject}\n\n${body}\n`);
  git(dir, ["commit", "-q", "--allow-empty", "-F", msgFile]);
  rmSync(msgFile);
  return dir;
}

/**
 * Prose pin for AC-STE-697.4 / .6. Returns a list of problems with the
 * /spec-write § 7a commit gate; empty means the instruction to write the
 * operator-approval marker sits on the interactive-yes branch and nowhere
 * else in the gate.
 */
function operatorApprovedMarkerPinProblems(skillText: string): string[] {
  const problems: string[] = [];
  const start = skillText.indexOf("### 7a.");
  const end = skillText.indexOf("\n### 7. ", start);
  if (start < 0 || end < 0) return ["§ 7a section not found"];
  const section = skillText.slice(start, end);
  const lines = section.split("\n");

  const presentBullet = lines.find((l) => l.startsWith("- `PRESENT`"));
  const nonTtyBullet = lines.find(
    (l) => l.startsWith("- `ABSENT`") && l.includes("isTTY === false"),
  );
  const ttyBullet = lines.find(
    (l) => l.startsWith("- `ABSENT`") && l.includes("isTTY === true"),
  );
  if (!presentBullet) problems.push("default-applied (PRESENT) bullet not found");
  if (!nonTtyBullet) problems.push("non-tty refusal bullet not found");
  if (!ttyBullet) {
    problems.push("interactive (isTTY === true) bullet not found");
    return problems;
  }

  // Interactive-yes branch: the text between "on `y`" and "on `n`".
  const yIdx = ttyBullet.indexOf("on `y`");
  const nIdx = ttyBullet.indexOf("on `n`");
  if (yIdx < 0 || nIdx < 0 || nIdx < yIdx) {
    problems.push("interactive bullet lacks ordered `on y` / `on n` branches");
  } else {
    const yesBranch = ttyBullet.slice(yIdx, nIdx);
    if (!yesBranch.includes(`\`${MARKER}\``)) {
      problems.push(`interactive-yes branch does not name \`${MARKER}\``);
    }
    if (!/commit body|body of the commit|into the body|in the body/i.test(yesBranch)) {
      problems.push("interactive-yes branch does not say the marker goes in the commit body");
    }
    const declineBranch = ttyBullet.slice(nIdx);
    if (declineBranch.includes(MARKER)) {
      problems.push("decline branch names the operator-approval marker");
    }
  }

  if (presentBullet?.includes(MARKER)) {
    problems.push("default-applied (PRESENT) bullet names the operator-approval marker");
  }
  if (nonTtyBullet?.includes(MARKER)) {
    problems.push("non-tty refusal bullet names the operator-approval marker");
  }
  // No other line of § 7a may carry the marker.
  for (const l of lines) {
    if (l.includes(MARKER) && l !== ttyBullet) {
      problems.push(`marker appears off the interactive-yes branch: ${l.slice(0, 80)}`);
    }
  }
  return problems;
}

describe("AC-STE-697.1 — regression", () => {
  test("a spec commit carrying the operator-approval marker passes the probe", async () => {
    const repo = repoWithHeadCommit(SUBJECT, APPROVED_BODY);
    const report = await runSocraticFirstTurnPostHocDriftProbe(repo);
    expect(report.violations).toEqual([]);
  });
});

describe("AC-STE-697.2 — third legitimacy marker", () => {
  test("AC-STE-697.2: inspectCommit accepts spec_write_commit_operator_approved in the body", () => {
    expect(inspectCommit(SUBJECT, APPROVED_BODY)).toBe("legitimate");
  });

  test("AC-STE-697.2: the marker also legitimises the cross-cutting subject shape", () => {
    expect(
      inspectCommit("docs(specs): edit cross-cutting specs", `${MARKER}\n\nRefs: STE-900`),
    ).toBe("legitimate");
  });

  test("AC-STE-697.2: the two default-applied markers still pass", () => {
    expect(inspectCommit(SUBJECT, "spec_write_draft_default_applied")).toBe("legitimate");
    expect(inspectCommit(SUBJECT, "spec_write_commit_default_applied")).toBe("legitimate");
  });
});

describe("AC-STE-697.3 — refusal twin", () => {
  test("AC-STE-697.3: the same commit with no marker in its body still reports the violation", async () => {
    expect(inspectCommit(SUBJECT, UNMARKED_BODY)).toBe("violation");
    const repo = repoWithHeadCommit(SUBJECT, UNMARKED_BODY);
    const report = await runSocraticFirstTurnPostHocDriftProbe(repo);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]?.capability).toBe(
      "socratic_first_turn_post_hoc_drift_violation",
    );
    expect(report.violations[0]?.subject).toBe(SUBJECT);
  });

  test("AC-STE-697.3: the marker in the subject line alone does not count", async () => {
    const subjectWithMarker = `${SUBJECT} ${MARKER}`;
    expect(inspectCommit(subjectWithMarker, UNMARKED_BODY)).toBe("violation");
    const repo = repoWithHeadCommit(subjectWithMarker, UNMARKED_BODY);
    const report = await runSocraticFirstTurnPostHocDriftProbe(repo);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]?.subject).toBe(subjectWithMarker);
  });
});

describe("AC-STE-697.4 — /spec-write § 7a writes the marker on the interactive yes only", () => {
  test("AC-STE-697.4: § 7a interactive-yes branch writes spec_write_commit_operator_approved into the commit body, and no other path does", () => {
    const skill = readFileSync(SPEC_WRITE_SKILL, "utf-8");
    expect(operatorApprovedMarkerPinProblems(skill)).toEqual([]);
  });
});

describe("AC-STE-697.5 — violation message and remedy name all three markers", () => {
  test("AC-STE-697.5: the verdict line and the Remedy line each name every marker", async () => {
    const repo = repoWithHeadCommit(SUBJECT, UNMARKED_BODY);
    const report = await runSocraticFirstTurnPostHocDriftProbe(repo);
    expect(report.violations).toHaveLength(1);
    const message = report.violations[0]!.message;
    const lines = message.split("\n");
    const verdict = lines[0] ?? "";
    const remedy = lines.find((l) => l.startsWith("Remedy:")) ?? "";
    expect(remedy).not.toBe("");
    for (const m of ALL_MARKERS) {
      expect(verdict).toContain(m);
      expect(remedy).toContain(m);
    }
  });
});

describe("AC-STE-697.6 — mutations redden the pins", () => {
  test("AC-STE-697.6: removing the third marker from the probe reddens the regression case", async () => {
    const src = readFileSync(PROBE_SRC, "utf-8");
    // Guard: the mutation must actually remove something, or it proves nothing.
    expect(src).toContain(MARKER);
    const mutated = src.split(MARKER).join("__removed_operator_marker__");
    const dir = mkdtempSync(join(tmpdir(), "ste697-mut-"));
    tempDirs.push(dir);
    const mutPath = join(dir, "probe_mutated.ts");
    writeFileSync(mutPath, mutated);
    const mod = (await import(mutPath)) as {
      inspectCommit: typeof inspectCommit;
    };
    // Unmutated: legitimate. Mutated: the regression fixture reddens.
    expect(inspectCommit(SUBJECT, APPROVED_BODY)).toBe("legitimate");
    expect(mod.inspectCommit(SUBJECT, APPROVED_BODY)).toBe("violation");
  });

  test("AC-STE-697.6: removing the instruction from the § 7a commit gate reddens the prose pin", () => {
    const skill = readFileSync(SPEC_WRITE_SKILL, "utf-8");
    // Guard: the live text must carry the marker for the mutation to bite.
    expect(skill).toContain(MARKER);
    const mutated = skill.split(MARKER).join("");
    expect(operatorApprovedMarkerPinProblems(mutated).length).toBeGreaterThan(0);
  });

  test("AC-STE-697.6: moving the marker to the default-applied bullet reddens the prose pin", () => {
    const skill = readFileSync(SPEC_WRITE_SKILL, "utf-8");
    // Target the § 7a PRESENT bullet, not the § 0b draft-gate one above it.
    const at = skill.indexOf("### 7a.");
    expect(at).toBeGreaterThan(-1);
    const mutated =
      skill.slice(0, at) +
      skill
        .slice(at)
        .replace(
          "\n- `PRESENT` → ",
          `\n- \`PRESENT\` → write \`${MARKER}\` into the commit body → `,
        );
    expect(mutated).not.toBe(skill);
    expect(operatorApprovedMarkerPinProblems(mutated)).toContain(
      "default-applied (PRESENT) bullet names the operator-approval marker",
    );
  });
});
