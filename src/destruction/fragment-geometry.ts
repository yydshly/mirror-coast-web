import { BufferAttribute, BufferGeometry } from 'three';
import { Material, palette } from '../world/palette';
import type { RubbleFragment } from './types';

const faces = [
  { normal: [1, 0, 0], corners: [[1, 0, 0], [1, 1, 0], [1, 0, 1], [1, 1, 1]] },
  { normal: [-1, 0, 0], corners: [[0, 0, 1], [0, 1, 1], [0, 0, 0], [0, 1, 0]] },
  { normal: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [0, 1, 0], [1, 1, 0]] },
  { normal: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1]] },
  { normal: [0, 0, 1], corners: [[1, 0, 1], [1, 1, 1], [0, 0, 1], [0, 1, 1]] },
  { normal: [0, 0, -1], corners: [[0, 0, 0], [0, 1, 0], [1, 0, 0], [1, 1, 0]] },
];

// The one-cell padding makes neighbor keys unambiguous even at -1 or size.
const cellKey = (x: number, y: number, z: number): number => x + 1 + 512 * (z + 1 + 512 * (y + 1));

/** Build only the fragment's exposed surfaces, centred on its rigid-body origin. */
export function createFragmentGeometry(fragment: Pick<RubbleFragment, 'voxels' | 'size'>): BufferGeometry {
  const occupied = new Set(fragment.voxels.map(([x, y, z]) => cellKey(x, y, z)));
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const glow: number[] = [];
  const surfaceId:number[]=[];
  const indices: number[] = [];
  const { size } = fragment;

  for (const [x, y, z, material] of fragment.voxels) {
    const appearance = palette[material] ?? palette[Material.Rock];
    for (const { normal, corners } of faces) {
      if (occupied.has(cellKey(x + normal[0], y + normal[1], z + normal[2]))) continue;
      const offset = positions.length / 3;
      for (const corner of corners) {
        positions.push(x + corner[0] - size.x / 2, y + corner[1] - size.y / 2, z + corner[2] - size.z / 2);
        normals.push(...normal);
        const axes = normal.map((value, axis) => value === 0 ? axis : -1).filter(axis => axis >= 0);
        const outside = [x + normal[0], y + normal[1], z + normal[2]];
        const a = [...outside], b = [...outside], diagonal = [...outside];
        a[axes[0]] += corner[axes[0]] === 0 ? -1 : 1;
        b[axes[1]] += corner[axes[1]] === 0 ? -1 : 1;
        diagonal[axes[0]] = a[axes[0]]; diagonal[axes[1]] = b[axes[1]];
        const hit = (cell: number[]) => occupied.has(cellKey(cell[0], cell[1], cell[2])) ? 1 : 0;
        const sideA = hit(a), sideB = hit(b), edge = hit(diagonal);
        const ao = sideA && sideB ? 0 : 3 - sideA - sideB - edge;
        const shade = .72 + ao / 3 * .28;
        colors.push(appearance.color[0] * shade, appearance.color[1] * shade, appearance.color[2] * shade);
        glow.push(appearance.glow);
        surfaceId.push(material);
      }
      indices.push(offset, offset + 1, offset + 2, offset + 2, offset + 1, offset + 3);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
  geometry.setAttribute('glow', new BufferAttribute(new Float32Array(glow), 1));
  geometry.setAttribute('surfaceId',new BufferAttribute(new Float32Array(surfaceId),1));
  geometry.setIndex(new BufferAttribute(new Uint32Array(indices), 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
