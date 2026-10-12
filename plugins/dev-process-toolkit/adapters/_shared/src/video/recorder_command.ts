// STE-666 — the command recorder.
//
// Runs the project's configured argv with cwd = project root and the four
// RECORDER_ENV variables set to the shot's values. The command is expected to
// write `clips/<id>.mp4` and `markers/<id>.json` in the video work dir.

import { videoWorkDir } from "../dpt_paths";
import type { Runner, Which } from "./render";
import {
  prepareFreshShotOutputs,
  RECORDER_ENV,
  refuseRecording,
  type Shot,
  stderrTail,
  validateRecording,
} from "./recorder";

function refuse(shotId: string, reason: string, stderr: string): never {
  refuseRecording({
    subject: "command recorder",
    recorder: "command",
    shotId,
    reason: `— ${reason}`,
    remedy: "fix the recorder command so it exits 0 after writing clips/<id>.mp4 and markers/<id>.json.",
    trailer: ["Last 20 lines of stderr:", stderrTail(stderr)],
  });
}

export async function recordCommand(opts: {
  projectRoot: string;
  slug: string;
  shot: Shot;
  command: string[];
  runner?: Runner;
  which?: Which;
}): Promise<{ clip: string; markers: string }> {
  const id = opts.shot.id;
  const workDir = videoWorkDir(opts.projectRoot, opts.slug);
  const { clip, markers } = prepareFreshShotOutputs(workDir, id);

  const proc = Bun.spawn(opts.command, {
    cwd: opts.projectRoot,
    env: {
      ...process.env,
      [RECORDER_ENV.shot]: id,
      [RECORDER_ENV.scenario]: opts.shot.scenario,
      [RECORDER_ENV.outClip]: clip,
      [RECORDER_ENV.outMarkers]: markers,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) refuse(id, `the command exited ${code}`, stderr);
  try {
    await validateRecording({ workDir, shot: opts.shot, runner: opts.runner, which: opts.which });
  } catch (e) {
    refuse(id, `the command exited 0 without a valid recording: ${(e as Error).message.split("\n")[0]}`, stderr);
  }
  return { clip, markers };
}
