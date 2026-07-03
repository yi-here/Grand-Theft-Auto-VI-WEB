// Post-processing stack: the single biggest visual upgrade. Bloom gives the
// neon/Miami glow to lit windows, signs, lamps, tracers and the sun; SMAA
// smooths edges (renderer AA is off); OutputPass applies ACES tone mapping
// and sRGB so colours read filmic instead of flat.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

export class PostFX {
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private baseStrength = 0.7;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    private pixelRatio: number,
  ) {
    const size = renderer.getSize(new THREE.Vector2());
    this.composer = new EffectComposer(renderer);
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(size.x, size.y);

    this.composer.addPass(new RenderPass(scene, camera));

    // threshold 1.45 sits above the brightest sunlit surface (lights are
    // capped so lit diffuse peaks ~1.3) — only emissive sources (neon
    // windows, lamps, headlights, the sun disc) push past it and bloom
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), this.baseStrength, 0.6, 1.45);
    this.composer.addPass(this.bloom);

    this.composer.addPass(new SMAAPass(size.x * pixelRatio, size.y * pixelRatio));

    const output = new OutputPass();
    this.composer.addPass(output);
  }

  /** a little more glow at night when neon dominates */
  setNight(n: number): void {
    this.bloom.strength = this.baseStrength + n * 0.3;
  }

  setSize(w: number, h: number): void {
    this.composer.setSize(w, h);
  }

  render(): void {
    this.composer.render();
  }
}
