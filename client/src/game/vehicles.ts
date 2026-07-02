// Vehicles: procedural meshes per archetype, arcade driving model for the
// locally-driven car, snapshot interpolation for everyone else's.

import * as THREE from 'three';
import {
  SpatialGrid, VEHICLES, VehicleInfo, VehicleKind, VehicleSpec,
  clamp, groundHeight, resolveCircleAABB, wrapAngle,
} from '@vice/shared';
import { InterpBuffer } from '../net/interpolation.js';
import type { Input } from '../input.js';

export interface DriveState {
  speed: number;
  velX: number;
  velZ: number;
}

export class ClientVehicle {
  group: THREE.Group;
  wheels: THREE.Mesh[] = [];
  buffer = new InterpBuffer();
  driverId: string | null = null;
  spec: VehicleSpec;
  yaw: number;
  drive: DriveState = { speed: 0, velX: 0, velZ: 0 };
  lightbar: THREE.Mesh[] = [];

  constructor(public info: VehicleInfo) {
    this.spec = VEHICLES[info.kind];
    this.yaw = info.yaw;
    this.driverId = info.driverId;
    const built = buildVehicleMesh(info.kind, info.color);
    this.group = built.group;
    this.wheels = built.wheels;
    this.lightbar = built.lightbar;
    this.group.position.set(info.pos[0], info.pos[1], info.pos[2]);
    this.group.rotation.y = info.yaw;
  }

  get pos(): THREE.Vector3 {
    return this.group.position;
  }
}

export function buildVehicleMesh(kind: VehicleKind, color: number): {
  group: THREE.Group; wheels: THREE.Mesh[]; lightbar: THREE.Mesh[];
} {
  const spec = VEHICLES[kind];
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color });
  const glassMat = new THREE.MeshLambertMaterial({ color: 0x1c2b3a });
  const L = spec.length;
  const W = spec.width;
  const H = spec.height;

  // lower body
  const body = new THREE.Mesh(new THREE.BoxGeometry(W, H * 0.55, L), bodyMat);
  body.position.y = 0.3 + H * 0.27;
  group.add(body);

  // cabin (varies by archetype); nose faces +Z
  if (kind === 'sports') {
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(W * 0.82, H * 0.5, L * 0.42), glassMat);
    cabin.position.set(0, 0.3 + H * 0.72, -L * 0.08);
    group.add(cabin);
    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(W * 0.9, 0.06, 0.28), bodyMat);
    spoiler.position.set(0, 0.3 + H * 0.75, -L * 0.46);
    group.add(spoiler);
  } else if (kind === 'pickup') {
    const cab = new THREE.Mesh(new THREE.BoxGeometry(W * 0.94, H * 0.55, L * 0.32), bodyMat);
    cab.position.set(0, 0.3 + H * 0.78, L * 0.1);
    group.add(cab);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(W * 0.8, H * 0.34, L * 0.28), glassMat);
    glass.position.set(0, 0.3 + H * 0.82, L * 0.11);
    group.add(glass);
    const bedL = new THREE.Mesh(new THREE.BoxGeometry(0.08, H * 0.35, L * 0.42), bodyMat);
    bedL.position.set(W / 2 - 0.06, 0.3 + H * 0.68, -L * 0.26);
    const bedR = bedL.clone();
    bedR.position.x = -W / 2 + 0.06;
    group.add(bedL, bedR);
  } else {
    // sedan / taxi / police three-box
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(W * 0.88, H * 0.52, L * 0.5), bodyMat);
    cabin.position.set(0, 0.3 + H * 0.76, -L * 0.02);
    group.add(cabin);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(W * 0.78, H * 0.4, L * 0.46), glassMat);
    glass.position.set(0, 0.3 + H * 0.8, -L * 0.02);
    group.add(glass);
  }

  const lightbar: THREE.Mesh[] = [];
  if (kind === 'taxi') {
    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.22, 0.34),
      new THREE.MeshLambertMaterial({ color: 0xfff2b0, emissive: 0x907020, emissiveIntensity: 0.6 }),
    );
    sign.position.set(0, 0.3 + H * 1.06, 0);
    group.add(sign);
  }
  if (kind === 'police') {
    const red = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.16, 0.3),
      new THREE.MeshLambertMaterial({ color: 0xff2222, emissive: 0xff0000, emissiveIntensity: 1 }),
    );
    red.position.set(-0.3, 0.3 + H * 1.05, 0);
    const blue = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.16, 0.3),
      new THREE.MeshLambertMaterial({ color: 0x2244ff, emissive: 0x0000ff, emissiveIntensity: 1 }),
    );
    blue.position.set(0.3, 0.3 + H * 1.05, 0);
    group.add(red, blue);
    lightbar.push(red, blue);
    // black-and-white livery hint
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(W + 0.02, H * 0.2, L * 0.5), new THREE.MeshLambertMaterial({ color: 0x111111 }));
    stripe.position.set(0, 0.3 + H * 0.3, 0);
    group.add(stripe);
  }

  // headlights / taillights
  const head = new THREE.Mesh(
    new THREE.BoxGeometry(W * 0.8, 0.12, 0.06),
    new THREE.MeshLambertMaterial({ color: 0xfff6cc, emissive: 0xfff0aa, emissiveIntensity: 0.7 }),
  );
  head.position.set(0, 0.3 + H * 0.35, L / 2 - 0.02);
  const tail = new THREE.Mesh(
    new THREE.BoxGeometry(W * 0.8, 0.1, 0.06),
    new THREE.MeshLambertMaterial({ color: 0xaa1122, emissive: 0xcc0022, emissiveIntensity: 0.6 }),
  );
  tail.position.set(0, 0.3 + H * 0.35, -L / 2 + 0.02);
  group.add(head, tail);

  // wheels
  const wheels: THREE.Mesh[] = [];
  const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.26, 10);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x16161a });
  const wx = W / 2 - 0.05;
  const wz = L / 2 - 0.75;
  for (const [x, z] of [[-wx, wz], [wx, wz], [-wx, -wz], [wx, -wz]] as const) {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.position.set(x, 0.34, z);
    group.add(wheel);
    wheels.push(wheel);
  }

  return { group, wheels, lightbar };
}

