export type MouseControlMode = 'locked' | 'drag' | 'paused';

type Callbacks = {
  onMode: (mode: MouseControlMode) => void;
  onLook: (dx: number, dy: number) => void;
  onPrimary: (held: boolean) => void;
  primaryDrag: () => boolean;
};

/** Pointer lock where available; click/hold editing and captured dragging elsewhere. */
export class PointerLook {
  private enabled = true;
  private currentMode: MouseControlMode = 'paused';
  private dragging = false;
  private pointerId: number | undefined;
  private pointerButton: number | undefined;
  private lastX = 0;
  private lastY = 0;
  private originX = 0;
  private originY = 0;
  private editCandidate = false;
  private activationPress = false;
  private heldEdit = false;
  private holdTimer: ReturnType<typeof setTimeout> | undefined;
  private lockedClient: { x: number; y: number } | undefined;
  private generation = 0;
  private removers: Array<() => void> = [];

  constructor(private canvas: HTMLCanvasElement, private callbacks: Callbacks) {
    this.listen(document, 'pointerlockchange', () => {
      if (!this.enabled) return;
      if (document.pointerLockElement === canvas) {
        if (!this.active) { document.exitPointerLock(); return; }
        // A lock may arrive while the activation/drag button is still held.
        // It must not convert that gesture into a destructive primary action.
        this.release();
        this.setMode('locked');
      }
      else if (this.currentMode === 'locked') this.stop();
    });
    this.listen(document, 'pointerlockerror', () => {
      if (this.enabled && this.active && document.pointerLockElement !== canvas) this.setMode('drag');
    });
    this.listen(canvas, 'contextmenu', e => e.preventDefault());
    this.listen(canvas, 'pointerdown', event => {
      if (!this.enabled) return;
      const e = event as PointerEvent;
      if (e.button !== 0 && e.button !== 2) return;
      if (this.pointerId !== undefined) {
        if (e.button !== 2 || e.pointerId !== this.pointerId) return;
        this.release();
      }
      canvas.focus();
      const wasActive = this.active;
      const primaryDrag = e.button === 0 && this.callbacks.primaryDrag();
      if (document.pointerLockElement !== canvas) {
        e.preventDefault();
        this.dragging = e.button === 2 || primaryDrag;
        this.editCandidate = e.button === 0 && !primaryDrag;
        this.activationPress = !wasActive;
        this.heldEdit = false;
        this.pointerId = e.pointerId;
        this.pointerButton = e.button;
        this.originX = this.lastX = e.clientX; this.originY = this.lastY = e.clientY;
        try { canvas.setPointerCapture(e.pointerId); } catch { /* Remote surfaces can omit capture. */ }
        this.setMode('drag');
        if (this.editCandidate && wasActive) {
          // Allow a deliberate stationary hold to repeat, but do not fire on
          // pointerdown: remote mouse/touch users must be able to drag to aim.
          this.holdTimer = setTimeout(() => {
            this.holdTimer = undefined;
            if (!this.enabled || !this.active || !this.editCandidate || this.dragging) return;
            this.heldEdit = true; this.callbacks.onPrimary(true);
          }, 350);
        }
        // A first left click can lock in a normal browser, while drag already works
        // during denial/pending permission. Right drag never needs a lock request.
        if (!wasActive && e.button === 0 && e.pointerType !== 'touch') void this.requestLock();
        return;
      }
      if (!wasActive) { void this.start(); return; }
      if (e.button === 0) this.callbacks.onPrimary(true);
    });
    this.listen(document, 'pointermove', event => {
      if (!this.enabled || !this.active) return;
      const e = event as PointerEvent;
      if (document.pointerLockElement === canvas) {
        let dx = e.movementX || 0, dy = e.movementY || 0;
        if (!dx && !dy && this.lockedClient) { dx = e.clientX - this.lockedClient.x; dy = e.clientY - this.lockedClient.y; }
        this.lockedClient = { x: e.clientX, y: e.clientY };
        this.callbacks.onLook(Math.max(-240, Math.min(240, dx)), Math.max(-240, Math.min(240, dy)));
      } else if (this.pointerId !== undefined && e.pointerId === this.pointerId) {
        // client positions work on remote desktops that report movementX as zero.
        let dx = e.clientX - this.lastX, dy = e.clientY - this.lastY;
        if (this.editCandidate && !this.dragging && Math.hypot(e.clientX-this.originX,e.clientY-this.originY) > 6) {
          this.editCandidate = false; this.dragging = true; this.clearHold();
          if (this.heldEdit) { this.heldEdit = false; this.callbacks.onPrimary(false); }
          dx = e.clientX-this.originX; dy = e.clientY-this.originY;
        }
        this.lastX = e.clientX; this.lastY = e.clientY;
        if (this.dragging) this.callbacks.onLook(Math.max(-240, Math.min(240, dx)), Math.max(-240, Math.min(240, dy)));
      }
    });
    this.listen(document, 'pointerup', event => {
      const e = event as PointerEvent;
      if (this.pointerId !== undefined && e.pointerId !== this.pointerId) return;
      if (this.pointerButton !== undefined && e.button !== this.pointerButton) return;
      // A short stationary click edits once on release. Cancelling/capture loss
      // never reaches this path, so a failed drag cannot accidentally explode.
      if (this.enabled && this.active && this.editCandidate && !this.activationPress && !this.heldEdit && !this.dragging) this.callbacks.onPrimary(true);
      this.release();
    });
    for (const name of ['pointercancel', 'lostpointercapture']) this.listen(document, name, event => {
      if (this.pointerId !== undefined && (event as PointerEvent).pointerId !== this.pointerId) return;
      this.release();
    });
    this.listen(window, 'blur', () => this.stop());
  }

