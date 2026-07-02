import type { WebSocket } from 'ws';
import type {
  NpcState, PlayerAnim, PlayerMode, VehicleKind, WeaponKind,
} from '@vice/shared';

export interface SPlayer {
  id: string;
  name: string;
  ws: WebSocket;
  joined: boolean;
  pos: [number, number, number];
  yaw: number;
  anim: PlayerAnim;
  mode: PlayerMode;
  vehId: string | null;
  hp: number;
  kills: number;
  deaths: number;
  dead: boolean;
  diedAt: number;
  ping: number;
  lastStateAt: number;
  lastShotAt: Partial<Record<WeaponKind, number>>;
  lastChatAt: number;
  spawnProtUntil: number;
  heat: number;
  wantedLevel: number;
  lastHeatAt: number;
  prevRow: string;
}

export interface SVehicle {
  id: string;
  kind: VehicleKind;
  pos: [number, number, number];
  yaw: number;
  speed: number;
  color: number;
  driverId: string | null;
  prevRow: string;
}

export interface SNpc {
  id: string;
  ptype: 'ped' | 'car';
  kind: VehicleKind | number;
  color: number;
  x: number;
  z: number;
  yaw: number;
  state: NpcState;
  speed: number;
  // ped fields
  loop: [number, number][];
  waypoint: number;
  idleUntil: number;
  respawnAt: number;
  // traffic fields
  edgeIdx: number;
  edgeT: number;
  // police fields
  targetId: string | null;
  lastHitAt: number;
  prevRow: string;
}
