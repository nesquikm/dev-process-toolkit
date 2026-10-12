// M_1e0717 STE-667 — the web recorder (Playwright + CDP screencast + ffmpeg).
//
// AC coverage:
//   AC-STE-667.1 — no resolvable `playwright` in the project → NFR-10 refusal naming the project
//                  root and both install commands (direct call AND through `recordShot`).
//                  `resolveProjectPlaywright` resolves from the PROJECT root (a project-local
//                  fake package is found; an empty project yields null).
//   AC-STE-667.2 — every launch carries `--use-mock-keychain` and `--password-store=basic`
//                  (fake Playwright's recorded launch options, two consecutive shots).
//   AC-STE-667.3 — `mark("open")` / `mark("result")` → markers file with both names in order,
//                  times taken from the screencast frame clock (not the wall clock).
//   AC-STE-667.4 — fake CDP frames are each acked and encoded at their timestamps; the clip
//                  passes `validateRecording` and shows each frame at its own time.
//   AC-STE-667.5 — persistent profile dir lives under `videoWorkDir(slug)`; a throwing scenario
//                  stops the screencast, closes the browser, and refuses naming shot + error.
//   AC-STE-667.6 — viewport from `style.layout.viewport` (launch + clip size), default 1280×720.
//
// Module contract this suite drives (adapters/_shared/src/video/recorder_web.ts):
//   export const WEB_KEYCHAIN_FLAGS: readonly ["--use-mock-keychain", "--password-store=basic"]
//   export async function resolveProjectPlaywright(projectRoot: string): Promise<any | null>
//     — loads `playwright` resolved from projectRoot (never the toolkit); null when absent.
//   export async function recordWeb(opts: {
//     projectRoot: string; slug: string; shot: Shot;
//     loadPlaywright?: (projectRoot: string) => Promise<any | null>;  // default resolveProjectPlaywright
//     runner?: Runner; which?: Which;
//   }): Promise<{ clip: string; markers: string }>
//     — scenario: videoScenariosDir(projectRoot)/<shot.id>.ts (or .js), default export
//       `async (page, mark) => {}`; style read via readVideoStyle(projectRoot);
//       `pw.chromium.launchPersistentContext(userDataDir, { args, viewport, ... })` with
//       userDataDir under videoWorkDir(projectRoot, slug); `context.newCDPSession(page)`;
//       listens to `Page.screencastFrame`, acks each with `Page.screencastFrameAck { sessionId }`,
//       sends `Page.startScreencast` / `Page.stopScreencast`; frames → ffmpeg at their
//       metadata.timestamp; clip scaled to the viewport; outputs via shotOutputs().
//   video/recorder.ts recordShot(...) gains `loadPlaywright?` and dispatches kind `web` to recordWeb.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { videoScenariosDir, videoStylePath, videoWorkDir } from "../adapters/_shared/src/dpt_paths";
import { recordShot, shotOutputs, validateRecording } from "../adapters/_shared/src/video/recorder";
import {
  recordWeb,
  resolveProjectPlaywright,
  WEB_KEYCHAIN_FLAGS,
} from "../adapters/_shared/src/video/recorder_web";

const SLOW = 60_000;

const temps: string[] = [];
function tempDir(prefix: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  temps.push(d);
  return d;
}

afterAll(() => {
  for (const d of temps) {
    spawnSync("rm", ["-rf", d]);
    if (existsSync(d)) throw new Error(`temp dir not removed: ${d}`);
  }
});

function ffmpeg(args: string[]): void {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`fixture ffmpeg failed: ${r.stderr}`);
}

function probeVideo(path: string): { width: number; height: number; duration: number } {
  const r = spawnSync(
    "ffprobe",
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", path],
    { encoding: "utf8" },
  );
  if (r.status !== 0) throw new Error(`ffprobe failed: ${r.stderr}`);
  const j = JSON.parse(r.stdout) as { streams: { width: number; height: number }[]; format: { duration: string } };
  return { width: j.streams[0].width, height: j.streams[0].height, duration: Number(j.format.duration) };
}

