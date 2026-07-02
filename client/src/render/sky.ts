// Sky, lights, fog and the day-night cycle. Time-of-day derives from the
// server clock so every player sees the same sky.

import * as THREE from 'three';
import { DAY_CYCLE_SECONDS } from '@vice/shared';

const DAY_SKY = new THREE.Color(0x8ec8e8);
const DUSK_SKY = new THREE.Color(0xe88aa0);
const NIGHT_SKY = new THREE.Color(0x131530);

const DAY_FOG = new THREE.Color(0xb8dcee);
const DUSK_FOG = new THREE.Color(0xe8a8b0);
const NIGHT_FOG = new THREE.Color(0x181a38);

export class SkySystem {
  nightAmount = 0; // 0 = noon, 1 = midnight
  private hemi: THREE.HemisphereLight;
  private sun: THREE.DirectionalLight;
  private sunSprite: THREE.Sprite;
  private bg = new THREE.Color();
  private fog: THREE.Fog;

  constructor(private scene: THREE.Scene, glowTex: THREE.Texture) {
    this.fog = new THREE.Fog(0xb8dcee, 180, 620);
    scene.fog = this.fog;
    scene.background = this.bg;

    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x8a7a68, 0.9);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff2d8, 1.6);
    this.sun.position.set(-200, 260, 120);
    scene.add(this.sun);

    const mat = new THREE.SpriteMaterial({
      map: glowTex, color: 0xffe9b0, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.sunSprite = new THREE.Sprite(mat);
    this.sunSprite.scale.setScalar(140);
    scene.add(this.sunSprite);
  }

  /** serverNow in ms */
  update(serverNow: number, camPos: THREE.Vector3): void {
    const t = (serverNow / 1000 / DAY_CYCLE_SECONDS) % 1; // 0..1, 0 = dawn
    const sunEl = Math.sin(t * Math.PI * 2); // >0 day, <0 night
    const day = THREE.MathUtils.clamp(sunEl * 2.2, -1, 1);

    // three-way blend: night -> dusk -> day
    if (day > 0) {
      const k = Math.min(1, day);
      this.bg.copy(DUSK_SKY).lerp(DAY_SKY, k);
      this.fog.color.copy(DUSK_FOG).lerp(DAY_FOG, k);
      this.nightAmount = 1 - k > 0.6 ? 0.2 : 0;
    } else {
      const k = Math.min(1, -day);
      this.bg.copy(DUSK_SKY).lerp(NIGHT_SKY, k);
      this.fog.color.copy(DUSK_FOG).lerp(NIGHT_FOG, k);
      this.nightAmount = k;
    }

    const dayness = THREE.MathUtils.clamp(sunEl * 3, 0.06, 1);
    this.hemi.intensity = 0.25 + dayness * 0.75;
    this.sun.intensity = 0.15 + dayness * 1.5;

    // sun swings east -> west
    const ang = t * Math.PI * 2 - Math.PI / 2;
    const sunDir = new THREE.Vector3(Math.cos(ang) * 0.8, Math.sin(t * Math.PI * 2), -0.35).normalize();
    this.sun.position.copy(sunDir).multiplyScalar(300).add(new THREE.Vector3(0, 40, 0));
    this.sunSprite.position.copy(camPos).add(sunDir.clone().multiplyScalar(500));
    this.sunSprite.position.y = Math.max(this.sunSprite.position.y, -80);
    (this.sunSprite.material as THREE.SpriteMaterial).opacity = Math.max(0, sunEl * 1.4 + 0.15);
    (this.sunSprite.material as THREE.SpriteMaterial).color.setHex(sunEl < 0.25 ? 0xff9060 : 0xffe9b0);
  }
}
