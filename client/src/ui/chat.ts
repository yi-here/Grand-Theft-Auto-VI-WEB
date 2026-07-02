// Chat: message log + input line. Opening the input gates all game keys
// via input.chatOpen.

import type { Input } from '../input.js';

export class Chat {
  private log: HTMLDivElement;
  private inputEl: HTMLInputElement;

  constructor(
    ui: HTMLElement,
    private input: Input,
    onSend: (text: string) => void,
  ) {
    const wrap = document.createElement('div');
    wrap.id = 'chat';
    wrap.innerHTML = `<div id="chat-log"></div><input id="chat-input" maxlength="200" placeholder="press T to chat" />`;
    ui.appendChild(wrap);
    this.log = wrap.querySelector('#chat-log')!;
    this.inputEl = wrap.querySelector('#chat-input')!;
    this.inputEl.style.visibility = 'hidden';

    window.addEventListener('keydown', (e) => {
      if (this.input.chatOpen) {
        if (e.key === 'Enter') {
          const text = this.inputEl.value.trim();
          if (text) onSend(text);
          this.close();
          e.preventDefault();
        } else if (e.key === 'Escape') {
          this.close();
          e.preventDefault();
        }
        e.stopPropagation();
        return;
      }
      if ((e.code === 'KeyT' || e.code === 'Enter') && !this.input.chatOpen && this.gameActive()) {
        this.open();
        e.preventDefault();
      }
    });
  }

  gameActive = (): boolean => true; // replaced by main once joined

  private open(): void {
    this.input.chatOpen = true;
    this.inputEl.style.visibility = 'visible';
    this.inputEl.value = '';
    setTimeout(() => this.inputEl.focus(), 0);
  }

  private close(): void {
    this.input.chatOpen = false;
    this.inputEl.style.visibility = 'hidden';
    this.inputEl.value = '';
    this.inputEl.blur();
  }

  addMessage(name: string, text: string, system = false): void {
    const row = document.createElement('div');
    row.className = system ? 'chat-row system' : 'chat-row';
    if (system) {
      row.textContent = `· ${text}`;
    } else {
      const nameSpan = document.createElement('span');
      nameSpan.className = 'chat-name';
      nameSpan.textContent = name + ': ';
      row.appendChild(nameSpan);
      row.appendChild(document.createTextNode(text));
    }
    this.log.appendChild(row);
    while (this.log.children.length > 8) this.log.firstChild?.remove();
    row.animate?.([{ opacity: 1 }, { opacity: 1 }, { opacity: 0.25 }], { duration: 12000, fill: 'forwards' });
  }
}
