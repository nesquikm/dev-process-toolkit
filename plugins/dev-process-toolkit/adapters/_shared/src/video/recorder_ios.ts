// STE-668 — the iOS simulator recorder.
//
// Starts `xcrun simctl io <device> recordVideo --codec h264 <clip>`, runs the
// shot's driver argv, then stops the recorder with SIGINT (simctl finalises
// the file on SIGINT) and waits for it to exit before validating.

import { videoWorkDir } from "../dpt_paths";
import type { Runner, Which } from "./render";
import {
  defaultSpawner,
  prepareFreshShotOutputs,
  RECORDER_ENV,
  type Shot,
  type Spawner,
  validateRecording,
} from "./recorder";
import { defaultEmptyMarkers, deviceRefuser, driveWhileRecording, requireDriver, requireTool } from "./recorder_device";

export async function recordIosSim(opts: {
  projectRoot: string;
  slug: string;
  shot: Shot;
  device: string;
  spawner?: Spawner;
  runner?: Runner;
  which?: Which;
}): Promise<{ clip: string; markers: string }> {
  const id = opts.shot.id;
  const spawn = opts.spawner ?? defaultSpawner;
  const refuse = deviceRefuser("ios-sim", id);
  const driver = requireDriver("ios-sim", opts.shot.driver, refuse);
  const env = { ...process.env };
  const run = { cwd: opts.projectRoot, env };
  requireTool("xcrun", opts.which, refuse, "install Xcode (or its command-line tools) so `xcrun` is on PATH.");
  const listing = spawn(["xcrun", "simctl", "list", "devices"], run);
  const [listCode, listOut] = await Promise.all([listing.exited, listing.stdout]);
  if (listCode !== 0 || !/\(Booted\)/.test(listOut)) {
    refuse(
      "— `xcrun simctl list devices` shows no booted simulator",
      "boot a simulator (e.g. `xcrun simctl boot <device>`) before recording.",
    );
  }

  const workDir = videoWorkDir(opts.projectRoot, opts.slug);
  const { clip, markers } = prepareFreshShotOutputs(workDir, id);

  const recorder = spawn(["xcrun", "simctl", "io", opts.device, "recordVideo", "--codec", "h264", clip], run);
  await driveWhileRecording({
    kind: "ios-sim",
    spawn,
    recorder,
    driver,
    cwd: opts.projectRoot,
    env: {
      ...env,
      [RECORDER_ENV.shot]: id,
      [RECORDER_ENV.scenario]: opts.shot.scenario,
      [RECORDER_ENV.outClip]: clip,
      [RECORDER_ENV.outMarkers]: markers,
    },
    stop: () => recorder.kill("SIGINT"),
    refuse,
  });

  defaultEmptyMarkers(markers);
  await validateRecording({ workDir, shot: opts.shot, runner: opts.runner, which: opts.which });
  return { clip, markers };
}
