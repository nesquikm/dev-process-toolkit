// m137-advisory-notes-store — coverage for the advisory-note store.
//
// WHY THIS FILE EXISTS. `implement_advisory_notes.ts` shipped with ZERO test
// references anywhere in the plugin. It is a WRITE PATH — it creates a
// directory, appends to a file, and reads the bytes back to prove the citation
// the step-14 report prints. An unexercised write path is the worst kind of
// uncovered module: the first execution is in a consumer's repository.
//
// The module it replaced was itself the lesson. `docs/implement-reference.md`
// described this formatter in the present tense from M40 until M137 shipped
// it, and for those 97 milestones the module did not exist. A doc can describe
// a module nobody wrote; a test cannot.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ADVISORY_NOTES_HEADING,
  ADVISORY_NOTES_SHOWN,
  NO_ADVISORY_NOTES,
  type AdvisoryNote,
  persistAdvisoryNotes,
  renderAdvisoryNotes,
  renderAdvisoryNotesFull,
} from "../adapters/_shared/src/implement_advisory_notes";

const roots: string[] = [];
function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "dpt-advisory-"));
  roots.push(root);
  return root;
}
function cleanup(): void {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
}

function note(n: number): AdvisoryNote {
  return { concern: `concern ${n}`, rationale: `rationale ${n}` } as AdvisoryNote;
}
function notes(count: number): AdvisoryNote[] {
  return Array.from({ length: count }, (_, i) => note(i + 1));
}

describe("the advisory store is written before it is cited", () => {
  test("it creates the ledger path and returns a citation relative to the root", () => {
    const root = makeRoot();
    const result = persistAdvisoryNotes(root, notes(2), { at: "2026-01-01T00:00:00Z" });
    expect(result.appended).toBe(2);
    expect(result.verified).toBe(true);
    expect(existsSync(result.path), "the cited path must exist on disk").toBe(true);
    expect(result.citation, "the citation is relative, for printing").not.toContain(root);
    expect(readFileSync(result.path, "utf-8")).toContain("concern 1");
    cleanup();
  });

  test("EVERY note reaches the store, not just the displayed ones", () => {
    // The whole point of the store: the report shows a bounded few, the record
    // keeps all of them. A store that dropped the tail would make the bounded
    // display a data loss rather than a summary, and the report would still
    // look correct.
    const root = makeRoot();
    const many = notes(ADVISORY_NOTES_SHOWN + 5);
    const result = persistAdvisoryNotes(root, many, { at: "2026-01-01T00:00:00Z" });
    const written = readFileSync(result.path, "utf-8");
    expect(result.appended).toBe(many.length);
    for (const n of many) {
      expect(written, `${n.concern} must be in the durable record`).toContain(n.concern);
    }
  });

  test("a second run APPENDS — it does not overwrite the first run's record", () => {
    const root = makeRoot();
    persistAdvisoryNotes(root, [note(1)], { at: "2026-01-01T00:00:00Z", label: "first" });
    const second = persistAdvisoryNotes(root, [note(2)], { at: "2026-01-02T00:00:00Z", label: "second" });
    const written = readFileSync(second.path, "utf-8");
    expect(written, "the earlier run's note survives").toContain("concern 1");
    expect(written, "and the later one is there too").toContain("concern 2");
    expect(written).toContain("first");
    expect(written).toContain("second");
  });

  test("an empty list writes NOTHING and still returns a usable verdict", () => {
    // Not a no-op by accident: an empty run must not create an empty ledger
    // file that later reads as "a run happened and found nothing".
    const root = makeRoot();
    const result = persistAdvisoryNotes(root, [], { at: "2026-01-01T00:00:00Z" });
    expect(result.appended).toBe(0);
    expect(result.verified).toBe(true);
    expect(existsSync(result.path), "no notes means no file").toBe(false);
  });

  test("an unwritable store FAILS LOUDLY — it never returns a verified citation", () => {
    // HONEST SCOPE. This does NOT isolate the read-back arm: making the file
    // unreadable makes `appendFileSync` fail first, so the throw comes from
    // the write, not from the proof. The property actually pinned here is the
    // one that matters to a caller — a store it could not write never comes
    // back `verified: true` with a citation the report would then print.
    // Isolating the read-back arm needs a path that accepts a write and
    // refuses a read, which no ordinary POSIX mode provides.
    const root = makeRoot();
    const first = persistAdvisoryNotes(root, [note(1)], { at: "2026-01-01T00:00:00Z" });
    chmodSync(first.path, 0o000);
    let threw: Error | null = null;
    try {
      persistAdvisoryNotes(root, [note(2)], { at: "2026-01-02T00:00:00Z" });
    } catch (error) {
      threw = error as Error;
    } finally {
      chmodSync(first.path, 0o644);
    }
    // Running as root defeats the permission, and a green "it threw" there
    // would be a lie. Skip loudly rather than assert something untrue.
    if (threw === null) {
      expect(process.getuid?.(), "only root may write an unwritable file").toBe(0);
    } else {
      expect(threw.message, "the failure must name the path").toContain("advisory-notes.md");
    }
    cleanup();
  });
});

describe("the bounded display always points at the full record", () => {
  test("a non-empty list WITHOUT a citation is refused", () => {
    // The data-loss guard. A bounded display whose pointer to the rest is
    // missing is worse than no display: it reads as the complete set.
    expect(() => renderAdvisoryNotes(notes(4), null)).toThrow(/citation/i);
    expect(() => renderAdvisoryNotes(notes(4), "   ")).toThrow(/citation/i);
  });

  test("an empty list renders the no-notes line and needs no citation", () => {
    expect(renderAdvisoryNotes([], null)).toEqual([ADVISORY_NOTES_HEADING, NO_ADVISORY_NOTES]);
  });

  test("the display is BOUNDED and names the total it is a subset of", () => {
    const total = ADVISORY_NOTES_SHOWN + 4;
    const rendered = renderAdvisoryNotes(notes(total), ".dpt/ledger/advisory-notes.md").join("\n");
    expect(rendered).toContain(String(ADVISORY_NOTES_SHOWN));
    expect(rendered, "the reader must learn how many they are NOT seeing").toContain(String(total));
    expect(rendered).toContain(".dpt/ledger/advisory-notes.md");
    // Non-vacuity: the bound must actually bind.
    expect(renderAdvisoryNotesFull(notes(total)).length).toBeGreaterThan(rendered.split("\n").length);
  });

  test("a list at or under the bound is shown whole", () => {
    const rendered = renderAdvisoryNotes(notes(ADVISORY_NOTES_SHOWN), "x.md").join("\n");
    for (let i = 1; i <= ADVISORY_NOTES_SHOWN; i++) {
      expect(rendered).toContain(`concern ${i}`);
    }
  });
});
