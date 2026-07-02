// Pooled visual effects: tracers, muzzle flashes, impact puffs, crash
// sparks, and one instanced blob-shadow mesh for every dynamic entity.

import * as THREE from 'three';
import { blobShadowTexture, muzzleTexture } from '../render/textures.js';

const TRACER_POOL = 24;
const SPRITE_POOL = 32;
const SHADOW_POOL = 128;

interface Tracer { mesh: THREE.Mesh; life: number }
interface Puff { sprite: THREE.Sprite; life: number; grow: number }

export class Effects {
  private tracers: Tracer[] = [];
  private puffs: Puff[] = [];
  private shadows: THREE.InstancedMesh;
  private shadowMatrix = new THREE.Matrix4();
  private muzzleTex = muzzleTexture();

  constructor(private scene: THREE.Scene) {
    const tracerGeo = new THREE.BoxGeometry(0.04, 0.04, 1);
    const tracerMat = new THREE.MeshBasicMaterial({
      color: 0xffe9a0, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    for (let i = 0; i < TRACER_POOL; i++) {
      const mesh = new THREE.Mesh(tracerGeo, tracerMat.clone());
      mesh.visible = false;
      scene.add(mesh);
      this.tracers.push({ mesh, life: 0 });
    }

    for (let i = 0; i < SPRITE_POOL; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.muzzleTex, transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending,
      }));
      sprite.visible = false;
      scene.add(sprite);
      this.puffs.push({ sprite, life: 0, grow: 0 });
    }

    const shadowGeo = new THREE.PlaneGeometry(1, 1);
    shadowGeo.rotateX(-Math.PI / 2);
    this.shadows = new THREE.InstancedMesh(
      shadowGeo,
      new THREE.MeshBasicMaterial({
        map: blobShadowTexture(), transparent: true, depthWrite: false,
      }),
      SHADOW_POOL,
    );
    this.shadows.frustumCulled = false;
    scene.add(this.shadows);
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3): void {
    const t = this.tracers.find((x) => x.life <= 0);
    if (!t) return;
    const len = from.distanceTo(to);
    if (len < 0.5) return;
    t.mesh.position.copy(from).add(to).multiplyScalar(0.5);
    t.mesh.lookAt(to);
    t.mesh.scale.set(1, 1, len);
    t.mesh.visible = true;
    (t.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9;
    t.life = 0.07;
  }

  burst(pos: THREE.Vector3, color: number, scale = 0.6): void {
    const p = this.puffs.find((x) => x.life <= 0);
    if (!p) return;
    p.sprite.position.copy(pos);
    p.sprite.scale.setScalar(scale);
    (p.sprite.material as THREE.SpriteMaterial).color.setHex(color);
    (p.sprite.material as THREE.SpriteMaterial).opacity = 0.95;
    p.sprite.visible = true;
    p.life = 0.18;
    p.grow = scale * 6;
  }

  muzzleFlash(pos: THREE.Vector3): void {
    this.burst(pos, 0xffdd88, 0.5);
  }

  impact(pos: THREE.Vector3): void {
    this.burst(pos, 0xccbbaa, 0.4);
  }

  blood(pos: THREE.Vector3): void {
    this.burst(pos, 0xcc2233, 0.5);
  }

  sparks(pos: THREE.Vector3, intensity: number): void {
    this.burst(pos, 0xffcc66, 0.5 + intensity);
  }

  /** feed every dynamic entity's ground position each frame */
  updateShadows(entries: { x: number; z: number; scale: number }[]): void {
    const n = Math.min(entries.length, SHADOW_POOL);
    for (let i = 0; i < n; i++) {
      const e = entries[i];
      this.shadowMatrix.makeScale(e.scale, 1, e.scale);
      this.shadowMatrix.setPosition(e.x, 0.06, e.z);
      this.shadows.setMatrixAt(i, this.shadowMatrix);
    }
    // park the rest underground
    for (let i = n; i < SHADOW_POOL; i++) {
      this.shadowMatrix.makeScale(0.001, 1, 0.001);
      this.shadowMatrix.setPosition(0, -50, 0);
      this.shadows.setMatrixAt(i, this.shadowMatrix);
    }
    this.shadows.instanceMatrix.needsUpdate = true;
  }

  update(dt: number): void {
    for (const t of this.tracers) {
      if (t.life > 0) {
        t.life -= dt;
        (t.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, t.life / 0.07);
        if (t.life <= 0) t.mesh.visible = false;
      }
    }
    for (const p of this.puffs) {
      if (p.life > 0) {
        p.life -= dt;
        p.sprite.scale.addScalar(p.grow * dt);
        (p.sprite.material as THREE.SpriteMaterial).opacity = Math.max(0, (p.life / 0.18) * 0.95);
        if (p.life <= 0) p.sprite.visible = false;
      }
    }
  }
}
