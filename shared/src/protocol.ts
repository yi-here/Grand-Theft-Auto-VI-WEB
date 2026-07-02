// The full wire contract. JSON messages tagged with `t`. Positions are
// quantized before sending (see quantize in math.ts). Snapshots use compact
// tuple rows and only include entities whose state changed since the last
// broadcast, backed by a full keyframe once per second.

import { VehicleKind, WeaponKind } from './constants.js';

export type PlayerAnim = 'idle' | 'walk' | 'run' | 'jump' | 'aim' | 'dead';
export type PlayerMode = 'foot' | 'drive';
export type NpcState = 'walk' | 'idle' | 'dead' | 'drive';

// ---------- client -> server ----------

export interface JoinMsg { t: 'join'; name: string }

export interface StateMsg {
  t: 'state';
  seq: number;
  mode: PlayerMode;
  pos: [number, number, number];
  yaw: number;
  anim: PlayerAnim;
  /** present only while driving: the driver simulates the vehicle */
  veh?: { id: string; pos: [number, number, number]; yaw: number; speed: number };
}

export interface ShootMsg {
  t: 'shoot';
  weapon: WeaponKind;
  origin: [number, number, number];
  dir: [number, number, number];
  hitKind: 'player' | 'npc' | 'none' | 'world';
  hitId?: string;
  hitPos: [number, number, number];
}

export interface EnterVehicleMsg { t: 'enterVehicle'; vehId: string }
export interface ExitVehicleMsg { t: 'exitVehicle' }
export interface ChatMsg { t: 'chat'; text: string }
export interface RespawnMsg { t: 'respawn' }
export interface PingMsg { t: 'ping'; ts: number; rtt?: number }

export type ClientMsg =
  | JoinMsg | StateMsg | ShootMsg | EnterVehicleMsg | ExitVehicleMsg
  | ChatMsg | RespawnMsg | PingMsg;

// ---------- server -> client ----------

export interface PlayerInfo {
  id: string;
  name: string;
  pos: [number, number, number];
  yaw: number;
  mode: PlayerMode;
  anim: PlayerAnim;
  hp: number;
  vehId: string | null;
  kills: number;
  deaths: number;
}

export interface VehicleInfo {
  id: string;
  kind: VehicleKind;
  pos: [number, number, number];
  yaw: number;
  color: number;
  driverId: string | null;
}

export interface NpcInfo {
  id: string;
  ptype: 'ped' | 'car';
  /** vehicle kind for cars; visual variant index for peds */
  kind: VehicleKind | number;
  color: number;
  pos: [number, number, number];
  yaw: number;
  state: NpcState;
}

export interface WelcomeMsg {
  t: 'welcome';
  id: string;
  name: string;
  seed: number;
  cityHash: number;
  serverTime: number;
  spawn: [number, number, number];
  players: PlayerInfo[];
  vehicles: VehicleInfo[];
  npcs: NpcInfo[];
}

/** [id, x, y, z, yaw, anim, vehId|''] — vehId non-empty means seated */
export type PlayerRow = [string, number, number, number, number, PlayerAnim, string];
/** [id, x, y, z, yaw, speed, driverId|''] */
export type VehicleRow = [string, number, number, number, number, number, string];
/** [id, x, z, yaw, state] */
export type NpcRow = [string, number, number, number, NpcState];

export interface SnapshotMsg {
  t: 'snapshot';
  tick: number;
  time: number;
  keyframe: boolean;
  players: PlayerRow[];
  vehicles: VehicleRow[];
  npcs: NpcRow[];
}

export interface PlayerJoinedMsg { t: 'playerJoined'; player: PlayerInfo }
export interface PlayerLeftMsg { t: 'playerLeft'; id: string }

export interface HitMsg {
  t: 'hit';
  targetId: string;
  targetKind: 'player' | 'npc';
  attackerId: string;
  weapon: WeaponKind;
  dmg: number;
  hp: number;
  hitPos: [number, number, number];
}

export interface DeathMsg { t: 'death'; victimId: string; killerId: string | null; weapon: WeaponKind | null }
export interface RespawnedMsg { t: 'respawned'; id: string; pos: [number, number, number]; hp: number }
export interface VehicleUpdateMsg { t: 'vehicleUpdate'; vehId: string; driverId: string | null; exitPos?: [number, number, number] }
export interface EnterDeniedMsg { t: 'enterDenied'; vehId: string; reason: 'occupied' | 'far' | 'dead' }
export interface ChatBroadcastMsg { t: 'chat'; from: string; name: string; text: string; system?: boolean }
export interface ScoreMsg { t: 'score'; entries: { id: string; name: string; kills: number; deaths: number; ping: number }[] }
export interface NpcSpawnMsg { t: 'npcSpawn'; npc: NpcInfo }
export interface NpcRemoveMsg { t: 'npcRemove'; id: string }
export interface PongMsg { t: 'pong'; ts: number; serverTime: number }
export interface WantedMsg { t: 'wanted'; level: number }
export interface ErrorMsg { t: 'error'; message: string }

export type ServerMsg =
  | WelcomeMsg | SnapshotMsg | PlayerJoinedMsg | PlayerLeftMsg
  | HitMsg | DeathMsg | RespawnedMsg | VehicleUpdateMsg | EnterDeniedMsg
  | ChatBroadcastMsg | ScoreMsg | PongMsg | WantedMsg | ErrorMsg
  | NpcSpawnMsg | NpcRemoveMsg;
