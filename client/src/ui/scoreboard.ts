// Hold-Tab scoreboard fed by the server's 1Hz score broadcast.

export interface ScoreEntry {
  id: string;
  name: string;
  kills: number;
  deaths: number;
  ping: number;
}

export class Scoreboard {
  private root: HTMLDivElement;
  private entries: ScoreEntry[] = [];

  constructor(ui: HTMLElement, private myId: () => string) {
    this.root = document.createElement('div');
    this.root.id = 'scoreboard';
    this.root.style.display = 'none';
    ui.appendChild(this.root);
  }

  setEntries(entries: ScoreEntry[]): void {
    this.entries = [...entries].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    if (this.root.style.display !== 'none') this.render(); // live-refresh while held open
  }

  setVisible(v: boolean): void {
    if (v && this.root.style.display === 'none') this.render();
    this.root.style.display = v ? 'block' : 'none';
  }

  private render(): void {
    const me = this.myId();
    const rows = this.entries.map((e) => `
      <tr class="${e.id === me ? 'me' : ''}">
        <td>${escapeHtml(e.name)}</td><td>${e.kills}</td><td>${e.deaths}</td><td>${e.ping}ms</td>
      </tr>`).join('');
    this.root.innerHTML = `
      <table>
        <tr><th>player</th><th>kills</th><th>deaths</th><th>ping</th></tr>
        ${rows}
      </table>`;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
