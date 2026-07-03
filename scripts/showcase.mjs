#!/usr/bin/env node
// Captures a few showcase screenshots by driving the real client via debug
// hooks. Not a test — purely for the README gallery.
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8093;
const BASE = `http://localhost:${PORT}`;
const ART = path.join(root, 'docs');
const CHROMIUM = '/opt/pw-browsers/chromium';

let server, browser;
try {
  if (!fs.existsSync(path.join(root, 'client/dist/index.html'))) execSync('npm run build', { cwd: root, stdio: 'inherit' });
  server = spawn('node', ['server/dist/index.js'], { cwd: root, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  await wait(async () => (await fetch(BASE)).ok, 15000);
  browser = await chromium.launch({
    executablePath: CHROMIUM,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
      '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'],
  });
  // full graphics (no ?low): shadows + bloom + shader sky/water
  const hero = await join(browser, 'Player');
  await hero.bringToFront();

  // bright late-morning: on-foot hero shot with shadows
  await hero.evaluate('window.__game.setDayPhase(0.2)');
  await hero.waitForTimeout(1500);
  await hero.screenshot({ path: path.join(ART, 'showcase-foot.png') });

  // drive to a car and get in
  await hero.keyboard.down('w');
  for (let i = 0; i < 300; i++) {
    const s = await hero.evaluate('(() => ({ p: window.__game.pos(), v: window.__game.nearestVehicle() }))()');
    if (!s.v || s.v.dist < 2.6) break;
    await hero.evaluate(`window.__game.setCamYaw(${Math.atan2(s.v.x - s.p[0], s.v.z - s.p[2])})`);
    await hero.waitForTimeout(110);
  }
  await hero.keyboard.up('w');
  await hero.keyboard.press('e');
  await hero.waitForTimeout(600);
  await hero.keyboard.down('w');
  await hero.waitForTimeout(2200);
  await hero.screenshot({ path: path.join(ART, 'showcase-drive.png') });
  await hero.keyboard.up('w');

  // neon night: bloom on lit windows, lamps, headlights, taxi sign
  await hero.evaluate('window.__game.setDayPhase(0.79)');
  await hero.waitForTimeout(1200);
  await hero.screenshot({ path: path.join(ART, 'showcase-night.png') });

  console.log('[showcase] screenshots written to docs/');
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) server.kill('SIGKILL');
}

async function join(browser, name, view) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(`${BASE}/?debug=1`, { waitUntil: 'domcontentloaded' });
  await page.fill('#name-input', name);
  await page.click('#join-btn');
  await page.waitForFunction('window.__game && window.__game.connected()', undefined, { timeout: 15000 });
  return page;
}
async function wait(cond, timeout) {
  const start = Date.now();
  while (Date.now() - start < timeout) { try { if (await cond()) return; } catch {} await new Promise((r) => setTimeout(r, 250)); }
  throw new Error('timeout');
}
