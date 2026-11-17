import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PointerLook, type MouseControlMode } from '../src/input/pointer-look';

class FakeCanvas extends EventTarget {
  readonly focus = vi.fn();
  readonly capture = new Set<number>();
  readonly setPointerCapture = vi.fn((id: number) => { this.capture.add(id); });
  readonly releasePointerCapture = vi.fn((id: number) => { this.capture.delete(id); });
  requestPointerLock = vi.fn<() => Promise<void>>(() => Promise.reject(new Error('Pointer lock unavailable')));
}

class FakeDocument extends EventTarget {
  pointerLockElement: FakeCanvas | null = null;
  readonly exitPointerLock = vi.fn(() => {
    this.pointerLockElement = null;
    this.dispatchEvent(new Event('pointerlockchange'));
  });

  lock(canvas: FakeCanvas): void {
    this.pointerLockElement = canvas;
    this.dispatchEvent(new Event('pointerlockchange'));
  }
}

function pointer(target: EventTarget, type: string, fields: Partial<{
  button: number; pointerId: number; pointerType: string; clientX: number; clientY: number; movementX: number; movementY: number;
}> = {}): Event {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { button: 0, pointerId: 1, pointerType: 'mouse', clientX: 100, clientY: 100, movementX: 0, movementY: 0 }, fields);
  target.dispatchEvent(event);
  return event;
}

