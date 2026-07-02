// NPC life, simulated inside the 20Hz tick: pedestrians on sidewalk loops,
// traffic cars on the road graph, and police pursuit for wanted players.

import {
  BUILDING_PALETTES, CITY, NPC_PED_COUNT, NPC_TRAFFIC_COUNT, PED_WALK_SPEED,
  POLICE_ENABLED, RUNOVER_MIN_SPEED, TICK_MS, TRAFFIC_SPEED, VEHICLES,
  VehicleKind, WANTED_DECAY_GRACE_MS, WANTED_DECAY_PER_SEC,
  dist2D, nextEdge, sidewalkLoop, wrapAngle,
} from '@vice/shared';
import type { GameRoom } from './game.js';
import { npcInfo } from './game.js';
import type { SNpc, SPlayer } from './types.js';
import { applyDamage } from './combat.js';

const PED_COLORS = [0xe86ca0, 0x54c6c0, 0xf0d264, 0x9a86e8, 0xf2f2f2, 0x84d179, 0xe8935c, 0x6ea8dc];
let policeSerial = 1;

export function spawnNpcs(room: GameRoom): void {
  for (let k = 0; k < NPC_PED_COUNT; k++) {
    const i = room.rng.int(0, CITY.BLOCKS_X - 1);
    const j = room.rng.int(0, CITY.BLOCKS_Z - 1);
    const loop = sidewalkLoop(i, j);
    const w = room.rng.int(0, 3);
    const npc = makeNpc('n' + k, 'ped', room.rng.int(0, 7), room.rng.pick(PED_COLORS));
    npc.loop = loop;
    npc.waypoint = w;
    npc.x = loop[w][0];
    npc.z = loop[w][1];
    npc.state = 'walk';
    room.npcs.set(npc.id, npc);
  }
  for (let k = 0; k < NPC_TRAFFIC_COUNT; k++) {
    const kind = room.rng.pick(['sedan', 'taxi', 'pickup'] as VehicleKind[]);
    const npc = makeNpc('c' + k, 'car', kind, room.rng.pick(VEHICLES[kind].colors));
    npc.edgeIdx = room.rng.int(0, room.graph.edges.length - 1);
    npc.edgeT = room.rng.next() * 0.8;
    npc.state = 'drive';
    npc.speed = TRAFFIC_SPEED;
    const e = room.graph.edges[npc.edgeIdx];
    npc.x = e.ax + (e.bx - e.ax) * npc.edgeT;
    npc.z = e.az + (e.bz - e.az) * npc.edgeT;
    npc.yaw = Math.atan2(e.bx - e.ax, e.bz - e.az);
    room.npcs.set(npc.id, npc);
  }
}

function makeNpc(id: string, ptype: 'ped' | 'car', kind: VehicleKind | number, color: number): SNpc {
  return {
    id, ptype, kind, color, x: 0, z: 0, yaw: 0, state: 'idle', speed: 0,
    loop: [], waypoint: 0, idleUntil: 0, respawnAt: 0,
    edgeIdx: 0, edgeT: 0, targetId: null, lastHitAt: 0, prevRow: '',
  };
}

export function updateNpcs(room: GameRoom, dt: number, now: number): void {
  for (const npc of room.npcs.values()) {
    if (npc.ptype === 'ped') updatePed(room, npc, dt, now);
    else if (npc.id.startsWith('police')) updatePolice(room, npc, dt, now);
    else updateTraffic(room, npc, dt);
  }
  checkRunovers(room, now);
  if (POLICE_ENABLED) managePolice(room, now);
}

