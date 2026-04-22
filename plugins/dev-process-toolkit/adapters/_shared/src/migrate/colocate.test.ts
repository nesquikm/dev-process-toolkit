// Phase D Tier 4 test — colocate.ts (AC-48.8).

import { describe, expect, test } from "bun:test";
import { colocate } from "./colocate";

describe("colocate", () => {
  test("extracts per-FR sections from technical-spec and testing-spec; returns residual slimmed content", () => {
    const tech = [
      "# Technical Spec",
      "",
      "## 1. Architecture",
      "",
      "Cross-cutting architecture stays.",
      "",
      "## 2. Per-FR Design",
      "",
      "### FR-1 Design {#FR-1-design}",
      "",
      "FR-1 design body.",
      "",
      "### FR-2 Design {#FR-2-design}",
      "",
      "FR-2 design body.",
      "",
      "## 3. Schemas",
      "",
      "Cross-cutting schemas stay.",
      "",
    ].join("\n");
    const testing = [
      "# Testing Spec",
      "",
      "## 1. Framework",
      "",
      "bun test.",
      "",
      "## 2. Per-FR Testing",
      "",
      "### FR-1 Testing {#FR-1-testing}",
      "",
      "FR-1 testing body.",
      "",
      "### FR-2 Testing {#FR-2-testing}",
      "",
      "FR-2 testing body.",
      "",
      "## 3. Conventions",
      "",
      "Cross-cutting.",
      "",
    ].join("\n");
    const result = colocate(tech, testing);
    expect(result.perFrTech.get("FR-1")).toContain("FR-1 design body");
    expect(result.perFrTech.get("FR-2")).toContain("FR-2 design body");
    expect(result.perFrTesting.get("FR-1")).toContain("FR-1 testing body");
    expect(result.perFrTesting.get("FR-2")).toContain("FR-2 testing body");

    // Residual should have cross-cutting content AND NOT have the FR-specific headings
    expect(result.residualTech).toContain("## 1. Architecture");
    expect(result.residualTech).toContain("## 3. Schemas");
    expect(result.residualTech).not.toContain("### FR-1 Design");
    expect(result.residualTech).not.toContain("### FR-2 Design");

    expect(result.residualTesting).toContain("## 1. Framework");
    expect(result.residualTesting).toContain("## 3. Conventions");
    expect(result.residualTesting).not.toContain("### FR-1 Testing");
    expect(result.residualTesting).not.toContain("### FR-2 Testing");
  });

  test("handles absent per-FR sections gracefully — residual = input", () => {
    const tech = "# Technical Spec\n\n## 1. Architecture\n\nNo per-FR sections.\n";
    const testing = "# Testing Spec\n\n## 1. Framework\n\nNo per-FR sections.\n";
    const result = colocate(tech, testing);
    expect(result.perFrTech.size).toBe(0);
    expect(result.perFrTesting.size).toBe(0);
    expect(result.residualTech).toBe(tech);
    expect(result.residualTesting).toBe(testing);
  });

  test("removes the parent ## Per-FR section header when all children extracted", () => {
    const tech = [
      "# Technical Spec",
      "",
      "## 1. Architecture",
      "",
      "Keep.",
      "",
      "## 2. Per-FR Design",
      "",
      "### FR-1 Design {#FR-1-design}",
      "",
      "FR-1.",
      "",
      "## 3. Schemas",
      "",
      "Keep.",
      "",
    ].join("\n");
    const result = colocate(tech, "");
    // After extraction, ## 2. Per-FR Design header becomes empty — should be dropped
    expect(result.residualTech).not.toContain("## 2. Per-FR Design");
  });

  test("strips `## N. M<N> — ...` milestone blocks entirely from residual (FR-63 AC-63.1/63.2)", () => {
    const tech = [
      "# Technical Spec",
      "",
      "## 1. Architecture",
      "",
      "Cross-cutting stays.",
      "",
      "## 7. M12 — Tracker Integration (v1.15.0)",
      "",
      "M12-specific narrative.",
      "",
      "### 7.1 Architecture",
      "",
      "M12 architecture body.",
      "",
      "### 7.3 Data Model — Schemas L through P",
      "",
      "Schema L text.",
      "",
      "## 8. M13 — Parallel-safe Spec Layout (v1.16.0)",
      "",
      "M13 narrative.",
      "",
      "### 8.1 Architecture",
      "",
      "M13 body.",
      "",
      "## 9. M14 — Tracker-native Entry Paths (v1.17.0)",
      "",
      "M14 narrative.",
      "",
      "### 9.1 Architecture",
      "",
      "M14 body.",
      "",
    ].join("\n");
    const testing = [
      "# Testing Spec",
      "",
      "## 1. Framework",
      "",
      "bun test.",
      "",
      "## 6. M12 — Tracker Integration Testing",
      "",
      "### 6.1 Test Framework Additions (M12)",
      "",
      "M12 test scenarios.",
      "",
      "## 7. M13 — Parallel-safe Spec Layout Testing",
      "",
      "### 7.1 Test Framework Additions (M13)",
      "",
      "M13 test body.",
      "",
    ].join("\n");
    const result = colocate(tech, testing);
    expect(result.residualTech).not.toMatch(/^##\s+\d+\.\s+M\d+\s+—/m);
    expect(result.residualTech).not.toContain("M12 architecture body");
    expect(result.residualTech).not.toContain("M13 body");
    expect(result.residualTech).not.toContain("M14 body");
    expect(result.residualTech).toContain("## 1. Architecture");
    expect(result.residualTech).toContain("Cross-cutting stays");

    expect(result.residualTesting).not.toMatch(/^##\s+\d+\.\s+M\d+\s+—/m);
    expect(result.residualTesting).not.toContain("M12 test scenarios");
    expect(result.residualTesting).not.toContain("M13 test body");
    expect(result.residualTesting).toContain("## 1. Framework");
  });

  test("strips `# M<N>:` heading blocks too (alt milestone frame)", () => {
    const tech = [
      "# Technical Spec",
      "",
      "## 1. Architecture",
      "",
      "Keep.",
      "",
      "# M5: Some milestone",
      "",
      "Milestone body.",
      "",
      "## Sub-section inside milestone",
      "",
      "Should be dropped too.",
      "",
    ].join("\n");
    const result = colocate(tech, "");
    expect(result.residualTech).not.toContain("# M5:");
    expect(result.residualTech).not.toContain("Milestone body");
    expect(result.residualTech).toContain("Keep.");
  });
});
