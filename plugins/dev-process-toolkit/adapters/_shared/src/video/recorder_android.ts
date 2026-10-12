// STE-668 — the Android emulator recorder.
//
// Starts `adb shell screenrecord <device-path>`, runs the shot's driver argv,
// stops screenrecord on the device (`adb shell pkill -INT screenrecord`, which
// lets it finalise the file), waits for the recorder to exit, then pulls the
// file with `adb pull <device-path> <clip>` before validating.

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

export const DEFAULT_STOP_TIMEOUT_MS = 30_000;

export async function recordAndroidEmu(opts: {
  projectRoot: string;
  slug: string;
  shot: Shot;
  device?: string;
  spawner?: Spawner;
  runner?: Runner;
  which?: Which;
  /** How long to wait for screenrecord to exit after the stop before killing it. */
  stopTimeoutMs?: number;
}): Promise<{ clip: string; markers: string }> {
  const id = opts.shot.id;
  const stopTimeoutMs = opts.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;
  const spawn = opts.spawner ?? defaultSpawner;
  const refuse = deviceRefuser("android-emu", id);
  const driver = requireDriver("android-emu", opts.shot.driver, refuse);
  if (opts.shot.durationHint > 180) {
    refuse(
      `— durationHint ${opts.shot.durationHint}s exceeds the 180-second limit of \`adb shell screenrecord\``,
      "split the shot into shots of at most 180 seconds each.",
    );
  }
  const env = { ...process.env };
  const adb = opts.device ? ["adb", "-s", opts.device] : ["adb"];
  const run = { cwd: opts.projectRoot, env };
  requireTool("adb", opts.which, refuse, "install the Android SDK platform-tools so `adb` is on PATH.");
  const listing = spawn(["adb", "devices"], run);
  const [listCode, listOut] = await Promise.all([listing.exited, listing.stdout]);
  const attached = listOut
    .split("\n")
    .slice(1)
    .map((l) => l.trim().split(/\s+/))
    .filter(([serial, state]) => serial && state === "device" && (!opts.device || serial === opts.device));
  if (listCode !== 0 || attached.length === 0) {
    refuse(
      `— \`adb devices\` lists no ${opts.device ? `\`${opts.device}\` ` : ""}device in the \`device\` state`,
      "start an emulator (or attach a device) and wait for `adb devices` to list it before recording.",
    );
  }

  const workDir = videoWorkDir(opts.projectRoot, opts.slug);
  const { clip, markers } = prepareFreshShotOutputs(workDir, id);
  const devicePath = `/sdcard/dpt-video-${id}.mp4`;

  const recorder = spawn([...adb, "shell", "screenrecord", devicePath], run);
  await driveWhileRecording({
    kind: "android-emu",
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
    stop: async () => {
      await spawn([...adb, "shell", "pkill", "-INT", "screenrecord"], run).exited;
      // Bound the wait for screenrecord to finalise; a recorder that never exits is killed, nothing is pulled.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = await Promise.race([
        recorder.exited.then(() => false),
        new Promise<boolean>((r) => (timer = setTimeout(() => r(true), stopTimeoutMs))),
      ]);
      clearTimeout(timer);
      if (timedOut) {
        recorder.kill("SIGKILL");
        refuse(
          `— \`adb shell screenrecord\` did not exit within the ${stopTimeoutMs}ms stop timeout after the stop signal`,
          "check the emulator is responsive (`adb shell pkill -INT screenrecord` must end the recording) and re-run the shot.",
        );
      }
    },
    refuse,
  });

  await spawn([...adb, "pull", devicePath, clip], run).exited;

  defaultEmptyMarkers(markers);
  await validateRecording({ workDir, shot: opts.shot, runner: opts.runner, which: opts.which });
  return { clip, markers };
}
