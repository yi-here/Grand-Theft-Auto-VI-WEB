// Client-side weapons: raycast hit detection (server verifies every claim),
// ammo/reload state, firing effects. Fists use a proximity arc instead.

import * as THREE from 'three';
import {
  PLAYER_EYE, SpatialGrid, WEAPONS, WeaponKind,
} from '@vice/shared';
import type { Input } from '../input.js';
import type { Net } from '../net/socket.js';
import type { Effects } from './effects.js';
import type { RemotePlayerManager } from './remotePlayers.js';
import type { NpcManager } from './npcs.js';

export interface AimSource {
  origin: THREE.Vector3;
  dir: THREE.Vector3;
}

function raySphere(o: THREE.Vector3, d: THREE.Vector3, c: THREE.Vector3, r: number): number | null {
  const oc = new THREE.Vector3().subVectors(o, c);
  const b = oc.dot(d);
  const disc = b * b - (oc.lengthSq() - r * r);
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : null;
}

export class Combat {
  weapon: WeaponKind = 'pistol';
  clip: Record<string, number> = { pistol: WEAPONS.pistol.clip, smg: WEAPONS.smg.clip };
  reloadingUntil = 0;
  private lastShot = 0;
  punchT = 0;

  onFired: ((weapon: WeaponKind) => void) | null = null;

  constructor(
    private net: Net,
    private effects: Effects,
    private buildingGrid: SpatialGrid,
    private remotes: RemotePlayerManager,
    private npcs: NpcManager,
  ) {}

  get reloading(): boolean {
    return performance.now() < this.reloadingUntil;
  }

  update(
    dt: number,
    input: Input,
    canShoot: boolean,
    playerPos: THREE.Vector3,
    playerYaw: number,
    aim: AimSource,
  ): void {
    this.punchT = Math.max(0, this.punchT - dt * 4);

    if (input.wasPressed('Digit1')) this.switchTo('fist');
    if (input.wasPressed('Digit2')) this.switchTo('pistol');
    if (input.wasPressed('Digit3')) this.switchTo('smg');
    if (input.wasPressed('KeyR')) this.startReload();

    if (!canShoot) return;
    const spec = WEAPONS[this.weapon];
    const wantFire = spec.auto ? input.fireHeld : input.firePressed;
    if (!wantFire) return;

    const now = performance.now();
    if (now - this.lastShot < spec.cooldownMs) return;
    if (this.reloading) return;
    if (spec.clip > 0 && this.clip[this.weapon] <= 0) {
      this.startReload();
      return;
    }
    this.lastShot = now;

    if (this.weapon === 'fist') {
      this.punch(playerPos, playerYaw);
      return;
    }
    this.fireBullet(spec, playerPos, aim);
  }

  private switchTo(w: WeaponKind): void {
    if (this.weapon !== w) {
      this.weapon = w;
      this.reloadingUntil = 0;
    }
  }

  private startReload(): void {
    const spec = WEAPONS[this.weapon];
    if (spec.clip === 0 || this.reloading || this.clip[this.weapon] === spec.clip) return;
    this.reloadingUntil = performance.now() + spec.reloadMs;
    setTimeout(() => {
      if (performance.now() >= this.reloadingUntil - 20) {
        this.clip[this.weapon] = spec.clip;
      }
    }, spec.reloadMs);
  }

