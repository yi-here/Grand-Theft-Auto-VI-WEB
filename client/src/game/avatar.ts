// Procedural humanoid built from boxes with pivot groups at shoulders and
// hips so walk/aim/death poses are simple rotations. Used for the local
// player, remote players and pedestrians.

import * as THREE from 'three';

export interface Avatar {
  group: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  head: THREE.Mesh;
  torso: THREE.Mesh;
  gun: THREE.Mesh;
  walkPhase: number;
  deadT: number;
}

const SKIN_TONES = [0xf0c8a0, 0xd9a066, 0xa0714f, 0x8a5a3b, 0xf5d7b8];
const PANTS = [0x2e3440, 0x4a3a2a, 0x35506a, 0x555555, 0x6a4a6a];

function box(w: number, h: number, d: number, color: number): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshLambertMaterial({ color }),
  );
  return m;
}

/** variant picks deterministic skin/pants from an id hash */
export function buildAvatar(shirtColor: number, variant = 0): Avatar {
  const skin = SKIN_TONES[Math.abs(variant) % SKIN_TONES.length];
  const pants = PANTS[Math.abs(variant * 7 + 3) % PANTS.length];
  const group = new THREE.Group();

  const torso = box(0.5, 0.55, 0.26, shirtColor);
  torso.position.y = 1.08;
  group.add(torso);

  const hips = box(0.44, 0.16, 0.24, pants);
  hips.position.y = 0.74;
  group.add(hips);

  const head = box(0.26, 0.28, 0.26, skin);
  head.position.y = 1.5;
  group.add(head);
  const hair = box(0.28, 0.1, 0.28, (variant * 2654435761) % 2 ? 0x2a2018 : 0x554433);
  hair.position.y = 1.66;
  group.add(hair);

  const mkArm = (side: number): THREE.Group => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.32, 1.32, 0);
    const upper = box(0.12, 0.32, 0.12, shirtColor);
    upper.position.y = -0.16;
    const lower = box(0.11, 0.3, 0.11, skin);
    lower.position.y = -0.46;
    pivot.add(upper, lower);
    group.add(pivot);
    return pivot;
  };
  const mkLeg = (side: number): THREE.Group => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.13, 0.68, 0);
    const leg = box(0.16, 0.62, 0.16, pants);
    leg.position.y = -0.32;
    const shoe = box(0.17, 0.09, 0.26, 0x222222);
    shoe.position.set(0, -0.64, 0.04);
    pivot.add(leg, shoe);
    group.add(pivot);
    return pivot;
  };

  const armL = mkArm(-1);
  const armR = mkArm(1);
  const legL = mkLeg(-1);
  const legR = mkLeg(1);

  // simple pistol held in the right hand, visible while aiming
  const gun = box(0.06, 0.12, 0.26, 0x1a1a1a);
  gun.position.set(0, -0.62, 0.14);
  gun.visible = false;
  armR.add(gun);

  return { group, armL, armR, legL, legR, head, torso, gun, walkPhase: 0, deadT: 0 };
}

/** speed drives swing; call every frame for anything alive */
export function animateAvatar(av: Avatar, anim: string, speed: number, dt: number): void {
  if (anim === 'dead') {
    av.deadT = Math.min(1, av.deadT + dt * 3);
    av.group.rotation.x = (-Math.PI / 2) * av.deadT;
    av.group.position.y = 0.2 * av.deadT;
    return;
  }
  if (av.deadT > 0) {
    av.deadT = 0;
    av.group.rotation.x = 0;
    av.group.position.y = 0;
  }

  const aiming = anim === 'aim';
  av.gun.visible = aiming;

  if (anim === 'walk' || anim === 'run') {
    av.walkPhase += dt * (anim === 'run' ? 11 : 6.5) * Math.max(0.4, Math.min(speed / 4, 2));
    const swing = Math.sin(av.walkPhase) * (anim === 'run' ? 0.9 : 0.55);
    av.legL.rotation.x = swing;
    av.legR.rotation.x = -swing;
    av.armL.rotation.x = -swing * 0.8;
    av.armR.rotation.x = aiming ? -Math.PI / 2 : swing * 0.8;
  } else if (anim === 'jump') {
    av.legL.rotation.x = -0.5;
    av.legR.rotation.x = 0.3;
    av.armL.rotation.x = -2.4;
    av.armR.rotation.x = -2.4;
  } else {
    // idle: soft sway
    av.walkPhase += dt * 1.5;
    const sway = Math.sin(av.walkPhase) * 0.04;
    av.legL.rotation.x = 0;
    av.legR.rotation.x = 0;
    av.armL.rotation.x = sway;
    av.armR.rotation.x = aiming ? -Math.PI / 2 : -sway;
  }
}