function updatePed(room: GameRoom, npc: SNpc, dt: number, now: number): void {
  if (npc.state === 'dead') {
    if (now >= npc.respawnAt && npc.respawnAt > 0) {
      const i = room.rng.int(0, CITY.BLOCKS_X - 1);
      const j = room.rng.int(0, CITY.BLOCKS_Z - 1);
      npc.loop = sidewalkLoop(i, j);
      npc.waypoint = room.rng.int(0, 3);
      npc.x = npc.loop[npc.waypoint][0];
      npc.z = npc.loop[npc.waypoint][1];
      npc.state = 'walk';
      npc.respawnAt = 0;
    }
    return;
  }
  if (npc.state === 'idle') {
    if (now >= npc.idleUntil) npc.state = 'walk';
    return;
  }
  const target = npc.loop[npc.waypoint];
  const dx = target[0] - npc.x;
  const dz = target[1] - npc.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d < 0.4) {
    npc.waypoint = (npc.waypoint + 1) % npc.loop.length;
    if (room.rng.chance(0.25)) {
      npc.state = 'idle';
      npc.idleUntil = now + room.rng.range(1500, 5000);
    }
    return;
  }
  npc.x += (dx / d) * PED_WALK_SPEED * dt;
  npc.z += (dz / d) * PED_WALK_SPEED * dt;
  npc.yaw = Math.atan2(dx, dz);
}

function updateTraffic(room: GameRoom, npc: SNpc, dt: number): void {
  const edge = room.graph.edges[npc.edgeIdx];
  const dirX = (edge.bx - edge.ax) / edge.len;
  const dirZ = (edge.bz - edge.az) / edge.len;

  // brake for anything ahead in the lane (other traffic, player vehicles)
  let obstructed = false;
  const lookahead = 9;
  const checkAhead = (ox: number, oz: number): void => {
    const rx = ox - npc.x;
    const rz = oz - npc.z;
    const along = rx * dirX + rz * dirZ;
    const across = Math.abs(rx * -dirZ + rz * dirX);
    if (along > 0.5 && along < lookahead && across < 2.2) obstructed = true;
  };
  for (const other of room.npcs.values()) {
    if (other === npc || other.ptype !== 'car') continue;
    checkAhead(other.x, other.z);
  }
  for (const v of room.vehicles.values()) checkAhead(v.pos[0], v.pos[2]);
  for (const p of room.players.values()) {
    if (p.joined && !p.dead && p.mode === 'foot') checkAhead(p.pos[0], p.pos[2]);
  }

  const targetSpeed = obstructed ? 0 : TRAFFIC_SPEED;
  npc.speed += Math.sign(targetSpeed - npc.speed) * Math.min(Math.abs(targetSpeed - npc.speed), 8 * dt);

  npc.edgeT += (npc.speed * dt) / edge.len;
  if (npc.edgeT >= 1) {
    npc.edgeIdx = nextEdge(room.graph, npc.edgeIdx, room.rng);
    npc.edgeT = 0;
    return;
  }
  npc.x = edge.ax + (edge.bx - edge.ax) * npc.edgeT;
  npc.z = edge.az + (edge.bz - edge.az) * npc.edgeT;
  npc.yaw = Math.atan2(dirX, dirZ);
}

function checkRunovers(room: GameRoom, now: number): void {
  for (const v of room.vehicles.values()) {
    if (!v.driverId || Math.abs(v.speed) < RUNOVER_MIN_SPEED) continue;
    const spec = VEHICLES[v.kind];
    const reach = spec.length / 2 + 0.8;
    for (const npc of room.npcs.values()) {
      if (npc.ptype !== 'ped' || npc.state === 'dead') continue;
      if (dist2D(v.pos[0], v.pos[2], npc.x, npc.z) < reach) {
        npc.state = 'dead';
        npc.respawnAt = now + 8000;
        const driver = room.players.get(v.driverId);
        if (driver) {
          driver.heat = Math.min(120, driver.heat + 30);
          driver.lastHeatAt = now;
        }
        room.broadcast({
          t: 'hit', targetId: npc.id, targetKind: 'npc', attackerId: v.driverId,
          weapon: 'fist', dmg: 100, hp: 0, hitPos: [npc.x, 0.5, npc.z],
        });
      }
    }
  }
}

// ---------------- police ----------------

