// Authoritative game room. Runs a fixed 20Hz loop; owns combat, health,
// scoring, vehicle occupancy, chat and NPC simulation. Movement is
// client-reported but clamped here — the clamped value is what everyone
// else sees, so a misbehaving client only rubber-bands itself.

import type { WebSocket } from 'ws';
import {
  CityData, ClientMsg, NpcInfo, PlayerInfo, PlayerRow, Rng, ServerMsg,
  SnapshotMsg, SpatialGrid, VehicleInfo, VehicleRow, NpcRow,
  WORLD_SEED, TICK_MS, SNAPSHOT_KEYFRAME_EVERY, SPRINT_SPEED, SPEED_TOLERANCE,
  MAX_TELEPORT, PLAYER_MAX_HP, RESPAWN_DELAY_MS, SPAWN_PROTECT_MS, VEHICLES,
  VEHICLE_ENTER_DIST, VEHICLE_EXIT_MAX_SPEED, ABANDON_FRICTION, WORLD_BOUNDS,
  buildingBoxes, cityHash, generateCity, buildRoadGraph, RoadGraph,
  clamp, dist2D, groundHeight, quantize,
} from '@vice/shared';
import type { SPlayer, SVehicle, SNpc } from './types.js';
import { handleShoot, killPlayer, pickSpawn } from './combat.js';
import { spawnNpcs, updateNpcs, updateWanted } from './npcs.js';

export class GameRoom {
  city: CityData;
  hash: number;
  graph: RoadGraph;
  buildingGrid: SpatialGrid;
  players = new Map<string, SPlayer>();
  vehicles = new Map<string, SVehicle>();
  npcs = new Map<string, SNpc>();
  rng = new Rng((WORLD_SEED ^ 0xabad1dea) >>> 0);
  tickNo = 0;
  private nextId = 1;
  private timer: ReturnType<typeof setInterval>;

  constructor() {
    this.city = generateCity(WORLD_SEED);
    this.hash = cityHash(this.city);
    this.graph = buildRoadGraph();
    this.buildingGrid = new SpatialGrid(buildingBoxes(this.city));
    this.city.vehicleSpawns.forEach((s, i) => {
      const id = 'v' + i;
      this.vehicles.set(id, {
        id, kind: s.kind, pos: [s.x, 0, s.z], yaw: s.yaw, speed: 0,
        color: s.color, driverId: null, prevRow: '',
      });
    });
    spawnNpcs(this);
    this.timer = setInterval(() => this.tick(), TICK_MS);
    console.log(`[game] city ready — hash ${this.hash}, ${this.city.buildings.length} buildings, ${this.vehicles.size} vehicles, ${this.npcs.size} npcs`);
  }

  // ---------------- connections ----------------

  addConnection(ws: WebSocket): void {
    const id = 'p' + this.nextId++;
    const player: SPlayer = {
      id, name: '', ws, joined: false,
      pos: [0, 0, 0], yaw: 0, anim: 'idle', mode: 'foot', vehId: null,
      hp: PLAYER_MAX_HP, kills: 0, deaths: 0, dead: false, diedAt: 0,
      ping: 0, lastStateAt: 0, lastShotAt: {}, lastChatAt: 0,
      spawnProtUntil: 0, heat: 0, wantedLevel: 0, lastHeatAt: 0, prevRow: '',
    };
    this.players.set(id, player);
    ws.on('message', (raw) => {
      let msg: ClientMsg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      try {
        this.handleMessage(player, msg);
      } catch (err) {
        console.error('[game] message error', err);
      }
    });
    ws.on('close', () => this.removePlayer(player));
    ws.on('error', () => this.removePlayer(player));
  }

  removePlayer(player: SPlayer): void {
    if (!this.players.has(player.id)) return;
    this.players.delete(player.id);
    if (player.vehId) {
      const veh = this.vehicles.get(player.vehId);
      if (veh && veh.driverId === player.id) {
        veh.driverId = null;
        this.broadcast({ t: 'vehicleUpdate', vehId: veh.id, driverId: null });
      }
    }
    if (player.joined) {
      this.broadcast({ t: 'playerLeft', id: player.id });
      this.systemChat(`${player.name} left`);
    }
  }

  send(player: SPlayer, msg: ServerMsg): void {
    if (player.ws.readyState === 1) player.ws.send(JSON.stringify(msg));
  }

  broadcast(msg: ServerMsg): void {
    const data = JSON.stringify(msg);
    for (const p of this.players.values()) {
      if (p.joined && p.ws.readyState === 1) p.ws.send(data);
    }
  }

