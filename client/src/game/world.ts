// Turns CityData into the Three.js scene: instanced buildings/palms/props,
// merged roads and sidewalks, beach ramp, ocean, ground. Kept to a couple
// dozen draw calls total.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  CITY, CityData, GRID_ORIGIN_X, GRID_ORIGIN_Z, GRID_SPAN_X, GRID_SPAN_Z,
  groundHeight,
} from '@vice/shared';
import * as tx from '../render/textures.js';
import { quality } from '../config.js';

export class World {
  private buildingMats: THREE.MeshLambertMaterial[] = [];
  private lampHeads: THREE.InstancedMesh | null = null;
  private water: THREE.Mesh | null = null;
  private waterMat: THREE.ShaderMaterial | null = null;
  private shadowCasters: THREE.Object3D[] = [];

  constructor(private scene: THREE.Scene, city: CityData) {
    this.buildGround(city);
    this.buildRoads(city);
    this.buildSidewalks(city);
    this.buildBeach(city);
    this.buildBuildings(city);
    this.buildPalms(city);
    this.buildProps(city);
    this.applyShadows();
  }

  /** buildings/palms cast; all opaque ground receives. World is the first
   *  thing added to the scene, so its meshes are exactly scene.children here. */
  private applyShadows(): void {
    if (!quality.shadows) return;
    for (const o of this.scene.children) {
      const m = o as THREE.Mesh;
      if ((m.isMesh || (m as unknown as THREE.InstancedMesh).isInstancedMesh) && m !== this.water) {
        m.receiveShadow = true;
      }
    }
    for (const c of this.shadowCasters) c.castShadow = true;
  }

  /** dial building window glow + lamp glow with the day-night cycle.
   *  values pushed past the bloom threshold (1.45) so lit windows/lamps glow */
  setNight(n: number): void {
    for (const m of this.buildingMats) m.emissiveIntensity = n * 1.9;
    if (this.lampHeads) {
      (this.lampHeads.material as THREE.MeshLambertMaterial).emissiveIntensity = 0.4 + n * 2.4;
    }
  }

  update(dt: number): void {
    if (this.waterMat) this.waterMat.uniforms.uTime.value += dt;
  }

  /** feed the ocean shader the current sky tint + sun so it matches the cycle */
  setSky(skyTint: THREE.Color, sunDir: THREE.Vector3, sunColor: THREE.Color, night: number): void {
    if (!this.waterMat) return;
    this.waterMat.uniforms.uSky.value.copy(skyTint);
    this.waterMat.uniforms.uSunDir.value.copy(sunDir);
    this.waterMat.uniforms.uSunColor.value.copy(sunColor);
    const deep = this.waterMat.uniforms.uDeep.value as THREE.Color;
    deep.setHex(0x0e5a78).multiplyScalar(1 - night * 0.75);
    (this.waterMat.uniforms.uShallow.value as THREE.Color).setHex(0x2ba6c0).multiplyScalar(1 - night * 0.7);
  }

  private buildGround(city: CityData): void {
    // one big pale base under the whole grid (shows through between things)
    const base = new THREE.Mesh(
      new THREE.PlaneGeometry(GRID_SPAN_X + 60, GRID_SPAN_Z + 60),
      new THREE.MeshLambertMaterial({ map: tx.concreteTexture() }),
    );
    base.rotation.x = -Math.PI / 2;
    base.position.set(GRID_ORIGIN_X + GRID_SPAN_X / 2, -0.05, GRID_ORIGIN_Z + GRID_SPAN_Z / 2);
    this.scene.add(base);

    // block interiors (plain), parks (grass), lots (dark asphalt) as tinted tiles
    const tile = new THREE.BoxGeometry(1, 0.06, 1);
    const parkSet = new Set(city.parks.map((r) => r.x + ',' + r.z));
    const lotSet = new Set(city.lots.map((r) => r.x + ',' + r.z));
    const mesh = new THREE.InstancedMesh(
      tile,
      new THREE.MeshLambertMaterial({ color: 0xffffff }),
      city.blocks.length,
    );
    const m = new THREE.Matrix4();
    const colorPlain = new THREE.Color(0xa8a29a);
    const colorPark = new THREE.Color(0x69a05e);
    const colorLot = new THREE.Color(0x3c3d45);
    city.blocks.forEach((r, i) => {
      m.makeScale(r.w, 1, r.d);
      m.setPosition(r.x + r.w / 2, 0, r.z + r.d / 2);
      mesh.setMatrixAt(i, m);
      const key = r.x + ',' + r.z;
      mesh.setColorAt(i, parkSet.has(key) ? colorPark : lotSet.has(key) ? colorLot : colorPlain);
    });
    mesh.instanceMatrix.needsUpdate = true;
    this.scene.add(mesh);
  }

