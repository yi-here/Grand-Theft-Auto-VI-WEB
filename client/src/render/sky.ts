// Sky, lights, fog and the day-night cycle. Time-of-day derives from the
// server clock so every player sees the same sky. A gradient dome + sun
// disc replace the flat background; the sun casts a real shadow.

import * as THREE from 'three';
import { DAY_CYCLE_SECONDS } from '@vice/shared';

const DAY_TOP = new THREE.Color(0x3a86c8);
const DAY_HORIZON = new THREE.Color(0xbfe3f2);
const DUSK_TOP = new THREE.Color(0x9a3f7a);
const DUSK_HORIZON = new THREE.Color(0xf2a05a);
const NIGHT_TOP = new THREE.Color(0x090a1c);
const NIGHT_HORIZON = new THREE.Color(0x24203f);

const DAY_FOG = new THREE.Color(0xbfe0ee);
const DUSK_FOG = new THREE.Color(0xe8a878);
const NIGHT_FOG = new THREE.Color(0x181a34);

const SKY_VERT = `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
  }`;
const SKY_FRAG = `
  varying vec3 vDir;
  uniform vec3 topColor;
  uniform vec3 horizonColor;
  uniform vec3 sunColor;
  uniform vec3 sunDir;
  void main() {
    float h = clamp(vDir.y * 1.15 + 0.05, 0.0, 1.0);
    vec3 col = mix(horizonColor, topColor, pow(h, 0.55));
    // sun/moon glow toward the sun direction on the dome
    float s = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
    col += sunColor * pow(s, 220.0) * 2.6;          // tight disc (blooms)
    col += sunColor * pow(s, 12.0) * 0.28;          // soft halo
    gl_FragColor = vec4(col, 1.0);
  }`;

export class SkySystem {
  nightAmount = 0; // 0 = noon, 1 = midnight
  private hemi: THREE.HemisphereLight;
  private sun: THREE.DirectionalLight;
  private dome: THREE.Mesh;
  private uniforms: {
    topColor: { value: THREE.Color };
    horizonColor: { value: THREE.Color };
    sunColor: { value: THREE.Color };
    sunDir: { value: THREE.Vector3 };
  };
  private fog: THREE.Fog;

  constructor(private scene: THREE.Scene, _glowTex: THREE.Texture, shadows: boolean) {
    this.fog = new THREE.Fog(0xbfe0ee, 200, 700);
    scene.fog = this.fog;

    this.uniforms = {
      topColor: { value: DAY_TOP.clone() },
      horizonColor: { value: DAY_HORIZON.clone() },
      sunColor: { value: new THREE.Color(0xffe9b0) },
      sunDir: { value: new THREE.Vector3(0, 1, 0) },
    };
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(900, 32, 16),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    );
    this.dome.renderOrder = -1;
    scene.add(this.dome);

    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x8a7a68, 0.9);
    scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff2d8, 1.6);
    this.sun.position.set(-200, 260, 120);
    scene.add(this.sun);
    scene.add(this.sun.target);

    if (shadows) {
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(2048, 2048);
      const cam = this.sun.shadow.camera;
      cam.near = 1;
      cam.far = 500;
      cam.left = cam.bottom = -110;
      cam.right = cam.top = 110;
      this.sun.shadow.bias = -0.0006;
      this.sun.shadow.normalBias = 0.6;
    }
  }

  get skyTint(): THREE.Color { return this.uniforms.horizonColor.value; }
  get sunDirection(): THREE.Vector3 { return this.uniforms.sunDir.value; }
  get sunTint(): THREE.Color { return this.uniforms.sunColor.value; }

  /** serverNow in ms; phaseOverride (0..1) pins time-of-day for testing */
  update(serverNow: number, camPos: THREE.Vector3, phaseOverride: number | null = null): void {
    const t = phaseOverride ?? (serverNow / 1000 / DAY_CYCLE_SECONDS) % 1; // 0..1, 0 = dawn
    const sunEl = Math.sin(t * Math.PI * 2); // >0 day, <0 night
    const day = THREE.MathUtils.clamp(sunEl * 2.2, -1, 1);

    if (day > 0) {
      const k = Math.min(1, day);
      this.uniforms.topColor.value.copy(DUSK_TOP).lerp(DAY_TOP, k);
      this.uniforms.horizonColor.value.copy(DUSK_HORIZON).lerp(DAY_HORIZON, k);
      this.fog.color.copy(DUSK_FOG).lerp(DAY_FOG, k);
      this.nightAmount = 1 - k > 0.6 ? 0.25 : 0;
    } else {
      const k = Math.min(1, -day);
      this.uniforms.topColor.value.copy(DUSK_TOP).lerp(NIGHT_TOP, k);
      this.uniforms.horizonColor.value.copy(DUSK_HORIZON).lerp(NIGHT_HORIZON, k);
      this.fog.color.copy(DUSK_FOG).lerp(NIGHT_FOG, k);
      this.nightAmount = k;
    }

    // keep lit diffuse under ~1.3 so only emissive sources cross bloom threshold
    const dayness = THREE.MathUtils.clamp(sunEl * 3, 0.05, 1);
    this.hemi.intensity = 0.3 + dayness * 0.6;
    this.sun.intensity = 0.1 + dayness * 1.15;

    // sun swings east -> west; below the horizon it becomes the moon
    const ang = t * Math.PI * 2 - Math.PI / 2;
    const sunDir = new THREE.Vector3(Math.cos(ang) * 0.8, Math.sin(t * Math.PI * 2), -0.35).normalize();
    this.uniforms.sunDir.value.copy(sunDir);
    this.uniforms.sunColor.value.setHex(sunEl < -0.1 ? 0xd8e0ff : sunEl < 0.25 ? 0xff9c5a : 0xffe9b0);

    // keep the sun light anchored relative to the player so its shadow
    // frustum always covers the area around the camera
    this.sun.position.copy(camPos).add(sunDir.clone().multiplyScalar(200));
    this.sun.position.y = Math.max(this.sun.position.y, camPos.y + 60);
    this.sun.target.position.copy(camPos);

    // dome + fog follow the camera so we never reach the edge
    this.dome.position.copy(camPos);
  }
}
