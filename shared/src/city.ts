// Deterministic procedural city. Both client and server call
// generateCity(WORLD_SEED) and must produce bit-identical data — the server
// never sends geometry, only the seed plus a hash to verify agreement.
//
// Layout (top view, +X east, +Z south):
//   ocean | sand | promenade | [road][block][road][block]...[road]
// Ground is y=0 everywhere except the sand ramp (see groundHeight in math.ts).

import { AABB } from './math.js';
import { Rng } from './rng.js';
import {
  BUILDING_PALETTES, CITY, GRID_ORIGIN_X, GRID_ORIGIN_Z, VEHICLES, VehicleKind,
} from './constants.js';

export interface RectXZ { x: number; z: number; w: number; d: number }

export interface BuildingData {
  box: AABB;
  color: number;
  stepped: boolean; // art-deco stepped roofline (render-only detail)
}

export type PropType = 'palm' | 'lamp' | 'bench' | 'hydrant';
export interface PropData { type: PropType; x: number; z: number; rotY: number; scale: number }

export interface VehicleSpawn { kind: VehicleKind; x: number; z: number; yaw: number; color: number }

export interface CityData {
  seed: number;
  /** x centres of the vertical road corridors (run north-south) */
  roadsV: number[];
  /** z centres of the horizontal road corridors (run east-west) */
  roadsH: number[];
  blocks: RectXZ[];
  parks: RectXZ[];
  lots: RectXZ[];
  buildings: BuildingData[];
  props: PropData[];
  playerSpawns: [number, number][];
  vehicleSpawns: VehicleSpawn[];
}

function roadCenterX(i: number): number {
  return GRID_ORIGIN_X + i * (CITY.BLOCK + CITY.ROAD) + CITY.ROAD / 2;
}
function roadCenterZ(j: number): number {
  return GRID_ORIGIN_Z + j * (CITY.BLOCK + CITY.ROAD) + CITY.ROAD / 2;
}
function blockOrigin(i: number, j: number): { x: number; z: number } {
  return {
    x: GRID_ORIGIN_X + CITY.ROAD + i * (CITY.BLOCK + CITY.ROAD),
    z: GRID_ORIGIN_Z + CITY.ROAD + j * (CITY.BLOCK + CITY.ROAD),
  };
}

const q = (v: number) => Math.round(v * 100) / 100;

