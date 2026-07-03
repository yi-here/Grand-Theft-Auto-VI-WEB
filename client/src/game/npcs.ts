// NPC rendering: pedestrians (avatar pool) and traffic/police cars
// (vehicle meshes), interpolated from snapshots like players.

import * as THREE from 'three';
import { NpcInfo, VehicleKind, type NpcState } from '@vice/shared';
import { InterpBuffer } from '../net/interpolation.js';
import { Avatar, animateAvatar, buildAvatar } from './avatar.js';
import { buildVehicleMesh } from './vehicles.js';

const HIDE_DIST = 170;

class ClientNpc {
  group: THREE.Group;
  avatar: Avatar | null = null;
  wheels: THREE.Mesh[] = [];
  lightbar: THREE.Mesh[] = [];
  buffer = new InterpBuffer();
  state: NpcState;
  lastX = 0;
  lastZ = 0;
  speedEst = 0;

  constructor(public info: NpcInfo) {
    this.state = info.state;
    if (info.ptype === 'ped') {
      this.avatar = buildAvatar(info.color, typeof info.kind === 'number' ? info.kind : 0);
      this.group = new THREE.Group();
      this.group.add(this.avatar.group);
    } else {
      const built = buildVehicleMesh(info.kind as VehicleKind, info.color);
      this.group = built.group;
      this.wheels = built.wheels;
      this.lightbar = built.lightbar;
    }
    this.group.position.set(info.pos[0], info.pos[1], info.pos[2]);
    this.group.rotation.y = info.yaw;
    this.lastX = info.pos[0];
    this.lastZ = info.pos[2];
  }
}

export class NpcManager {
  npcs = new Map<string, ClientNpc>();

  constructor(private scene: THREE.Scene) {}

  add(info: NpcInfo): void {
    if (this.npcs.has(info.id)) return;
    const npc = new ClientNpc(info);
    this.npcs.set(info.id, npc);
    this.scene.add(npc.group);
  }

  remove(id: string): void {
    const npc = this.npcs.get(id);
    if (npc) {
      this.scene.remove(npc.group);
      this.npcs.delete(id);
    }
  }

  get(id: string): ClientNpc | undefined {
    return this.npcs.get(id);
  }

  onSnapshotRow(id: string, time: number, x: number, z: number, yaw: number, state: NpcState): void {
    const npc = this.npcs.get(id);
    if (!npc) return;
    npc.state = state;
    npc.buffer.push(time, { x, y: 0, z, yaw, extra: { state } });
  }

  update(dt: number, renderTime: number, camPos: THREE.Vector3): void {
    for (const npc of this.npcs.values()) {
      const s = npc.buffer.sample(renderTime);
      if (s) {
        npc.speedEst = npc.speedEst * 0.8 + (Math.hypot(s.x - npc.lastX, s.z - npc.lastZ) / Math.max(dt, 1e-3)) * 0.2;
        npc.lastX = s.x;
        npc.lastZ = s.z;
        npc.group.position.set(s.x, 0, s.z);
        if (npc.state !== 'dead') npc.group.rotation.y = s.yaw;
      }

      // distance culling gates RENDERING only; the pose still updates so a
      // ped that died/respawned off-screen is in the right pose on approach
      const d2 = (npc.group.position.x - camPos.x) ** 2 + (npc.group.position.z - camPos.z) ** 2;
      npc.group.visible = d2 < HIDE_DIST * HIDE_DIST;

      if (npc.avatar) {
        const anim = npc.state === 'dead' ? 'dead' : npc.state === 'walk' ? 'walk' : 'idle';
        animateAvatar(npc.avatar, anim, npc.speedEst, dt);
      } else if (npc.group.visible) {
        for (const w of npc.wheels) w.rotation.x += (npc.speedEst / 0.34) * dt;
        if (npc.lightbar.length === 2) {
          const phase = Math.floor(performance.now() / 220) % 2;
          (npc.lightbar[0].material as THREE.MeshLambertMaterial).emissiveIntensity = phase ? 2.8 : 0.1;
          (npc.lightbar[1].material as THREE.MeshLambertMaterial).emissiveIntensity = phase ? 0.1 : 2.8;
        }
      }
    }
  }
}
