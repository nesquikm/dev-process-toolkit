// .dpt/video/scripts/capture-motion.mjs — render an HTML/CSS motion scene to a clip.
//
// usage: bun capture-motion.mjs <scene.html> <out.mp4> <out-markers.json> <projectRoot>
//
// The scene declares `window.SCENE = { duration, marks: [{ name, t }] }`. Every
// CSS/Web animation is paused and stepped to each frame's time, so the capture is
// frame-exact and independent of machine speed. playwright-core is resolved from
// the ignored work dir (.dpt/video/work/_tools); the browser is the installed
// Chrome, so nothing is added to the repo.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const [scenePath, outClip, outMarkers, root] = process.argv.slice(2);
const FPS = 30;
const { chromium } = await import(join(root, ".dpt/video/work/_tools/node_modules/playwright-core/index.mjs"));

const browser = await chromium.launch({ channel: "chrome", headless: true });
const frames = mkdtempSync(join(tmpdir(), "dpt-motion-"));
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  await page.goto(`file://${scenePath}`);
  await page.evaluate(() => document.fonts.ready);
  const scene = await page.evaluate(() => window.SCENE);
  if (!scene || !(scene.duration > 0)) throw new Error(`${scenePath} does not declare window.SCENE.duration`);
  await page.evaluate(() => document.getAnimations().forEach((a) => a.pause()));
  const n = Math.round(scene.duration * FPS);
  for (let i = 0; i < n; i++) {
    const ms = (i * 1000) / FPS;
    await page.evaluate((t) => document.getAnimations().forEach((a) => { a.currentTime = t; }), ms);
    await page.screenshot({ path: join(frames, `f${String(i).padStart(5, "0")}.png`) });
  }
  const ff = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", join(frames, "f%05d.png"),
    "-vf", `tpad=stop_mode=clone:stop_duration=${process.env.DPT_VIDEO_TAIL_HOLD ?? 12}`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", String(FPS), "-movflags", "+faststart", outClip], { stdio: "inherit" });
  if (ff.status !== 0) throw new Error(`ffmpeg exited ${ff.status}`);
  writeFileSync(outMarkers, JSON.stringify(scene.marks ?? [], null, 2));
  console.error(`capture-motion: ${n} frames → ${outClip}`);
} finally {
  await browser.close();
  rmSync(frames, { recursive: true, force: true });
}
