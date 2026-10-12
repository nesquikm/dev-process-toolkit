// STE-663 — shared shape helpers for the video YAML parsers (config + style).
//
// Both `parseVideoConfig` (AC-STE-663.4) and `parseVideoStyle` (AC-STE-663.5)
// refuse in the NFR-10 canonical shape (Refusing / Remedy / Context) naming the
// offending key path, and never echo key values. The refusal text and the
// closed-key walk live here once.

export type Obj = Record<string, unknown>;

/** An NFR-10 canonical refusal (Refusing / Remedy / Context) as an Error. */
export function nfr10Refusal(reason: string, remedy: string, context: string): Error {
  return new Error([`Refusing: ${reason}`, `Remedy: ${remedy}`, `Context: ${context}`].join("\n"));
}

export function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** True when `key` is set to something other than undefined / null. */
export function isPresent(block: Obj, key: string): boolean {
  return key in block && block[key] !== undefined && block[key] !== null;
}

/** Dotted key path; an empty prefix means the document root. */
export function keyPath(prefix: string, key: string): string {
  return prefix ? `${prefix}.${key}` : key;
}

/** NFR-10 refusal for a malformed video YAML file. Never echoes key values. */
export class VideoShapeError extends Error {
  readonly keyPath: string;
  constructor(subject: "config" | "style", file: string, keyPath: string, reason: string, remedy: string) {
    super(
      [
        `Refusing: video ${subject} key \`${keyPath}\` ${reason}`,
        `Remedy: ${remedy}`,
        `Context: mode=video-${subject}, file=${file}, key=${keyPath}`,
      ].join("\n"),
    );
    this.keyPath = keyPath;
  }
}

export type ShapeErrorFactory = (keyPath: string, reason: string, remedy: string) => Error;

/** Refuse the first key of `block` outside the closed `allowed` set. */
export function rejectUnknownKeys(
  block: Obj,
  prefix: string,
  allowed: readonly string[],
  refuse: ShapeErrorFactory,
): void {
  for (const k of Object.keys(block)) {
    if (!allowed.includes(k)) {
      const path = keyPath(prefix, k);
      throw refuse(path, "is not a recognised key", `remove \`${path}\`; allowed keys here: ${allowed.join(", ")}.`);
    }
  }
}

/** Refusal for a value outside a closed enum. */
export function enumRefusal(path: string, values: readonly string[], refuse: ShapeErrorFactory): Error {
  return refuse(path, `must be one of {${values.join(", ")}}`, `set \`${path}\` to one of: ${values.join(", ")}.`);
}

/** Parse YAML text, refusing unparseable input at the `(root)` key path. */
export function parseYamlOrRefuse(raw: string, what: string, refuse: ShapeErrorFactory): unknown {
  try {
    return Bun.YAML.parse(raw);
  } catch {
    throw refuse("(root)", "is not valid YAML", `fix the YAML syntax of the ${what} file.`);
  }
}
