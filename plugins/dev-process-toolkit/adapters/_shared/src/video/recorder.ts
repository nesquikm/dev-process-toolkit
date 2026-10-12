// STE-666 — the recorder contract.
//
// A recorder leaves two files per shot in the video work dir:
// `clips/<id>.mp4` (must carry a video stream) and `markers/<id>.json`
// (non-decreasing `t`, every `t` within the clip's duration).
// `validateRecording` checks both and refuses, naming the shot.

import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { RecorderKind, VideoRecorderConfig } from "./config";
import { defaultRunner, probeMedia, requireRenderBinaries, type Runner, type Which } from "./render";
import { recordCommand } from "./recorder_command";
import { recordAndroidEmu } from "./recorder_android";
import { recordFootage } from "./recorder_footage";
import { recordIosSim } from "./recorder_ios";
import { recordWeb } from "./recorder_web";

export interface Marker {
  name: string;
  t: number;
}

export interface Shot {
  id: string;
  scenario: string;
  durationHint: number;
  recorder?: RecorderKind;
  /** The shot's argv driver command (ios-sim / android-emu). */
  driver?: string[];
}

/** A started child process, as the device recorders see it. */
export interface SpawnedProcess {
  exited: Promise<number>;
  stdout: Promise<string>;
  stderr: Promise<string>;
  kill(signal?: NodeJS.Signals): void;
}

/** An injectable process launcher; every child a device recorder starts goes through it. */
export type Spawner = (argv: string[], opts: { cwd: string; env: Record<string, string | undefined> }) => SpawnedProcess;

export const defaultSpawner: Spawner = (argv, opts) => {
  const proc = Bun.spawn(argv, { cwd: opts.cwd, env: opts.env, stdout: "pipe", stderr: "pipe" });
  return {
    exited: proc.exited,
    stdout: new Response(proc.stdout).text(),
    stderr: new Response(proc.stderr).text(),
    kill: (signal) => proc.kill(signal),
  };
};

/** The ONE list of env vars a command recorder receives. */
export const RECORDER_ENV = {
  shot: "DPT_VIDEO_SHOT",
  scenario: "DPT_VIDEO_SCENARIO",
  outClip: "DPT_VIDEO_OUT_CLIP",
  outMarkers: "DPT_VIDEO_OUT_MARKERS",
} as const;

/** `file` is relative to videoFootageDir(projectRoot). */
export type FootageMapping = Record<string, { file: string; markers?: Marker[] }>;

/** Where a recorder leaves a shot's clip and markers inside the video work dir. */
export function shotOutputs(workDir: string, shotId: string): { clip: string; markers: string } {
  return { clip: join(workDir, "clips", `${shotId}.mp4`), markers: join(workDir, "markers", `${shotId}.json`) };
}

/** `shotOutputs`, with both parent dirs created so a recorder can write into them. */
export function prepareShotOutputs(workDir: string, shotId: string): { clip: string; markers: string } {
  mkdirSync(join(workDir, "clips"), { recursive: true });
  mkdirSync(join(workDir, "markers"), { recursive: true });
  return shotOutputs(workDir, shotId);
}

/**
 * `prepareShotOutputs`, with any clip/markers pair left by an earlier run
 * removed first: a stale pair must not pass for this run's recording.
 */
export function prepareFreshShotOutputs(workDir: string, shotId: string): { clip: string; markers: string } {
  const outputs = prepareShotOutputs(workDir, shotId);
  rmSync(outputs.clip, { force: true });
  rmSync(outputs.markers, { force: true });
  return outputs;
}

/**
 * The NFR-10 refusal every recorder throws, naming the shot. `subject` leads
 * the Refusing line, `recorder` (when set) joins the Context line, and
 * `trailer` lines follow the Context line verbatim.
 */
export function refuseRecording(opts: {
  subject: string;
  shotId: string;
  reason: string;
  remedy: string;
  recorder?: RecorderKind;
  trailer?: string[];
}): never {
  const recorder = opts.recorder ? `recorder=${opts.recorder}, ` : "";
  throw new Error(
    [
      `Refusing: ${opts.subject} for shot \`${opts.shotId}\` ${opts.reason}`,
      `Remedy: ${opts.remedy}`,
      `Context: mode=video-record, ${recorder}shot=${opts.shotId}`,
      ...(opts.trailer ?? []),
    ].join("\n"),
  );
}

/** The last `lines` lines of a child's stderr, trailing newlines dropped — quoted in recorder refusals. */
export function stderrTail(stderr: string, lines = 20): string {
  return stderr.replace(/\n+$/, "").split("\n").slice(-lines).join("\n");
}

