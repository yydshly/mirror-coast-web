import {
  DataTexture, DoubleSide, Float32BufferAttribute, InstancedBufferAttribute,
  InstancedBufferGeometry, Mesh, NearestFilter, RedFormat, Scene, ShaderMaterial,
  UnsignedByteType, Vector2, Vector3, type Camera,
} from 'three';
import { DEFAULT_WORLD_BOUNDS, type VoxelWorld, type WorldBounds } from '../world/voxel';
import { buildSurfaceGrid, refreshSurfaceGrid, surfaceGridHeight, type SurfaceGrid } from '../world/surface-grid';

const RAIN_COUNT = 2200;
const SPLASH_COUNT = 96;

/** Highest real solid surface per column. Values are exact integer world heights. */
export function buildRainRoofMap(world: VoxelWorld): Uint8Array {
  return buildSurfaceGrid(world).data;
}

export function rainSurfaceAt(heights: Uint8Array, x: number, z: number, bounds: WorldBounds = DEFAULT_WORLD_BOUNDS): number {
  const width = bounds.maxX - bounds.minX, ix = Math.floor(x) - bounds.minX, iz = Math.floor(z) - bounds.minZ;
  return ix >= 0 && ix < width && iz >= 0 && iz < bounds.maxZ - bounds.minZ ? Math.max(12, heights[ix + iz * width]) : 12;
}

function makeInstances(count: number): InstancedBufferGeometry {
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([-.5, -.5, 0, .5, -.5, 0, -.5, .5, 0, .5, .5, 0], 3));
  geometry.setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
  geometry.setIndex([0, 1, 2, 2, 1, 3]);
  const seeds = new Float32Array(count * 4);
  let state = 61871;
  for (let i = 0; i < seeds.length; i++) {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    seeds[i] = (state >>> 0) / 4294967296;
  }
  geometry.setAttribute('aSeed', new InstancedBufferAttribute(seeds, 4));
  geometry.instanceCount = count;
  return geometry;
}

/** Two GPU-instanced passes: world-space rain streaks and surface impact rings. */
export class Rain {
  private grid: SurfaceGrid;
  private roof: DataTexture;
  private rain: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  private splashes: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  private target = false;
  private amount = { value: 0 };
  private clock = { value: 0 };
  private cameraPosition = { value: new Vector3() };
  private cameraRight = { value: new Vector3(1, 0, 0) };
  private heightCheck = 0;
  private revisions = new Map<string, number>();

