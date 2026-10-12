// STE-667 — the web recorder (Playwright + CDP screencast + ffmpeg).
//
// Playwright is resolved from the PROJECT root, never from the toolkit: the
// project owns its browser dependency. When it is absent the recorder refuses
// in the NFR-10 shape naming the project root and both install commands.

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { defaultRunner, requireRenderBinaries, type Runner, type Which } from "./render";
import { videoScenariosDir, videoWorkDir } from "../dpt_paths";
import { prepareFreshShotOutputs, refuseRecording, type Marker, type Shot } from "./recorder";
import { readVideoStyle } from "./style";

export const WEB_KEYCHAIN_FLAGS = ["--use-mock-keychain", "--password-store=basic"] as const;

type Viewport = { width: number; height: number };
type Frame = { file: string; t: number };

/** The web recorder's NFR-10 refusal, naming the shot. */
function refuseWeb(shotId: string, reason: string, remedy: string, trailer?: string[]): never {
  refuseRecording({ subject: "web recording", recorder: "web", shotId, reason, remedy, trailer });
}

/** Load `playwright` as resolved from `projectRoot`; null when the project has none. */
export async function resolveProjectPlaywright(projectRoot: string): Promise<any | null> {
  let resolved: string;
  try {
    resolved = createRequire(join(projectRoot, "package.json")).resolve("playwright", { paths: [projectRoot] });
  } catch {
    return null;
  }
  return await import(pathToFileURL(resolved).href);
}

export async function recordWeb(opts: {
  projectRoot: string;
  slug: string;
  shot: Shot;
  loadPlaywright?: (projectRoot: string) => Promise<any | null>;
  runner?: Runner;
  which?: Which;
}): Promise<{ clip: string; markers: string }> {
  const { projectRoot, shot } = opts;
  const load = opts.loadPlaywright ?? resolveProjectPlaywright;
  // Load the scenario first: a missing or unloadable scenario refuses before any browser launches.
  const scenario = await loadScenario(projectRoot, shot.id);
  const pw = await load(projectRoot);
  if (!pw) {
    refuseWeb(
      shot.id,
      `cannot start — no \`playwright\` package resolves from the project root ${projectRoot}`,
      "install Playwright in the project: `npm i -D playwright` then `npx playwright install chromium`.",
      [`Project root: ${projectRoot}`],
    );
  }
  const workDir = videoWorkDir(projectRoot, opts.slug);
  // Clear any clip/markers/frames an earlier run left, so none passes for this run's.
  const outputs = prepareFreshShotOutputs(workDir, shot.id);
  const framesDir = join(workDir, "frames", shot.id);
  rmSync(framesDir, { recursive: true, force: true });
  mkdirSync(framesDir, { recursive: true });
  const { width, height } = readVideoStyle(projectRoot).layout.viewport;
  const viewport: Viewport = { width, height };
  const context = await pw.chromium.launchPersistentContext(join(workDir, "profile"), {
    args: [...WEB_KEYCHAIN_FLAGS],
    viewport,
  });
  const page = context.pages()[0] ?? (await context.newPage());
  const cdp = await context.newCDPSession(page);
  // Frame clock: seconds since the first screencast frame (CDP metadata.timestamp).
  let firstFrameTs: number | null = null;
  let frameClock = 0;
  const frames: Frame[] = [];
  cdp.on("Page.screencastFrame", async (frame: any) => {
    const ts = Number(frame?.metadata?.timestamp);
    if (Number.isFinite(ts)) {
      if (firstFrameTs === null) firstFrameTs = ts;
      frameClock = ts - firstFrameTs;
    }
    if (typeof frame?.data === "string") {
      const file = `f${String(frames.length).padStart(6, "0")}.jpg`;
      writeFileSync(join(framesDir, file), Buffer.from(frame.data, "base64"));
      frames.push({ file, t: frameClock });
    }
    await cdp.send("Page.screencastFrameAck", { sessionId: frame?.sessionId });
  });
  const markers: Marker[] = [];
  const mark = (name: string) => {
    markers.push({ name, t: frameClock });
  };
  await cdp.send("Page.startScreencast", { format: "jpeg" });
  try {
    await scenario(page, mark);
  } catch (e) {
    // End the recording and release the browser before refusing.
    try {
      await cdp.send("Page.stopScreencast");
    } finally {
      await context.close();
    }
    refuseWeb(
      shot.id,
      `failed — the scenario threw: ${e instanceof Error ? e.message : String(e)}`,
      `fix the scenario at ${join(videoScenariosDir(projectRoot), shot.id)}.ts (or .js) and re-run the shot.`,
    );
  }
  await cdp.send("Page.stopScreencast");
  writeFileSync(outputs.markers, JSON.stringify(markers, null, 2) + "\n");
  await context.close();
  await encodeFrames({ frames, framesDir, clip: outputs.clip, shotId: shot.id, viewport, runner: opts.runner, which: opts.which });
  return outputs;
}

