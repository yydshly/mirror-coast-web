import type {DecorationState} from '../destruction/decorations';
import {
  MAX_ACTIVE_FRAGMENTS, MAX_SAVED_FRAGMENTS, MAX_SAVED_FRAGMENT_VOXELS,
  type RubbleFragment, type FragmentVoxel,
} from '../destruction/types';
import type { HelicopterState } from '../vehicles/types';
import { COAST_ROUTE } from '../route/coast-route';
import { DEFAULT_WORLD_BOUNDS, WORLD_HEIGHT, validateWorldBounds, type WorldBounds } from '../world/voxel';
import type { CarState } from '../vehicles/coastal-car';
import {validateDiscoveries,type DiscoveryId} from '../gameplay/discoveries';
import type {TrafficBodyState} from '../destruction/physics';
import {destinationById} from '../gameplay/navigation';
import {validateJourney,type JourneySave} from '../gameplay/coastal-journey';
import {validateBay,type BayState} from '../gameplay/south-bay';
import {validateCoastOuting,type CoastOutingSave} from '../gameplay/harbor-passage';

export type VoxelEdit = { x: number; y: number; z: number; material: number };

export type WorldChange = {
  edits: VoxelEdit[];
  upsertFragments?: RubbleFragment[];
  removeFragmentIds?: string[];
};

export type PlayerState = {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  mode?: 'fly' | 'walk';
  weather?: 'clear' | 'rain';
  view?: 'first' | 'third';
  car?: CarState;
  bicycle?:import('../vehicles/bicycle').BicycleState;
  discoveries?: DiscoveryId[];
  navigationTarget?:string;
  posture?:{kind:'seated';seatId:string};
  journey?:JourneySave;
  bay?:BayState;
  coast?:CoastOutingSave;
  traffic?:TrafficBodyState[];
  /** Manually withdrawn NPCs only. Never player vehicles or world destruction. */
  removedTraffic?:number[];
  props?:DecorationState[];
};

export type SavedWorld = {
  format: 'mirror-coast-save';
  schemaVersion: 1;
  worldVersion: string;
  seed: number;
  updatedAt: string;
  edits: VoxelEdit[];
  rubble?: RubbleFragment[];
  player?: PlayerState;
  timeOfDay?: number;
  vehicle?: HelicopterState;
};

export type SaveStatus = 'saving' | 'saved' | 'error' | 'loading';

type Options = {
  worldVersion: string;
  seed: number;
  /** Independent journeys share the world format, never the saved changes. */
  slot?:string;
  bounds?: WorldBounds;
  onStatus?: (status: SaveStatus, message?: string) => void;
};

const DATABASE_NAME = 'mirror-coast-mvp';
const STORE_NAME = 'worlds';
const MAX_EDITS = 500_000;
const MAX_IMPORT_CHARACTERS = 32 * 1024 * 1024;
const SAVE_DELAY_MS = 180;
const READ_BLOCKED_MESSAGE = '原有存档读取失败，已暂停自动保存以保护原数据。请先导出当前状态，再明确导入或清空存档。';

const editKey = ({ x, y, z }: VoxelEdit): string => `${x},${y},${z}`;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function validateEdit(value: unknown, bounds: WorldBounds): VoxelEdit {
  if (!isRecord(value)) throw new Error('存档包含无效的体素修改。');
  const { x, y, z, material } = value;
  if (
    typeof x !== 'number' || !Number.isInteger(x) || x < bounds.minX || x >= bounds.maxX ||
    typeof y !== 'number' || !Number.isInteger(y) || y < 0 || y >= WORLD_HEIGHT ||
    typeof z !== 'number' || !Number.isInteger(z) || z < bounds.minZ || z >= bounds.maxZ ||
    typeof material !== 'number' || !Number.isInteger(material) || material < 0 || material > 255
  ) {
    throw new Error('存档中的体素坐标或材料超出允许范围。');
  }
  return { x, y, z, material };
}

function validateVector(value: unknown): { x: number; y: number; z: number } {
  if (!isRecord(value)) throw new Error('存档中的相机位置无效。');
  const { x, y, z } = value;
  if (![x, y, z].every((number) => typeof number === 'number' && Number.isFinite(number) && Math.abs(number) <= 1_000_000)) {
    throw new Error('存档中的相机数值无效。');
  }
  return { x: x as number, y: y as number, z: z as number };
}

