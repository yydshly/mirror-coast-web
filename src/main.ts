import {ObserverMotor} from './input/observer-motor';
import {GpuWarmup} from './rendering/gpu-warmup';
import {cullInactiveSceneLights} from './rendering/direct-light-culling';
import {NaturalSupportQueue,registerNaturalTrees} from './destruction/natural-support';
import {DecorationPhysics,type DecorationState} from './destruction/decorations';
import './style.css';
import {
  ACESFilmicToneMapping, BoxGeometry, BufferAttribute, BufferGeometry,
  EdgesGeometry, LineBasicMaterial, LineSegments, Mesh, MeshStandardMaterial,
  PCFShadowMap, PerspectiveCamera, Scene, SRGBColorSpace, Vector2, Vector3, WebGLRenderer,
} from 'three';
import { generateWorld } from './world/generate';
import { CHUNK_SIZE, WORLD_SEED, WORLD_VERSION } from './world/voxel';
import { MeshQueue } from './world/mesh-queue';
import { WorldPersistence, type PlayerState } from './persistence/storage';
import { Interface } from './ui/interface';
import type { Tool } from './ui/interface';
import { FlightController } from './input/flight';
import { Environment } from './rendering/environment';
import { EditParticles } from './rendering/particles';
import { ImpactEffects } from './rendering/impact-effects';
import { CollapsePhysics } from './destruction/physics';
import type {TrafficBodyState} from './destruction/physics';
import { StructureQueue } from './destruction/structure-queue';
import { generateCollapseLab, LAB_SHOTS, LAB_WORLD_VERSION } from './destruction/lab';
import type { StructureResult } from './destruction/structure';
import { MAX_ACTIVE_FRAGMENTS,type RubbleFragment,type Vec3 } from './destruction/types';
import { CoastalArt } from './rendering/coastal-art';
import { Helicopter } from './vehicles/helicopter';
import {helicopterExit,helipadClear} from './vehicles/helicopter-access';
import {Bicycle,type BicycleState} from './vehicles/bicycle';
import {CoastalBoat,type BoatState} from './vehicles/coastal-boat';
import {BoatLandings} from './rendering/boat-landings';
import {BuildingEntrances} from './rendering/building-entrances';
import type { HelicopterState } from './vehicles/types';
import { recordClip } from './rendering/flight-recorder';
import type {ClipSettings} from './ui/recording-panel';
import { HELICOPTER_SPAWN,HELIPAD } from './route/coast-route';
import { WalkingController } from './input/walk';
import { Rain } from './rendering/rain';
import { StreetArt } from './rendering/street-art';
import { WetStreets } from './rendering/wet-streets';
import { addHarborQuarter } from './world/harbor-quarter';
import { STREET_PLACES } from './route/street-route';
import { WalkingCamera, type WalkingViewMode } from './input/walk-camera';
import {obstaclesIntersect,type SceneObstacle} from './input/scene-collisions';
import {SceneCollisionIndex} from './input/scene-collision-index';
import {RouteLandscape} from './rendering/route-landscape';
import {CoastalAmbience} from './audio/coastal-ambience';
import { addRegionalTerrain, regionalHeightAt } from './world/region-terrain';
import { addRegionalDistricts } from './world/region-districts';
import { RegionStreaming } from './world/region-streaming';
import { TerrainPreview } from './rendering/terrain-preview';
import { RegionArt } from './rendering/region-art';
import { CoastalCar, type CarState } from './vehicles/coastal-car';
import { findCarExit } from './vehicles/car-exit';
import {worldEditTarget} from './input/world-edit-target';
import {StreetLife} from './rendering/street-life';
import {addExplorationSites,EXPLORATION_SITES} from './world/exploration-sites';
import {ExplorationArt} from './exploration/exploration-art';
import {discoveryPrompt,visibleFrom,type DiscoveryId,type DiscoveryPrompt} from './gameplay/discoveries';
import {Fieldbook,dismissReadingPanels} from './ui/fieldbook';
import {destinationById} from './gameplay/navigation';
import {handleGameShortcut} from './input/game-shortcuts';
import {GroundDetail} from './rendering/ground-detail';
import {CoastalLife} from './rendering/coastal-life';
import {WalkTransitions} from './rendering/walk-transitions';
import type {GroundInteraction} from './input/ground-actions';
import {CoastalJourney} from './gameplay/coastal-journey';
import {JourneyPanel} from './ui/journey';
import {JourneyArt} from './rendering/journey-art';
import {OuterCoast} from './rendering/outer-coast';
import {addOuterLandmarks} from './world/outer-landmarks';
import {SignalConsole} from './ui/signal-console';
import {SouthBay} from './rendering/south-bay';
import {addSouthBayLandmarks} from './world/south-bay-landmarks';
import type {BayState} from './gameplay/south-bay';
import {voxelSurfaceFinish} from './rendering/voxel-surface-finish';
import {planVoxelDamage} from './destruction/voxel-damage';
import {validJourneySlot,journeyURL} from './persistence/journeys';
import {NeighborhoodDetail} from './rendering/neighborhood-detail';
import {addHarborPassage} from './world/harbor-passage';
import {HarborPassage,type CoastOutingSave} from './gameplay/harbor-passage';
import {HarborPassageArt} from './rendering/harbor-passage';
import {AdaptiveResolution} from './rendering/adaptive-resolution';
import {generateResponseYard,RESPONSE_YARD_VERSION,ResponseYardTarget,ResponseYardProps,YARD_FOOTINGS,YARD_CAR} from './world/response-yard';

