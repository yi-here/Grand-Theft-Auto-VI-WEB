// Local player controller: camera-relative WASD, sprint, jump, gravity,
// circle-vs-AABB collision against the static world and OBB collision
// against vehicles. Movement here is what gets reported to the server.

import * as THREE from 'three';
import {
  GRAVITY, JUMP_VELOCITY, PLAYER_RADIUS, SPRINT_SPEED, WALK_SPEED,
  SpatialGrid, WORLD_BOUNDS, clamp, groundHeight, resolveCircleAABB, wrapAngle,
  type PlayerAnim,
} from '@vice/shared';
import type { Input } from '../input.js';

export interface VehicleObstacle {
  x: number;
  z: number;
  yaw: number;
  halfW: number;
  halfL: number;
}

export class LocalPlayer {
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0; // facing
  anim: PlayerAnim = 'idle';
  grounded = true;
  hp = 100;
  dead = false;

  constructor(private moveGrid: SpatialGrid) {}

  spawnAt(x: number, y: number, z: number): void {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.dead = false;
    this.hp = 100;
  }

  update(dt: number, input: Input, camYaw: number, aiming: boolean, vehicles: VehicleObstacle[]): void {
    if (this.dead) {
      this.anim = 'dead';
      return;
    }

    let ix = 0;
    let iz = 0;
    if (input.isDown('KeyW')) iz += 1;
    if (input.isDown('KeyS')) iz -= 1;
    if (input.isDown('KeyA')) ix -= 1;
    if (input.isDown('KeyD')) ix += 1;
    const moving = ix !== 0 || iz !== 0;
    const sprint = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
    const speed = aiming ? WALK_SPEED * 0.7 : sprint ? SPRINT_SPEED : WALK_SPEED;

    // camera-relative move direction
    const sin = Math.sin(camYaw);
    const cos = Math.cos(camYaw);
    let dx = 0;
    let dz = 0;
    if (moving) {
      const len = Math.hypot(ix, iz);
      const nx = ix / len;
      const nz = iz / len;
      // forward = (sin, cos), right = (-cos, sin) in XZ (lookDir × up)
      dx = sin * nz - cos * nx;
      dz = cos * nz + sin * nx;
    }

    // horizontal velocity with quick accel/decel
    const accel = this.grounded ? 40 : 10;
    this.vel.x += (dx * speed - this.vel.x) * Math.min(1, accel * dt / 4);
    this.vel.z += (dz * speed - this.vel.z) * Math.min(1, accel * dt / 4);

    // jumping + gravity
    const ground = groundHeight(this.pos.x, this.pos.z);
    if (this.grounded && input.isDown('Space')) {
      this.vel.y = JUMP_VELOCITY;
      this.grounded = false;
    }
    this.vel.y -= GRAVITY * dt;

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += this.vel.y * dt;

    if (this.pos.y <= ground) {
      this.pos.y = ground;
      this.vel.y = 0;
      this.grounded = true;
    } else if (this.pos.y > ground + 0.05) {
      this.grounded = false;
    }

    // static world collision
    const res = this.moveGrid.resolveCircle(this.pos.x, this.pos.z, PLAYER_RADIUS);
    this.pos.x = res.x;
    this.pos.z = res.z;

    // vehicles as rotated rectangles: resolve in vehicle-local space
    for (const v of vehicles) {
      const relX = this.pos.x - v.x;
      const relZ = this.pos.z - v.z;
      const s = Math.sin(-v.yaw);
      const c = Math.cos(-v.yaw);
      const lx = relX * c + relZ * s;
      const lz = -relX * s + relZ * c;
      const hit = resolveCircleAABB(lx, lz, PLAYER_RADIUS, {
        minX: -v.halfW, minY: 0, minZ: -v.halfL, maxX: v.halfW, maxY: 3, maxZ: v.halfL,
      });
      if (hit) {
        const s2 = Math.sin(v.yaw);
        const c2 = Math.cos(v.yaw);
        this.pos.x = v.x + hit.x * c2 + hit.z * s2;
        this.pos.z = v.z - hit.x * s2 + hit.z * c2;
      }
    }

    this.pos.x = clamp(this.pos.x, WORLD_BOUNDS.minX, WORLD_BOUNDS.maxX);
    this.pos.z = clamp(this.pos.z, WORLD_BOUNDS.minZ, WORLD_BOUNDS.maxZ);
    // don't walk into the ocean
    this.pos.x = Math.max(this.pos.x, 2);

    // facing: aim locks to camera, otherwise turn toward movement
    if (aiming) {
      this.yaw = camYaw;
    } else if (moving) {
      const targetYaw = Math.atan2(dx, dz);
      this.yaw += wrapAngle(targetYaw - this.yaw) * Math.min(1, 12 * dt);
    }

    // animation state
    if (!this.grounded) this.anim = 'jump';
    else if (aiming) this.anim = 'aim';
    else if (moving && sprint) this.anim = 'run';
    else if (moving) this.anim = 'walk';
    else this.anim = 'idle';
  }
}