function validatePlayer(value: unknown): PlayerState {
  if (!isRecord(value)) throw new Error('存档中的玩家状态无效。');
  const result: PlayerState = { position: validateVector(value.position), rotation: validateVector(value.rotation) };
  if (value.mode !== undefined) {
    if (value.mode !== 'fly' && value.mode !== 'walk') throw new Error('存档中的探索模式无效。');
    result.mode = value.mode;
  }
  if (value.weather !== undefined) {
    if (value.weather !== 'clear' && value.weather !== 'rain') throw new Error('存档中的天气无效。');
    result.weather = value.weather;
  }
  if (value.view !== undefined) {
    if (value.view !== 'first' && value.view !== 'third') throw new Error('存档中的步行视角无效。');
    result.view = value.view;
  }
  if (value.car !== undefined) {
    if (!isRecord(value.car)) throw new Error('汽车存档格式无效。');
    const position = validateVector(value.car.position), heading = value.car.heading, speed = value.car.speed;
    if (![position.x,position.y,position.z].every(n=>Math.abs(n)<=4096) || typeof heading !== 'number' || !Number.isFinite(heading) || Math.abs(heading)>100 || typeof speed !== 'number' || !Number.isFinite(speed) || Math.abs(speed)>50) throw new Error('汽车存档姿态或速度无效。');
    result.car = { position,heading,speed };
    if(value.car.rigidBody!==undefined){const motion=validateRigidMotion({...isRecord(value.car.rigidBody)?value.car.rigidBody:{},position});result.car.rigidBody={rotation:motion.rotation,linearVelocity:motion.linearVelocity,angularVelocity:motion.angularVelocity};}
  }
  if(value.bicycle!==undefined){if(!isRecord(value.bicycle))throw new Error('自行车存档格式无效。');const position=validateVector(value.bicycle.position),heading=value.bicycle.heading,riding=value.bicycle.riding;if(Object.values(position).some(v=>Math.abs(v)>4096)||typeof heading!=='number'||!Number.isFinite(heading)||Math.abs(heading)>100||typeof riding!=='boolean')throw new Error('自行车存档姿态无效。');result.bicycle={position,heading,riding};}
  if(value.props!==undefined){
    if(!Array.isArray(value.props)||value.props.length>4096)throw new Error('装饰物存档数量无效。');
    const ids=new Set<string>();result.props=value.props.map(p=>{if(!isRecord(p)||typeof p.id!=='string'||p.id.length>4000||!p.id.length||ids.has(p.id))throw new Error('装饰物编号无效。');ids.add(p.id);if(p.sleeping!==undefined&&typeof p.sleeping!=='boolean')throw new Error('装饰物静止状态无效。');return{id:p.id,...validateRigidMotion(p),...p.sleeping!==undefined?{sleeping:p.sleeping}:{}};});
  }
  if(value.traffic!==undefined){
    if(!Array.isArray(value.traffic)||value.traffic.length>24)throw new Error('车流碰撞存档格式无效。');
    const ids=new Set<number>();result.traffic=value.traffic.map(s=>{if(!isRecord(s)||!Number.isInteger(s.id)||Number(s.id)<0||Number(s.id)>23||ids.has(Number(s.id)))throw new Error('车流碰撞编号无效。');ids.add(Number(s.id));return{id:Number(s.id),...validateRigidMotion(s)};});
  }
  if(value.removedTraffic!==undefined){
    if(!Array.isArray(value.removedTraffic)||value.removedTraffic.length>24||value.removedTraffic.some(id=>!Number.isInteger(id)||id<0||id>23)||new Set(value.removedTraffic).size!==value.removedTraffic.length)throw new Error('清障车辆编号无效。');
    result.removedTraffic=[...value.removedTraffic];
    if(result.traffic?.some(s=>result.removedTraffic!.includes(s.id)))throw new Error('同一车辆不能同时处于事故和已清障状态。');
  }
  if(value.discoveries!==undefined)result.discoveries=validateDiscoveries(value.discoveries);
  if(value.navigationTarget!==undefined){if(typeof value.navigationTarget!=='string'||!destinationById(value.navigationTarget))throw new Error('存档中的地图目标无效。');result.navigationTarget=value.navigationTarget;}
  if(value.journey!==undefined)result.journey=validateJourney(value.journey);
  if(value.bay!==undefined)result.bay=validateBay(value.bay);
  if(value.coast!==undefined)result.coast=validateCoastOuting(value.coast);
  if(value.posture!==undefined){if(!isRecord(value.posture)||value.posture.kind!=='seated'||typeof value.posture.seatId!=='string'||!/^[-a-z0-9_.:]{1,120}$/.test(value.posture.seatId))throw new Error('存档中的坐姿无效。');result.posture={kind:'seated',seatId:value.posture.seatId};}
  return result;
}