  systemChat(text: string): void {
    this.broadcast({ t: 'chat', from: '', name: '', text, system: true });
  }

  // ---------------- message handling ----------------

  private handleMessage(player: SPlayer, msg: ClientMsg): void {
    if (!player.joined) {
      if (msg.t === 'join') this.handleJoin(player, msg.name);
      return;
    }
    switch (msg.t) {
      case 'state': this.handleState(player, msg); break;
      case 'shoot': handleShoot(this, player, msg); break;
      case 'enterVehicle': this.handleEnter(player, msg.vehId); break;
      case 'exitVehicle': this.handleExit(player); break;
      case 'chat': this.handleChat(player, msg.text); break;
      case 'respawn': this.handleRespawn(player); break;
      case 'ping':
        if (typeof msg.rtt === 'number') player.ping = clamp(Math.round(msg.rtt), 0, 999);
        this.send(player, { t: 'pong', ts: msg.ts, serverTime: Date.now() });
        break;
    }
  }

  private handleJoin(player: SPlayer, rawName: unknown): void {
    let name = String(rawName ?? '').replace(/[<>&"']/g, '').trim().slice(0, 16);
    if (!name) name = 'Player' + player.id.slice(1);
    player.name = name;
    player.joined = true;
    const spawn = pickSpawn(this, null);
    player.pos = [spawn[0], 0, spawn[1]];
    player.spawnProtUntil = Date.now() + SPAWN_PROTECT_MS;

    this.send(player, {
      t: 'welcome',
      id: player.id,
      name,
      seed: WORLD_SEED,
      cityHash: this.hash,
      serverTime: Date.now(),
      spawn: [player.pos[0], player.pos[1], player.pos[2]],
      players: [...this.players.values()].filter((p) => p.joined && p !== player).map(playerInfo),
      vehicles: [...this.vehicles.values()].map(vehicleInfo),
      npcs: [...this.npcs.values()].map(npcInfo),
    });
    this.broadcast({ t: 'playerJoined', player: playerInfo(player) });
    this.systemChat(`${name} joined`);
    console.log(`[game] ${player.id} "${name}" joined (${this.playerCount()} online)`);
  }

  playerCount(): number {
    let n = 0;
    for (const p of this.players.values()) if (p.joined) n++;
    return n;
  }

  private handleState(player: SPlayer, msg: import('@vice/shared').StateMsg): void {
    if (player.dead) return;
    const now = Date.now();
    const dt = clamp((now - (player.lastStateAt || now)) / 1000, 0.02, 0.5);
    player.lastStateAt = now;
    if (!Array.isArray(msg.pos) || msg.pos.some((v) => typeof v !== 'number' || !isFinite(v))) return;

    if (msg.mode === 'drive' && msg.veh && player.vehId === msg.veh.id) {
      const veh = this.vehicles.get(msg.veh.id);
      if (!veh || veh.driverId !== player.id) return;
      const spec = VEHICLES[veh.kind];
      const maxDist = Math.max(spec.topSpeed * SPEED_TOLERANCE * dt, 1) + 0.3;
      const p = msg.veh.pos;
      if (p.every((v: number) => isFinite(v))) {
        veh.pos = clampMove(veh.pos, [p[0], groundHeight(p[0], p[2]), p[2]], maxDist);
        veh.yaw = sanitizeAngle(msg.veh.yaw, veh.yaw);
        veh.speed = clamp(msg.veh.speed || 0, -spec.topSpeed, spec.topSpeed);
      }
      player.pos = [veh.pos[0], veh.pos[1], veh.pos[2]];
      player.yaw = veh.yaw;
      player.anim = 'idle';
      player.mode = 'drive';
    } else if (msg.mode === 'foot' && player.mode === 'foot') {
      // horizontal-only clamp: vertical is already bounded to the ground band
      const maxDist = SPRINT_SPEED * SPEED_TOLERANCE * dt + 0.15;
      const ground = groundHeight(msg.pos[0], msg.pos[2]);
      const target: [number, number, number] = [
        clamp(msg.pos[0], WORLD_BOUNDS.minX, WORLD_BOUNDS.maxX),
        clamp(msg.pos[1], ground - 0.5, ground + 12),
        clamp(msg.pos[2], WORLD_BOUNDS.minZ, WORLD_BOUNDS.maxZ),
      ];
      player.pos = clampMoveHorizontal(player.pos, target, maxDist);
      player.yaw = sanitizeAngle(msg.yaw, player.yaw);
      player.anim = typeof msg.anim === 'string' ? msg.anim : 'idle';
    }
  }

  private handleEnter(player: SPlayer, vehId: string): void {
    if (player.dead || player.mode !== 'foot') return;
    const veh = this.vehicles.get(vehId);
    if (!veh) return;
    if (veh.driverId) {
      this.send(player, { t: 'enterDenied', vehId, reason: 'occupied' });
      return;
    }
    if (dist2D(player.pos[0], player.pos[2], veh.pos[0], veh.pos[2]) > VEHICLE_ENTER_DIST + 2) {
      this.send(player, { t: 'enterDenied', vehId, reason: 'far' });
      return;
    }
    veh.driverId = player.id;
    player.vehId = vehId;
    player.mode = 'drive';
    this.broadcast({ t: 'vehicleUpdate', vehId, driverId: player.id });
  }

  private handleExit(player: SPlayer): void {
    if (!player.vehId) return;
    const veh = this.vehicles.get(player.vehId);
    if (!veh || veh.driverId !== player.id) {
      player.vehId = null;
      player.mode = 'foot';
      return;
    }
    if (Math.abs(veh.speed) > VEHICLE_EXIT_MAX_SPEED * 1.3) return;
    const exit = this.findExitSpot(veh);
    veh.driverId = null;
    player.vehId = null;
    player.mode = 'foot';
    player.pos = [exit[0], groundHeight(exit[0], exit[2]), exit[2]];
    this.broadcast({
      t: 'vehicleUpdate', vehId: veh.id, driverId: null,
      exitPos: [quantize(player.pos[0]), quantize(player.pos[1]), quantize(player.pos[2])],
    });
  }

  /** door position that doesn't intersect a building; falls back to roof-ish */
  private findExitSpot(veh: SVehicle): [number, number, number] {
    const spec = VEHICLES[veh.kind];
    const sin = Math.sin(veh.yaw);
    const cos = Math.cos(veh.yaw);
    const candidates: [number, number][] = [
      [spec.width / 2 + 0.8, 0], // right door
      [-spec.width / 2 - 0.8, 0], // left door
      [0, -spec.length / 2 - 1.0], // behind
    ];
    for (const [lx, lz] of candidates) {
      // local -> world (forward = +Z rotated by yaw)
      const wx = veh.pos[0] + lx * cos + lz * sin;
      const wz = veh.pos[2] - lx * sin + lz * cos;
      const resolved = this.buildingGrid.resolveCircle(wx, wz, 0.4, 2);
      if (Math.abs(resolved.x - wx) < 0.01 && Math.abs(resolved.z - wz) < 0.01) {
        return [wx, 0, wz];
      }
    }
    return [veh.pos[0], 0, veh.pos[2]];
  }

  private handleChat(player: SPlayer, rawText: unknown): void {
    const now = Date.now();
    if (now - player.lastChatAt < 900) return;
    const text = String(rawText ?? '').replace(/[<>]/g, '').trim().slice(0, 200);
    if (!text) return;
    player.lastChatAt = now;
    this.broadcast({ t: 'chat', from: player.id, name: player.name, text });
  }

  private handleRespawn(player: SPlayer): void {
    const now = Date.now();
    if (!player.dead || now - player.diedAt < RESPAWN_DELAY_MS - 700) return;
    const spawn = pickSpawn(this, player);
    player.pos = [spawn[0], 0, spawn[1]];
    player.hp = PLAYER_MAX_HP;
    player.dead = false;
    player.mode = 'foot';
    player.vehId = null;
    player.anim = 'idle';
    player.spawnProtUntil = now + SPAWN_PROTECT_MS;
    this.broadcast({
      t: 'respawned', id: player.id,
      pos: [quantize(player.pos[0]), quantize(player.pos[1]), quantize(player.pos[2])],
      hp: player.hp,
    });
  }

  // ---------------- tick ----------------

  private tick(): void {
    this.tickNo++;
    const now = Date.now();
    const dt = TICK_MS / 1000;

    updateNpcs(this, dt, now);
    updateWanted(this, now);
    this.updateAbandonedVehicles(dt);

    const keyframe = this.tickNo % SNAPSHOT_KEYFRAME_EVERY === 0;
    const snap: SnapshotMsg = {
      t: 'snapshot', tick: this.tickNo, time: now, keyframe,
      players: [], vehicles: [], npcs: [],
    };

    for (const p of this.players.values()) {
      if (!p.joined) continue;
      const row: PlayerRow = [
        p.id, quantize(p.pos[0]), quantize(p.pos[1]), quantize(p.pos[2]),
        quantize(p.yaw, 3), p.dead ? 'dead' : p.anim, p.vehId ?? '',
      ];
      const key = row.join(',');
      if (keyframe || key !== p.prevRow) {
        snap.players.push(row);
        p.prevRow = key;
      }
    }
    for (const v of this.vehicles.values()) {
      const row: VehicleRow = [
        v.id, quantize(v.pos[0]), quantize(v.pos[1]), quantize(v.pos[2]),
        quantize(v.yaw, 3), quantize(v.speed, 1), v.driverId ?? '',
      ];
      const key = row.join(',');
      if (keyframe || key !== v.prevRow) {
        snap.vehicles.push(row);
        v.prevRow = key;
      }
    }
    for (const n of this.npcs.values()) {
      const row: NpcRow = [n.id, quantize(n.x), quantize(n.z), quantize(n.yaw, 2), n.state];
      const key = row.join(',');
      if (keyframe || key !== n.prevRow) {
        snap.npcs.push(row);
        n.prevRow = key;
      }
    }
    if (snap.players.length || snap.vehicles.length || snap.npcs.length || keyframe) {
      this.broadcast(snap);
    }

    if (this.tickNo % SNAPSHOT_KEYFRAME_EVERY === 0) {
      const entries = [...this.players.values()].filter((p) => p.joined).map((p) => ({
        id: p.id, name: p.name, kills: p.kills, deaths: p.deaths, ping: p.ping,
      }));
      if (entries.length) this.broadcast({ t: 'score', entries });
    }
  }

  private updateAbandonedVehicles(dt: number): void {
    for (const v of this.vehicles.values()) {
      if (v.driverId || Math.abs(v.speed) < 0.05) {
        if (!v.driverId) v.speed = 0;
        continue;
      }
      const dir = Math.sign(v.speed);
      v.speed -= dir * ABANDON_FRICTION * dt;
      if (Math.sign(v.speed) !== dir) v.speed = 0;
      const nx = v.pos[0] + Math.sin(v.yaw) * v.speed * dt;
      const nz = v.pos[2] + Math.cos(v.yaw) * v.speed * dt;
      const resolved = this.buildingGrid.resolveCircle(nx, nz, 1.0, 2);
      if (Math.abs(resolved.x - nx) > 0.01 || Math.abs(resolved.z - nz) > 0.01) v.speed = 0;
      v.pos = [resolved.x, groundHeight(resolved.x, resolved.z), resolved.z];
    }
  }

  stop(): void {
    clearInterval(this.timer);
  }
}

// ---------------- helpers ----------------

function clampMove(
  from: [number, number, number],
  to: [number, number, number],
  maxDist: number,
): [number, number, number] {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (d <= maxDist || d < 1e-6) return to;
  const s = maxDist / d;
  return [from[0] + dx * s, from[1] + dy * s, from[2] + dz * s];
}

/** clamp XZ displacement only; Y passes through (bounded by the caller) */
function clampMoveHorizontal(
  from: [number, number, number],
  to: [number, number, number],
  maxDist: number,
): [number, number, number] {
  const dx = to[0] - from[0];
  const dz = to[2] - from[2];
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d <= maxDist || d < 1e-6) return to;
  const s = maxDist / d;
  return [from[0] + dx * s, to[1], from[2] + dz * s];
}

function sanitizeAngle(v: unknown, fallback: number): number {
  return typeof v === 'number' && isFinite(v) ? v : fallback;
}

export function playerInfo(p: SPlayer): PlayerInfo {
  return {
    id: p.id, name: p.name,
    pos: [quantize(p.pos[0]), quantize(p.pos[1]), quantize(p.pos[2])],
    yaw: quantize(p.yaw, 3), mode: p.mode, anim: p.dead ? 'dead' : p.anim,
    hp: p.hp, vehId: p.vehId, kills: p.kills, deaths: p.deaths,
  };
}

export function vehicleInfo(v: SVehicle): VehicleInfo {
  return {
    id: v.id, kind: v.kind,
    pos: [quantize(v.pos[0]), quantize(v.pos[1]), quantize(v.pos[2])],
    yaw: quantize(v.yaw, 3), color: v.color, driverId: v.driverId,
  };
}

export function npcInfo(n: SNpc): NpcInfo {
  return {
    id: n.id, ptype: n.ptype, kind: n.kind, color: n.color,
    pos: [quantize(n.x), 0, quantize(n.z)], yaw: quantize(n.yaw, 2), state: n.state,
  };
}
