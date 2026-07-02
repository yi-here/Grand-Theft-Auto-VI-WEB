// Vice Coast client entry point: menu → connect → build world → game loop.

import * as THREE from 'three';
import {
  CITY, INTERP_DELAY_MS, RESPAWN_DELAY_MS, VEHICLES, VEHICLE_ENTER_DIST,
  WEAPONS, buildingBoxes, cityHash, generateCity, hashString, quantize,
  softPropBoxes, solidPropBoxes, SpatialGrid, groundHeight,
  type PlayerAnim, type PlayerRow, type VehicleRow, type NpcRow, type WelcomeMsg,
} from '@vice/shared';
import { Input } from './input.js';
import { Net } from './net/socket.js';
import { World } from './game/world.js';
import { SkySystem } from './render/sky.js';
import { glowTexture } from './render/textures.js';
import { LocalPlayer, VehicleObstacle } from './game/player.js';
import { ThirdPersonCamera } from './game/camera.js';
import { Avatar, animateAvatar, buildAvatar } from './game/avatar.js';
import { RemotePlayerManager } from './game/remotePlayers.js';
import { VehicleManager } from './game/vehicles.js';
import { NpcManager } from './game/npcs.js';
import { Combat } from './game/combat.js';
import { Effects } from './game/effects.js';
import { AudioManager } from './audio/audio.js';
import { injectStyles } from './ui/styles.js';
import { Menu } from './ui/menu.js';
import { Hud } from './ui/hud.js';
import { Minimap } from './ui/minimap.js';
import { Chat } from './ui/chat.js';
import { Scoreboard } from './ui/scoreboard.js';

const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');

injectStyles();

const canvas = document.getElementById('game') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLDivElement;