  get mode(): MouseControlMode { return this.currentMode; }
  get active(): boolean { return this.currentMode !== 'paused'; }
  cancelPrimary(): void { this.release(); }

  async start(): Promise<void> {
    if (!this.enabled) return;
    this.canvas.focus();
    // Never leave keyboard/mouse control pending on an embedded browser promise.
    this.setMode(document.pointerLockElement === this.canvas ? 'locked' : 'drag');
    await this.requestLock();
  }

  stop(): void {
    this.generation++;
    this.release(); this.setMode('paused');
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    if (!enabled) this.stop();
    this.enabled = enabled;
  }

  dispose(): void { this.stop(); this.removers.forEach(remove => remove()); }

  private async requestLock(): Promise<void> {
    const token = ++this.generation;
    try { await this.canvas.requestPointerLock?.(); } catch { /* Drag is already active. */ }
    if (token !== this.generation || !this.enabled || !this.active) return;
    this.setMode(document.pointerLockElement === this.canvas ? 'locked' : 'drag');
  }

  private release(): void {
    this.clearHold();
    const pointerId = this.pointerId;
    this.pointerId = undefined; this.pointerButton = undefined; this.dragging = false; this.editCandidate = false; this.activationPress = false; this.heldEdit = false;
    if (pointerId !== undefined) {
      try { this.canvas.releasePointerCapture(pointerId); } catch { /* Already released. */ }
    }
    this.callbacks.onPrimary(false);
  }

  private clearHold(): void {
    if (this.holdTimer !== undefined) { clearTimeout(this.holdTimer); this.holdTimer = undefined; }
  }

  private setMode(mode: MouseControlMode): void {
    if (mode === this.currentMode) return;
    this.currentMode = mode; this.callbacks.onMode(mode);
    this.lockedClient = undefined;
  }

  private listen(target: EventTarget, type: string, listener: (event: Event) => void): void {
    target.addEventListener(type, listener);
    this.removers.push(() => target.removeEventListener(type, listener));
  }
}
