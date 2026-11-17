import {MAX_ACTIVE_FRAGMENTS} from './types';
import type { VoxelWorld } from '../world/voxel';
import type { BuildingRegistry } from './buildings';
import { analyzeStructure, createStructureInput, isStructureResultCurrent, type StructureInput, type StructureResult } from './structure';

/** One outstanding analysis; admission and application both obey the physics budget. */
export class StructureQueue {
  private worker: Worker | null = null;
  private waiting = new Set<string>();
  private inFlight: { buildingId: string; eventId: string } | null = null;
  private completed: StructureResult | null = null;
  private disposed = false;
  private sequence = 0;

  constructor(private world: VoxelWorld, private buildings: BuildingRegistry, private onResult: (result: StructureResult) => void) {
    if (typeof Worker !== 'undefined') {
      try {
        this.worker = new Worker(new URL('./structure.worker.ts', import.meta.url), { type: 'module' });
        this.worker.onmessage = (event: MessageEvent<StructureResult>) => {
          if (this.disposed || this.inFlight?.eventId !== event.data.eventId || this.inFlight.buildingId !== event.data.buildingId) return;
          this.inFlight = null;
          this.completed = event.data;
        };
        this.worker.onerror = () => {
          this.worker?.terminate(); this.worker = null;
          if (this.inFlight) this.waiting.add(this.inFlight.buildingId);
          this.inFlight = null;
        };
      } catch { this.worker = null; }
    }
  }

  get pending(): number { return this.waiting.size + (this.inFlight ? 1 : 0) + (this.completed ? 1 : 0); }

  enqueue(ids: Iterable<string>): void {
    if (this.disposed) return;
    for (const id of ids) if (this.buildings.get(id)) this.waiting.add(id);
  }

  update(canAnalyze:boolean|number = true): void {
    const capacity=typeof canAnalyze==='number'?Math.max(0,canAnalyze):canAnalyze?MAX_ACTIVE_FRAGMENTS:0;
    if (this.disposed || !capacity) return;
    if (this.completed) {
      const result = this.completed;
      if(isStructureResultCurrent(this.world,result)&&result.fragments.length>capacity)return;
      this.completed = null;
      if (isStructureResultCurrent(this.world, result)) this.onResult(result);
      else this.waiting.add(result.buildingId);
      // The callback may activate physical fragments. Re-check admission next frame.
      return;
    }
    if (this.inFlight || !this.waiting.size) return;
    const id = this.waiting.values().next().value!;
    this.waiting.delete(id);
    const building = this.buildings.get(id);
    if (!building) return;
    const eventId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `collapse-${Date.now().toString(36)}-${++this.sequence}`;
    const input: StructureInput = createStructureInput(this.world, building, eventId);
    if (!this.worker) {
      this.completed = analyzeStructure(input);
      return;
    }
    this.inFlight = { buildingId: id, eventId };
    this.worker.postMessage(input, [input.indices.buffer as ArrayBuffer, input.materials.buffer as ArrayBuffer, input.baselineLayers.buffer as ArrayBuffer,...input.supportRoots?[input.supportRoots.buffer as ArrayBuffer]:[]]);
  }

  dispose(): void {
    this.disposed = true; this.worker?.terminate(); this.worker = null;
    this.waiting.clear(); this.inFlight = null; this.completed = null;
  }
}
