// Road network graph derived from the city grid. Used by the server to
// drive NPC traffic and pedestrian sidewalk loops; the client only renders
// what the snapshots say, so the graph itself never crosses the wire.

import { CITY, GRID_ORIGIN_X, GRID_ORIGIN_Z } from './constants.js';
import { Rng } from './rng.js';

export interface GraphNode { x: number; z: number }
export interface GraphEdge {
  from: number;
  to: number;
  /** lane centreline start/end, offset 2.5m to the right of travel */
  ax: number; az: number; bx: number; bz: number;
  len: number;
}

export interface RoadGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** outgoing edge indices per node */
  out: number[][];
}

const LANE_OFFSET = 2.5;

export function buildRoadGraph(): RoadGraph {
  const nodes: GraphNode[] = [];
  const nodeIdx = (i: number, j: number) => i * (CITY.BLOCKS_Z + 1) + j;
  for (let i = 0; i <= CITY.BLOCKS_X; i++) {
    for (let j = 0; j <= CITY.BLOCKS_Z; j++) {
      nodes.push({
        x: GRID_ORIGIN_X + i * (CITY.BLOCK + CITY.ROAD) + CITY.ROAD / 2,
        z: GRID_ORIGIN_Z + j * (CITY.BLOCK + CITY.ROAD) + CITY.ROAD / 2,
      });
    }
  }

  const edges: GraphEdge[] = [];
  const out: number[][] = nodes.map(() => []);
  const addEdge = (from: number, to: number) => {
    const a = nodes[from];
    const b = nodes[to];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    // right-hand traffic: shift the lane to the right of the travel direction
    const rx = -dz / len * LANE_OFFSET;
    const rz = dx / len * LANE_OFFSET;
    edges.push({ from, to, ax: a.x + rx, az: a.z + rz, bx: b.x + rx, bz: b.z + rz, len });
    out[from].push(edges.length - 1);
  };

  for (let i = 0; i <= CITY.BLOCKS_X; i++) {
    for (let j = 0; j <= CITY.BLOCKS_Z; j++) {
      const n = nodeIdx(i, j);
      if (i < CITY.BLOCKS_X) { addEdge(n, nodeIdx(i + 1, j)); addEdge(nodeIdx(i + 1, j), n); }
      if (j < CITY.BLOCKS_Z) { addEdge(n, nodeIdx(i, j + 1)); addEdge(nodeIdx(i, j + 1), n); }
    }
  }

  return { nodes, edges, out };
}

/** Pick the next edge at the end of `edgeIdx`; prefers continuing straight. */
export function nextEdge(graph: RoadGraph, edgeIdx: number, rng: Rng): number {
  const edge = graph.edges[edgeIdx];
  const options = graph.out[edge.to].filter((e) => graph.edges[e].to !== edge.from);
  if (options.length === 0) {
    // dead end: u-turn
    const back = graph.out[edge.to].find((e) => graph.edges[e].to === edge.from);
    return back ?? edgeIdx;
  }
  // weight straight continuation higher
  const dx = edge.bx - edge.ax;
  const dz = edge.bz - edge.az;
  let straight = -1;
  for (const e of options) {
    const o = graph.edges[e];
    const dot = (dx * (o.bx - o.ax) + dz * (o.bz - o.az)) / (edge.len * o.len);
    if (dot > 0.9) { straight = e; break; }
  }
  if (straight >= 0 && rng.chance(0.6)) return straight;
  return rng.pick(options);
}

/** Closed sidewalk rectangle around block (i, j) for pedestrian loops. */
export function sidewalkLoop(i: number, j: number): [number, number][] {
  const x0 = GRID_ORIGIN_X + CITY.ROAD + i * (CITY.BLOCK + CITY.ROAD) - 1.5;
  const z0 = GRID_ORIGIN_Z + CITY.ROAD + j * (CITY.BLOCK + CITY.ROAD) - 1.5;
  const s = CITY.BLOCK + 3;
  return [
    [x0, z0],
    [x0 + s, z0],
    [x0 + s, z0 + s],
    [x0, z0 + s],
  ];
}