/** Average RGB of the clip's frame at time `t` (scaled to 1×1). */
function colorAt(path: string, t: number): [number, number, number] {
  const r = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-ss", String(t), "-i", path, "-frames:v", "1", "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { encoding: "buffer" },
  );
  if (r.status !== 0 || r.stdout.length < 3) throw new Error(`frame extract failed at ${t}s: ${r.stderr}`);
  return [r.stdout[0], r.stdout[1], r.stdout[2]];
}

async function refusal(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error("expected a refusal, but the call resolved");
}

function expectNfr10(msg: string): void {
  const lines = msg.split("\n");
  expect(lines[0]).toMatch(/^Refusing: /);
  expect(lines.some((l) => l.startsWith("Remedy: "))).toBe(true);
  expect(lines.some((l) => l.startsWith("Context: "))).toBe(true);
}

const shot = (id: string) => ({ id, scenario: `scenario-of-${id}`, durationHint: 2 }) as never;

// ---- frame fixtures (real JPEGs, generated outside the repo) ----

const COLORS = ["red", "lime", "blue", "yellow", "white"] as const;
const EXPECT_RGB: Record<(typeof COLORS)[number], [number, number, number]> = {
  red: [255, 0, 0],
  lime: [0, 255, 0],
  blue: [0, 0, 255],
  yellow: [255, 255, 0],
  white: [255, 255, 255],
};
const T0 = 1_700_000_000.25; // CDP metadata.timestamp is seconds; quarters keep the arithmetic exact
const STEP = 0.5;
let frameB64: string[] = [];

beforeAll(() => {
  const dir = tempDir("dpt-ste667-frames-");
  frameB64 = COLORS.map((c, i) => {
    const out = join(dir, `f${i}.jpg`);
    ffmpeg(["-f", "lavfi", "-i", `color=c=${c}:s=320x180`, "-frames:v", "1", "-q:v", "2", out]);
    return readFileSync(out).toString("base64");
  });
});

// ---- fake Playwright + fake CDP session ----

interface FakeState {
  launches: { userDataDir: string; options: Record<string, any> }[];
  sends: { method: string; params: any }[];
  acks: number[];
  closes: number;
  setViewport: { width: number; height: number }[];
}

/**
 * A fake `playwright` module. The CDP session emits frame 0 when `Page.startScreencast`
 * is sent; the scenario's `page.advance()` emits the next frame. Frame i has
 * sessionId i+1 and timestamp T0 + i*STEP.
 */
function fakePlaywright(): { mod: any; state: FakeState } {
  const state: FakeState = { launches: [], sends: [], acks: [], closes: 0, setViewport: [] };
  const mod = {
    chromium: {
      async launchPersistentContext(userDataDir: string, options: Record<string, any> = {}) {
        state.launches.push({ userDataDir, options });
        const handlers: Record<string, ((p: any) => unknown)[]> = {};
        let cursor = 0;
        const emitNext = async () => {
          if (cursor >= frameB64.length) return;
          const i = cursor++;
          const payload = {
            data: frameB64[i],
            sessionId: i + 1,
            metadata: { timestamp: T0 + i * STEP, offsetTop: 0, pageScaleFactor: 1, deviceWidth: 320, deviceHeight: 180, scrollOffsetX: 0, scrollOffsetY: 0 },
          };
          for (const h of handlers["Page.screencastFrame"] ?? []) await h(payload);
        };
        const session = {
          on(event: string, h: (p: any) => unknown) {
            (handlers[event] ??= []).push(h);
            return session;
          },
          off() {
            return session;
          },
          async send(method: string, params?: any) {
            state.sends.push({ method, params });
            if (method === "Page.screencastFrameAck") state.acks.push(params?.sessionId);
            if (method === "Page.startScreencast") await emitNext();
            return {};
          },
          async detach() {},
        };
        const page = {
          advance: emitNext,
          async goto() {
            return null;
          },
          async setViewportSize(v: { width: number; height: number }) {
            state.setViewport.push(v);
          },
          viewportSize: () => options.viewport ?? null,
          async waitForTimeout() {},
          async close() {},
          on() {},
        };
        const context = {
          pages: () => [page],
          async newPage() {
            return page;
          },
          async newCDPSession() {
            return session;
          },
          async close() {
            state.closes++;
          },
          on() {},
        };
        return context;
      },
    },
  };
  return { mod, state };
}

