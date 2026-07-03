#!/usr/bin/env node
// End-to-end smoke test: builds (if needed), boots the production server,
// opens TWO headless Chromium pages, joins both, and asserts:
//   - both clients connect and see each other's player entity
//   - movement on page A propagates to page B
//   - the scene actually renders (canvas pixel variance)
//   - draw calls stay under budget
// Exits non-zero on any failure. Screenshots land in smoke-artifacts/.

import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.SMOKE_PORT || 8091;
const BASE = `http://localhost:${PORT}`;
const ART_DIR = process.env.SMOKE_ARTIFACTS || path.join(root, 'smoke-artifacts');
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';

let server = null;
let browser = null;
let failed = false;

const log = (msg) => console.log(`[smoke] ${msg}`);
const fail = (msg) => {
  console.error(`[smoke] FAIL: ${msg}`);
  failed = true;
};

async function main() {
  fs.mkdirSync(ART_DIR, { recursive: true });

  // determinism guard: no Math.random in shared/
  const grep = execSync(
    `grep -rn "Math.random()" ${path.join(root, 'shared', 'src')} || true`,
    { encoding: 'utf8' },
  ).trim();
  if (grep) {
    fail(`Math.random found in shared/ (breaks determinism):\n${grep}`);
    process.exit(1);
  }
  log('determinism guard passed (no Math.random in shared/)');

  if (!fs.existsSync(path.join(root, 'client', 'dist', 'index.html')) ||
      !fs.existsSync(path.join(root, 'server', 'dist', 'index.js'))) {
    log('building…');
    execSync('npm run build', { cwd: root, stdio: 'inherit' });
  }

  log(`starting server on :${PORT}`);
  server = spawn('node', ['server/dist/index.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (d) => process.stdout.write(`[server] ${d}`));
  server.stderr.on('data', (d) => process.stderr.write(`[server:err] ${d}`));

  await waitFor(async () => (await fetch(BASE)).ok, 15000, 'server HTTP up');

  log('launching headless chromium (SwiftShader WebGL)');
  browser = await chromium.launch({
    executablePath: fs.existsSync(CHROMIUM) ? CHROMIUM : undefined,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--enable-unsafe-swiftshader',
      '--use-angle=swiftshader',
      '--disable-gpu-sandbox',
      // never throttle rAF in occluded pages — both players must simulate at full rate
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
    ],
  });

  const pageA = await newPlayer('SmokeA');
  const pageB = await newPlayer('SmokeB');
  await pageA.bringToFront();

  // --- cross visibility ---
  await waitForFn(pageA, 'window.__game && window.__game.remotePlayerIds().length >= 1', 15000,
    'page A sees a remote player');
  await waitForFn(pageB, 'window.__game && window.__game.remotePlayerIds().length >= 1', 15000,
    'page B sees a remote player');
  const idA = await pageA.evaluate('window.__game.myId()');
  const remoteOfB = await pageB.evaluate('window.__game.remotePlayerIds()');
  if (!remoteOfB.includes(idA)) {
    fail(`page B remote list ${JSON.stringify(remoteOfB)} does not include page A id ${idA}`);
  } else {
    log(`cross visibility OK (A=${idA} visible on B)`);
  }

  // --- movement propagation: A runs forward, B should see A move ---
  const posBefore = await pageB.evaluate(`window.__game.remotePos(${JSON.stringify(idA)})`);
  await pageA.keyboard.down('w');
  await pageA.waitForTimeout(2000);
  await pageA.keyboard.up('w');
  await pageA.waitForTimeout(400);
  const posAfter = await pageB.evaluate(`window.__game.remotePos(${JSON.stringify(idA)})`);
  if (!posBefore || !posAfter) {
    fail('could not read remote position of A on page B');
  } else {
    const dist = Math.hypot(posAfter[0] - posBefore[0], posAfter[2] - posBefore[2]);
    if (dist < 1.5) fail(`A moved only ${dist.toFixed(2)}m as seen by B (expected > 1.5m)`);
    else log(`movement propagation OK (A moved ${dist.toFixed(1)}m as seen from B)`);
  }

  // --- render sanity: canvas is not blank ---
  const samples = await pageA.evaluate('window.__game.sampleCanvas()');
  const distinct = new Set(samples.map((s) => s.join(','))).size;
  const brightness = samples.reduce((acc, s) => acc + s[0] + s[1] + s[2], 0) / samples.length;
  if (distinct < 6 || brightness < 5) {
    fail(`canvas looks blank (distinct=${distinct}, brightness=${brightness.toFixed(1)})`);
  } else {
    log(`render sanity OK (${distinct} distinct colors sampled, brightness ${brightness.toFixed(0)})`);
  }

  // --- perf guard: draw calls ---
  const calls = await pageA.evaluate('window.__game.drawCalls()');
  if (calls > 350) fail(`draw calls too high: ${calls}`);
  else log(`draw calls OK (${calls})`);

  await pageA.screenshot({ path: path.join(ART_DIR, 'playerA.png') });
  await pageB.screenshot({ path: path.join(ART_DIR, 'playerB.png') });

  // --- vehicle: A walks to the nearest car, enters, drives ---
  let arrived = false;
  await pageA.keyboard.down('w');
  for (let i = 0; i < 450; i++) {
    const state = await pageA.evaluate(
      '(() => { const p = window.__game.pos(); const v = window.__game.nearestVehicle(); return { p, v }; })()',
    );
    if (!state.v) break;
    if (state.v.dist < 2.6) { arrived = true; break; }
    const yaw = Math.atan2(state.v.x - state.p[0], state.v.z - state.p[2]);
    await pageA.evaluate(`window.__game.setCamYaw(${yaw})`);
    await pageA.waitForTimeout(100);
  }
  await pageA.keyboard.up('w');
  if (!arrived) {
    fail('A could not reach a vehicle on foot');
  } else {
    await pageA.keyboard.press('e');
    const driving = await waitForFn(pageA, 'window.__game.mode() === "drive"', 5000, 'A seated in vehicle');
    if (driving) {
      log('A entered a vehicle');
      const posStart = await pageA.evaluate('window.__game.pos()');
      await pageA.keyboard.down('w');
      await pageA.waitForTimeout(2500);
      const speed = await pageA.evaluate('window.__game.speed()');
      await pageA.screenshot({ path: path.join(ART_DIR, 'driving.png') });
      await pageA.keyboard.up('w');
      const posEnd = await pageA.evaluate('window.__game.pos()');
      const drove = Math.hypot(posEnd[0] - posStart[0], posEnd[2] - posStart[2]);
      if (drove < 8 || speed < 4) fail(`vehicle barely moved (${drove.toFixed(1)}m, ${speed.toFixed(1)} m/s)`);
      else log(`driving OK (${drove.toFixed(0)}m at up to ${speed.toFixed(0)} m/s)`);
      // B should see that vehicle moving too
      const vehId = await pageA.evaluate('window.__game.nearestVehicle()?.id ?? null');
      log(`A driving near vehicle ${vehId}`);
    }
  }

  // --- day-night cycle changes the scene, and night still renders ---
  const daySamples = await pageB.evaluate('window.__game.sampleCanvas()');
  await pageB.evaluate('window.__game.setDayPhase(0.75)');
  await pageB.waitForTimeout(700);
  const nightSamples = await pageB.evaluate('window.__game.sampleCanvas()');
  const nightDistinct = new Set(nightSamples.map((s) => s.join(','))).size;
  const changed = nightSamples.some((s, i) => Math.abs(s[0] + s[1] + s[2] - (daySamples[i][0] + daySamples[i][1] + daySamples[i][2])) > 12);
  if (nightDistinct < 6) fail(`night frame looks blank (${nightDistinct} colors)`);
  else if (!changed) fail('day-night cycle did not change the scene');
  else log(`day-night cycle OK (scene shifts, night renders ${nightDistinct} colors)`);
  await pageB.screenshot({ path: path.join(ART_DIR, 'night.png') });

  // free the two gameplay contexts before the heavy full-pipeline page
  await pageA.close();
  await pageB.close();

  // --- full graphics pipeline (shadows + bloom + shader sky/water) renders ---
  await fullGraphicsCheck();

  log(`screenshots in ${ART_DIR}`);
}

async function fullGraphicsCheck() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (err) => fail(`fullgfx page error: ${err.message}`));
  await page.goto(`${BASE}/?debug=1`, { waitUntil: 'domcontentloaded' }); // no ?low = full pipeline
  await page.fill('#name-input', 'HiFi');
  await page.click('#join-btn');
  const ok0 = await waitForFn(page, 'window.__game && window.__game.connected()', 35000, 'full-gfx page connected');
  if (!ok0) { await page.close(); return; }
  await page.waitForTimeout(2000); // let shadow maps + bloom settle
  const samples = await page.evaluate('window.__game.sampleCanvas()');
  const distinct = new Set(samples.map((s) => s.join(','))).size;
  const brightness = samples.reduce((acc, s) => acc + s[0] + s[1] + s[2], 0) / samples.length;
  const calls = await page.evaluate('window.__game.drawCalls()');
  if (distinct < 6 || brightness < 5) fail(`full-gfx canvas blank (distinct=${distinct})`);
  else log(`full graphics render OK (${distinct} colors, ${calls} draw calls incl. shadow+bloom passes)`);
  await page.screenshot({ path: path.join(ART_DIR, 'fullgfx.png') });
  await page.close();
}

