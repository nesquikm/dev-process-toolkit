// lock.ts — the tracker-less lock front door (STE-731 AC-STE-731.4).
//
//   bun run adapters/_shared/src/lock.ts claim <projectRoot> <id> <branch>
//   bun run adapters/_shared/src/lock.ts release <projectRoot> <id>
//
// Both verbs run through `LocalProvider`, so the lock commit carries only the
// lock path and every foreign staged change stays staged. On success the new
// commit's sha is printed on stdout. Any other argv — or a claim the provider
// does not grant — is refused in the NFR-10 shape on stderr, with stdout empty
// and nothing committed.

import { $ } from "bun";

import { LocalProvider } from "./local_provider";

const USAGE =
  "Remedy: bun run adapters/_shared/src/lock.ts claim <projectRoot> <id> <branch> | release <projectRoot> <id>";

function refuse(message: string, context: string, remedy: string = USAGE): void {
  console.error([`Refusing: ${message}`, remedy, `Context: ${context}`].join("\n"));
  process.exitCode = 1;
}

async function headSha(root: string): Promise<string> {
  return (await $`git rev-parse HEAD`.cwd(root).quiet().text()).trim();
}

// A lock id names one file directly under the lock store: no separator, no
// `..` segment, no leading `-`, nothing empty.
function isSafeLockId(id: string): boolean {
  return /^[A-Za-z0-9_][A-Za-z0-9._-]*$/.test(id) && id !== "." && id !== "..";
}

async function main(argv: string[]): Promise<void> {
  const [verb, root, id, branch, ...rest] = argv;
  if ((verb === "claim" || verb === "release") && id !== undefined && !isSafeLockId(id)) {
    refuse(
      `to use ${JSON.stringify(id)} as a lock id — it must name one file under .dpt/locks/.`,
      `mode=none, phase=lock-${verb}, id=${JSON.stringify(id)}`,
      "Remedy: pass a plain id of letters, digits, '.', '_' or '-' that does not start with '-' or '.'.",
    );
    return;
  }
  if (verb === "claim" && root && id && branch && rest.length === 0) {
    const r = await new LocalProvider({ repoRoot: root }).claimLock(id, branch);
    if (r.kind !== "claimed") {
      refuse(
        `to report a claim the provider did not grant (${r.kind}: ${r.message}).`,
        `mode=none, phase=lock-claim, id=${id}, branch=${branch}, outcome=${r.kind}`,
        "Remedy: release the existing lock first, or claim on the branch that holds it.",
      );
      return;
    }
    console.log(await headSha(root));
    return;
  }
  if (verb === "release" && root && id && branch === undefined) {
    const before = await headSha(root);
    const r = await new LocalProvider({ repoRoot: root }).releaseLock(id);
    const after = await headSha(root);
    if (r === "transitioned" && after !== before) console.log(after);
    return;
  }
  refuse(
    "to run a lock verb with this argument list.",
    `mode=none, phase=lock-cli, argv=${JSON.stringify(argv)}`,
  );
}

if (import.meta.main) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