  private buildRoads(city: CityData): void {
    const asphaltW = CITY.ROAD - CITY.SIDEWALK * 2;
    const vGeos: THREE.BufferGeometry[] = [];
    const hGeos: THREE.BufferGeometry[] = [];
    const spanX = GRID_SPAN_X;
    const spanZ = GRID_SPAN_Z;

    for (const x of city.roadsV) {
      const g = new THREE.BoxGeometry(asphaltW, 0.08, spanZ);
      g.translate(x, 0, GRID_ORIGIN_Z + spanZ / 2);
      vGeos.push(g);
    }
    for (const z of city.roadsH) {
      const g = new THREE.BoxGeometry(spanX, 0.08, asphaltW);
      g.translate(GRID_ORIGIN_X + spanX / 2, 0.005, z);
      hGeos.push(g);
    }

    const vTex = tx.asphaltTexture(true);
    vTex.repeat.set(1, spanZ / 10);
    const hTex = tx.asphaltTexture(false);
    hTex.repeat.set(spanX / 10, 1);
    const vMesh = new THREE.Mesh(mergeGeometries(vGeos), new THREE.MeshLambertMaterial({ map: vTex }));
    const hMesh = new THREE.Mesh(mergeGeometries(hGeos), new THREE.MeshLambertMaterial({ map: hTex }));
    this.scene.add(vMesh, hMesh);
  }

  private buildSidewalks(city: CityData): void {
    const geos: THREE.BufferGeometry[] = [];
    const sw = CITY.SIDEWALK;
    for (const b of city.blocks) {
      const w = b.w + sw * 2;
      const top = new THREE.BoxGeometry(w, 0.12, sw);
      top.translate(b.x + b.w / 2, 0, b.z - sw / 2);
      const bot = new THREE.BoxGeometry(w, 0.12, sw);
      bot.translate(b.x + b.w / 2, 0, b.z + b.d + sw / 2);
      const left = new THREE.BoxGeometry(sw, 0.12, b.d);
      left.translate(b.x - sw / 2, 0, b.z + b.d / 2);
      const right = new THREE.BoxGeometry(sw, 0.12, b.d);
      right.translate(b.x + b.w + sw / 2, 0, b.z + b.d / 2);
      geos.push(top, bot, left, right);
    }
    const mesh = new THREE.Mesh(
      mergeGeometries(geos),
      new THREE.MeshLambertMaterial({ map: tx.sidewalkTexture() }),
    );
    this.scene.add(mesh);
  }

