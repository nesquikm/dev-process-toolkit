// ULID minter with `fr_` prefix (FR-41).
//
// Format: `fr_{26 Crockford base32 chars}` — first 10 encode the current
// timestamp (ms since Unix epoch), last 16 are randomness. Crockford base32
// excludes I, L, O, U to avoid visual ambiguity.
//
// Monotonicity: within a single millisecond, the randomness is incremented
// instead of re-rolled so sort order is stable.
//
// Test determinism (NODE_ENV==="test" ONLY, following AC-39.11 discipline):
// when DPT_TEST_ULID_SEED is set, returns a sequence `fr_{seed}{22-char
// zero-padded counter}`. The counter lives on globalThis so it survives
// across module re-imports in the same process; tests reset it between cases.
//
// Collision retry: mintUniqueId accepts an `exists(id)` predicate and retries
// up to 3 times before throwing.

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // 32 chars, no I/L/O/U
export const ULID_REGEX = /^fr_[0-9A-HJKMNP-TV-Z]{26}$/;

const RANDOM_LEN = 16;
const TIMESTAMP_LEN = 10;

// Monotonic state (production path): last-minted timestamp + last-minted
// randomness. If a second mint hits the same ts, we increment the randomness.
let lastTs = -1;
let lastRandomness: number[] = new Array(RANDOM_LEN).fill(0);

function encodeTimestamp(ms: number): string {
  let n = ms;
  const out: string[] = new Array(TIMESTAMP_LEN);
  for (let i = TIMESTAMP_LEN - 1; i >= 0; i--) {
    out[i] = CROCKFORD[n % 32]!;
    n = Math.floor(n / 32);
  }
  return out.join("");
}

function randomnessCharsToString(chars: number[]): string {
  return chars.map((i) => CROCKFORD[i]!).join("");
}

function rollRandomness(): number[] {
  const buf = new Uint8Array(RANDOM_LEN);
  crypto.getRandomValues(buf);
  const out: number[] = new Array(RANDOM_LEN);
  for (let i = 0; i < RANDOM_LEN; i++) out[i] = buf[i]! % 32;
  return out;
}

function incrementRandomness(chars: number[]): number[] {
  const out = chars.slice();
  for (let i = RANDOM_LEN - 1; i >= 0; i--) {
    if (out[i]! < 31) {
      out[i] = out[i]! + 1;
      return out;
    }
    out[i] = 0;
  }
  // Overflow: extremely unlikely (2^80 mints in one ms) — reseed.
  return rollRandomness();
}

function isValidCrockfordSeed(seed: string): boolean {
  if (seed.length === 0 || seed.length > TIMESTAMP_LEN) return false;
  for (const ch of seed) if (!CROCKFORD.includes(ch)) return false;
  return true;
}

function testModeCounter(): number {
  const g = globalThis as Record<string, unknown>;
  const prev = typeof g["__dpt_ulid_test_counter"] === "number" ? (g["__dpt_ulid_test_counter"] as number) : 0;
  const next = prev + 1;
  g["__dpt_ulid_test_counter"] = next;
  return next;
}

function encodeTestCounter(n: number, width: number): string {
  let v = n;
  const out: string[] = new Array(width);
  for (let i = width - 1; i >= 0; i--) {
    out[i] = CROCKFORD[v % 32]!;
    v = Math.floor(v / 32);
  }
  return out.join("");
}

export function mintId(): string {
  const testMode = process.env["NODE_ENV"] === "test";
  const seed = testMode ? process.env["DPT_TEST_ULID_SEED"] : undefined;

  if (testMode && seed !== undefined) {
    if (!isValidCrockfordSeed(seed)) {
      throw new Error(
        `ulid: DPT_TEST_ULID_SEED="${seed}" contains non-Crockford characters (excludes I/L/O/U) or exceeds ${TIMESTAMP_LEN} chars`,
      );
    }
    const counter = testModeCounter();
    const pad = 26 - seed.length;
    return `fr_${seed}${encodeTestCounter(counter, pad)}`;
  }

  const ts = Date.now();
  if (ts === lastTs) {
    lastRandomness = incrementRandomness(lastRandomness);
  } else {
    lastTs = ts;
    lastRandomness = rollRandomness();
  }
  return `fr_${encodeTimestamp(ts)}${randomnessCharsToString(lastRandomness)}`;
}

/**
 * Mint a ULID guaranteed not to already exist per the caller's predicate.
 * `exists` MUST be synchronous — async predicates would silently fall
 * through the collision retry. Callers with async lookups resolve the
 * Promise before invoking this.
 */
export function mintUniqueId(options: { exists: (id: string) => boolean }): string {
  for (let attempt = 0; attempt < 3; attempt++) {
    const id = mintId();
    if (!options.exists(id)) return id;
  }
  throw new Error(
    "ulid: mintUniqueId failed after 3 collisions; the filesystem reports every minted ID already exists",
  );
}
