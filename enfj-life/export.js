// Renders index.html to an MP4 (1080x1920, 30fps) with the synthesised soundtrack.
// Usage: node export.js [out.mp4] [--fps 30] [--preview t1,t2,...]
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const out = path.resolve(args.find(a => a.endsWith('.mp4')) || 'enfj-life.mp4');
const fpsI = args.indexOf('--fps');
const FPS = fpsI >= 0 ? Number(args[fpsI + 1]) : 30;
const prevI = args.indexOf('--preview');
const preview = prevI >= 0 ? args[prevI + 1].split(',').map(Number) : null;

(async () => {
  const browser = await chromium.launch({ proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  await page.addInitScript(() => { window.__ENFJ_EXPORT__ = true; });
  page.on('pageerror', e => console.error('page error:', e.message));
  await page.goto('file://' + path.join(__dirname, 'index.html'));
  await page.waitForFunction(() => window.ENFJ);
  await page.evaluate(() => window.ENFJ.ready);
  const D = await page.evaluate(() => window.ENFJ.DURATION);
  console.log('duration', D);

  if (preview) {
    const dir = path.join(path.dirname(out), 'preview');
    fs.mkdirSync(dir, { recursive: true });
    for (const t of preview) {
      const url = await page.evaluate(t => window.ENFJ.frame(t, .85), t);
      fs.writeFileSync(path.join(dir, `t${String(t).padStart(6, '0')}.jpg`), Buffer.from(url.split(',')[1], 'base64'));
    }
    await browser.close();
    return;
  }

  // audio
  const wavLen = await page.evaluate(() => window.ENFJ.audio());
  const wavPath = out.replace(/\.mp4$/, '.wav');
  const fd = fs.openSync(wavPath, 'w');
  const CH = 3 * 1024 * 1024;
  for (let off = 0; off < wavLen; off += CH) {
    const b64 = await page.evaluate(([o, n]) => window.ENFJ.chunk(o, n), [off, CH]);
    fs.writeSync(fd, Buffer.from(b64, 'base64'));
  }
  fs.closeSync(fd);
  console.log('audio written', wavPath);

  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', '-i', wavPath,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '21', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  const N = Math.floor(D * FPS);
  for (let i = 0; i < N; i++) {
    const url = await page.evaluate(t => window.ENFJ.frame(t), i / FPS);
    const ok = ff.stdin.write(Buffer.from(url.split(',')[1], 'base64'));
    if (!ok) await new Promise(r => ff.stdin.once('drain', r));
    if (i % 300 === 0) console.log(`frame ${i}/${N}`);
  }
  ff.stdin.end();
  await new Promise(r => ff.on('close', r));
  await browser.close();
  console.log('done', out);
})();