export class VehicleManager {
  vehicles = new Map<string, ClientVehicle>();
  /** set to my vehicle id while driving */
  drivingId: string | null = null;
  onCrash: ((pos: THREE.Vector3, intensity: number) => void) | null = null;

  constructor(
    private scene: THREE.Scene,
    private vehGrid: SpatialGrid,
  ) {}

  add(info: VehicleInfo): ClientVehicle {
    const existing = this.vehicles.get(info.id);
    if (existing) return existing;
    const v = new ClientVehicle(info);
    this.vehicles.set(info.id, v);
    this.scene.add(v.group);
    return v;
  }

  remove(id: string): void {
    const v = this.vehicles.get(id);
    if (v) {
      this.scene.remove(v.group);
      this.vehicles.delete(id);
    }
  }

  get(id: string): ClientVehicle | undefined {
    return this.vehicles.get(id);
  }

  /** nearest empty vehicle within reach of pos */
  nearestEnterable(pos: THREE.Vector3, maxDist: number): ClientVehicle | null {
    let best: ClientVehicle | null = null;
    let bestD = maxDist;
    for (const v of this.vehicles.values()) {
      if (v.driverId) continue;
      const d = Math.hypot(v.pos.x - pos.x, v.pos.z - pos.z);
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    return best;
  }

  onSnapshotRow(id: string, time: number, x: number, y: number, z: number, yaw: number, speed: number, driverId: string): void {
    const v = this.vehicles.get(id);
    if (!v) return;
    if (id === this.drivingId) return; // I simulate this one
    v.buffer.push(time, { x, y, z, yaw, extra: { speed, driverId } });
  }

  /** drive the local car; returns current speed for HUD/audio */
  updateLocal(dt: number, input: Input, othersToAvoid: { x: number; z: number; r: number }[]): number {
    const v = this.drivingId ? this.vehicles.get(this.drivingId) : null;
    if (!v) return 0;
    const spec = v.spec;
    const d = v.drive;

    const throttle = input.isDown('KeyW') ? 1 : 0;
    const braking = input.isDown('KeyS') ? 1 : 0;
    const steer = (input.isDown('KeyA') ? 1 : 0) - (input.isDown('KeyD') ? 1 : 0);
    const handbrake = input.isDown('Space');

    // longitudinal
    d.speed += throttle * spec.accel * dt;
    if (braking) {
      if (d.speed > 0.5) d.speed -= spec.brake * dt;
      else d.speed -= spec.accel * 0.6 * dt; // reverse
    }
    d.speed -= Math.sign(d.speed) * (1.2 + Math.abs(d.speed) * 0.045) * dt * (throttle || braking ? 0 : 1);
    if (handbrake) d.speed -= Math.sign(d.speed) * spec.brake * 0.5 * dt;
    d.speed = clamp(d.speed, -spec.topSpeed * 0.35, spec.topSpeed);
    if (Math.abs(d.speed) < 0.05 && !throttle && !braking) d.speed = 0;

    // steering: no turn while stopped, reduced at top speed
    const speedK = clamp(Math.abs(d.speed) / 3, 0, 1) * (1 - 0.42 * clamp(Math.abs(d.speed) / spec.topSpeed, 0, 1));
    let yawRate = steer * spec.steerGain * speedK * Math.sign(d.speed >= 0 ? 1 : -1);
    if (handbrake) yawRate *= 1.6;
    v.yaw += yawRate * dt;

    // drift: velocity chases the forward vector; handbrake loosens grip
    const grip = handbrake ? spec.grip * 0.22 : spec.grip;
    const fx = Math.sin(v.yaw);
    const fz = Math.cos(v.yaw);
    const blend = Math.min(1, grip * 11 * dt);
    d.velX += (fx * d.speed - d.velX) * blend;
    d.velZ += (fz * d.speed - d.velZ) * blend;

    // integrate with substeps to avoid tunneling thin walls at speed
    const steps = Math.abs(d.speed) > 20 ? 2 : 1;
    let crashed = 0;
    for (let s = 0; s < steps; s++) {
      v.pos.x += (d.velX * dt) / steps;
      v.pos.z += (d.velZ * dt) / steps;
      crashed = Math.max(crashed, this.collideBody(v, othersToAvoid));
    }
    if (crashed > 5 && this.onCrash) {
      this.onCrash(v.pos, Math.min(1, crashed / 25));
    }

    v.pos.y = groundHeight(v.pos.x, v.pos.z);
    v.group.rotation.y = v.yaw;
    this.spinWheels(v, d.speed, dt, steer);
    return d.speed;
  }

  /** 3-circle body vs static world + other vehicles. Returns impact speed. */
  private collideBody(v: ClientVehicle, others: { x: number; z: number; r: number }[]): number {
    const spec = v.spec;
    const r = (spec.width / 2) * 0.95;
    const half = spec.length / 2 - r;
    const fx = Math.sin(v.yaw);
    const fz = Math.cos(v.yaw);
    let impact = 0;

    for (const off of [half, 0, -half]) {
      const cx = v.pos.x + fx * off;
      const cz = v.pos.z + fz * off;
      // static world
      const near = this.vehGrid.queryCircle(cx, cz, r + 0.5);
      for (const bi of near) {
        const res = resolveCircleAABB(cx, cz, r, this.vehGrid.boxes[bi]);
        if (res) {
          const pushX = res.x - cx;
          const pushZ = res.z - cz;
          const pushLen = Math.hypot(pushX, pushZ);
          if (pushLen > 1e-6) {
            const cap = Math.min(pushLen, 0.6);
            v.pos.x += (pushX / pushLen) * cap;
            v.pos.z += (pushZ / pushLen) * cap;
            // kill velocity into the wall
            const nx = pushX / pushLen;
            const nz = pushZ / pushLen;
            const into = v.drive.velX * -nx + v.drive.velZ * -nz;
            if (into > 0) {
              impact = Math.max(impact, into);
              v.drive.velX += nx * into;
              v.drive.velZ += nz * into;
              v.drive.speed *= 0.55;
            }
          }
        }
      }
      // other vehicles as circles
      for (const o of others) {
        const dx = cx - o.x;
        const dz = cz - o.z;
        const dist = Math.hypot(dx, dz);
        const minD = r + o.r;
        if (dist < minD && dist > 1e-6) {
          const push = (minD - dist) * 0.6;
          v.pos.x += (dx / dist) * push;
          v.pos.z += (dz / dist) * push;
          const into = v.drive.velX * (-dx / dist) + v.drive.velZ * (-dz / dist);
          if (into > 0) {
            impact = Math.max(impact, into);
            v.drive.velX += (dx / dist) * into * 0.9;
            v.drive.velZ += (dz / dist) * into * 0.9;
            v.drive.speed *= 0.7;
          }
        }
      }
    }
    return impact;
  }

  /** interpolate everything I'm not driving */
  updateRemotes(dt: number, renderTime: number, camPos: THREE.Vector3): void {
    for (const v of this.vehicles.values()) {
      if (v.info.id === this.drivingId) continue;
      // distance culling keeps parked-car draw calls in check
      const d2 = (v.pos.x - camPos.x) ** 2 + (v.pos.z - camPos.z) ** 2;
      v.group.visible = d2 < 260 * 260;
      const s = v.buffer.sample(renderTime);
      if (s) {
        v.pos.set(s.x, s.y, s.z);
        v.yaw = s.yaw;
        v.group.rotation.y = s.yaw;
        const speed = (s.extra.speed as number) ?? 0;
        this.spinWheels(v, speed, dt, 0);
      }
      // police lightbar strobe
      if (v.lightbar.length === 2) {
        const phase = Math.floor(performance.now() / 250) % 2;
        (v.lightbar[0].material as THREE.MeshLambertMaterial).emissiveIntensity = phase ? 1.6 : 0.15;
        (v.lightbar[1].material as THREE.MeshLambertMaterial).emissiveIntensity = phase ? 0.15 : 1.6;
      }
    }
  }

  private spinWheels(v: ClientVehicle, speed: number, dt: number, steer: number): void {
    for (let i = 0; i < v.wheels.length; i++) {
      const w = v.wheels[i];
      w.rotation.x += (speed / 0.34) * dt;
      if (i < 2) w.rotation.y = steer * 0.4; // front wheels show steering
    }
  }
}