async function boot(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#world')!;
  const root = document.querySelector<HTMLElement>('#interface')!;
  let tool: Tool = 'observe';
  let ready = false;
  let saveState: 'saving' | 'saved' | 'error' | 'loading' = 'loading';
  let reloading = false;
  let changingSave = false;
  const isLab = new URLSearchParams(location.search).get('scene') === 'collapse-lab';
  const isYard=new URLSearchParams(location.search).get('scene')==='physics-yard';
  const isCollisionAudit=new URLSearchParams(location.search).get('scene')==='collision-audit';
  const dressed=!isLab&&!isYard;
  const worldVersion = isLab ? LAB_WORLD_VERSION : isYard?RESPONSE_YARD_VERSION:isCollisionAudit?`${WORLD_VERSION}-collision-audit`:WORLD_VERSION;
  const journeySlot=validJourneySlot(new URLSearchParams(location.search).get('journey'));
  canvas.dataset.journeySlot=journeySlot??'original';
  let lastPose = '';
  let controller: FlightController | undefined;
  let environment: Environment | undefined;
  let persistence: WorldPersistence | undefined;
  let physics: CollapsePhysics | undefined;
  let restoredFragments: RubbleFragment[] = [];
  let restoredProps:DecorationState[]=[];
  const originalCells=new Map<string,number>();let generatingDecor=true;
  let restoredTraffic:TrafficBodyState[]=[];
  const removedTraffic=new Set<number>();let clearingTraffic=false;
  let restoredEdits: Array<{ x: number; y: number; z: number; material: number }> = [];
  let pendingSpawn: { fragments: RubbleFragment[]; revisions: Map<string, number> } | undefined;
  let labShotIndex = 0;
  let collapseEvents = 0;
  let lastImpact = 0;
  let helicopter: Helicopter | undefined;
  let restoredVehicle: HelicopterState | undefined;
  let resumeTourOnReady=false;
  let piloting = false;
  let car: CoastalCar | undefined;
  let restoredCar: CarState | undefined;
  let driving = false;
  let bicycle:Bicycle|undefined;let cycling=false;let restoredBicycle:BicycleState|undefined;
  let boat:CoastalBoat|undefined;let boating=false;let restoredBoat:BoatState|undefined;
  let carObstacles: SceneObstacle[] = [];
  let helicopterObstacles:SceneObstacle[]=[];
  let recording = false;
  let recordAbort:AbortController|undefined;
  let muted = true;
  const coastAmbience=new CoastalAmbience();
  let walker: WalkingController | undefined;
  let exploration: 'fly' | 'walk' = 'fly';
  let currentPlace = 'market';
  let restoredView: WalkingViewMode = 'third';
  let restoredPosture:{kind:'seated';seatId:string}|undefined;
  let nearbyObstacles: SceneObstacle[] = [];
  const sceneCollisions=new SceneCollisionIndex();
  let trafficObstacleRevision=0,indexedObstacleRevision=-1;
  let trafficScenery:SceneObstacle[]=[];
  const discoveries=new Set<DiscoveryId>();
  let trackedDestination='harbor';
  let fieldbook:Fieldbook|undefined;
  const journey=new CoastalJourney();let journeyPanel:JourneyPanel|undefined;
  let restoredBay:BayState|undefined;let lastBayNotes='';
  let restoredCoast:CoastOutingSave|undefined;
  let signalConsole:SignalConsole|undefined;let inspectionPose:{position:Vector3;rotation:import('three').Quaternion;fov:number}|undefined;
  let lastVehicleRecovery=-Infinity;

  const ui = new Interface(root, {
    onTool: selectTool,
    onHelpOpen:()=>{fieldbook?.setOpen(false);releaseControlsForOverlay();},
    onMenuOpen:releaseControlsForOverlay,
    onTime: (hour) => {
      environment?.setHour(hour);
      savePose();
    },
    onStart: () => {
      if (!ready) return;
      closeReadingPanels();
      if (driving || piloting || cycling) { canvas.focus(); return; }
      if (exploration === 'walk') void walker?.start();
      else void controller?.start();
    },
    onHome: home,
    onExport: () => { void exportSave(); },
    onImport: (file) => { void importSave(file); },
    onReset: () => { void resetSave(); },
    onListJourneys:()=>persistence?.listJourneys()??Promise.resolve([]),
    onChooseJourney:slot=>{void switchJourney(slot);},
    onNewJourney:()=>{void switchJourney(`trip-${Date.now().toString(36)}-${crypto.randomUUID().slice(0,8)}`);},
    onLab: () => { void changeScene(true); },
    onCity: () => { void changeScene(false); },
    onLabBlast: labBlast,
    onPilot: () => setPilot(true),
    onExitPilot: exitHelicopter,
    onReturnToPad:returnToHelipad,
    onBicycle:()=>setBicycleRiding(true),
    onExitBicycle:()=>setBicycleRiding(false),
    onBoat:()=>setBoating(true),
    onExitBoat:exitBoat,
    onDrive: () => setCarDriving(true),
    onExitDrive: () => setCarDriving(false, true),
    onResetLook:()=>{if(boating)boat?.resetLook();else if(cycling)bicycle?.resetLook();else if(driving)car?.resetLook();else if(piloting)helicopter?.resetLook();canvas.focus();},
    onRecoverCar:recoverCurrentVehicle,
    onRecoverVehicle:recoverCurrentVehicle,
    onClearTraffic:()=>{void clearNearbyTraffic();},
    onAutopilot: toggleCruise,
    onStartTour: startCruise,
    onMapNavigate:(id,drive)=>trackDestination(id,drive),
    onFieldbook:()=>fieldbook?.toggle(),
    onTourExplore:mode=>{
      if(!ready)return;
      trackedDestination=mode==='car'?'tidal-rescue':'harbor';
      if(mode==='car'){setCarDriving(true);ui.toast('沿地图金色路线开往南湾，停车后走绿色栈道，靠近救援箱按 E 调查。');}
      else startWalking('harbor');
      savePose();
    },
    onRecord:recordAction,
    onBeginRecording:settings=>{void captureFlight(settings);},
    onStopRecording:()=>recordAbort?.abort(),
    onWalk: () => startWalking(),
    onFreeFly: startFreeFlight,
    onPlace: id => startWalking(id),
    onWeather: setWeather,
    onToggleView: () => { if (ready && exploration === 'walk') { walker?.toggleView(); canvas.focus(); } },
    onOverview: overview,
    onRainNight: () => {
      if (!ready || isLab) return;
      selectTool('observe');
      environment?.setHour(19.4); ui.setTime(19.4);
      setWeather('rain'); startWalking('market');
    },
    onSound: () => {
      if (!helicopter) return;
      muted = !muted;
      helicopter?.setMuted(muted);
      coastAmbience.setEnabled(!muted);
      ui.setSoundEnabled(!muted);
      journeyPanel?.setSoundEnabled(!muted);
    },
  });
  ui.configureCollapse(isLab);
  ui.configureVehicle(dressed);
  ui.configureCar(!isLab);
  ui.setLoading(0, '正在唤醒海岸');
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch (error) {
    ui.setLoading(1);
    ui.toast('无法启动 WebGL2。请使用支持硬件加速的现代桌面浏览器。', true);
    throw error;
  }
  // Keep the 3D buffer modest on dense displays; DOM text/maps remain native
  // resolution. A 1.5x buffer added 125% pixels to every sea/shadow frame.
  const basePixelRatio=Math.min(window.devicePixelRatio,1.25),adaptiveResolution=new AdaptiveResolution();
  renderer.setPixelRatio(basePixelRatio);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = .94;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.info.autoReset = false;
  const scene = new Scene();
  const gpuWarmup=new GpuWarmup(renderer);
  const camera = new PerspectiveCamera(52, 1, 0.15, 6500);
  camera.rotation.order = 'YXZ';
  environment = new Environment(scene, renderer);
  const impacts = new ImpactEffects(scene, camera);

  const { world, spawn, lookAt, buildings } = isLab ? generateCollapseLab(WORLD_SEED) : isYard?generateResponseYard():generateWorld(WORLD_SEED);
  const particles = new EditParticles(scene,world);
  if (dressed) {
    addHarborQuarter(world, buildings);
    ui.setLoading(.03, '正在连接海岸与外围山地');
    await new Promise<void>(resolve => requestAnimationFrame(()=>resolve()));
    addRegionalTerrain(world);
    addRegionalDistricts(world, buildings);
    addHarborPassage(world,buildings);
    addExplorationSites(world,buildings);
    addSouthBayLandmarks(world,buildings);
    addOuterLandmarks(world,buildings);
  }
  registerNaturalTrees(world,buildings);
  buildings.captureFoundations(world);
  camera.position.set(spawn.x, spawn.y, spawn.z);
  camera.lookAt(lookAt.x, lookAt.y, lookAt.z);
  if (dressed) {
    camera.position.set(HELICOPTER_SPAWN.x + 21, HELICOPTER_SPAWN.y + 10, HELICOPTER_SPAWN.z + 28);
    camera.lookAt(HELICOPTER_SPAWN.x, HELICOPTER_SPAWN.y + 4, HELICOPTER_SPAWN.z - 15);
  }
  const homePosition = camera.position.clone();
  const homeRotation = camera.rotation.clone();

  persistence = new WorldPersistence({
    worldVersion,
    slot:journeySlot,
    seed: WORLD_SEED,
    bounds: world.bounds,
    onStatus: (status, message) => {
      saveState = status;
      ui.setSaveStatus(status, message);
      canvas.dataset.saveStatus = status;
    },
  });
  ui.setJourneySlot(journeySlot);
  try {
    const saved = await persistence.load();
    if (saved) {
      for(const p of saved.edits)originalCells.set(`${p.x},${p.y},${p.z}`,world.getVoxel(p.x,p.y,p.z));
      world.applyEdits(saved.edits);
      restoredEdits = saved.edits;
      restoredFragments = saved.rubble ?? [];
      restoredVehicle = saved.vehicle;
      resumeTourOnReady=saved.vehicle?.tourStatus==='active';
      if (saved.player) {
        restoredBay=saved.player.bay;
        restoredCoast=saved.player.coast;
        if(saved.player.journey)journey.restore(saved.player.journey);
        saved.player.discoveries?.forEach(id=>discoveries.add(id));
        if(saved.player.navigationTarget)trackedDestination=saved.player.navigationTarget;
        if(journey.state.active&&journey.chapter)trackedDestination=journey.chapter.target;
        restoredCar = saved.player.car;
        restoredBicycle=saved.player.bicycle;
        restoredBoat=saved.player.boat;
        restoredPosture=saved.player.posture;
        restoredTraffic=saved.player.traffic??[];restoredProps=saved.player.props??[];
        saved.player.removedTraffic?.forEach(id=>removedTraffic.add(id));
        camera.position.copy(saved.player.position);
        camera.rotation.set(saved.player.rotation.x, saved.player.rotation.y, saved.player.rotation.z, 'YXZ');
        if (!isLab) {
          exploration = saved.player.mode ?? 'fly';
          restoredView = saved.player.view ?? 'third';
          environment.setWeather(saved.player.weather ?? 'clear');
        }
      }
      if (saved.timeOfDay !== undefined) environment.setHour(saved.timeOfDay);
      if (saved.edits.length || restoredFragments.length) ui.toast(`已恢复 ${saved.edits.length.toLocaleString()} 处改动、${restoredFragments.length} 块废墟`);
    }
  } catch (error) {
    ui.toast(`存档读取失败：${errorMessage(error)}。当前世界可探索，原存档未被重置。`, true);
  }
  ui.setTime(environment.hour);
  ui.setWeather(environment.weather);
  environment.setTerrain(world);
  const decorWorld=new Proxy(world,{get(target,key){if(key==='getVoxel')return(x:number,y:number,z:number)=>generatingDecor?(originalCells.get(`${x},${y},${z}`)??target.getVoxel(x,y,z)):target.getVoxel(x,y,z);const v=Reflect.get(target,key);return typeof v==='function'?v.bind(target):v;}});
  const coastalArt = !dressed ? undefined : new CoastalArt(scene, decorWorld, buildings, { facades: false, headlands: false });
  const streetArt = !dressed ? undefined : new StreetArt(scene, decorWorld, buildings,{people:false,parkedStates:restoredTraffic});
  const regionArt = !dressed ? undefined : new RegionArt(scene, decorWorld);
  const neighborhood=!dressed?undefined:new NeighborhoodDetail(scene,decorWorld,buildings);
  const entrances=!dressed?undefined:new BuildingEntrances(scene,world,buildings);
  const routeLandscape=dressed?new RouteLandscape(scene,decorWorld):undefined;
  generatingDecor=false;originalCells.clear();
  routeLandscape?.sync();
  for(const art of [coastalArt,streetArt,regionArt,neighborhood])art?.sync(world.chunks.keys());
  streetArt?.clearTraffic(removedTraffic);
  const walkTransitions=!dressed?undefined:new WalkTransitions(scene,world);
  const groundDetail = !dressed ? undefined : new GroundDetail(scene, world);
  const coastalLife = !dressed ? undefined : new CoastalLife(scene, world);
  const explorationArt=!dressed?undefined:new ExplorationArt(scene,world);
  const southBay=dressed?new SouthBay(scene,world,restoredBay):undefined;
  const harborPassage=dressed?new HarborPassage(world,restoredCoast):undefined;
  const harborPassageArt=harborPassage?new HarborPassageArt(scene,world,harborPassage):undefined;
  explorationArt?.setCompleted(discoveries);
  const outerCoast=dressed?new OuterCoast(scene,world):undefined;
  if(dressed)signalConsole=new SignalConsole(root,{
    open:site=>{closeReadingPanels();releaseControlsForOverlay();inspectionPose={position:camera.position.clone(),rotation:camera.quaternion.clone(),fov:camera.fov};if(site==='cape-signal'){camera.position.set(-237,35,110);camera.lookAt(-190,26,157);camera.fov=76;}else{camera.position.set(-68.3,68.3,-223.5);camera.lookAt(-64,68,-224.5);camera.fov=65;}camera.updateProjectionMatrix();},
    change:tuning=>{explorationArt?.setCalibration(tuning);if(tuning.site==='forest-radio'&&tuning.bearing!==18){camera.position.set(-82,78,-210);camera.lookAt(-63,74,-222);camera.fov=60;camera.updateProjectionMatrix();}},
    complete:site=>completeDiscovery(site,true),
    close:()=>{explorationArt?.setCalibration(undefined);if(inspectionPose){camera.position.copy(inspectionPose.position);camera.quaternion.copy(inspectionPose.rotation);camera.fov=inspectionPose.fov;camera.updateProjectionMatrix();inspectionPose=undefined;}savePose();},
  });
  const streetLife=!dressed?undefined:new StreetLife(scene,world,{surfaceAt:(x,z,maxTop)=>walkTransitions?.heightAt(x,z,maxTop)??null,removedTraffic:[...removedTraffic]});
  const yardProps=isYard?new ResponseYardProps(scene):undefined;yardProps?.sync(world);
  const yardTarget=isYard?new ResponseYardTarget(scene):undefined;
  streetLife?.pedestrianObstacles.forEach(bounds=>{bounds.standable=false;});
  if(dressed)ui.setMapTerrain(world);
  fieldbook=!dressed?undefined:new Fieldbook(root,EXPLORATION_SITES,{track:id=>trackDestination(id),interact:interactNearby,onOpen:()=>{if(ui.isHelpOpen)ui.toggleHelp();releaseControlsForOverlay();}});
  fieldbook?.setCompleted(discoveries);
  const journeyArt=dressed?new JourneyArt(scene,world):undefined;
  if(dressed)journeyPanel=new JourneyPanel(root,journey,()=>{
    if(!ready)return;
    if(journey.complete&&journey.state.experience==='coastal-day'){trackDestination('west-cape');return;}
    const beginning=journey.complete||journey.state.step===0&&!journey.state.active;
    if(beginning)journey.beginCoastalRoute();else journey.state={...journey.state,active:!journey.state.active};
    if(journey.state.active){trackedDestination=journey.chapter.target;if(!driving&&!piloting&&!cycling)startWalking(beginning?'market':undefined);ui.toast('旧城 → 码头 → 南湾 → 西岬。地图沿路指引，可以随时停下。声音可在更多选项中开启。');}
    journeyPanel?.update();savePose();
  },()=>document.querySelector<HTMLButtonElement>('[data-action="sound"]')?.click());
  const rain = !dressed ? undefined : new Rain(scene, world);
  rain?.setEnabled(environment.weather === 'rain');
  const wetStreets = !dressed ? undefined : new WetStreets(scene, world, environment.wetness, (x,z)=>rain!.surfaceHeightAt(x,z));
  ui.setLoading(0.08, '正在铺开街区');

  const voxelMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 });
  const nightUniform = environment.night;
  voxelMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = nightUniform;
    shader.uniforms.uWet = environment!.wetness;
    shader.uniforms.uRainRoof = { value: rain?.surfaceTexture ?? null };
    shader.uniforms.uWorldOrigin = { value: new Vector2(world.bounds.minX,world.bounds.minZ) };
    shader.uniforms.uWorldSize = { value: new Vector2(world.bounds.maxX-world.bounds.minX,world.bounds.maxZ-world.bounds.minZ) };
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float glow;\nvarying float vVoxelGlow;\nvarying vec3 vCoastWorld;\nvarying float vCoastUp;');
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvVoxelGlow = glow;\nvCoastWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvCoastUp = (mat3(modelMatrix) * normal).y;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vVoxelGlow;\nvarying vec3 vCoastWorld;\nvarying float vCoastUp;\nuniform float uNight;\nuniform float uWet;\nuniform sampler2D uRainRoof;\nuniform vec2 uWorldOrigin;\nuniform vec2 uWorldSize;\nfloat coastHash(vec3 p){return fract(sin(dot(p,vec3(12.9898,78.233,37.719)))*43758.5453);}');
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\nfloat room = coastHash(floor(vCoastWorld / vec3(4.0) + vec3(0.002)));\ntotalEmissiveRadiance += mix(vec3(1.0,0.45,0.14),vec3(0.55,0.72,0.81),step(0.9,room)) * vVoxelGlow * uNight * mix(0.09,0.82,step(0.40,room));');
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nfloat roof = texture2D(uRainRoof,clamp((vCoastWorld.xz-uWorldOrigin)/uWorldSize,0.001,0.999)).r*255.0;\nfloat greenSurface = step(diffuseColor.r*1.13,diffuseColor.g)*step(diffuseColor.b*1.1,diffuseColor.g);\nfloat surfaceWet = uWet * smoothstep(0.55,0.95,vCoastUp) * step(roof-0.08,vCoastWorld.y) * (1.0-greenSurface);\nroughnessFactor = mix(roughnessFactor,0.24,surfaceWet);\nroughnessFactor = mix(roughnessFactor, 0.17, clamp(vVoxelGlow, 0.0, 1.0));');
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= 0.98 + coastHash(floor(vCoastWorld + vec3(0.002))) * 0.04;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.12, clamp(vVoxelGlow, 0.0, 1.0));');
  };
  const wetVoxelShader=voxelMaterial.onBeforeCompile.bind(voxelMaterial);
  voxelMaterial.onBeforeCompile=(shader,renderer)=>{wetVoxelShader(shader,renderer);voxelSurfaceFinish(shader);};
  voxelMaterial.customProgramCacheKey = () => 'mirror-coast-wet-voxel-v4-materials';
  ui.setLoading(.08, '正在初始化坍塌物理');
  let lastPedestrianNotice=-Infinity;
  physics = await CollapsePhysics.create(scene, voxelMaterial, {
    onPedestrianImpact:impact=>{if(!impact.player)return;car?.pedestrianImpact();const now=performance.now();if(now-lastPedestrianNotice>2000){lastPedestrianNotice=now;ui.toast(impact.kind==='fall'?'碰撞到行人，请减速停车；行人会在安全处起身。':'碰到行人，请减速让行。');}},
    pedestrianRecovery:(id,center)=>streetLife?.simulation.pedestrianRecoveryPosition(id,center)??null,
    onPedestrianRecovered:(id,feet)=>streetLife?.simulation.pedestrianRecovered(id,feet),
    onStateChange: (fragments) => {
      try { persistence!.recordFragments(fragments); }
      catch (error) { ui.toast(`废墟状态暂未保存：${errorMessage(error)}`, true); }
    },
    onImpact: (position, strength) => {
      const now = performance.now();
      if (now - lastImpact < 100) return;
      lastImpact = now;
      impacts.burst(position, Math.max(.5, Math.min(1.5, strength)));
    },
  });
  physics.restore(restoredFragments);
  physics.restoreTraffic(restoredTraffic.filter(s=>!removedTraffic.has(s.id)));
  const boatLandings=dressed?new BoatLandings(scene,world):undefined;
  const decorPhysics=new DecorationPhysics(scene,world,physics,restoredProps);
  for(const [scope,art]of [['coast',coastalArt],['street',streetArt],['region',regionArt],['neighborhood',neighborhood],['route',routeLandscape]] as const)if(art)decorPhysics.register(scope,art.decorationParts());
  if(yardProps)decorPhysics.register('yard',yardProps.parts);
  decorPhysics.invalidate(restoredEdits.map(p=>`${p.x>>5},${p.y>>5},${p.z>>5}`));
  if (!isLab) {
    if(!isYard){
    helicopter = Helicopter.create(scene, physics, world, { onNotice: (message) => ui.toast(message),canLand:()=>helipadClear(world,nearbyScene(HELIPAD.position,12,Infinity,true).filter(b=>!helicopter?.ownObstacles.includes(b))),flightObstacles:()=>[...sceneObstacleGroups().flat(),...physics!.walkObstacles.filter(b=>!helicopter?.ownObstacles.includes(b))] });
    if (restoredVehicle) helicopter.restore(restoredVehicle);
    helicopter.setMuted(muted);
    helicopter.setObstacleProvider(()=>helicopterObstacles);
    ui.setVehicleState(helicopter.viewState);
    }
    car = CoastalCar.create(scene, physics, world, { onNotice: message => ui.toast(message),onImpact:(position)=>{particles.spawn(position,false);ui.toast('发生碰撞，车身正在回稳；动力未受损。受阻可倒车脱离，翻覆可用道路救援。');} });
    if (restoredCar) car.restore(restoredCar);
    else if(dressed)car.restore({position:{x:274,y:16.85,z:154},heading:-Math.PI/2,speed:0});
    else if(isYard)car.restore({position:YARD_CAR,heading:-Math.PI/2,speed:0});
    car.setObstacleProvider(() => carObstacles);
    car.setSurfaceProvider((x,z,maxTop)=>walkTransitions?.heightAt(x,z,maxTop)??null);
    car.setRecoveryObstacleProvider(()=>sceneObstacleGroups().flat());
    ui.setCarState(car.viewState);
  }
  const supportDirty=new Set<string>();
  const colliderRevisions = new Map<string, number>();
  const meshes = new Map<string, Mesh<BufferGeometry, MeshStandardMaterial>>();
  const terrainPreview = !dressed ? undefined : new TerrainPreview(scene,world);
  const meshQueue = new MeshQueue(world, (result) => {
    physics!.syncChunk(result);
    colliderRevisions.set(result.key, result.revision);
    queueMicrotask(()=>terrainPreview?.hideColumnWhenReady(result.cx,result.cz,world,key=>meshQueue.hasCurrentMesh(key)));
    const previous = meshes.get(result.key);
    if (!result.indices.length) {
      if (previous) { scene.remove(previous); previous.geometry.dispose(); meshes.delete(result.key); }
      return;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(result.positions, 3));
    geometry.setAttribute('normal', new BufferAttribute(result.normals, 3));
    geometry.setAttribute('color', new BufferAttribute(result.colors, 3));
    geometry.setAttribute('glow', new BufferAttribute(result.glow, 1));
    geometry.setAttribute('surfaceId',new BufferAttribute(result.surfaceId,1));
    geometry.setIndex(new BufferAttribute(result.indices, 1));
    geometry.computeBoundingSphere();
    // Pre-upload nearby editable surfaces. Warming the entire remote region
    // forced an extra offscreen pass for every streamed chunk while driving.
    // Remote meshes still install their real geometry/collider immediately and
    // upload normally if actually visible; nothing is removed from the world.
    const warmFocus=cycling&&bicycle?bicycle.position:driving&&car?car.position:piloting&&helicopter?helicopter.position:exploration==='walk'&&walker?walker.motor.position:camera.position;
    if(Math.hypot(result.cx*32+16-warmFocus.x,result.cz*32+16-warmFocus.z)<192)gpuWarmup.geometry(geometry);
    if (previous) {
      previous.geometry.dispose(); previous.geometry = geometry;
    } else {
      const mesh = new Mesh(geometry, voxelMaterial);
      // Streaming installs physics immediately. Let the LOD owner reveal a new
      // detailed column, instead of flashing/drawing a remote full mesh once.
      mesh.visible=!terrainPreview;
      mesh.position.set(result.cx * CHUNK_SIZE, result.cy * CHUNK_SIZE, result.cz * CHUNK_SIZE);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      meshes.set(result.key, mesh);
      scene.add(mesh);
    }
  });
  const streaming = new RegionStreaming(world,meshQueue,camera.position);
  const naturalQueue=new NaturalSupportQueue(world,buildings,applyCollapse);naturalQueue.enqueue(restoredEdits);
  const structureQueue = new StructureQueue(world, buildings, applyCollapse);
  structureQueue.enqueue(buildings.affectedBy(restoredEdits).map((building) => building.id));

  const target = new LineSegments(new EdgesGeometry(new BoxGeometry(1.035, 1.035, 1.035)), new LineBasicMaterial({ color: 0xffd291, transparent: true, opacity: .9 }));
  target.visible = false;
  scene.add(target);
  const direction = new Vector3();

  controller = new FlightController(camera, canvas, {
    onAction: edit,
    onActiveChange: (active) => { if (!piloting && exploration === 'fly') ui.setFlying(active); if (!active) savePose(); },
    primaryDrag: () => tool === 'observe',
    onMouseMode: mode => { if (!piloting && exploration === 'fly') ui.setMouseMode(mode); },
    onTool: (index) => selectTool((['observe', 'carve', 'blast'] as Tool[])[index]),
    onHelp: () => ui.toggleHelp(),
    onHome: home,
    onFallback: () => ui.toast('WASD 水平移动；Space / E 上升，Q 下降；拖动转向。'),
  }, world.bounds,new ObserverMotor(world,()=>nearbyObstacles,dressed?12:0));
  refreshObstacles(camera.position);
  if(exploration==='fly'&&controller.recoverPosition())ui.toast('已将地下视角移回地表上方。');
  const walkingCamera = new WalkingCamera(scene, world, () => nearbyObstacles);
  walkingCamera.setMode(restoredView);
  walker = new WalkingController(camera, canvas, world, {
    onAction: edit,
    onActiveChange: active => { if (exploration === 'walk') ui.setFlying(active); if (!active) savePose(); },
    onTool: index => selectTool((['observe', 'carve', 'blast'] as Tool[])[index]),
    onHelp: () => ui.toggleHelp(), onHome: home,
    primaryDrag: () => tool === 'observe',
    onMouseMode: mode => { if (exploration === 'walk') ui.setMouseMode(mode); },
    onViewChange: mode => { ui.setWalkView(mode); savePose(); },
    onFallback: () => ui.toast('拖动画面或按住右键转向；WASD 行走，C 切换视角。'),
    onRecover: reason => ui.toast(reason==='water'?'前方是深水，已返回最近的岸上落脚点。可沿岸行走或改走栈桥。':'落脚位置被占用，已移到附近安全地面。'),
    onNotice:message=>ui.toast(message),
  }, walkingCamera);
  walker.motor.setObstacleProvider(() => nearbyObstacles);
  walker.motor.setRecoveryProbe(p=>{nearbyObstacles=nearbyScene(p,16,Infinity);nearbyObstacles.push(...walkTransitions?.nearby(p)??[]);});
  walker.setSeatProvider(()=>[...coastalArt?.seats??[],...streetArt?.seats??[],...regionArt?.seats??[],...southBay?.seats??[]]);
  walker.setEnabled(exploration === 'walk' && !isLab);
  controller.setEnabled(exploration !== 'walk');
  if (exploration === 'walk') {
    walker.teleport(walkingDestination(camera.position));
    if(restoredPosture)walker.restoreSeat(restoredPosture.seatId);
    camera.fov = 64; camera.updateProjectionMatrix();
    currentPlace = [...STREET_PLACES].sort((a,b) => Math.hypot(a.position.x-camera.position.x,a.position.z-camera.position.z)-Math.hypot(b.position.x-camera.position.x,b.position.z-camera.position.z))[0].id;
  }
  ui.setExploration(exploration === 'walk', currentPlace);
  ui.setWalkView(walker.viewMode);
  if(dressed&&!isYard){bicycle=new Bicycle(scene,world,canvas,()=>!ui.isHelpOpen&&!ui.isMenuOpen&&!fieldbook?.isOpen&&!signalConsole?.isOpen);bicycle.setObstacleProvider(()=>[...nearbyScene(bicycle!.position,16,8,true,false),...walkTransitions?.nearby(bicycle!.position)??[]]);bicycle.setRecoveryObstacleProvider(p=>[...nearbyScene(p,24,Infinity,true,false),...walkTransitions?.nearby(p)??[]]);if(restoredBicycle)bicycle.restore(restoredBicycle);ui.setBicycleState(bicycle.viewState);}
  if(dressed){boat=new CoastalBoat(scene,world,canvas,()=>!ui.isHelpOpen&&!ui.isModalOpen&&!ui.isMenuOpen&&!fieldbook?.isOpen,(x,z)=>environment!.waterHeightAt(x,z));boat.setObstacleProvider(p=>nearbyScene(p,20,Infinity,true,true,false));if(restoredBoat)boat.restore(restoredBoat);ui.setBoatState(boat.viewState);}

  if(isYard){
    root.classList.add('is-response-yard');
    const location=root.querySelector('.mc-location small');if(location)location.textContent='SEED 048271 · 256 × 256 M · PHYSICS YARD';
    const panel=document.createElement('section');panel.className='mc-response-yard';panel.setAttribute('aria-label','物理试车场');
    panel.innerHTML='<strong>物理试车场</strong><small>独立存档 · 自由驾驶与挖除</small><div><button data-yard="foundation-view">查看地基</button><button data-yard="foundation-cut">挖空四处地基</button><button data-yard="ledge-position">断边试车位</button><button data-yard="ledge-cut">挖空左侧轮下地面</button><button data-yard="collision">碰撞起点</button><button data-yard="nature-view">查看土坡与树木</button><button data-yard="rubble-view">近看落定废墟</button><button data-yard="bench-view">近看长椅</button><button data-yard="soil-cut">挖空土坡</button><button data-yard="tree-cut">挖断树根</button><button data-yard="bench-cut">挖空长椅支撑</button><button data-yard="record">录制试车画面</button></div>';
    root.append(panel);
    const placeCar=(position:Vec3)=>{if(driving)setCarDriving(false);car!.restore({position,heading:-Math.PI/2,speed:0});setCarDriving(true);};
    panel.querySelector('[data-yard="foundation-view"]')!.addEventListener('click',()=>home());
    panel.querySelector('[data-yard="foundation-cut"]')!.addEventListener('click',()=>{if(!ready)return;for(const p of YARD_FOOTINGS)for(let y=19;y>=16;y--)damageAt({x:p.x+.5,y:y+.5,z:p.z+.5},false);});
    panel.querySelector('[data-yard="ledge-position"]')!.addEventListener('click',()=>placeCar(YARD_CAR));
    panel.querySelector('[data-yard="ledge-cut"]')!.addEventListener('click',()=>{if(!ready)return;for(let x=61;x<=69;x++)for(let z=159;z<=163;z++)for(let y=15;y>=13;y--)damageAt({x:x+.5,y:y+.5,z:z+.5},false);});
    panel.querySelector('[data-yard="collision"]')!.addEventListener('click',()=>placeCar({x:110,y:16.85,z:164}));
    panel.querySelector('[data-yard="nature-view"]')!.addEventListener('click',()=>{home();camera.position.set(142,28,156);camera.lookAt(126,20,133);savePose();});
    panel.querySelector('[data-yard="rubble-view"]')!.addEventListener('click',()=>{const f=physics!.snapshot().filter(f=>f.buildingId.startsWith('tree-')).sort((a,b)=>b.voxels.length-a.voxels.length)[0]??physics!.snapshot()[0];if(!f)return;home();camera.position.set(f.position.x+9,f.position.y+5,f.position.z+12);camera.lookAt(f.position.x,f.position.y,f.position.z);selectTool('carve');savePose();});
    panel.querySelector('[data-yard="bench-view"]')!.addEventListener('click',()=>{home();const p=decorPhysics.snapshot().find(s=>s.id.startsWith('yard:'))?.position??{x:119.5,y:16.5,z:142.5};camera.position.set(p.x+3,p.y+9,p.z+5);camera.lookAt(p.x,p.y,p.z);savePose();});
    panel.querySelector('[data-yard="soil-cut"]')!.addEventListener('click',()=>damageAt({x:136.5,y:17,z:135.5},true));
    panel.querySelector('[data-yard="tree-cut"]')!.addEventListener('click',()=>damageAt({x:122.5,y:15.5,z:130.5},false));
    panel.querySelector('[data-yard="bench-cut"]')!.addEventListener('click',()=>damageAt({x:119.5,y:14.6,z:142.5},true));
    panel.querySelector('[data-yard="record"]')!.addEventListener('click',recordAction);
  }

  document.addEventListener('keydown', (event) => {
    if(signalConsole?.isOpen){if(event.code==='Escape'){event.preventDefault();event.stopImmediatePropagation();signalConsole.close();}return;}
    handleGameShortcut(event,{ready,isLab,helpOpen:ui.isHelpOpen,menuOpen:ui.isMenuOpen,tourOpen:ui.isModalOpen,mapOpen:ui.isMapOpen,fieldbookOpen:fieldbook?.isOpen??false,hasFieldbook:!!fieldbook,walking:exploration==='walk',piloting,driving,cycling,boating,observing:tool==='observe'}, {
      toggleHelp:()=>ui.toggleHelp(),toggleFieldbook:()=>fieldbook?.toggle(),closeFieldbook:()=>fieldbook?.setOpen(false),releaseControls:releaseControlsForOverlay,
      escape:()=>{if(boating)exitBoat();else if(cycling)setBicycleRiding(false);else if(piloting){if(helicopter?.viewState.grounded)exitHelicopter();else{setPilot(false);ui.toast('已悬停并释放驾驶；落地后按 F 下机，H 自动返航降落。');}}else if(driving)setCarDriving(false,true);else{controller?.stop();walker?.stop();}},
      togglePilot:()=>{if(piloting)exitHelicopter();else setPilot(true);},home,toggleMap:()=>ui.toggleMap(),interact:interactNearby,
      returnToPad:returnToHelipad,exitVehicle:()=>{if(boating)exitBoat();else if(cycling)setBicycleRiding(false);else if(piloting)exitHelicopter();else if(driving)setCarDriving(false,true);},
      recoverVehicle:recoverCurrentVehicle,
      record:recordAction,presentation:()=>ui.togglePresentation(),
      closeMenu:()=>{ui.closeMenu();canvas.focus();},
    });
  }, {capture:true});

  const resize = () => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    controller?.stop();
    walker?.stop();
    helicopter?.setPiloting(false);
    car?.setDriving(false);
    ui.toast('图形上下文中断。请等待存档完成后刷新页面。', true);
    void persistence?.flush().catch(() => undefined);
  });

  ui.setLoading(.08,'正在准备日夜与雨滴材质');
  const endWeatherWarmup=rain?.prepareMaterials(),endDecorationWarmup=decorPhysics.prepareMaterials();
  const warmGeometry=new BoxGeometry(1,1,1),count=warmGeometry.getAttribute('position').count;
  warmGeometry.setAttribute('color',new BufferAttribute(new Float32Array(count*3).fill(1),3));
  warmGeometry.setAttribute('glow',new BufferAttribute(new Float32Array(count),1));
  warmGeometry.setAttribute('surfaceId',new BufferAttribute(new Float32Array(count).fill(7),1));
  const warmVoxel=new Mesh(warmGeometry,voxelMaterial);scene.add(warmVoxel);
  cullInactiveSceneLights(scene);
  try{
    await environment.prewarm(renderer,camera);
    await wetStreets?.prewarm(renderer,scene,camera);
    await gpuWarmup.textures(scene);
    if(rain)renderer.initTexture(rain.surfaceTexture);
  }finally{endWeatherWarmup?.();endDecorationWarmup();scene.remove(warmVoxel);warmGeometry.dispose();}

  let last = performance.now();
  let previousWork:Record<string,number>={};
  let frames = 0;
  let sampleTime = 0;
  let poseTimer = 0;
  let savedSeatId=walker?.actions.posture?.seatId;
  let targetTimer = 0;
  let smoothFrameMs = 16.7;
  let frameWindow:number[]=[];let shadowTimer=0;
  let vehicleTimer = 0;
  let discoveryTimer=0;
  renderer.setAnimationLoop((now) => {
    const workStart=performance.now();const work:Record<string,number>={};let workMark=workStart;const markWork=(name:string)=>{const t=performance.now();work[name]=t-workMark;workMark=t;};
    const elapsed = Math.max(0.001, (now - last) / 1000);
    if(elapsed>.05&&ready)canvas.dataset.lastFrameStall=JSON.stringify({gapMs:elapsed*1000,previousWork,visible:document.visibilityState});
    const dt = Math.min(elapsed, .05);
    const detailDistance=160+(adaptiveResolution.scale-.8)*800;
    last = now;
    const bodyPosition = exploration === 'walk' && walker ? walker.motor.position : null;
    const playerPosition = boating&&boat?boat.position:cycling&&bicycle?bicycle.position:driving && car ? car.position : bodyPosition;
    streetArt?.setPlayerPosition(playerPosition, driving ? 2.7 : .84);
    streetArt?.syncTraffic(physics!.trafficSnapshot(true));
    streetArt?.update(dt, playerPosition ?? camera.position, environment!.night.value, environment!.wetness.value,detailDistance);
    work.streetArt=performance.now()-workStart;
    let actorMark=performance.now();
    ensureSceneIndex();
    work.sceneIndex=performance.now()-actorMark;actorMark=performance.now();
    streetLife?.update(ready&&!changingSave&&!reloading?dt:0,{
      focus:playerPosition??camera.position,
      ...(bodyPosition||cycling&&bicycle?{player:{position:bodyPosition??bicycle!.position,radius:cycling?.55:.4}}:{}),
      ...(car?{vehicle:{position:car.position,heading:car.snapshot().heading,speed:car.viewState.speed}}:{}),
      night:environment!.night.value,wetness:environment!.wetness.value,
      trafficPhysics:physics!.trafficSnapshot(true),
      pedestrianPhysics:physics!.pedestrianSnapshot(),
      obstacles:trafficScenery,
      obstacleRevision:trafficObstacleRevision,dynamicObstacles:[...sceneCollisions.moving,...physics!.walkObstacles,...decorPhysics.obstacles,...bicycle?.obstacles??[]],
    });
    work.streetLife=performance.now()-actorMark;actorMark=performance.now();
    if(streetLife||yardTarget)physics!.syncActorObstacles([...streetLife?.obstacles??[],...streetLife?.pedestrianObstacles??[],...streetArt?.vehicleObstacles??[],...yardTarget?.obstacles??[]],dt);
    work.actorColliders=performance.now()-actorMark;actorMark=performance.now();
    refreshObstacles(playerPosition ?? camera.position);
    if (car) carObstacles = [...nearbyScene(car.position,20,8,false),...walkTransitions?.nearby(car.position)??[]];
    if(helicopter)helicopterObstacles=nearbyScene(helicopter.position,32,Infinity,false);
    work.obstacleQueries=performance.now()-actorMark;
    if (ready && !changingSave && !reloading && !piloting && !driving && !cycling && !boating && !signalConsole?.isOpen&&!ui.isMenuOpen) {
      if (exploration === 'walk') walker!.update(dt);
      else controller!.update(dt);
    }
    if(ready&&!changingSave&&!reloading){
      const seatId=walker?.actions.posture?.seatId;
      if(seatId!==savedSeatId){
        savedSeatId=seatId;savePose();
        void persistence?.flush().catch(error=>ui.toast(`姿态保存失败：${errorMessage(error)}`,true));
      }
    }
    markWork('actorsAndInput');
    const focus = boating&&boat?boat.position:cycling&&bicycle?bicycle.position:driving && car ? car.position : piloting && helicopter ? helicopter.position : bodyPosition ?? camera.position;
    streaming.update(dt,focus);
    environment!.update(dt, focus);
    boatLandings?.update(environment!.night.value);
    coastalArt?.update(dt, focus,detailDistance);
    regionArt?.update(dt, focus, environment!.night.value,detailDistance);
    neighborhood?.update(dt,focus,environment!.night.value);
    groundDetail?.update(dt, focus);
    routeLandscape?.update(dt,focus);
    walkTransitions?.update(focus);
    if(dressed)coastAmbience.update(dt,focus,exploration==='walk'&&!cycling&&!driving&&!piloting&&!!walker?.isActive&&!!walker?.grounded,world.getVoxel(Math.floor(focus.x),Math.floor(focus.y-.05),Math.floor(focus.z)),environment!.wetness.value,environment!.night.value);
    coastalLife?.update(dt, focus, environment!.night.value, environment!.wetness.value);
    harborPassageArt?.update(dt,environment!.night.value,EXPLORATION_SITES[2].anchors.every(p=>!!world.getVoxel(p.x,p.y,p.z)));
    southBay?.update(dt,focus,environment!.night.value,walker?.actions.posture?.seatId);
    explorationArt?.update(dt,environment!.night.value);
    if(signalConsole?.isOpen){
      walker?.motor.update(dt,{x:0,z:0});
      const site=EXPLORATION_SITES.find(s=>s.id===signalConsole?.activeSite);
      if(!walker?.grounded||!site?.anchors.every(p=>!!world.getVoxel(p.x,p.y,p.z)))signalConsole.close();
    }
    signalConsole?.update(dt);outerCoast?.update(dt,focus,environment!.night.value,discoveries.has('cape-signal'));
    if(outerCoast)canvas.dataset.outerCoast=JSON.stringify(outerCoast.diagnostics);
    car?.setNight(environment!.night.value);
    rain?.update(dt, camera);
    wetStreets?.update(dt, camera);
    particles.update(dt);
    impacts.update(dt);
    markWork('environmentAndDetail');
    meshQueue.update(ready?1:2);
    physics!.prepareStaticTerrain();
    terrainPreview?.update(dt,focus,key=>meshQueue.hasCurrentMesh(key),key=>meshes.get(key),detailDistance);
    markWork('meshUploads');
    if (!ready) {
      const progress = Math.max(.08, streaming.initialProgress);
      ui.setLoading(progress, '正在铺开附近街道，远景随后展开');
      if (streaming.initialReady) {
        ready = true;
        document.querySelector<HTMLElement>('#app')!.dataset.ready = 'true';
        ui.setLoading(1);
        if(resumeTourOnReady){resumeTourOnReady=false;if(restoredVehicle?.flightMode==='return'){returnToHelipad();ui.toast('已从保存位置继续自动返航，正在重新检查通路。');}else{startCruise();ui.toast('已恢复自动游览，从刚才的航段接着飞；可随时暂停。');}}
        else if(restoredBoat?.piloting){restoredBoat.piloting=false;setBoating(true);}
        else if(restoredBicycle?.riding){restoredBicycle.riding=false;setBicycleRiding(true);}
      }
    }
    if (ready && !changingSave && !reloading) {
      let physicsMark=performance.now();
      if (pendingSpawn && [...pendingSpawn.revisions].every(([key, revision]) => (colliderRevisions.get(key) ?? -1) >= revision)) {
        // Newly detached bodies must never hit the obsolete building collider.
        const started=performance.now();let added=0;
        do{physics!.addFragments([pendingSpawn.fragments.shift()!]);added++;}while(pendingSpawn.fragments.length&&added<2&&performance.now()-started<2.5);
        if(!pendingSpawn.fragments.length)pendingSpawn=undefined;
      }
      helicopter?.beforePhysics(dt);
      car?.beforePhysics(dt);
      const supportAccepted=[...supportDirty].every(key=>meshQueue.hasCurrentMesh(key));
      physics!.wakeUnsupported(supportAccepted&&!pendingSpawn);
      if(supportAccepted)supportDirty.clear();
      work.physicsPreparation=performance.now()-physicsMark;physicsMark=performance.now();
      physics!.update(dt);
      work.physicsStep=performance.now()-physicsMark;physicsMark=performance.now();
      decorPhysics.update(key=>meshQueue.hasCurrentMesh(key));
      work.decorationDetach=performance.now()-physicsMark;physicsMark=performance.now();
      helicopter?.afterPhysics(dt, camera);
      car?.afterPhysics(dt, camera);
      bicycle?.update(dt,cycling?camera:undefined);
      boat?.update(dt,boating?camera:undefined,environment!.night.value);
      if(boat)environment!.setBoatWake(boat.position,boat.headingAngle,boat.viewState.speed);
      if(boating&&boat?.dismountReady)exitBoat();
      if(cycling&&bicycle?.dismountReady)setBicycleRiding(false);
      yardTarget?.update(physics!.trafficSnapshot(true));
      work.vehicleFollow=performance.now()-physicsMark;physicsMark=performance.now();
      structureQueue.update(!pendingSpawn&&!changingSave?MAX_ACTIVE_FRAGMENTS-physics!.activeCount:0);
      naturalQueue.update(!pendingSpawn&&!changingSave?MAX_ACTIVE_FRAGMENTS-physics!.activeCount:0);
      work.supportAnalysis=performance.now()-physicsMark;
    }
    markWork('physicsAndSupport');
    environment?.setCameraPosition(camera.position);
    canvas.dataset.underwater=String(environment?.isUnderwater??false);
    targetTimer += dt;
    if (targetTimer >= .08 && ready && !piloting && !driving && !boating) {
      targetTimer = 0;
      const hit = tool==='observe'?null:currentEditTarget();
      target.visible = hit !== null && tool !== 'observe';
      if(hit){
        const pose=hit.kind==='fragment'?physics!.fragmentCellPose(hit):null;
        if(pose){target.position.copy(pose.position);target.quaternion.copy(pose.rotation);}else{target.position.set(hit.x+.5,hit.y+.5,hit.z+.5);target.quaternion.identity();}
      }
      ui.setTarget(hit&&hit.kind==='fragment'?{x:Math.floor(target.position.x),y:Math.floor(target.position.y),z:Math.floor(target.position.z),distance:hit.distance}:hit);
    }
    if (piloting || driving || cycling) target.visible = false;
    vehicleTimer += dt;
    if ((helicopter||car) && vehicleTimer >= .2) {
      vehicleTimer = 0;
      if(helicopter)ui.setVehicleState(helicopter.viewState);
      if (car) ui.setCarState(car.viewState);
      if(bicycle){ui.setBicycleState(bicycle.viewState);canvas.dataset.bicycle=JSON.stringify({...bicycle.snapshot(),...bicycle.viewState});}
      if(boat){ui.setBoatState(boat.viewState);canvas.dataset.boat=JSON.stringify({...boat.snapshot(),...boat.viewState});}
      if(entrances)canvas.dataset.entrances=JSON.stringify(entrances.diagnostics);
      const orbit=driving?car?.orbitState:piloting?helicopter?.orbitState:undefined;
      if(orbit)canvas.dataset.orbit=JSON.stringify(orbit);
      if(car)canvas.dataset.carMotion=JSON.stringify(car.motionDiagnostics);
      if(car)canvas.dataset.carState=JSON.stringify(car.viewState);
      if(helicopter)canvas.dataset.helicopterMotion=JSON.stringify(helicopter.motionDiagnostics);
      canvas.dataset.trafficPhysics=JSON.stringify(physics!.trafficSnapshot());
    }
    discoveryTimer+=dt;
    if(discoveryTimer>.1 && ready){discoveryTimer=0;updateExplorationGuide(focus);}
    shadowTimer+=dt;
    if(shadowTimer>.25){shadowTimer=0;for(const mesh of meshes.values()){const dx=mesh.position.x+16-focus.x,dz=mesh.position.z+16-focus.z;mesh.castShadow=dx*dx+dz*dz<150*150;}}
    markWork('guidesAndSelection');
    renderer.info.reset();
    renderer.render(scene, camera);
    markWork('render');work.total=performance.now()-workStart;previousWork=work;
    work.drawCalls=renderer.info.render.calls;work.triangles=renderer.info.render.triangles;
    if(adaptiveResolution.update(elapsed,work.render,work.total-work.render,ready&&!recording&&document.visibilityState==='visible'))renderer.setPixelRatio(basePixelRatio*adaptiveResolution.scale);
    canvas.dataset.renderScale=String(adaptiveResolution.scale);
    if(work.total>40)canvas.dataset.lastHeavyFrame=JSON.stringify(work);
    if(work.total>Number(canvas.dataset.worstFrameMs??0)){canvas.dataset.worstFrameMs=String(work.total);canvas.dataset.worstFrame=JSON.stringify(work);}
    frames++;
    sampleTime += elapsed;
    if(document.visibilityState==='visible'){frameWindow.push(elapsed*1000);if(frameWindow.length>300)frameWindow.shift();}
    smoothFrameMs += (elapsed * 1000 - smoothFrameMs) * .04;
    if (sampleTime >= .5) {
      const sortedFrames=[...frameWindow].sort((a,b)=>a-b);canvas.dataset.framePacing=JSON.stringify({samples:sortedFrames.length,p50:sortedFrames[Math.floor(sortedFrames.length*.5)]??0,p95:sortedFrames[Math.floor(sortedFrames.length*.95)]??0,max:sortedFrames.at(-1)??0,over50:sortedFrames.filter(t=>t>50).length});
      ui.setStats({
        fps: Math.round(frames / sampleTime), frameMs: smoothFrameMs,
        chunks: meshes.size, drawCalls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        pending: meshQueue.pending, edits: persistence!.editCount,
        activeFragments: physics!.activeCount,
        settledFragments: physics!.settledCount,
        supportPending: structureQueue.pending+naturalQueue.pending,
      });
      canvas.dataset.decorations=JSON.stringify(decorPhysics.diagnostics);
      canvas.dataset.collisionIndex=JSON.stringify(sceneCollisions.diagnostics);
      if(routeLandscape)canvas.dataset.routeLandscape=JSON.stringify(routeLandscape.diagnostics);
      if(terrainPreview)canvas.dataset.terrainLOD=JSON.stringify(terrainPreview.diagnostics);
      if(dressed)canvas.dataset.coastalSound=JSON.stringify(coastAmbience.diagnostics);
      if(streetLife){canvas.dataset.streetLife=JSON.stringify(streetLife.diagnostics);canvas.dataset.trafficActors=JSON.stringify(streetLife.simulation.cars.map(c=>({id:c.id,position:c.position,heading:c.heading,speed:c.speed,visible:c.visible,bypass:!!c.bypass,physical:!!c.physicsRotation,travelled:c.travelled})));canvas.dataset.pedestrians=JSON.stringify(streetLife.simulation.people.map(p=>({id:p.id,position:p.position,speed:p.speed,visible:p.visible,reaction:p.physical?.kind,phase:p.physical?.phase,rejoining:!!p.rejoining})));}
      if(groundDetail)canvas.dataset.groundDetail=JSON.stringify(groundDetail.diagnostics);
      if(neighborhood)canvas.dataset.neighborhood=JSON.stringify(neighborhood.diagnostics);
      if(walkTransitions)canvas.dataset.walkTransitions=JSON.stringify(walkTransitions.diagnostics);
      if(coastalLife)canvas.dataset.coastalLife=JSON.stringify(coastalLife.diagnostics);
      if(coastalArt)canvas.dataset.harborBoats=JSON.stringify(coastalArt.boatDiagnostics);
      const message = pendingSpawn ? '正在更新破坏后的碰撞' : physics!.activeCount ? `${physics!.activeCount} 组碎块正在下落` :
        structureQueue.pending ? '正在检查建筑支撑' : physics!.settledCount ? `${physics!.settledCount} 块废墟已落定 · 自动保存` : isLab ? '准备就绪 · 可试射支柱' : '建筑支撑检查已启用';
      ui.setCollapseState(message);
      const app = document.querySelector<HTMLElement>('#app')!;
      app.dataset.collapseEvents = String(collapseEvents);
      app.dataset.activeFragments = String(physics!.activeCount);
      app.dataset.settledFragments = String(physics!.settledCount);
      app.dataset.supportPending = String(structureQueue.pending+naturalQueue.pending);
      frames = 0; sampleTime = 0;
    }
    poseTimer += dt;
    if (poseTimer > 1) { poseTimer = 0; if (ready) savePose(); }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (piloting && !recording&&!helicopter?.suspendForVisibility()) setPilot(false);
      if (driving && !recording) setCarDriving(false);
      if(cycling)bicycle?.releaseControls();
      savePose(); void persistence!.flush().catch(() => undefined); controller?.stop(); walker?.stop();
    }else helicopter?.resumeAfterVisibility();
    last = performance.now();
  });
  window.addEventListener('pagehide', () => {
    if (!reloading) { savePose(); void persistence!.flush().catch(() => undefined); }
  });
  window.addEventListener('blur', () => { savePose(); void persistence!.flush().catch(() => undefined); });
  window.addEventListener('beforeunload', (event) => {
    if (saveState === 'saving') { event.preventDefault(); event.returnValue = ''; }
  });

  function selectTool(next: Tool): void {
    if(next!=='observe'&&exploration==='walk'&&walker?.actions.locked){ui.toast('请先起身或完成翻越，再使用挖除和爆破。');return;}
    controller?.cancelAction();walker?.cancelAction();
    if((piloting || driving || boating) && next!=='observe')return;
    tool = next;
    ui.setTool(next);
    walker?.setAiming(next!=='observe');
    if(next!=='observe' && ready && !changingSave && !piloting && !driving && !boating) {
      canvas.focus();
      if(exploration==='walk') { if(!walker?.isActive)void walker?.start(); }
      else if(!controller?.active)void controller?.start();
    }
  }

  function releaseControlsForOverlay():void{
    controller?.stop();walker?.stop();
    bicycle?.releaseControls();
    boat?.releaseControls();
    if(driving)car?.releaseControls();if(piloting&&helicopter){helicopter.releaseControls(false);ui.setVehicleState(helicopter.viewState);}
    if(document.pointerLockElement===canvas)document.exitPointerLock();
  }

  function closeReadingPanels():void{ui.closeMenu();dismissReadingPanels(fieldbook,ui);}

  function savePose(): void {
    if (!persistence || !environment || !ready || reloading || changingSave) return;
    const player: PlayerState = {
      position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
      rotation: { x: camera.rotation.x, y: camera.rotation.y, z: camera.rotation.z },
      mode: exploration, weather: environment.weather,
      view: walker?.viewMode ?? restoredView,
      car: car?.snapshot(),
      ...(bicycle?{bicycle:bicycle.snapshot()}:{}),
      ...(boat?{boat:boat.snapshot()}:{}),
      discoveries:[...discoveries],
      navigationTarget:trackedDestination,
      journey:{...journey.state},
      ...(southBay?{bay:southBay.snapshot}:{}),
      ...(harborPassage?{coast:harborPassage.snapshot}:{}),
      ...(exploration==='walk'&&walker?.actions.posture?{posture:walker.actions.posture}:{}),
      ...(decorPhysics.snapshot().length?{props:decorPhysics.snapshot()}:{}),
      traffic:physics!.trafficSnapshot(),
      ...(removedTraffic.size?{removedTraffic:[...removedTraffic].sort((a,b)=>a-b)}:{}),
    };
    if (exploration === 'walk' && walker) {
      player.position = { ...walker.pose.position };
      player.rotation = { ...walker.pose.rotation };
    }
    if(cycling&&bicycle){player.position={...bicycle.position,y:bicycle.position.y+1.68};player.rotation={x:0,y:bicycle.snapshot().heading,z:0};}
    if(boating&&boat){const pose=boat.snapshot();player.position={...pose.position,y:pose.position.y+1.68};player.rotation={x:0,y:boat.headingAngle,z:0};}
    const vehicle = helicopter?.snapshot();
    const signature = JSON.stringify([player, environment.hour, vehicle]);
    canvas.dataset.player = JSON.stringify(player.position);
    canvas.dataset.exploration = exploration;
    canvas.dataset.view = boating?'boat':cycling?'bicycle':driving ? 'car' : piloting ? 'helicopter' : exploration === 'walk' ? walker?.viewMode : 'free';
    canvas.dataset.mode = boating?'boat':cycling?'bicycle':driving ? 'car' : piloting ? 'helicopter' : exploration;
    if (car) {canvas.dataset.car = JSON.stringify(car.snapshot());canvas.dataset.carWheels=JSON.stringify(car.wheelContacts);}
    canvas.dataset.camera = JSON.stringify({ x: camera.position.x, y: camera.position.y, z: camera.position.z });
    canvas.dataset.look = JSON.stringify(player.rotation);
    if (signature === lastPose) return;
    lastPose = signature;
    persistence.setPlayer(player, environment.hour);
    if (vehicle) persistence.setVehicle(vehicle);
  }

  function home(): void {
    if (!ready || !controller) return;
    closeReadingPanels();
    stopBicycle();stopBoat();
    if (piloting) setPilot(false);
    if (driving) setCarDriving(false);
    walker?.setEnabled(false); exploration = 'fly'; controller.setEnabled(true); ui.setExploration(false);
    controller.stop();
    camera.fov = 52; camera.updateProjectionMatrix();
    camera.position.copy(homePosition);
    camera.rotation.copy(homeRotation);
    savePose();
    ui.toast('已回到海湾观景点');
  }

  function overview(): void {
    if (!ready || changingSave) return;
    closeReadingPanels();
    stopBicycle();stopBoat();
    if (piloting) setPilot(false);
    if (driving) setCarDriving(false);
    walker?.setEnabled(false); controller?.setEnabled(true); controller?.stop(); exploration = 'fly';
    camera.position.set(820, 560, 630); camera.lookAt(200, 25, -55);
    camera.fov = 60; camera.near = .15; camera.updateProjectionMatrix();
    ui.setExploration(false); ui.setFlying(false); ui.setMouseMode('paused'); savePose();
  }

  // One scene list feeds feet, road rescue, cars and helicopter cameras/bodies.
  // Cars receive the graded road triangles separately from the scenery index.
  function sceneObstacleGroups():readonly (readonly SceneObstacle[])[]{return [boatLandings?.obstacles??[],boat?.obstacles??[],journeyArt?.obstacles??[],harborPassageArt?.obstacles??[],coastalArt?.obstacles??[],streetArt?.obstacles??[],regionArt?.obstacles??[],southBay?.obstacles??[],outerCoast?.obstacles??[],neighborhood?.obstacles??[],entrances?.obstacles??[],routeLandscape?.obstacles??[],bicycle?.obstacles??[],explorationArt?.obstacles??[],streetLife?.obstacles??[],streetLife?.pedestrianObstacles??[],streetLife?.signalObstacles??[],decorPhysics.obstacles];}
  function ensureSceneIndex():void{
    if(indexedObstacleRevision===trafficObstacleRevision)return;
    const fixed=[boatLandings?.obstacles??[],journeyArt?.obstacles??[],harborPassageArt?.obstacles??[],coastalArt?.obstacles??[],streetArt?.obstacles??[],regionArt?.obstacles??[],southBay?.obstacles??[],outerCoast?.obstacles??[],neighborhood?.obstacles??[],entrances?.obstacles??[],routeLandscape?.obstacles??[],explorationArt?.obstacles??[],streetLife?.signalObstacles??[]];
    sceneCollisions.rebuild(fixed);
    trafficScenery=[...coastalArt?.obstacles??[],...streetArt?.obstacles??[],...regionArt?.obstacles??[],...neighborhood?.obstacles??[],...routeLandscape?.obstacles??[],...explorationArt?.obstacles??[]];
    indexedObstacleRevision=trafficObstacleRevision;
  }
  function nearbyScene(center:Vec3,radius=16,verticalRadius=Infinity,withPhysics=true,withBicycle=true,withBoat=true):SceneObstacle[]{
    ensureSceneIndex();
    return sceneCollisions.query(center,radius,verticalRadius,[streetLife?.obstacles??[],streetLife?.pedestrianObstacles??[],decorPhysics.obstacles,...withBoat?[boat?.obstacles??[]]:[],...withBicycle?[bicycle?.obstacles??[]]:[],...withPhysics?[physics?.walkObstacles??[]]:[]]);
  }
  function refreshObstacles(center: Vec3): void {
    nearbyObstacles = nearbyScene(center,16,8);
    nearbyObstacles.push(...walkTransitions?.nearby(center)??[]);
  }

  async function clearNearbyTraffic():Promise<void>{
    if(!ready||changingSave||reloading||clearingTraffic||!physics||!persistence||!streetLife)return;
    if(driving&&car&&Math.abs(car.viewState.speed)>.6){ui.toast('请先停车，再清理附近事故。');return;}
    const focus=driving&&car?car.position:cycling&&bicycle?bicycle.position:walker&&exploration==='walk'?walker.motor.position:camera.position;
    const nearby=physics.trafficSnapshot().filter(s=>Math.hypot(s.position.x-focus.x,s.position.z-focus.z)<=60&&Math.abs(s.position.y-focus.y)<16);
    if(!nearby.length){ui.toast('附近60米内没有需要清理的事故车辆。');canvas.focus();return;}
    const foot=walker&&exploration==='walk'&&!driving&&!cycling?walker.motor.position:undefined;
    const supportedBy=(id:number)=>{
      if(!foot)return false;
      const b=[...streetLife.obstacles,...streetArt?.vehicleObstacles??[]].find(b=>b.trafficId===id);
      return b&&foot.x>b.minX-.25&&foot.x<b.maxX+.25&&foot.z>b.minZ-.25&&foot.z<b.maxZ+.25&&foot.y>b.maxY-.5&&foot.y<b.maxY+.6;
    };
    const ids=new Set(nearby.filter(s=>!supportedBy(s.id)).map(s=>s.id));
    if(!ids.size){ui.toast('请先从事故车辆上走到地面，再进行清障。');return;}
    clearingTraffic=true;ui.setTrafficClearanceBusy(true);
    try{
      await new Promise<void>(resolve=>setTimeout(resolve,220));
      const result=streetLife.simulation.clearAccidents(ids,focus,b=>{
        const center={x:(b.minX+b.maxX)/2,y:(b.minY+b.maxY)/2,z:(b.minZ+b.maxZ)/2};
        return !nearbyScene(center,8,5).some(o=>!ids.has(o.trafficId??-1)&&o.maxY>o.minY&&obstaclesIntersect(b,o));
      });
      const parked=streetArt?.clearTraffic(ids)??[];
      for(const id of [...result.removed,...parked])removedTraffic.add(id);
      physics.clearTraffic(ids);
      refreshObstacles(focus);
      savePose();await persistence.flush();
      const count=ids.size;
      canvas.dataset.trafficClearance=JSON.stringify({count,resumed:result.resumed,removed:[...result.removed,...parked],remaining:physics.trafficSnapshot().length});
      ui.toast(`已清理附近 ${count} 辆事故车${result.resumed?`，${result.resumed} 辆已在其他街区恢复行驶`:'，道路占用已解除'}。${ids.size<nearby.length?'脚下车辆暂时保留，请先走到地面。':''}世界变化已保存；受损道路仍需处理。`);
    }catch(error){ui.toast(`清障状态未能完整保存：${errorMessage(error)}。请先导出当前存档。`,true);}
    finally{ui.setTrafficClearanceBusy(false);clearingTraffic=false;canvas.focus();}
  }

  function recoverCurrentVehicle():void{
    if(!ready||changingSave||reloading||(!boating&&!cycling&&!driving&&!piloting)||performance.now()-lastVehicleRecovery<1000)return;
    lastVehicleRecovery=performance.now();
    const recovered=boating?boat?.recoverNearby():cycling?bicycle?.recoverNearby():driving?car?.recoverNearby():helicopter?.recoverNearby();
    if(boat)ui.setBoatState(boat.viewState);
    if(bicycle)ui.setBicycleState(bicycle.viewState);if(car)ui.setCarState(car.viewState);if(helicopter)ui.setVehicleState(helicopter.viewState);
    ui.toast(recovered?boating?'小艇已回到可通航的深水，W 继续航行。':cycling?'自行车已挪到附近稳固地面，按 W 继续骑行。':driving?'汽车已扶正到安全地面，按 W 继续驾驶。':'直升机已脱离障碍并在附近安全空域悬停；按键可继续驾驶，H 重新返航。':'没有找到可安全停放的地点，载具保持原位。',!recovered);
    canvas.focus();savePose();
    if(recovered)void persistence?.flush().catch(error=>ui.toast(`脱困位置保存失败：${errorMessage(error)}`,true));
  }

  function nearbyInteraction():{kind:'boat'}|{kind:'harbor-log'}|{kind:'harbor-repair'}|{kind:'bell'}|{kind:'bicycle'}|{kind:'entrance'}|{kind:'bay';id:string}|{kind:'beach'}|{kind:'site';prompt:DiscoveryPrompt}|{kind:'car'}|{kind:'helicopter'}|{kind:'ground';action:GroundInteraction}|null {
    if(!ready||isLab||!walker||exploration!=='walk'||piloting||driving||tool!=='observe'||changingSave)return null;
    const eyes=walker.pose.position;
    const ground=walker.bodyInteraction;
    if(walker.actions.locked)return ground?{kind:'ground',action:ground}:null;
    if(boat?.canBoard(walker.motor.position)&&visibleFrom(world,eyes,boat.boardingPoint))return{kind:'boat'};
    if(walker.grounded&&harborPassage){
      if(harborPassage.nearLog(walker.motor.position,eyes))return{kind:'harbor-log'};
      if(harborPassage.status==='broken'&&Math.hypot(walker.motor.position.x-8,walker.motor.position.z-232.5)<3.3&&Math.abs(walker.motor.position.y-15)<.55)return{kind:'harbor-repair'};
    }
    if(bicycle&&walker.motor.position.distanceTo(bicycle.position)<2.2&&Math.abs(walker.motor.position.y-bicycle.position.y)<.7)return{kind:'bicycle'};
    if(ground?.kind==='sit'||ground?.kind==='stand')return{kind:'ground',action:ground};
    if(walker.grounded&&outerCoast?.bellNear(walker.motor.position)&&visibleFrom(world,eyes,{x:-193.2,y:22,z:130}))return{kind:'bell'};
    const bay=walker.grounded?southBay?.interaction(walker.motor.position):null;
    if(bay&&visibleFrom(world,eyes,{x:bay.position.x,y:bay.position.y+.55,z:bay.position.z}))return{kind:'bay',id:bay.id};
    if(walker.grounded&&journey.beachAvailable(walker.motor.position,exploration))return{kind:'beach'};
    const site=discoveryPrompt(world,eyes,EXPLORATION_SITES);
    if(site&&walker.grounded)return {kind:'site',prompt:site};
    if(ground)return{kind:'ground',action:ground};
    for(const [kind,vehicle]of [['car',car],['helicopter',helicopter]] as const){
      if(!vehicle)continue;
      const point={x:vehicle.position.x,y:vehicle.position.y+.4,z:vehicle.position.z};
      if(Math.hypot(eyes.x-point.x,eyes.y-point.y,eyes.z-point.z)<3.6&&visibleFrom(world,eyes,point))return kind==='car'?{kind:'car'}:{kind:'helicopter'};
    }
    if(entrances?.near(walker.motor.position))return{kind:'entrance'};
    return null;
  }

  function interactNearby():void {
    const interaction=nearbyInteraction();if(!interaction||signalConsole?.isOpen)return;
    if(interaction.kind==='harbor-repair'){repairHarborDeck();return;}
    if(interaction.kind==='harbor-log'){
      harborPassage!.readLog();
      if(discoveries.has('cape-signal')&&EXPLORATION_SITES.find(s=>s.id==='cape-signal')!.anchors.every(p=>!!world.getVoxel(p.x,p.y,p.z)))harborPassage!.linkBeacon();
      ui.toast(harborPassage!.state.beaconLinked?'航路记录仍在。西岬航标和渔港引航灯已接通，清出的通路也已保存。':'航路记录：南湾旧救援船曾沿这条航路归港，西岬航标方位 205°。记录已存入 J 手记；先取车去南湾。');savePose();void persistence?.flush().catch(error=>ui.toast(`航路记录保存失败：${errorMessage(error)}`,true));return;
    }
    if(interaction.kind==='bicycle'){setBicycleRiding(true);return;}
    if(interaction.kind==='boat'){setBoating(true);return;}
    if(interaction.kind==='entrance'){ui.toast('住宅／商店入口 · 这栋楼的室内尚未开放。渔港的开放门洞可以直接走入。');return;}
    if(interaction.kind==='bell'){outerCoast?.ringBell(!muted);ui.toast('铜钟随海风摇摆。');return;}
    if(interaction.kind==='bay'){ui.toast(southBay!.interact(interaction.id));if(interaction.id==='pool')trackedDestination='bay-overlook';else if(southBay!.snapshot.kiteFlying)trackedDestination=discoveries.has('tidal-rescue')?'bay-pools':'tidal-rescue';savePose();return;}
    if(interaction.kind==='beach'){ui.toast(journey.advance());trackedDestination=journey.chapter.target;journeyPanel?.update();savePose();return;}
    if(interaction.kind==='ground'){selectTool('observe');walker!.performGroundInteraction(interaction.action);savePose();return;}
    if(interaction.kind==='car'){setCarDriving(true);return;}
    if(interaction.kind==='helicopter'){setPilot(true);return;}
    const {site,intact}=interaction.prompt;
    if(intact&&(site.id==='cape-signal'||site.id==='forest-radio')){signalConsole?.open(site.id);return;}
    completeDiscovery(site.id as DiscoveryId,intact);
  }

  function completeDiscovery(id:DiscoveryId,intact:boolean):void{
    const definition=EXPLORATION_SITES.find(item=>item.id===id)!;
    if(id==='cape-signal'&&intact&&harborPassage?.linkBeacon()){savePose();void persistence?.flush().catch(error=>ui.toast(`航标状态保存失败：${errorMessage(error)}`,true));}
    if(discoveries.has(definition.id)){ui.toast(intact?definition.completedText:`已记录 ${definition.title} 的残骸。`);return;}
    discoveries.add(definition.id);explorationArt?.setCompleted(discoveries);fieldbook?.setCompleted(discoveries);
    ui.toast(intact?definition.completedText:`已记录 ${definition.title} 的残骸，装置已经损坏。`);
    trackedDestination=EXPLORATION_SITES.find(item=>!discoveries.has(item.id))?.id??'car';
    if(definition.id==='tidal-rescue')trackedDestination=southBay?.snapshot.notes.includes('kite')?'bay-pools':'bay-camp';
    if(definition.id==='cape-signal')trackedDestination='forest-glade';
    if(definition.id==='forest-radio')trackedDestination='ridge-lookout';
    savePose();void persistence?.flush().catch(error=>ui.toast(`探索记录保存失败：${errorMessage(error)}`,true));
  }

  function trackDestination(id:string,drive=false):void{
    if(!ready||!destinationById(id))return;
    if(journey.state.active&&!journey.trackStop(id)){journey.state.active=false;journeyPanel?.update();}
    trackedDestination=id;closeReadingPanels();
    selectTool('observe');
    if(drive)setCarDriving(true);
    else if(piloting||driving||cycling)canvas.focus();
    else if(exploration==='walk')void walker?.start();else void controller?.start();
    savePose();ui.toast(`已追踪${destinationById(id)!.name}，缩略地图显示位置与参考路线。`);
  }

  function updateExplorationGuide(focus:Vec3):void {
    if(!fieldbook)return;
    if(exploration==='walk'&&!cycling&&!driving&&!piloting){const place=STREET_PLACES.reduce((best,p)=>Math.hypot(p.position.x-focus.x,p.position.z-focus.z)<Math.hypot(best.position.x-focus.x,best.position.z-focus.z)?p:best);if(place.id!==currentPlace&&Math.hypot(place.position.x-focus.x,place.position.z-focus.z)<60){currentPlace=place.id;ui.setExploration(true,currentPlace);}}
    journeyArt?.update();
    if(harborPassage){const status=harborPassage.status;canvas.dataset.harborPassage=JSON.stringify(harborPassageArt?.diagnostics);fieldbook.setCoast(harborPassage.snapshot,status);journeyPanel?.setPassage(status,harborPassage.state.logRead);}
    if(outerCoast?.gladeObserved&&trackedDestination==='forest-glade'){trackedDestination='forest-radio';ui.toast('林间鸟群重新落回枝头。沿小径回到木阶，登台调试电台。');savePose();}
    document.querySelector<HTMLElement>('#app')!.dataset.outerFocus=focus.x< -150||focus.x<0&&focus.z< -175?'true':'false';
    document.querySelector<HTMLElement>('#app')!.dataset.bayFocus=focus.x>560&&focus.z>110&&focus.z<240?'true':'false';
    fieldbook.setJourney(journey.state.step,journey.state.active,journey.state.route,journey.state.experience,journey.chapterHint);
    if(southBay){
      const state=southBay.snapshot;fieldbook.setBay(state.notes);
      const signature=state.notes.join(',');if(signature!==lastBayNotes){if(state.notes.includes('vista')&&!lastBayNotes.includes('vista')){ui.toast('海蚀门眺望已留在手记里。下一段海岸可以去西岬旧航标；先回公路取车。');if(state.notes.length===3&&discoveries.has('tidal-rescue'))trackedDestination='cape-signal';}lastBayNotes=signature;savePose();}
      canvas.dataset.southBay=JSON.stringify(southBay.diagnostics);
    }
    const reward=journey.update(.1,focus,cycling?'bicycle':driving?'car':piloting?'helicopter':exploration,walker?.actions.posture?.seatId,{bayNotes:southBay?.snapshot.notes,discoveries,harborLog:harborPassage?.state.logRead,beaconLinked:harborPassage?.state.beaconLinked});
    if(reward){ui.toast(reward);if(journey.chapter)trackedDestination=journey.chapter.target;journeyPanel?.update();savePose();}
    const directed=journey.navigationTarget(focus,cycling?'bicycle':driving?'car':piloting?'helicopter':exploration);if(directed)trackedDestination=directed;
    canvas.dataset.journey=JSON.stringify(journey.state);
    const tour=helicopter?.viewState,displayTarget=piloting&&tour?.flightMode==='return'?'helipad':trackedDestination;
    const place=destinationById(displayTarget);
    const destination=displayTarget==='helicopter'?helicopter?.position:displayTarget==='car'?car?.position:displayTarget==='bicycle'?bicycle?.position:place?.position;
    if(destination){
      const dx=destination.x-focus.x,dz=destination.z-focus.z;
      camera.getWorldDirection(direction);
      const relative=Math.atan2(dx,-dz)-Math.atan2(direction.x,-direction.z);
      const arrows=['↑','↗','→','↘','↓','↙','←','↖'];
      const arrow=arrows[(Math.round(relative/(Math.PI/4))%8+8)%8];
      fieldbook.setRoute(displayTarget,place?.name??'探索地点',Math.hypot(dx,dz),arrow);
    }
    camera.getWorldDirection(direction);
    ui.setMapState({position:focus,bearing:Math.atan2(direction.x,-direction.z),mode:boating?'boat':cycling?'bicycle':driving?'car':piloting?'helicopter':exploration,target:displayTarget,completed:discoveries,boat:boat?.position,car:car?.position,bicycle:bicycle?.position,helicopter:helicopter?.position,tourIndex:piloting&&tour&&tour.flightMode!=='return'&&tour.tourStatus!=='idle'?tour.routeIndex:undefined,autotouring:!!tour?.autopilot&&tour.flightMode!=='return'});
    const interaction=nearbyInteraction();
    fieldbook.setPrompt(!interaction?null:interaction.kind==='boat'?'驾驶海岸小艇':interaction.kind==='harbor-log'?'查看航路记录 · 西岬 205°':interaction.kind==='harbor-repair'?'用备用木板补齐支栈桥缺口':interaction.kind==='bicycle'?'骑上自行车':interaction.kind==='entrance'?'查看建筑入口':interaction.kind==='bell'?'拉动海风铜钟':interaction.kind==='bay'?southBay!.label(interaction.id):interaction.kind==='beach'?'记录潮线漂流木 · 沿海一日':interaction.kind==='ground'?interaction.action.label:interaction.kind==='car'?'驾驶旅行车':interaction.kind==='helicopter'?'登上直升机':
      discoveries.has(interaction.prompt.site.id as DiscoveryId)?`${interaction.prompt.site.id==='tidal-rescue'?'查看':'再次调试'} ${interaction.prompt.site.title}`:
      interaction.prompt.intact?interaction.prompt.site.actionHint:`调查 ${interaction.prompt.site.title} 残骸`);
    canvas.dataset.discoveries=JSON.stringify([...discoveries]);
    if(walker&&exploration==='walk'&&!driving&&!piloting&&!cycling)canvas.dataset.look=JSON.stringify(walker.pose.rotation);
    if(walker){const boardingHint=!interaction&&walker.actions.phase==='standing'?coastalArt?.mooredBoats.boardingHint(walker.motor.position):undefined;ui.setGroundState(walker.actions.phase,boardingHint??walker.actions.status);canvas.dataset.groundAction=JSON.stringify({phase:walker.actions.phase,...walker.actions.motion,position:{...walker.motor.position},posture:walker.actions.posture});}
  }

  let nextEditAt=0;
  function edit(): void {
    if (!ready || !persistence || changingSave || piloting || driving || cycling || boating || tool === 'observe') return;
    if(performance.now()<nextEditAt)return;
    const hit = currentEditTarget();
    if (!hit) return;
    if(hit.kind==='fragment'){
      try{
        const change=physics!.planFragmentEdit(hit,tool==='blast');if(!change?.removed)return;
        persistence!.recordWorldChange({edits:[],removeFragmentIds:change.removeFragmentIds,upsertFragments:change.fragments});physics!.applyFragmentEdit(change);
        particles.spawn(hit.point,tool==='blast');if(tool==='blast')impacts.burst(hit.point,1);
        nextEditAt=performance.now()+(tool==='blast'?700:160);
        canvas.dataset.lastEdit=JSON.stringify({fragmentId:hit.fragmentId,count:change.removed});
      }catch(error){ui.toast(`碎块未修改：${errorMessage(error)}`,true);}return;
    }
    if(damageAt({ x: hit.x + .5, y: hit.y + .5, z: hit.z + .5 }, tool === 'blast'))nextEditAt=performance.now()+(tool==='blast'?700:160);
    else if(hit.y<3)ui.toast('已经到达坚实基岩，无法继续挖穿。');
  }

  function currentEditTarget() {
    camera.getWorldDirection(direction);
    return worldEditTarget(world,physics!,camera.position,direction,exploration==='walk'&&walker?walker.pose.position:undefined);
  }

  function repairHarborDeck():void{
    if(!ready||changingSave||reloading||!persistence)return;
    // This is a local plank repair, never a world reset or obstacle respawn.
    const edits:{x:number;y:number;z:number;material:number}[]=[];
    for(let x=-14;x<=7;x++)for(let z=229;z<=235;z++)if(!world.getVoxel(x,14,z))edits.push({x,y:14,z,material:13});
    if(!edits.length)return;
    try{persistence.record(edits);}catch(error){ui.toast(`木板未铺设：${errorMessage(error)}`,true);return;}
    const keys=world.applyEdits(edits);afterTerrainDamage(edits,keys);meshQueue.commitEdits(keys);harborPassageArt?.sync();coastalArt?.sync(keys);streetArt?.sync(keys);walkTransitions?.sync(keys);scheduleTerrainRefresh(keys);savePose();
    ui.toast('支栈桥的缺口已经补齐。清掉的木箱不会重生，航路记录也会保留。');
  }

  function damageAt(center: Vec3, blast: boolean): number {
    if (!ready || !persistence || changingSave || reloading) return 0;
    const started=performance.now();
    const phases:Record<string,number>={};let phaseStarted=started;
    const markDamage=(name:string)=>{const now=performance.now();phases[name]=now-phaseStarted;phaseStarted=now;};
    const hit = { x: Math.floor(center.x), y: Math.floor(center.y), z: Math.floor(center.z) };
    const plan=planVoxelDamage(world,center,blast);
    if (!plan.edits.length) return 0;
    try { persistence.record(plan.edits); }
    catch (error) {
      controller?.stop();
      ui.toast(`本次修改未应用：${errorMessage(error)}`, true);
      return 0;
    }
    const result={edits:plan.edits,dirtyKeys:world.applyEdits(plan.edits)};
    afterTerrainDamage(result.edits,result.dirtyKeys);
    markDamage('planAndWorld');
    const meshStarted=performance.now();
    meshQueue.commitEdits(result.dirtyKeys);
    const meshMs=performance.now()-meshStarted;
    markDamage('meshCommit');
    coastalArt?.sync(result.dirtyKeys);markDamage('coast');
    harborPassageArt?.sync();markDamage('harbor');
    entrances?.sync();markDamage('entrances');
    regionArt?.sync(result.dirtyKeys);markDamage('region');
    neighborhood?.sync(result.dirtyKeys);markDamage('neighborhood');
    routeLandscape?.sync();markDamage('landscape');
    walkTransitions?.sync(result.dirtyKeys);markDamage('transitions');
    groundDetail?.sync(result.dirtyKeys);markDamage('ground');
    coastalLife?.sync(result.dirtyKeys);markDamage('life');
    explorationArt?.sync(result.dirtyKeys);markDamage('exploration');
    southBay?.sync();outerCoast?.sync();markDamage('outer');
    streetArt?.sync(result.dirtyKeys); wetStreets?.sync();markDamage('street');
    scheduleTerrainRefresh(result.dirtyKeys);
    markDamage('terrain');
    structureQueue.enqueue(buildings.affectedBy(result.edits).map((building) => building.id));
    savePose();
    particles.spawn(center, blast,plan.material);
    if (blast) impacts.burst(center, 1);
    canvas.dataset.lastEdit = JSON.stringify({ x: hit.x, y: hit.y, z: hit.z, count: result.edits.length });
    markDamage('finish');
    canvas.dataset.damageTiming=JSON.stringify({ms:performance.now()-started,meshMs,chunks:result.dirtyKeys.length,edits:result.edits.length,phases});
    return result.edits.length;
  }

  function afterTerrainDamage(edits:readonly {x:number;y:number;z:number}[],keys:string[]):void{
    trafficObstacleRevision++;
    yardProps?.sync(world);naturalQueue.enqueue(edits);decorPhysics.invalidate(keys);physics!.invalidateSupports(keys);for(const key of keys)supportDirty.add(key);
  }

  function applyCollapse(result: StructureResult): void {
    if (!result.edits.length || !result.fragments.length || !persistence) return;
    try {
      // Missing static voxels and their falling replacement are saved together.
      persistence.recordWorldChange({ edits: result.edits, upsertFragments: result.fragments });
      const dirtyKeys = world.applyEdits(result.edits);
      pendingSpawn = {
        fragments: result.fragments,
        revisions: new Map(dirtyKeys.map((key) => [key, world.chunks.get(key)!.revision])),
      };
      afterTerrainDamage(result.edits,dirtyKeys);
      meshQueue.commitEdits(dirtyKeys);
      coastalArt?.sync(dirtyKeys);
      entrances?.sync();
      regionArt?.sync(dirtyKeys);
      neighborhood?.sync(dirtyKeys);
      routeLandscape?.sync();
      walkTransitions?.sync(dirtyKeys);
      groundDetail?.sync(dirtyKeys);
      coastalLife?.sync(dirtyKeys);
      explorationArt?.sync(dirtyKeys);
      southBay?.sync();outerCoast?.sync();
      streetArt?.sync(dirtyKeys); wetStreets?.sync();
      scheduleTerrainRefresh(dirtyKeys);
      structureQueue.enqueue(buildings.affectedBy(result.edits).filter(b=>b.id!==result.buildingId).map(b=>b.id));
      collapseEvents++;
      ui.toast(`${result.buildingId.startsWith('tree-')?'树木':result.buildingId.startsWith('soil-')?'土层':'楼体'}失去支撑，正在脱落`);
    } catch (error) {
      ui.toast(`坍塌未应用：${errorMessage(error)}`, true);
    }
  }

  function setPilot(active: boolean): void {
    if (!ready || isLab || !helicopter || changingSave || reloading) return;
    if (active) {
      closeReadingPanels();
      stopBicycle();stopBoat();
      if (driving) setCarDriving(false);
      walker?.setEnabled(false); exploration = 'fly'; ui.setExploration(false);
      selectTool('observe');
      camera.fov = 52; camera.updateProjectionMatrix();
      controller?.setEnabled(false);
      piloting = true;
      helicopter.setPiloting(true);
      ui.setFlying(true);
      canvas.focus();
    } else {
      helicopter.setPiloting(false);
      piloting = false;
      controller?.setEnabled(true);
      ui.setFlying(false);
    }
    ui.setVehicleState(helicopter.viewState);
    savePose();
  }

  function putWalkerAt(feet:Vec3,yaw:number):void{
    refreshObstacles(feet);exploration='walk';controller?.setEnabled(false);walker!.setEnabled(true);const eye={...feet,y:feet.y+1.68};walker!.teleport(eye,{x:feet.x-Math.sin(yaw)*8,y:eye.y,z:feet.z-Math.cos(yaw)*8});camera.fov=64;camera.updateProjectionMatrix();ui.setExploration(true,currentPlace);ui.setFlying(false);ui.setMouseMode('paused');savePose();
  }
  function exitHelicopter():boolean{
    if(!ready||!helicopter||!walker)return false;const state=helicopter.viewState;if(!state.grounded||state.speed>.8){helicopter.releaseControls();ui.toast(state.waterStatus?'海面不能停机或下机：Space 上升，G 安全脱困，或 H 自动返航。':'需要先降落停稳才能下机：Shift 下降，或按 H 自动返航降落。');return false;}
    const q=helicopter.snapshot().rotation,yaw=Math.atan2(2*(q.w*q.y+q.x*q.z),1-2*(q.y*q.y+q.z*q.z));const feet=helicopterExit(world,helicopter.position,yaw,p=>{refreshObstacles(p);return walker!.motor.canOccupy(p);});if(!feet){ui.toast('机舱两侧没有安全落脚点，请调整停机位置。');return false;}setPilot(false);putWalkerAt(feet,yaw);ui.toast('已关闭引擎，在机旁下机。靠近飞机按 E 可重新登机。');return true;
  }
  function returnToHelipad():void{
    if(!ready||isLab||!helicopter||changingSave||reloading)return;
    closeReadingPanels();if(!piloting)setPilot(true);helicopter.startReturnHome();ui.setVehicleState(helicopter.viewState);canvas.focus();savePose();
  }
  function stopBoat():void{if(!boating)return;boating=false;boat?.setPiloting(false);if(boat)ui.setBoatState(boat.viewState);}
  function setBoating(active:boolean):void{
    if(!ready||!boat||!walker||changingSave||reloading)return;
    if(!active){exitBoat();return;}if(boating)return;
    closeReadingPanels();stopBicycle();if(piloting)setPilot(false);if(driving)setCarDriving(false);
    walker.setEnabled(false);controller?.setEnabled(false);exploration='fly';boating=true;boat.setPiloting(true);selectTool('observe');camera.fov=62;camera.updateProjectionMatrix();ui.setExploration(false);ui.setBoatState(boat.viewState);ui.setFlying(true);canvas.focus();if(!trackedDestination.startsWith('boat-'))trackedDestination='boat-bay';ui.toast('W 出航，A / D 操舵，Space 减速；M 查看靠泊点，靠岸停稳后 F 上岸。');savePose();
  }
  function exitBoat():boolean{
    if(!boating||!boat||!walker)return false;
    if(Math.abs(boat.viewState.speed)>.15){boat.requestDismount();ui.toast('正在减速，停稳后寻找船旁的安全上岸位置。');return false;}
    boat.cancelDismount();const feet=boat.exitPosition(p=>{refreshObstacles(p);return walker!.motor.canOccupy(p);});
    if(!feet){ui.toast('附近没有可安全上岸的地面。请驶近码头、南湾或西岬栈桥；M 查看靠泊点。');return false;}
    const yaw=boat.exitHeading(feet);stopBoat();putWalkerAt(feet,yaw);ui.toast('已靠泊上岸，小艇留在原处。沿木阶走向岸上，靠近小艇按 E 可再次出航。');return true;
  }
  function stopBicycle():void{if(!cycling)return;cycling=false;bicycle?.setRiding(false);if(bicycle)ui.setBicycleState(bicycle.viewState);}
  function setBicycleRiding(active:boolean):void{
    if(!ready||!bicycle||!walker||changingSave)return;if(active){closeReadingPanels();stopBoat();if(piloting)setPilot(false);if(driving)setCarDriving(false);walker.setEnabled(false);controller?.setEnabled(false);exploration='fly';cycling=true;bicycle.setRiding(true);ui.setExploration(false);ui.setFlying(true);canvas.focus();camera.fov=64;camera.updateProjectionMatrix();ui.toast('W 蹬车，Space 刹车，F / E 下车；鼠标拖动环视，M 查看地图。');}
    else{
      if(Math.abs(bicycle.viewState.speed)>.15){bicycle.requestDismount();ui.toast('正在刹车，停稳后再下车并放下脚撑。');return;}
      bicycle.releaseControls();
      if(!bicycle.canPark){ui.toast('脚撑处没有稳定地面，请挪到平坦开阔处再停车。');return;}
      const feet=bicycle.exitPosition(p=>{refreshObstacles(p);return walker!.motor.canOccupy(p);});
      if(!feet){ui.toast('车旁没有安全站立位置，请先挪到平坦开阔处。');return;}
      const yaw=bicycle.snapshot().heading;stopBicycle();putWalkerAt(feet,yaw);ui.toast('已停稳、放下脚撑。自行车留在原处，靠近按 E 继续骑行。');
    }ui.setBicycleState(bicycle.viewState);savePose();
  }

  function setCarDriving(active: boolean, exitOnFoot = false): void {
    if (!ready || isLab || !car || changingSave || reloading) return;
    let exitPosition: Vec3 | undefined;
    const pose = car.snapshot();
    if (!active && exitOnFoot && walker) {
      const feet=findCarExit(world,pose.position,pose.heading,candidate=>{refreshObstacles(candidate);return walker!.motor.canOccupy(candidate);},(x,z,maxTop)=>{refreshObstacles({x,y:pose.position.y-.85,z});return walker!.motor.surfaceAt(x,z,maxTop,2.2);});
      if(feet)exitPosition={...feet,y:feet.y+1.68};
      if(!exitPosition) {
        setCarDriving(false);
        ui.toast('两侧没有安全落脚点，已停车并释放控制。可重新接管，调整位置后下车。');
        return;
      }
    }
    if (active) {
      closeReadingPanels();
      stopBicycle();stopBoat();
      if (piloting) setPilot(false);
      walker?.setEnabled(false); controller?.setEnabled(false);
      exploration = 'fly'; driving = true; car.setDriving(true);
      selectTool('observe'); ui.setExploration(false); ui.setFlying(true);
      camera.fov = 58; camera.updateProjectionMatrix();
      canvas.focus();
    } else {
      car.setDriving(false); driving = false;
      ui.setFlying(false); controller?.setEnabled(true);
      if (exitPosition && walker) {
        const position = exitPosition;
        refreshObstacles(position);
        exploration = 'walk'; controller?.setEnabled(false); walker.setEnabled(true);
        walker.teleport(walkingDestination(position), {x:position.x-Math.sin(pose.heading)*10,y:position.y,z:position.z-Math.cos(pose.heading)*10});
        camera.fov = 64; camera.updateProjectionMatrix();
        currentPlace=[...STREET_PLACES].sort((a,b)=>Math.hypot(a.position.x-position.x,a.position.z-position.z)-Math.hypot(b.position.x-position.x,b.position.z-position.z))[0].id;
        ui.setExploration(true,currentPlace); void walker.start();
      }
    }
    ui.setCarState(car.viewState); savePose();
  }

  function setWeather(weather: 'clear' | 'rain'): void {
    if (!ready || isLab) return;
    environment?.setWeather(weather); rain?.setEnabled(weather === 'rain'); ui.setWeather(weather); savePose();
  }

  function startWalking(placeId?: string): void {
    if (!ready || isLab || changingSave || !walker) return;
    if(boating&&!placeId){if(exitBoat())void walker.start();return;}
    closeReadingPanels();
    stopBicycle();stopBoat();
    if (piloting) setPilot(false);
    if (driving) setCarDriving(false);
    controller?.setEnabled(false);
    const wasWalking = exploration === 'walk'; exploration = 'walk';
    walker.setEnabled(true);
    if (placeId || !wasWalking) {
      const place = STREET_PLACES.find(p => p.id === (placeId ?? currentPlace)) ?? STREET_PLACES[0];
      selectTool('observe'); refreshObstacles(place.position);
      const position = 'regional' in place ? { ...place.position,y:regionalHeightAt(place.position.x,place.position.z)+2.68 } : place.position;
      currentPlace = place.id; refreshObstacles(position); walker.teleport(walkingDestination(position), place.lookAt);
    }
    walker.setAiming(tool!=='observe');
    camera.fov = 64; camera.updateProjectionMatrix();
    ui.setExploration(true, currentPlace); void walker.start(); savePose();
  }

  function startFreeFlight(): void {
    if (!ready || changingSave) return;
    closeReadingPanels();
    stopBicycle();stopBoat();
    if (piloting) setPilot(false);
    if (driving) setCarDriving(false);
    walker?.setEnabled(false); exploration = 'fly'; controller?.setEnabled(true);
    camera.fov = 52; camera.updateProjectionMatrix();
    ui.setExploration(false); void controller?.start(); savePose();
  }

  function walkingDestination(position:Vec3):Vec3{
    const top=walkTransitions?.heightAt(position.x,position.z);
    return top!==null&&top!==undefined&&top+1.68>position.y?{...position,y:top+1.68}:position;
  }

  function scheduleTerrainRefresh(keys: string[]): void {
    terrainPreview?.invalidate(keys);
    if (!keys.some((key) => key.split(',')[1] === '0')) return;
    // Water must reveal the same excavated floor as the terrain and colliders.
    if(!reloading)environment?.setTerrain(world,keys);
  }

  function toggleCruise(): void {
    if (!ready || isLab || !helicopter || changingSave) return;
    if(!helicopter.viewState.autopilot){if(helicopter.viewState.flightMode==='return'&&!helicopter.viewState.routeComplete)returnToHelipad();else startCruise();return;}
    helicopter.setAutopilot(false);
    canvas.focus();
    ui.setVehicleState(helicopter.viewState);
    savePose();
  }

  function startCruise():void{
    if(!ready||isLab||!helicopter||changingSave||reloading)return;
    closeReadingPanels();
    if(!piloting)setPilot(true);
    helicopter.startTour();canvas.focus();ui.setVehicleState(helicopter.viewState);savePose();
  }

  function recordAction():void{if(!ready||changingSave)return;if(recording)recordAbort?.abort();else ui.openRecording();}

  async function captureFlight(settings:ClipSettings): Promise<void> {
    if (!ready || recording || changingSave) return;
    recording = true;
    recordAbort=new AbortController();
    ui.setRecording(true);
    canvas.focus();
    try {
      const blob = await recordClip(canvas,{...settings,signal:recordAbort.signal,onState:(phase,seconds,audio)=>{ui.recordingProgress(phase,seconds,audio);canvas.dataset.recording=JSON.stringify({phase,seconds,source:settings.source,audio});}});
      ui.finishRecording(blob);
    } catch (error) {const cancelled=error instanceof DOMException&&(error.name==='AbortError'||error.name==='NotAllowedError');ui.finishRecording(undefined,cancelled?undefined:`录制失败：${errorMessage(error)}`);if(cancelled)ui.toast('录制已取消，游戏与存档不受影响。');}
    finally { recording = false;recordAbort=undefined; ui.setRecording(false);canvas.dataset.recording='idle'; }
  }

  function labBlast(): void {
    if (!ready || !isLab || changingSave) return;
    controller?.stop();
    selectTool('blast');
    let changes = 0;
    for (let tries = 0; tries < LAB_SHOTS.length && !changes; tries++) {
      changes = damageAt(LAB_SHOTS[labShotIndex++ % LAB_SHOTS.length], true);
    }
    ui.toast(changes ? `支柱试射：移除 ${changes} 个体素，正在检查支撑` : '试射位置已破坏，可自由飞行检查或在菜单中重置试验场');
  }

  async function changeScene(lab: boolean): Promise<void> {
    if (!ready || changingSave || !persistence) return;
    controller?.stop(); savePose();
    changingSave = true;
    try {
      persistence.recordFragments(physics!.snapshot());
      await persistence.flush();
      reloading = true;
      const url = new URL(location.href);
      if (lab) url.searchParams.set('scene', 'collapse-lab');
      else url.searchParams.delete('scene');
      location.assign(url.href);
    } catch (error) { ui.toast(`切换前保存失败：${errorMessage(error)}`, true); }
    finally { changingSave = false; }
  }

  async function exportSave(): Promise<void> {
    if (!ready || !persistence || changingSave) return;
    controller?.stop(); savePose();
    changingSave = true;
    try {
      persistence.recordFragments(physics!.snapshot());
      const json = await persistence.exportSave();
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url; link.download = `mirror-coast-${isLab ? 'lab-' : ''}${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      ui.toast('世界存档已导出');
    } catch (error) { ui.toast(`导出失败：${errorMessage(error)}`, true); }
    finally { changingSave = false; }
  }

  async function importSave(file: File): Promise<void> {
    if (!ready || !persistence) return;
    controller?.stop();
    if (file.size > 32 * 1024 * 1024) { ui.toast('存档文件超过 32 MiB，无法导入。', true); return; }
    changingSave = true;
    try {
      await persistence.importSave(await file.text());
      reloading = true;
      location.reload();
    } catch (error) { ui.toast(`导入失败：${errorMessage(error)}。原存档已保留。`, true); }
    finally { changingSave = false; }
  }

  async function switchJourney(slot?:string):Promise<void>{
    if(!ready||!persistence||changingSave||reloading)return;
    savePose();changingSave=true;
    try{await persistence.flush();reloading=true;location.assign(journeyURL(location.href,slot));}
    catch(error){ui.toast(`切换失败：${errorMessage(error)}。原旅程已保留。`,true);}
    finally{changingSave=false;}
  }

  async function resetSave(): Promise<void> {
    if (!ready || !persistence) return;
    controller?.stop();
    if (!confirm('重置这座城市？这会清除本项目的体素改动与视角存档。建议先导出备份。')) return;
    changingSave = true;
    try { await persistence.clear(); reloading = true; location.reload(); }
    catch (error) { ui.toast(`重置失败：${errorMessage(error)}`, true); }
    finally { changingSave = false; }
  }
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

void boot().catch((error: unknown) => {
  console.error('Mirror Coast startup failed:', error);
  const root = document.querySelector<HTMLElement>('#interface');
  if (root) {
    const message = document.createElement('div');
    message.className = 'boot-error';
    message.textContent = `城市启动失败：${errorMessage(error)}`;
    root.append(message);
  }
});