/** The scenario every happy-path test runs: 5 frames, two marks. */
const MARKING_SCENARIO = `export default async (page, mark) => {
  await page.advance();      // frame 1 @ +0.5
  mark("open");
  await page.advance();      // frame 2 @ +1.0
  await page.advance();      // frame 3 @ +1.5
  mark("result");
  await page.advance();      // frame 4 @ +2.0
};
`;

function webProject(opts: { scenarios: Record<string, { body: string; ext?: "ts" | "js" }>; style?: string }): string {
  const root = tempDir("dpt-ste667-proj-");
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fixture-web", private: true }));
  const sdir = videoScenariosDir(root);
  mkdirSync(sdir, { recursive: true });
  for (const [id, s] of Object.entries(opts.scenarios)) writeFileSync(join(sdir, `${id}.${s.ext ?? "ts"}`), s.body);
  if (opts.style !== undefined) {
    const sp = videoStylePath(root);
    mkdirSync(join(sp, ".."), { recursive: true });
    writeFileSync(sp, opts.style);
  }
  return root;
}

function viewportOf(state: FakeState, launchIndex = 0): { width: number; height: number } | undefined {
  return state.launches[launchIndex]?.options?.viewport ?? state.setViewport.at(-1);
}

// ---------------------------------------------------------------------------

describe("AC-STE-667.1 playwright is resolved from the project, refusal when absent", () => {
  test("no resolvable playwright → NFR-10 refusal naming the project root and both install commands", async () => {
    const root = webProject({ scenarios: { main: { body: MARKING_SCENARIO } } });
    const msg = await refusal(recordWeb({ projectRoot: root, slug: "demo", shot: shot("main") }));
    expectNfr10(msg);
    expect(msg).toContain(root);
    expect(msg).toContain("npm i -D playwright");
    expect(msg).toContain("npx playwright install chromium");
  });

  test("an injected loader returning null refuses the same way", async () => {
    const root = webProject({ scenarios: { main: { body: MARKING_SCENARIO } } });
    const msg = await refusal(
      recordWeb({ projectRoot: root, slug: "demo", shot: shot("main"), loadPlaywright: async () => null }),
    );
    expectNfr10(msg);
    expect(msg).toContain(root);
    expect(msg).toContain("npm i -D playwright");
    expect(msg).toContain("npx playwright install chromium");
  });

  test("recordShot dispatches kind `web` to the web recorder (refusal carries the install commands)", async () => {
    const root = webProject({ scenarios: { main: { body: MARKING_SCENARIO } } });
    const msg = await refusal(recordShot({ projectRoot: root, slug: "demo", shot: shot("main"), config: { kind: "web" } }));
    expectNfr10(msg);
    expect(msg).toContain("npm i -D playwright");
    expect(msg).toContain("npx playwright install chromium");
  });

  test("resolveProjectPlaywright finds a project-local package and returns null for an empty project", async () => {
    const empty = webProject({ scenarios: {} });
    expect(await resolveProjectPlaywright(empty)).toBeNull();

    const root = webProject({ scenarios: {} });
    const pkg = join(root, "node_modules", "playwright");
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "playwright", version: "0.0.0-fixture", main: "index.js" }));
    writeFileSync(join(pkg, "index.js"), 'exports.__fixture = "project-local-ste667"; exports.chromium = {};\n');
    const mod = (await resolveProjectPlaywright(root)) as any;
    expect(mod).not.toBeNull();
    expect(mod.__fixture ?? mod.default?.__fixture).toBe("project-local-ste667");
  });
});

