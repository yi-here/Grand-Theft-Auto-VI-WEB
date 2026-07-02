// Global gameplay + world constants shared by client and server.
// Movement numbers live here so server-side validation clamps match
// client-side simulation exactly.

export const WORLD_SEED = 0x51ce_c0a5;

export const TICK_RATE = 20;
export const TICK_MS = 1000 / TICK_RATE;
export const SNAPSHOT_KEYFRAME_EVERY = 20; // full keyframe once per second
export const INTERP_DELAY_MS = 120;
export const DAY_CYCLE_SECONDS = 300;

// ---- player ----
export const PLAYER_RADIUS = 0.4;
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_EYE = 1.6;
export const WALK_SPEED = 4.5;
export const SPRINT_SPEED = 8.0;
export const JUMP_VELOCITY = 8.0;
export const GRAVITY = 25.0;
export const PLAYER_MAX_HP = 100;
export const RESPAWN_DELAY_MS = 4000;
export const SPAWN_PROTECT_MS = 2000;

// Validation tolerances (server side)
export const SPEED_TOLERANCE = 1.35;
export const MAX_TELEPORT = 12; // metres per state message before clamping

// ---- weapons ----
export interface WeaponSpec {
  name: string;
  damage: number;
  range: number;
  cooldownMs: number;
  clip: number; // 0 = melee, no clip
  reloadMs: number;
  spreadRad: number;
  auto: boolean;
}

export const WEAPONS: Record<string, WeaponSpec> = {
  fist: { name: 'Fists', damage: 10, range: 2.2, cooldownMs: 450, clip: 0, reloadMs: 0, spreadRad: 0, auto: false },
  pistol: { name: 'Pistol', damage: 20, range: 60, cooldownMs: 350, clip: 12, reloadMs: 1200, spreadRad: 0.009, auto: false },
  smg: { name: 'SMG', damage: 10, range: 40, cooldownMs: 90, clip: 30, reloadMs: 1600, spreadRad: 0.045, auto: true },
};
export type WeaponKind = 'fist' | 'pistol' | 'smg';

// ---- vehicles ----
export interface VehicleSpec {
  name: string;
  topSpeed: number; // m/s forward
  accel: number;
  brake: number;
  grip: number; // 0..1, higher = less drift
  steerGain: number; // rad/s at optimal speed
  length: number;
  width: number;
  height: number;
  colors: number[];
}

export const VEHICLES: Record<string, VehicleSpec> = {
  sports: {
    name: 'Sports', topSpeed: 42, accel: 14, brake: 30, grip: 0.92, steerGain: 2.4,
    length: 4.4, width: 1.9, height: 1.15,
    colors: [0xff4f79, 0x37d5d6, 0xffd23f, 0xb388ff, 0xff8c42],
  },
  sedan: {
    name: 'Sedan', topSpeed: 30, accel: 8, brake: 22, grip: 0.85, steerGain: 1.9,
    length: 4.6, width: 1.8, height: 1.45,
    colors: [0xc9d1d9, 0x8ba3b8, 0x6b7f95, 0xd9c8b4, 0x94b0a2],
  },
  taxi: {
    name: 'Taxi', topSpeed: 30, accel: 8, brake: 22, grip: 0.85, steerGain: 1.9,
    length: 4.6, width: 1.8, height: 1.45,
    colors: [0xffc531],
  },
  pickup: {
    name: 'Pickup', topSpeed: 26, accel: 7, brake: 20, grip: 0.8, steerGain: 1.6,
    length: 5.0, width: 2.0, height: 1.8,
    colors: [0xa3552f, 0x54636d, 0x74684a, 0x8a2f3c],
  },
  police: {
    name: 'Police', topSpeed: 36, accel: 11, brake: 26, grip: 0.9, steerGain: 2.2,
    length: 4.6, width: 1.8, height: 1.45,
    colors: [0xf2f5f7],
  },
};
export type VehicleKind = 'sports' | 'sedan' | 'taxi' | 'pickup' | 'police';

export const VEHICLE_ENTER_DIST = 3.2;
export const VEHICLE_EXIT_MAX_SPEED = 12;
export const ABANDON_FRICTION = 6; // m/s^2 decel for driverless rolling cars

// ---- NPCs ----
export const NPC_PED_COUNT = 24;
export const NPC_TRAFFIC_COUNT = 12;
export const PED_WALK_SPEED = 1.3;
export const TRAFFIC_SPEED = 8;
export const RUNOVER_MIN_SPEED = 4;

// ---- city layout ----
// Ocean occupies x < WATER_X. Sand ramp from WATER_X..SAND_END. Promenade,
// then the street grid eastward. All generation derives from these numbers.
export const CITY = {
  BLOCKS_X: 9,
  BLOCKS_Z: 7,
  BLOCK: 64,
  ROAD: 16, // total corridor width: 3m sidewalk + 10m asphalt + 3m sidewalk
  SIDEWALK: 3,
  WATER_X: 0,
  SAND_END: 40,
  PROM_END: 46, // promenade 40..46, first road corridor starts at 46
  WATER_LEVEL: -1.2,
  SAND_DIP: -1.5, // ground height at waterline
};

export const GRID_ORIGIN_X = CITY.PROM_END;
export const GRID_ORIGIN_Z = 0;
export const GRID_SPAN_X = CITY.BLOCKS_X * CITY.BLOCK + (CITY.BLOCKS_X + 1) * CITY.ROAD;
export const GRID_SPAN_Z = CITY.BLOCKS_Z * CITY.BLOCK + (CITY.BLOCKS_Z + 1) * CITY.ROAD;

export const WORLD_BOUNDS = {
  minX: -60,
  maxX: GRID_ORIGIN_X + GRID_SPAN_X + 20,
  minZ: -20,
  maxZ: GRID_ORIGIN_Z + GRID_SPAN_Z + 20,
};

export const BUILDING_PALETTES = [
  0xf7c8dc, // pink
  0xbfe8dd, // mint
  0xf9e9c8, // cream
  0xf4b8a0, // coral
  0xd8c8ee, // lavender
  0xbfe0f0, // aqua
  0xf5f2ea, // white
  0xf3d1a0, // sunset gold
];

export const POLICE_ENABLED = true;
export const WANTED_PED_KILL = 40;
export const WANTED_PLAYER_KILL = 25;
export const WANTED_DECAY_PER_SEC = 4;
export const WANTED_DECAY_GRACE_MS = 15000;
