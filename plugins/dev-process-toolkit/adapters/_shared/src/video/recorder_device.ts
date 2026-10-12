// STE-668 — the pieces the ios-sim and android-emu recorders share.
//
// Both recorders refuse a shot without a driver, refuse when their device
// tool is not on PATH, and run the same middle: start the recorder, run the
// driver, stop the recorder, wait for it to exit, and refuse (quoting the
// driver's stderr tail) when the driver failed.

import { existsSync, writeFileSync } from "node:fs";
import { defaultWhich, type Which } from "./render";
import { refuseRecording, type SpawnedProcess, type Spawner, stderrTail } from "./recorder";

export type DeviceRecorderKind = "ios-sim" | "android-emu";

/** What the driver drives: "simulator" (ios-sim) or "emulator" (android-emu). */
const TARGET: Record<DeviceRecorderKind, string> = { "ios-sim": "simulator", "android-emu": "emulator" };

export type DeviceRefuse = (reason: string, remedy: string, trailer?: string[]) => never;

/** The NFR-10 refusal of one device recorder for one shot. */
export function deviceRefuser(kind: DeviceRecorderKind, shotId: string): DeviceRefuse {
  return (reason, remedy, trailer) =>
    refuseRecording({ subject: `${kind} recorder`, recorder: kind, shotId, reason, remedy, trailer });
}

/** The shot's driver argv; refuses when the shot declares none. */
export function requireDriver(kind: DeviceRecorderKind, driver: string[] | undefined, refuse: DeviceRefuse): string[] {
  if (!driver || driver.length === 0) {
    refuse(
      "— the shot declares no driver command",
      `give the shot a \`driver\` argv that drives the app on the ${TARGET[kind]}.`,
    );
  }
  return driver;
}

/** Refuses when `tool` is not on PATH. */
export function requireTool(tool: string, which: Which | undefined, refuse: DeviceRefuse, remedy: string): void {
  if (!(which ?? defaultWhich)(tool)) refuse(`— \`${tool}\` is not on PATH`, remedy);
}

/**
 * Runs the driver while `recorder` records, then `stop`s the recorder and
 * waits for it to exit — whatever the driver's exit code — before refusing
 * on a failed driver.
 */
export async function driveWhileRecording(opts: {
  kind: DeviceRecorderKind;
  spawn: Spawner;
  recorder: SpawnedProcess;
  driver: string[];
  cwd: string;
  env: Record<string, string | undefined>;
  stop: () => void | Promise<void>;
  refuse: DeviceRefuse;
}): Promise<void> {
  const drv = opts.spawn(opts.driver, { cwd: opts.cwd, env: opts.env });
  const [code, stderr] = await Promise.all([drv.exited, drv.stderr]);
  await opts.stop();
  await opts.recorder.exited;
  if (code !== 0) {
    opts.refuse(
      `— the driver exited ${code}`,
      `fix the shot's driver command so it exits 0 after driving the app on the ${TARGET[opts.kind]}.`,
      ["Last 20 lines of driver stderr:", stderrTail(stderr)],
    );
  }
}

/**
 * The driver MAY write markers; when it wrote none, the shot's markers file
 * becomes `[]` so the recording still validates.
 */
export function defaultEmptyMarkers(markers: string): void {
  if (!existsSync(markers)) writeFileSync(markers, "[]\n");
}