describe("AC-STE-667.2 keychain flags on every launch", () => {
  test(
    "two consecutive shots both launch with --use-mock-keychain and --password-store=basic",
    async () => {
      const root = webProject({ scenarios: { one: { body: MARKING_SCENARIO }, two: { body: MARKING_SCENARIO, ext: "js" } } });
      const { mod, state } = fakePlaywright();
      await recordWeb({ projectRoot: root, slug: "flags", shot: shot("one"), loadPlaywright: async () => mod });
      await recordWeb({ projectRoot: root, slug: "flags", shot: shot("two"), loadPlaywright: async () => mod });

      expect([...WEB_KEYCHAIN_FLAGS]).toEqual(["--use-mock-keychain", "--password-store=basic"]);
      expect(state.launches.length).toBe(2);
      for (const l of state.launches) {
        expect(l.options.args).toContain("--use-mock-keychain");
        expect(l.options.args).toContain("--password-store=basic");
      }
    },
    SLOW,
  );
});

describe("AC-STE-667.3 markers from the frame clock", () => {
  test(
    'mark("open") and mark("result") land in order at the frame-clock times',
    async () => {
      const root = webProject({ scenarios: { main: { body: MARKING_SCENARIO } } });
      const { mod } = fakePlaywright();
      const out = await recordWeb({ projectRoot: root, slug: "marks", shot: shot("main"), loadPlaywright: async () => mod });

      expect(out.markers).toBe(shotOutputs(videoWorkDir(root, "marks"), "main").markers);
      const markers = JSON.parse(readFileSync(out.markers, "utf8")) as { name: string; t: number }[];
      expect(markers.map((m) => m.name)).toEqual(["open", "result"]);
      // Frame clock: frame 1 is +0.5s, frame 3 is +1.5s after the first frame — the
      // scenario runs in milliseconds, so wall-clock times would be ~0.
      expect(markers[0].t).toBeCloseTo(0.5, 3);
      expect(markers[1].t).toBeCloseTo(1.5, 3);
    },
    SLOW,
  );
});

describe("AC-STE-667.4 screencast frames are acked and encoded at their timestamps", () => {
  test(
    "every frame acked in order; clip passes validateRecording and shows each frame at its time",
    async () => {
      const root = webProject({ scenarios: { main: { body: MARKING_SCENARIO } } });
      const { mod, state } = fakePlaywright();
      const out = await recordWeb({ projectRoot: root, slug: "frames", shot: shot("main"), loadPlaywright: async () => mod });

      const methods = state.sends.map((s) => s.method);
      expect(methods).toContain("Page.startScreencast");
      expect(methods).toContain("Page.stopScreencast");
      expect(state.acks).toEqual([1, 2, 3, 4, 5]);

      const workDir = videoWorkDir(root, "frames");
      expect(out.clip).toBe(shotOutputs(workDir, "main").clip);
      const v = await validateRecording({ workDir, shot: shot("main") });
      expect(v.markers.map((m) => m.name)).toEqual(["open", "result"]);
      // 5 frames spanning 2.0s of frame time; a fixed-rate feed would last ~0.2s.
      expect(v.duration).toBeGreaterThanOrEqual(1.9);
      expect(v.duration).toBeLessThanOrEqual(3.0);

      // Each frame occupies its own timestamp window.
      const samples: [number, (typeof COLORS)[number]][] = [
        [0.25, "red"],
        [0.75, "lime"],
        [1.25, "blue"],
        [1.75, "yellow"],
      ];
      for (const [t, c] of samples) {
        const got = colorAt(out.clip, t);
        const want = EXPECT_RGB[c];
        for (let k = 0; k < 3; k++) expect(Math.abs(got[k] - want[k])).toBeLessThan(60);
      }
      expect(state.closes).toBe(1);
    },
    SLOW,
  );
});