let documentTarget: FakeDocument;
let windowTarget: EventTarget;
const instances: PointerLook[] = [];
beforeEach(() => {
  documentTarget = new FakeDocument(); windowTarget = new EventTarget();
  vi.stubGlobal('document', documentTarget); vi.stubGlobal('window', windowTarget);
});
afterEach(() => {
  for (const look of instances.splice(0)) look.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function setup(primaryDrag = true, canvas = new FakeCanvas()) {
  const modes: MouseControlMode[] = [], turns: number[][] = [], primary: boolean[] = [];
  const look = new PointerLook(canvas as unknown as HTMLCanvasElement, {
    onMode: mode => modes.push(mode), onLook: (dx, dy) => turns.push([dx, dy]),
    onPrimary: held => primary.push(held), primaryDrag: () => primaryDrag,
  });
  instances.push(look);
  return { look, canvas, modes, turns, primary };
}

describe('mouse lock and immediate captured-drag controls', () => {
  it('turns on the very first right-button drag, without a second activation click or lock permission', () => {
    const { look, canvas, turns } = setup();
    const down = pointer(canvas, 'pointerdown', { button: 2, pointerId: 7, clientX: 48, clientY: 66 });
    expect(look.mode).toBe('drag'); expect(look.active).toBe(true);
    expect(down.defaultPrevented).toBe(true);
    expect(canvas.capture.has(7)).toBe(true);
    expect(canvas.requestPointerLock).not.toHaveBeenCalled();
    pointer(documentTarget, 'pointermove', { pointerId: 7, clientX: 73, clientY: 51 });
    expect(turns).toEqual([[25, -15]]);
    pointer(documentTarget, 'pointerup', { pointerId: 7, button: 2 });
    expect(canvas.capture.size).toBe(0);
    pointer(documentTarget, 'pointermove', { pointerId: 7, clientX: 85, clientY: 44 });
    expect(turns).toHaveLength(1);
  });

  it('uses client coordinates when a remote surface reports zero movement values', () => {
    const { canvas, turns } = setup();
    pointer(canvas, 'pointerdown', { button: 2, clientX: 270, clientY: 90 });
    pointer(documentTarget, 'pointermove', { clientX: 283, clientY: 104, movementX: 0, movementY: 0 });
    pointer(documentTarget, 'pointermove', { clientX: 274, clientY: 101, movementX: 0, movementY: 0 });
    expect(turns).toEqual([[13, 14], [-9, -3]]);
  });

  it('ignores a different captured pointer and clamps a remote cursor teleport', () => {
    const { canvas, turns } = setup();
    pointer(canvas, 'pointerdown', { button: 2, pointerId: 4 });
    pointer(documentTarget, 'pointermove', { pointerId: 8, clientX: 400, clientY: 400 });
    expect(turns).toEqual([]);
    pointer(documentTarget, 'pointermove', { pointerId: 4, clientX: 5000, clientY: -5000 });
    pointer(documentTarget, 'pointermove', { pointerId: 4, clientX: 5010, clientY: -4996 });
    expect(turns).toEqual([[240, -240], [10, 4]]);
  });

  it('allows an observation left-button drag immediately even while pointer lock is pending', () => {
    const { look, canvas, turns, primary } = setup(true);
    canvas.requestPointerLock.mockImplementation(() => new Promise<void>(() => {}));
    pointer(canvas, 'pointerdown', { clientX: 100, clientY: 50 });
    expect(look.active).toBe(true); expect(canvas.requestPointerLock).toHaveBeenCalledTimes(1);
    pointer(documentTarget, 'pointermove', { clientX: 118, clientY: 62 });
    expect(turns).toEqual([[18, 12]]);
    expect(primary).not.toContain(true);
  });

  it('distinguishes an edit click from a left-button aiming drag in fallback mode', async () => {
    const { look, canvas, turns, primary } = setup(false);
    await look.start();
    pointer(canvas, 'pointerdown', { clientX: 100, clientY: 50 });
    pointer(documentTarget, 'pointermove', { clientX: 103, clientY: 52 });
    expect(primary).not.toContain(true); expect(turns).toEqual([]);
    pointer(documentTarget, 'pointerup');
    expect(primary.filter(Boolean)).toHaveLength(1);
    expect(primary.at(-1)).toBe(false);
    primary.length = 0;
    pointer(canvas, 'pointerdown', { clientX: 100, clientY: 50 });
    pointer(documentTarget, 'pointermove', { clientX: 140, clientY: 90 });
    pointer(documentTarget, 'pointerup');
    expect(turns).toEqual([[40,40]]); expect(primary).not.toContain(true);
    // Right drag still turns while an edit tool is selected.
    pointer(canvas, 'pointerdown', { button: 2, clientX: 100, clientY: 50 });
    pointer(documentTarget, 'pointermove', { clientX: 110, clientY: 46 });
    expect(turns).toEqual([[40,40],[10,-4]]);
  });

  it('stays usable in drag mode when the native lock request rejects or emits an error', async () => {
    const { look, canvas, turns } = setup();
    await look.start();
    documentTarget.dispatchEvent(new Event('pointerlockerror'));
    expect(look.mode).toBe('drag');
    pointer(canvas, 'pointerdown', { button: 2, clientX: 10, clientY: 20 });
    pointer(documentTarget, 'pointermove', { clientX: 16, clientY: 27 });
    expect(turns).toEqual([[6, 7]]);
  });

  it('uses native movement deltas after a successful lock', async () => {
    const { look, canvas, turns } = setup();
    canvas.requestPointerLock.mockImplementation(async () => { documentTarget.lock(canvas); });
    await look.start();
    expect(look.mode).toBe('locked');
    pointer(documentTarget, 'pointermove', { clientX: 100, clientY: 100, movementX: -12, movementY: 7 });
    expect(turns).toEqual([[-12, 7]]);
  });

  it('ignores an old lock error after a newer request successfully owns the native lock',async()=>{
    const {look,canvas}=setup(false);
    canvas.requestPointerLock.mockImplementation(async()=>documentTarget.lock(canvas));
    await look.start();documentTarget.dispatchEvent(new Event('pointerlockerror'));
    expect(look.mode).toBe('locked');
  });

  it('falls back to client deltas under a reported lock with zero remote movement, without an initial jump', async () => {
    const { look, canvas, turns } = setup();
    canvas.requestPointerLock.mockImplementation(async () => { documentTarget.lock(canvas); });
    await look.start();
    pointer(documentTarget, 'pointermove', { clientX: 720, clientY: 480, movementX: 0, movementY: 0 });
    expect(turns.filter(([dx, dy]) => dx || dy)).toEqual([]);
    pointer(documentTarget, 'pointermove', { clientX: 737, clientY: 469, movementX: 0, movementY: 0 });
    expect(turns.filter(([dx, dy]) => dx || dy)).toEqual([[17, -11]]);
  });

  it('stops on the owner Escape action and ignores dragging and late errors while disabled', async () => {
    const { look, canvas, turns } = setup();
    const onKey = (event: Event) => { if ((event as KeyboardEvent).code === 'Escape') look.stop(); };
    documentTarget.addEventListener('keydown', onKey);
    pointer(canvas, 'pointerdown', { button: 2 });
    const escape = new Event('keydown'); Object.assign(escape, { code: 'Escape' }); documentTarget.dispatchEvent(escape);
    expect(look.mode).toBe('paused'); expect(canvas.capture.size).toBe(0);
    pointer(documentTarget, 'pointermove', { clientX: 120, clientY: 120 });
    documentTarget.dispatchEvent(new Event('pointerlockerror'));
    expect(turns).toEqual([]); expect(look.active).toBe(false);
    look.setEnabled(false);
    pointer(canvas, 'pointerdown', { button: 2 }); await look.start();
    expect(look.active).toBe(false);
    documentTarget.removeEventListener('keydown', onKey);
  });

  it('keeps the enabled camera controller and the disabled one mutually exclusive across mode switches', async () => {
    const canvas = new FakeCanvas();
    const first = setup(true, canvas), second = setup(true, canvas);
    second.look.setEnabled(false);
    canvas.requestPointerLock.mockImplementation(async () => { documentTarget.lock(canvas); });
    await first.look.start();
    expect(first.look.mode).toBe('locked'); expect(second.look.mode).toBe('paused');
    first.look.setEnabled(false); second.look.setEnabled(true); await second.look.start();
    pointer(documentTarget, 'pointermove', { movementX: 9, movementY: -6 });
    expect(first.look.mode).toBe('paused'); expect(second.look.mode).toBe('locked');
    expect(first.turns).toEqual([]); expect(second.turns).toEqual([[9, -6]]);
  });

  it('does not revive a paused controller when an old pending lock request completes late', async () => {
    const { look, canvas } = setup();
    let resolve!: () => void;
    canvas.requestPointerLock.mockImplementation(() => new Promise<void>(done => { resolve = done; }));
    const request = look.start();
    expect(look.active).toBe(true);
    look.stop();
    documentTarget.lock(canvas); resolve(); await request;
    expect(look.mode).toBe('paused');
    expect(documentTarget.pointerLockElement).toBe(null);
    expect(documentTarget.exitPointerLock).toHaveBeenCalled();
  });

  it('clears capture and held editing on window blur, and releases listeners on dispose', async () => {
    vi.useFakeTimers();
    const { look, canvas, turns, primary } = setup(false);
    await look.start(); pointer(canvas, 'pointerdown');
    vi.advanceTimersByTime(350);
    expect(primary.at(-1)).toBe(true);
    windowTarget.dispatchEvent(new Event('blur'));
    expect(look.active).toBe(false); expect(primary.at(-1)).toBe(false);
    look.dispose();
    pointer(canvas, 'pointerdown', { button: 2 }); pointer(documentTarget, 'pointermove', { clientX: 150 });
    expect(turns).toEqual([]); expect(look.active).toBe(false);
  });

  it('never edits on the activation press, including a first left-button drag with a destructive tool selected', async () => {
    const {canvas,look,primary,turns}=setup(false);
    pointer(canvas,'pointerdown',{clientX:10,clientY:20});
    pointer(documentTarget,'pointerup');
    expect(look.mode).toBe('drag');expect(primary).not.toContain(true);
    look.stop();primary.length=0;
    pointer(canvas,'pointerdown',{clientX:10,clientY:20});
    pointer(documentTarget,'pointermove',{clientX:30,clientY:17});
    pointer(documentTarget,'pointerup');
    expect(turns).toEqual([[20,-3]]);expect(primary).not.toContain(true);
    await Promise.resolve();
  });

  it('keeps an intentionally stationary hold editing until release and stops it before a later drag turns', async()=>{
    vi.useFakeTimers();
    const {canvas,look,primary,turns}=setup(false);
    await look.start();pointer(canvas,'pointerdown',{clientX:100,clientY:50});
    vi.advanceTimersByTime(349);expect(primary).not.toContain(true);
    vi.advanceTimersByTime(1);expect(primary.at(-1)).toBe(true);
    pointer(documentTarget,'pointermove',{clientX:120,clientY:50});
    expect(primary.at(-1)).toBe(false);expect(turns).toEqual([[20,0]]);
    pointer(documentTarget,'pointerup');
    expect(primary.filter(Boolean)).toHaveLength(1);
  });

  it('does not fire a delayed action after a drag, cancellation, mode switch or focus loss',async()=>{
    vi.useFakeTimers();
    const {canvas,look,primary}=setup(false);
    await look.start();
    pointer(canvas,'pointerdown');pointer(documentTarget,'pointermove',{clientX:108});
    vi.advanceTimersByTime(500);pointer(documentTarget,'pointerup');
    pointer(canvas,'pointerdown');pointer(documentTarget,'pointercancel');
    vi.advanceTimersByTime(500);
    pointer(canvas,'pointerdown');look.cancelPrimary();vi.advanceTimersByTime(500);
    pointer(canvas,'pointerdown');windowTarget.dispatchEvent(new Event('blur'));vi.advanceTimersByTime(500);
    expect(primary).not.toContain(true);expect(canvas.capture.size).toBe(0);
  });

  it('supports touch aiming with destructive tools without lock requests or accidental tap edits during activation',()=>{
    vi.useFakeTimers();
    const {canvas,primary,turns}=setup(false);
    pointer(canvas,'pointerdown',{pointerType:'touch',clientX:40,clientY:30});
    pointer(documentTarget,'pointermove',{pointerType:'touch',clientX:62,clientY:23});
    pointer(documentTarget,'pointerup',{pointerType:'touch'});
    vi.advanceTimersByTime(500);
    expect(turns).toEqual([[22,-7]]);expect(primary).not.toContain(true);
    expect(canvas.requestPointerLock).not.toHaveBeenCalled();
  });

  it('keeps locked editing immediate while mouse movement still aims during the hold',async()=>{
    const {canvas,look,primary,turns}=setup(false);
    canvas.requestPointerLock.mockImplementation(async()=>documentTarget.lock(canvas));
    await look.start();primary.length=0;
    pointer(canvas,'pointerdown');expect(primary).toEqual([true]);
    pointer(documentTarget,'pointermove',{movementX:12,movementY:-8});
    expect(turns).toEqual([[12,-8]]);
    pointer(documentTarget,'pointerup');expect(primary.at(-1)).toBe(false);
  });

  it('ignores other touch pointers until the owner releases its captured gesture',async()=>{
    const {canvas,look,primary,turns}=setup(false);
    await look.start();
    pointer(canvas,'pointerdown',{pointerId:3});
    pointer(canvas,'pointerdown',{pointerId:4});
    pointer(documentTarget,'pointercancel',{pointerId:4});
    pointer(documentTarget,'pointermove',{pointerId:3,clientX:120});
    expect(turns).toEqual([[20,0]]);expect(primary).not.toContain(true);
    pointer(documentTarget,'pointerup',{pointerId:3});expect(canvas.capture.size).toBe(0);
  });

  it('lets right drag take over a held edit and ignores the unrelated left release',async()=>{
    vi.useFakeTimers();
    const {canvas,look,primary,turns}=setup(false);await look.start();
    pointer(canvas,'pointerdown');vi.advanceTimersByTime(350);expect(primary.at(-1)).toBe(true);
    pointer(canvas,'pointerdown',{button:2,clientX:100,clientY:50});
    expect(primary.at(-1)).toBe(false);
    pointer(documentTarget,'pointerup',{button:0});
    pointer(documentTarget,'pointermove',{clientX:110,clientY:46});
    expect(turns).toEqual([[10,-4]]);expect(canvas.capture.size).toBe(1);
    pointer(documentTarget,'pointerup',{button:2});expect(canvas.capture.size).toBe(0);
  });
});
