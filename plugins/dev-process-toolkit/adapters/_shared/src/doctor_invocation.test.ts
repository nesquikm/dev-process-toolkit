import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { doctorInvocationFor } from "./doctor_invocation";

const pluginRoot = join(import.meta.dir, "..", "..", "..");

describe("STE-209 — doctorInvocationFor (AC-STE-209.5)", () => {
  test("Flutter stack with fvm declared → returns 'fvm flutter'", () => {
    const body = readFileSync(
      join(pluginRoot, "examples", "flutter-dart", "gate-commands.md"),
      "utf-8",
    );
    expect(doctorInvocationFor("flutter", body)).toBe("fvm flutter");
  });

  test("Flutter stack with bare flutter declared → returns 'flutter'", () => {
    const body = "```\nflutter analyze\nflutter test\n```";
    expect(doctorInvocationFor("flutter", body)).toBe("flutter");
  });

  test("returns null when no fenced block mentions the stack command", () => {
    const body = "Some prose about Bun.\n\nNo fenced gate commands here.";
    expect(doctorInvocationFor("flutter", body)).toBeNull();
  });

  test("ignores prose mentions outside fenced blocks", () => {
    // Prose says "never use bare flutter" but fenced block has fvm flutter.
    const body =
      "Don't run bare `flutter` directly.\n\n```\nfvm flutter analyze\n```";
    expect(doctorInvocationFor("flutter", body)).toBe("fvm flutter");
  });

  test("rejects unknown stackCommand", () => {
    const body = "```\nfooexec --version\n```";
    expect(doctorInvocationFor("fooexec", body)).toBeNull();
  });

  test("Bun stack: bare bun → returns 'bun'", () => {
    const body = "```\nbun test\nbun install\n```";
    expect(doctorInvocationFor("bun", body)).toBe("bun");
  });

  test("wrapper-not-in-allowlist: `pnpm python` is rejected (pairing absent from KNOWN_WRAPPER_PAIRS)", () => {
    // `pnpm` is a recognized wrapper but only for node/npm. A `pnpm python`
    // line has no bare-token match for `python` either (python is in
    // tokens[1], not tokens[0]), so the helper returns null and the
    // caller falls back to the bare command outside this helper.
    const body = "```\npnpm python --version\n```";
    expect(doctorInvocationFor("python", body)).toBeNull();
  });

  test("wrapper-pair allowlist: `pnpm node` IS recognized → returns 'pnpm node'", () => {
    const body = "```\npnpm node --version\n```";
    expect(doctorInvocationFor("node", body)).toBe("pnpm node");
  });
});
