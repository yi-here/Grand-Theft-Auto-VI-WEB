// WebSocket wrapper: connect, typed dispatch, clock sync via ping/pong.

import type { ClientMsg, ServerMsg, WelcomeMsg } from '@vice/shared';

type Handler<T extends ServerMsg['t']> = (msg: Extract<ServerMsg, { t: T }>) => void;

export class Net {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, ((msg: ServerMsg) => void)[]>();
  connected = false;
  rtt = 0;
  /** serverTime - clientTime, smoothed */
  private timeOffset = 0;
  private offsetInit = false;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  onDisconnect: (() => void) | null = null;

  connect(name: string): Promise<WelcomeMsg> {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}/ws`;
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      const failTimer = setTimeout(() => reject(new Error('connection timed out')), 8000);
      ws.onopen = () => {
        this.send({ t: 'join', name });
      };
      ws.onmessage = (ev) => {
        let msg: ServerMsg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (msg.t === 'welcome' && !this.connected) {
          clearTimeout(failTimer);
          this.connected = true;
          this.timeOffset = msg.serverTime - Date.now();
          this.offsetInit = true;
          this.startPing();
          resolve(msg);
        }
        if (msg.t === 'pong') {
          this.rtt = performance.now() - msg.ts;
          const offset = msg.serverTime + this.rtt / 2 - Date.now();
          this.timeOffset = this.offsetInit ? this.timeOffset * 0.8 + offset * 0.2 : offset;
        }
        const list = this.handlers.get(msg.t);
        if (list) for (const h of list) h(msg);
      };
      ws.onclose = () => {
        clearTimeout(failTimer);
        if (!this.connected) reject(new Error('connection failed'));
        this.connected = false;
        if (this.pingTimer) clearInterval(this.pingTimer);
        this.onDisconnect?.();
      };
      ws.onerror = () => {
        // onclose follows and handles rejection
      };
    });
  }

  private startPing(): void {
    this.pingTimer = setInterval(() => {
      this.send({ t: 'ping', ts: performance.now(), rtt: Math.round(this.rtt) });
    }, 2000);
    this.send({ t: 'ping', ts: performance.now() });
  }

  on<T extends ServerMsg['t']>(type: T, handler: Handler<T>): void {
    let list = this.handlers.get(type);
    if (!list) this.handlers.set(type, (list = []));
    list.push(handler as (msg: ServerMsg) => void);
  }

  send(msg: ClientMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  /** current estimate of the server clock, ms */
  serverNow(): number {
    return Date.now() + this.timeOffset;
  }
}
