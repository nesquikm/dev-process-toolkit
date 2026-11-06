import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The defect check's orchestration lives in prose the model follows: the
// stranded-plant rule, the success report, the resume points and the
// implementer's plant procedure. Each sentence below is one a regression would
// quietly drop, so each is pinned on the surface that owns it. Literal
// substrings, not paraphrase: the point is that the rule is still stated.

const PLUGIN = join(import.meta.dir, "..");
const read = (rel: string) => readFileSync(join(PLUGIN, rel), "utf8");

const TDD = "skills/tdd/SKILL.md";
const IMPLEMENTER_SKILL = "skills/tdd-implement/SKILL.md";
const IMPLEMENTER_AGENT = "agents/tdd-implementer.md";
const IMPLEMENT = "skills/implement/SKILL.md";

describe("/tdd — the stranded-plant check restores only a recorded plant", () => {
  test("a file byte-equal to a recorded plant is restored", () => {
    expect(read(TDD)).toContain("**Byte-equal to a recorded plant** — a plant left in place. Copy the backup back");
  });

  test("a file equal to neither the backup nor a plant is kept, shown and asked about", () => {
    expect(read(TDD)).toContain(
      "**Equal to neither** — the file changed after the plant, by the implementer or, after a crash, by the operator. A difference alone cannot tell a plant from later work, so restore nothing",
    );
  });

  test("the directory is removed when the restore held", () => {
    expect(read(TDD)).toContain("**Equal to the backup** — the restore held. Remove the AC's directory.");
  });

  test("the start-of-run sweep covers every leftover directory, whichever FR it came from", () => {
    expect(read(TDD)).toContain("over every AC directory already under `<git-dir>/dpt-defect-check/`, whichever FR it came from");
  });
});

describe("/tdd — the success report", () => {
  test("its unverified list says only one test per AC is checked", () => {
    expect(read(TDD)).toContain("**Unverified tests (the defect check covers one test per AC)**");
  });

  test("any `ok` line other than `red at` is unverified", () => {
    expect(read(TDD)).toContain("every AC whose `ok` block carries any line other than `defect check: … → red at …`");
  });

  test("every restore and kept backup is reported, whichever AC it belongs to", () => {
    expect(read(TDD)).toContain(
      "A last list, **Backups**, names every restore and every kept backup the stranded-plant check produced in this run, the start-of-run sweep included",
    );
  });
});

describe("/tdd — resume points after a halt", () => {
  test("a refactorer halt resumes at refactor", () => {
    expect(read(TDD)).toContain("- **`refactor`** (a refactorer halt");
  });

  test("a spec-gap halt resumes at audit", () => {
    expect(read(TDD)).toContain("- **`audit`** (a spec-gap halt");
  });

  test("the per-AC isolation names the defect check as its one exception", () => {
    expect(read(TDD)).toContain("The defect check's read of the AC's test file, above, is its one exception.");
  });
});

describe("the implementer's plant procedure", () => {
  test("the skill records each plant before applying it", () => {
    expect(read(IMPLEMENTER_SKILL)).toContain("**Record each plant before applying it**");
  });

  test("the agent records each plant before applying it", () => {
    expect(read(IMPLEMENTER_AGENT)).toContain(
      "before applying each plant write the planted version beside it as `<path>.plant1` / `<path>.plant2`",
    );
  });

  // A bare `perl -e 'alarm …; exec …'` signals only the shell and leaves a
  // hung runner spinning; the fallback must end the whole process group.
  test("the skill's perl fallback ends the whole process group", () => {
    expect(read(IMPLEMENTER_SKILL)).toContain(`$SIG{ALRM}=sub{kill "TERM",-$$}; setpgrp; alarm shift; system @ARGV`);
  });

  test("the agent's perl fallback ends the whole process group", () => {
    expect(read(IMPLEMENTER_AGENT)).toContain(`$SIG{ALRM}=sub{kill "TERM",-$$}; setpgrp; alarm shift; system @ARGV`);
  });

  test("two GREEN plants are the only verdict row", () => {
    expect(read(IMPLEMENTER_SKILL)).toContain("| GREEN | GREEN | `failed` | `defect check: <plant 1>; <plant 2> → still GREEN` |");
  });
});

describe("/implement — what it carries from /tdd and the e2e hook", () => {
  test("a none-needed empty run reaches follow_ups through advisories", () => {
    expect(read(IMPLEMENT)).toContain(
      "it lands in the outcome's `advisories`, and step 14 states each one as a `follow_ups` row",
    );
  });

  test("--resume-at is refused outside a single FR", () => {
    expect(read(IMPLEMENT)).toContain("with `M<N>`, `next` or `all` it refuses");
  });
});