export function generateCity(seed: number): CityData {
  const rng = new Rng(seed);
  const data: CityData = {
    seed,
    roadsV: [],
    roadsH: [],
    blocks: [],
    parks: [],
    lots: [],
    buildings: [],
    props: [],
    playerSpawns: [],
    vehicleSpawns: [],
  };

  for (let i = 0; i <= CITY.BLOCKS_X; i++) data.roadsV.push(q(roadCenterX(i)));
  for (let j = 0; j <= CITY.BLOCKS_Z; j++) data.roadsH.push(q(roadCenterZ(j)));

  const centerX = GRID_ORIGIN_X + (CITY.BLOCKS_X * (CITY.BLOCK + CITY.ROAD)) * 0.62;
  const centerZ = GRID_ORIGIN_Z + (CITY.BLOCKS_Z * (CITY.BLOCK + CITY.ROAD)) * 0.5;
  const maxDist = CITY.BLOCKS_X * (CITY.BLOCK + CITY.ROAD) * 0.55;

  // ---- blocks: parks, parking lots, building parcels ----
  for (let i = 0; i < CITY.BLOCKS_X; i++) {
    for (let j = 0; j < CITY.BLOCKS_Z; j++) {
      const o = blockOrigin(i, j);
      const rect: RectXZ = { x: q(o.x), z: q(o.z), w: CITY.BLOCK, d: CITY.BLOCK };
      data.blocks.push(rect);
      const roll = rng.next();
      if (roll < 0.08) {
        data.parks.push(rect);
        const nPalms = rng.int(5, 9);
        for (let p = 0; p < nPalms; p++) {
          data.props.push({
            type: 'palm',
            x: q(rng.range(o.x + 4, o.x + CITY.BLOCK - 4)),
            z: q(rng.range(o.z + 4, o.z + CITY.BLOCK - 4)),
            rotY: q(rng.range(0, 6.28)),
            scale: q(rng.range(0.85, 1.3)),
          });
        }
        continue;
      }
      if (roll < 0.15) {
        data.lots.push(rect);
        // rows of parked cars inside the lot
        const rows = 2;
        for (let r = 0; r < rows; r++) {
          const zRow = o.z + 16 + r * 26;
          for (let c = 0; c < 5; c++) {
            if (rng.chance(0.45)) continue; // leave gaps
            const kind = rng.pick(['sedan', 'pickup', 'sports'] as VehicleKind[]);
            data.vehicleSpawns.push({
              kind,
              x: q(o.x + 8 + c * 11),
              z: q(zRow),
              yaw: q(rng.chance(0.5) ? 0 : Math.PI),
              color: rng.pick(VEHICLES[kind].colors),
            });
          }
        }
        continue;
      }

      // building parcels: px × pz grid inside the block
      const px = rng.int(2, 3);
      const pz = rng.int(2, 3);
      const pw = CITY.BLOCK / px;
      const pd = CITY.BLOCK / pz;
      for (let a = 0; a < px; a++) {
        for (let b = 0; b < pz; b++) {
          if (rng.chance(0.06)) continue; // vacant lot / courtyard
          const inset = 2 + rng.range(0, 1.5);
          const bx = o.x + a * pw + inset;
          const bz = o.z + b * pd + inset;
          const bw = pw - inset * 2;
          const bd = pd - inset * 2;
          const cx = bx + bw / 2;
          const cz = bz + bd / 2;
          const dx = cx - centerX;
          const dz = cz - centerZ;
          const falloff = Math.max(0, 1 - Math.sqrt(dx * dx + dz * dz) / maxDist);
          let h = 6 + rng.range(0, 6) + falloff * falloff * rng.range(10, 46);
          if (i === 0) h = 6 + rng.range(0, 8); // low-rise beachfront hotels
          data.buildings.push({
            box: {
              minX: q(bx), minY: 0, minZ: q(bz),
              maxX: q(bx + bw), maxY: q(h), maxZ: q(bz + bd),
            },
            color: rng.pick(BUILDING_PALETTES),
            stepped: rng.chance(0.35),
          });
        }
      }
    }
  }

  // ---- promenade palms + lamps along the beach ----
  const promX = (CITY.SAND_END + CITY.PROM_END) / 2;
  const spanZ = CITY.BLOCKS_Z * (CITY.BLOCK + CITY.ROAD) + CITY.ROAD;
  for (let z = 8; z < spanZ - 4; z += 10) {
    data.props.push({
      type: 'palm',
      x: q(promX + rng.range(-1, 1)),
      z: q(z + rng.range(-2, 2)),
      rotY: q(rng.range(0, 6.28)),
      scale: q(rng.range(0.9, 1.35)),
    });
  }
  // a few palms scattered on the sand
  for (let p = 0; p < 14; p++) {
    data.props.push({
      type: 'palm',
      x: q(rng.range(CITY.WATER_X + 14, CITY.SAND_END - 4)),
      z: q(rng.range(6, spanZ - 6)),
      rotY: q(rng.range(0, 6.28)),
      scale: q(rng.range(0.8, 1.2)),
    });
  }

  // ---- street lamps at intersection corners ----
  for (let i = 0; i <= CITY.BLOCKS_X; i++) {
    for (let j = 0; j <= CITY.BLOCKS_Z; j++) {
      if ((i + j) % 2 !== 0) continue; // every other corner keeps count sane
      const x = roadCenterX(i);
      const z = roadCenterZ(j);
      const off = CITY.ROAD / 2 - CITY.SIDEWALK / 2;
      data.props.push({ type: 'lamp', x: q(x + off), z: q(z + off), rotY: 0, scale: 1 });
      data.props.push({ type: 'lamp', x: q(x - off), z: q(z - off), rotY: 0, scale: 1 });
    }
  }

  // ---- benches + hydrants on sidewalks ----
  for (let k = 0; k < 40; k++) {
    const i = rng.int(0, CITY.BLOCKS_X - 1);
    const j = rng.int(0, CITY.BLOCKS_Z - 1);
    const o = blockOrigin(i, j);
    const side = rng.int(0, 3);
    const t = rng.range(6, CITY.BLOCK - 6);
    const off = 1.5; // just outside the block edge, on the sidewalk
    let x = o.x, z = o.z, rotY = 0;
    if (side === 0) { x = o.x + t; z = o.z - off; rotY = 0; }
    else if (side === 1) { x = o.x + t; z = o.z + CITY.BLOCK + off; rotY = Math.PI; }
    else if (side === 2) { x = o.x - off; z = o.z + t; rotY = Math.PI / 2; }
    else { x = o.x + CITY.BLOCK + off; z = o.z + t; rotY = -Math.PI / 2; }
    data.props.push({
      type: rng.chance(0.6) ? 'bench' : 'hydrant',
      x: q(x), z: q(z), rotY: q(rotY), scale: 1,
    });
  }

  // ---- player spawn points: sidewalk corners of blocks, spread out ----
  const spawnBlocks: [number, number][] = [];
  for (let i = 0; i < CITY.BLOCKS_X; i += 2) {
    for (let j = 0; j < CITY.BLOCKS_Z; j += 2) spawnBlocks.push([i, j]);
  }
  for (const [i, j] of spawnBlocks) {
    const o = blockOrigin(i, j);
    data.playerSpawns.push([q(o.x - CITY.SIDEWALK / 2 - 1), q(o.z + rng.range(8, CITY.BLOCK - 8))]);
  }
  // plus a couple on the beach promenade
  data.playerSpawns.push([q(CITY.PROM_END - 2), q(spanZ * 0.3)]);
  data.playerSpawns.push([q(CITY.PROM_END - 2), q(spanZ * 0.7)]);

  // ---- curbside vehicle spawns ----
  for (let k = 0; k < 22; k++) {
    const vertical = rng.chance(0.5);
    if (vertical) {
      const i = rng.int(0, CITY.BLOCKS_X);
      const x = roadCenterX(i);
      const z = rng.range(GRID_ORIGIN_Z + CITY.ROAD + 8, GRID_ORIGIN_Z + spanZ - CITY.ROAD - 8);
      const side = rng.chance(0.5) ? 1 : -1;
      const kind = pickCurbKind(rng, i);
      data.vehicleSpawns.push({
        kind,
        x: q(x + side * 3.7),
        z: q(z),
        yaw: q(side > 0 ? 0 : Math.PI), // parked along the road direction
        color: rng.pick(VEHICLES[kind].colors),
      });
    } else {
      const j = rng.int(0, CITY.BLOCKS_Z);
      const z = roadCenterZ(j);
      const x = rng.range(GRID_ORIGIN_X + CITY.ROAD + 8, GRID_ORIGIN_X + CITY.BLOCKS_X * (CITY.BLOCK + CITY.ROAD) - 8);
      const side = rng.chance(0.5) ? 1 : -1;
      const kind = pickCurbKind(rng, 4);
      data.vehicleSpawns.push({
        kind,
        x: q(x),
        z: q(z + side * 3.7),
        yaw: q(side > 0 ? Math.PI / 2 : -Math.PI / 2),
        color: rng.pick(VEHICLES[kind].colors),
      });
    }
  }

  return data;
}

