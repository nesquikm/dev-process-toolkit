// colocate.ts — extract per-FR technical-design + testing sections from
// technical-spec.md / testing-spec.md and merge them into FR bodies; return
// residual cross-cutting content (AC-48.8).
//
// Extraction grammar: any `### FR-N <any title> {#FR-N-<suffix>}` heading is
// treated as a per-FR section. The block extends to the next `##` or `###`
// heading. After extraction, parent `##` sections whose only children were
// per-FR blocks become empty and are dropped from the residual.

export interface ColocateResult {
  perFrTech: Map<string, string>;
  perFrTesting: Map<string, string>;
  residualTech: string;
  residualTesting: string;
}

interface Section {
  level: number; // 2 = ##, 3 = ###
  headingLine: string;
  lines: string[]; // content lines (not including heading)
  isPerFr: boolean;
  perFrId?: string;
}

const FR_SUBHEADING_RE = /^###\s+(FR-\d+)\b.*$/;

function parseSections(markdown: string): { preamble: string[]; sections: Section[] } {
  const lines = markdown.split("\n");
  const sections: Section[] = [];
  const preamble: string[] = [];
  let i = 0;
  // Collect preamble (everything before the first ## heading)
  while (i < lines.length) {
    const line = lines[i]!;
    if (/^##\s+/.test(line)) break;
    preamble.push(line);
    i++;
  }
  // Parse sections
  while (i < lines.length) {
    const line = lines[i]!;
    const isH2 = /^##\s+/.test(line);
    const isH3 = /^###\s+/.test(line);
    if (!isH2 && !isH3) {
      i++;
      continue;
    }
    const level = isH2 ? 2 : 3;
    const headingLine = line;
    // Collect content until next ## or ### at same/higher level
    const content: string[] = [];
    let j = i + 1;
    while (j < lines.length) {
      const l = lines[j]!;
      if (/^##\s+/.test(l)) break;
      if (/^###\s+/.test(l) && level === 3) break;
      if (/^###\s+/.test(l) && level === 2) break;
      content.push(l);
      j++;
    }
    const perFrMatch = isH3 ? FR_SUBHEADING_RE.exec(line) : null;
    sections.push({
      level,
      headingLine,
      lines: content,
      isPerFr: perFrMatch !== null,
      perFrId: perFrMatch?.[1],
    });
    i = j;
  }
  return { preamble, sections };
}

function extractPerFr(sections: Section[]): {
  perFrMap: Map<string, string>;
  kept: Section[];
} {
  const perFrMap = new Map<string, string>();
  const kept: Section[] = [];
  // Track which H2 sections end up with no non-per-FR children — those become empty
  // after extraction and should be dropped.
  const h2Index = new Map<number, { hasNonPerFrContent: boolean }>();
  let currentH2: number | null = null;
  for (let idx = 0; idx < sections.length; idx++) {
    const s = sections[idx]!;
    if (s.level === 2) {
      currentH2 = idx;
      const hasInlineContent = s.lines.some((l) => l.trim().length > 0);
      h2Index.set(idx, { hasNonPerFrContent: hasInlineContent });
      kept.push(s);
      continue;
    }
    // H3
    if (s.isPerFr && s.perFrId) {
      const prev = perFrMap.get(s.perFrId) ?? "";
      const block = s.lines.join("\n").trim();
      perFrMap.set(s.perFrId, prev.length > 0 ? `${prev}\n\n${block}` : block);
      // do not push — extracted
    } else {
      kept.push(s);
      if (currentH2 !== null) {
        const info = h2Index.get(currentH2);
        if (info) info.hasNonPerFrContent = true;
      }
    }
  }
  // Drop H2 sections that now have no remaining H3 children AND no inline content
  const finalKept: Section[] = [];
  for (let idx = 0; idx < kept.length; idx++) {
    const s = kept[idx]!;
    if (s.level === 2) {
      // Look ahead to count H3 children in the kept list
      let h3Count = 0;
      let k = idx + 1;
      while (k < kept.length && kept[k]!.level === 3) {
        h3Count++;
        k++;
      }
      const inline = s.lines.some((l) => l.trim().length > 0);
      if (!inline && h3Count === 0) {
        // drop this H2 entirely
        continue;
      }
    }
    finalKept.push(s);
  }
  return { perFrMap, kept: finalKept };
}

function render(preamble: string[], sections: Section[]): string {
  const out: string[] = [];
  out.push(...preamble);
  for (const s of sections) {
    // Ensure a blank line separates sections
    if (out.length > 0 && out[out.length - 1]!.trim() !== "") out.push("");
    out.push(s.headingLine);
    out.push(...s.lines);
  }
  let text = out.join("\n");
  // Collapse 3+ blank lines to 2
  text = text.replace(/\n{3,}/g, "\n\n");
  if (!text.endsWith("\n")) text += "\n";
  return text;
}

export function colocate(technicalSpec: string, testingSpec: string): ColocateResult {
  const tech = parseSections(technicalSpec);
  const { perFrMap: perFrTech, kept: keptTech } = extractPerFr(tech.sections);
  const testing = parseSections(testingSpec);
  const { perFrMap: perFrTesting, kept: keptTesting } = extractPerFr(testing.sections);
  return {
    perFrTech,
    perFrTesting,
    residualTech: technicalSpec === "" ? "" : render(tech.preamble, keptTech),
    residualTesting: testingSpec === "" ? "" : render(testing.preamble, keptTesting),
  };
}
