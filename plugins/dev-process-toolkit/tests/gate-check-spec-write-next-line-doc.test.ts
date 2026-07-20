import { describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// STE-380 — `spec_write_next_line_doc` gate-check probe (#66) + doc-shape ACs.
//
// AC-STE-380.4 + AC-STE-380.6: fixture matrix for
// `runSpecWriteNextLineDocProbe(projectRoot)` from
// `adapters/_shared/src/spec_write_next_line_doc.ts` — faithful fixture
// passes; missing rule paragraph fails naming the missing literal; retired
// discriminator sentence reintroduced fails (tripwire); absent SKILL.md ⇒
// vacuous pass — plus a live-tree case against this repo's actual SKILL.md.
//
// AC-STE-380.1/.2: live-tree literal checks on the re-keyed § 7 rule
// paragraph + lockstep tail-template lines in skills/spec-write/SKILL.md.
// AC-STE-380.3: /implement lede reword (probe #31 structure preserved).
// AC-STE-380.5: probe #66 registration in skills/gate-check/SKILL.md +
// README probe-count bump 65 → 66.
// AC-STE-380.7: cross-surface probe-count calibration coherence.
//
// The probe is imported dynamically inside the fixture tests so the
// live-tree doc-shape assertions report their own RED independently of
// the (not-yet-created) probe module.

const pluginRoot = join(import.meta.dir, "..");
const repoRoot = join(pluginRoot, "..", "..");
const specWriteSkill = join(pluginRoot, "skills", "spec-write", "SKILL.md");
const implementSkill = join(pluginRoot, "skills", "implement", "SKILL.md");
const gateCheckSkill = join(pluginRoot, "skills", "gate-check", "SKILL.md");
const readmePath = join(repoRoot, "README.md");

// ---------------------------------------------------------------------------
// Canonical literals — pinned by specs/frs/STE-380.md § Technical Design.
// ---------------------------------------------------------------------------

const RULE_NAME_LITERAL = "**Next-line variant rule.**";
const DISCRIMINATOR_LITERAL = "milestone binding";
const M_FORM_COMMAND_LITERAL = "Run /dev-process-toolkit:implement M<N>";
const PER_DISTINCT_MILESTONE_LITERAL = "per distinct milestone";
const M_FORM_TEMPLATE_LINE =
  "Next: Run `/dev-process-toolkit:implement M<N>` when specs are ready.";
const FR_FORM_TEMPLATE_LINE =
  "Next: Run `/dev-process-toolkit:implement <tracker-id>` when specs are ready.";
const M_FORM_COMMENT_FRAGMENT =
  "milestone-bound run (new FR with milestone: frontmatter)";
const FR_FORM_COMMENT_FRAGMENT = "milestone-less new FR";
const RETIRED_DISCRIMINATOR_LITERAL =
  "When the run created a single new FR, recommend the FR-id form";

const CANONICAL_RULE_PARAGRAPH =
  "**Next-line variant rule.** The discriminator is **milestone binding**, " +
  "not new-FR presence. When the run wrote ≥ 1 new FR whose frontmatter " +
  "carries `milestone: M<N>`, recommend the milestone form " +
  "(`Run /dev-process-toolkit:implement M<N>`) — the milestone is the unit " +
  "of shipping, and the M-form runs the Phase 5 close the FR-id form " +
  "silent-skips (`skills/implement/SKILL.md` § Invocation forms). Render " +
  "one `Next:` line per distinct milestone when a run's new FRs span " +
  "several. When a new FR carries no `milestone:` binding, recommend the " +
  "FR-id form (`Run /dev-process-toolkit:implement <tracker-id>`) for that " +
  "FR. Cross-cutting-only runs (no new FR file written) keep the M<N> " +
  "form. Hybrid runs (new FR + cross-cutting edit) follow the new FR's " +
  "milestone binding.";

const TEMPLATE_BLOCK = [
  "```",
  `${M_FORM_TEMPLATE_LINE}   <!-- ${M_FORM_COMMENT_FRAGMENT} or cross-cutting-only run: recommend the M<N> form (milestone close). -->`,
  `${FR_FORM_TEMPLATE_LINE}   <!-- ${FR_FORM_COMMENT_FRAGMENT}: recommend the FR-id form (single-FR ship; no milestone to close). -->`,
  "```",
].join("\n");

const FAITHFUL_BODY = [
  "---",
  "name: spec-write",
  "---",
  "",
  "# Spec Write",
  "",
  "## 7. Closing summary",
  "",
  "Reference shape:",
  "",
  TEMPLATE_BLOCK,
  "",
  CANONICAL_RULE_PARAGRAPH,
  "",
].join("\n");

// Rule paragraph absent entirely (template lines alone survive).
const MISSING_PARAGRAPH_BODY = [
  "---",
  "name: spec-write",
  "---",
  "",
  "# Spec Write",
  "",
  "## 7. Closing summary",
  "",
  TEMPLATE_BLOCK,
  "",
].join("\n");

// Faithful body + the retired discriminator sentence reintroduced.
const TRIPWIRE_BODY = [
  FAITHFUL_BODY,
  `${RETIRED_DISCRIMINATOR_LITERAL} (\`Run /dev-process-toolkit:implement <tracker-id>\`).`,
  "",
].join("\n");

// Faithful paragraph but the M-form template `Next:` line dropped.
const MISSING_M_TEMPLATE_BODY = [
  "---",
  "name: spec-write",
  "---",
  "",
  "# Spec Write",
  "",
  "## 7. Closing summary",
  "",
  "```",
  `${FR_FORM_TEMPLATE_LINE}   <!-- ${FR_FORM_COMMENT_FRAGMENT}: recommend the FR-id form (single-FR ship; no milestone to close). -->`,
  "```",
  "",
  CANONICAL_RULE_PARAGRAPH,
  "",
].join("\n");

interface ProbeViolation {
  file: string;
  line: number;
  reason: string;
  note: string;
  message: string;
}

interface ProbeReport {
  violations: ProbeViolation[];
}

async function loadProbe(): Promise<(root: string) => Promise<ProbeReport>> {
  const mod = await import("../adapters/_shared/src/spec_write_next_line_doc");
  expect(typeof mod.runSpecWriteNextLineDocProbe).toBe("function");
  return mod.runSpecWriteNextLineDocProbe;
}

function makeFixture(opts: { specWriteBody?: string }): {
  root: string;
  cleanup: () => void;
} {
  const root = mkdtempSync(join(tmpdir(), "spec-write-next-line-doc-"));
  if (opts.specWriteBody !== undefined) {
    const dir = join(
      root,
      "plugins",
      "dev-process-toolkit",
      "skills",
      "spec-write",
    );
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), opts.specWriteBody);
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

// ---------------------------------------------------------------------------
// AC-STE-380.4 + AC-STE-380.6 — probe fixture matrix.
// ---------------------------------------------------------------------------

describe("AC-STE-380.4 — spec_write_next_line_doc probe fixture matrix", () => {
  test("faithful fixture (canonical paragraph + both template lines) ⇒ zero violations", async () => {
    const probe = await loadProbe();
    const fx = makeFixture({ specWriteBody: FAITHFUL_BODY });
    try {
      const report = await probe(fx.root);
      expect(report.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("fixture missing the rule paragraph ⇒ violation naming the missing literal", async () => {
    const probe = await loadProbe();
    const fx = makeFixture({ specWriteBody: MISSING_PARAGRAPH_BODY });
    try {
      const report = await probe(fx.root);
      expect(report.violations.length).toBeGreaterThanOrEqual(1);
      const joined = report.violations
        .map((v) => `${v.reason}\n${v.message}`)
        .join("\n");
      expect(joined).toContain("Next-line variant rule");
    } finally {
      fx.cleanup();
    }
  });

  test("fixture with the retired discriminator sentence reintroduced ⇒ tripwire violation on the matched line", async () => {
    const probe = await loadProbe();
    const fx = makeFixture({ specWriteBody: TRIPWIRE_BODY });
    try {
      const report = await probe(fx.root);
      expect(report.violations.length).toBeGreaterThanOrEqual(1);
      const tripwire = report.violations.find((v) =>
        `${v.reason}\n${v.message}`.includes(
          "single new FR",
        ),
      );
      expect(tripwire).toBeDefined();
      // Tripwire line is the matched line, not a file-level 0.
      const expectedLine =
        TRIPWIRE_BODY.split("\n").findIndex((l) =>
          l.includes(RETIRED_DISCRIMINATOR_LITERAL),
        ) + 1;
      expect(tripwire!.line).toBe(expectedLine);
    } finally {
      fx.cleanup();
    }
  });

  test("fixture missing the M-form template `Next:` line ⇒ violation naming it", async () => {
    const probe = await loadProbe();
    const fx = makeFixture({ specWriteBody: MISSING_M_TEMPLATE_BODY });
    try {
      const report = await probe(fx.root);
      expect(report.violations.length).toBeGreaterThanOrEqual(1);
      const joined = report.violations
        .map((v) => `${v.reason}\n${v.message}`)
        .join("\n");
      expect(joined).toContain("Next:");
      expect(joined).toContain("M<N>");
    } finally {
      fx.cleanup();
    }
  });

  test("absent SKILL.md ⇒ vacuous pass (downstream toolkit consumers)", async () => {
    const probe = await loadProbe();
    const fx = makeFixture({});
    try {
      const report = await probe(fx.root);
      expect(report.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("violations carry NFR-10 canonical `file:line — reason` notes", async () => {
    const probe = await loadProbe();
    const fx = makeFixture({ specWriteBody: MISSING_PARAGRAPH_BODY });
    try {
      const report = await probe(fx.root);
      expect(report.violations.length).toBeGreaterThanOrEqual(1);
      for (const v of report.violations) {
        expect(v.note).toMatch(/^.+:\d+ — .+/);
        expect(typeof v.message).toBe("string");
        expect(v.message.length).toBeGreaterThan(0);
      }
    } finally {
      fx.cleanup();
    }
  });
});

describe("AC-STE-380.6 — live-tree case", () => {
  test("probe passes against this repo's actual post-edit spec-write SKILL.md", async () => {
    const probe = await loadProbe();
    const report = await probe(repoRoot);
    expect(report.violations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-380.1 — § 7 rule re-keyed on milestone binding.
// ---------------------------------------------------------------------------

describe("AC-STE-380.1 — spec-write § 7 rule discriminates on milestone binding", () => {
  const body = () => readFileSync(specWriteSkill, "utf-8");

  test("rule paragraph is present and keyed on `milestone binding`", () => {
    const b = body();
    expect(b).toContain(RULE_NAME_LITERAL);
    expect(b).toContain(DISCRIMINATOR_LITERAL);
    expect(b).toContain(M_FORM_COMMAND_LITERAL);
  });

  test("multi-milestone runs render one `Next:` line per distinct milestone", () => {
    expect(body()).toContain(PER_DISTINCT_MILESTONE_LITERAL);
  });

  test("retired new-FR-presence discriminator sentence is removed", () => {
    expect(body()).not.toContain(RETIRED_DISCRIMINATOR_LITERAL);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-380.2 — tail-template lockstep.
// ---------------------------------------------------------------------------

describe("AC-STE-380.2 — § 7 tail template Next: lines update in lockstep", () => {
  const body = () => readFileSync(specWriteSkill, "utf-8");

  test("M-form template line present, annotated as the milestone-bound shape", () => {
    const b = body();
    expect(b).toContain(M_FORM_TEMPLATE_LINE);
    expect(b).toContain(M_FORM_COMMENT_FRAGMENT);
  });

  test("FR-id template line present, annotated as the milestone-less shape", () => {
    const b = body();
    expect(b).toContain(FR_FORM_TEMPLATE_LINE);
    expect(b).toContain(FR_FORM_COMMENT_FRAGMENT);
  });

  test("both-shapes contract preserved (AC-STE-181.3): two template Next: lines", () => {
    const templateNextLines = body()
      .split("\n")
      .filter((l) => l.startsWith("Next: Run `/dev-process-toolkit:implement"));
    expect(templateNextLines.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-380.3 — /implement lede reword, probe #31 structure preserved.
// ---------------------------------------------------------------------------

describe("AC-STE-380.3 — /implement Invocation-forms lede reword", () => {
  const body = () => readFileSync(implementSkill, "utf-8");

  test("lede no longer names the FR-id form `/spec-write`'s next step", () => {
    expect(body()).not.toContain("`/spec-write`'s next step");
  });

  test("smoke-driver reference is kept", () => {
    expect(body()).toContain("smoke driver");
  });

  test("probe #31 pinned structure survives (heading + Phase 5 divergence literals)", () => {
    const b = body();
    expect(b).toMatch(/^## Invocation forms$/m);
    expect(b).toContain("silent-skip");
    expect(b).toContain("runs it");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-380.5 — probe #66 registration + README probe-count bump.
// ---------------------------------------------------------------------------

describe("AC-STE-380.5 — probe #66 registered in gate-check SKILL.md", () => {
  const probe66Block = (): string => {
    const b = readFileSync(gateCheckSkill, "utf-8");
    const match = b.match(/^66\. \*\*[\s\S]*?(?=^67\. \*\*|^## )/m);
    return match?.[0] ?? "";
  };

  test("a numbered #66 entry exists and names the probe module", () => {
    const block = probe66Block();
    expect(block).not.toBe("");
    expect(block).toContain("spec_write_next_line_doc");
    expect(block).toContain("runSpecWriteNextLineDocProbe");
    expect(block).toContain(
      "adapters/_shared/src/spec_write_next_line_doc.ts",
    );
  });

  test("entry carries severity, test-coverage line, and sibling-shape references to #31 and #47", () => {
    const block = probe66Block();
    expect(block).toContain("Severity: error");
    expect(block).toContain(
      "tests/gate-check-spec-write-next-line-doc.test.ts",
    );
    expect(block).toContain("#31");
    expect(block).toContain("#47");
  });

  test("README probe count is current (72 after M110 added #70/#71/#72)", () => {
    // Recalibrated 68 → 69: M109/STE-394 added #69 upgrade_staleness on top
    // of M108/STE-393's #68 migration_coverage.
    const readme = readFileSync(readmePath, "utf-8");
    expect(readme).toContain("72 numbered");
    expect(readme).not.toContain("68 numbered");
    expect(readme).toMatch(/layers 72 probes/);
    expect(readme).not.toMatch(/layers 68 probes/);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-380.7 — cross-surface probe-count calibration coherence.
// ---------------------------------------------------------------------------

describe("AC-STE-380.7 — probe-count calibration stays coherent across surfaces", () => {
  test("highest numbered gate-check probe is 72 and README agrees", () => {
    // Recalibrated 68 → 69: M109/STE-394 added #69 upgrade_staleness.
    const b = readFileSync(gateCheckSkill, "utf-8");
    const numbers = [...b.matchAll(/^(\d+)\. \*\*/gm)].map((m) =>
      Number(m[1]),
    );
    expect(numbers.length).toBeGreaterThan(0);
    expect(Math.max(...numbers)).toBe(72);

    const readme = readFileSync(readmePath, "utf-8");
    const counted = readme.match(/(\d+) numbered `\/gate-check` probes/);
    expect(counted).not.toBeNull();
    expect(Number(counted![1])).toBe(72);
  });
});
