// Snapshot interpolation for remote entities. States are buffered keyed by
// server snapshot time; render happens at (serverNow - INTERP_DELAY_MS).
// Extrapolation is capped, big errors snap, and explicit teleports reset.

import { angleLerp, lerp } from '@vice/shared';

export interface InterpState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** carried through un-lerped (anim names, speeds, flags) */
  extra: Record<string, unknown>;
}

const MAX_EXTRAPOLATE_MS = 120;
const SNAP_DIST = 6;

export class InterpBuffer {
  private states: { t: number; s: InterpState }[] = [];

  push(t: number, s: InterpState): void {
    const arr = this.states;
    if (arr.length && t <= arr[arr.length - 1].t) return; // out of order — drop
    // snap detection: huge jump means teleport, flush history
    if (arr.length) {
      const last = arr[arr.length - 1].s;
      const dx = s.x - last.x;
      const dz = s.z - last.z;
      if (dx * dx + dz * dz > SNAP_DIST * SNAP_DIST) arr.length = 0;
    }
    arr.push({ t, s });
    if (arr.length > 40) arr.splice(0, arr.length - 40);
  }

  reset(): void {
    this.states.length = 0;
  }

  get latest(): InterpState | null {
    return this.states.length ? this.states[this.states.length - 1].s : null;
  }

  sample(renderTime: number): InterpState | null {
    const arr = this.states;
    if (!arr.length) return null;
    if (renderTime <= arr[0].t) return arr[0].s;
    const newest = arr[arr.length - 1];
    if (renderTime >= newest.t) {
      // small extrapolation using the last two states, then freeze
      if (arr.length >= 2 && renderTime - newest.t < MAX_EXTRAPOLATE_MS) {
        const prev = arr[arr.length - 2];
        const span = newest.t - prev.t;
        if (span > 1) {
          const k = Math.min((renderTime - newest.t) / span, 1.5);
          return {
            x: newest.s.x + (newest.s.x - prev.s.x) * k,
            y: newest.s.y + (newest.s.y - prev.s.y) * k,
            z: newest.s.z + (newest.s.z - prev.s.z) * k,
            yaw: newest.s.yaw,
            extra: newest.s.extra,
          };
        }
      }
      return newest.s;
    }
    // find bracketing pair
    for (let i = arr.length - 2; i >= 0; i--) {
      if (arr[i].t <= renderTime) {
        const a = arr[i];
        const b = arr[i + 1];
        const k = (renderTime - a.t) / Math.max(1, b.t - a.t);
        return {
          x: lerp(a.s.x, b.s.x, k),
          y: lerp(a.s.y, b.s.y, k),
          z: lerp(a.s.z, b.s.z, k),
          yaw: angleLerp(a.s.yaw, b.s.yaw, k),
          extra: b.s.extra,
        };
      }
    }
    return arr[0].s;
  }
}
