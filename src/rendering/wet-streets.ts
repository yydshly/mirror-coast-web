import { DataTexture, NearestFilter, PlaneGeometry, Quaternion, RedFormat, Scene, ShaderMaterial, UnsignedByteType, Vector2, Vector3, PerspectiveCamera, type Camera, type WebGLRenderer } from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { Material } from '../world/palette';
import type { VoxelWorld } from '../world/voxel';

export function streetReflectionMask(world: VoxelWorld, originX = 0, originZ = 0, size = 256, height = 16, surfaceAt?: (x:number,z:number)=>number): Uint8Array {
  const cells = new Uint8Array(size * size);
  for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
    const wx = x + originX, wz = z + originZ, m = world.getVoxel(wx, height - 1, wz);
    if ((m === Material.Road || m === Material.Concrete || m === Material.Stripe || m === Material.Trim) && (!surfaceAt || surfaceAt(wx,wz) <= height)) cells[x + z * size] = 255;
  }
  return cells;
}

/** One low-resolution planar reflection, restricted to existing street surfaces. */
export class WetStreets {
  private readonly reflector: Reflector;
  private readonly material: ShaderMaterial;
  private readonly mask: DataTexture;
  private elapsed = 0;
  private reflectionAt=-Infinity;
  private reflectionView=new PerspectiveCamera();
  private dirty = false;
  private hasRendered = false;
  private forceReflection = true;
  private lastPosition = new Vector3(999, 999, 999);
  private lastRotation = new Quaternion();
  private originX = 0;
  private originZ = 0;
  private planeHeight = 16;
  private readonly size = 192;

