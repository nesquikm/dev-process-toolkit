// STE-736 (M_b2fdc0) — AC-STE-736.1 / .2: archived plans keep working FR links.
//
// Temporary spec trees are archived through the shipped helper
// (rewriteArchiveLinks). The legs live in _m_b2fdc0_ste736_fixture.ts so the
// mutation battery (m_b2fdc0-ste-736-mutation.test.ts) runs the very same checks.

import { afterAll, describe, expect, test } from "bun:test";
import { PLUGIN_ROOT, cleanupTemps, legsFor } from "./_m_b2fdc0_ste736_fixture";

afterAll(() => cleanupTemps());

for (const ac of ["AC-STE-736.1", "AC-STE-736.2"]) {
  describe(ac, () => {
    for (const leg of legsFor(ac)) {
      test(leg.name, async () => {
        expect({ leg: leg.name, problem: await leg.check(PLUGIN_ROOT) }).toEqual({ leg: leg.name, problem: null });
      });
    }
  });
}
