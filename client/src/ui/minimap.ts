// Minimap: the static city layer is drawn once to an offscreen canvas at
// 1px/m straight from CityData, then a window around the player is blitted
// each frame with blips on top. North-up.

import {
  CITY, CityData, GRID_ORIGIN_X, GRID_ORIGIN_Z, GRID_SPAN_X, GRID_SPAN_Z,
} from '@vice/shared';

const SIZE = 190; // on-screen px
const VIEW = 170; // metres shown

export interface Blip {
  x: number;
  z: number;
  kind: 'self' | 'player' | 'vehicle' | 'taxi' | 'police';
  yaw?: number;
}

export class Minimap {
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private staticLayer: HTMLCanvasElement;
  private originX = -40;
  private originZ = -30;

  constructor(ui: HTMLElement, city: CityData) {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'minimap';
    this.canvas.width = SIZE;
    this.canvas.height = SIZE;
    ui.appendChild(this.canvas);
    this.g = this.canvas.getContext('2d')!;

    const w = Math.ceil(GRID_ORIGIN_X + GRID_SPAN_X + 60 - this.originX);
    const h = Math.ceil(GRID_ORIGIN_Z + GRID_SPAN_Z + 60 - this.originZ);
    this.staticLayer = document.createElement('canvas');
    this.staticLayer.width = w;
    this.staticLayer.height = h;
    this.renderStatic(city);
  }

  private renderStatic(city: CityData): void {
    const g = this.staticLayer.getContext('2d')!;
    const ox = -this.originX;
    const oz = -this.originZ;

    // ocean then sand then city base
    g.fillStyle = '#1f86ad';
    g.fillRect(0, 0, this.staticLayer.width, this.staticLayer.height);
    g.fillStyle = '#e8d5a3';
    g.fillRect(ox + CITY.WATER_X, 0, CITY.SAND_END - CITY.WATER_X + 6, this.staticLayer.height);
    g.fillStyle = '#8f8a82';
    g.fillRect(ox + CITY.PROM_END, 0, GRID_SPAN_X + 20, this.staticLayer.height);

    // blocks
    for (const b of city.blocks) {
      g.fillStyle = '#b6b0a6';
      g.fillRect(ox + b.x, oz + b.z, b.w, b.d);
    }
    for (const p of city.parks) {
      g.fillStyle = '#69a05e';
      g.fillRect(ox + p.x, oz + p.z, p.w, p.d);
    }
    for (const l of city.lots) {
      g.fillStyle = '#4a4b52';
      g.fillRect(ox + l.x, oz + l.z, l.w, l.d);
    }
    // roads over everything
    g.fillStyle = '#33343c';
    const asphalt = CITY.ROAD - CITY.SIDEWALK * 2;
    for (const x of city.roadsV) {
      g.fillRect(ox + x - asphalt / 2, oz + GRID_ORIGIN_Z, asphalt, GRID_SPAN_Z);
    }
    for (const z of city.roadsH) {
      g.fillRect(ox + GRID_ORIGIN_X, oz + z - asphalt / 2, GRID_SPAN_X, asphalt);
    }
    // buildings as slightly darker footprints
    g.fillStyle = 'rgba(60,55,70,0.35)';
    for (const b of city.buildings) {
      g.fillRect(ox + b.box.minX, oz + b.box.minZ, b.box.maxX - b.box.minX, b.box.maxZ - b.box.minZ);
    }
  }

  update(px: number, pz: number, blips: Blip[]): void {
    const g = this.g;
    const scale = SIZE / VIEW;
    g.clearRect(0, 0, SIZE, SIZE);

    const sx = px - this.originX - VIEW / 2;
    const sz = pz - this.originZ - VIEW / 2;
    g.drawImage(this.staticLayer, sx, sz, VIEW, VIEW, 0, 0, SIZE, SIZE);

    for (const b of blips) {
      const bx = (b.x - (px - VIEW / 2)) * scale;
      const bz = (b.z - (pz - VIEW / 2)) * scale;
      if (bx < -6 || bx > SIZE + 6 || bz < -6 || bz > SIZE + 6) continue;
      if (b.kind === 'self') {
        g.save();
        g.translate(bx, bz);
        g.rotate(b.yaw !== undefined ? -b.yaw : 0);
        g.fillStyle = '#ffffff';
        g.beginPath();
        g.moveTo(0, -6);
        g.lineTo(4.2, 5);
        g.lineTo(-4.2, 5);
        g.closePath();
        g.fill();
        g.restore();
      } else if (b.kind === 'player') {
        g.fillStyle = '#ff4055';
        g.beginPath();
        g.arc(bx, bz, 3.4, 0, Math.PI * 2);
        g.fill();
      } else {
        g.fillStyle = b.kind === 'taxi' ? '#ffc531' : b.kind === 'police' ? '#7ab8ff' : '#59d6e0';
        g.fillRect(bx - 2.6, bz - 2.6, 5.2, 5.2);
      }
    }
    // border ring
    g.strokeStyle = 'rgba(255,255,255,0.55)';
    g.lineWidth = 2;
    g.strokeRect(1, 1, SIZE - 2, SIZE - 2);
  }
}
