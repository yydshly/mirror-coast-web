import {
  BackSide,DoubleSide, Color, DataTexture, DirectionalLight, FogExp2, HemisphereLight, LinearFilter,
  Mesh, PlaneGeometry, RingGeometry,PMREMGenerator, RedFormat, Scene, ShaderMaterial,
  SphereGeometry, UnsignedByteType, Vector2, Vector3,Vector4, type WebGLCubeRenderTarget, type WebGLRenderer,type Camera,
} from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { DEFAULT_WORLD_BOUNDS, type VoxelWorld, type WorldBounds } from '../world/voxel';
import {ShadowCadence} from './shadow-cadence';
import {SEA_LEVEL} from '../world/sea-level';
import {waterSurfaceHeight} from './water-surface';

/** One coherent sun/sky/water system. Reflection probes contain only the sky. */
export class Environment {
  readonly night = { value: 0 };
  readonly wetness = { value: 0 };
  private sun = new DirectionalLight(0xffdfa7, 3.4);
  private moon = new DirectionalLight(0xb5c9ee, .3);
  private ambient = new HemisphereLight(0xb9d6df, 0x594a38, .58);
  private sky = new Sky();
  private probeSky = new Sky();
  private probeScene = new Scene();
  private stormGeometry = new SphereGeometry(4500, 24, 16);
  private stormMaterial = makeWeatherSky();
  private stormSky = new Mesh(this.stormGeometry, this.stormMaterial);
  private stormProbeSky = new Mesh(this.stormGeometry, this.stormMaterial);
  private pmrem: PMREMGenerator | undefined;
  private reflection: WebGLCubeRenderTarget | undefined;
  private sea: Mesh<PlaneGeometry, ShaderMaterial>;
  private distantSea:Mesh<RingGeometry,ShaderMaterial>;
  private terrain = new DataTexture(new Uint8Array([0]), 1, 1, RedFormat, UnsignedByteType);
  private sunVector = new Vector3();
  private shadowFocus = new Vector3(128, 12, 160);
  private shadowCadence = new ShadowCadence();
  private elapsed = 0;
  private probeClock = 0;
  private probeDirty = true;
  private targetWeather: 'clear' | 'rain' = 'clear';
  private daylight = 1;
  private sunset = 0;
  private twilight = 0;
  private probeWetness = 0;
  private terrainBounds: WorldBounds = DEFAULT_WORLD_BOUNDS;
  private bathymetry = new Uint8Array(1);
  private fogScale = 1;
  private underwater=false;
  get isUnderwater(){return this.underwater;}
  setBoatWake(position:{x:number;z:number},heading:number,speed:number):void{this.sea.material.uniforms.uBoatWake.value.set(position.x,position.z,heading,Math.max(0,speed));}
  waterHeightAt(x:number,z:number):number{
    const b=this.terrainBounds,ix=Math.floor(x)-b.minX,iz=Math.floor(z)-b.minZ,width=b.maxX-b.minX;
    const bed=ix>=0&&ix<width&&iz>=0&&iz<b.maxZ-b.minZ?this.bathymetry[ix+iz*width]??0:0;
    return waterSurfaceHeight(x,z,this.elapsed,bed,this.wetness.value);
  }
  setCameraPosition(position:{y:number}):void{
    const underwater=position.y<SEA_LEVEL+(this.underwater?.05:-.1);
    if(underwater!==this.underwater){this.underwater=underwater;this.applyAtmosphere();}
  }
  hour = 17.2;

