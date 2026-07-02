// Third-person orbit camera with pointer-lock mouse look, building
// occlusion (boom shortens instead of clipping through walls), shoulder
// offset while aiming, speed FOV kick and crash shake.

import * as THREE from 'three';
import { SpatialGrid, clamp } from '@vice/shared';
import type { Input } from '../input.js';

const SENS = 0.0024;

export class ThirdPersonCamera {
  yaw = Math.PI; // start looking at the city from the beach
  pitch = 0.25;
  private boom = 5.5;
  private shake = 0;
  private tmpTarget = new THREE.Vector3();

  constructor(
    public camera: THREE.PerspectiveCamera,
    private buildingGrid: SpatialGrid,
  ) {}

  addShake(amount: number): void {
    this.shake = Math.min(1.2, this.shake + amount);
  }

  update(
    dt: number,
    input: Input,
    targetPos: THREE.Vector3,
    opts: { aiming: boolean; driving: boolean; speed: number },
  ): void {
    this.yaw -= input.mouseDX * SENS;
    this.pitch = clamp(this.pitch + input.mouseDY * SENS, -0.5, 1.2);

    const wantBoom = opts.aiming ? 2.3 : opts.driving ? 7.5 : 5.5;
    this.boom += (wantBoom - this.boom) * Math.min(1, 8 * dt);

    this.tmpTarget.copy(targetPos);
    this.tmpTarget.y += opts.driving ? 2.2 : 1.55;

    // orbit direction (from target toward camera)
    const cp = Math.cos(this.pitch);
    const dir = new THREE.Vector3(
      -Math.sin(this.yaw) * cp,
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * cp,
    );

    // occlusion: shorten the boom to the nearest building hit
    let dist = this.boom;
    const hit = this.buildingGrid.raycast(
      this.tmpTarget.x, this.tmpTarget.y, this.tmpTarget.z,
      dir.x, dir.y, dir.z, this.boom + 0.5,
    );
    if (hit !== null) dist = Math.max(0.5, hit - 0.35);

    const camPos = this.tmpTarget.clone().add(dir.multiplyScalar(dist));
    // never below ground
    camPos.y = Math.max(camPos.y, 0.4);

    if (this.shake > 0.005) {
      camPos.x += (Math.random() - 0.5) * this.shake * 0.5;
      camPos.y += (Math.random() - 0.5) * this.shake * 0.5;
      camPos.z += (Math.random() - 0.5) * this.shake * 0.5;
      this.shake *= Math.max(0, 1 - 6 * dt);
    }

    this.camera.position.copy(camPos);
    const look = this.tmpTarget.clone();
    if (opts.aiming) {
      // shoulder offset: shift the look target right of the player
      const right = new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
      look.add(right.multiplyScalar(0.55));
      this.camera.position.add(right.clone().multiplyScalar(0.55));
    }
    this.camera.lookAt(look);

    const wantFov = 62 + clamp(opts.speed / 42, 0, 1) * (opts.driving ? 14 : 0) - (opts.aiming ? 14 : 0);
    if (Math.abs(this.camera.fov - wantFov) > 0.1) {
      this.camera.fov += (wantFov - this.camera.fov) * Math.min(1, 6 * dt);
      this.camera.updateProjectionMatrix();
    }
  }

  /** horizontal forward direction the player moves along */
  get forwardYaw(): number {
    return this.yaw;
  }

  /** full 3D ray through the crosshair */
  getAimRay(): { origin: THREE.Vector3; dir: THREE.Vector3 } {
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    return { origin: this.camera.position.clone(), dir };
  }
}
