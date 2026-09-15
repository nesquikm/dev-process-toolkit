// M_4df444 / STE-595 — the pure stdin-spawn detector.
//
// Refuses a command in which `bash`, `sh` or `zsh` reads its script from stdin
// and that script backgrounds a process (`&` other than `&&`, `&>` and `>&`,
// or `nohup`, `setsid`, `disown`). The 2026-09-11 Phase A run fed its spawn
// fence to `bash <<'OUTER'`; the fence backgrounded three `claude -p` legs.
//
// It keys on the SHELL as the stdin consumer, never on "a heredoc plus an
// ampersand": the sanctioned `claude -p … <<'PROMPT_EOF' … &` spawn feeds its
// prompt through a heredoc and backgrounds it, and stays allowed.
//
// Pure: text in, verdict out. No file, process, network or environment access.

export type StdinSpawnConsumer = "bash" | "sh" | "zsh";
export type StdinSpawnFeed = "heredoc" | "herestring" | "pipe" | "redirect";

export type StdinSpawnVerdict =
  | { refuse: false }
  | { refuse: true; consumer: StdinSpawnConsumer; feed: StdinSpawnFeed; why: string };

// ---------------------------------------------------------------------------
// Lexer — quote-, substitution- and heredoc-aware, just enough shell.
// ---------------------------------------------------------------------------

interface WordToken {
  kind: "word";
  /** The word with quotes and escapes removed. */
  text: string;
}
interface OpToken {
  kind: "op";
  op: string;
}
interface HeredocToken {
  kind: "heredoc";
  dash: boolean;
  delim: string;
  body: string;
}
type Token = WordToken | OpToken | HeredocToken;

/** Longest first, so `&&` never lexes as two backgrounding `&`. */
const OPERATORS = [
  ";;&", "<<<", "&>>", "<<-",
  "&&", "||", ";;", ";&", "|&", "&>", ">&", "<&", ">>", "<>", ">|", "<<",
  "&", "|", ";", "<", ">", "(", ")",
];
const OP_CHARS = new Set(["&", "|", ";", "<", ">", "(", ")"]);

function matchOperator(src: string, i: number): string | null {
  for (const op of OPERATORS) if (src.startsWith(op, i)) return op;
  return null;
}

/** Skip a `'…'` string starting at `i`; returns the index after the closing quote. */
function skipSingle(src: string, i: number): number {
  const end = src.indexOf("'", i + 1);
  return end < 0 ? src.length : end + 1;
}

/** Skip a backtick substitution starting at `i`. */
function skipBacktick(src: string, i: number): number {
  let j = i + 1;
  while (j < src.length) {
    if (src[j] === "\\") j += 2;
    else if (src[j] === "`") return j + 1;
    else j++;
  }
  return src.length;
}

/** Skip a `"…"` string starting at `i`, nested `$( … )` included. */
function skipDouble(src: string, i: number): number {
  let j = i + 1;
  while (j < src.length) {
    const c = src[j]!;
    if (c === "\\") j += 2;
    else if (c === '"') return j + 1;
    else if (c === "$" && src[j + 1] === "(") j = skipGroup(src, j + 1, "(", ")");
    else if (c === "`") j = skipBacktick(src, j);
    else j++;
  }
  return src.length;
}

/** Skip a balanced `open … close` group (`$( … )`, `${ … }`) starting at the `open` at `i`. */
function skipGroup(src: string, i: number, open: string, close: string): number {
  let depth = 0;
  let j = i;
  while (j < src.length) {
    const c = src[j]!;
    if (c === "\\") j += 2;
    else if (c === "'") j = skipSingle(src, j);
    else if (c === '"') j = skipDouble(src, j);
    else if (c === "`") j = skipBacktick(src, j);
    else {
      if (c === open) depth++;
      else if (c === close && --depth === 0) return j + 1;
      j++;
    }
  }
  return src.length;
}

/** Read one word starting at `i`: up to unquoted whitespace or an operator. */
function readWord(src: string, i: number): { text: string; raw: string; end: number } {
  let text = "";
  let j = i;
  while (j < src.length) {
    const c = src[j]!;
    if (c === " " || c === "\t" || c === "\n" || c === "\r" || OP_CHARS.has(c)) break;
    if (c === "\\") {
      if (src[j + 1] !== "\n") text += src[j + 1] ?? "";
      j += 2;
    } else if (c === "'") {
      const end = skipSingle(src, j);
      text += src.slice(j + 1, end - 1);
      j = end;
    } else if (c === '"') {
      const end = skipDouble(src, j);
      text += src.slice(j + 1, end - 1);
      j = end;
    } else if (c === "$" && src[j + 1] === "(") {
      const end = skipGroup(src, j + 1, "(", ")");
      text += src.slice(j, end);
      j = end;
    } else if (c === "$" && src[j + 1] === "{") {
      const end = skipGroup(src, j + 1, "{", "}");
      text += src.slice(j, end);
      j = end;
    } else if (c === "`") {
      const end = skipBacktick(src, j);
      text += src.slice(j, end);
      j = end;
    } else {
      text += c;
      j++;
    }
  }
  return { text, raw: src.slice(i, j), end: j };
}