async function newPlayer(name) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
  page.on('pageerror', (err) => fail(`${name} page error: ${err.message}`));
  page.on('crash', () => fail(`${name} page CRASHED`));
  page.on('load', () => log(`${name} page load event`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error(`[${name}:console] ${msg.text()}`);
  });
  // gameplay pages use ?low: shadows/bloom off so the fixed-rate assertions
  // are reliable under headless SwiftShader (the full pipeline is verified
  // separately by fullGraphicsCheck). Real browsers get the full pipeline.
  await page.goto(`${BASE}/?debug=1&low=1`, { waitUntil: 'domcontentloaded' });
  await page.fill('#name-input', name);
  await page.click('#join-btn');
  await waitForFn(page, 'window.__game && window.__game.connected()', 15000, `${name} connected`);
  log(`${name} joined`);
  return page;
}

async function waitForFn(page, fn, timeout, label) {
  try {
    await page.waitForFunction(fn, undefined, { timeout });
    return true;
  } catch {
    fail(`timeout waiting for: ${label}`);
    return false;
  }
}

async function waitFor(cond, timeout, label) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      if (await cond()) return;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timeout: ${label}`);
}

main()
  .catch((err) => {
    fail(err.stack || String(err));
  })
  .finally(async () => {
    if (browser) await browser.close().catch(() => {});
    if (server) server.kill('SIGKILL');
    console.log(failed ? '[smoke] ❌ FAILED' : '[smoke] ✅ PASSED');
    process.exit(failed ? 1 : 0);
  });