function clonePlayer(value: PlayerState): PlayerState {
  if(value.removedTraffic)value={...value,removedTraffic:[...value.removedTraffic]};
  if(value.coast)value={...value,coast:validateCoastOuting(value.coast)};
  if(value.bicycle)value={...value,bicycle:{...value.bicycle,position:{...value.bicycle.position}}};
  if(value.bay)value={...value,bay:validateBay(value.bay)};
  if(value.journey)value={...value,journey:{...value.journey}};
  if(value.posture)value={...value,posture:{...value.posture}};
  return { ...value,...value.props?{props:value.props.map(s=>({...s,position:{...s.position},rotation:{...s.rotation},linearVelocity:{...s.linearVelocity},angularVelocity:{...s.angularVelocity}}))}:{}, position: { ...value.position }, rotation: { ...value.rotation }, ...(value.car ? { car:{ ...value.car,position:{ ...value.car.position },...value.car.rigidBody?{rigidBody:{rotation:{...value.car.rigidBody.rotation},linearVelocity:{...value.car.rigidBody.linearVelocity},angularVelocity:{...value.car.rigidBody.angularVelocity}}}:{} } } : {}), ...(value.discoveries?{discoveries:[...value.discoveries]}:{}),...value.traffic?{traffic:value.traffic.map(s=>({...s,position:{...s.position},rotation:{...s.rotation},linearVelocity:{...s.linearVelocity},angularVelocity:{...s.angularVelocity}}))}:{} };
}

function validateRigidMotion(value:Record<string,unknown>):Omit<TrafficBodyState,'id'>{
  const position=validateVector(value.position),linearVelocity=validateVector(value.linearVelocity),angularVelocity=validateVector(value.angularVelocity);
  if(Object.values(position).some(v=>Math.abs(v)>4096)||Object.values(linearVelocity).some(v=>Math.abs(v)>200)||Object.values(angularVelocity).some(v=>Math.abs(v)>50)||!isRecord(value.rotation))throw new Error('刚体存档范围无效。');
  const {x,y,z,w}=value.rotation;
  if(![x,y,z,w].every(v=>typeof v==='number'&&Number.isFinite(v)))throw new Error('刚体旋转无效。');
  const rotation={x:Number(x),y:Number(y),z:Number(z),w:Number(w)};
  if(Math.abs(Math.hypot(rotation.x,rotation.y,rotation.z,rotation.w)-1)>.02)throw new Error('刚体旋转必须归一化。');
  return{position,rotation,linearVelocity,angularVelocity};
}

function validateVehicle(value: unknown): HelicopterState {
  if (!isRecord(value)) throw new Error('直升机存档格式无效。');
  const position = validateVector(value.position);
  if (![position.x, position.y, position.z].every(number => Math.abs(number) <= 4096)) {
    throw new Error('直升机位置超出允许范围。');
  }
  const linearVelocity = validateVector(value.linearVelocity);
  if (![linearVelocity.x, linearVelocity.y, linearVelocity.z].every(number => Math.abs(number) <= 200)) {
    throw new Error('直升机速度超出允许范围。');
  }
  if (!isRecord(value.rotation)) throw new Error('直升机旋转无效。');
  const { x, y, z, w } = value.rotation;
  if (![x, y, z, w].every(number => typeof number === 'number' && Number.isFinite(number))) {
    throw new Error('直升机旋转无效。');
  }
  const rotation = { x: x as number, y: y as number, z: z as number, w: w as number };
  if (Math.abs(Math.hypot(rotation.x, rotation.y, rotation.z, rotation.w) - 1) > 0.02) {
    throw new Error('直升机旋转必须接近单位四元数。');
  }
  if (typeof value.engineOn !== 'boolean' || typeof value.routeIndex !== 'number' ||
      !Number.isInteger(value.routeIndex) || value.routeIndex < 0 || value.routeIndex > COAST_ROUTE.length) {
    throw new Error('直升机引擎或航线状态无效。');
  }
  if(value.tourStatus!==undefined&&!['idle','active','paused','complete'].includes(value.tourStatus as string))throw new Error('直升机游览状态无效。');
  if(value.flightMode!==undefined&&!['tour','return'].includes(value.flightMode as string))throw new Error('直升机飞行模式无效。');
  return { position, rotation, linearVelocity, engineOn: value.engineOn, routeIndex: value.routeIndex,
    ...(value.tourStatus!==undefined?{tourStatus:value.tourStatus as HelicopterState['tourStatus']}:{}),
    ...(value.flightMode!==undefined?{flightMode:value.flightMode as HelicopterState['flightMode']}:{}),
  };
}

function cloneVehicle(value: HelicopterState): HelicopterState {
  return { ...value, position: { ...value.position }, rotation: { ...value.rotation }, linearVelocity: { ...value.linearVelocity } };
}