const renderer = new THREE.WebGLRenderer({
  canvas, antialias: false, preserveDrawingBuffer: DEBUG,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1200);
camera.position.set(20, 30, 200);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const input = new Input(canvas);
const net = new Net();
const audio = new AudioManager();

// ---------------------------------------------------------------- state
let playing = false;
let myId = '';
let myMode: 'foot' | 'drive' = 'foot';
let myHp = 100;
let dead = false;
let deadUntil = 0;
let lastRespawnAsk = 0;
let pendingEnter: string | null = null;
let wantedLevel = 0;
let seq = 0;
let sendAccum = 0;
let lastSpeed = 0;
let debugDayPhase: number | null = null;
const names = new Map<string, string>();

let world: World;
let sky: SkySystem;
let effects: Effects;
let localPlayer: LocalPlayer;
let localAvatar: Avatar;
let camCtrl: ThirdPersonCamera;
let remotes: RemotePlayerManager;
let vehicles: VehicleManager;
let npcs: NpcManager;
let combat: Combat;
let hud: Hud;
let minimap: Minimap;
let chat: Chat;
let scoreboard: Scoreboard;
let buildingGrid: SpatialGrid;

let started = false;
const menu = new Menu(uiRoot, (name) => {
  // A dropped session leaves a fully-built scene, Net handlers and DOM behind;
  // rebuilding on top would duplicate the world and stack handlers. Rejoining
  // after a disconnect requires a fresh page.
  if (started) {
    location.reload();
    return;
  }
  audio.init();
  net
    .connect(name)
    .then((welcome) => startGame(welcome))
    .catch((err: Error) => menu.showError(err.message || 'could not connect'));
});

function startGame(welcome: WelcomeMsg): void {
  const city = generateCity(welcome.seed);
  if (cityHash(city) !== welcome.cityHash) {
    menu.showError('city desync — client and server generated different worlds');
    return;
  }
  myId = welcome.id;
  names.set(myId, welcome.name);

  buildingGrid = new SpatialGrid(buildingBoxes(city));
  const solid = solidPropBoxes(city);
  const moveGrid = new SpatialGrid([...buildingBoxes(city), ...solid, ...softPropBoxes(city)]);
  const vehGrid = new SpatialGrid([...buildingBoxes(city), ...solid]);

  world = new World(scene, city);
  sky = new SkySystem(scene, glowTexture());
  effects = new Effects(scene);
  remotes = new RemotePlayerManager(scene);
  vehicles = new VehicleManager(scene, vehGrid);
  npcs = new NpcManager(scene);
  camCtrl = new ThirdPersonCamera(camera, buildingGrid);
  combat = new Combat(net, effects, buildingGrid, remotes, npcs);

  localPlayer = new LocalPlayer(moveGrid);
  localPlayer.spawnAt(welcome.spawn[0], welcome.spawn[1], welcome.spawn[2]);
  const h = hashString(myId + welcome.name);
  localAvatar = buildAvatar([0xe8506e, 0x37b5d6, 0xffd23f, 0x9a6ee8, 0x58c470, 0xf28c48, 0xf2f2f2, 0x4a6ae0][h % 8], h);
  scene.add(localAvatar.group);

  for (const p of welcome.players) {
    names.set(p.id, p.name);
    remotes.add(p);
  }
  for (const v of welcome.vehicles) vehicles.add(v);
  for (const n of welcome.npcs) npcs.add(n);

  hud = new Hud(uiRoot);
  minimap = new Minimap(uiRoot, city);
  chat = new Chat(uiRoot, input, (text) => net.send({ t: 'chat', text }));
  scoreboard = new Scoreboard(uiRoot, () => myId);

  vehicles.onCrash = (pos, intensity) => {
    effects.sparks(pos, intensity);
    camCtrl.addShake(intensity * 0.7);
    audio.crash(intensity);
  };
  combat.onFired = (weapon) => {
    if (weapon === 'fist') audio.punch();
    else audio.gunshot(weapon);
    camCtrl.pitch += weapon === 'smg' ? 0.006 : 0.012;
  };

  wireNetHandlers();
  menu.hide();
  hud.show();
  hud.setHealth(myHp);
  playing = true;
  started = true;
  input.requestLock();
}

if (DEBUG) exposeDebugHooks();

// ---------------------------------------------------------------- net
function wireNetHandlers(): void {
  net.on('playerJoined', (msg) => {
    if (msg.player.id === myId) return;
    names.set(msg.player.id, msg.player.name);
    remotes.add(msg.player);
  });
  net.on('playerLeft', (msg) => {
    remotes.remove(msg.id);
  });

  net.on('snapshot', (msg) => {
    for (const row of msg.players as PlayerRow[]) {
      if (row[0] === myId) continue;
      remotes.onSnapshotRow(row[0], msg.time, row[1], row[2], row[3], row[4], row[5] as PlayerAnim, row[6]);
    }
    for (const row of msg.vehicles as VehicleRow[]) {
      vehicles.onSnapshotRow(row[0], msg.time, row[1], row[2], row[3], row[4], row[5], row[6]);
      const v = vehicles.get(row[0]);
      if (v && row[0] !== vehicles.drivingId) v.driverId = row[6] || null;
    }
    for (const row of msg.npcs as NpcRow[]) {
      npcs.onSnapshotRow(row[0], msg.time, row[1], row[2], row[3], row[4]);
    }
  });

  net.on('hit', (msg) => {
    if (msg.targetId === myId) {
      myHp = msg.hp;
      hud.setHealth(myHp);
      hud.damageFlash();
      camCtrl.addShake(0.35);
      audio.crash(0.25);
    } else if (msg.attackerId === myId) {
      hud.showHitmarker();
      audio.hitFeedback();
    }
    effects.blood(new THREE.Vector3(msg.hitPos[0], msg.hitPos[1], msg.hitPos[2]));
  });

  net.on('death', (msg) => {
    const killer = msg.killerId ? names.get(msg.killerId) ?? '???' : null;
    const victim = names.get(msg.victimId) ?? '???';
    hud.addKill(killer ?? 'POLICE', msg.weapon, victim);
    if (msg.victimId === myId) {
      dead = true;
      localPlayer.dead = true;
      deadUntil = performance.now() + RESPAWN_DELAY_MS;
      myMode = 'foot';
      vehicles.drivingId = null;
      pendingEnter = null; // don't leave the enter-latch stuck if we died mid-request
      hud.showDeath(killer);
      hud.setWanted(0);
      wantedLevel = 0;
    }
  });

  net.on('respawned', (msg) => {
    if (msg.id === myId) {
      dead = false;
      localPlayer.spawnAt(msg.pos[0], msg.pos[1], msg.pos[2]);
      myHp = msg.hp;
      hud.setHealth(myHp);
      hud.hideDeath();
    } else {
      remotes.get(msg.id)?.buffer.reset();
    }
  });

  net.on('vehicleUpdate', (msg) => {
    const v = vehicles.get(msg.vehId);
    if (!v) return;
    const wasMine = vehicles.drivingId === msg.vehId;
    v.driverId = msg.driverId;

    if (msg.driverId === myId) {
      // I'm in — take over simulation
      vehicles.drivingId = msg.vehId;
      myMode = 'drive';
      pendingEnter = null;
      v.drive.speed = 0;
      v.drive.velX = 0;
      v.drive.velZ = 0;
      v.buffer.reset();
    } else if (wasMine) {
      // I'm out (normal exit or death eject)
      vehicles.drivingId = null;
      myMode = 'foot';
      if (msg.exitPos) {
        localPlayer.spawnAt(msg.exitPos[0], msg.exitPos[1], msg.exitPos[2]);
        localPlayer.hp = myHp;
        localPlayer.dead = dead;
      } else {
        localPlayer.pos.set(v.pos.x, groundHeight(v.pos.x, v.pos.z), v.pos.z);
      }
      audio.stopEngine('me');
    }
  });

  net.on('enterDenied', () => {
    pendingEnter = null;
  });

  net.on('chat', (msg) => {
    chat.addMessage(msg.name, msg.text, msg.system);
  });

  net.on('score', (msg) => {
    scoreboard.setEntries(msg.entries);
  });

  net.on('wanted', (msg) => {
    wantedLevel = msg.level;
    hud.setWanted(msg.level);
  });

  net.on('npcSpawn', (msg) => npcs.add(msg.npc));
  net.on('npcRemove', (msg) => npcs.remove(msg.id));

  net.onDisconnect = () => {
    playing = false;
    if (input.pointerLocked) document.exitPointerLock();
    menu.show();
    menu.showError('disconnected from server — click to reload & rejoin');
  };
}

// ---------------------------------------------------------------- loop
let lastT = performance.now();
let physAccum = 0;
const PHYS_STEP = 1 / 60;

function frame(): void {
  requestAnimationFrame(frame);
  const now = performance.now();
  const dt = Math.min((now - lastT) / 1000, 0.25);
  lastT = now;

  if (playing) {
    const renderTime = net.serverNow() - INTERP_DELAY_MS;
    const aiming = input.aimHeld && myMode === 'foot' && !dead;
    const drivenV = vehicles.drivingId ? vehicles.get(vehicles.drivingId) : null;
    let speed = drivenV ? drivenV.drive.speed : 0;

    // gather nearby obstacles once per frame
    const obstacles: VehicleObstacle[] = [];
    const others: { x: number; z: number; r: number }[] = [];
    if (myMode === 'foot') {
      for (const v of vehicles.vehicles.values()) {
        if (Math.abs(v.pos.x - localPlayer.pos.x) < 12 && Math.abs(v.pos.z - localPlayer.pos.z) < 12) {
          obstacles.push({
            x: v.pos.x, z: v.pos.z, yaw: v.yaw,
            halfW: v.spec.width / 2, halfL: v.spec.length / 2,
          });
        }
      }
    } else if (drivenV) {
      for (const v of vehicles.vehicles.values()) {
        if (v === drivenV) continue;
        if (Math.abs(v.pos.x - drivenV.pos.x) < 20 && Math.abs(v.pos.z - drivenV.pos.z) < 20) {
          others.push({ x: v.pos.x, z: v.pos.z, r: (v.spec.length + v.spec.width) / 4 });
        }
      }
      for (const n of npcs.npcs.values()) {
        if (n.info.ptype !== 'car') continue;
        if (Math.abs(n.group.position.x - drivenV.pos.x) < 20 && Math.abs(n.group.position.z - drivenV.pos.z) < 20) {
          others.push({ x: n.group.position.x, z: n.group.position.z, r: 1.4 });
        }
      }
    }

    // edge-buffer the jump once per render frame so a tap between frames
    // isn't lost when the physics substep loop polls the live key state
    if (myMode === 'foot' && input.wasPressed('Space')) localPlayer.queueJump();

    // fixed-timestep physics: sim speed stays correct even at low fps
    physAccum += dt;
    let steps = 0;
    while (physAccum >= PHYS_STEP && steps < 15) {
      if (myMode === 'foot') {
        localPlayer.update(PHYS_STEP, input, camCtrl.yaw, aiming, obstacles);
      } else if (drivenV && !dead) {
        speed = vehicles.updateLocal(PHYS_STEP, input, others);
      }
      physAccum -= PHYS_STEP;
      steps++;
    }
    if (physAccum >= PHYS_STEP) physAccum = 0; // dropped time on very slow frames

    if (myMode === 'foot') {
      if (input.wasPressed('KeyE') && !dead && !pendingEnter) {
        const target = vehicles.nearestEnterable(localPlayer.pos, VEHICLE_ENTER_DIST);
        if (target) {
          pendingEnter = target.info.id;
          net.send({ t: 'enterVehicle', vehId: target.info.id });
        }
      }
    } else if (drivenV) {
      localPlayer.pos.set(drivenV.pos.x, drivenV.pos.y, drivenV.pos.z);
      localPlayer.yaw = drivenV.yaw;
      if (input.wasPressed('KeyE') && Math.abs(speed) < 12) {
        net.send({ t: 'exitVehicle' });
      }
    }

    // camera follows player or vehicle
    const camTarget = drivenV ? drivenV.pos : localPlayer.pos;
    camCtrl.update(dt, input, camTarget, { aiming, driving: !!drivenV, speed: Math.abs(speed) });

    // combat
    const canShoot = myMode === 'foot' && !dead && input.pointerLocked && !input.chatOpen;
    combat.update(dt, input, canShoot, localPlayer.pos, localPlayer.yaw, camCtrl.getAimRay());

    // network send @20Hz
    sendAccum += dt;
    if (sendAccum >= 0.05) {
      sendAccum = 0;
      sendState(drivenV);
    }

    // remote entities
    remotes.update(dt, renderTime);
    vehicles.updateRemotes(dt, renderTime, camera.position);
    npcs.update(dt, renderTime, camera.position);

    // world/sky
    world.update(dt);
    sky.update(net.serverNow(), camera.position, debugDayPhase);
    world.setNight(sky.nightAmount);
    effects.update(dt);
    lastSpeed = Math.abs(speed);

    // local avatar
    localAvatar.group.visible = myMode === 'foot';
    if (myMode === 'foot') {
      localAvatar.group.position.set(localPlayer.pos.x, localPlayer.pos.y, localPlayer.pos.z);
      localAvatar.group.rotation.y = localPlayer.yaw;
      const hSpeed = Math.hypot(localPlayer.vel.x, localPlayer.vel.z);
      animateAvatar(localAvatar, dead ? 'dead' : localPlayer.anim, hSpeed, dt);
      if (combat.punchT > 0) localAvatar.armR.rotation.x = -1.6 * combat.punchT;
      audio.footsteps(dt, hSpeed, localPlayer.grounded);
    }

    updateShadows();
    updateEngineAudio(drivenV, speed);
    audio.updateAmbience(localPlayer.pos.x);

    // HUD
    hud.update(dt);
    hud.setAiming(aiming);
    hud.setWeapon(combat.weapon, combat.clip[combat.weapon] ?? 0, combat.reloading);
    hud.setSpeed(drivenV ? Math.abs(speed) * 3.6 : null);
    updatePrompt(drivenV);
    updateMinimap();
    scoreboard.setVisible(input.isDown('Tab'));

    if (input.wasPressed('KeyM')) audio.toggleMute();

    // death countdown + auto respawn ask
    if (dead) {
      const left = (deadUntil - now) / 1000;
      hud.setDeathCountdown(Math.max(0, left));
      if (left <= 0 && now - lastRespawnAsk > 800) {
        lastRespawnAsk = now;
        net.send({ t: 'respawn' });
      }
    }
  }

  renderer.render(scene, camera);
  input.endFrame();
}

function sendState(drivenV: ReturnType<VehicleManager['get']> | null): void {
  seq++;
  if (myMode === 'drive' && drivenV) {
    net.send({
      t: 'state', seq, mode: 'drive',
      pos: [quantize(drivenV.pos.x), quantize(drivenV.pos.y), quantize(drivenV.pos.z)],
      yaw: quantize(drivenV.yaw, 3),
      anim: 'idle',
      veh: {
        id: drivenV.info.id,
        pos: [quantize(drivenV.pos.x), quantize(drivenV.pos.y), quantize(drivenV.pos.z)],
        yaw: quantize(drivenV.yaw, 3),
        speed: quantize(drivenV.drive.speed, 1),
      },
    });
  } else {
    net.send({
      t: 'state', seq, mode: 'foot',
      pos: [quantize(localPlayer.pos.x), quantize(localPlayer.pos.y), quantize(localPlayer.pos.z)],
      yaw: quantize(localPlayer.yaw, 3),
      anim: localPlayer.anim,
    });
  }
}

function updatePrompt(drivenV: ReturnType<VehicleManager['get']> | null): void {
  if (dead) {
    hud.setPrompt('');
    return;
  }
  if (drivenV) {
    hud.setPrompt(Math.abs(drivenV.drive.speed) < 12 ? 'E — exit vehicle' : '');
    return;
  }
  const target = vehicles.nearestEnterable(localPlayer.pos, VEHICLE_ENTER_DIST);
  hud.setPrompt(target ? `E — enter ${VEHICLES[target.info.kind].name}` : '');
}

function updateMinimap(): void {
  const blips: Parameters<Minimap['update']>[2] = [
    { x: localPlayer.pos.x, z: localPlayer.pos.z, kind: 'self', yaw: localPlayer.yaw },
  ];
  for (const rp of remotes.players.values()) {
    if (rp.vehId) continue;
    blips.push({ x: rp.root.position.x, z: rp.root.position.z, kind: 'player' });
  }
  for (const v of vehicles.vehicles.values()) {
    blips.push({
      x: v.pos.x, z: v.pos.z,
      kind: v.info.kind === 'taxi' ? 'taxi' : v.info.kind === 'police' ? 'police' : 'vehicle',
    });
  }
  for (const n of npcs.npcs.values()) {
    if (n.info.kind === 'police') {
      blips.push({ x: n.group.position.x, z: n.group.position.z, kind: 'police' });
    }
  }
  minimap.update(localPlayer.pos.x, localPlayer.pos.z, blips);
}

function updateShadows(): void {
  const entries: { x: number; z: number; scale: number }[] = [];
  if (myMode === 'foot' && !dead) {
    entries.push({ x: localPlayer.pos.x, z: localPlayer.pos.z, scale: 1 });
  }
  for (const rp of remotes.players.values()) {
    if (!rp.vehId && rp.root.visible) entries.push({ x: rp.root.position.x, z: rp.root.position.z, scale: 1 });
  }
  for (const v of vehicles.vehicles.values()) {
    entries.push({ x: v.pos.x, z: v.pos.z, scale: v.spec.length * 0.75 });
  }
  for (const n of npcs.npcs.values()) {
    if (!n.group.visible) continue;
    entries.push({
      x: n.group.position.x, z: n.group.position.z,
      scale: n.info.ptype === 'car' ? 3.4 : 1,
    });
  }
  effects.updateShadows(entries);
}

function updateEngineAudio(drivenV: ReturnType<VehicleManager['get']> | null, mySpeed: number): void {
  const wanted = new Map<string, { ratio: number; throttle: number; dist: number; dx: number; dz: number }>();
  if (drivenV) {
    wanted.set('me', {
      ratio: Math.abs(mySpeed) / drivenV.spec.topSpeed,
      throttle: input.isDown('KeyW') ? 1 : 0,
      dist: 0, dx: 0, dz: 0,
    });
  }
  const candidates: { id: string; x: number; z: number; speed: number; top: number }[] = [];
  for (const v of vehicles.vehicles.values()) {
    if (v === drivenV || !v.driverId) continue;
    const s = (v.buffer.latest?.extra.speed as number) ?? 0;
    candidates.push({ id: v.info.id, x: v.pos.x, z: v.pos.z, speed: s, top: v.spec.topSpeed });
  }
  for (const n of npcs.npcs.values()) {
    if (n.info.ptype !== 'car' || !n.group.visible) continue;
    candidates.push({ id: n.info.id, x: n.group.position.x, z: n.group.position.z, speed: n.speedEst, top: 30 });
  }
  const px = localPlayer.pos.x;
  const pz = localPlayer.pos.z;
  candidates.sort((a, b) =>
    ((a.x - px) ** 2 + (a.z - pz) ** 2) - ((b.x - px) ** 2 + (b.z - pz) ** 2));
  for (const c of candidates.slice(0, 3)) {
    const dist = Math.hypot(c.x - px, c.z - pz);
    if (dist > 80) continue;
    wanted.set(c.id, {
      ratio: Math.min(1, Math.abs(c.speed) / c.top),
      throttle: 0.4, dist, dx: c.x - px, dz: c.z - pz,
    });
  }
  for (const id of audio.activeEngineIds()) {
    if (!wanted.has(id)) audio.stopEngine(id);
  }
  for (const [id, w] of wanted) {
    audio.updateEngine(id, w.ratio, w.throttle, w.dist, w.dx, w.dz, camCtrl.yaw);
  }
}

// ---------------------------------------------------------------- debug
function exposeDebugHooks(): void {
  (window as unknown as Record<string, unknown>).__game = {
    connected: () => net.connected && playing,
    myId: () => myId,
    remotePlayerIds: () => (remotes ? [...remotes.players.keys()] : []),
    pos: () => (localPlayer ? [localPlayer.pos.x, localPlayer.pos.y, localPlayer.pos.z] : null),
    remotePos: (id: string) => {
      const rp = remotes?.get(id);
      return rp ? [rp.root.position.x, rp.root.position.y, rp.root.position.z] : null;
    },
    drawCalls: () => renderer.info.render.calls,
    hp: () => myHp,
    mode: () => myMode,
    speed: () => lastSpeed,
    setCamYaw: (yaw: number) => { if (camCtrl) camCtrl.yaw = yaw; },
    setDayPhase: (p: number | null) => { debugDayPhase = p; },
    nearestVehicle: () => {
      if (!vehicles || !localPlayer) return null;
      let best: { id: string; x: number; z: number; dist: number } | null = null;
      for (const v of vehicles.vehicles.values()) {
        if (v.driverId) continue;
        const dist = Math.hypot(v.pos.x - localPlayer.pos.x, v.pos.z - localPlayer.pos.z);
        if (!best || dist < best.dist) best = { id: v.info.id, x: v.pos.x, z: v.pos.z, dist };
      }
      return best;
    },
    sampleCanvas: () => {
      const gl = renderer.getContext();
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      const samples: number[][] = [];
      const px = new Uint8Array(4);
      for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 8; j++) {
          gl.readPixels(
            Math.floor((w * (i + 0.5)) / 8), Math.floor((h * (j + 0.5)) / 8),
            1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px,
          );
          samples.push([px[0], px[1], px[2]]);
        }
      }
      return samples;
    },
  };
}

frame();
