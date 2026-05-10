// check_marker_runtime (STE-262 AC-STE-262.1) — runtime byte-grep helper.
//
// Pure function `checkMarkerRuntime(promptBody)` returns
// `{ present: true }` iff the input contains the literal byte-string
// `<dpt:auto-approve>v1</dpt:auto-approve>` (case-sensitive substring
// match — no regex, no whitespace tolerance, no version flexibility).
//
// CLI shim: `bun run check_marker_runtime.ts <file-or-->`
//   - <file-path>: reads file contents
//   - "-": reads stdin (heredoc on `claude -p`)
//   - prints `PRESENT` or `ABSENT` on a single line of stdout
//   - exits 0 on success, non-zero on I/O errors
//
// The script's stdout is the single deterministic gate decision called
// from /spec-write SKILL.md gate sites (§ 0b step 4 + § 7a). The LLM
// reading the SKILL must invoke this helper via Bash and branch strictly
// on the literal `PRESENT` / `ABSENT` token — no inference. See
// `docs/auto-mode-protocol.md § The Rule` and STE-262 § Technical Design.

import { existsSync, readFileSync } from "node:fs";

const MARKER = "<dpt:auto-approve>v1</dpt:auto-approve>";

export interface CheckMarkerRuntimeResult {
  present: boolean;
}

/**
 * Pure byte-grep helper. No env reads, no FS reads, no regex — exact
 * substring match for the canonical 39-byte marker token. Whitespace
 * around the marker is tolerated (substring match), but byte-altered
 * variants (case, version, missing closing tag) are rejected.
 */
export function checkMarkerRuntime(
  promptBody: string,
): CheckMarkerRuntimeResult {
  return { present: promptBody.includes(MARKER) };
}

function readStdinSync(): string {
  // Bun + Node both expose `process.stdin.fd` (fd 0). Read it
  // synchronously so the CLI shim is straightforward to drive from a
  // shell heredoc invocation in /spec-write SKILL.md gate sites.
  return readFileSync(0, "utf-8");
}

function buildIoErrorMessage(reason: string, source: string): string {
  return [
    `check_marker_runtime: I/O error reading ${source}: ${reason}.`,
    `Remedy: verify the file path exists and is readable, or pipe ` +
      `prompt body to stdin via \`-\`.`,
    `Context: helper=check_marker_runtime, source=${source}, severity=error`,
  ].join("\n");
}

async function main(argv: string[]): Promise<number> {
  const arg = argv[2];
  if (arg === undefined || arg === "") {
    process.stderr.write(
      buildIoErrorMessage(
        "missing argument",
        "argv[2] (expected file path or '-' for stdin)",
      ) + "\n",
    );
    return 2;
  }
  let body: string;
  if (arg === "-") {
    try {
      body = readStdinSync();
    } catch (e) {
      process.stderr.write(
        buildIoErrorMessage(
          (e as Error).message ?? "unknown",
          "stdin",
        ) + "\n",
      );
      return 2;
    }
  } else {
    if (!existsSync(arg)) {
      process.stderr.write(
        buildIoErrorMessage("file not found", arg) + "\n",
      );
      return 2;
    }
    try {
      body = readFileSync(arg, "utf-8");
    } catch (e) {
      process.stderr.write(
        buildIoErrorMessage(
          (e as Error).message ?? "unknown",
          arg,
        ) + "\n",
      );
      return 2;
    }
  }
  const { present } = checkMarkerRuntime(body);
  process.stdout.write(present ? "PRESENT\n" : "ABSENT\n");
  return 0;
}

// Bun entry guard: only run main when the module is invoked directly
// (e.g., `bun run check_marker_runtime.ts ...`), not when it's imported
// by a test or by the SKILL.md flow.
if (import.meta.main) {
  const code = await main(process.argv);
  process.exit(code);
}