  constructor(private scene: Scene, private world: VoxelWorld) {
    this.grid = buildSurfaceGrid(world);
    this.roof = new DataTexture(this.grid.data, this.grid.width, this.grid.depth, RedFormat, UnsignedByteType);
    for (const chunk of world.chunks.values()) this.revisions.set(chunk.key, chunk.revision);
    this.roof.minFilter = this.roof.magFilter = NearestFilter;
    this.roof.needsUpdate = true;
    const common = { uTime: this.clock, uAmount: this.amount, uCamera: this.cameraPosition, uRight: this.cameraRight, uRoof: { value: this.roof }, uOrigin: { value: new Vector2(world.bounds.minX, world.bounds.minZ) }, uSize: { value: new Vector2(this.grid.width, this.grid.depth) } };
    const surfaceFunction = `
      float surfaceAt(vec2 xz) {
        vec2 uv = (xz - uOrigin) / uSize;
        float inside = step(0., uv.x) * step(0., uv.y) * step(uv.x, 1.) * step(uv.y, 1.);
        float roof = texture2D(uRoof, clamp(uv, .0001, .9999)).r * 255.;
        return mix(12., max(12., roof), inside);
      }
    `;
    const streakMaterial = new ShaderMaterial({
      uniforms: common, transparent: true, depthWrite: false, side: DoubleSide,
      vertexShader: `
        attribute vec4 aSeed;
        uniform float uTime;
        uniform vec3 uCamera;
        uniform vec3 uRight;
        varying vec2 vUv;
        varying vec3 vWorld;
        void main() {
          vec2 xz = uCamera.xz + mod(aSeed.xy * 54. + vec2(uTime * 1.4, uTime * .35) - uCamera.xz, 54.) - 27.;
          float y = uCamera.y + 22. - mod(aSeed.z * 38. + uTime * (18. + aSeed.w * 8.) + uCamera.y, 38.);
          vec3 center = vec3(xz.x, y, xz.y);
          vWorld = center + uRight * position.x * (.014 + aSeed.w * .012)
                        + vec3(.075, -1., .019) * position.y * (.7 + aSeed.w * 1.3);
          vUv = uv;
          gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.);
        }
      `,
      fragmentShader: `
        uniform sampler2D uRoof;
        uniform vec2 uOrigin;
        uniform vec2 uSize;
        uniform float uAmount;
        uniform vec3 uCamera;
        varying vec2 vUv;
        varying vec3 vWorld;
        ${surfaceFunction}
        void main() {
          if (vWorld.y <= surfaceAt(vWorld.xz) + .035) discard;
          float width = 1. - smoothstep(.12, .5, abs(vUv.x - .5));
          float taper = sin(vUv.y * 3.14159265);
          float distanceFade = 1. - smoothstep(16., 37., distance(vWorld, uCamera));
          float alpha = width * taper * distanceFade * uAmount * .32;
          if (alpha < .006) discard;
          gl_FragColor = vec4(.48, .62, .73, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    const splashMaterial = new ShaderMaterial({
      uniforms: common, transparent: true, depthWrite: false, side: DoubleSide,
      vertexShader: `
        attribute vec4 aSeed;
        uniform float uTime;
        uniform vec3 uCamera;
        uniform sampler2D uRoof;
        uniform vec2 uOrigin;
        uniform vec2 uSize;
        varying vec2 vUv;
        varying float vLife;
        varying float vVisibility;
        ${surfaceFunction}
        void main() {
          vec2 xz = uCamera.xz + mod(aSeed.xy * 42. - uCamera.xz, 42.) - 21.;
          float surface = surfaceAt(xz);
          float phase = fract(uTime * (.8 + aSeed.w * .6) + aSeed.z);
          vLife = phase;
          vUv = uv;
          vVisibility = step(surface, uCamera.y + 4.) * (1. - smoothstep(13., 24., distance(xz, uCamera.xz)));
          vec3 world = vec3(xz.x + position.x, surface + .026, xz.y + position.y);
          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.);
        }
      `,
      fragmentShader: `
        uniform float uAmount;
        varying vec2 vUv;
        varying float vLife;
        varying float vVisibility;
        void main() {
          float radius = .03 + vLife * .37;
          float ring = 1. - smoothstep(.011, .03, abs(length(vUv - .5) - radius));
          float alpha = ring * (1. - vLife) * vVisibility * uAmount * .19;
          if (alpha < .006) discard;
          gl_FragColor = vec4(.42, .59, .67, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    this.rain = new Mesh(makeInstances(RAIN_COUNT), streakMaterial);
    this.splashes = new Mesh(makeInstances(SPLASH_COUNT), splashMaterial);
    this.rain.frustumCulled = this.splashes.frustumCulled = false;
    this.rain.visible = this.splashes.visible = false;
    this.rain.renderOrder = 5;
    this.splashes.renderOrder = 4;
    scene.add(this.rain, this.splashes);
  }

  prepareMaterials():()=>void{const visible=[this.rain.visible,this.splashes.visible];this.rain.visible=this.splashes.visible=true;return()=>{[this.rain.visible,this.splashes.visible]=visible;};}
  get enabled(): boolean { return this.target; }
  get surfaceTexture(): DataTexture { return this.roof; }
  surfaceHeightAt(x: number, z: number): number { return Math.max(12, surfaceGridHeight(this.grid, x, z)); }

  setEnabled(enabled: boolean): void { this.target = enabled; }

  update(dt: number, camera: Camera): void {
    const target = this.target ? 1 : 0;
    this.amount.value += (target - this.amount.value) * (1 - Math.exp(-dt * 2.5));
    if (Math.abs(this.amount.value - target) < .001) this.amount.value = target;
    const visible = this.amount.value > .001;
    this.rain.visible = this.splashes.visible = visible;
    if (!visible) return;
    this.clock.value += dt;
    camera.getWorldPosition(this.cameraPosition.value);
    const e = camera.matrixWorld.elements;
    this.cameraRight.value.set(e[0], e[1], e[2]).normalize();
    this.heightCheck += dt;
    if (this.heightCheck >= .5) {
      this.heightCheck = 0;
      const dirty: string[] = [];
      for (const chunk of this.world.chunks.values()) if (this.revisions.get(chunk.key) !== chunk.revision) { dirty.push(chunk.key); this.revisions.set(chunk.key, chunk.revision); }
      if (dirty.length) {
        refreshSurfaceGrid(this.world, this.grid, dirty);
        this.roof.needsUpdate = true;
      }
    }
  }

  dispose(): void {
    this.scene.remove(this.rain, this.splashes);
    this.rain.geometry.dispose(); this.rain.material.dispose();
    this.splashes.geometry.dispose(); this.splashes.material.dispose();
    this.roof.dispose();
  }
}