function validateId(value: unknown): string {
  if (typeof value !== 'string' || !value.length || value.length > 128 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error('废墟碎块标识无效。');
  }
  return value;
}

function validateFragment(value: unknown): RubbleFragment {
  if (!isRecord(value)) throw new Error('废墟碎块格式无效。');
  const id = validateId(value.id);
  const buildingId = validateId(value.buildingId);
  const size = validateVector(value.size);
  if (![size.x, size.y, size.z].every(number => Number.isInteger(number) && number >= 1 && number <= 256)) {
    throw new Error('废墟碎块尺寸无效。');
  }
  const position = validateVector(value.position);
  if (![position.x, position.y, position.z].every(number => Math.abs(number) <= 4096)) {
    throw new Error('废墟碎块位置超出允许范围。');
  }
  if (!isRecord(value.rotation)) throw new Error('废墟碎块旋转无效。');
  const { x, y, z, w } = value.rotation;
  if (![x, y, z, w].every(number => typeof number === 'number' && Number.isFinite(number))) {
    throw new Error('废墟碎块旋转无效。');
  }
  const rotation = { x: x as number, y: y as number, z: z as number, w: w as number };
  const norm = Math.hypot(rotation.x, rotation.y, rotation.z, rotation.w);
  if (Math.abs(norm - 1) > 0.02) throw new Error('废墟碎块旋转必须接近单位四元数。');
  if (value.state !== 'falling' && value.state !== 'settled') throw new Error('废墟碎块状态无效。');
  if (!Array.isArray(value.voxels) || !value.voxels.length || value.voxels.length > MAX_SAVED_FRAGMENT_VOXELS) {
    throw new Error('废墟碎块体素列表无效或超出上限。');
  }
  const seen = new Set<number>();
  const voxels: FragmentVoxel[] = [];
  for (const cell of value.voxels) {
    if (!Array.isArray(cell) || cell.length !== 4 || !cell.every(number => typeof number === 'number' && Number.isInteger(number))) {
      throw new Error('废墟碎块包含无效体素。');
    }
    const [cx, cy, cz, material] = cell as number[];
    if (cx < 0 || cx >= size.x || cy < 0 || cy >= size.y || cz < 0 || cz >= size.z || material < 1 || material > 255) {
      throw new Error('废墟碎块体素坐标或材料越界。');
    }
    const key = cx + 256 * (cz + 256 * cy);
    if (seen.has(key)) throw new Error('废墟碎块包含重复的体素坐标。');
    seen.add(key);
    voxels.push([cx, cy, cz, material]);
  }
  const fragment: RubbleFragment = { id, buildingId, size, position, rotation, state: value.state, voxels };
  for (const name of ['linearVelocity', 'angularVelocity'] as const) {
    if (value[name] === undefined) continue;
    const velocity = validateVector(value[name]);
    if (![velocity.x, velocity.y, velocity.z].every(number => Math.abs(number) <= 1000)) {
      throw new Error('废墟碎块速度超出允许范围。');
    }
    fragment[name] = velocity;
  }
  return fragment;
}

function cloneFragment(value: RubbleFragment): RubbleFragment {
  return {
    ...value,
    size: { ...value.size }, position: { ...value.position }, rotation: { ...value.rotation },
    voxels: value.voxels.map(cell => [...cell] as FragmentVoxel),
    ...(value.linearVelocity ? { linearVelocity: { ...value.linearVelocity } } : {}),
    ...(value.angularVelocity ? { angularVelocity: { ...value.angularVelocity } } : {}),
  };
}

function assertRubbleBudget(fragments: Map<string, RubbleFragment>): void {
  if (fragments.size > MAX_SAVED_FRAGMENTS) throw new Error('废墟碎块数量达到存档上限，请先导出存档。');
  let count = 0;
  let active = 0;
  for (const fragment of fragments.values()) {
    count += fragment.voxels.length;
    if (fragment.state === 'falling') active++;
  }
  if (count > MAX_SAVED_FRAGMENT_VOXELS) throw new Error('废墟体素数量达到存档上限，请先导出存档。');
  if (active > MAX_ACTIVE_FRAGMENTS) throw new Error('同时活动的废墟碎块超过物理预算。');
}

type FragmentChange = { id: string; fragment?: RubbleFragment };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '无法读写浏览器存档。';
}