/** Consume a heredoc body starting at line start `i`; returns the index after its terminator. */
function readHeredocBody(src: string, i: number, h: HeredocToken): number {
  const body: string[] = [];
  let j = i;
  while (j < src.length) {
    const nl = src.indexOf("\n", j);
    const end = nl < 0 ? src.length : nl;
    const line = src.slice(j, end).replace(/\r$/, "");
    j = nl < 0 ? src.length : nl + 1;
    if ((h.dash ? line.replace(/^\t+/, "") : line) === h.delim) break;
    body.push(line);
  }
  h.body = body.join("\n");
  return j;
}

function lex(src: string): Token[] {
  const out: Token[] = [];
  const pending: HeredocToken[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === "\n") {
      out.push({ kind: "op", op: "\n" });
      i++;
      for (const h of pending) i = readHeredocBody(src, i, h);
      pending.length = 0;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") {
      i++;
      continue;
    }
    if (c === "\\" && src[i + 1] === "\n") {
      i += 2;
      continue;
    }
    if (c === "#") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    const op = matchOperator(src, i);
    if (op !== null) {
      i += op.length;
      if (op === "<<" || op === "<<-") {
        while (src[i] === " " || src[i] === "\t") i++;
        const w = readWord(src, i);
        i = w.end;
        const h: HeredocToken = { kind: "heredoc", dash: op === "<<-", delim: w.text, body: "" };
        out.push(h);
        pending.push(h);
      } else {
        out.push({ kind: "op", op });
      }
      continue;
    }
    const w = readWord(src, i);
    i = w.end;
    // An fd number glued to a redirection (`2>&1`, `1>&2`) is not a word.
    if (/^\d+$/.test(w.raw) && (src[i] === "<" || src[i] === ">")) continue;
    out.push({ kind: "word", text: w.text });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Simple commands.
// ---------------------------------------------------------------------------

/** Where a command's stdin comes from when a redirection sets it. */
type StdinSource =
  | { feed: "heredoc"; doc: HeredocToken }
  | { feed: "herestring"; text: string }
  | { feed: "redirect" };

interface SimpleCommand {
  words: string[];
  /** The last stdin redirection: it wins over a pipe, as in the shell. */
  stdin: StdinSource | null;
  /** Set when piped: the upstream simple command, or null for a compound upstream (`} |`, `) |`). */
  pipe?: { from: SimpleCommand | null };
}

const REDIRECTIONS = new Set(["<", ">", ">>", "<>", ">|", "&>", "&>>", ">&", "<&", "<<<"]);
const PIPES = new Set(["|", "|&"]);
/** Reserved words that open or close a compound command: they start a new simple command. */
const RESERVED = new Set(["{", "}", "!", "if", "then", "else", "elif", "fi", "do", "done", "while", "until"]);

function simpleCommands(tokens: readonly Token[]): SimpleCommand[] {
  const out: SimpleCommand[] = [];
  let cur: SimpleCommand = { words: [], stdin: null };
  let pipe: { from: SimpleCommand | null } | undefined;
  const flush = (): SimpleCommand | null => {
    if (cur.words.length === 0 && cur.stdin === null) return null;
    if (pipe !== undefined) cur.pipe = pipe;
    pipe = undefined;
    const done = cur;
    out.push(done);
    cur = { words: [], stdin: null };
    return done;
  };
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k]!;
    if (t.kind === "heredoc") {
      cur.stdin = { feed: "heredoc", doc: t };
    } else if (t.kind === "op") {
      if (REDIRECTIONS.has(t.op)) {
        const next = tokens[k + 1];
        const target = next?.kind === "word" ? next.text : "";
        if (next?.kind === "word") k++; // the redirection target
        if (t.op === "<") cur.stdin = { feed: "redirect" };
        else if (t.op === "<<<") cur.stdin = { feed: "herestring", text: target };
      } else if (PIPES.has(t.op)) {
        const from = flush();
        pipe = { from };
      } else {
        flush();
      }
    } else if (cur.words.length === 0 && RESERVED.has(t.text)) {
      flush();
    } else {
      cur.words.push(t.text);
    }
  }
  flush();
  return out;
}

const ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;
/** Words that run the next word as the command. */
const PREFIXES = new Set(["exec", "command", "builtin", "env", "time", "nohup", "setsid"]);
const BACKGROUNDING = new Set(["nohup", "setsid", "disown"]);
const SHELLS = new Set<string>(["bash", "sh", "zsh"]);

/** The command's words from its first non-assignment word on. */
function head(words: readonly string[]): string[] {
  let k = 0;
  while (k < words.length && ASSIGNMENT_RE.test(words[k]!)) k++;
  return words.slice(k);
}

const basename = (w: string): string => w.slice(w.lastIndexOf("/") + 1);

/**
 * Runners that run their operand as the command, beyond the bare PREFIXES:
 * the options that take a separate argument, and how many positional operands
 * come before the command (`timeout`'s duration). A runner's own options used
 * to hide the shell (`env -i bash`, `timeout 5 bash`, `nice -n 5 bash`,
 * `sudo -u root bash`), which read a script from stdin just like `bash` alone.
 */
const RUNNERS: Readonly<Record<string, { argOpts: ReadonlySet<string>; operands: number }>> = {
  env: { argOpts: new Set(["-u", "--unset", "-C", "--chdir", "-S", "--split-string", "-P"]), operands: 0 },
  timeout: { argOpts: new Set(["-s", "--signal", "-k", "--kill-after"]), operands: 1 },
  nice: { argOpts: new Set(["-n", "--adjustment"]), operands: 0 },
  caffeinate: { argOpts: new Set(["-t", "-w"]), operands: 0 },
  sudo: { argOpts: new Set(["-u", "-g", "-C", "-D", "-h", "-p", "-r", "-t", "-U", "-T", "-R"]), operands: 0 },
  exec: { argOpts: new Set(["-a"]), operands: 0 },
};

/** The index just past a runner's own options and leading operands, starting at the word after the runner. */
function pastRunner(words: readonly string[], k: number, runner: string): number {
  const spec = RUNNERS[runner];
  if (spec === undefined) return k;
  while (k < words.length) {
    const w = words[k]!;
    if (w === "--") {
      k++;
      break;
    }
    if (runner === "env" && ASSIGNMENT_RE.test(w)) {
      k++;
      continue;
    }
    if (!w.startsWith("-") || w === "-") break;
    k += spec.argOpts.has(w) ? 2 : 1;
  }
  return Math.min(k + spec.operands, words.length);
}

/** The program a command runs, past assignments and runner prefixes (`FOO=1 env -i exec bash -s`), and its arguments. */
function invoked(words: readonly string[]): { name: string; args: string[] } {
  let k = 0;
  while (k < words.length) {
    const w = words[k]!;
    if (ASSIGNMENT_RE.test(w)) {
      k++;
      continue;
    }
    const runner = basename(w);
    if (!PREFIXES.has(runner) && RUNNERS[runner] === undefined) break;
    k = pastRunner(words, k + 1, runner);
  }
  return { name: basename(words[k] ?? ""), args: words.slice(k + 1) };
}

/** Operands that name stdin itself: a shell given one of these still reads its script from stdin. */
const STDIN_OPERANDS = new Set(["-", "/dev/stdin", "/dev/fd/0"]);

/** The shell this command runs when that shell reads its script from stdin; else null. */
function stdinShell(words: readonly string[]): StdinSpawnConsumer | null {
  const { name, args } = invoked(words);
  if (!SHELLS.has(name)) return null;
  const shell = name as StdinSpawnConsumer;
  for (let a = 0; a < args.length; a++) {
    const w = args[a]!;
    if (w === "--") return a + 1 < args.length ? null : shell;
    if (w.startsWith("--")) continue;
    if (/^[-+]./.test(w)) {
      const flags = w.slice(1);
      if (flags.includes("c")) return null; // `-c`: the script is an argument
      if (flags.includes("s")) return shell; // `-s`: the script is stdin
      if (/[oO]$/.test(flags)) a++; // `-o <option>` takes an argument
      continue;
    }
    // An operand that names stdin itself (`bash -`, `bash /dev/stdin`) still
    // reads the script from stdin; any other operand is a script file, and
    // stdin is then data, not the script.
    return STDIN_OPERANDS.has(w) ? shell : null;
  }
  return shell;
}

