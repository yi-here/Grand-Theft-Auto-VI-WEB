// Server-authoritative combat. The client claims a hit; nothing counts
// until it survives the checks here (cooldown, origin proximity, range,
// aim cone, line-of-sight vs buildings).

import {
  PLAYER_EYE, WANTED_PED_KILL, WANTED_PLAYER_KILL, WEAPONS,
  ShootMsg, WeaponKind, dist2D, dist3D,
} from '@vice/shared';
import type { GameRoom } from './game.js';
import type { SPlayer } from './types.js';

export function handleShoot(room: GameRoom, player: SPlayer, msg: ShootMsg): void {
  if (player.dead || player.mode !== 'foot') return;
  const spec = WEAPONS[msg.weapon];
  if (!spec) return;
  const now = Date.now();
  const last = player.lastShotAt[msg.weapon] ?? 0;
  if (now - last < spec.cooldownMs * 0.8) return;
  player.lastShotAt[msg.weapon] = now;

  if (!validVec(msg.origin) || !validVec(msg.hitPos) || !validVec(msg.dir)) return;
  const eye: [number, number, number] = [player.pos[0], player.pos[1] + PLAYER_EYE, player.pos[2]];
  if (dist3D(msg.origin, eye) > 3.5) return;

  if (msg.hitKind === 'none' || msg.hitKind === 'world') return; // audio/fx only, nothing to apply

  const hitDist = dist3D(msg.origin, msg.hitPos);
  if (hitDist > spec.range * 1.2) return;

  if (msg.hitKind === 'player') {
    const target = msg.hitId ? room.players.get(msg.hitId) : undefined;
    if (!target || !target.joined || target.dead || target === player) return;

    if (msg.weapon === 'fist') {
      if (dist2D(player.pos[0], player.pos[2], target.pos[0], target.pos[2]) > spec.range + 0.8) return;
    } else {
      // claimed hit point must be near the target we know about
      const center: [number, number, number] = [target.pos[0], target.pos[1] + 0.9, target.pos[2]];
      if (dist3D(msg.hitPos, center) > 3.0) return;
      if (!aimConeOk(msg.origin, msg.dir, center, hitDist)) return;
      if (blockedByBuilding(room, msg.origin, msg.hitPos, hitDist)) return;
    }
    if (target.spawnProtUntil > now) return;
    applyDamage(room, target, spec.damage, player.id, msg.weapon, msg.hitPos);
    return;
  }

  if (msg.hitKind === 'npc') {
    const npc = msg.hitId ? room.npcs.get(msg.hitId) : undefined;
    if (!npc || npc.ptype !== 'ped' || npc.state === 'dead') return;
    if (dist2D(msg.hitPos[0], msg.hitPos[2], npc.x, npc.z) > 2.5) return;
    if (msg.weapon !== 'fist' && blockedByBuilding(room, msg.origin, msg.hitPos, hitDist)) return;
    npc.state = 'dead';
    npc.respawnAt = now + 7000;
    addHeat(room, player, WANTED_PED_KILL, now);
    room.broadcast({
      t: 'hit', targetId: npc.id, targetKind: 'npc', attackerId: player.id,
      weapon: msg.weapon, dmg: spec.damage, hp: 0, hitPos: msg.hitPos,
    });
  }
}

export function applyDamage(
  room: GameRoom,
  target: SPlayer,
  dmg: number,
  attackerId: string | null,
  weapon: WeaponKind | null,
  hitPos: [number, number, number],
): void {
  if (target.dead) return;
  target.hp = Math.max(0, target.hp - dmg);
  room.broadcast({
    t: 'hit', targetId: target.id, targetKind: 'player',
    attackerId: attackerId ?? '', weapon: weapon ?? 'fist',
    dmg, hp: target.hp, hitPos,
  });
  if (target.hp <= 0) killPlayer(room, target, attackerId, weapon);
}

export function killPlayer(
  room: GameRoom,
  victim: SPlayer,
  killerId: string | null,
  weapon: WeaponKind | null,
): void {
  const now = Date.now();
  victim.dead = true;
  victim.diedAt = now;
  victim.hp = 0;
  victim.deaths++;
  victim.anim = 'dead';
  victim.heat = 0;
  victim.wantedLevel = 0;
  if (victim.vehId) {
    const veh = room.vehicles.get(victim.vehId);
    if (veh && veh.driverId === victim.id) {
      veh.driverId = null;
      room.broadcast({ t: 'vehicleUpdate', vehId: veh.id, driverId: null });
    }
    victim.vehId = null;
    victim.mode = 'foot';
  }
  const killer = killerId ? room.players.get(killerId) : undefined;
  if (killer && killer !== victim) {
    killer.kills++;
    addHeat(room, killer, WANTED_PLAYER_KILL, now);
  }
  room.broadcast({ t: 'death', victimId: victim.id, killerId, weapon });
}

export function addHeat(room: GameRoom, player: SPlayer, amount: number, now: number): void {
  player.heat = Math.min(120, player.heat + amount);
  player.lastHeatAt = now;
}

/** spawn point farthest from living enemies (or random when alone) */
export function pickSpawn(room: GameRoom, forPlayer: SPlayer | null): [number, number] {
  const spawns = room.city.playerSpawns;
  const enemies = [...room.players.values()].filter(
    (p) => p.joined && !p.dead && p !== forPlayer,
  );
  if (enemies.length === 0) return room.rng.pick(spawns);
  let best = spawns[0];
  let bestScore = -1;
  for (const s of spawns) {
    let minD = Infinity;
    for (const e of enemies) minD = Math.min(minD, dist2D(s[0], s[1], e.pos[0], e.pos[2]));
    if (minD > bestScore) {
      bestScore = minD;
      best = s;
    }
  }
  return best;
}

function validVec(v: unknown): v is [number, number, number] {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && isFinite(n));
}

function aimConeOk(
  origin: [number, number, number],
  dir: [number, number, number],
  targetCenter: [number, number, number],
  dist: number,
): boolean {
  const tx = targetCenter[0] - origin[0];
  const ty = targetCenter[1] - origin[1];
  const tz = targetCenter[2] - origin[2];
  const tLen = Math.sqrt(tx * tx + ty * ty + tz * tz);
  const dLen = Math.sqrt(dir[0] ** 2 + dir[1] ** 2 + dir[2] ** 2);
  if (tLen < 0.5) return true; // point blank
  const dot = (tx * dir[0] + ty * dir[1] + tz * dir[2]) / (tLen * dLen);
  const tolerance = Math.atan2(2.2, dist) + 0.12;
  return Math.acos(Math.min(1, Math.max(-1, dot))) <= tolerance;
}

function blockedByBuilding(
  room: GameRoom,
  origin: [number, number, number],
  hitPos: [number, number, number],
  dist: number,
): boolean {
  const dx = hitPos[0] - origin[0];
  const dy = hitPos[1] - origin[1];
  const dz = hitPos[2] - origin[2];
  const hit = room.buildingGrid.raycast(origin[0], origin[1], origin[2], dx, dy, dz, dist);
  return hit !== null && hit < dist - 0.6;
}