  constructor(private scene: Scene, renderer?: WebGLRenderer) {
    scene.fog = new FogExp2(0xb8c1c1, .0019);
    this.sky.scale.setScalar(5000);
    this.probeSky.scale.setScalar(5000);
    for (const sky of [this.sky, this.probeSky]) {
      sky.material.uniforms.turbidity.value = 3.6;
      sky.material.uniforms.rayleigh.value = 2.0;
      sky.material.uniforms.mieCoefficient.value = .004;
      sky.material.uniforms.mieDirectionalG.value = .82;
    }
    this.probeScene.add(this.probeSky, this.stormProbeSky);
    if (renderer) this.pmrem = new PMREMGenerator(renderer);
    scene.add(this.sky, this.stormSky, this.ambient, this.sun, this.sun.target, this.moon, this.moon.target);
    this.moon.position.set(20, 180, 230);
    this.moon.target.position.set(128, 10, 140);
    this.sun.castShadow = true;
    this.sun.shadow.autoUpdate = false;
    this.sun.shadow.needsUpdate = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -100, right: 100, top: 100, bottom: -100, near: 1, far: 650 });
    this.sun.shadow.bias = -.00016;
    this.sun.shadow.normalBias = .045;
    this.sun.shadow.camera.updateProjectionMatrix();
    this.terrain.needsUpdate = true;

    const seaMaterial = new ShaderMaterial({
      side:DoubleSide,
      uniforms: {
        uTime: { value: 0 }, uSun: { value: new Vector3() }, uDay: { value: 1 }, uRain: this.wetness,
        uDeep: { value: new Color('#173e51') }, uShallow: { value: new Color('#528389') },
        uSky:{value:null},uSkyReady:{value:0},
        uHorizon: { value: new Color('#b9c5c8') }, uTerrain: { value: this.terrain },
        uOrigin: { value: new Vector2() }, uSize: { value: new Vector2(256,256) },
        uFogDensity: { value: .00145 },
        uBoatWake:{value:new Vector4()},
      },
      vertexShader: `
        uniform float uTime;
        uniform sampler2D uTerrain;
        uniform vec2 uOrigin;
        uniform vec2 uSize;
        uniform float uRain;
        varying vec3 vWorld;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vec2 uv=(world.xz-uOrigin)/uSize;
          float bed=texture2D(uTerrain,clamp(uv,.001,.999)).r*255.;
          float shelter=.25+.75*smoothstep(.6,4.,${SEA_LEVEL.toFixed(1)}-bed);
          float edge=1.-smoothstep(750.,1100.,max(abs(world.x-128.),abs(world.z-128.)));
          world.y+=(sin(dot(world.xz,vec2(.1692,.0612))-uTime*.58)*.10
                   +sin(dot(world.xz,vec2(-.0456,.0836))+uTime*.43)*.065)*shelter*edge*(1.+uRain*.35);
          vWorld = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uSun;
        uniform vec2 uOrigin;
        uniform vec2 uSize;
        uniform float uDay;
        uniform float uRain;
        uniform float uFogDensity;
        uniform vec3 uDeep;
        uniform vec3 uShallow;
        uniform vec3 uHorizon;
        uniform vec4 uBoatWake;
        uniform sampler2D uTerrain;
        uniform samplerCube uSky;
        uniform float uSkyReady;
        varying vec3 vWorld;
        float seaHash(vec2 p) {
          vec3 h = fract(vec3(p.xyx) * .1031);
          h += dot(h, h.yzx + 33.33);
          return fract((h.x + h.y) * h.z);
        }
        // Value noise with an analytic gradient: incoherent wind texture rather
        // than crossed sine gratings. The derivative is continuous at cell edges.
        vec3 seaNoise(vec2 p) {
          vec2 cell = floor(p);
          vec2 f = fract(p);
          float a = seaHash(cell);
          float b = seaHash(cell + vec2(1., 0.));
          float c = seaHash(cell + vec2(0., 1.));
          float d = seaHash(cell + vec2(1., 1.));
          vec2 u = f * f * (3. - 2. * f);
          vec2 du = 6. * f * (1. - f);
          float k = a - b - c + d;
          float value = a + (b - a) * u.x + (c - a) * u.y + k * u.x * u.y;
          return vec3(value, ((b - a) + k * u.y) * du.x, ((c - a) + k * u.x) * du.y);
        }
        void main() {
          vec2 uv = (vWorld.xz - uOrigin) / uSize;
          float inside = step(0.0, uv.x) * step(0.0, uv.y) * step(uv.x, 1.0) * step(uv.y, 1.0);
          vec2 edgeMeters = min(vWorld.xz-uOrigin,uOrigin+uSize-vWorld.xz);
          // Query the actual voxel-column top at texel centers. Interpolating
          // across the shoreline lets waves cover dry, walkable y=12 shelves.
          vec2 columnUV = (floor(vWorld.xz-uOrigin)+.5)/uSize;
          vec2 halfTexel = .5/uSize;
          float groundTop = texture2D(uTerrain, clamp(columnUV,halfTexel,1.-halfTexel)).r*255.;
          if(inside>.5 && groundTop>=${SEA_LEVEL.toFixed(1)}-.01)discard;
          float mappedBed = texture2D(uTerrain, clamp(uv, .001, .999)).r * 255.0;
          float bed = mix(-24.0, mappedBed, inside * smoothstep(0.0,48.0,min(edgeMeters.x,edgeMeters.y)));
          float depth = max(0.0, ${SEA_LEVEL.toFixed(1)} - bed);
          float waterDistance = length(cameraPosition - vWorld);
          float footprint = max(length(dFdx(vWorld.xz)), length(dFdy(vWorld.xz)));
          vec2 wind = vec2(uTime * .075, -uTime * .041);
          vec3 swell = seaNoise(vWorld.xz * .13 + wind);
          vec2 rotated = mat2(.82, -.57, .57, .82) * vWorld.xz;
          float rippleVisibility = (1. - smoothstep(.22, .85, footprint * 3.4))
                                * (1. - smoothstep(70., 230., waterDistance));
          float microVisibility = (1. - smoothstep(.16, .65, footprint * 6.0))
                               * (1. - smoothstep(12., 48., waterDistance));
          // Most horizon pixels cannot resolve fine waves. Avoid evaluating
          // their analytic gradients after the existing anti-alias fade is zero.
          vec3 ripples = vec3(swell.x, 0., 0.);
          vec3 micro = vec3(.5, 0., 0.);
          if(rippleVisibility > .001) ripples = seaNoise(rotated * vec2(1.6,3.4) - wind * 2.4 + vec2(18.7, -31.2));
          if(microVisibility > .001) micro = seaNoise(vWorld.xz * 6.0 + wind * 4.1 + vec2(-43.8, 9.3));
          vec2 rippleGradient = mat2(.82, .57, -.57, .82) * ripples.yz;
          vec2 slope = (swell.yz * .025 + rippleGradient * (.040 * rippleVisibility)
                     + micro.yz * (.012 * microVisibility)) * (1. + uRain * .35);
          float shelter=.25+.75*smoothstep(.6,4.,depth);
          slope+=shelter*(vec2(.1692,.0612)*(.1*cos(dot(vWorld.xz,vec2(.1692,.0612))-uTime*.58))
                 +vec2(-.0456,.0836)*(.065*cos(dot(vWorld.xz,vec2(-.0456,.0836))+uTime*.43)));
          float dx = slope.x;
          float dz = slope.y;
          vec3 normal = normalize(vec3(-dx, 1.0, -dz));
          vec3 view = normalize(cameraPosition - vWorld);
          float facing = max(dot(normal, view), 0.0);
          float fresnel = .025 + .975 * pow(1.0 - facing, 5.0);
          vec3 water = mix(uDeep,uShallow,exp(-depth*.24));
          water *= .91+.09*swell.x;
          water *= .22 + .78 * uDay;
          vec3 skyReflection = mix(vec3(.16, .30, .42), uHorizon, .65 + .35 * facing);
          if(uSkyReady>.5)skyReflection=textureCube(uSky,reflect(-view,normal)).rgb*.55;
          water = mix(water, skyReflection, fresnel*.94);
          float reflectedSun = max(dot(reflect(-uSun, normal), view), 0.0);
          float sunCore = pow(reflectedSun, mix(650., 200., smoothstep(25., 450., waterDistance)));
          float sunPath = pow(reflectedSun, 110.0);
          float reflectionVariation = .30 + .70 * smoothstep(.3,.8,mix(swell.x,ripples.x,smoothstep(0.,.12,rippleVisibility)));
          water += vec3(1.0, .67, .30) * (sunCore * 1.2 + sunPath * .08) * reflectionVariation * uDay * (1. - uRain * .93);
          float shore = 1.0 - smoothstep(.12, 1.65, depth);
          float wash = .5+.5*sin(depth*3.4-uTime*.65+swell.x*3.2);
          float foam = smoothstep(.65,.9,wash)*smoothstep(.38,.73,ripples.x)*shore*inside;
          water = mix(water, vec3(.72, .83, .78) * (.15 + .85 * uDay), foam * .56);
          // Composite prop wash into the actual sea surface, so wave crests
          // cannot hide a separate flat foam mesh or leave it floating above.
          if(uBoatWake.w>.35){
            vec2 delta=vWorld.xz-uBoatWake.xy;
            float c=cos(uBoatWake.z),s=sin(uBoatWake.z);
            vec2 local=vec2(c*delta.x-s*delta.y,s*delta.x+c*delta.y);
            float aft=local.y-2.35,trailLength=4.+min(uBoatWake.w,11.5)*1.2;
            if(aft>0. && aft<trailLength && abs(local.x)<4.){
              float fade=pow(1.-aft/trailLength,1.3),width=.78+aft*.16;
              float band=1.-smoothstep(.10,.65,abs(abs(local.x)-width));
              float churn=exp(-local.x*local.x*2.2)*(1.-aft/trailLength);
              float fleck=seaNoise(local*vec2(2.8,4.8)-vec2(0.,uTime*3.4)).x;
              float wakeFoam=(band*.62+churn*.75)*fade*(.35+.65*fleck)*min(1.,uBoatWake.w/5.);
              water=mix(water,vec3(.76,.87,.83)*(.15+.85*uDay),clamp(wakeFoam,0.,.8));
            }
          }
          float distanceFog = 1.0 - exp(-length(cameraPosition - vWorld) * uFogDensity);
          water = mix(water, uHorizon * (.32 + .68 * uDay), distanceFog);
          gl_FragColor = vec4(water, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    this.sea = new Mesh(new PlaneGeometry(2400,2400,240,240), seaMaterial);
    this.sea.rotation.x = -Math.PI / 2;
    this.sea.position.set(128, SEA_LEVEL, 128);
    this.sea.frustumCulled = false;
    scene.add(this.sea);
    this.sea.name='coastal-water-surface';
    this.distantSea=new Mesh(new RingGeometry(1200*Math.SQRT2,5000*Math.SQRT2,4,1,Math.PI/4),seaMaterial);this.distantSea.rotation.x=-Math.PI/2;this.distantSea.position.copy(this.sea.position);this.distantSea.frustumCulled=false;this.distantSea.name='distant-water-ring';scene.add(this.distantSea);
    this.setHour(this.hour);
    this.refreshProbe();
  }

  /** Bathymetry comes from current authoritative voxels, not invented imagery. */
  setTerrain(world: VoxelWorld, dirtyKeys?: Iterable<string>): void {
    this.shadowCadence.invalidate();
    const b = world.bounds, width = b.maxX - b.minX, depth = b.maxZ - b.minZ;
    const resize = this.bathymetry.length !== width * depth || this.terrain.image.width !== width || this.terrain.image.height !== depth || this.terrainBounds.minX !== b.minX || this.terrainBounds.minZ !== b.minZ;
    const sample = (x: number,z: number) => {
      const index = x - b.minX + (z - b.minZ) * width; this.bathymetry[index] = 0;
      for (let y = SEA_LEVEL; y >= 0; y--) if (world.getVoxel(x,y,z)) { this.bathymetry[index] = y+1; break; }
    };
    if (resize || !dirtyKeys) {
      this.bathymetry = new Uint8Array(width * depth);
      for (let z=b.minZ;z<b.maxZ;z++) for(let x=b.minX;x<b.maxX;x++) sample(x,z);
    } else {
      const columns = new Set<string>();
      for (const key of dirtyKeys) { const [cx,,cz]=key.split(',').map(Number); columns.add(`${cx},${cz}`); }
      for (const key of columns) { const [cx,cz]=key.split(',').map(Number); for(let z=Math.max(b.minZ,cz*32);z<Math.min(b.maxZ,cz*32+32);z++) for(let x=Math.max(b.minX,cx*32);x<Math.min(b.maxX,cx*32+32);x++) sample(x,z); }
    }
    this.terrainBounds = b;
    this.fogScale = Math.max(width,depth)/256; this.applyAtmosphere();
    this.sea.material.uniforms.uFogDensity.value = this.underwater?.04:.00145 / this.fogScale;
    if (resize) {
      this.terrain.dispose(); this.terrain = new DataTexture(this.bathymetry,width,depth,RedFormat,UnsignedByteType);
      this.terrain.minFilter = this.terrain.magFilter = LinearFilter;
      this.sea.material.uniforms.uTerrain.value = this.terrain;
    } else this.terrain.image.data = this.bathymetry;
    this.terrain.needsUpdate = true;
    this.sea.material.uniforms.uOrigin.value.set(b.minX,b.minZ);
    this.sea.material.uniforms.uSize.value.set(width,depth);
  }

  setHour(hour: number): void {
    this.hour = hour;
    const angle = ((hour - 6) / 24) * Math.PI * 2;
    this.sunVector.set(Math.cos(angle) * .88, Math.sin(angle), -.43).normalize();
    this.daylight = Math.max(0, Math.min(1, this.sunVector.y * 4 + .12));
    this.sunset = this.daylight * (1 - Math.min(1, Math.max(0, this.sunVector.y) * 2.1));
    this.twilight = (1 - this.daylight) * Math.max(0, Math.min(1, (this.sunVector.y + .55) / .55));
    this.night.value = 1 - this.daylight;
    this.sky.material.uniforms.sunPosition.value.copy(this.sunVector);
    this.probeSky.material.uniforms.sunPosition.value.copy(this.sunVector);
    this.applyAtmosphere();
    this.sea.material.uniforms.uSun.value.copy(this.sunVector);
    this.sea.material.uniforms.uDay.value = this.daylight;
    this.probeDirty = true;
    this.updateSunPosition();
  }

  update(dt: number, focus?: Vector3): void {
    this.elapsed += dt;
    this.probeClock += dt;
    this.sea.material.uniforms.uTime.value = this.elapsed;
    this.stormMaterial.uniforms.uTime.value = this.elapsed;
    const targetWetness = this.targetWeather === 'rain' ? 1 : 0;
    const before = this.wetness.value;
    this.wetness.value += (targetWetness - this.wetness.value) * (1 - Math.exp(-dt * 2));
    if (Math.abs(this.wetness.value - targetWetness) < .001) this.wetness.value = targetWetness;
    if (this.wetness.value !== before) this.applyAtmosphere();
    if (Math.abs(this.wetness.value - this.probeWetness) > .08) this.probeDirty = true;
    if (focus) {
      const aerial = focus.y > 250;
      const extent = aerial ? Math.max(this.terrainBounds.maxX-this.terrainBounds.minX,this.terrainBounds.maxZ-this.terrainBounds.minZ)*.55 : 100;
      const shadowCamera = this.sun.shadow.camera;
      if (shadowCamera.right !== extent) {
        Object.assign(shadowCamera,{left:-extent,right:extent,top:extent,bottom:-extent,far:Math.max(650,extent*4)});
        shadowCamera.updateProjectionMatrix(); this.updateSunPosition();
      }
      const x = aerial ? (this.terrainBounds.minX+this.terrainBounds.maxX)/2 : Math.max(this.terrainBounds.minX, Math.min(this.terrainBounds.maxX, focus.x));
      const z = aerial ? (this.terrainBounds.minZ+this.terrainBounds.maxZ)/2 : Math.max(this.terrainBounds.minZ, Math.min(this.terrainBounds.maxZ, focus.z));
      const y = aerial ? 25 : Math.max(12, Math.min(85, focus.y - 1.68));
      if ((x - this.shadowFocus.x) ** 2 + (z - this.shadowFocus.z) ** 2 + (y - this.shadowFocus.y) ** 2 > 64) {
        this.shadowFocus.set(x, y, z); this.updateSunPosition();
      }
    }
    if (this.probeDirty && this.probeClock > 1 && Math.abs(this.wetness.value-targetWetness)<.02) this.refreshProbe();
    if(this.shadowCadence.update(dt))this.sun.shadow.needsUpdate=true;
  }

  /** Compile both weather skies before input is enabled, including the probe variant. */
  async prewarm(renderer:WebGLRenderer,camera:Camera):Promise<void>{
    const visible=[this.sky.visible,this.stormSky.visible,this.probeSky.visible,this.stormProbeSky.visible];
    this.sky.visible=this.stormSky.visible=this.probeSky.visible=this.stormProbeSky.visible=true;
    try{await renderer.compileAsync(this.scene,camera);await renderer.compileAsync(this.probeScene,camera);}
    finally{[this.sky.visible,this.stormSky.visible,this.probeSky.visible,this.stormProbeSky.visible]=visible;}
  }

  dispose(): void {
    this.sea.geometry.dispose(); this.sea.material.dispose(); this.terrain.dispose();
    this.distantSea.geometry.dispose();
    this.sky.geometry.dispose(); this.sky.material.dispose();
    this.probeSky.geometry.dispose(); this.probeSky.material.dispose();
    this.stormGeometry.dispose(); this.stormMaterial.dispose();
    this.reflection?.dispose(); this.pmrem?.dispose(); this.sun.shadow.dispose();
  }

  private updateSunPosition(): void {
    this.shadowCadence.invalidate();
    this.sun.target.position.copy(this.shadowFocus);
    this.sun.position.copy(this.sunVector).multiplyScalar(Math.max(310,this.sun.shadow.camera.right*2)).add(this.shadowFocus);
  }

  get weather(): 'clear' | 'rain' { return this.targetWeather; }

  setWeather(weather: 'clear' | 'rain'): void {
    if (weather !== 'clear' && weather !== 'rain') throw new Error('Unknown weather preset.');
    this.targetWeather = weather;
    this.probeDirty = true;
  }

  private applyAtmosphere(): void {
    const day = this.daylight, rain = this.wetness.value, night = 1 - day;
    this.sun.intensity = day * 2.65 * (1 - rain * .9);
    this.sun.color.setRGB(1, .92 - this.sunset * .2, .78 - this.sunset * .28);
    this.moon.intensity = night * (.35 - rain * .1);
    this.ambient.intensity = day * .38 + night * (.27 + rain * .07);
    this.ambient.color.set(day > .2 ? 0xa9cfdf : 0x7997bc);
    this.ambient.groundColor.set(day > .2 ? 0x594a38 : 0x283b55);
    this.sky.visible = this.probeSky.visible = day > .025;
    this.stormSky.visible = this.stormProbeSky.visible = rain > .001 || day < .98;
    this.stormMaterial.uniforms.uDay.value = day;
    this.stormMaterial.uniforms.uRain.value = rain;
    this.stormMaterial.uniforms.uTwilight.value = this.twilight;
    const background = new Color('#102239').lerp(new Color('#344e62'), this.twilight * .45);
    this.scene.background = background;
    this.probeScene.background = background;
    const fog = this.scene.fog as FogExp2;
    const clearFog = new Color('#a4b7bf').lerp(new Color('#cba17d'), this.sunset * .6);
    const stormFog = new Color('#718b98');
    const nightFog = new Color('#20364f').lerp(new Color('#304858'), this.twilight * .4);
    fog.color.copy(clearFog).lerp(stormFog, rain).lerp(nightFog, night);
    fog.density = .0019 / this.fogScale + rain * .0032;
    if(this.underwater){
      fog.color.set('#376975').multiplyScalar(.35+.65*day);fog.density=.04;
      this.scene.background=fog.color.clone();this.sky.visible=false;this.stormSky.visible=false;
      this.sun.intensity*=.55;this.ambient.color.set('#86b9bb');this.ambient.intensity*=.8;
    }
    this.sea.material.uniforms.uFogDensity.value=this.underwater?.04:.00145/this.fogScale;
    this.sea.material.uniforms.uHorizon.value.copy(fog.color);
    this.scene.environmentIntensity = day * (.27 - rain * .08) + night * (.34 + this.twilight * .08);
  }

  private refreshProbe(): void {
    if (!this.pmrem) return;
    const previous = this.reflection;
    this.reflection = this.pmrem.fromScene(this.probeScene, .04, .1, 10000, { size: 64 });
    this.scene.environment = this.reflection.texture;
    this.sea.material.uniforms.uSky.value=this.reflection.texture;this.sea.material.uniforms.uSkyReady.value=1;
    previous?.dispose();
    this.probeDirty = false; this.probeClock = 0;
    this.probeWetness = this.wetness.value;
  }

  /** GPU-only probes and cached shadows have no CPU pixels to re-upload. */
  restoreGraphics():void{this.sun.shadow.needsUpdate=true;this.refreshProbe();}
}

/** Low-cost layered overcast sky; night is intentionally readable at street level. */
function makeWeatherSky(): ShaderMaterial {
  return new ShaderMaterial({
    side: BackSide, transparent: true, depthWrite: false,
    uniforms: { uTime: { value: 0 }, uDay: { value: 1 }, uRain: { value: 0 }, uTwilight: { value: 0 } },
    vertexShader: `
      varying vec3 vSkyWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.);
        vSkyWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uDay;
      uniform float uRain;
      uniform float uTwilight;
      varying vec3 vSkyWorld;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
        return mix(mix(hash(i), hash(i + vec2(1., 0.)), f.x), mix(hash(i + vec2(0., 1.)), hash(i + 1.), f.x), f.y);
      }
      void main() {
        vec3 ray = normalize(vSkyWorld - cameraPosition);
        float horizon = pow(1. - clamp(ray.y, 0., 1.), 3.);
        vec2 cloudUv = ray.xz / max(.25, ray.y + .45) * 2.1;
        float clouds = noise(cloudUv + vec2(uTime * .007, 0.)) * .65
                     + noise(cloudUv * 2.3 - vec2(uTime * .012, 4.)) * .25
                     + noise(cloudUv * 5.1) * .1;
        vec3 nightSky = mix(vec3(.012, .022, .041), vec3(.025, .042, .064), horizon);
        nightSky += vec3(.035, .038, .04) * uTwilight * horizon;
        vec3 overcast = mix(vec3(.18, .235, .265), vec3(.36, .405, .42), horizon);
        vec3 sky = mix(nightSky, overcast, uDay) * (.78 + clouds * .34);
        float moon = pow(max(dot(ray, normalize(vec3(-.45, .68, .3))), 0.), 1900.);
        float moonHalo = pow(max(dot(ray, normalize(vec3(-.45, .68, .3))), 0.), 65.);
        sky += vec3(.34, .43, .55) * (moon + moonHalo * .065) * (1. - uDay) * (1. - uRain * .7);
        float alpha = max(uRain * .97, 1. - uDay);
        gl_FragColor = vec4(sky, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}
