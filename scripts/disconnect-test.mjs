#!/usr/bin/env node
// Flow test: a driver hard-disconnects mid-drive. The server must free the
// car (driverId -> null), keep the world consistent for observers, and keep
// ticking. Requires npm run build first.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8094;
let server, failed = 0;
const ok = (c, m) => { console.log(`${c ? '  OK' : 'FAIL'}: ${m}`); if (!c) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect(name) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
    const st = { ws, id: null, welcome: null, snaps: [], snapCount: 0 };
    ws.onopen = () => ws.send(JSON.stringify({ t: 'join', name }));
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.t === 'welcome') { st.welcome = m; st.id = m.id; resolve(st); }
      if (m.t === 'snapshot') { st.snapCount++; st.snaps.push(m); if (st.snaps.length > 60) st.snaps.shift(); }
    };
  });
}
const rowOf = (st, kind, id) => {
  for (let i = st.snaps.length - 1; i >= 0; i--) {
    const r = st.snaps[i][kind].find((x) => x[0] === id);
    if (r) return r;
  }
  return null;
};

try {
  server = spawn('node', ['server/dist/index.js'], { cwd: root, env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let crashed = false;
  server.on('exit', (code, sig) => { if (code !== 0 && sig !== 'SIGKILL') crashed = true; });
  await sleep(1200);

  const observer = await connect('Observer');
  const driver = await connect('Driver');

  // driver grabs the nearest car and drives it a bit
  let car = null, best = 1e9;
  for (const v of driver.welcome.vehicles) {
    const d = Math.hypot(v.pos[0] - driver.welcome.spawn[0], v.pos[2] - driver.welcome.spawn[2]);
    if (d < best) { best = d; car = v; }
  }
  // walk over (send legal foot states)
  let px = driver.welcome.spawn[0], pz = driver.welcome.spawn[2];
  for (let i = 0; i < 400 && Math.hypot(car.pos[0] - px, car.pos[2] - pz) > 1.2; i++) {
    const dx = car.pos[0] - px, dz = car.pos[2] - pz, dd = Math.hypot(dx, dz), s = Math.min(0.3, dd);
    px += dx / dd * s; pz += dz / dd * s;
    driver.ws.send(JSON.stringify({ t: 'state', seq: i, mode: 'foot', pos: [px, 0, pz], yaw: Math.atan2(dx, dz), anim: 'walk' }));
    await sleep(50);
  }
  driver.ws.send(JSON.stringify({ t: 'enterVehicle', vehId: car.id }));
  await sleep(300);
  // drive forward
  let vx = car.pos[0], vz = car.pos[2];
  for (let i = 0; i < 20; i++) {
    vx += 0.6;
    driver.ws.send(JSON.stringify({ t: 'state', seq: i, mode: 'drive', pos: [vx, 0, vz], yaw: 0, anim: 'idle', veh: { id: car.id, pos: [vx, 0, vz], yaw: 0, speed: 12 } }));
    await sleep(50);
  }
  const drow = rowOf(observer, 'vehicles', car.id);
  ok(drow && drow[6] === driver.id, 'observer sees driver seated in the car');

  // HARD disconnect the driver mid-drive
  driver.ws.close();
  await sleep(800);

  const after = rowOf(observer, 'vehicles', car.id);
  ok(after && after[6] === '', 'car freed (driverId cleared) after driver dropped');
  ok(!crashed && server.exitCode === null, 'server still running after hard disconnect');

  // observer still receiving snapshots
  const n1 = observer.snapCount;
  await sleep(500);
  ok(observer.snapCount > n1, `server keeps broadcasting to remaining clients (+${observer.snapCount - n1})`);

  console.log(failed ? `\n[disc] ❌ ${failed} FAILED` : '\n[disc] ✅ PASSED');
} finally {
  if (server) server.kill('SIGKILL');
  process.exit(failed ? 1 : 0);
}