  private fireBullet(
    spec: (typeof WEAPONS)[string],
    playerPos: THREE.Vector3,
    aim: AimSource,
  ): void {
    this.clip[this.weapon]--;

    // spread
    const dir = aim.dir.clone();
    if (spec.spreadRad > 0) {
      dir.x += (Math.random() - 0.5) * 2 * spec.spreadRad;
      dir.y += (Math.random() - 0.5) * 2 * spec.spreadRad;
      dir.z += (Math.random() - 0.5) * 2 * spec.spreadRad;
      dir.normalize();
    }

    const maxT = spec.range + 8; // camera sits behind the player
    const bHit = this.buildingGrid.raycast(
      aim.origin.x, aim.origin.y, aim.origin.z, dir.x, dir.y, dir.z, maxT,
    );
    const hit: { t: number; kind: 'player' | 'npc' | 'world' | 'none'; id?: string } = {
      t: bHit ?? maxT,
      kind: bHit !== null ? 'world' : 'none',
    };

    const torso = new THREE.Vector3();
    const head = new THREE.Vector3();
    const testBody = (pos: THREE.Vector3, id: string, kind: 'player' | 'npc'): void => {
      torso.set(pos.x, pos.y + 1.0, pos.z);
      head.set(pos.x, pos.y + 1.55, pos.z);
      const t1 = raySphere(aim.origin, dir, torso, 0.55);
      const t2 = raySphere(aim.origin, dir, head, 0.3);
      const t = t1 !== null && t2 !== null ? Math.min(t1, t2) : t1 ?? t2;
      if (t !== null && t < hit.t) {
        hit.t = t;
        hit.kind = kind;
        hit.id = id;
      }
    };

    for (const [id, rp] of this.remotes.players) {
      if (rp.vehId || rp.anim === 'dead') continue;
      testBody(rp.root.position, id, 'player');
    }
    for (const [id, npc] of this.npcs.npcs) {
      if (npc.info.ptype !== 'ped' || npc.state === 'dead') continue;
      testBody(npc.group.position, id, 'npc');
    }

    const hitPos = aim.origin.clone().add(dir.clone().multiplyScalar(hit.t));
    const eye = new THREE.Vector3(playerPos.x, playerPos.y + PLAYER_EYE, playerPos.z);
    const sendDir = hitPos.clone().sub(eye);
    const sendDist = sendDir.length();
    if (sendDist > spec.range) {
      // out of range from the muzzle even if the camera ray reached — trim
      hit.kind = 'none';
      hit.id = undefined;
      hitPos.copy(eye).add(sendDir.multiplyScalar(spec.range / sendDist));
      sendDir.normalize();
    } else {
      sendDir.normalize();
    }

    // effects
    const muzzle = eye.clone().add(sendDir.clone().multiplyScalar(0.5));
    muzzle.y -= 0.15;
    this.effects.muzzleFlash(muzzle);
    this.effects.tracer(muzzle, hitPos);
    if (hit.kind === 'player' || hit.kind === 'npc') this.effects.blood(hitPos);
    else if (hit.kind === 'world') this.effects.impact(hitPos);
    this.onFired?.(this.weapon);

    this.net.send({
      t: 'shoot',
      weapon: this.weapon,
      origin: [round2(eye.x), round2(eye.y), round2(eye.z)],
      dir: [round3(sendDir.x), round3(sendDir.y), round3(sendDir.z)],
      hitKind: hit.kind,
      hitId: hit.id,
      hitPos: [round2(hitPos.x), round2(hitPos.y), round2(hitPos.z)],
    });

    if (spec.clip > 0 && this.clip[this.weapon] <= 0) this.startReload();
  }

  private punch(playerPos: THREE.Vector3, playerYaw: number): void {
    this.punchT = 1;
    const spec = WEAPONS.fist;
    const fx = Math.sin(playerYaw);
    const fz = Math.cos(playerYaw);
    let bestD = spec.range;
    let hitKind: 'player' | 'npc' | 'none' = 'none';
    let hitId: string | undefined;
    let hitPos: THREE.Vector3 | null = null;

    const consider = (pos: THREE.Vector3, id: string, kind: 'player' | 'npc'): void => {
      const dx = pos.x - playerPos.x;
      const dz = pos.z - playerPos.z;
      const d = Math.hypot(dx, dz);
      if (d < bestD && (dx * fx + dz * fz) / Math.max(d, 0.01) > 0.2) {
        bestD = d;
        hitKind = kind;
        hitId = id;
        hitPos = new THREE.Vector3(pos.x, pos.y + 1.1, pos.z);
      }
    };
    for (const [id, rp] of this.remotes.players) {
      if (rp.vehId || rp.anim === 'dead') continue;
      consider(rp.root.position, id, 'player');
    }
    for (const [id, npc] of this.npcs.npcs) {
      if (npc.info.ptype !== 'ped' || npc.state === 'dead') continue;
      consider(npc.group.position, id, 'npc');
    }

    const eye = new THREE.Vector3(playerPos.x, playerPos.y + PLAYER_EYE, playerPos.z);
    const target = hitPos ?? eye.clone().add(new THREE.Vector3(fx, 0, fz));
    if (hitPos) this.effects.blood(hitPos);
    this.onFired?.('fist');
    this.net.send({
      t: 'shoot',
      weapon: 'fist',
      origin: [round2(eye.x), round2(eye.y), round2(eye.z)],
      dir: [round3(fx), 0, round3(fz)],
      hitKind,
      hitId,
      hitPos: [round2(target.x), round2(target.y), round2(target.z)],
    });
  }
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const round3 = (v: number) => Math.round(v * 1000) / 1000;