/** Encode screencast frames into the clip, each frame held until the next frame's timestamp. */
async function encodeFrames(opts: {
  frames: Frame[];
  framesDir: string;
  clip: string;
  shotId: string;
  viewport: Viewport;
  runner?: Runner;
  which?: Which;
}): Promise<void> {
  const { frames, framesDir } = opts;
  if (frames.length === 0) {
    refuseWeb(opts.shotId, "produced no screencast frames", "make sure the scenario renders a page before it returns.");
  }
  const { ffmpeg } = requireRenderBinaries(opts.which);
  const lines: string[] = [];
  for (let i = 0; i < frames.length; i++) {
    const next = frames[i + 1];
    const prevGap = i > 0 ? frames[i].t - frames[i - 1].t : 0;
    const dur = next ? next.t - frames[i].t : prevGap > 0 ? prevGap : 0.1;
    lines.push(`file '${frames[i].file}'`, `duration ${Math.max(dur, 0.001).toFixed(6)}`);
  }
  writeFileSync(join(framesDir, "frames.txt"), lines.join("\n") + "\n");
  const runner = opts.runner ?? defaultRunner;
  const res = await runner(
    [
      ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
      "-f", "concat", "-safe", "0", "-i", "frames.txt",
      "-vf", `fps=30,scale=${even(opts.viewport.width)}:${even(opts.viewport.height)},format=yuv420p`,
      "-c:v", "libx264", "-movflags", "+faststart",
      opts.clip,
    ],
    { cwd: framesDir },
  );
  if (res.code !== 0) {
    refuseWeb(
      opts.shotId,
      `could not encode its frames — ffmpeg exited ${res.code}: ${res.stderr.trim()}`,
      "check the ffmpeg install and re-run the shot.",
    );
  }
}

/** libx264 + yuv420p need even dimensions. */
function even(n: number): number {
  return Math.max(2, Math.floor(n / 2) * 2);
}

async function loadScenario(projectRoot: string, shotId: string): Promise<(page: any, mark: (name: string) => void) => unknown> {
  const dir = videoScenariosDir(projectRoot);
  const path = [join(dir, `${shotId}.ts`), join(dir, `${shotId}.js`)].find((p) => existsSync(p));
  if (!path) {
    refuseWeb(
      shotId,
      `cannot start — no scenario file ${shotId}.ts or ${shotId}.js in ${dir}`,
      `write the shot's scenario at ${join(dir, `${shotId}.ts`)} exporting \`default async (page, mark) => {}\`.`,
    );
  }
  let mod: any;
  try {
    mod = await import(pathToFileURL(path).href);
  } catch (e) {
    refuseWeb(
      shotId,
      `cannot start — the scenario module ${path} failed to load: ${e instanceof Error ? e.message : String(e)}`,
      `fix the scenario at ${path} so it imports cleanly and re-run the shot.`,
    );
  }
  return mod.default;
}
