// Main menu: name entry + join + controls. The smoke test drives
// #name-input and #join-btn, keep those ids stable.

export class Menu {
  private root: HTMLDivElement;
  private input: HTMLInputElement;
  private button: HTMLButtonElement;
  private error: HTMLDivElement;

  constructor(ui: HTMLElement, onJoin: (name: string) => void) {
    this.root = document.createElement('div');
    this.root.id = 'menu';
    this.root.innerHTML = `
      <div class="menu-panel">
        <h1>VICE&nbsp;COAST</h1>
        <p class="tagline">open-world multiplayer chaos, in your browser</p>
        <div class="menu-row">
          <input id="name-input" maxlength="16" placeholder="your name" autocomplete="off" />
          <button id="join-btn">DRIVE&nbsp;IN</button>
        </div>
        <div id="menu-error"></div>
        <table class="controls">
          <tr><td>WASD</td><td>move / drive</td><td>Shift</td><td>sprint</td></tr>
          <tr><td>Mouse</td><td>look</td><td>RMB</td><td>aim</td></tr>
          <tr><td>LMB</td><td>attack</td><td>1 / 2 / 3</td><td>fists / pistol / SMG</td></tr>
          <tr><td>E</td><td>enter / exit car</td><td>Space</td><td>jump / handbrake</td></tr>
          <tr><td>R</td><td>reload</td><td>T</td><td>chat</td></tr>
          <tr><td>Tab</td><td>scoreboard</td><td>M</td><td>mute</td></tr>
        </table>
        <p class="hint">keyboard + mouse required &middot; best in Chrome</p>
      </div>`;
    ui.appendChild(this.root);

    this.input = this.root.querySelector('#name-input')!;
    this.button = this.root.querySelector('#join-btn')!;
    this.error = this.root.querySelector('#menu-error')!;
    this.input.value = localStorage.getItem('vice-name') ?? '';

    const join = (): void => {
      const name = this.input.value.trim() || 'Tourist';
      localStorage.setItem('vice-name', name);
      this.button.disabled = true;
      this.button.textContent = 'CONNECTING…';
      onJoin(name);
    };
    this.button.addEventListener('click', join);
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') join();
      e.stopPropagation();
    });
    setTimeout(() => this.input.focus(), 0);
  }

  showError(message: string): void {
    this.error.textContent = message;
    this.button.disabled = false;
    this.button.textContent = 'DRIVE IN';
  }

  hide(): void {
    this.root.style.display = 'none';
  }

  show(): void {
    this.root.style.display = 'flex';
  }
}
