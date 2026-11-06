// STE-728 (M_d1b4b7) AC-STE-728.10 — the approval check, graded on `apply`
// itself over transcript fixtures.
//
// The base fixture proposes two rows (token_stats and tool_calls) on a tree
// whose local settings file is not ignored, so propose prints every line kind:
// two `set`, two `because`, one `add .gitignore:` and the `digest=` line.
//
// Positive rows: the live lone-call shape (no line for the running apply), the
// batch shape (its own line with no tool_result), and the sentence-only answer
// form. Every refusal row exits 1 in NFR-10 shape with the tree byte-identical,
// so a row that stops before the approval verifies writes no receipt.

import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import {
  APPLY_LABEL,
  AUTO_APPROVE_MARKER,
  IGNORE_OTHER,
  LEAVE_LABEL,
  LOCAL_SETTINGS,
  MODULE,
  TWO_OFF,
  Transcript,
  apply,
  applyCommand,
  askQuestions,
  cleanupTemps,
  expectRefusal,
  git,
  harnessSentence,
  hexOf,
  makeTree,
  printedLines,
  propose,
  proposalMod,
  proposeCommand,
  questionFor,
  readOr,
  retroApplyReceipts,
  settingsPath,
  sid,
  snapshot,
  tempDir,
} from "./_m_d1b4b7_ste728_fixture";

afterAll(cleanupTemps);

const SESSION = sid(30);

interface Ctx {
  root: string;
  report: string;
  stdout: string;
  lines: string[];
  digest: string;
  configDir: string;
}

async function base(label: string, o: { gitignore?: string | null; trackedLocal?: string } = {}): Promise<Ctx> {
  const root = makeTree(label, { gitignore: o.gitignore === undefined ? IGNORE_OTHER : o.gitignore, trackedLocal: o.trackedLocal });
  const { writeReport } = await import("./_m_d1b4b7_ste728_fixture");
  const report = await writeReport(label, TWO_OFF());
  const p = propose(root, report);
  if (p.status !== 0 || p.stdout === "") throw new Error(`propose printed nothing:\n${p.stderr}`);
  const lines = printedLines(p.stdout);
  const digest = lines.find((l) => l.startsWith("digest="))!.slice("digest=".length);
  return { root, report, stdout: p.stdout.trimEnd(), lines, digest, configDir: tempDir(`${label}-config`) };
}

/** Build a transcript with `steps`, write it, run apply; returns the run. */
function runWith(c: Ctx, steps: (t: Transcript) => void, o: { session?: string | undefined; digest?: string } = {}) {
  const session = "session" in o ? o.session : SESSION;
  const t = new Transcript(SESSION, c.root);
  steps(t);
  t.writeTo(c.configDir);
  return apply(c.root, c.report, o.digest ?? c.digest, { cwd: c.root, configDir: c.configDir, session });
}

const realPropose = (c: Ctx) => (t: Transcript) => t.bash(proposeCommand(c.root, c.report), c.stdout);

function wrote(c: Ctx): boolean {
  const s = readFileSync(settingsPath(c.root), "utf-8");
  return /token_stats:\n {4}enabled: true/.test(s) && /tool_calls:\n {4}enabled: true/.test(s);
}

async function refuses(label: string, steps: (c: Ctx) => (t: Transcript) => void, o: { session?: string | undefined; ctx?: Ctx } = {}) {
  const c = o.ctx ?? (await base(label));
  const before = snapshot(c.root);
  const r = runWith(c, steps(c), "session" in o ? { session: o.session } : {});
  expectRefusal(r);
  expect(snapshot(c.root)).toEqual(before);
  expect(retroApplyReceipts(c.root, SESSION)).toHaveLength(0);
}

// ------------------------------------------------------------------ positive

