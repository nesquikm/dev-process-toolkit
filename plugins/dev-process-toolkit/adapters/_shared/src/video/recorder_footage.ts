// STE-666 — the footage recorder.
//
// Transcodes the shot's mapped file (relative to videoFootageDir) to
// `clips/<id>.mp4` in the video work dir and writes `markers/<id>.json`
// from the mapping (empty when it names none). A shot with no mapping, or a
// mapping to a missing file, refuses naming the shot and the path.

import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { videoFootageDir, videoWorkDir } from "../dpt_paths";
import { defaultRunner, requireRenderBinaries, type Runner, type Which } from "./render";
import { type FootageMapping, prepareShotOutputs, refuseRecording, type Shot } from "./recorder";

function refuse(shotId: string, reason: string, remedy: string): never {
  refuseRecording({ subject: "footage", recorder: "footage", shotId, reason: `— ${reason}`, remedy });
}

export async function recordFootage(opts: {
  projectRoot: string;
  slug: string;
  shot: Shot;
  mapping: FootageMapping;
  runner?: Runner;
  which?: Which;
}): Promise<{ clip: string; markers: string }> {
  const id = opts.shot.id;
  const footageDir = videoFootageDir(opts.projectRoot);
  const entry = Object.prototype.hasOwnProperty.call(opts.mapping, id) ? opts.mapping[id] : undefined;
  if (!entry) {
    refuse(
      id,
      `no footage mapping names this shot (footage lives in ${footageDir})`,
      `add a mapping for \`${id}\` naming a file under ${footageDir}.`,
    );
  }
  const source = join(footageDir, entry.file);
  if (!existsSync(source)) {
    refuse(id, `mapped file ${source} does not exist`, `place ${entry.file} under ${footageDir} or fix the mapping.`);
  }

  const workDir = videoWorkDir(opts.projectRoot, opts.slug);
  const { clip, markers } = prepareShotOutputs(workDir, id);

  const runner = opts.runner ?? defaultRunner;
  const { ffmpeg } = requireRenderBinaries(opts.which);
  const res = await runner(
    [ffmpeg, "-y", "-v", "error", "-i", source, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", clip],
    { cwd: workDir },
  );
  if (res.code !== 0) {
    refuse(id, `ffmpeg exited ${res.code} transcoding ${source}: ${res.stderr.trim()}`, "check the source file plays.");
  }
  writeFileSync(markers, `${JSON.stringify(entry.markers ?? [], null, 2)}\n`);
  return { clip, markers };
}