/** One local world, saved as immutable-generation metadata plus material edits. */
export class WorldPersistence {
  private readonly options: Options;
  private readonly bounds: WorldBounds;
  private readonly key: string;
  private database: Promise<IDBDatabase> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private edits = new Map<string, VoxelEdit>();
  private editRevisions = new Map<string, number>();
  private rubble = new Map<string, RubbleFragment>();
  // Keep tombstone revisions too, so removals during import/load cannot reappear.
  private rubbleRevisions = new Map<string, number>();
  private player: PlayerState | undefined;
  private timeOfDay: number | undefined;
  private playerRevision = 0;
  private vehicle: HelicopterState | undefined;
  private vehicleRevision = 0;
  private revision = 0;
  private persistedRevision = 0;
  private readBlocked = false;
  private importing: { save: SavedWorld; startRevision: number } | null = null;
  private disposed = false;

  constructor(options: Options) {
    if (!options.worldVersion || !Number.isSafeInteger(options.seed)) {
      throw new Error('世界版本或随机种子无效。');
    }
    this.bounds = validateWorldBounds(options.bounds ?? DEFAULT_WORLD_BOUNDS);
    this.options = { ...options, bounds: this.bounds };
    if(options.slot!==undefined&&!/^[a-zA-Z0-9_-]{1,64}$/.test(options.slot))throw new Error('旅程存档标识无效。');
    this.key = `${options.worldVersion}:${options.seed}${options.slot?`:slot:${options.slot}`:''}`;
  }

  get editCount(): number {
    return this.edits.size;
  }

  get rubbleCount(): number {
    return this.rubble.size;
  }

  async listJourneys():Promise<Array<string|null>>{
    const database=await this.openDatabase(),base=`${this.options.worldVersion}:${this.options.seed}`,prefix=`${base}:slot:`;
    return new Promise((resolve,reject)=>{
      const transaction=database.transaction(STORE_NAME,'readonly'),request=transaction.objectStore(STORE_NAME).getAllKeys();let slots:Array<string|null>=[];
      request.onsuccess=()=>{slots=request.result.flatMap(k=>k===base?[null]:typeof k==='string'&&k.startsWith(prefix)?[k.slice(prefix.length)]:[]);};
      transaction.oncomplete=()=>resolve(slots);transaction.onerror=()=>reject(transaction.error??new Error('无法读取旅程列表。'));transaction.onabort=()=>reject(transaction.error??new Error('读取旅程列表已中止。'));
    });
  }

  async load(): Promise<SavedWorld | null> {
    return this.enqueue(async () => {
      this.notify('loading', '正在读取本地世界');
      try {
        const startRevision = this.persistedRevision;
        const value = await this.read();
        if (value === undefined) {
          this.readBlocked = false;
          if (this.revision !== this.persistedRevision) await this.writePending();
          this.notify('saved', '新世界 · 本地自动存档');
          return null;
        }
        const save = this.validateSave(value);
        this.readBlocked = false;
        this.replaceState(save, startRevision);
        if (this.revision !== this.persistedRevision) await this.writePending();
        this.notify('saved', '已恢复本地世界');
        return this.snapshot();
      } catch (error: unknown) {
        this.readBlocked = true;
        this.cancelTimer();
        throw error;
      }
    });
  }

  record(values: VoxelEdit[]): void {
    this.recordWorldChange({ edits: values });
  }

  recordFragments(fragments: RubbleFragment[]): void {
    this.recordWorldChange({ edits: [], upsertFragments: fragments });
  }

  /** Voxel removal and fragment creation share one revision and one DB snapshot. */
  recordWorldChange(change: WorldChange): void {
    this.assertOpen();
    // Every member and prospective capacity is checked before changing any state.
    const batch = new Map<string, VoxelEdit>();
    for (const value of change.edits) {
      const edit = validateEdit(value, this.bounds);
      batch.set(editKey(edit), edit);
    }
    const edits = [...batch.values()];
    const newKeys = new Set(edits.filter((edit) => !this.edits.has(editKey(edit))).map(editKey));
    if (this.edits.size + newKeys.size > MAX_EDITS) {
      throw new Error('修改数量达到当前 MVP 存档上限，请先导出存档。');
    }
    const changed = edits.filter((edit) => this.edits.get(editKey(edit))?.material !== edit.material);
    const upserts = new Map<string, RubbleFragment>();
    const removed = new Set<string>();
    for (const id of change.removeFragmentIds ?? []) removed.add(validateId(id));
    for (const value of change.upsertFragments ?? []) {
      const fragment = validateFragment(value);
      upserts.set(fragment.id, fragment);
    }
    const prospective = new Map(this.rubble);
    for (const id of removed) prospective.delete(id);
    for (const [id, fragment] of upserts) prospective.set(id, fragment);
    assertRubbleBudget(prospective);
    // New simulation updates can arrive while an import's transaction is pending.
    // Check the eventual merged world too, before accepting that new update.
    if (this.importing) {
      const future = this.mergedState(this.importing.save, this.importing.startRevision);
      for (const edit of changed) future.edits.set(editKey(edit), edit);
      if (future.edits.size > MAX_EDITS) throw new Error('修改数量达到当前 MVP 存档上限，请先导出存档。');
      for (const id of removed) future.rubble.delete(id);
      for (const [id, fragment] of upserts) future.rubble.set(id, fragment);
      assertRubbleBudget(future.rubble);
    }
    const removedExisting = [...removed].filter(id => this.rubble.has(id) && !upserts.has(id));
    if (!changed.length && !upserts.size && !removedExisting.length) return;
    this.revision++;
    for (const edit of changed) {
      const key = editKey(edit);
      this.edits.set(key, edit);
      this.editRevisions.set(key, this.revision);
    }
    this.rubble = prospective;
    for (const id of removedExisting) this.rubbleRevisions.set(id, this.revision);
    for (const id of upserts.keys()) this.rubbleRevisions.set(id, this.revision);
    this.schedule();
  }