function pickCurbKind(rng: Rng, roadIndex: number): VehicleKind {
  if (roadIndex <= 1) {
    // beach side: sports cars and taxis
    return rng.chance(0.6) ? 'sports' : 'taxi';
  }
  const r = rng.next();
  if (r < 0.25) return 'taxi';
  if (r < 0.5) return 'sports';
  if (r < 0.8) return 'sedan';
  return 'pickup';
}

/** Solid-world AABBs that block movement, bullets and camera: buildings. */
export function buildingBoxes(city: CityData): AABB[] {
  return city.buildings.map((b) => b.box);
}

/** Thin obstacles (palm trunks, lamp poles) — vehicles and players collide. */
export function solidPropBoxes(city: CityData): AABB[] {
  const out: AABB[] = [];
  for (const p of city.props) {
    if (p.type === 'palm') {
      const r = 0.28 * p.scale;
      out.push({ minX: p.x - r, minY: 0, minZ: p.z - r, maxX: p.x + r, maxY: 7 * p.scale, maxZ: p.z + r });
    } else if (p.type === 'lamp') {
      out.push({ minX: p.x - 0.14, minY: 0, minZ: p.z - 0.14, maxX: p.x + 0.14, maxY: 6, maxZ: p.z + 0.14 });
    }
  }
  return out;
}

/** Small street furniture — players only (vehicles roll over/through). */
export function softPropBoxes(city: CityData): AABB[] {
  const out: AABB[] = [];
  for (const p of city.props) {
    if (p.type === 'bench') {
      out.push({ minX: p.x - 1, minY: 0, minZ: p.z - 0.4, maxX: p.x + 1, maxY: 0.9, maxZ: p.z + 0.4 });
    } else if (p.type === 'hydrant') {
      out.push({ minX: p.x - 0.25, minY: 0, minZ: p.z - 0.25, maxX: p.x + 0.25, maxY: 0.8, maxZ: p.z + 0.25 });
    }
  }
  return out;
}

/**
 * FNV-1a over every quantized coordinate. Sent by the server in `welcome`;
 * the client hard-fails on mismatch so determinism drift is caught in the
 * first second of a session instead of surfacing as ghost collisions.
 */
export function cityHash(city: CityData): number {
  let h = 0x811c9dc5;
  const mix = (v: number) => {
    // quantize to centimetres, fold into 32-bit int
    let x = Math.round(v * 100) | 0;
    h ^= x & 0xff; h = Math.imul(h, 0x01000193);
    h ^= (x >>> 8) & 0xff; h = Math.imul(h, 0x01000193);
    h ^= (x >>> 16) & 0xff; h = Math.imul(h, 0x01000193);
    h ^= (x >>> 24) & 0xff; h = Math.imul(h, 0x01000193);
  };
  for (const b of city.buildings) {
    mix(b.box.minX); mix(b.box.minZ); mix(b.box.maxX); mix(b.box.maxZ); mix(b.box.maxY);
    mix(b.color);
  }
  for (const p of city.props) { mix(p.x); mix(p.z); }
  for (const s of city.playerSpawns) { mix(s[0]); mix(s[1]); }
  for (const v of city.vehicleSpawns) { mix(v.x); mix(v.z); mix(v.yaw); mix(v.color); }
  return h >>> 0;
}
