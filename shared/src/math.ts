import { CITY } from './constants.js';

export interface AABB {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** shortest-arc angle interpolation — prevents cars visually spinning 350° */
export function angleLerp(a: number, b: number, t: number): number {
  return a + wrapAngle(b - a) * t;
}

export function dist2D(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

export function dist3D(a: readonly number[], b: readonly number[]): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function quantize(v: number, digits = 2): number {
  const m = 10 ** digits;
  return Math.round(v * m) / m;
}

/**
 * Ground height at (x, z). The city grid is flat at y=0; the beach ramps
 * down linearly from the end of the sand strip to the waterline. Used
 * identically by client rendering/physics and server checks.
 */
export function groundHeight(x: number, _z: number): number {
  if (x >= CITY.SAND_END) return 0;
  if (x <= CITY.WATER_X) return CITY.SAND_DIP;
  const t = (CITY.SAND_END - x) / (CITY.SAND_END - CITY.WATER_X);
  return CITY.SAND_DIP * t;
}

/**
 * Push a circle (x, z, r) out of an AABB (XZ plane). Returns the corrected
 * centre, or null when there is no overlap.
 */
export function resolveCircleAABB(
  x: number,
  z: number,
  r: number,
  box: AABB,
): { x: number; z: number } | null {
  const cx = clamp(x, box.minX, box.maxX);
  const cz = clamp(z, box.minZ, box.maxZ);
  const dx = x - cx;
  const dz = z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return null;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    const push = (r - d) / d;
    return { x: x + dx * push, z: z + dz * push };
  }
  // centre is inside the box — push out along the axis of least penetration
  const left = x - box.minX + r;
  const right = box.maxX - x + r;
  const near = z - box.minZ + r;
  const far = box.maxZ - z + r;
  const m = Math.min(left, right, near, far);
  if (m === left) return { x: box.minX - r, z };
  if (m === right) return { x: box.maxX + r, z };
  if (m === near) return { x, z: box.minZ - r };
  return { x, z: box.maxZ + r };
}

/** Slab-method ray vs AABB. Returns entry distance t (>= 0) or null. */
export function rayVsAABB(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  box: AABB,
  maxT: number,
): number | null {
  let tmin = 0;
  let tmax = maxT;
  const dims: [number, number, number, number][] = [
    [ox, dx, box.minX, box.maxX],
    [oy, dy, box.minY, box.maxY],
    [oz, dz, box.minZ, box.maxZ],
  ];
  for (const [o, d, lo, hi] of dims) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return null;
    } else {
      let t1 = (lo - o) / d;
      let t2 = (hi - o) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}

/**
 * Uniform spatial hash over static AABBs. Built once from CityData colliders
 * on both client (movement collision, camera occlusion) and server (shot LOS,
 * exit-position checks) — the same code so results agree.
 */
export class SpatialGrid {
  private cells = new Map<string, number[]>();
  readonly boxes: AABB[];
  constructor(boxes: AABB[], private cellSize = 32) {
    this.boxes = boxes;
    boxes.forEach((b, i) => {
      const x0 = Math.floor(b.minX / cellSize);
      const x1 = Math.floor(b.maxX / cellSize);
      const z0 = Math.floor(b.minZ / cellSize);
      const z1 = Math.floor(b.maxZ / cellSize);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cz = z0; cz <= z1; cz++) {
          const k = cx + ',' + cz;
          let arr = this.cells.get(k);
          if (!arr) this.cells.set(k, (arr = []));
          arr.push(i);
        }
      }
    });
  }

  /** indices of boxes near a circle */
  queryCircle(x: number, z: number, r: number): number[] {
    const out: number[] = [];
    const seen = new Set<number>();
    const x0 = Math.floor((x - r) / this.cellSize);
    const x1 = Math.floor((x + r) / this.cellSize);
    const z0 = Math.floor((z - r) / this.cellSize);
    const z1 = Math.floor((z + r) / this.cellSize);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const arr = this.cells.get(cx + ',' + cz);
        if (!arr) continue;
        for (const i of arr) {
          if (!seen.has(i)) {
            seen.add(i);
            out.push(i);
          }
        }
      }
    }
    return out;
  }

  /**
   * March a ray through the grid, returning nearest hit distance or null.
   * Uses Amanatides–Woo DDA over the XZ cell grid so EVERY cell the ray
   * crosses is visited (point-sampling skipped diagonal corner cells and
   * let bullets/camera pass through building corners). Buildings are
   * full-height, so 2D traversal over XZ is sufficient.
   */
  raycast(
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number,
    maxT: number,
  ): number | null {
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-9) return null;
    const nx = dx / len, ny = dy / len, nz = dz / len;
    const cs = this.cellSize;

    let cx = Math.floor(ox / cs);
    let cz = Math.floor(oz / cs);
    const stepX = nx > 0 ? 1 : -1;
    const stepZ = nz > 0 ? 1 : -1;

    // distance along the ray to the next cell boundary on each axis
    const tDeltaX = Math.abs(nx) < 1e-9 ? Infinity : Math.abs(cs / nx);
    const tDeltaZ = Math.abs(nz) < 1e-9 ? Infinity : Math.abs(cs / nz);
    const nextBoundaryX = (cx + (stepX > 0 ? 1 : 0)) * cs;
    const nextBoundaryZ = (cz + (stepZ > 0 ? 1 : 0)) * cs;
    let tMaxX = Math.abs(nx) < 1e-9 ? Infinity : (nextBoundaryX - ox) / nx;
    let tMaxZ = Math.abs(nz) < 1e-9 ? Infinity : (nextBoundaryZ - oz) / nz;

    let best: number | null = null;
    const tested = new Set<number>();
    let t = 0;
    // +2 guard iterations so the cell at the very end of the ray is tested
    for (let guard = 0; guard < 4096 && t <= maxT; guard++) {
      const arr = this.cells.get(cx + ',' + cz);
      if (arr) {
        for (const i of arr) {
          if (tested.has(i)) continue;
          tested.add(i);
          const hit = rayVsAABB(ox, oy, oz, nx, ny, nz, this.boxes[i], maxT);
          if (hit !== null && (best === null || hit < best)) best = hit;
        }
      }
      // once we have a hit closer than the current cell entry, nothing nearer remains
      if (best !== null && best <= t) break;
      if (tMaxX < tMaxZ) {
        t = tMaxX;
        tMaxX += tDeltaX;
        cx += stepX;
      } else {
        t = tMaxZ;
        tMaxZ += tDeltaZ;
        cz += stepZ;
      }
    }
    return best;
  }

  /**
   * Resolve a circle against all nearby boxes, iterating to settle corners.
   * Returns final position.
   */
  resolveCircle(x: number, z: number, r: number, iterations = 3): { x: number; z: number } {
    for (let it = 0; it < iterations; it++) {
      let moved = false;
      const near = this.queryCircle(x, z, r + 0.5);
      for (const i of near) {
        const res = resolveCircleAABB(x, z, r, this.boxes[i]);
        if (res) {
          x = res.x;
          z = res.z;
          moved = true;
        }
      }
      if (!moved) break;
    }
    return { x, z };
  }
}
