// Every texture in the game is generated here at runtime on a canvas —
// no image assets. Textures are grayscale-ish where they get tinted by
// instance colors (building facades) and colored where standalone.

import * as THREE from 'three';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function tex(c: HTMLCanvasElement, repeat = 1): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Light facade with a dark window grid; tinted per instance. */
export function facadeTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#e8e2d8';
  g.fillRect(0, 0, 256, 256);
  // subtle vertical banding
  for (let x = 0; x < 256; x += 32) {
    g.fillStyle = x % 64 === 0 ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.04)';
    g.fillRect(x, 0, 16, 256);
  }
  // window grid: 6 cols x 8 rows
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 6; col++) {
      const x = 12 + col * 40;
      const y = 10 + row * 30;
      g.fillStyle = 'rgba(30,40,60,0.85)';
      g.fillRect(x, y, 24, 18);
      g.fillStyle = 'rgba(180,210,235,0.35)'; // glass sheen
      g.fillRect(x + 2, y + 2, 9, 6);
    }
  }
  // base darkening (street level grime)
  const grad = g.createLinearGradient(0, 256, 0, 200);
  grad.addColorStop(0, 'rgba(30,25,35,0.45)');
  grad.addColorStop(1, 'rgba(30,25,35,0)');
  g.fillStyle = grad;
  g.fillRect(0, 200, 256, 56);
  return tex(c);
}

/** Same window grid but only lit windows on black — used as emissiveMap. */
export function facadeEmissiveTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#000';
  g.fillRect(0, 0, 256, 256);
  let seed = 1234567;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 6; col++) {
      if (rnd() < 0.42) {
        const x = 12 + col * 40;
        const y = 10 + row * 30;
        const warm = rnd() < 0.75;
        g.fillStyle = warm ? '#ffd98a' : '#9fe8ff';
        g.fillRect(x, y, 24, 18);
      }
    }
  }
  const t = tex(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

export function asphaltTexture(vertical: boolean): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#33343c';
  g.fillRect(0, 0, 128, 128);
  // speckle
  for (let i = 0; i < 500; i++) {
    const x = (i * 37) % 128;
    const y = (i * 71 + ((i * i) % 13)) % 128;
    g.fillStyle = i % 3 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.06)';
    g.fillRect(x, y, 2, 2);
  }
  // dashed centre line + solid edges, along the given axis
  g.fillStyle = '#d8c66a';
  if (vertical) {
    for (let y = 0; y < 128; y += 32) g.fillRect(62, y, 4, 18);
    g.fillStyle = 'rgba(230,230,230,0.5)';
    g.fillRect(4, 0, 3, 128);
    g.fillRect(121, 0, 3, 128);
  } else {
    for (let x = 0; x < 128; x += 32) g.fillRect(x, 62, 18, 4);
    g.fillStyle = 'rgba(230,230,230,0.5)';
    g.fillRect(0, 4, 128, 3);
    g.fillRect(0, 121, 128, 3);
  }
  return tex(c);
}

export function sidewalkTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(64, 64);
  g.fillStyle = '#9b968c';
  g.fillRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(0,0,0,0.18)';
  g.lineWidth = 2;
  g.strokeRect(0, 0, 64, 64);
  g.fillStyle = 'rgba(255,255,255,0.05)';
  g.fillRect(4, 4, 26, 26);
  g.fillRect(34, 34, 26, 26);
  return tex(c, 8);
}

export function concreteTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(64, 64);
  g.fillStyle = '#8f8a82';
  g.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 200; i++) {
    const x = (i * 23) % 64;
    const y = (i * 41) % 64;
    g.fillStyle = i % 2 ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.05)';
    g.fillRect(x, y, 2, 2);
  }
  return tex(c, 16);
}

export function sandTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#e8d5a3';
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 900; i++) {
    const x = (i * 37 + i * i) % 128;
    const y = (i * 53) % 128;
    g.fillStyle = i % 3 ? 'rgba(255,255,255,0.05)' : 'rgba(160,130,80,0.08)';
    g.fillRect(x, y, 1, 1);
  }
  return tex(c, 12);
}

export function grassTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(64, 64);
  g.fillStyle = '#69a05e';
  g.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 400; i++) {
    const x = (i * 29) % 64;
    const y = (i * 47) % 64;
    g.fillStyle = i % 2 ? 'rgba(255,255,200,0.06)' : 'rgba(0,60,0,0.08)';
    g.fillRect(x, y, 2, 1);
  }
  return tex(c, 10);
}

export function waterTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  const grad = g.createLinearGradient(0, 0, 256, 256);
  grad.addColorStop(0, '#2a9db8');
  grad.addColorStop(0.5, '#1f86ad');
  grad.addColorStop(1, '#2a9db8');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(255,255,255,0.14)';
  g.lineWidth = 2;
  for (let i = 0; i < 14; i++) {
    g.beginPath();
    const y = 10 + i * 18;
    for (let x = 0; x <= 256; x += 16) {
      const yy = y + Math.sin((x / 256) * Math.PI * 4 + i) * 5;
      if (x === 0) g.moveTo(x, yy);
      else g.lineTo(x, yy);
    }
    g.stroke();
  }
  return tex(c, 24);
}

/** palm frond: feathered leaf on alpha */
export function frondTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  g.clearRect(0, 0, 128, 128);
  g.save();
  g.translate(64, 64);
  for (let leaf = 0; leaf < 7; leaf++) {
    const ang = (leaf / 7) * Math.PI * 2;
    g.save();
    g.rotate(ang);
    g.fillStyle = leaf % 2 ? '#3f8f4a' : '#4da357';
    g.beginPath();
    g.moveTo(0, 0);
    g.quadraticCurveTo(18, -10, 58, -4);
    g.quadraticCurveTo(30, 6, 0, 4);
    g.closePath();
    g.fill();
    g.restore();
  }
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function blobShadowTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(64, 64);
  const grad = g.createRadialGradient(32, 32, 4, 32, 32, 30);
  grad.addColorStop(0, 'rgba(0,0,0,0.4)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export function glowTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(64, 64);
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,240,200,0.9)');
  grad.addColorStop(0.4, 'rgba(255,220,150,0.35)');
  grad.addColorStop(1, 'rgba(255,200,120,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export function muzzleTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(64, 64);
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 28);
  grad.addColorStop(0, 'rgba(255,255,230,1)');
  grad.addColorStop(0.3, 'rgba(255,210,110,0.8)');
  grad.addColorStop(1, 'rgba(255,140,40,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** floating name tag */
export function nameTexture(name: string): { texture: THREE.CanvasTexture; aspect: number } {
  const [c, g] = canvas(256, 64);
  g.font = 'bold 34px "Segoe UI", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = 'rgba(0,0,0,0.9)';
  g.shadowBlur = 6;
  g.fillStyle = '#ffffff';
  g.fillText(name.slice(0, 16), 128, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return { texture: t, aspect: 4 };
}
