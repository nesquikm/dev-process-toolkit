// M_292387 STE-687 — the supervisor mints the spawn receipt a worker cannot.
//
// The front door (`bun run spawn_receipt.ts <handle> <ledger> <name> <host>`)
// used to default its ownership check to `spawn-agent-owned`, a binary nothing
// installs. With no fifth argument it now finds agent-toolkit's
// `skills/spawn-agent/lib/owned.py` through the plugin registry under the
// Claude config dir and runs it as `python3 <owned.py> <ledger> <name>`.
//
// ISOLATION. Every child runs with CLAUDE_CONFIG_DIR and HOME pointed at a
// fresh temp dir, so no test ever reads the real ~/.claude or ~/.claude-st
// registries. Each stub owned.py is NOT executable and carries no shebang: the
// only way it runs is `python3 <path>`, which is what AC.2 requires.

import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const SRC_DIR = join(PLUGIN_ROOT, "adapters", "_shared", "src");
const RECEIPT_MODULE = join(SRC_DIR, "spawn_receipt.ts");
const CAPTURE_MODULE = join(SRC_DIR, "deliver_stage_capture.ts");
const DELIVER_SKILL = join(PLUGIN_ROOT, "skills", "deliver", "SKILL.md");
const DELIVER_REFERENCE = join(PLUGIN_ROOT, "docs", "deliver-reference.md");

const OWNED_REL = join("skills", "spawn-agent", "lib", "owned.py");
const CHILD_TIMEOUT_MS = 15_000;
const TEST_TIMEOUT_MS = 30_000;

const HANDLE = "surface:42";
const NAME = "dpt-worker-m1";

// ---------------------------------------------------------------------------
// Fixture builders.
// ---------------------------------------------------------------------------

interface Sandbox {
  readonly root: string;
  readonly home: string;
  readonly configDir: string;
  readonly ledger: string;
  readonly log: string;
}

function sandbox(): Sandbox {
  const root = mkdtempSync(join(tmpdir(), "ste-687-"));
  const home = join(root, "home");
  const configDir = join(root, "config");
  mkdirSync(join(configDir, "plugins"), { recursive: true });
  mkdirSync(home, { recursive: true });
  const ledger = join(root, "ledger.tsv");
  writeFileSync(ledger, "");
  return { root, home, configDir, ledger, log: join(root, "owned.log") };
}

/**
 * A stub owned.py that appends `<marker> <argv...>` to `log` and prints the
 * handle. Not executable, no shebang — `python3 <path>` is the only way in.
 */
function writeStubOwned(path: string, log: string, marker: string, handle = HANDLE): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(
    path,
    [
      "import sys",
      `with open(${JSON.stringify(log)}, "a") as f:`,
      `    f.write(${JSON.stringify(marker)} + "\\t" + "\\t".join(sys.argv) + "\\n")`,
      `print(${JSON.stringify(handle)})`,
      "sys.exit(0)",
      "",
    ].join("\n"),
  );
  chmodSync(path, 0o644);
}

/** A marketplace checkout at `mktRoot` whose agent-toolkit entry has `source`. */
function writeMarketplaceCheckout(mktRoot: string, source: string): string {
  mkdirSync(join(mktRoot, ".claude-plugin"), { recursive: true });
  writeFileSync(
    join(mktRoot, ".claude-plugin", "marketplace.json"),
    JSON.stringify(
      {
        name: "agent-toolkit",
        plugins: [{ name: "agent-toolkit", version: "0.12.1", source }],
      },
      null,
      2,
    ),
  );
  return join(mktRoot, source);
}

function writeKnownMarketplaces(sb: Sandbox, entries: Record<string, unknown>): void {
  writeFileSync(
    join(sb.configDir, "plugins", "known_marketplaces.json"),
    JSON.stringify(entries, null, 2),
  );
}

function writeInstalledPlugins(sb: Sandbox, plugins: Record<string, unknown>): void {
  writeFileSync(
    join(sb.configDir, "plugins", "installed_plugins.json"),
    JSON.stringify({ version: 2, plugins }, null, 2),
  );
}

function directoryEntry(path: string): unknown {
  return {
    source: { source: "directory", path },
    installLocation: path,
    lastUpdated: "2026-10-21T00:00:00.000Z",
  };
}

function githubEntry(installLocation: string): unknown {
  return {
    source: { source: "github", repo: "nesquikm/agent-toolkit" },
    installLocation,
    lastUpdated: "2026-10-21T00:00:00.000Z",
  };
}

