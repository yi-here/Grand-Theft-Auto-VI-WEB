#!/usr/bin/env node
// Gameplay contract test: two protocol-level bots exercise the server —
// join, walk, steal a car, drive it, exit, shoot the other player dead,
// respawn, verify anti-teleport clamping, and trigger a wanted level.
// Requires a prior `npm run build` (uses server/dist). Exits non-zero on failure.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.BOT_PORT || 8092;
let server = null;
let failed = false;
const log = (m) => console.log(`[bot] ${m}`);
const fail = (m) => { console.error(`[bot] FAIL: ${m}`); failed = true; };
const ok = (cond, m) => { if (cond) log(`OK: ${m}`); else fail(m); };

class Bot {
  constructor(name) {
    this.name = name;
    this.ws = null;
    this.id = null;
    this.welcome = null;
    this.pos = [0, 0, 0];
    this.yaw = 0;
    this.hp = 100;
    this.dead = false;
    this.wanted = 0;
    this.vehId = null;
    this.snapshots = [];
    this.events = [];
    this.waiters = [];
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://localhost:${PORT}/ws`);
      this.ws.onopen = () => this.send({ t: 'join', name: this.name });
      this.ws.onerror = (e) => reject(new Error(`ws error for ${this.name}`));
      this.ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.t === 'welcome') {
          this.welcome = msg;
          this.id = msg.id;
          this.pos = [...msg.spawn];
          resolve(msg);
        }
        if (msg.t === 'snapshot') {
          this.snapshots.push(msg);
          if (this.snapshots.length > 100) this.snapshots.shift();
        }
        if (msg.t === 'hit' && msg.targetId === this.id) this.hp = msg.hp;
        if (msg.t === 'death' && msg.victimId === this.id) this.dead = true;
        if (msg.t === 'respawned' && msg.id === this.id) {
          this.dead = false;
          this.hp = msg.hp;
          this.pos = [...msg.pos];
        }
        if (msg.t === 'wanted') this.wanted = msg.level;
        this.events.push(msg);
        if (this.events.length > 400) this.events.shift();
        this.waiters = this.waiters.filter((w) => {
          if (w.pred(msg)) { w.resolve(msg); return false; }
          return true;
        });
      };
    });
  }

  send(obj) {
    if (this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  sendFootState() {
    this.send({ t: 'state', seq: 0, mode: 'foot', pos: this.pos, yaw: this.yaw, anim: 'walk' });
  }

  waitFor(pred, timeoutMs, label) {
    // check already-received events first
    const past = this.events.find(pred);
    if (past) return Promise.resolve(past);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout: ${label} (${this.name})`)), timeoutMs);
      this.waiters.push({ pred, resolve: (m) => { clearTimeout(timer); resolve(m); } });
    });
  }

  /** legally walk (≤ 6 m/s reported at 20Hz) to a point */
  async walkTo(x, z, timeoutMs = 60000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const dx = x - this.pos[0];
      const dz = z - this.pos[2];
      const dist = Math.hypot(dx, dz);
      if (dist < 1.2) return true;
      const step = Math.min(6 * 0.05, dist);
      this.pos[0] += (dx / dist) * step;
      this.pos[2] += (dz / dist) * step;
      this.yaw = Math.atan2(dx, dz);
      this.sendFootState();
      await sleep(50);
    }
    throw new Error(`walkTo timed out for ${this.name}`);
  }

  /** latest known state of an entity from snapshots */
  latestRow(kind, id) {
    for (let i = this.snapshots.length - 1; i >= 0; i--) {
      const row = this.snapshots[i][kind].find((r) => r[0] === id);
      if (row) return row;
    }
    return null;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!fs.existsSync(path.join(root, 'server', 'dist', 'index.js'))) {
    throw new Error('server/dist missing — run npm run build first');
  }
  server = spawn('node', ['server/dist/index.js'], {
    cwd: root, env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (d) => process.stdout.write(`[server] ${d}`));
  await sleep(1200);

  const A = new Bot('BotAlice');
  const B = new Bot('BotBob');
  await A.connect();
  await B.connect();
  ok(A.welcome.cityHash === B.welcome.cityHash, 'both bots got the same cityHash');
  ok(A.welcome.vehicles.length > 20, `welcome lists ${A.welcome.vehicles.length} vehicles`);
  ok(A.welcome.npcs.length > 20, `welcome lists ${A.welcome.npcs.length} npcs`);
  await B.waitFor((m) => m.t === 'playerJoined' || (m.t === 'snapshot' && m.players.some((r) => r[0] === A.id)), 5000, 'B sees A');
  log('both bots joined');

  // keep-alive state pump for B so it never idles out of relevance
  const bPump = setInterval(() => B.sendFootState(), 250);

  // ---- 1. steal the nearest car ----
  let nearest = null;
  let bestD = 1e9;
  for (const v of A.welcome.vehicles) {
    const d = Math.hypot(v.pos[0] - A.pos[0], v.pos[2] - A.pos[2]);
    if (d < bestD) { bestD = d; nearest = v; }
  }
  log(`A walking ${bestD.toFixed(0)}m to ${nearest.kind} ${nearest.id}`);
  await A.walkTo(nearest.pos[0], nearest.pos[2]);
  A.send({ t: 'enterVehicle', vehId: nearest.id });
  const upd = await A.waitFor((m) => m.t === 'vehicleUpdate' && m.vehId === nearest.id, 4000, 'vehicle grant');
  ok(upd.driverId === A.id, `server granted ${nearest.id} to A`);
  A.vehId = nearest.id;

  // contested entry: B asks for the same car and must be denied
  B.send({ t: 'enterVehicle', vehId: nearest.id });
  const denied = await B.waitFor((m) => m.t === 'enterDenied', 4000, 'enterDenied for B');
  ok(denied.reason === 'occupied' || denied.reason === 'far', `B denied entry (${denied.reason})`);

  // ---- 2. drive it ----
  const startPos = [...nearest.pos];
  let vx = startPos[0];
  let vz = startPos[2];
  const vyaw = nearest.yaw;
  for (let i = 0; i < 40; i++) {
    vx += Math.sin(vyaw) * 12 * 0.05;
    vz += Math.cos(vyaw) * 12 * 0.05;
    A.pos = [vx, 0, vz];
    A.send({
      t: 'state', seq: i, mode: 'drive', pos: [vx, 0, vz], yaw: vyaw, anim: 'idle',
      veh: { id: nearest.id, pos: [vx, 0, vz], yaw: vyaw, speed: 12 },
    });
    await sleep(50);
  }
  await sleep(300);
  const rowB = B.latestRow('vehicles', nearest.id);
  ok(rowB !== null, 'B received vehicle snapshot rows');
  if (rowB) {
    const moved = Math.hypot(rowB[1] - startPos[0], rowB[3] - startPos[2]);
    ok(moved > 15, `B sees the stolen car ${moved.toFixed(1)}m from its spawn`);
    ok(rowB[6] === A.id, 'B sees A as the driver');
  }

  // ---- 3. exit ----
  A.send({ t: 'exitVehicle' });
  const exitMsg = await A.waitFor((m) => m.t === 'vehicleUpdate' && m.vehId === nearest.id && m.driverId === null, 4000, 'exit grant');
  ok(Array.isArray(exitMsg.exitPos), 'exit position provided');
  A.pos = [...exitMsg.exitPos];
  A.vehId = null;

  // ---- 4. combat: B steals its own car, drives across town to A ----
  clearInterval(bPump);
  let bCar = null;
  let bD = 1e9;
  for (const v of B.welcome.vehicles) {
    if (v.id === nearest.id) continue;
    const d = Math.hypot(v.pos[0] - B.pos[0], v.pos[2] - B.pos[2]);
    if (d < bD) { bD = d; bCar = v; }
  }
  log(`B walking ${bD.toFixed(0)}m to ${bCar.kind} ${bCar.id}`);
  await B.walkTo(bCar.pos[0], bCar.pos[2], 90000);
  B.send({ t: 'enterVehicle', vehId: bCar.id });
  await B.waitFor((m) => m.t === 'vehicleUpdate' && m.vehId === bCar.id && m.driverId === B.id, 4000, 'B vehicle grant');
  log(`B driving ${Math.hypot(A.pos[0] - B.pos[0], A.pos[2] - B.pos[2]).toFixed(0)}m to A`);
  let bx = bCar.pos[0];
  let bz = bCar.pos[2];
  const driveStart = Date.now();
  while (Math.hypot(A.pos[0] - bx, A.pos[2] - bz) > 8 && Date.now() - driveStart < 90000) {
    const dx = A.pos[0] - bx;
    const dz = A.pos[2] - bz;
    const dd = Math.hypot(dx, dz);
    const step = Math.min(18 * 0.05, dd);
    bx += (dx / dd) * step;
    bz += (dz / dd) * step;
    B.pos = [bx, 0, bz];
    B.send({
      t: 'state', seq: 0, mode: 'drive', pos: [bx, 0, bz], yaw: Math.atan2(dx, dz), anim: 'idle',
      veh: { id: bCar.id, pos: [bx, 0, bz], yaw: Math.atan2(dx, dz), speed: 18 },
    });
    await sleep(50);
  }
  // brake to a stop (server refuses exit above 12 m/s)
  for (let i = 0; i < 4; i++) {
    B.send({
      t: 'state', seq: 0, mode: 'drive', pos: [bx, 0, bz], yaw: 0, anim: 'idle',
      veh: { id: bCar.id, pos: [bx, 0, bz], yaw: 0, speed: 0 },
    });
    await sleep(60);
  }
  B.send({ t: 'exitVehicle' });
  const bExit = await B.waitFor((m) => m.t === 'vehicleUpdate' && m.vehId === bCar.id && m.driverId === null, 4000, 'B exit');
  if (bExit.exitPos) B.pos = [...bExit.exitPos];
  await B.walkTo(A.pos[0] + 2.5, A.pos[2], 30000);
  log('B reached A — opening fire');
  let deathMsg = null;
  for (let shot = 0; shot < 8 && !deathMsg; shot++) {
    const origin = [A.pos[0], A.pos[1] + 1.6, A.pos[2]];
    const target = [B.pos[0], B.pos[1] + 0.9, B.pos[2]];
    const d = [target[0] - origin[0], target[1] - origin[1], target[2] - origin[2]];
    const len = Math.hypot(...d);
    A.send({
      t: 'shoot', weapon: 'pistol',
      origin, dir: d.map((v) => v / len), hitKind: 'player', hitId: B.id, hitPos: target,
    });
    try {
      deathMsg = await A.waitFor(
        (m) => m.t === 'death' && m.victimId === B.id,
        360, 'death after shot',
      );
    } catch { /* not dead yet, keep shooting */ }
  }
  ok(deathMsg && deathMsg.killerId === A.id, `A killed B (after ${deathMsg ? 'kill' : 'no kill'})`);
  await B.waitFor((m) => m.t === 'death' && m.victimId === B.id, 3000, 'B receives its own death');
  ok(B.dead, 'B knows it is dead');
  const score = await A.waitFor((m) => m.t === 'score' && m.entries.some((e) => e.id === A.id && e.kills >= 1), 3000, 'scoreboard shows the kill');
  ok(!!score, 'score broadcast includes kill');

  // ---- 5. respawn ----
  await sleep(4000);
  B.send({ t: 'respawn' });
  const resp = await B.waitFor((m) => m.t === 'respawned' && m.id === B.id, 3000, 'B respawn');
  ok(resp.hp === 100, 'B respawned at full health');

  // ---- 6. anti-teleport clamp ----
  const before = [...A.pos];
  A.pos = [before[0] + 80, 0, before[2] + 80];
  A.sendFootState();
  await sleep(300);
  const rowA = B.latestRow('players', A.id);
  if (rowA) {
    const seen = Math.hypot(rowA[1] - before[0], rowA[3] - before[2]);
    ok(seen < 15, `teleport clamped: B sees A only ${seen.toFixed(1)}m away from pre-cheat position`);
    A.pos = [rowA[1], rowA[2], rowA[3]]; // resync to server's truth
  } else {
    fail('no player row for A after teleport attempt');
  }

  // ---- 7. wanted level: shoot a pedestrian ----
  let ped = null;
  let pedD = 1e9;
  for (const n of A.welcome.npcs) {
    if (n.ptype !== 'ped') continue;
    const row = A.latestRow('npcs', n.id);
    const px = row ? row[1] : n.pos[0];
    const pz = row ? row[2] : n.pos[2];
    const d = Math.hypot(px - A.pos[0], pz - A.pos[2]);
    if (d < pedD) { pedD = d; ped = { id: n.id, x: px, z: pz }; }
  }
  log(`A walking ${pedD.toFixed(0)}m to shoot ped ${ped.id}`);
  await A.walkTo(ped.x + 1.5, ped.z, 90000);
  const row = A.latestRow('npcs', ped.id);
  const px = row ? row[1] : ped.x;
  const pz = row ? row[2] : ped.z;
  const o = [A.pos[0], A.pos[1] + 1.6, A.pos[2]];
  const tp = [px, 0.9, pz];
  const dv = [tp[0] - o[0], tp[1] - o[1], tp[2] - o[2]];
  const dl = Math.hypot(...dv);
  A.send({ t: 'shoot', weapon: 'pistol', origin: o, dir: dv.map((v) => v / dl), hitKind: 'npc', hitId: ped.id, hitPos: tp });
  const pedHit = await A.waitFor((m) => m.t === 'hit' && m.targetId === ped.id, 3000, 'ped hit confirmed');
  ok(!!pedHit, 'pedestrian kill registered');
  const wantedMsg = await A.waitFor((m) => m.t === 'wanted' && m.level >= 1, 3000, 'wanted level raised');
  ok(wantedMsg.level >= 1, `A is wanted (level ${wantedMsg.level})`);
  const copSpawn = await A.waitFor((m) => m.t === 'npcSpawn' && m.npc.kind === 'police', 4000, 'police spawn');
  ok(!!copSpawn, `police unit ${copSpawn.npc.id} dispatched`);

  // police car should approach A
  const copStart = [copSpawn.npc.pos[0], copSpawn.npc.pos[2]];
  const d0 = Math.hypot(copStart[0] - A.pos[0], copStart[1] - A.pos[2]);
  await sleep(3000);
  const copRow = A.latestRow('npcs', copSpawn.npc.id);
  if (copRow) {
    const d1 = Math.hypot(copRow[1] - A.pos[0], copRow[2] - A.pos[2]);
    ok(d1 < d0 - 5, `police closing in (${d0.toFixed(0)}m -> ${d1.toFixed(0)}m)`);
  } else {
    fail('no police row in snapshots');
  }

  // ---- 8. anti-cheat / robustness (must not crash or corrupt state) ----
  // respawn B and put it next to A so we can attack it
  B.send({ t: 'respawn' });
  await sleep(300);
  // (a) prototype-pollution weapon key must be rejected, not NaN a victim's HP
  const bHpBefore = 100;
  const oo = [A.pos[0], A.pos[1] + 1.6, A.pos[2]];
  const tt = [B.pos[0], B.pos[1] + 0.9, B.pos[2]];
  A.send({ t: 'shoot', weapon: '__proto__', origin: oo, dir: [0, 0, 1], hitKind: 'player', hitId: B.id, hitPos: tt });
  A.send({ t: 'shoot', weapon: 'constructor', origin: oo, dir: [0, 0, 1], hitKind: 'player', hitId: B.id, hitPos: tt });
  await sleep(400);
  ok(B.hp === bHpBefore, `prototype-pollution weapon key ignored (B hp still ${B.hp})`);

  // (b) malformed drive state (length-2 pos, string coords) must not poison a vehicle
  const cleanVeh = A.welcome.vehicles.find((v) => v.id !== nearest.id && v.id !== bCar.id);
  A.send({ t: 'enterVehicle', vehId: cleanVeh.id });
  // A is on foot far away so this will likely be denied — that's fine, we just
  // ensure the server survives garbage. Fire garbage regardless of ownership:
  A.send({ t: 'state', seq: 0, mode: 'drive', pos: [A.pos[0], 0, A.pos[2]], yaw: 0, anim: 'idle', veh: { id: cleanVeh.id, pos: [1, 2], yaw: 0, speed: 0 } });
  A.send({ t: 'state', seq: 0, mode: 'drive', pos: [A.pos[0], 0, A.pos[2]], yaw: 0, anim: 'idle', veh: { id: cleanVeh.id, pos: ['x', 'y', 'z'], yaw: 'nope', speed: 'fast' } });
  await sleep(400);
  const vrow = B.latestRow('vehicles', cleanVeh.id);
  const vehFinite = !vrow || (isFinite(vrow[1]) && isFinite(vrow[2]) && isFinite(vrow[3]));
  ok(vehFinite, 'malformed drive state did not corrupt the vehicle to NaN');

  // (c) server still alive and ticking after all that garbage
  const stillTicking = await A.waitFor((m) => m.t === 'snapshot', 2000, 'server still broadcasting snapshots');
  ok(!!stillTicking, 'server survived hostile input and keeps ticking');

  log('all gameplay checks done');
}

main()
  .catch((err) => fail(err.stack || String(err)))
  .finally(() => {
    if (server) server.kill('SIGKILL');
    console.log(failed ? '[bot] ❌ FAILED' : '[bot] ✅ PASSED');
    process.exit(failed ? 1 : 0);
  });