describe("AC-STE-728.10 apply writes on a verified approval", () => {
  test("positive control: one question holding every printed line, answered Apply the shown change; no line for the running apply", async () => {
    const c = await base("ac10-live");
    expect(c.lines.filter((l) => l.startsWith("set "))).toHaveLength(2);
    expect(c.lines.filter((l) => l.startsWith("because "))).toHaveLength(2);
    expect(c.lines).toContain("add .gitignore: .claude/settings.local.json");
    const r = runWith(c, (t) => {
      realPropose(c)(t);
      t.ask(questionFor(c.lines), APPLY_LABEL);
    });
    expect(r.status).toBe(0);
    expect(wrote(c)).toBe(true);
    expect(retroApplyReceipts(c.root, SESSION)).toHaveLength(1);
  });

  // Spec review 9, m9-1: apply prints the fixed consumption line after it writes its receipt, so a later
  // apply consumes the approval through any recorded tool_result, whatever command form ran this one.
  test("apply prints `retro-apply: consumed digest=<digest>` on its own line once the receipt is written", async () => {
    const c = await base("ac10-consumption-line");
    const r = runWith(c, (t) => {
      realPropose(c)(t);
      t.ask(questionFor(c.lines), APPLY_LABEL);
    });
    expect(r.status).toBe(0);
    expect(r.stdout.split("\n")).toContain(`retro-apply: consumed digest=${c.digest}`);
    expect(retroApplyReceipts(c.root, SESSION)).toHaveLength(1);
  });

  test("the batch shape: the running call's own line with no tool_result — apply writes", async () => {
    const c = await base("ac10-batch");
    const r = runWith(c, (t) => {
      realPropose(c)(t);
      t.ask(questionFor(c.lines), APPLY_LABEL);
      t.bash(applyCommand(c.root, c.report, c.digest), null);
    });
    expect(r.status).toBe(0);
    expect(wrote(c)).toBe(true);
  });

  test("the sentence-only answer form — apply writes", async () => {
    const c = await base("ac10-sentence");
    const r = runWith(c, (t) => {
      realPropose(c)(t);
      t.ask(questionFor(c.lines), APPLY_LABEL, { form: "sentence" });
    });
    expect(r.status).toBe(0);
    expect(wrote(c)).toBe(true);
  });
});

// ------------------------------------------------------------------ refusals

describe("AC-STE-728.10 each of these refuses in NFR-10 shape and leaves the tree byte-identical", () => {
  test("a Leave settings unchanged answer", () =>
    refuses("ac10-leave", (c) => (t) => {
      realPropose(c)(t);
      t.ask(questionFor(c.lines), LEAVE_LABEL);
    }));

  test("no answer, with the auto-approve marker in the prompt", () =>
    refuses("ac10-marker", (c) => (t) => {
      t.userText(`${AUTO_APPROVE_MARKER}\nRun /dev-process-toolkit:retro and apply what it proposes.`);
      realPropose(c)(t);
    }));

  test("an approval in assistant prose only", () =>
    refuses("ac10-prose", (c) => (t) => {
      realPropose(c)(t);
      t.assistantText(`${questionFor(c.lines)}\n\nOperator: ${APPLY_LABEL}`);
      t.userText(APPLY_LABEL);
    }));

  test("an echo-printed digest line in place of a real propose", () =>
    refuses("ac10-echo", (c) => (t) => {
      t.bash(`echo '${c.stdout}'`, c.stdout);
      t.ask(questionFor(c.lines), APPLY_LABEL);
    }));

  test("a cd ... && chain around propose", () =>
    refuses("ac10-cd", (c) => (t) => {
      t.bash(`cd ${c.root} && ${proposeCommand(c.root, c.report)}`, c.stdout);
      t.ask(questionFor(c.lines), APPLY_LABEL);
    }));

  test("a same-named retro_proposal.ts elsewhere", () =>
    refuses("ac10-elsewhere", (c) => (t) => {
      const fake = join(tempDir("ac10-fake"), "retro_proposal.ts");
      writeFileSync(fake, "console.log('x');\n");
      t.bash(proposeCommand(c.root, c.report, fake), c.stdout);
      t.ask(questionFor(c.lines), APPLY_LABEL);
    }));

  test("an answer recorded before the propose", () =>
    refuses("ac10-before", (c) => (t) => {
      t.ask(questionFor(c.lines), APPLY_LABEL);
      realPropose(c)(t);
    }));

  test("an answer naming another digest", () =>
    refuses("ac10-other-digest", (c) => (t) => {
      realPropose(c)(t);
      const other = `sha256:${hexOf(c.digest).startsWith("f") ? "e".repeat(64) : "f".repeat(64)}`;
      t.ask(questionFor(c.lines.map((l) => (l.startsWith("digest=") ? `digest=${other}` : l))), APPLY_LABEL);
    }));

  test("an unset CLAUDE_CODE_SESSION_ID", () =>
    refuses(
      "ac10-unset",
      (c) => (t) => {
        realPropose(c)(t);
        t.ask(questionFor(c.lines), APPLY_LABEL);
      },
      { session: undefined },
    ));

  test("an is_error answered record", () =>
    refuses("ac10-is-error", (c) => (t) => {
      realPropose(c)(t);
      t.ask(questionFor(c.lines), APPLY_LABEL, { isError: true });
    }));

  test("a result naming another question", () =>
    refuses("ac10-other-question", (c) => (t) => {
      realPropose(c)(t);
      t.ask(questionFor(c.lines), APPLY_LABEL, { answeredQuestion: "Apply something else?" });
    }));

  test("a typed answer other than the exact label", () =>
    refuses("ac10-typed", (c) => (t) => {
      realPropose(c)(t);
      t.ask(questionFor(c.lines), `${APPLY_LABEL}, please`);
    }));

  test("the question missing a printed set line", () =>
    refuses("ac10-no-set", (c) => (t) => {
      realPropose(c)(t);
      const firstSet = c.lines.findIndex((l) => l.startsWith("set "));
      t.ask(questionFor(c.lines.filter((_, i) => i !== firstSet)), APPLY_LABEL);
    }));

  test("the question with a printed because line reworded", () =>
    refuses("ac10-reworded", (c) => (t) => {
      realPropose(c)(t);
      let done = false;
      const lines = c.lines.map((l) => {
        if (done || !l.startsWith("because ")) return l;
        done = true;
        return l.replace("skipped", "was skipped");
      });
      t.ask(questionFor(lines), APPLY_LABEL);
    }));

  test("the question missing the printed add .gitignore: line", () =>
    refuses("ac10-no-add", (c) => (t) => {
      realPropose(c)(t);
      t.ask(questionFor(c.lines.filter((l) => !l.startsWith("add .gitignore:"))), APPLY_LABEL);
    }));

  test("a question that holds only the digest line", () =>
    refuses("ac10-digest-only", (c) => (t) => {
      realPropose(c)(t);
      t.ask(questionFor(c.lines.filter((l) => l.startsWith("digest="))), APPLY_LABEL);
    }));

  test("the printed lines run together on one line of the question", () =>
    refuses("ac10-one-line", (c) => (t) => {
      realPropose(c)(t);
      t.ask(`Apply this? ${c.lines.join(" ")}`, APPLY_LABEL);
    }));
});