  setPlayer(player: PlayerState, timeOfDay?: number): void {
    this.assertOpen();
    const validPlayer = validatePlayer(player);
    if (timeOfDay !== undefined && (!Number.isFinite(timeOfDay) || timeOfDay < 0 || timeOfDay > 24)) {
      throw new Error('世界时间必须位于 0–24 小时之间。');
    }
    if (JSON.stringify(this.player) === JSON.stringify(validPlayer) && this.timeOfDay === timeOfDay) return;
    this.player = validPlayer;
    this.timeOfDay = timeOfDay;
    this.playerRevision = ++this.revision;
    this.schedule();
  }

  setVehicle(vehicle: HelicopterState): void {
    this.assertOpen();
    const validated = validateVehicle(vehicle);
    if (JSON.stringify(this.vehicle) === JSON.stringify(validated)) return;
    this.vehicle = validated;
    this.vehicleRevision = ++this.revision;
    this.schedule();
  }

  async flush(): Promise<void> {
    this.cancelTimer();
    return this.enqueue(() => this.writePending());
  }

  async exportSave(): Promise<string> {
    try {
      await this.flush();
    } catch {
      this.notify('error', '浏览器存档未能提交；已导出当前内存中的世界，请妥善保留备份。');
    }
    // Compact output keeps even the bounded maximum world re-importable within
    // the 32 MiB limit; pretty-printed voxel tuples can exceed that same limit.
    return JSON.stringify(this.snapshot());
  }

  async importSave(json: string): Promise<SavedWorld> {
    this.assertOpen();
    if (json.length > MAX_IMPORT_CHARACTERS) throw new Error('存档文件超过 32 MiB 导入限制。');
    let value: unknown;
    try {
      value = JSON.parse(json) as unknown;
    } catch {
      throw new Error('无法读取存档 JSON，现有世界未改变。');
    }
    const save = this.validateSave(value);
    this.cancelTimer();
    const startRevision = this.revision;
    return this.enqueue(async () => {
      this.notify('saving', '正在导入世界');
      this.mergedState(save, startRevision);
      this.importing = { save, startRevision };
      try {
        // Commit first: a failed import must not replace the in-memory world.
        await this.write(save);
        this.readBlocked = false;
        this.replaceState(save, startRevision);
        await this.writePending();
        this.notify('saved', '存档已导入');
        return this.snapshot();
      } finally {
        this.importing = null;
      }
    });
  }

