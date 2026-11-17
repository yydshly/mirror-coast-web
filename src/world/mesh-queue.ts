import { createMeshInput, meshChunk, type MeshResult } from './mesher';
import { VoxelWorld } from './voxel';

export const MAX_COMPLETED_MESHES = 4;

export function isMeshResultCurrent(world: VoxelWorld, result: Pick<MeshResult, 'key' | 'revision'>): boolean {
  return world.chunks.get(result.key)?.revision === result.revision;
}

/** One worker keeps CPU/memory bounded; GPU installation is budgeted by update(). */
export class MeshQueue {
  private worker: Worker | null = null;
  private readonly waiting = new Set<string>();
  private readonly completed = new Map<string, MeshResult>();
  private readonly installedRevisions = new Map<string, number>();
  private inFlight: { key: string; revision: number } | null = null;
  private disposed = false;

  constructor(private readonly world: VoxelWorld, private readonly onMesh: (result: MeshResult) => void) {
    if (typeof Worker !== 'undefined') {
      try {
        this.worker = new Worker(new URL('./mesh.worker.ts', import.meta.url), { type: 'module' });
        this.worker.onmessage = (event: MessageEvent<MeshResult>) => {
          if (this.disposed) return;
          const result = event.data;
          // A delayed or duplicate message must not clear a newer, unrelated job.
          if (this.inFlight?.key !== result.key || this.inFlight.revision !== result.revision) return;
          this.inFlight = null;
          if (isMeshResultCurrent(this.world, result)) {
            if (this.installedRevisions.get(result.key) !== result.revision) this.completed.set(result.key, result);
          } else this.request(result.key);
          this.pump();
        };
        this.worker.onerror = () => this.useMainThreadFallback();
      } catch {
        this.worker = null;
      }
    }
  }

  get pending(): number {
    return this.waiting.size + this.completed.size + (this.inFlight ? 1 : 0);
  }

  hasCurrentMesh(key: string): boolean { return this.installedRevisions.get(key) === this.world.chunks.get(key)?.revision; }

  /** A local edit must expose its pit/wall and replace its collider before the
   * next character/rigid-body step. Streaming remains asynchronous. */
  commitEdits(keys: Iterable<string>): void {
    if(this.disposed)return;
    for(const key of new Set(keys)){
      if(this.hasCurrentMesh(key))continue;
      this.waiting.delete(key);this.completed.delete(key);
      const input=createMeshInput(this.world,key);if(!input)continue;
      this.onMesh(meshChunk(input));this.installedRevisions.set(key,input.revision);
    }
    this.pump();
  }

  enqueuePriority(keys: Iterable<string>): void {
    const priority = [...keys];
    for (const key of priority) this.request(key);
    const previous = [...this.waiting]; this.waiting.clear();
    for (const key of priority) if (previous.includes(key)) this.waiting.add(key);
    for (const key of previous) this.waiting.add(key);
    this.pump();
  }

  enqueue(keys: Iterable<string>): void {
    if (this.disposed) return;
    for (const key of keys) this.request(key);
    this.pump();
  }

  update(maxUploads = 2): void {
    if (this.disposed) return;
    let uploaded = 0;const started=performance.now();
    const budget = Number.isFinite(maxUploads) ? Math.max(0, Math.floor(maxUploads)) : 0;
    while (this.completed.size && uploaded < budget && (uploaded===0||performance.now()-started<3)) {
      const [key, result] = this.completed.entries().next().value!;
      this.completed.delete(key);
      if (!isMeshResultCurrent(this.world, result)) {
        this.request(key);
        continue;
      }
      this.onMesh(result);
      this.installedRevisions.set(key, result.revision);
      uploaded++;
    }
    // Browser workers are preferred. This path also makes low-feature environments usable.
    if (!this.worker) {
      while (this.waiting.size && uploaded < budget && (uploaded===0||performance.now()-started<3)) {
        const key = this.waiting.values().next().value as string;
        this.waiting.delete(key);
        const input = createMeshInput(this.world, key);
        if (!input) continue;
        this.onMesh(meshChunk(input));
        this.installedRevisions.set(key, input.revision);
        uploaded++;
      }
    } else this.pump();
  }

  dispose(): void {
    this.disposed = true;
    this.worker?.terminate();
    this.worker = null;
    this.waiting.clear();
    this.completed.clear();
    this.installedRevisions.clear();
    this.inFlight = null;
  }

  private request(key: string): void {
    const revision = this.world.chunks.get(key)?.revision;
    if (revision === undefined || this.installedRevisions.get(key) === revision) return;
    const completed = this.completed.get(key);
    if (completed?.revision === revision) return;
    if (completed) this.completed.delete(key);
    if (this.inFlight?.key === key && this.inFlight.revision === revision) return;
    this.waiting.add(key);
  }

  private pump(): void {
    if (!this.worker || this.inFlight || this.disposed || this.waiting.size === 0 ||
        this.completed.size >= MAX_COMPLETED_MESHES) return;
    const key = this.waiting.values().next().value as string;
    this.waiting.delete(key);
    const input = createMeshInput(this.world, key);
    if (!input) { this.pump(); return; }
    this.inFlight = { key, revision: input.revision };
    this.worker.postMessage(input, [input.halo.buffer as ArrayBuffer]);
  }

  private useMainThreadFallback(): void {
    this.worker?.terminate();
    this.worker = null;
    if (this.inFlight) this.waiting.add(this.inFlight.key);
    this.inFlight = null;
  }
}