describe("AC-STE-728.10 a used approval is consumed", () => {
  test("an earlier apply call's recorded tool_result for the same digest, after the answer (approved bytes on the tree)", () =>
    refuses("ac10-consumed-plain", (c) => (t) => {
      realPropose(c)(t);
      t.ask(questionFor(c.lines), APPLY_LABEL);
      t.bash(applyCommand(c.root, c.report, c.digest), "Refusing: something\nRemedy: x\nContext: y");
    }));

  test("the earlier call written as a cd <root> && bun run <abs>/retro_proposal.ts apply chain", () =>
    refuses("ac10-consumed-cd", (c) => (t) => {
      realPropose(c)(t);
      t.ask(questionFor(c.lines), APPLY_LABEL);
      t.bash(`cd ${c.root} && ${applyCommand(c.root, c.report, c.digest)}`, "done");
    }));

  test("the earlier call written in an echo-prefixed form", () =>
    refuses("ac10-consumed-echo", (c) => (t) => {
      realPropose(c)(t);
      t.ask(questionFor(c.lines), APPLY_LABEL);
      t.bash(`echo ${applyCommand(c.root, c.report, c.digest)}`, applyCommand(c.root, c.report, c.digest));
    }));

  test("the consumption line in a recorded tool_result after the answer, from a command that names neither the module nor the hex", () =>
    refuses("ac10-consumed-line", (c) => (t) => {
      realPropose(c)(t);
      t.ask(questionFor(c.lines), APPLY_LABEL);
      t.bash('bash -c "$APPLY_CMD"', `retro-apply: consumed digest=${c.digest}\nsomething else`);
    }));

  test("control: a recorded Bash result naming the module and the hex BEFORE the answer does not consume", async () => {
    const c = await base("ac10-consumed-before");
    const r = runWith(c, (t) => {
      t.bash(`cat ${MODULE} # ${hexOf(c.digest)}`, "noise");
      realPropose(c)(t);
      t.ask(questionFor(c.lines), APPLY_LABEL);
    });
    expect(r.status).toBe(0);
    expect(wrote(c)).toBe(true);
  });

  test("re-apply: a first apply writes and registers; on the tree restored to the approved bytes a second apply over the same transcript refuses through its receipt", async () => {
    const c = await base("ac10-reapply");
    const settings = readFileSync(settingsPath(c.root));
    const gitignore = readFileSync(join(c.root, ".gitignore"));
    const steps = (t: Transcript) => {
      realPropose(c)(t);
      t.ask(questionFor(c.lines), APPLY_LABEL);
    };
    const first = runWith(c, steps);
    expect(first.status).toBe(0);
    expect(wrote(c)).toBe(true);
    const local = readOr(join(c.root, LOCAL_SETTINGS));
    expect(local).not.toBeNull();
    writeFileSync(settingsPath(c.root), settings);
    writeFileSync(join(c.root, ".gitignore"), gitignore);
    const before = snapshot(c.root);
    const second = runWith(c, steps);
    expectRefusal(second);
    expect(snapshot(c.root)).toEqual(before);
    expect(readOr(join(c.root, LOCAL_SETTINGS))).toBe(local);
    expect(retroApplyReceipts(c.root, SESSION)).toHaveLength(1);
  });

  test("an apply after an earlier one refused at the precondition check, its cause fixed, refuses (the refused call's receipt)", async () => {
    const c = await base("ac10-after-refused", { trackedLocal: "{}\n" });
    const steps = (t: Transcript) => {
      realPropose(c)(t);
      t.ask(questionFor(c.lines), APPLY_LABEL);
    };
    expectRefusal(runWith(c, steps));
    expect(retroApplyReceipts(c.root, SESSION)).toHaveLength(1);
    git(c.root, "rm", "-q", "--cached", LOCAL_SETTINGS);
    git(c.root, "commit", "-q", "-m", "untrack");
    const before = snapshot(c.root);
    expectRefusal(runWith(c, steps));
    expect(snapshot(c.root)).toEqual(before);
    expect(retroApplyReceipts(c.root, SESSION)).toHaveLength(1);
  });
});