  async clear(): Promise<void> {
    this.cancelTimer();
    const startRevision = this.revision;
    return this.enqueue(async () => {
      const database = await this.openDatabase();
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, 'readwrite');
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error ?? new Error('无法清除本地存档。'));
        transaction.onerror = () => reject(transaction.error ?? new Error('无法清除本地存档。'));
        transaction.objectStore(STORE_NAME).delete(this.key);
      });
      this.readBlocked = false;
      const tail = this.changedAfter(startRevision);
      const rubbleTail = this.fragmentsChangedAfter(startRevision);
      const keepPlayer = this.playerRevision > startRevision;
      const keepVehicle = this.vehicleRevision > startRevision;
      this.edits.clear();
      this.editRevisions.clear();
      this.rubble.clear();
      this.rubbleRevisions.clear();
      if (!keepPlayer) {
        this.player = undefined;
        this.timeOfDay = undefined;
      }
      if (!keepVehicle) this.vehicle = undefined;
      this.persistedRevision = ++this.revision;
      this.applyTail(tail);
      this.applyFragmentTail(rubbleTail);
      if (keepPlayer) this.playerRevision = ++this.revision;
      if (keepVehicle) this.vehicleRevision = ++this.revision;
      await this.writePending();
      this.notify('saved', '本地存档已清空');
    });
  }

  /** Stop autosave timers and close this instance without deleting any data. */
  dispose(): void {
    this.disposed = true;
    this.cancelTimer();
    if (this.database) void this.database.then((database) => database.close()).catch(() => undefined);
  }

  private assertOpen(): void {
    if (this.disposed) throw new Error('存档连接已关闭。');
  }

  private notify(status: SaveStatus, message?: string): void {
    try {
      this.options.onStatus?.(status, message);
    } catch {
      // UI callbacks must never interrupt an IndexedDB transaction.
    }
  }

  private schedule(): void {
    if (this.readBlocked) {
      this.notify('error', READ_BLOCKED_MESSAGE);
      return;
    }
    this.notify('saving', '正在保存修改');
    if (this.timer !== undefined) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush().catch(() => undefined);
    }, SAVE_DELAY_MS);
  }

  private cancelTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    this.assertOpen();
    const result = this.queue.then(operation).catch((error: unknown) => {
      this.notify('error', errorMessage(error));
      throw error;
    });
    this.queue = result.catch(() => undefined);
    return result;
  }

  private snapshot(): SavedWorld {
    const save: SavedWorld = {
      format: 'mirror-coast-save',
      schemaVersion: 1,
      worldVersion: this.options.worldVersion,
      seed: this.options.seed,
      updatedAt: new Date().toISOString(),
      edits: Array.from(this.edits.values(), (edit) => ({ ...edit })),
    };
    if (this.player) save.player = clonePlayer(this.player);
    if (this.rubble.size) save.rubble = [...this.rubble.values()].map(cloneFragment);
    if (this.timeOfDay !== undefined) save.timeOfDay = this.timeOfDay;
    if (this.vehicle) save.vehicle = cloneVehicle(this.vehicle);
    return save;
  }

  private validateSave(value: unknown): SavedWorld {
    if (!isRecord(value) || value.format !== 'mirror-coast-save' || value.schemaVersion !== 1) {
      throw new Error('此文件不是受支持的 Mirror Coast 存档。');
    }
    if (value.worldVersion !== this.options.worldVersion || value.seed !== this.options.seed) {
      throw new Error('存档的世界版本或随机种子不匹配，现有存档未改变。');
    }
    if (typeof value.updatedAt !== 'string' || value.updatedAt.length > 64 || !Number.isFinite(Date.parse(value.updatedAt))) {
      throw new Error('存档时间无效。');
    }
    if (!Array.isArray(value.edits) || value.edits.length > MAX_EDITS) {
      throw new Error('存档中的体素修改列表无效或超出数量限制。');
    }
    const deduplicated = new Map<string, VoxelEdit>();
    for (const valueEdit of value.edits) {
      const edit = validateEdit(valueEdit, this.bounds);
      deduplicated.set(editKey(edit), edit);
    }
    const save: SavedWorld = {
      format: 'mirror-coast-save',
      schemaVersion: 1,
      worldVersion: this.options.worldVersion,
      seed: this.options.seed,
      updatedAt: value.updatedAt,
      edits: [...deduplicated.values()],
    };
    if (value.player !== undefined) save.player = validatePlayer(value.player);
    if (value.vehicle !== undefined) save.vehicle = validateVehicle(value.vehicle);
    if (value.rubble !== undefined) {
      if (!Array.isArray(value.rubble) || value.rubble.length > MAX_SAVED_FRAGMENTS) {
        throw new Error('废墟碎块列表无效或超出数量上限。');
      }
      const fragments = new Map<string, RubbleFragment>();
      for (const input of value.rubble) {
        const fragment = validateFragment(input);
        fragments.set(fragment.id, fragment);
      }
      assertRubbleBudget(fragments);
      save.rubble = [...fragments.values()];
    }
    if (value.timeOfDay !== undefined) {
      if (typeof value.timeOfDay !== 'number' || !Number.isFinite(value.timeOfDay) || value.timeOfDay < 0 || value.timeOfDay > 24) {
        throw new Error('存档中的世界时间无效。');
      }
      save.timeOfDay = value.timeOfDay;
    }
    return save;
  }

  private changedAfter(revision: number): VoxelEdit[] {
    return [...this.edits.entries()]
      .filter(([key]) => (this.editRevisions.get(key) ?? 0) > revision)
      .map(([, edit]) => ({ ...edit }));
  }

  private applyTail(edits: VoxelEdit[]): void {
    if (!edits.length) return;
    this.revision++;
    for (const edit of edits) {
      const key = editKey(edit);
      this.edits.set(key, edit);
      this.editRevisions.set(key, this.revision);
    }
  }

  private fragmentsChangedAfter(revision: number): FragmentChange[] {
    return [...this.rubbleRevisions.entries()]
      .filter(([, changedAt]) => changedAt > revision)
      .map(([id]) => ({ id, fragment: this.rubble.get(id) }));
  }

  private applyFragmentTail(changes: FragmentChange[]): void {
    if (!changes.length) return;
    this.revision++;
    for (const { id, fragment } of changes) {
      if (fragment) this.rubble.set(id, fragment);
      else this.rubble.delete(id);
      this.rubbleRevisions.set(id, this.revision);
    }
  }

  private replaceState(save: SavedWorld, startRevision: number): void {
    // Validate the union before replacing any memory, including hydration tails.
    this.mergedState(save, startRevision);
    const tail = this.changedAfter(startRevision);
    const rubbleTail = this.fragmentsChangedAfter(startRevision);
    const keepPlayer = this.playerRevision > startRevision;
    const keepVehicle = this.vehicleRevision > startRevision;
    this.edits = new Map(save.edits.map((edit) => [editKey(edit), { ...edit }]));
    this.editRevisions.clear();
    this.rubble = new Map((save.rubble ?? []).map(fragment => [fragment.id, cloneFragment(fragment)]));
    this.rubbleRevisions.clear();
    if (!keepPlayer) {
      this.player = save.player ? clonePlayer(save.player) : undefined;
      this.timeOfDay = save.timeOfDay;
    }
    if (!keepVehicle) this.vehicle = save.vehicle ? cloneVehicle(save.vehicle) : undefined;
    this.persistedRevision = ++this.revision;
    this.applyTail(tail);
    this.applyFragmentTail(rubbleTail);
    if (keepPlayer) this.playerRevision = ++this.revision;
    if (keepVehicle) this.vehicleRevision = ++this.revision;
  }

  private mergedState(save: SavedWorld, startRevision: number): {
    edits: Map<string, VoxelEdit>; rubble: Map<string, RubbleFragment>;
  } {
    const edits = new Map(save.edits.map(edit => [editKey(edit), edit]));
    for (const edit of this.changedAfter(startRevision)) edits.set(editKey(edit), edit);
    if (edits.size > MAX_EDITS) throw new Error('合并后的体素修改超出存档上限。');
    const rubble = new Map((save.rubble ?? []).map(fragment => [fragment.id, fragment]));
    for (const { id, fragment } of this.fragmentsChangedAfter(startRevision)) {
      if (fragment) rubble.set(id, fragment);
      else rubble.delete(id);
    }
    assertRubbleBudget(rubble);
    return { edits, rubble };
  }

  private async writePending(): Promise<void> {
    if (this.readBlocked) throw new Error(READ_BLOCKED_MESSAGE);
    if (this.revision === this.persistedRevision) return;
    this.notify('saving', '正在保存修改');
    // Edits may arrive while IndexedDB commits. Keep writing until every revision
    // has been acknowledged; an old transaction can never mark new edits saved.
    while (this.revision !== this.persistedRevision) {
      const revision = this.revision;
      await this.write(this.snapshot());
      this.persistedRevision = revision;
    }
    this.notify('saved', '修改已保存至此浏览器');
  }

  private openDatabase(): Promise<IDBDatabase> {
    if (this.database) return this.database;
    this.database = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('此浏览器未提供 IndexedDB，无法自动保存。'));
        return;
      }
      const request = indexedDB.open(DATABASE_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => database.close();
        resolve(database);
      };
      request.onerror = () => reject(request.error ?? new Error('无法打开浏览器存档。'));
      request.onblocked = () => reject(new Error('存档数据库被其他标签页占用，请关闭旧标签页后重试。'));
    });
    return this.database;
  }

  private async read(): Promise<unknown> {
    const database = await this.openDatabase();
    return new Promise<unknown>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(this.key);
      let value: unknown;
      request.onsuccess = () => { value = request.result as unknown; };
      transaction.oncomplete = () => resolve(value);
      transaction.onerror = () => reject(transaction.error ?? new Error('无法读取本地存档。'));
      transaction.onabort = () => reject(transaction.error ?? new Error('本地存档读取已中止。'));
    });
  }

  private async write(save: SavedWorld): Promise<void> {
    const database = await this.openDatabase();
    return new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('无法保存世界；请检查浏览器存储空间。'));
      transaction.onabort = () => reject(transaction.error ?? new Error('存档提交已中止，修改尚未保存。'));
      transaction.objectStore(STORE_NAME).put(save, this.key);
    });
  }
}
