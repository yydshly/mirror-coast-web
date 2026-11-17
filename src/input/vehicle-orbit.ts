export type VehicleOrbitState = { yaw: number; pitch: number; distanceScale: number; dragging: boolean };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const angle = (value: number) => Math.atan2(Math.sin(value), Math.cos(value));

/** Drag-only vehicle viewing: it never captures pointer lock or changes driving input. */
export class VehicleOrbit {
  private enabled = false;
  private pointerId: number | undefined;
  private lastX = 0;
  private lastY = 0;
  private yaw = 0;
  private pitch = 0;
  private distanceScale = 1;
  private targetYaw = 0;
  private targetPitch = 0;
  private targetDistance = 1;
  private quietTime = 0;
  private readonly removers: Array<() => void> = [];

  constructor(private canvas?: HTMLCanvasElement,private limits:{minDistanceScale?:number}={}) {
    if (!canvas || typeof document === 'undefined') return;
    this.listen(canvas, 'pointerdown', event => {
      const e = event as PointerEvent;
      if (!this.enabled || this.pointerId !== undefined || (e.button !== 0 && e.button !== 2)) return;
      e.preventDefault(); canvas.focus();
      this.pointerId = e.pointerId; this.lastX = e.clientX; this.lastY = e.clientY; this.quietTime = 0;
      try { canvas.setPointerCapture(e.pointerId); } catch { /* Embedded surfaces may omit capture. */ }
    });
    this.listen(document, 'pointermove', event => {
      const e = event as PointerEvent;
      if (!this.enabled || this.pointerId === undefined || e.pointerId !== this.pointerId) return;
      this.orbitBy(e.clientX - this.lastX, e.clientY - this.lastY);
      this.lastX = e.clientX; this.lastY = e.clientY;
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) this.listen(document, type, event => {
      if (this.pointerId !== undefined && (event as PointerEvent).pointerId === this.pointerId) this.release();
    });
    this.listen(canvas, 'contextmenu', event => { if (this.enabled) event.preventDefault(); });
    this.listen(canvas, 'wheel', event => {
      if (!this.enabled) return;
      const e=event as WheelEvent;
      event.preventDefault(); this.zoomBy(e.deltaY*(e.deltaMode===1?32:e.deltaMode===2?180:1));
    }, { passive: false });
    this.listen(document, 'keydown', event => {
      const e = event as KeyboardEvent;
      if (!this.enabled || e.code !== 'KeyR' || e.repeat || (e.target as HTMLElement)?.matches?.('input,textarea,select,button,summary,a,[contenteditable="true"]')) return;
      e.preventDefault(); this.resetLook();
    });
    // A delayed lock request from the previous walking mode must not trap the cursor.
    this.listen(document, 'pointerlockchange', () => {
      if (this.enabled && document.pointerLockElement === canvas) document.exitPointerLock();
    });
    if (typeof window !== 'undefined') this.listen(window, 'blur', () => this.release());
  }

  get state(): VehicleOrbitState { return { yaw: this.yaw, pitch: this.pitch, distanceScale: this.distanceScale, dragging: this.pointerId !== undefined }; }
  cancelDrag():void{this.release();}

  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.release(); this.enabled = enabled;
    if (!enabled) return;
    this.yaw = this.targetYaw = 0; this.pitch = this.targetPitch = 0;
    this.distanceScale = this.targetDistance = 1; this.quietTime = 0;
    if (this.canvas && typeof document !== 'undefined' && document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  /** Pixel deltas also provide a deterministic adapter for gamepad/tests. */
  orbitBy(dx: number, dy: number): void {
    if (!this.enabled || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
    this.targetYaw = angle(this.targetYaw - clamp(dx, -240, 240) * .005);
    this.targetPitch = clamp(this.targetPitch + clamp(dy, -240, 240) * .004, -.2, .85);
    this.quietTime = 0;
  }

  zoomBy(delta: number): void {
    if (!this.enabled || !Number.isFinite(delta)) return;
    this.targetDistance = clamp(this.targetDistance * Math.exp(clamp(delta, -400, 400) * .0013), this.limits.minDistanceScale??.65, 1.8);
    this.quietTime = 0;
  }

  resetLook(): void {
    this.targetYaw = this.targetPitch = 0; this.targetDistance = 1; this.quietTime = 0;
  }

  update(dt: number, speed: number): void {
    if (!this.enabled || !Number.isFinite(dt)) return;
    const delta = clamp(dt, 0, .1);
    this.quietTime += delta;
    if (this.pointerId === undefined && this.quietTime > 3 && Math.abs(speed) > .6) {
      const returnRate = Math.exp(-delta * .72 * Math.min(1, Math.abs(speed) / 4));
      this.targetYaw = angle(this.targetYaw * returnRate); this.targetPitch *= returnRate;
    }
    const smooth = 1 - Math.exp(-delta * 14);
    this.yaw = angle(this.yaw + angle(this.targetYaw - this.yaw) * smooth);
    this.pitch += (this.targetPitch - this.pitch) * smooth;
    this.distanceScale += (this.targetDistance - this.distanceScale) * smooth;
  }

  dispose(): void { this.setEnabled(false); this.removers.splice(0).forEach(remove => remove()); }

  private release(): void {
    const pointerId = this.pointerId; this.pointerId = undefined; this.quietTime = 0;
    if (pointerId !== undefined) { try { this.canvas?.releasePointerCapture(pointerId); } catch { /* Capture was already cancelled. */ } }
  }

  private listen(target: EventTarget, type: string, listener: (event: Event) => void, options?: AddEventListenerOptions): void {
    target.addEventListener(type, listener, options); this.removers.push(() => target.removeEventListener(type, listener, options));
  }
}
