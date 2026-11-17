import { afterEach, describe, expect, it, vi } from 'vitest';
import { MeshQueue } from '../src/world/mesh-queue';
import { meshChunk, type MeshInput, type MeshResult } from '../src/world/mesher';
import { Material } from '../src/world/palette';
import { RegionStreaming } from '../src/world/region-streaming';
import { VoxelWorld, chunkKey } from '../src/world/voxel';

class ControlledWorker {
  static latest: ControlledWorker;
  onmessage: ((event: MessageEvent<MeshResult>) => void) | null = null;
  onerror: (() => void) | null = null;
  readonly jobs: MeshInput[] = [];
  terminated = false;
  constructor() { ControlledWorker.latest = this; }
  postMessage(input: MeshInput): void { this.jobs.push(input); }
  terminate(): void { this.terminated = true; }
  deliver(input: MeshInput): void {
    this.onmessage?.({ data: meshChunk(input) } as MessageEvent<MeshResult>);
  }
}

const queues: MeshQueue[] = [];
const origin = { x: 16, y: 20, z: 16 };
const key = (cx: number, cz = 0) => chunkKey(cx, 0, cz);

/** Sparse real chunks keep scheduling tests independent of regional generation. */
function createWorld(columns: readonly number[]): VoxelWorld {
  const world = new VoxelWorld({ minX: -256, maxX: 768, minZ: -384, maxZ: 384 });
  for (const cx of columns) world.setVoxel(cx * 32 + 8, 8, 8, Material.Rock);
  return world;
}

function createQueue(world: VoxelWorld): { queue: MeshQueue; installed: MeshResult[] } {
  const installed: MeshResult[] = [];
  const queue = new MeshQueue(world, result => installed.push(result));
  queues.push(queue);
  return { queue, installed };
}

afterEach(() => {
  queues.splice(0).forEach(queue => queue.dispose());
  vi.unstubAllGlobals();
});

describe('regional mesh streaming', () => {
  it('meshes nearby streets before distant scenery even when chunks were generated in the opposite order', () => {
    vi.stubGlobal('Worker', undefined);
    const world = createWorld([20, -8, 4, 3, -1, 0]);
    const { queue, installed } = createQueue(world);
    const streaming = new RegionStreaming(world, queue, origin);
    expect(streaming.initialKeys).toEqual([key(0), key(-1), key(3)]);
    expect(streaming.initialProgress).toBe(0);
    expect(streaming.initialReady).toBe(false);
    expect(queue.pending).toBe(6);

    const expectedOrder = [key(0), key(-1), key(3), key(4), key(-8), key(20)];
    for (let i = 0; i < expectedOrder.length; i++) {
      queue.update(1);
      expect(installed.map(result => result.key)).toEqual(expectedOrder.slice(0, i + 1));
      expect(queue.pending).toBe(expectedOrder.length - i - 1);
    }
    expect(streaming.initialReady).toBe(true);
    expect(streaming.initialProgress).toBe(1);
  });

  it('prioritizes still-pending chunks around a moving player without losing the current worker job', () => {
    vi.stubGlobal('Worker', ControlledWorker);
    const world = createWorld([17, 16, 4, 1, 0]);
    const { queue, installed } = createQueue(world);
    const streaming = new RegionStreaming(world, queue, origin);
    const worker = ControlledWorker.latest;
    const inFlight = worker.jobs[0];
    expect(inFlight.key).toBe(key(0));

    streaming.update(.35, { x: 560, y: 20, z: 16 });
    expect(worker.jobs).toHaveLength(1);
    expect(queue.pending).toBe(5);
    worker.deliver(inFlight);
    expect(worker.jobs[1].key).toBe(key(17));
    queue.update(1);
    expect(installed.map(result => result.key)).toEqual([key(0)]);
    worker.deliver(worker.jobs[1]);
    expect(worker.jobs[2].key).toBe(key(16));
    queue.update(1);
    worker.deliver(worker.jobs[2]);
    expect(worker.jobs[3].key).toBe(key(1));
    queue.update(1);
    expect(installed.map(result => result.key)).toEqual([key(0), key(17), key(16)]);
    expect(queue.pending).toBe(2);
  });

  it.each(['in flight', 'completed but not uploaded', 'already installed'] as const)(
    'does not treat an %s revision as ready after destruction changes the authoritative voxels',
    phase => {
      vi.stubGlobal('Worker', ControlledWorker);
      const world = createWorld([0]);
      const { queue, installed } = createQueue(world);
      const streaming = new RegionStreaming(world, queue, origin);
      const worker = ControlledWorker.latest;
      const oldJob = worker.jobs[0];
      if (phase !== 'in flight') worker.deliver(oldJob);
      if (phase === 'already installed') {
        queue.update(1);
        expect(streaming.initialReady).toBe(true);
      }

      const dirty = world.applyEdits([{ x: 8, y: 8, z: 8, material: Material.Cream }]);
      expect(streaming.initialReady).toBe(false);
      expect(streaming.initialProgress).toBe(0);
      expect(queue.hasCurrentMesh(key(0))).toBe(false);
      // The completed-result path must notice staleness even without an explicit
      // re-enqueue. The installed/in-flight paths receive normal edit invalidation.
      if (phase === 'completed but not uploaded') queue.update(1);
      else queue.enqueue(dirty);
      if (phase === 'in flight') worker.deliver(oldJob);
      const currentJob = worker.jobs[1];
      expect(currentJob.revision).toBe(world.chunks.get(key(0))!.revision);
      expect(currentJob.revision).toBeGreaterThan(oldJob.revision);
      expect(streaming.initialReady).toBe(false);

      worker.deliver(currentJob);
      // Worker completion alone does not mean geometry reached the renderer.
      expect(streaming.initialReady).toBe(false);
      queue.update(1);
      expect(streaming.initialReady).toBe(true);
      expect(queue.hasCurrentMesh(key(0))).toBe(true);
      expect(installed.at(-1)?.revision).toBe(currentJob.revision);
      expect(installed.filter(result => result.revision === oldJob.revision)).toHaveLength(phase === 'already installed' ? 1 : 0);
    },
  );

  it('makes nearby streets playable while distant geometry is still pending', () => {
    vi.stubGlobal('Worker', ControlledWorker);
    const world = createWorld([20, 1, 0]);
    const { queue, installed } = createQueue(world);
    const streaming = new RegionStreaming(world, queue, origin);
    const worker = ControlledWorker.latest;
    expect(streaming.initialKeys).toEqual([key(0), key(1)]);
    worker.deliver(worker.jobs[0]);
    queue.update(1);
    expect(streaming.initialProgress).toBe(.5);
    expect(streaming.initialReady).toBe(false);

    worker.deliver(worker.jobs[1]);
    expect(worker.jobs[2].key).toBe(key(20));
    expect(streaming.initialReady).toBe(false);
    queue.update(1);
    expect(streaming.initialReady).toBe(true);
    expect(streaming.initialProgress).toBe(1);
    expect(queue.pending).toBe(1);
    expect(queue.hasCurrentMesh(key(20))).toBe(false);
    expect(installed.map(result => result.key)).toEqual(streaming.initialKeys);

    worker.deliver(worker.jobs[2]);
    queue.update(1);
    expect(queue.pending).toBe(0);
    expect(queue.hasCurrentMesh(key(20))).toBe(true);
  });
});
