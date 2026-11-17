import type { MeshQueue } from './mesh-queue';
import type { Vector3Like, VoxelWorld } from './voxel';

export function chunkDistanceSquared(key: string, focus: Vector3Like): number {
  const [cx,,cz] = key.split(',').map(Number);
  return (cx*32+16-focus.x)**2 + (cz*32+16-focus.z)**2;
}

/** Authoritative terrain stays resident; nearby geometry is installed before distant scenery. */
export class RegionStreaming {
  readonly initialKeys: string[];
  private clock = 0;
  private lastX = Infinity;
  private lastZ = Infinity;

  constructor(private world: VoxelWorld, private queue: MeshQueue, initialFocus: Vector3Like) {
    const focus = initialFocus.y > 140 ? { x: 128,y:20,z:128 } : initialFocus;
    const sorted = [...world.chunks.keys()].sort((a,b) => chunkDistanceSquared(a,focus)-chunkDistanceSquared(b,focus));
    this.initialKeys = sorted.filter(key => chunkDistanceSquared(key,focus) < 112**2);
    queue.enqueue(sorted);
  }

  get initialProgress(): number { return this.initialKeys.length ? this.initialKeys.filter(key=>this.queue.hasCurrentMesh(key)).length / this.initialKeys.length : 1; }
  get initialReady(): boolean { return this.initialKeys.every(key=>this.queue.hasCurrentMesh(key)); }

  update(dt: number, focus: Vector3Like): void {
    this.clock += dt;
    if (this.clock < .35 || Math.hypot(focus.x-this.lastX,focus.z-this.lastZ) < 16) return;
    this.clock = 0; this.lastX=focus.x; this.lastZ=focus.z;
    const near=[...this.world.chunks.keys()].filter(key=>chunkDistanceSquared(key,focus)<144**2).sort((a,b)=>chunkDistanceSquared(a,focus)-chunkDistanceSquared(b,focus));
    this.queue.enqueuePriority(near);
  }
}
