// M_4df444 / STE-595 — /implement Phase 3 review fixes for the stdin-spawn detector.
//
// The STE-595 audit (2026-09-15) found shapes the detector let through that
// read a script from stdin just like the refused ones. Each hides the shell
// from `invoked()` / `stdinShell()` in a different way:
//   * an operand that IS stdin: `bash -`, `bash /dev/stdin`, `bash /dev/fd/0`;
//   * a runner whose own options sit between it and the shell:
//     `env -i bash`, `timeout 5 bash`, `nice -n 5 bash`, `sudo -u root bash`,
//     `caffeinate -i bash`;
//   * a backgrounding `&` inside a command substitution in the fed body.
// Every refused shape carries a backgrounding body, so the refusal is the
// STE-595 rule, not a new one. Every control keeps the file-run form or a
// harmless body, so the fix cannot pass by refusing more than the rule says.

import { describe, expect, test } from "bun:test";

import { detectStdinSpawn } from "../adapters/_shared/src/stdin_spawn_detector";

const SPAWNING_BODY = "<<'EOF'\nsleep 1 &\nEOF";
const HARMLESS_BODY = "<<'EOF'\necho hello\nEOF";

describe("AC-STE-595.2 — Phase 3: stdin operands the detector read as a script file", () => {
  for (const operand of ["-", "/dev/stdin", "/dev/fd/0"]) {
    test(`refused: bash ${operand} ${SPAWNING_BODY.split("\n")[0]} with a backgrounding body`, () => {
      const v = detectStdinSpawn(`bash ${operand} ${SPAWNING_BODY}`);
      expect(v.refuse).toBe(true);
    });
    test(`allowed: bash ${operand} with a body that backgrounds nothing`, () => {
      expect(detectStdinSpawn(`bash ${operand} ${HARMLESS_BODY}`).refuse).toBe(false);
    });
  }

  test("control: a real script-file operand still reads its script from the file", () => {
    expect(detectStdinSpawn(`bash /tmp/fence.sh ${SPAWNING_BODY}`).refuse).toBe(false);
  });
});

describe("AC-STE-595.2 — Phase 3: runners whose options hid the shell", () => {
  const runners = [
    "env -i",
    "env -u HOME",
    "timeout 5",
    "timeout -s KILL 5",
    "nice -n 5",
    "nice",
    "caffeinate -i",
    "sudo -u root",
    "sudo",
  ];
  for (const r of runners) {
    test(`refused: ${r} bash ${SPAWNING_BODY.split("\n")[0]} with a backgrounding body`, () => {
      expect(detectStdinSpawn(`${r} bash ${SPAWNING_BODY}`).refuse).toBe(true);
    });
    test(`allowed: ${r} bash /path/fence.sh (the file-run form)`, () => {
      expect(detectStdinSpawn(`${r} bash /path/fence.sh`).refuse).toBe(false);
    });
  }

  test("control: a runner in front of a non-shell command is not a shell reading stdin", () => {
    expect(detectStdinSpawn(`timeout 5 python3 - <<'PY'\nimport os\nPY`).refuse).toBe(false);
  });
});

describe("AC-STE-595.2 — Phase 3: backgrounding inside a command substitution in the fed body", () => {
  test("refused: the fed body backgrounds inside $( … )", () => {
    expect(detectStdinSpawn("bash <<'EOF'\nX=$(sleep 1 & echo started)\nEOF").refuse).toBe(true);
  });

  test("allowed: && and >& inside $( … ) are not backgrounding", () => {
    expect(detectStdinSpawn("bash <<'EOF'\nX=$(true && echo ok 2>&1)\nEOF").refuse).toBe(false);
  });
});
