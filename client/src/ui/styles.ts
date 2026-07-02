// All UI styling injected once. Miami palette: hot pink + cyan on dark glass.

export function injectStyles(): void {
  const style = document.createElement('style');
  style.textContent = `
#ui > * { pointer-events: none; }

/* ---------- menu ---------- */
#menu {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  background: linear-gradient(180deg, #2b1055 0%, #7a2e6f 45%, #e8506e 80%, #f2a054 100%);
  pointer-events: auto;
}
.menu-panel {
  background: rgba(10, 8, 24, 0.82); border: 1px solid rgba(255,255,255,0.14);
  border-radius: 14px; padding: 34px 44px; text-align: center; color: #efeaf2;
  box-shadow: 0 22px 70px rgba(0,0,0,0.5); backdrop-filter: blur(6px);
}
.menu-panel h1 {
  font-size: 54px; letter-spacing: 10px; margin-bottom: 4px; font-weight: 800;
  background: linear-gradient(90deg, #ff4f79, #37d5d6);
  -webkit-background-clip: text; background-clip: text; color: transparent;
  text-shadow: 0 0 34px rgba(255, 79, 121, 0.35);
}
.tagline { color: #b8aec8; margin-bottom: 22px; font-size: 14px; letter-spacing: 1px; }
.menu-row { display: flex; gap: 10px; justify-content: center; margin-bottom: 10px; }
#name-input {
  background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.25);
  border-radius: 8px; padding: 12px 16px; color: #fff; font-size: 17px; width: 220px; outline: none;
}
#name-input:focus { border-color: #37d5d6; }
#join-btn {
  background: linear-gradient(90deg, #ff4f79, #ff7a54); color: #fff; border: none;
  border-radius: 8px; padding: 12px 26px; font-size: 17px; font-weight: 700;
  letter-spacing: 2px; cursor: pointer;
}
#join-btn:hover { filter: brightness(1.12); }
#join-btn:disabled { opacity: 0.6; cursor: wait; }
#menu-error { color: #ff8896; min-height: 20px; margin-bottom: 8px; font-size: 14px; }
.controls { margin: 12px auto 4px; border-collapse: collapse; font-size: 13px; color: #cfc6dc; }
.controls td { padding: 3px 12px; text-align: left; }
.controls td:nth-child(odd) { color: #37d5d6; font-weight: 700; text-align: right; }
.hint { color: #8d81a0; font-size: 12px; margin-top: 10px; }

/* ---------- HUD ---------- */
#hud { position: absolute; inset: 0; color: #fff; }
#health-wrap {
  position: absolute; left: 18px; bottom: 224px; width: 190px; height: 12px;
  background: rgba(0,0,0,0.55); border-radius: 6px; overflow: hidden;
  border: 1px solid rgba(255,255,255,0.25);
}
#health-fill { height: 100%; width: 100%; background: #4dd47a; transition: width 0.15s; }
#weapon {
  position: absolute; right: 18px; bottom: 18px; font-size: 19px; font-weight: 700;
  text-shadow: 0 2px 6px rgba(0,0,0,0.9); letter-spacing: 1px;
}
#speed {
  position: absolute; right: 18px; bottom: 48px; font-size: 15px; color: #9be8ee;
  text-shadow: 0 2px 6px rgba(0,0,0,0.9);
}
#wanted {
  position: absolute; top: 14px; right: 18px; font-size: 30px; color: #ffd23f;
  text-shadow: 0 0 12px rgba(255, 210, 63, 0.8);
}
#prompt {
  position: absolute; left: 50%; bottom: 30%; transform: translateX(-50%);
  font-size: 17px; text-shadow: 0 2px 8px rgba(0,0,0,0.95); color: #e8f6ff;
  background: rgba(0,0,0,0.35); padding: 4px 14px; border-radius: 6px;
}
#prompt:empty { display: none; }
#crosshair {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  font-size: 22px; display: none; color: rgba(255,255,255,0.9);
  text-shadow: 0 0 4px #000;
}
#hitmarker {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  font-size: 20px; color: #ffe08a; opacity: 0; text-shadow: 0 0 4px #000;
}
#vignette {
  position: absolute; inset: 0; opacity: 0;
  background: radial-gradient(ellipse at center, transparent 42%, rgba(200, 20, 40, 0.65) 100%);
}
#killfeed { position: absolute; top: 56px; right: 18px; text-align: right; font-size: 14px; }
.kill-row {
  background: rgba(0,0,0,0.5); margin-bottom: 4px; padding: 3px 10px; border-radius: 5px;
  border-right: 3px solid #ff4f79;
}
#death-screen {
  position: absolute; inset: 0; display: none; flex-direction: column; align-items: center;
  justify-content: center; background: rgba(20, 0, 10, 0.55);
}
#death-text {
  font-size: 74px; font-weight: 900; letter-spacing: 14px; color: #e0484d;
  text-shadow: 0 4px 30px rgba(0,0,0,0.9); font-style: italic;
}
#death-sub { font-size: 19px; color: #f0d8dc; margin-top: 8px; }
#death-timer { font-size: 15px; color: #b8a8ac; margin-top: 18px; }

/* ---------- minimap ---------- */
#minimap {
  position: absolute; left: 18px; bottom: 18px; width: 190px; height: 190px;
  border-radius: 10px; opacity: 0.94; box-shadow: 0 6px 24px rgba(0,0,0,0.55);
}

/* ---------- chat ---------- */
#chat { position: absolute; left: 18px; bottom: 246px; width: 340px; font-size: 13.5px; }
#chat-log { display: flex; flex-direction: column; justify-content: flex-end; }
.chat-row {
  color: #f2eef6; text-shadow: 0 1px 3px #000; margin-top: 2px;
  background: rgba(0,0,0,0.35); border-radius: 4px; padding: 2px 8px; width: fit-content;
  max-width: 100%; word-wrap: break-word;
}
.chat-row.system { color: #9fd8e0; font-style: italic; }
.chat-name { color: #37d5d6; font-weight: 700; }
#chat-input {
  pointer-events: auto; margin-top: 6px; width: 100%; padding: 6px 10px;
  background: rgba(0,0,0,0.65); color: #fff; border: 1px solid rgba(255,255,255,0.3);
  border-radius: 6px; outline: none; font-size: 13.5px;
}

/* ---------- scoreboard ---------- */
#scoreboard {
  position: absolute; left: 50%; top: 18%; transform: translateX(-50%);
  background: rgba(8, 6, 20, 0.88); border: 1px solid rgba(255,255,255,0.16);
  border-radius: 10px; padding: 14px 10px; min-width: 400px;
}
#scoreboard table { width: 100%; border-collapse: collapse; color: #efeaf2; font-size: 15px; }
#scoreboard th {
  color: #37d5d6; text-transform: uppercase; font-size: 12px; letter-spacing: 2px;
  padding: 4px 16px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.15);
}
#scoreboard td { padding: 6px 16px; }
#scoreboard tr.me td { color: #ffd23f; font-weight: 700; }

/* ---------- toast / banners ---------- */
#toast {
  position: absolute; left: 50%; top: 24%; transform: translateX(-50%);
  font-size: 22px; font-weight: 700; color: #ffd23f; text-shadow: 0 2px 10px #000;
  opacity: 0; transition: opacity 0.4s;
}
`;
  document.head.appendChild(style);
}
