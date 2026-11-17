export type Vec3 = { x: number; y: number; z: number };
export type Quat = { x: number; y: number; z: number; w: number };
/** Local integer x,y,z and material ID. Fragment origin is its bounding-box centre. */
export type FragmentVoxel = [number, number, number, number];
export type RubbleFragment = {
  id: string;
  buildingId: string;
  size: Vec3;
  voxels: FragmentVoxel[];
  position: Vec3;
  rotation: Quat;
  state: 'falling' | 'settled';
  linearVelocity?: Vec3;
  angularVelocity?: Vec3;
};

export const MAX_ACTIVE_FRAGMENTS = 24;
export const MAX_SAVED_FRAGMENTS = 512;
export const MAX_SAVED_FRAGMENT_VOXELS = 250_000;