  constructor(scene: Scene, private world: VoxelWorld, wetness: { value: number }, private surfaceAt?: (x:number,z:number)=>number) {
    this.mask = new DataTexture(new Uint8Array(this.size * this.size), this.size, this.size, RedFormat, UnsignedByteType);
    this.mask.minFilter = this.mask.magFilter = NearestFilter; this.mask.needsUpdate = true;
    const shader = {
      name: 'RainPuddles',
      uniforms: { tDiffuse: { value: null }, color: { value: null }, textureMatrix: { value: null }, uMask: { value: null }, uWet: { value: 0 }, uTime: { value: 0 }, uOrigin: { value: new Vector2() }, uSize: { value: this.size } },
      vertexShader: `uniform mat4 textureMatrix; varying vec4 vReflection; varying vec3 vWorld;
        void main(){ vReflection=textureMatrix*vec4(position,1.); vec4 p=modelMatrix*vec4(position,1.); vWorld=p.xyz; gl_Position=projectionMatrix*viewMatrix*p; }`,
      fragmentShader: `uniform sampler2D tDiffuse; uniform sampler2D uMask; uniform float uWet; uniform float uTime; uniform vec2 uOrigin; uniform float uSize;
        varying vec4 vReflection; varying vec3 vWorld;
        float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float noise(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f); return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+1.),f.x),f.y); }
        void main(){
          if(texture2D(uMask,(vWorld.xz-uOrigin)/uSize).r<.5 || uWet<.01) discard;
          float distanceToEye=distance(cameraPosition,vWorld);
          float coverage=smoothstep(.36,.7,noise(vWorld.xz*.31)+noise(vWorld.xz*.85)*.2);
          float ripple=sin(length(fract(vWorld.xz*.7)-.5)*24.-uTime*5.);
          vec2 uv=vReflection.xy/vReflection.w;
          if(vReflection.w<=0. || uv.x<0. || uv.y<0. || uv.x>1. || uv.y>1.) discard;
          vec2 blur=vec2(.002,.0035);
          uv+=vec2(noise(vWorld.xz*1.1+uTime*.12)-.5,ripple*.18)*.0017;
          vec3 reflected=texture2D(tDiffuse,uv).rgb*.5;
          reflected+=(texture2D(tDiffuse,uv+blur).rgb+texture2D(tDiffuse,uv-blur).rgb)*.25;
          float grazing=1.-max(0.,normalize(cameraPosition-vWorld).y);
          float strength=uWet*(.08+coverage*.55)*(.3+grazing*.7)*(1.-smoothstep(55.,125.,distanceToEye));
          gl_FragColor=vec4(reflected*.88,strength);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    };
    this.reflector = new Reflector(new PlaneGeometry(this.size, this.size), { textureWidth: 512, textureHeight: 512, clipBias: .002, multisample: 0, shader });
    this.reflector.name = 'wet-street-planar-reflection';
    this.reflector.rotation.x = -Math.PI / 2; this.reflector.position.set(this.size/2, 16.025, this.size/2);
    this.reflector.renderOrder = 3;
    this.material = this.reflector.material as ShaderMaterial;
    this.material.transparent = true; this.material.depthWrite = false;
    this.material.uniforms.uWet = wetness;
    this.material.uniforms.uMask.value = this.mask;
    const render = this.reflector.onBeforeRender;
    this.reflector.onBeforeRender = (...args) => {
      // Re-use a reflection between updates; main geometry remains full frame rate.
      if (!this.hasRendered || this.elapsed-this.reflectionAt >= (this.forceReflection?1/20:1/10)) {
        const camera=args[2] as PerspectiveCamera;
        // Puddles fade at 125 m. Rendering the entire coastline into their
        // 512px texture wastes geometry and causes first-view upload spikes.
        this.reflectionView.copy(camera,false);this.reflectionView.far=Math.min(camera.far,170);this.reflectionView.updateProjectionMatrix();
        render.call(this.reflector,args[0],args[1],this.reflectionView,args[3],args[4],args[5]);
        this.reflectionAt=this.elapsed;
        this.hasRendered = true; this.forceReflection = false;
        this.lastPosition.copy(args[2].position); this.lastRotation.copy(args[2].quaternion);
      }
    };
    scene.add(this.reflector);
    this.dirty = true;
  }

  sync(): void { this.dirty = true; }

  /** Offscreen reflections use linear output/no display tone mapping. Compile
   * that real target variant before play, rather than on the first rain frame. */
  async prewarm(renderer:WebGLRenderer,scene:Scene,camera:Camera):Promise<void>{
    const previous=renderer.getRenderTarget();
    try{renderer.setRenderTarget(this.reflector.getRenderTarget());await renderer.compileAsync(scene,camera);}
    finally{renderer.setRenderTarget(previous);}
  }

  update(dt: number, camera: PerspectiveCamera): void {
    this.elapsed += dt;
    this.material.uniforms.uTime.value = this.elapsed;
    this.forceReflection = camera.position.distanceToSquared(this.lastPosition) > .0025 || camera.quaternion.angleTo(this.lastRotation) > .005;
    const ox = Math.floor(camera.position.x / 48) * 48 - this.size/2;
    const oz = Math.floor(camera.position.z / 48) * 48 - this.size/2;
    const surface = this.surfaceAt?.(camera.position.x,camera.position.z) ?? 16;
    const height = Math.round(surface);
    if (ox !== this.originX || oz !== this.originZ || height !== this.planeHeight) {
      this.originX = ox; this.originZ = oz; this.planeHeight = height; this.dirty = true; this.hasRendered = false;
      this.reflector.position.set(ox+this.size/2,height+.025,oz+this.size/2); this.material.uniforms.uOrigin.value.set(ox,oz);
    }
    this.reflector.visible = this.material.uniforms.uWet.value > .01 && camera.position.y > height + .1 && camera.position.y < height + 36;
    if (this.dirty && this.reflector.visible) { (this.mask.image.data as Uint8Array).set(streetReflectionMask(this.world,ox,oz,this.size,height,this.surfaceAt)); this.mask.needsUpdate = true; this.dirty = false; }
  }

  dispose(): void {
    this.reflector.removeFromParent(); this.reflector.geometry.dispose(); this.reflector.dispose(); this.mask.dispose();
  }
}
