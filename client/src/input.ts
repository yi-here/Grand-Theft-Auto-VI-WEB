// Keyboard/mouse state. All game systems read through this so the chat box
// can suppress game input with a single gate.

export class Input {
  private keys = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  fireHeld = false;
  firePressed = false;
  aimHeld = false;
  pointerLocked = false;
  chatOpen = false;
  private pressedThisFrame = new Set<string>();

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (this.chatOpen) return;
      if (e.code === 'Tab') e.preventDefault();
      if (!e.repeat) this.pressedThisFrame.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    canvas.addEventListener('mousedown', (e) => {
      if (!this.pointerLocked) {
        this.requestLock();
        return;
      }
      if (e.button === 0) {
        this.fireHeld = true;
        this.firePressed = true;
      }
      if (e.button === 2) this.aimHeld = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.fireHeld = false;
      if (e.button === 2) this.aimHeld = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === canvas;
      if (!this.pointerLocked) {
        this.fireHeld = false;
        this.aimHeld = false;
      }
    });
    window.addEventListener('mousemove', (e) => {
      if (this.pointerLocked) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
    });
  }

  requestLock(): void {
    if (!this.pointerLocked) this.canvas.requestPointerLock();
  }

  isDown(code: string): boolean {
    return !this.chatOpen && this.keys.has(code);
  }

  /** true only on the frame the key went down */
  wasPressed(code: string): boolean {
    return !this.chatOpen && this.pressedThisFrame.has(code);
  }

  /** call at the END of each frame */
  endFrame(): void {
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.firePressed = false;
    this.pressedThisFrame.clear();
  }
}
