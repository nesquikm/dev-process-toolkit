// STE-663 — front door for `videoReadiness` (AC-STE-663.7).
//
//   bun run video_readiness.ts <projectRoot>
//
// Prints `ready`, or one reason per line, and exits 0 either way: readiness is
// a report, not a gate. `projectRoot` defaults to `process.cwd()`.

import { resolve } from "node:path";
import { videoReadiness } from "./video/readiness";

if (import.meta.main) {
  const projectRoot = resolve(process.argv[2] ?? process.cwd());
  const result = videoReadiness(projectRoot);
  console.log(result.ready ? "ready" : result.reasons.join("\n"));
}
