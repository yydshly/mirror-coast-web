import { describe, expect, it, vi } from 'vitest';
import { generateWorld } from '../src/world/generate';
import { isMeshResultCurrent, MAX_COMPLETED_MESHES, MeshQueue } from '../src/world/mesh-queue';
import { createMeshInput, meshChunk, type MeshInput, type MeshResult } from '../src/world/mesher';
import { Material } from '../src/world/palette';
import { VoxelWorld, chunkKey } from '../src/world/voxel';

class ControlledWorker {
  static latest: ControlledWorker;
  onmessage: ((event: MessageEvent<MeshResult>) => void) | null = null;
  onerror: (() => void) | null = null;
  readonly jobs: MeshInput[] = [];
  terminated = false;
  constructor() { ControlledWorker.latest = this; }
  postMessage(job: MeshInput): void { this.jobs.push(job); }
  terminate(): void { this.terminated = true; }
  deliver(job: MeshInput): void {
    this.onmessage?.({ data: meshChunk(job) } as MessageEvent<MeshResult>);
  }
}

describe('voxel world', () => {
  it('culls shared faces across chunk boundaries without detaching authoritative voxels', () => {
    const world = new VoxelWorld();
    world.applyEdits([
      { x: 31, y: 12, z: 12, material: Material.Brick },
      { x: 32, y: 12, z: 12, material: Material.Brick },
    ]);
    const first = meshChunk(createMeshInput(world, chunkKey(0, 0, 0))!);
    const second = meshChunk(createMeshInput(world, chunkKey(1, 0, 0))!);
    expect(first.indices.length).toBe(5 * 6);
    expect(second.indices.length).toBe(5 * 6);
    expect(world.getVoxel(31, 12, 12)).toBe(Material.Brick);
    expect(Math.max(...first.positions)).toBeLessThanOrEqual(32);
  });

  it('invalidates a boundary neighbor and rejects an older mesh after an edit', () => {
    const world = new VoxelWorld();
    world.applyEdits([
      { x: 31, y: 12, z: 12, material: Material.Rock },
      { x: 32, y: 12, z: 12, material: Material.Rock },
    ]);
    const before = meshChunk(createMeshInput(world, '1,0,0')!);
    const dirty = world.applyEdits([{ x: 31, y: 12, z: 12, material: 0 }]);
    expect(new Set(dirty)).toEqual(new Set(['0,0,0', '1,0,0']));
    expect(isMeshResultCurrent(world, before)).toBe(false);
    const after = meshChunk(createMeshInput(world, '1,0,0')!);
    expect(isMeshResultCurrent(world, after)).toBe(true);
    expect(after.indices.length).toBe(6 * 6);
  });

  it('returns exact DDA hit cell, surface normal and distance, including outside-world rays', () => {
    const world = new VoxelWorld();
    world.setVoxel(10, 10, 10, Material.Rock);
    expect(world.raycast({ x: 4, y: 10.5, z: 10.5 }, { x: 1, y: 0, z: 0 })).toEqual({
      x: 10, y: 10, z: 10, distance: 6, normal: { x: -1, y: 0, z: 0 },
    });
    expect(world.raycast({ x: -5, y: 10.5, z: 10.5 }, { x: 1, y: 0, z: 0 })?.distance).toBe(15);
    expect(world.raycast({ x: 4, y: 10.5, z: 10.5 }, { x: 1, y: 0, z: 0 }, 5)).toBeNull();
    expect(world.raycast({ x: 4, y: 10.5, z: 10.5 }, { x: 0, y: 0, z: 0 })).toBeNull();
  });

  it('removes real voxel volume and emits only changed cells as persistent edits', () => {
    const world = new VoxelWorld();
    for (let y = 8; y <= 12; y++) for (let z = 8; z <= 12; z++) for (let x = 8; x <= 12; x++) {
      world.setVoxel(x, y, z, Material.Cream);
    }
    const result = world.removeSphere({ x: 10.5, y: 10.5, z: 10.5 }, 1.1);
    expect(result.edits).toHaveLength(7);
    expect(world.getVoxel(10, 10, 10)).toBe(0);
    expect(world.getVoxel(11, 11, 11)).toBe(Material.Cream);
    expect(world.removeSphere({ x: 10.5, y: 10.5, z: 10.5 }, 1.1).edits).toHaveLength(0);
    const restored = new VoxelWorld();
    for (const edit of result.edits) restored.setVoxel(edit.x, edit.y, edit.z, Material.Cream);
    restored.applyEdits(result.edits);
    expect(restored.getVoxel(10, 10, 10)).toBe(0);
  });

  it('generates the same coastal city for a fixed seed with solid building interiors', () => {
    const first = generateWorld(48271);
    const second = generateWorld(48271);
    expect(first.buildingCount).toBeGreaterThanOrEqual(30);
    expect(first.buildingCount).toBeLessThanOrEqual(40);
    expect(first.world.chunks.size).toBe(second.world.chunks.size);
    const checksum = (world: VoxelWorld) => {
      let hash = 2166136261;
      for (const chunk of world.chunks.values()) for (const value of chunk.voxels) hash = Math.imul(hash ^ value, 16777619);
      return hash >>> 0;
    };
    expect(checksum(first.world)).toBe(checksum(second.world));
    expect(first.world.getVoxel(55, 19, 53)).not.toBe(0);
    expect(first.world.getVoxel(200, 12, 240)).toBe(0);
    expect(first.world.getVoxel(200, 3, 240)).not.toBe(0);
    expect([...first.world.chunks.values()].every(chunk => chunk.revision === 1)).toBe(true);
  });

  it('keeps a newer installed mesh when an old worker result arrives late, without clearing another in-flight job', () => {
    vi.stubGlobal('Worker', ControlledWorker);
    const world = new VoxelWorld();
    world.applyEdits([
      { x: 10, y: 10, z: 10, material: Material.Rock },
      { x: 42, y: 10, z: 10, material: Material.Rock },
    ]);
    const installed: MeshResult[] = [];
    const queue = new MeshQueue(world, result => installed.push(result));
    try {
      const worker = ControlledWorker.latest;
      queue.enqueue(['0,0,0']);
      const olderJob = worker.jobs[0];
      world.applyEdits([{ x: 10, y: 10, z: 10, material: Material.Blue }]);
      queue.enqueue(['0,0,0', '0,0,0']);
      expect(worker.jobs).toHaveLength(1);
      worker.deliver(olderJob);
      expect(installed).toHaveLength(0);
      const newerJob = worker.jobs[1];
      worker.deliver(newerJob);
      queue.update(1);
      expect(installed.map(result => result.revision)).toEqual([newerJob.revision]);

      queue.enqueue(['1,0,0']);
      const otherJob = worker.jobs[2];
      // Deliberately inject a response for the older revision AFTER the new one was installed.
      worker.deliver(olderJob);
      queue.enqueue(['0,0,0', '1,0,0']);
      queue.update(1);
      expect(worker.jobs).toHaveLength(3);
      expect(installed).toHaveLength(1);
      expect(queue.pending).toBe(1);
      worker.deliver(otherJob);
      queue.update(1);
      expect(installed.map(result => result.key)).toEqual(['0,0,0', '1,0,0']);
      expect(queue.pending).toBe(0);
    } finally {
      queue.dispose();
      vi.unstubAllGlobals();
    }
  });

  it('stops producing worker meshes at the completion limit until the renderer consumes one', () => {
    vi.stubGlobal('Worker', ControlledWorker);
    const world = new VoxelWorld();
    for (let cx = 0; cx < MAX_COMPLETED_MESHES + 2; cx++) {
      world.setVoxel(cx * 32 + 5, 8, 8, Material.Rock);
    }
    const installed: MeshResult[] = [];
    const queue = new MeshQueue(world, result => installed.push(result));
    try {
      const worker = ControlledWorker.latest;
      queue.enqueue(world.chunks.keys());
      for (let index = 0; index < MAX_COMPLETED_MESHES; index++) worker.deliver(worker.jobs[index]);
      expect(worker.jobs).toHaveLength(MAX_COMPLETED_MESHES);
      expect(installed).toHaveLength(0);
      queue.update(0);
      expect(worker.jobs).toHaveLength(MAX_COMPLETED_MESHES);
      queue.update(1);
      expect(installed).toHaveLength(1);
      expect(worker.jobs).toHaveLength(MAX_COMPLETED_MESHES + 1);
      worker.deliver(worker.jobs[MAX_COMPLETED_MESHES]);
      expect(worker.jobs).toHaveLength(MAX_COMPLETED_MESHES + 1);
      queue.dispose();
      worker.deliver(worker.jobs[0]);
      expect(installed).toHaveLength(1);
      expect(worker.terminated).toBe(true);
    } finally {
      queue.dispose();
      vi.unstubAllGlobals();
    }
  });
});