function managePolice(room: GameRoom, now: number): void {
  for (const p of room.players.values()) {
    if (!p.joined) continue;
    const want = p.dead ? 0 : p.wantedLevel;
    const units = [...room.npcs.values()].filter(
      (n) => n.targetId === p.id && n.id.startsWith('police'),
    );
    for (let k = units.length; k < want; k++) spawnPoliceCar(room, p);
    if (want === 0) {
      for (const u of units) {
        room.npcs.delete(u.id);
        room.broadcast({ t: 'npcRemove', id: u.id });
      }
    }
  }
  // orphaned units (target left)
  for (const n of room.npcs.values()) {
    if (!n.id.startsWith('police')) continue;
    const target = n.targetId ? room.players.get(n.targetId) : undefined;
    if (!target || !target.joined || dist2D(n.x, n.z, target.pos[0], target.pos[2]) > 320) {
      room.npcs.delete(n.id);
      room.broadcast({ t: 'npcRemove', id: n.id });
    }
  }
}

function spawnPoliceCar(room: GameRoom, target: SPlayer): void {
  // spawn on a road-graph node 100..200m from the target
  const candidates = room.graph.nodes.filter((n) => {
    const d = dist2D(n.x, n.z, target.pos[0], target.pos[2]);
    return d > 90 && d < 220;
  });
  if (candidates.length === 0) return;
  const node = room.rng.pick(candidates);
  const npc = makeNpc('police' + policeSerial++, 'car', 'police', VEHICLES.police.colors[0]);
  npc.x = node.x;
  npc.z = node.z;
  npc.state = 'drive';
  npc.speed = 0;
  npc.targetId = target.id;
  room.npcs.set(npc.id, npc);
  room.broadcast({ t: 'npcSpawn', npc: npcInfo(npc) });
}

function updatePolice(room: GameRoom, npc: SNpc, dt: number, now: number): void {
  const target = npc.targetId ? room.players.get(npc.targetId) : undefined;
  if (!target || !target.joined || target.dead) return; // managePolice will clean up
  const dx = target.pos[0] - npc.x;
  const dz = target.pos[2] - npc.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  const desired = Math.atan2(dx, dz);
  const turn = 2.4 * dt;
  npc.yaw += Math.max(-turn, Math.min(turn, wrapAngle(desired - npc.yaw)));

  const targetSpeed = dist > 25 ? 27 : dist > 6 ? 18 : 10;
  npc.speed += Math.sign(targetSpeed - npc.speed) * Math.min(Math.abs(targetSpeed - npc.speed), 14 * dt);
  const nx = npc.x + Math.sin(npc.yaw) * npc.speed * dt;
  const nz = npc.z + Math.cos(npc.yaw) * npc.speed * dt;
  const resolved = room.buildingGrid.resolveCircle(nx, nz, 1.1, 2);
  if (Math.abs(resolved.x - nx) > 0.05 || Math.abs(resolved.z - nz) > 0.05) {
    // scrape along the wall and angle away a bit
    npc.speed *= 0.7;
    npc.yaw += room.rng.chance(0.5) ? 0.5 * dt * 8 : -0.5 * dt * 8;
  }
  npc.x = resolved.x;
  npc.z = resolved.z;

  // ram damage
  if (dist < 2.6 && npc.speed > 3 && now - npc.lastHitAt > 800) {
    npc.lastHitAt = now;
    const dmg = target.mode === 'foot' ? 14 : 6;
    applyDamage(room, target, dmg, null, null, [npc.x, 0.6, npc.z]);
  }
}

export function updateWanted(room: GameRoom, now: number): void {
  const dt = TICK_MS / 1000;
  for (const p of room.players.values()) {
    if (!p.joined) continue;
    if (p.heat > 0 && now - p.lastHeatAt > WANTED_DECAY_GRACE_MS) {
      p.heat = Math.max(0, p.heat - WANTED_DECAY_PER_SEC * dt);
    }
    const level = p.heat >= 80 ? 2 : p.heat >= 40 ? 1 : 0;
    if (level !== p.wantedLevel) {
      p.wantedLevel = level;
      room.send(p, { t: 'wanted', level });
    }
  }
}