function refuse(shotId: string, reason: string, remedy: string): never {
  refuseRecording({ subject: "recording", shotId, reason: `is invalid — ${reason}`, remedy });
}

export async function validateRecording(opts: {
  workDir: string;
  shot: Shot;
  runner?: Runner;
  which?: Which;
}): Promise<{ duration: number; markers: Marker[] }> {
  const id = opts.shot.id;
  const { clip, markers: markersPath } = shotOutputs(opts.workDir, id);
  const remedy = "re-run the shot's recorder so it writes both clips/<id>.mp4 and markers/<id>.json.";

  if (!existsSync(clip)) refuse(id, `clip ${clip} is missing`, remedy);
  if (!existsSync(markersPath)) refuse(id, `markers file ${markersPath} is missing`, remedy);

  const runner = opts.runner ?? defaultRunner;
  const { ffprobe } = requireRenderBinaries(opts.which);
  const probe = await probeMedia(runner, ffprobe, clip, opts.workDir);
  if (!probe.ok) refuse(id, `ffprobe could not read ${clip}: ${probe.stderr.trim()}`, remedy);
  if (!probe.streams.some((s) => s.codec_type === "video")) {
    refuse(id, `clip ${clip} has no video stream`, remedy);
  }
  const duration = probe.duration;
  if (!Number.isFinite(duration)) refuse(id, `clip ${clip} has an unreadable duration`, remedy);

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(markersPath, "utf8"));
  } catch (e) {
    refuse(id, `markers file ${markersPath} is not valid JSON: ${(e as Error).message}`, remedy);
  }
  if (!Array.isArray(parsed)) refuse(id, `markers file ${markersPath} is not a JSON array`, remedy);
  const markers: Marker[] = [];
  let prev = -Infinity;
  for (const m of parsed as unknown[]) {
    const rec = m as { name?: unknown; t?: unknown };
    if (!rec || typeof rec.name !== "string" || typeof rec.t !== "number" || !Number.isFinite(rec.t)) {
      refuse(id, `markers file ${markersPath} holds an entry without a string name and a numeric t`, remedy);
    }
    const marker = { name: rec.name as string, t: rec.t as number };
    if (marker.t < prev) {
      refuse(id, `marker \`${marker.name}\` at ${marker.t}s comes before the previous marker at ${prev}s`, remedy);
    }
    if (marker.t > duration) {
      refuse(id, `marker \`${marker.name}\` at ${marker.t}s is past the clip's duration of ${duration}s`, remedy);
    }
    prev = marker.t;
    markers.push(marker);
  }
  return { duration, markers };
}

/** Dispatcher: `shot.recorder` overrides `config.kind`. */
export async function recordShot(opts: {
  projectRoot: string;
  slug: string;
  shot: Shot;
  config: VideoRecorderConfig;
  footage?: FootageMapping;
  loadPlaywright?: (projectRoot: string) => Promise<any | null>;
  runner?: Runner;
  which?: Which;
  spawner?: Spawner;
}): Promise<{ kind: RecorderKind; clip: string; markers: string }> {
  const { projectRoot, slug, shot, config, runner, which } = opts;
  const kind = shot.recorder ?? config.kind;
  if (kind === "footage") {
    const out = await recordFootage({ projectRoot, slug, shot, mapping: opts.footage ?? {}, runner, which });
    return { kind, ...out };
  }
  if (kind === "web") {
    const out = await recordWeb({ projectRoot, slug, shot, loadPlaywright: opts.loadPlaywright, runner, which });
    return { kind, ...out };
  }
  if (kind === "ios-sim" && config.kind === "ios-sim") {
    const out = await recordIosSim({ projectRoot, slug, shot, device: config.device, spawner: opts.spawner, runner, which });
    return { kind, ...out };
  }
  if (kind === "android-emu" && config.kind === "android-emu") {
    const out = await recordAndroidEmu({ projectRoot, slug, shot, device: config.device, spawner: opts.spawner, runner, which });
    return { kind, ...out };
  }
  if (kind === "command") {
    if (config.kind !== "command") {
      refuse(
        shot.id,
        "the shot asks for the command recorder but the project declares no recorder command",
        "set recorder.kind: command with a command argv in the video config, or drop the shot's recorder override.",
      );
    }
    const out = await recordCommand({ projectRoot, slug, shot, command: config.command, runner, which });
    return { kind, ...out };
  }
  refuse(
    shot.id,
    `recorder kind \`${kind}\` has no recorder implementation here`,
    "use recorder kind `footage`, `web` or `command` for this shot.",
  );
}