/** Does this script background a process? Heredoc bodies inside it are data, unless a shell reads them. */
/** The bodies of every `$( … )` and backtick substitution in a word's text; arithmetic `$(( … ))` is not a command. */
function substitutionBodies(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === "$" && text[i + 1] === "(" && text[i + 2] !== "(") {
      const end = skipGroup(text, i + 1, "(", ")");
      out.push(text.slice(i + 2, Math.max(i + 2, end - 1)));
      i = end;
    } else if (text[i] === "`") {
      const end = skipBacktick(text, i);
      out.push(text.slice(i + 1, Math.max(i + 1, end - 1)));
      i = end;
    } else {
      i++;
    }
  }
  return out;
}

function backgrounds(script: string): boolean {
  const tokens = lex(script);
  if (tokens.some((t) => t.kind === "op" && t.op === "&")) return true;
  // A command substitution is a script of its own: `X=$(sleep 1 &)` backgrounds
  // exactly as `sleep 1 &` does, but the lexer keeps the substitution inside the
  // word it belongs to, so its `&` never reaches the operator check above.
  // Heredoc bodies are separate tokens and stay data. A word's text has its
  // quotes removed, so a single-quoted `'$(x &)'` is refused too — over-refusing
  // in the direction the rule prefers, never under-refusing.
  for (const t of tokens) {
    if (t.kind !== "word") continue;
    for (const body of substitutionBodies(t.text)) if (backgrounds(body)) return true;
  }
  for (const cmd of simpleCommands(tokens)) {
    const h = head(cmd.words);
    let k = 0;
    while (k < h.length && PREFIXES.has(h[k]!) && !BACKGROUNDING.has(h[k]!)) k++;
    if (BACKGROUNDING.has(h[k] ?? "")) return true;
    if (stdinRefusal(cmd) !== null) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// The verdict.
// ---------------------------------------------------------------------------

type Refusal = Extract<StdinSpawnVerdict, { refuse: true }>;

/** A command substitution: its output, not its text, is what the shell would read. */
const SUBSTITUTION_RE = /\$\(|`/;

/**
 * The script text a pipe carries into the next command, when the upstream
 * command spells it out: `echo …` / `printf …` arguments, or a heredoc or
 * here-string into a bare `cat`. Null when the text is not in the command: a
 * file, another command's output, a substitution or a compound upstream.
 */
function pipedText(up: SimpleCommand | null): string | null {
  if (up === null) return null;
  const { name, args } = invoked(up.words);
  if (name === "echo" || name === "printf") {
    const text = args.join(" ");
    return SUBSTITUTION_RE.test(text) ? null : text;
  }
  if (name === "cat" && args.length === 0) {
    if (up.stdin?.feed === "heredoc") return up.stdin.doc.body;
    if (up.stdin?.feed === "herestring" && !SUBSTITUTION_RE.test(up.stdin.text)) return up.stdin.text;
  }
  return null;
}

/** The refusal for one simple command whose shell reads its script from stdin; null when it may run. */
function stdinRefusal(cmd: SimpleCommand): Refusal | null {
  const consumer = stdinShell(cmd.words);
  if (consumer === null) return null;
  const refuse = (feed: StdinSpawnFeed, how: string, what: string): Refusal => ({
    refuse: true,
    consumer,
    feed,
    why: `${consumer} would read its script from stdin through ${how}, and ${what}`,
  });
  const bg = "that script backgrounds a process";
  const unseen = "that script's text is not in the command";
  const src = cmd.stdin;
  if (src?.feed === "redirect") return refuse("redirect", "a `<` redirect", unseen);
  if (src?.feed === "herestring") {
    if (SUBSTITUTION_RE.test(src.text)) return refuse("herestring", "a here-string", unseen);
    return backgrounds(src.text) ? refuse("herestring", "a here-string", bg) : null;
  }
  if (src?.feed === "heredoc") return backgrounds(src.doc.body) ? refuse("heredoc", "a heredoc", bg) : null;
  if (cmd.pipe !== undefined) {
    const text = pipedText(cmd.pipe.from);
    if (text === null) return refuse("pipe", "a pipe from a file or another command", unseen);
    return backgrounds(text) ? refuse("pipe", "a pipe", bg) : null;
  }
  return null;
}

export function detectStdinSpawn(command: string): StdinSpawnVerdict {
  for (const cmd of simpleCommands(lex(command))) {
    const refusal = stdinRefusal(cmd);
    if (refusal !== null) return refusal;
  }
  return { refuse: false };
}