  private buildBeach(city: CityData): void {
    const spanZ = GRID_SPAN_Z + 40;
    // promenade strip
    const prom = new THREE.Mesh(
      new THREE.BoxGeometry(CITY.PROM_END - CITY.SAND_END, 0.14, spanZ),
      new THREE.MeshLambertMaterial({ color: 0xcabfa8, map: tx.sidewalkTexture() }),
    );
    prom.position.set((CITY.SAND_END + CITY.PROM_END) / 2, 0, GRID_ORIGIN_Z + GRID_SPAN_Z / 2);
    this.scene.add(prom);

    // sand: subdivided plane following groundHeight down to the water
    const sandW = CITY.SAND_END - CITY.WATER_X + 10;
    const geo = new THREE.PlaneGeometry(sandW, spanZ, 24, 1);
    geo.rotateX(-Math.PI / 2);
    const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < posAttr.count; i++) {
      const wx = posAttr.getX(i) + (CITY.WATER_X - 10 + sandW / 2);
      posAttr.setY(i, groundHeight(wx, 0));
    }
    posAttr.needsUpdate = true;
    geo.computeVertexNormals();
    const sand = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tx.sandTexture() }));
    sand.position.set(CITY.WATER_X - 10 + sandW / 2, 0, GRID_ORIGIN_Z + GRID_SPAN_Z / 2);
    this.scene.add(sand);

    // ocean: shader with animated ripples, fresnel to sky, sun glint
    this.waterMat = new THREE.ShaderMaterial({
      transparent: true,
      uniforms: {
        uTime: { value: 0 },
        uDeep: { value: new THREE.Color(0x0e5a78) },
        uShallow: { value: new THREE.Color(0x2ba6c0) },
        uSky: { value: new THREE.Color(0xbfe3f2) },
        uSunDir: { value: new THREE.Vector3(0.4, 0.5, -0.3).normalize() },
        uSunColor: { value: new THREE.Color(0xffe9b0) },
      },
      vertexShader: `
        varying vec3 vWorld;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `
        varying vec3 vWorld;
        varying vec2 vUv;
        uniform float uTime;
        uniform vec3 uDeep, uShallow, uSky, uSunDir, uSunColor;
        void main() {
          // layered sine ripples -> a cheap normal
          vec2 p = vWorld.xz * 0.08;
          float w = sin(p.x * 1.7 + uTime * 1.1) * 0.5
                  + sin(p.y * 2.3 - uTime * 0.9) * 0.3
                  + sin((p.x + p.y) * 3.1 + uTime * 1.7) * 0.2;
          vec3 nrm = normalize(vec3(w * 0.35, 1.0, w * 0.25));
          vec3 viewDir = normalize(cameraPosition - vWorld);
          float fres = pow(1.0 - max(dot(viewDir, nrm), 0.0), 3.0);
          vec3 base = mix(uDeep, uShallow, clamp(w * 0.5 + 0.5, 0.0, 1.0));
          vec3 col = mix(base, uSky, fres * 0.7);
          // sun glint
          vec3 h = normalize(uSunDir + viewDir);
          float spec = pow(max(dot(nrm, h), 0.0), 120.0);
          col += uSunColor * spec * 2.0;
          gl_FragColor = vec4(col, 0.9);
        }`,
    });
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(600, spanZ + 600, 40, 40), this.waterMat);
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.set(CITY.WATER_X - 300, CITY.WATER_LEVEL, GRID_ORIGIN_Z + GRID_SPAN_Z / 2);
    this.scene.add(this.water);
  }

  private buildBuildings(city: CityData): void {
    // 4 quadrant batches so frustum culling can reject half the city
    const midX = GRID_ORIGIN_X + GRID_SPAN_X / 2;
    const midZ = GRID_ORIGIN_Z + GRID_SPAN_Z / 2;
    const batches: number[][] = [[], [], [], []];
    city.buildings.forEach((b, i) => {
      const cx = (b.box.minX + b.box.maxX) / 2;
      const cz = (b.box.minZ + b.box.maxZ) / 2;
      batches[(cx > midX ? 1 : 0) + (cz > midZ ? 2 : 0)].push(i);
    });

    const facade = tx.facadeTexture();
    const emissive = tx.facadeEmissiveTexture();
    const geo = new THREE.BoxGeometry(1, 1, 1);

    for (const idxs of batches) {
      if (!idxs.length) continue;
      const mat = new THREE.MeshLambertMaterial({
        map: facade,
        emissive: new THREE.Color(0xffffff),
        emissiveMap: emissive,
        emissiveIntensity: 0,
      });
      this.buildingMats.push(mat);
      const mesh = new THREE.InstancedMesh(geo, mat, idxs.length);
      const m = new THREE.Matrix4();
      idxs.forEach((bi, k) => {
        const b = city.buildings[bi];
        const w = b.box.maxX - b.box.minX;
        const h = b.box.maxY;
        const d = b.box.maxZ - b.box.minZ;
        m.makeScale(w, h, d);
        m.setPosition(b.box.minX + w / 2, h / 2, b.box.minZ + d / 2);
        mesh.setMatrixAt(k, m);
        mesh.setColorAt(k, new THREE.Color(b.color));
      });
      mesh.instanceMatrix.needsUpdate = true;
      this.shadowCasters.push(mesh);
      this.scene.add(mesh);
    }
  }

  private buildPalms(city: CityData): void {
    const palms = city.props.filter((p) => p.type === 'palm');
    if (!palms.length) return;

    const trunkGeo = new THREE.CylinderGeometry(0.14, 0.24, 5.5, 6);
    trunkGeo.translate(0, 2.75, 0);
    const trunks = new THREE.InstancedMesh(
      trunkGeo,
      new THREE.MeshLambertMaterial({ color: 0x9a7a52 }),
      palms.length,
    );

    // crown: two crossed alpha-tested planes
    const p1 = new THREE.PlaneGeometry(5, 5);
    p1.rotateX(-Math.PI / 2);
    const p2 = new THREE.PlaneGeometry(5, 5);
    p2.rotateX(-Math.PI / 2);
    p2.rotateY(Math.PI / 4);
    const crownGeo = mergeGeometries([p1, p2]);
    crownGeo.translate(0, 5.4, 0);
    const crowns = new THREE.InstancedMesh(
      crownGeo,
      new THREE.MeshLambertMaterial({
        map: tx.frondTexture(), alphaTest: 0.4, side: THREE.DoubleSide,
      }),
      palms.length,
    );

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    palms.forEach((p, i) => {
      q.setFromAxisAngle(up, p.rotY);
      m.compose(
        new THREE.Vector3(p.x, 0, p.z),
        q,
        new THREE.Vector3(p.scale, p.scale, p.scale),
      );
      trunks.setMatrixAt(i, m);
      crowns.setMatrixAt(i, m);
    });
    trunks.instanceMatrix.needsUpdate = true;
    crowns.instanceMatrix.needsUpdate = true;
    this.shadowCasters.push(trunks, crowns);
    this.scene.add(trunks, crowns);
  }

  private buildProps(city: CityData): void {
    const lamps = city.props.filter((p) => p.type === 'lamp');
    const benches = city.props.filter((p) => p.type === 'bench');
    const hydrants = city.props.filter((p) => p.type === 'hydrant');
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);

    if (lamps.length) {
      const poleGeo = new THREE.CylinderGeometry(0.08, 0.12, 5.6, 6);
      poleGeo.translate(0, 2.8, 0);
      const poles = new THREE.InstancedMesh(
        poleGeo, new THREE.MeshLambertMaterial({ color: 0x2f3a40 }), lamps.length,
      );
      const headGeo = new THREE.SphereGeometry(0.28, 8, 6);
      headGeo.translate(0, 5.6, 0);
      this.lampHeads = new THREE.InstancedMesh(
        headGeo,
        new THREE.MeshLambertMaterial({
          color: 0xfff2cc, emissive: 0xffd98a, emissiveIntensity: 0.2,
        }),
        lamps.length,
      );
      lamps.forEach((p, i) => {
        m.compose(new THREE.Vector3(p.x, 0, p.z), q.identity(), one);
        poles.setMatrixAt(i, m);
        this.lampHeads!.setMatrixAt(i, m);
      });
      poles.instanceMatrix.needsUpdate = true;
      this.lampHeads.instanceMatrix.needsUpdate = true;
      this.scene.add(poles, this.lampHeads);
    }

    if (benches.length) {
      const bGeo = new THREE.BoxGeometry(2, 0.5, 0.7);
      bGeo.translate(0, 0.35, 0);
      const mesh = new THREE.InstancedMesh(
        bGeo, new THREE.MeshLambertMaterial({ color: 0x7a5a3a }), benches.length,
      );
      benches.forEach((p, i) => {
        q.setFromAxisAngle(up, p.rotY);
        m.compose(new THREE.Vector3(p.x, 0, p.z), q, one);
        mesh.setMatrixAt(i, m);
      });
      mesh.instanceMatrix.needsUpdate = true;
      this.scene.add(mesh);
    }

    if (hydrants.length) {
      const hGeo = new THREE.CylinderGeometry(0.16, 0.2, 0.75, 8);
      hGeo.translate(0, 0.375, 0);
      const mesh = new THREE.InstancedMesh(
        hGeo, new THREE.MeshLambertMaterial({ color: 0xd23b2f }), hydrants.length,
      );
      hydrants.forEach((p, i) => {
        m.compose(new THREE.Vector3(p.x, 0, p.z), q.identity(), one);
        mesh.setMatrixAt(i, m);
      });
      mesh.instanceMatrix.needsUpdate = true;
      this.scene.add(mesh);
    }
  }
}
