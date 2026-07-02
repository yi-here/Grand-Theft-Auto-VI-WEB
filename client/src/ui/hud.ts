// In-game HUD: health, weapon/ammo, crosshair, interact prompt, kill feed,
// damage vignette, wanted stars, death screen.

import { WEAPONS, WeaponKind } from '@vice/shared';

export class Hud {
  private root: HTMLDivElement;
  private healthFill: HTMLDivElement;
  private weaponEl: HTMLDivElement;
  private promptEl: HTMLDivElement;
  private crosshair: HTMLDivElement;
  private hitmarker: HTMLDivElement;
  private vignette: HTMLDivElement;
  private killfeed: HTMLDivElement;
  private deathScreen: HTMLDivElement;
  private deathText: HTMLDivElement;
  private deathTimer: HTMLDivElement;
  private wantedEl: HTMLDivElement;
  private speedEl: HTMLDivElement;
  private vignetteT = 0;
  private hitT = 0;

  constructor(ui: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.style.display = 'none';
    this.root.innerHTML = `
      <div id="health-wrap"><div id="health-fill"></div></div>
      <div id="weapon"></div>
      <div id="speed"></div>
      <div id="wanted"></div>
      <div id="prompt"></div>
      <div id="crosshair">+</div>
      <div id="hitmarker">✕</div>
      <div id="vignette"></div>
      <div id="killfeed"></div>
      <div id="death-screen">
        <div id="death-text">WASTED</div>
        <div id="death-sub"></div>
        <div id="death-timer"></div>
      </div>`;
    ui.appendChild(this.root);
    this.healthFill = this.root.querySelector('#health-fill')!;
    this.weaponEl = this.root.querySelector('#weapon')!;
    this.promptEl = this.root.querySelector('#prompt')!;
    this.crosshair = this.root.querySelector('#crosshair')!;
    this.hitmarker = this.root.querySelector('#hitmarker')!;
    this.vignette = this.root.querySelector('#vignette')!;
    this.killfeed = this.root.querySelector('#killfeed')!;
    this.deathScreen = this.root.querySelector('#death-screen')!;
    this.deathText = this.root.querySelector('#death-sub')!;
    this.deathTimer = this.root.querySelector('#death-timer')!;
    this.wantedEl = this.root.querySelector('#wanted')!;
    this.speedEl = this.root.querySelector('#speed')!;
  }

  show(): void {
    this.root.style.display = 'block';
  }

  setHealth(hp: number): void {
    const pct = Math.max(0, Math.min(100, hp));
    this.healthFill.style.width = pct + '%';
    this.healthFill.style.background = pct > 55 ? '#4dd47a' : pct > 25 ? '#e8c34d' : '#e0484d';
  }

  setWeapon(weapon: WeaponKind, clip: number, reloading: boolean): void {
    const spec = WEAPONS[weapon];
    if (spec.clip === 0) {
      this.weaponEl.textContent = spec.name;
    } else {
      this.weaponEl.textContent = `${spec.name}  ${reloading ? '…' : clip}/∞`;
    }
  }

  setSpeed(kmh: number | null): void {
    this.speedEl.textContent = kmh === null ? '' : `${Math.round(kmh)} km/h`;
  }

  setWanted(level: number): void {
    this.wantedEl.textContent = level > 0 ? '★'.repeat(level) : '';
  }

  setPrompt(text: string): void {
    this.promptEl.textContent = text;
  }

  setAiming(aiming: boolean): void {
    this.crosshair.style.display = aiming ? 'block' : 'none';
  }

  damageFlash(): void {
    this.vignetteT = 1;
  }

  showHitmarker(): void {
    this.hitT = 1;
  }

  addKill(killer: string, weapon: string | null, victim: string): void {
    const row = document.createElement('div');
    row.className = 'kill-row';
    row.textContent = killer ? `${killer}  [${weapon ?? '☠'}]  ${victim}` : `${victim} died`;
    this.killfeed.prepend(row);
    while (this.killfeed.children.length > 5) this.killfeed.lastChild?.remove();
    setTimeout(() => row.remove(), 6000);
  }

  showDeath(killerName: string | null): void {
    this.deathScreen.style.display = 'flex';
    this.deathText.textContent = killerName ? `taken out by ${killerName}` : 'the streets got you';
  }

  setDeathCountdown(seconds: number): void {
    this.deathTimer.textContent = seconds > 0 ? `respawn in ${seconds.toFixed(1)}` : 'respawning…';
  }

  hideDeath(): void {
    this.deathScreen.style.display = 'none';
  }

  update(dt: number): void {
    if (this.vignetteT > 0) {
      this.vignetteT = Math.max(0, this.vignetteT - dt * 2);
      this.vignette.style.opacity = String(this.vignetteT * 0.75);
    }
    if (this.hitT > 0) {
      this.hitT = Math.max(0, this.hitT - dt * 5);
      this.hitmarker.style.opacity = String(this.hitT);
    }
  }
}
