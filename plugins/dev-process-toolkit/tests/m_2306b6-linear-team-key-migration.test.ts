// M_2306b6 — migration `linear-team-key`: a Linear binding holding the team's
// display name is gate-visible (probe #69) and repaired from the repository's
// own bound FR prefixes, refusing rather than guessing when it cannot.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { linearTeamKey } from "../adapters/_shared/src/migrations/entries/linear_team_key";
import { MIGRATIONS } from "../adapters/_shared/src/migrations/index";
import { runUpgradeStalenessProbe } from "../adapters/_shared/src/upgrade_staleness";
import { claudeMd } from "./_span_fixture";

function withProject<T>(team: string, frs: Array<{ dir: "" | "archive"; name: string; linear: string }>, body: (root: string) => T): T {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ltk-")));
  try {
    claudeMd(root, { mode: "linear", team, project: "DPT — Dev Process Toolkit" });
    for (const f of frs) {
      const dir = join(root, "specs", "frs", f.dir);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, f.name), `---\ntitle: x\nmilestone: M_abc123\nstatus: active\narchived_at: null\ntracker:\n  linear: ${f.linear}\ncreated_at: 2026-09-21T00:00:00Z\n---\n\n# x\n`);
    }
    mkdirSync(join(root, "specs", "frs"), { recursive: true });
    return body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
const teamLine = (root: string) => readFileSync(join(root, "CLAUDE.md"), "utf-8").split("\n").find((l) => l.startsWith("team:"));

describe("migration linear-team-key", () => {
  test("GATE-VISIBLE — probe #69 renders a row for a display-name binding (red until the entry is registered)", async () => {
    await withProject("Stellarlab Mike's Sandbox", [{ dir: "", name: "a.md", linear: "STE-618" }], async (root) => {
      const r = await runUpgradeStalenessProbe(root);
      expect(r.notes.join("\n")).toContain("linear-team-key");
    });
  });
  test("the registry carries it at the shipping version, and it keeps the registry ordered", () => {
    const e = MIGRATIONS.find((m) => m.id === "linear-team-key");
    expect(e?.introduced_in).toBe("2.90.0");
    expect(MIGRATIONS.at(-1)?.id).toBe("linear-team-key");
  });
  test("PERMIT — a key-shaped team is not detected", () => {
    withProject("STE", [{ dir: "", name: "a.md", linear: "STE-618" }], (root) => {
      expect(linearTeamKey.detect(root)).toEqual({ applies: false, evidence: [] });
    });
  });
  test("a non-Linear project is not detected", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "ltk-")));
    try {
      claudeMd(root, { mode: "jira", project: "GF" });
      expect(linearTeamKey.detect(root).applies).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  test("DETECT + APPLY — every bound prefix (active and archived) agrees: team is rewritten to the key, and detection clears", () => {
    withProject("Stellarlab Mike's Sandbox", [{ dir: "", name: "a.md", linear: "STE-618" }, { dir: "archive", name: "b.md", linear: "STE-12" }], (root) => {
      const d = linearTeamKey.detect(root);
      expect(d.applies).toBe(true);
      expect(d.evidence[0]).toContain("rewrite it to `team: STE`");
      expect(d.evidence[0]).toContain("all-caps display name");
      const a = linearTeamKey.apply!(root);
      expect(a.changed).toEqual(["CLAUDE.md"]);
      expect(teamLine(root)).toBe("team: STE");
      expect(linearTeamKey.detect(root).applies).toBe(false);
    });
  });
  test("REFUSE — no bound Linear FR: apply writes nothing and names the hand-set remedy", () => {
    withProject("Engineering", [], (root) => {
      expect(linearTeamKey.detect(root).evidence[0]).toMatch(/cannot be derived locally/);
      const a = linearTeamKey.apply!(root);
      expect(a.changed).toEqual([]);
      expect(a.summary).toMatch(/^Refusing: .*by hand/);
      expect(teamLine(root)).toBe("team: Engineering");
    });
  });
  test("REFUSE — bound prefixes disagree: never guesses one", () => {
    withProject("Engineering", [{ dir: "", name: "a.md", linear: "STE-618" }, { dir: "", name: "b.md", linear: "OPS-3" }], (root) => {
      const a = linearTeamKey.apply!(root);
      expect(a.changed).toEqual([]);
      expect(a.summary).toMatch(/disagree on the team key \(OPS, STE\)/);
      expect(teamLine(root)).toBe("team: Engineering");
    });
  });
  test("NAMED LIMIT — an all-caps display name that is not the key is NOT detected (and the entry says so)", () => {
    withProject("ENG", [{ dir: "", name: "a.md", linear: "EN-4" }], (root) => {
      expect(linearTeamKey.detect(root).applies).toBe(false);
    });
  });
});
