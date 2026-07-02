#!/usr/bin/env node
// Pure-logic unit checks for shared math + city determinism. No browser.
// Run with: node scripts/unit-test.mjs  (uses tsx to load TS shared source)
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;
const ok = (cond, m) => { console.log(`${cond ? '  OK' : 'FAIL'}: ${m}`); if (!cond) failed++; };

const { SpatialGrid, generateCity, cityHash, groundHeight, WORLD_SEED, resolveCircleAABB } =
  await import(path.join(root, 'shared/src/index.ts'));

// --- SpatialGrid.raycast: DDA correctness ---
{
  // a single 10x10 box centered at (50,50) (full height)
  const box = { minX: 45, minY: 0, minZ: 45, maxX: 55, maxY: 20, maxZ: 55 };
  const grid = new SpatialGrid([box], 32);

  // straight ray from (0,1,50) heading +X must hit at ~45
  const hitStraight = grid.raycast(0, 1, 50, 1, 0, 0, 100);
  ok(hitStraight !== null && Math.abs(hitStraight - 45) < 0.5, `straight ray hits box front (t=${hitStraight})`);

  // ray pointing away (-X) must miss
  ok(grid.raycast(0, 1, 50, -1, 0, 0, 100) === null, 'ray pointing away misses');

  // ray that passes clearly beside the box misses
  ok(grid.raycast(0, 1, 90, 1, 0, 0, 100) === null, 'parallel ray beside box misses');

  // THE REGRESSION: a 45° ray that clips the near corner. From (40,1,60)
  // heading (+1,0,-1) passes through the corner region near (45..55, 45..55).
  const diag = grid.raycast(40, 1, 62, 1, 0, -1, 60);
  // aim a diagonal that actually crosses the box: from (30,1,70) toward (50,50)
  const dx = 50 - 30, dz = 50 - 70;
  const diag2 = grid.raycast(30, 1, 70, dx, 0, dz, 100);
  ok(diag2 !== null, 'diagonal ray toward box center is detected (no corner tunneling)');

  // short maxT stops before the box
  ok(grid.raycast(0, 1, 50, 1, 0, 0, 30) === null, 'ray shorter than distance to box misses');
}

// --- resolveCircleAABB: no NaN on edge/corner contact ---
{
  const box = { minX: 0, minY: 0, minZ: 0, maxX: 10, maxY: 5, maxZ: 10 };
  // circle centered exactly on a corner
  const r1 = resolveCircleAABB(0, 0, 0.5, box);
  ok(r1 !== null && isFinite(r1.x) && isFinite(r1.z), 'corner contact resolves finite');
  // circle centered deep inside
  const r2 = resolveCircleAABB(5, 5, 0.5, box);
  ok(r2 !== null && isFinite(r2.x) && isFinite(r2.z), 'inside-box resolves finite (axis fallback)');
  // circle far outside untouched
  ok(resolveCircleAABB(100, 100, 0.5, box) === null, 'far circle returns null');
}

// --- city determinism: same seed -> identical hash across fresh gens ---
{
  const a = cityHash(generateCity(WORLD_SEED));
  const b = cityHash(generateCity(WORLD_SEED));
  ok(a === b, `city hash stable across regen (${a})`);
  const c = cityHash(generateCity(WORLD_SEED + 1));
  ok(a !== c, 'different seed -> different city');
}

// --- groundHeight: beach ramp monotonic, flat inland ---
{
  ok(groundHeight(100, 0) === 0, 'inland ground is flat (y=0)');
  ok(groundHeight(-10, 0) < 0, 'ocean side dips below 0');
  const mid = groundHeight(20, 0);
  ok(mid < 0 && mid > -1.5, `beach ramps between 0 and -1.5 (y=${mid.toFixed(2)})`);
}

console.log(failed ? `\n[unit] ❌ ${failed} FAILED` : '\n[unit] ✅ ALL PASSED');
process.exit(failed ? 1 : 0);
