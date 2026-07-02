// Remote player avatars: interpolated from snapshots, hidden while they
// drive, name tags overhead, fall-over death pose.

import * as THREE from 'three';
import { PlayerInfo, hashString, type PlayerAnim } from '@vice/shared';
import { InterpBuffer } from '../net/interpolation.js';
import { Avatar, animateAvatar, buildAvatar } from './avatar.js';
import { nameTexture } from '../render/textures.js';

const SHIRTS = [0xe8506e, 0x37b5d6, 0xffd23f, 0x9a6ee8, 0x58c470, 0xf28c48, 0xf2f2f2, 0x4a6ae0];

export class RemotePlayer {
  avatar: Avatar;
  root = new THREE.Group();
  nameSprite: THREE.Sprite;
  buffer = new InterpBuffer();
  vehId: string | null;
  anim: PlayerAnim = 'idle';
  lastPos = new THREE.Vector3();
  speedEst = 0;

  constructor(public info: PlayerInfo) {
    const h = hashString(info.id + info.name);
    this.avatar = buildAvatar(SHIRTS[h % SHIRTS.length], h);
    this.root.add(this.avatar.group);
    const { texture, aspect } = nameTexture(info.name);
    this.nameSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: texture, transparent: true, depthTest: false,
    }));
    this.nameSprite.scale.set(0.45 * aspect, 0.45, 1);
    this.nameSprite.position.y = 2.15;
    this.root.add(this.nameSprite);
    this.root.position.set(info.pos[0], info.pos[1], info.pos[2]);
    this.vehId = info.vehId;
    this.anim = info.anim;
  }
}

export class RemotePlayerManager {
  players = new Map<string, RemotePlayer>();

  constructor(private scene: THREE.Scene) {}

  add(info: PlayerInfo): RemotePlayer {
    const existing = this.players.get(info.id);
    if (existing) return existing;
    const rp = new RemotePlayer(info);
    this.players.set(info.id, rp);
    this.scene.add(rp.root);
    return rp;
  }

  remove(id: string): void {
    const rp = this.players.get(id);
    if (rp) {
      this.scene.remove(rp.root);
      this.players.delete(id);
    }
  }

  get(id: string): RemotePlayer | undefined {
    return this.players.get(id);
  }

  onSnapshotRow(id: string, time: number, x: number, y: number, z: number, yaw: number, anim: PlayerAnim, vehId: string): void {
    const rp = this.players.get(id);
    if (!rp) return;
    rp.vehId = vehId || null;
    rp.buffer.push(time, { x, y, z, yaw, extra: { anim } });
  }

  update(dt: number, renderTime: number): void {
    for (const rp of this.players.values()) {
      const seated = !!rp.vehId;
      rp.root.visible = !seated;
      if (seated) continue;
      const s = rp.buffer.sample(renderTime);
      if (s) {
        const nx = s.x;
        const nz = s.z;
        rp.speedEst = rp.speedEst * 0.8 + (Math.hypot(nx - rp.lastPos.x, nz - rp.lastPos.z) / Math.max(dt, 1e-3)) * 0.2;
        rp.lastPos.set(nx, s.y, nz);
        rp.root.position.set(nx, s.y, nz);
        rp.avatar.group.rotation.y = s.yaw;
        rp.anim = (s.extra.anim as PlayerAnim) ?? 'idle';
      }
      animateAvatar(rp.avatar, rp.anim, rp.speedEst, dt);
      rp.nameSprite.visible = rp.anim !== 'dead';
    }
  }
}