describe("AC-STE-667.5 profile dir and a throwing scenario", () => {
  test(
    "the persistent profile directory lives under videoWorkDir(slug)",
    async () => {
      const root = webProject({ scenarios: { main: { body: MARKING_SCENARIO } } });
      const { mod, state } = fakePlaywright();
      await recordWeb({ projectRoot: root, slug: "profile", shot: shot("main"), loadPlaywright: async () => mod });
      const userDataDir = state.launches[0].userDataDir;
      expect(typeof userDataDir).toBe("string");
      expect(userDataDir.startsWith(videoWorkDir(root, "profile") + sep)).toBe(true);
    },
    SLOW,
  );

  test(
    "a throwing scenario stops the screencast, closes the browser, and refuses naming the shot and the error",
    async () => {
      const body = `export default async (page, mark) => {
  await page.advance();
  mark("open");
  throw new Error("scenario-exploded-ste667");
};
`;
      const root = webProject({ scenarios: { "checkout-flow": { body } } });
      const { mod, state } = fakePlaywright();
      const msg = await refusal(
        recordWeb({ projectRoot: root, slug: "boom", shot: shot("checkout-flow"), loadPlaywright: async () => mod }),
      );
      expectNfr10(msg);
      expect(msg).toContain("checkout-flow");
      expect(msg).toContain("scenario-exploded-ste667");
      expect(state.sends.map((s) => s.method)).toContain("Page.stopScreencast");
      expect(state.closes).toBe(1);
    },
    SLOW,
  );
});

describe("AC-STE-667.6 viewport from style.layout.viewport", () => {
  test(
    "no style file → 1280×720 at launch and in the clip",
    async () => {
      const root = webProject({ scenarios: { main: { body: MARKING_SCENARIO } } });
      const { mod, state } = fakePlaywright();
      const out = await recordWeb({ projectRoot: root, slug: "vp-default", shot: shot("main"), loadPlaywright: async () => mod });
      expect(viewportOf(state)).toEqual({ width: 1280, height: 720 });
      const p = probeVideo(out.clip);
      expect([p.width, p.height]).toEqual([1280, 720]);
    },
    SLOW,
  );

  test(
    "style layout.viewport 640×360 → 640×360 at launch and in the clip",
    async () => {
      const root = webProject({
        scenarios: { main: { body: MARKING_SCENARIO } },
        style: "layout:\n  viewport:\n    width: 640\n    height: 360\n",
      });
      const { mod, state } = fakePlaywright();
      const out = await recordWeb({ projectRoot: root, slug: "vp-style", shot: shot("main"), loadPlaywright: async () => mod });
      expect(viewportOf(state)).toEqual({ width: 640, height: 360 });
      const p = probeVideo(out.clip);
      expect([p.width, p.height]).toEqual([640, 360]);
    },
    SLOW,
  );
});

// ---------------------------------------------------------------------------
// HARDEN-F — AC-STE-667.5 spirit: the scenario is loaded BEFORE the browser launches
// ---------------------------------------------------------------------------

describe("HARDEN-F a missing or unloadable scenario refuses without launching the browser", () => {
  test(
    "HARDEN-F a missing scenario file refuses naming the shot; launchPersistentContext is never called",
    async () => {
      const root = webProject({ scenarios: {} });
      const { mod, state } = fakePlaywright();
      const msg = await refusal(
        recordWeb({ projectRoot: root, slug: "nofile", shot: shot("ghost-shot"), loadPlaywright: async () => mod }),
      );
      expectNfr10(msg);
      expect(msg).toContain("ghost-shot");
      expect(state.launches).toEqual([]);
      expect(state.closes).toBe(0);
    },
    SLOW,
  );

  test(
    "HARDEN-F a scenario module whose import throws refuses naming the shot; the browser is never launched",
    async () => {
      const body = `throw new Error("scenario-import-exploded-ste667");\nexport default async () => {};\n`;
      const root = webProject({ scenarios: { "bad-import": { body } } });
      const { mod, state } = fakePlaywright();
      const msg = await refusal(
        recordWeb({ projectRoot: root, slug: "badimport", shot: shot("bad-import"), loadPlaywright: async () => mod }),
      );
      expectNfr10(msg);
      expect(msg).toContain("bad-import");
      expect(state.launches).toEqual([]);
    },
    SLOW,
  );
});