describe("AC-STE-728.10 an approval from another root", () => {
  test("propose ran in worktree A; apply <worktree B> with byte-identical settings and .gitignore refuses on the digest", async () => {
    const c = await base("ac10-root-a");
    const b = join(tempDir("ac10-root-b"), "wt-b");
    git(c.root, "worktree", "add", "-q", "--detach", b);
    expect(readFileSync(settingsPath(b)).equals(readFileSync(settingsPath(c.root)))).toBe(true);
    expect(readFileSync(join(b, ".gitignore")).equals(readFileSync(join(c.root, ".gitignore")))).toBe(true);
    // The two trees print the same lines apart from the digest.
    const pb = printedLines(propose(b, c.report).stdout);
    expect(pb.filter((l) => !l.startsWith("digest="))).toEqual(c.lines.filter((l) => !l.startsWith("digest=")));
    expect(pb.find((l) => l.startsWith("digest="))).not.toBe(`digest=${c.digest}`);

    const t = new Transcript(SESSION, b);
    realPropose(c)(t);
    t.ask(questionFor(c.lines), APPLY_LABEL);
    t.writeTo(c.configDir);
    const before = snapshot(b);
    const r = apply(b, c.report, c.digest, { cwd: b, configDir: c.configDir, session: SESSION });
    expectRefusal(r);
    // Refused on the digest itself (it covers the root), not only by the printed-lines match (AC.13 mutation).
    expect(r.stderr).toMatch(/digest no longer matches/);
    expect(snapshot(b)).toEqual(before);
  });
});

// ---------------------------------------------------------------- askAnswerTo

describe("AC-STE-728.10 askAnswerTo parity with the hook's answerTo record shapes", () => {
  const question = questionFor(["set tracking.token_stats.enabled: true", "digest=sha256:" + "0".repeat(64)]);
  const questions = askQuestions(question);
  const block = (content: unknown) => ({ type: "tool_result", tool_use_id: "toolu_SYNTH728_P", content });
  const record = (b: unknown, extra: Record<string, unknown> = {}) => ({
    type: "user",
    uuid: "00000000-0000-4000-8000-000000100099",
    message: { role: "user", content: [b] },
    ...extra,
  });

  test("the carried form (toolUseResult.answers) returns the selected label", async () => {
    const { askAnswerTo } = await proposalMod();
    const b = block(harnessSentence(question, APPLY_LABEL));
    expect(askAnswerTo(record(b, { toolUseResult: { questions, answers: { [question]: APPLY_LABEL } } }), b, question)).toBe(APPLY_LABEL);
  });

  test("the carried form wins over the sentence when both are present", async () => {
    const { askAnswerTo } = await proposalMod();
    const b = block(harnessSentence(question, LEAVE_LABEL));
    expect(askAnswerTo(record(b, { toolUseResult: { questions, answers: { [question]: APPLY_LABEL } } }), b, question)).toBe(APPLY_LABEL);
  });

  test("the sentence-only form (string content) returns the selected label", async () => {
    const { askAnswerTo } = await proposalMod();
    const b = block(harnessSentence(question, APPLY_LABEL));
    expect(askAnswerTo(record(b), b, question)).toBe(APPLY_LABEL);
  });

  test("the sentence-only form (text-block content) returns the selected label", async () => {
    const { askAnswerTo } = await proposalMod();
    const b = block([{ type: "text", text: harnessSentence(question, LEAVE_LABEL) }]);
    expect(askAnswerTo(record(b), b, question)).toBe(LEAVE_LABEL);
  });

  test("null for a record that answers a different question, in either form", async () => {
    const { askAnswerTo } = await proposalMod();
    const other = "Something else?";
    const b = block(harnessSentence(other, APPLY_LABEL));
    expect(askAnswerTo(record(b, { toolUseResult: { questions: askQuestions(other), answers: { [other]: APPLY_LABEL } } }), b, question)).toBeNull();
    expect(askAnswerTo(record(b), b, question)).toBeNull();
  });
});

