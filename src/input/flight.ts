import {observerHeading,type ObserverMotor} from './observer-motor';
import { Euler, PerspectiveCamera, Vector3 } from 'three';
import { PointerLook, type MouseControlMode } from './pointer-look';
import { DEFAULT_WORLD_BOUNDS, type WorldBounds } from '../world/voxel';

type FlightCallbacks = {
  onAction: () => void;
  onActiveChange: (active: boolean) => void;
  onTool: (index: number) => void;
  onHelp: () => void;
  onHome: () => void;
  onFallback: () => void;
  onMouseMode?: (mode: MouseControlMode) => void;
  primaryDrag?: () => boolean;
};

/** Floating camera with horizontal travel and guarded scene movement. */
export class FlightController {
  active = false;
  private enabled = true;
  private keys = new Set<string>();
  private velocity = new Vector3();
  private desired = new Vector3();
  private forward = new Vector3();
  private right = new Vector3();
  private up = new Vector3(0, 1, 0);
  private rotation = new Euler(0, 0, 0, 'YXZ');
  private look: PointerLook;
  private primaryHeld = false;
  private repeat = 0;
  private handlers: Array<() => void> = [];

  constructor(private camera: PerspectiveCamera, private canvas: HTMLCanvasElement, private callbacks: FlightCallbacks, private bounds: WorldBounds = DEFAULT_WORLD_BOUNDS,private safety?:ObserverMotor) {
    camera.rotation.order = 'YXZ';
    this.look = new PointerLook(canvas, {
      primaryDrag: () => this.callbacks.primaryDrag?.() ?? true,
      onMode: mode => {
        this.setActive(mode !== 'paused');
        this.callbacks.onMouseMode?.(mode);
        if (mode === 'drag') this.callbacks.onFallback();
        if (mode === 'paused') { this.keys.clear(); this.primaryHeld = false; this.velocity.set(0, 0, 0); }
      },
      onLook: (dx, dy) => {
        this.rotation.setFromQuaternion(camera.quaternion, 'YXZ');
        this.rotation.y -= dx * .0022;
        this.rotation.x = Math.max(-1.52, Math.min(1.52, this.rotation.x - dy * .0022));
        camera.quaternion.setFromEuler(this.rotation);
      },
      onPrimary: held => {
        this.primaryHeld = held;
        if (held) { this.repeat = .23; this.callbacks.onAction(); }
      },
    });
    this.listen(window, 'blur', () => { this.keys.clear(); this.primaryHeld = false; });
    this.listen(document, 'keydown', (event) => {
      const e = event as KeyboardEvent;
      if (!this.enabled) return;
      if ((e.target as HTMLElement)?.matches('input,textarea,select,button,summary,a,[contenteditable="true"]')) return;
      if (e.code === 'Tab') { e.preventDefault(); this.stop(); this.callbacks.onHelp(); return; }
      if (e.code === 'Escape') { this.stop(); return; }
      if (e.code === 'KeyH' && !e.repeat) { this.callbacks.onHome(); return; }
      if (['Digit1', 'Digit2', 'Digit3'].includes(e.code) && !e.repeat) this.callbacks.onTool(Number(e.code.slice(-1)) - 1);
      if (!this.active) return;
      if (['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
    });
    this.listen(document, 'keyup', (event) => this.keys.delete((event as KeyboardEvent).code));
  }

  async start(): Promise<void> {
    if (!this.enabled) return;
    this.recoverPosition();
    this.canvas.focus();
    await this.look.start();
  }

  stop(): void {
    this.keys.clear(); this.primaryHeld = false; this.velocity.set(0, 0, 0);
    this.look.stop();
    this.setActive(false);
  }

  recoverPosition():boolean{const recovered=this.safety?.recover(this.camera.position)??false;if(recovered)this.camera.rotation.x=Math.max(-.2,Math.min(.2,this.camera.rotation.x));return recovered;}

  cancelAction(): void { this.primaryHeld = false; this.repeat = 0; this.look.cancelPrimary(); }

  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    if (!enabled) this.stop();
    this.enabled = enabled;
    this.look.setEnabled(enabled);
  }

  update(dt: number): void {
    this.desired.set(0, 0, 0);
    if (this.active) {
      this.camera.getWorldDirection(this.forward);
      observerHeading(this.forward,this.forward);
      this.right.crossVectors(this.forward, this.up).normalize();
      if (this.keys.has('KeyW')) this.desired.add(this.forward);
      if (this.keys.has('KeyS')) this.desired.sub(this.forward);
      if (this.keys.has('KeyD')) this.desired.add(this.right);
      if (this.keys.has('KeyA')) this.desired.sub(this.right);
      if (this.keys.has('Space') || this.keys.has('KeyE')) this.desired.y += 1;
      if (this.keys.has('KeyQ')) this.desired.y -= 1;
      if (this.keys.has('ArrowLeft')) this.camera.rotation.y += dt * 1.1;
      if (this.keys.has('ArrowRight')) this.camera.rotation.y -= dt * 1.1;
      if (this.keys.has('ArrowUp')) this.camera.rotation.x = Math.min(1.52, this.camera.rotation.x + dt * 0.8);
      if (this.keys.has('ArrowDown')) this.camera.rotation.x = Math.max(-1.52, this.camera.rotation.x - dt * 0.8);
      this.desired.normalize().multiplyScalar(this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 55 : 19);
      if (this.primaryHeld) {
        this.repeat -= dt;
        if (this.repeat <= 0) { this.repeat = 0.23; this.callbacks.onAction(); }
      }
    }
    this.velocity.lerp(this.desired, 1 - Math.exp(-dt * 9));
    if(this.active&&this.safety){
      const blocked=this.safety.move(this.camera.position,this.desired.copy(this.velocity).multiplyScalar(dt));
      for(const axis of ['x','y','z'] as const)if(blocked[axis])this.velocity[axis]=0;
    }else this.camera.position.addScaledVector(this.velocity, dt);
    this.camera.position.x = Math.max(this.bounds.minX - 512, Math.min(this.bounds.maxX + 512, this.camera.position.x));
    this.camera.position.y = Math.max(3, Math.min(900, this.camera.position.y));
    this.camera.position.z = Math.max(this.bounds.minZ - 512, Math.min(this.bounds.maxZ + 512, this.camera.position.z));
  }

  dispose(): void { this.stop(); this.look.dispose(); this.handlers.forEach((remove) => remove()); }

  private setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active; this.callbacks.onActiveChange(active);
  }

  private listen(target: EventTarget, name: string, handler: (event: Event) => void): void {
    target.addEventListener(name, handler);
    this.handlers.push(() => target.removeEventListener(name, handler));
  }
}