function installedEntry(installPath: string): unknown {
  return [
    {
      scope: "user",
      installPath,
      version: "0.12.1",
      installedAt: "2026-10-21T00:00:00.000Z",
      lastUpdated: "2026-10-21T00:00:00.000Z",
    },
  ];
}

interface RunResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function runFrontDoor(
  sb: Sandbox,
  opts: { fifth?: string; useConfigDir?: boolean; pathPrefix?: string } = {},
): RunResult {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }
  delete env.CLAUDE_CONFIG_DIR;
  env.HOME = sb.home;
  if (opts.useConfigDir !== false) env.CLAUDE_CONFIG_DIR = sb.configDir;
  if (opts.pathPrefix !== undefined) env.PATH = `${opts.pathPrefix}:${env.PATH ?? ""}`;

  const argv = [process.execPath, "run", RECEIPT_MODULE, HANDLE, sb.ledger, NAME, "cmux"];
  if (opts.fifth !== undefined) argv.push(opts.fifth);
  const proc = Bun.spawnSync(argv, {
    cwd: sb.root,
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: CHILD_TIMEOUT_MS,
  });
  return {
    code: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

function readLog(sb: Sandbox): string[] {
  if (!existsSync(sb.log)) return [];
  return readFileSync(sb.log, "utf8").split("\n").filter((l) => l.length > 0);
}

function expectedReceipt(sb: Sandbox): string {
  return `  - spawn: handle=${HANDLE} ledger=${sb.ledger} owned=0`;
}

// ---------------------------------------------------------------------------
// AC.1 / AC.2 — the registry lookup.
// ---------------------------------------------------------------------------

describe("AC-STE-687.1/.2 — no fifth argument resolves owned.py from the registry", () => {
  test(
    "the front door with no fifth argument resolves owned.py from the plugin registry",
    () => {
      const sb = sandbox();
      const mkt = join(sb.root, "agent-toolkit-checkout");
      const pluginRoot = writeMarketplaceCheckout(mkt, "./plugins/agent-toolkit");
      const owned = join(pluginRoot, OWNED_REL);
      writeStubOwned(owned, sb.log, "directory");
      writeKnownMarketplaces(sb, { "agent-toolkit": directoryEntry(mkt) });

      const r = runFrontDoor(sb);

      expect(r.stderr).toBe("");
      expect(r.stdout.trimEnd()).toBe(expectedReceipt(sb));
      expect(r.code).toBe(0);
      const log = readLog(sb);
      expect(log.length).toBe(1);
      // python3 <owned.py> <ledger> <name> — argv[0] is the script path.
      const [marker, script, ledger, name, ...rest] = log[0]!.split("\t");
      expect(marker).toBe("directory");
      expect(script!.endsWith(join("skills", "spawn-agent", "lib", "owned.py"))).toBe(true);
      expect(ledger).toBe(sb.ledger);
      expect(name).toBe(NAME);
      expect(rest).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a directory source's plugin root is its path joined with the marketplace.json `source`",
    () => {
      const sb = sandbox();
      const mkt = join(sb.root, "checkout");
      // A non-default source: hard-coding `plugins/agent-toolkit` misses it.
      const pluginRoot = writeMarketplaceCheckout(mkt, "./elsewhere/at-plugin");
      writeStubOwned(join(pluginRoot, OWNED_REL), sb.log, "custom-source");
      // A decoy at the conventional path that must NOT be the one run.
      writeStubOwned(join(mkt, "plugins", "agent-toolkit", OWNED_REL), sb.log, "decoy");
      writeKnownMarketplaces(sb, { "agent-toolkit": directoryEntry(mkt) });

      const r = runFrontDoor(sb);

      expect(r.stdout.trimEnd()).toBe(expectedReceipt(sb));
      expect(r.code).toBe(0);
      expect(readLog(sb).map((l) => l.split("\t")[0])).toEqual(["custom-source"]);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "with no directory-source entry, installed_plugins.json installPath is used",
    () => {
      const sb = sandbox();
      const cache = join(sb.configDir, "plugins", "cache", "agent-toolkit", "agent-toolkit", "0.12.1");
      writeStubOwned(join(cache, OWNED_REL), sb.log, "install-path");
      writeKnownMarketplaces(sb, {
        "agent-toolkit": githubEntry(join(sb.configDir, "plugins", "marketplaces", "agent-toolkit")),
      });
      writeInstalledPlugins(sb, { "agent-toolkit@agent-toolkit": installedEntry(cache) });

      const r = runFrontDoor(sb);

      expect(r.stderr).toBe("");
      expect(r.stdout.trimEnd()).toBe(expectedReceipt(sb));
      expect(r.code).toBe(0);
      const log = readLog(sb);
      expect(log.length).toBe(1);
      const [marker, , ledger, name] = log[0]!.split("\t");
      expect(marker).toBe("install-path");
      expect(ledger).toBe(sb.ledger);
      expect(name).toBe(NAME);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "installPath is found under any marketplace name (`agent-toolkit@<marketplace>`)",
    () => {
      const sb = sandbox();
      const cache = join(sb.root, "cache-copy");
      writeStubOwned(join(cache, OWNED_REL), sb.log, "other-mkt");
      writeInstalledPlugins(sb, {
        "something-else@agent-toolkit": installedEntry(join(sb.root, "nope")),
        "agent-toolkit@my-mirror": installedEntry(cache),
      });

      const r = runFrontDoor(sb);

      expect(r.stdout.trimEnd()).toBe(expectedReceipt(sb));
      expect(r.code).toBe(0);
      expect(readLog(sb).map((l) => l.split("\t")[0])).toEqual(["other-mkt"]);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "the directory source is preferred over a (stale) installPath copy",
    () => {
      const sb = sandbox();
      const mkt = join(sb.root, "checkout");
      const pluginRoot = writeMarketplaceCheckout(mkt, "./plugins/agent-toolkit");
      writeStubOwned(join(pluginRoot, OWNED_REL), sb.log, "directory");
      const cache = join(sb.root, "stale-cache");
      writeStubOwned(join(cache, OWNED_REL), sb.log, "stale-cache");
      writeKnownMarketplaces(sb, { "agent-toolkit": directoryEntry(mkt) });
      writeInstalledPlugins(sb, { "agent-toolkit@agent-toolkit": installedEntry(cache) });

      const r = runFrontDoor(sb);

      expect(r.code).toBe(0);
      expect(readLog(sb).map((l) => l.split("\t")[0])).toEqual(["directory"]);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a directory source with no owned.py falls through to installPath",
    () => {
      const sb = sandbox();
      const mkt = join(sb.root, "checkout");
      writeMarketplaceCheckout(mkt, "./plugins/agent-toolkit"); // no owned.py under it
      const cache = join(sb.root, "cache");
      writeStubOwned(join(cache, OWNED_REL), sb.log, "fallback");
      writeKnownMarketplaces(sb, { "agent-toolkit": directoryEntry(mkt) });
      writeInstalledPlugins(sb, { "agent-toolkit@agent-toolkit": installedEntry(cache) });

      const r = runFrontDoor(sb);

      expect(r.stdout.trimEnd()).toBe(expectedReceipt(sb));
      expect(r.code).toBe(0);
      expect(readLog(sb).map((l) => l.split("\t")[0])).toEqual(["fallback"]);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "with CLAUDE_CONFIG_DIR unset, the registry under ~/.claude is read",
    () => {
      const sb = sandbox();
      const homeConfig = join(sb.home, ".claude");
      mkdirSync(join(homeConfig, "plugins"), { recursive: true });
      const cache = join(sb.root, "home-cache");
      writeStubOwned(join(cache, OWNED_REL), sb.log, "home-claude");
      writeFileSync(
        join(homeConfig, "plugins", "installed_plugins.json"),
        JSON.stringify({ version: 2, plugins: { "agent-toolkit@agent-toolkit": installedEntry(cache) } }),
      );

      const r = runFrontDoor(sb, { useConfigDir: false });

      expect(r.stdout.trimEnd()).toBe(expectedReceipt(sb));
      expect(r.code).toBe(0);
      expect(readLog(sb).map((l) => l.split("\t")[0])).toEqual(["home-claude"]);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "CLAUDE_CONFIG_DIR wins over ~/.claude when both carry a registry",
    () => {
      const sb = sandbox();
      const homeCache = join(sb.root, "home-cache");
      writeStubOwned(join(homeCache, OWNED_REL), sb.log, "home-claude");
      mkdirSync(join(sb.home, ".claude", "plugins"), { recursive: true });
      writeFileSync(
        join(sb.home, ".claude", "plugins", "installed_plugins.json"),
        JSON.stringify({ version: 2, plugins: { "agent-toolkit@agent-toolkit": installedEntry(homeCache) } }),
      );
      const cfgCache = join(sb.root, "cfg-cache");
      writeStubOwned(join(cfgCache, OWNED_REL), sb.log, "config-dir");
      writeInstalledPlugins(sb, { "agent-toolkit@agent-toolkit": installedEntry(cfgCache) });

      const r = runFrontDoor(sb);

      expect(r.code).toBe(0);
      expect(readLog(sb).map((l) => l.split("\t")[0])).toEqual(["config-dir"]);
    },
    TEST_TIMEOUT_MS,
  );
});

// ---------------------------------------------------------------------------
// AC.3 — refusal when nothing resolves; explicit fifth argument unchanged.
// ---------------------------------------------------------------------------

/** A `python3` shim on PATH that records any invocation and fails. */
function pythonShim(sb: Sandbox): { dir: string; log: string } {
  const dir = join(sb.root, "shim-bin");
  mkdirSync(dir, { recursive: true });
  const log = join(sb.root, "python-shim.log");
  const shim = join(dir, "python3");
  writeFileSync(shim, `#!/bin/sh\necho "$@" >> ${JSON.stringify(log)}\nexit 7\n`);
  chmodSync(shim, 0o755);
  return { dir, log };
}

describe("AC-STE-687.3 — nothing resolves ⇒ NFR-10 refusal, no child; fifth arg unchanged", () => {
  test(
    "no registry files at all ⇒ refusal naming both files and the fifth-argument remedy",
    () => {
      const sb = sandbox();
      const shim = pythonShim(sb);

      const r = runFrontDoor(sb, { pathPrefix: shim.dir });

      expect(r.code).not.toBe(0);
      expect(r.code).not.toBeNull();
      expect(r.stdout).toBe("");
      const lines = r.stderr.split("\n");
      const refusing = lines.find((l) => l.startsWith("Refusing: "));
      const remedy = lines.find((l) => l.startsWith("Remedy: "));
      const context = lines.find((l) => l.startsWith("Context: "));
      expect(refusing).toBeDefined();
      expect(remedy).toBeDefined();
      expect(context).toBeDefined();
      expect(lines.indexOf(refusing!)).toBeLessThan(lines.indexOf(remedy!));
      expect(lines.indexOf(remedy!)).toBeLessThan(lines.indexOf(context!));
      expect(r.stderr).toContain("known_marketplaces.json");
      expect(r.stderr).toContain("installed_plugins.json");
      expect(r.stderr).toMatch(/fifth argument|\[owned-check-command\]|owned-check-command/);
      expect(remedy!).toMatch(/fifth argument|owned-check-command/);
      // No child process: the python3 shim was never invoked.
      expect(existsSync(shim.log)).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "registry entries that point at no existing owned.py ⇒ the same refusal, no child",
    () => {
      const sb = sandbox();
      const shim = pythonShim(sb);
      const mkt = join(sb.root, "checkout");
      writeMarketplaceCheckout(mkt, "./plugins/agent-toolkit");
      writeKnownMarketplaces(sb, { "agent-toolkit": directoryEntry(mkt) });
      writeInstalledPlugins(sb, { "agent-toolkit@agent-toolkit": installedEntry(join(sb.root, "gone")) });

      const r = runFrontDoor(sb, { pathPrefix: shim.dir });

      expect(r.code).not.toBe(0);
      expect(r.code).not.toBeNull();
      expect(r.stdout).toBe("");
      expect(r.stderr).toMatch(/^Refusing: /m);
      expect(r.stderr).toMatch(/^Remedy: /m);
      expect(r.stderr).toMatch(/^Context: /m);
      expect(r.stderr).toContain("known_marketplaces.json");
      expect(r.stderr).toContain("installed_plugins.json");
      expect(existsSync(shim.log)).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "the refusal is not the old `spawn-agent-owned` failure",
    () => {
      const sb = sandbox();
      const r = runFrontDoor(sb);
      expect(r.code).not.toBe(0);
      expect(r.stderr).not.toContain("spawn-agent-owned");
      expect(r.stderr).toContain("known_marketplaces.json");
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "an explicit fifth argument is used unchanged, even when the registry resolves",
    () => {
      const sb = sandbox();
      const mkt = join(sb.root, "checkout");
      const pluginRoot = writeMarketplaceCheckout(mkt, "./plugins/agent-toolkit");
      writeStubOwned(join(pluginRoot, OWNED_REL), sb.log, "registry");
      writeKnownMarketplaces(sb, { "agent-toolkit": directoryEntry(mkt) });

      const explicit = join(sb.root, "my-check.sh");
      writeFileSync(
        explicit,
        `#!/bin/sh\nprintf 'explicit\\t%s\\t%s\\n' "$1" "$2" >> ${JSON.stringify(sb.log)}\necho ${JSON.stringify(HANDLE)}\nexit 0\n`,
      );
      chmodSync(explicit, 0o755);

      const r = runFrontDoor(sb, { fifth: explicit });

      expect(r.stdout.trimEnd()).toBe(expectedReceipt(sb));
      expect(r.code).toBe(0);
      expect(readLog(sb)).toEqual([`explicit\t${sb.ledger}\t${NAME}`]);
    },
    TEST_TIMEOUT_MS,
  );
});

// ---------------------------------------------------------------------------
// AC.4 — the dead default is gone.
// ---------------------------------------------------------------------------

describe("AC-STE-687.4 — no `spawn-agent-owned` literal", () => {
  test("spawn_receipt.ts no longer mentions spawn-agent-owned", () => {
    expect(readFileSync(RECEIPT_MODULE, "utf8")).not.toContain("spawn-agent-owned");
  });
});

// ---------------------------------------------------------------------------
// AC.5 — the deliver surfaces put the receipt on the supervisor's side.
// ---------------------------------------------------------------------------

/** Paragraphs (blank-line separated) of a markdown file. */
function paragraphs(path: string): string[] {
  return readFileSync(path, "utf8").split(/\n\s*\n/);
}

for (const [label, path] of [
  ["skills/deliver/SKILL.md", DELIVER_SKILL],
  ["docs/deliver-reference.md", DELIVER_REFERENCE],
] as const) {
  describe(`AC-STE-687.5 — ${label} puts the receipt on the supervisor's side`, () => {
    test("names the supervisor running spawn_receipt.ts from its own session", () => {
      const hit = paragraphs(path).some(
        (p) =>
          p.includes("spawn_receipt.ts") &&
          /supervisor/i.test(p) &&
          /own session/i.test(p),
      );
      expect(hit).toBe(true);
    });

    test("the supervisor runs it right after the spawning tool reports the worker", () => {
      const hit = paragraphs(path).some(
        (p) =>
          /supervisor/i.test(p) &&
          /spawn_receipt/.test(p) &&
          /right after|immediately after/i.test(p) &&
          /report/i.test(p),
      );
      expect(hit).toBe(true);
    });

    test("delivers the printed line in one message before the worker's first stage report", () => {
      const text = readFileSync(path, "utf8");
      expect(text).toMatch(/one message|a single message/i);
      expect(text).toMatch(/before the worker'?s first stage report/i);
    });

    test("the worker pastes the line into summary verbatim and never runs the command", () => {
      const hit = paragraphs(path).some(
        (p) =>
          /verbatim/i.test(p) &&
          /summary/.test(p) &&
          /worker[^.]*never run/i.test(p),
      );
      expect(hit).toBe(true);
    });
  });
}

// ---------------------------------------------------------------------------
// AC.6 — the grading side keeps its signatures.
// ---------------------------------------------------------------------------

describe("AC-STE-687.6 — the grading side is unchanged", () => {
  test("parseSpawnReceipt, chainRequiresSpawnReceipt and verifyDeliverStageCapture keep their arity", async () => {
    const receipt = await import(RECEIPT_MODULE);
    const capture = await import(CAPTURE_MODULE);
    expect(typeof receipt.parseSpawnReceipt).toBe("function");
    expect(receipt.parseSpawnReceipt.length).toBe(1);
    expect(typeof receipt.chainRequiresSpawnReceipt).toBe("function");
    expect(receipt.chainRequiresSpawnReceipt.length).toBe(1);
    expect(typeof capture.verifyDeliverStageCapture).toBe("function");
    expect(capture.verifyDeliverStageCapture.length).toBe(3);
    // Behaviour, not just shape: a rendered receipt line still parses.
    expect(
      receipt.parseSpawnReceipt([`  - spawn: handle=${HANDLE} ledger=/x/l.tsv owned=0`]),
    ).toEqual({ handle: HANDLE, ledger: "/x/l.tsv", owned: 0 });
    expect(receipt.chainRequiresSpawnReceipt([{ placement: "inline" }])).toBe(false);
    expect(receipt.chainRequiresSpawnReceipt([{ placement: "worker" }])).toBe(true);
  });
});