// ---------------------------------------------------------- runsRetroProposal

describe("AC-STE-728.10 runsRetroProposal reads the bunInvocation grammar", () => {
  const root = "/tmp/fixture-root";
  const report = "/tmp/fixture-report.json";
  test("accepts one plain bun [run] <abs module> propose ...", async () => {
    const { runsRetroProposal } = await proposalMod();
    expect(runsRetroProposal(`bun run ${MODULE} propose ${root} ${report}`, "propose")).toBe(true);
    expect(runsRetroProposal(`bun ${MODULE} propose ${root} ${report}`, "propose")).toBe(true);
  });

  test("rejects echo, a cd chain, a relative path, a same-named file elsewhere and the other verb", async () => {
    const { runsRetroProposal } = await proposalMod();
    const fake = join(tempDir("rrp-fake"), "retro_proposal.ts");
    writeFileSync(fake, "\n");
    expect(runsRetroProposal(`echo bun run ${MODULE} propose ${root} ${report}`, "propose")).toBe(false);
    expect(runsRetroProposal(`cd ${root} && bun run ${MODULE} propose ${root} ${report}`, "propose")).toBe(false);
    expect(runsRetroProposal(`bun run adapters/_shared/src/retro_proposal.ts propose ${root} ${report}`, "propose")).toBe(false);
    expect(runsRetroProposal(`bun run ${fake} propose ${root} ${report}`, "propose")).toBe(false);
    expect(runsRetroProposal(`bun run ${MODULE} apply ${root} ${report} sha256:00`, "propose")).toBe(false);
    expect(runsRetroProposal(`bun run ${MODULE} apply ${root} ${report} sha256:00`, "apply")).toBe(true);
  });
});

// ---------------------------------------------------------------- source scan

describe("AC-STE-728.10 one consent rule", () => {
  const src = () => readFileSync(MODULE, "utf-8");

  test("perQuestionConsent is imported from join_consent_ownership.ts", () => {
    expect(src()).toMatch(/import\s*\{[^}]*\bperQuestionConsent\b[^}]*\}\s*from\s*["']\.\/join_consent_ownership(?:\.ts)?["']/);
  });

  test("no second consent rule: retro_proposal.ts defines no perQuestionConsent, consentVerdict or typedAdopts", () => {
    expect(src()).not.toMatch(/function\s+(perQuestionConsent|consentVerdict|typedAdopts)\b/);
  });

  test("askAnswerTo carries a Twin: comment naming answerTo in pre-tracker-write-gate.ts", () => {
    expect(src()).toMatch(/Twin:.*answerTo.*pre-tracker-write-gate\.ts|Twin:.*pre-tracker-write-gate\.ts.*answerTo/);
  });

  test("the hook's answerTo is not edited (identical to the merge-base with main)", () => {
    const repo = join(import.meta.dir, "..", "..", "..");
    const mb = spawnSync("git", ["merge-base", "HEAD", "main"], { cwd: repo, encoding: "utf-8" }).stdout.trim();
    expect(mb).toMatch(/^[0-9a-f]{40}$/);
    const rel = "plugins/dev-process-toolkit/templates/hooks/_lib/hooks/pre-tracker-write-gate.ts";
    const old = spawnSync("git", ["show", `${mb}:${rel}`], { cwd: repo, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 }).stdout;
    const fn = (text: string) => {
      const at = text.indexOf("function answerTo(");
      return at < 0 ? null : text.slice(at, text.indexOf("\n}\n", at));
    };
    expect(fn(old)).not.toBeNull();
    expect(fn(readFileSync(join(repo, rel), "utf-8"))).toBe(fn(old));
  });
});
