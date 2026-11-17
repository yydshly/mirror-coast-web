import type {CarViewState} from '../vehicles/coastal-car';
import type {BicycleViewState} from '../vehicles/bicycle';
import {carFeedback} from '../vehicles/vehicle-feedback';
import type { HelicopterViewState } from '../vehicles/types';
import { COAST_ROUTE } from '../route/coast-route';
import { STREET_PLACES } from '../route/street-route';
import {RegionMap,type MapSnapshot} from './region-map';
import {JourneyPicker} from './journey-picker';
import {RecordingPanel,type ClipSettings} from './recording-panel';
import {controlGuide,type ControlMode} from '../input/control-guide';
import type {VoxelWorld} from '../world/voxel';

export type Tool = 'observe' | 'carve' | 'blast';

export function explorationPresentation(state: {walking:boolean;piloting:boolean;driving:boolean;vehicleAvailable:boolean;carAvailable:boolean}) {
  const mode=state.driving&&state.carAvailable?'car':state.piloting&&state.vehicleAvailable?'helicopter':state.walking?'walk':'fly';
  return {mode,street:mode==='walk',observer:mode==='fly'&&state.vehicleAvailable,car:mode==='car',helicopter:mode==='helicopter'} as const;
}

type Callbacks = {
  onTool: (tool: Tool) => void;
  onTime: (hour: number) => void;
  onExport: () => void;
  onImport: (file: File) => void;
  onReset: () => void;
  onListJourneys?:()=>Promise<Array<string|null>>;
  onChooseJourney?:(slot?:string)=>void;
  onNewJourney?:()=>void;
  onHelpOpen?:()=>void;
  onMenuOpen?:()=>void;
  onStart: () => void;
  onHome: () => void;
  onLab?: () => void;
  onLabBlast?: () => void;
  onCity?: () => void;
  onPilot?: () => void;
  onExitPilot?: () => void;
  onReturnToPad?:()=>void;
  onBicycle?:()=>void;
  onExitBicycle?:()=>void;
  onAutopilot?: () => void;
  onStartTour?: () => void;
  onRecord?: () => void;
  onBeginRecording?:(settings:ClipSettings)=>void;
  onStopRecording?:()=>void;
  onSound?: () => void;
  onWalk?: () => void;
  onFreeFly?: () => void;
  onRainNight?: () => void;
  onWeather?: (weather: 'clear' | 'rain') => void;
  onPlace?: (id: string) => void;
  onToggleView?: () => void;
  onOverview?: () => void;
  onDrive?: () => void;
  onExitDrive?: () => void;
  onResetLook?: () => void;
  onRecoverCar?: () => void;
  onRecoverVehicle?:()=>void;
  onClearTraffic?: () => void;
  onMapNavigate?:(id:string,drive:boolean)=>void;
  onTourExplore?:(mode:'walk'|'car')=>void;
  onFieldbook?:()=>void;
};

type Stats = {
  fps: number;
  frameMs: number;
  chunks: number;
  drawCalls: number;
  triangles: number;
  pending: number;
  edits: number;
  activeFragments?: number;
  settledFragments?: number;
  supportPending?: number;
};

const icons: Record<string, string> = {
  coast: '<path d="M4 5h7v7H4zM13 3h7v7h-7zM4 16c2-2 4 2 6 0s4 2 6 0 4 2 6 0M4 21c2-2 4 2 6 0s4 2 6 0 4 2 6 0"/>',
  observe: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  carve: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z M4 7.5l8 4.5 8-4.5M12 12v9M8 5.2l8 4.5"/>',
  blast: '<path d="m12 2 1.8 6.4L20 5l-3.1 6.3L23 13l-6.5 1.5L20 21l-6.3-3.3L12 24l-1.8-6.3L4 21l3.2-6.5L1 13l6.2-1.7L4 5l6.2 3.4L12 2Z"/>',
  arrow: '<path d="M6 18 18 6M6 6h12v12"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  home: '<path d="m3 11 9-8 9 8M5 9v12h14V9M9 21v-7h6v7"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 1v2m0 18v2M1 12h2m18 0h2M4.2 4.2l1.5 1.5m12.6 12.6 1.5 1.5M4.2 19.8l1.5-1.5M18.3 5.7l1.5-1.5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 8.5a2.5 2.5 0 1 1 4 2c-1 .7-1.5 1.1-1.5 2.5M12 16v.2"/>',
  pin: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2"/>',
  chart: '<path d="M3 20h18M6 16v-5m6 5V5m6 11v-8"/>',
};

function icon(name: string, className = ''): string {
  return `<svg class="mc-icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] ?? ''}</svg>`;
}

export class Interface {
  private readonly journeyPicker:JourneyPicker;
  private readonly recordingPanel:RecordingPanel;
  private readonly element: HTMLDivElement;
  private readonly regionMap:RegionMap;
  private readonly callbacks: Callbacks;
  private readonly toolButtons = new Map<Tool, HTMLButtonElement>();
  private readonly timeSlider: HTMLInputElement;
  private readonly timeLabel: HTMLElement;
  private readonly saveStatus: HTMLElement;
  private readonly saveMessage: HTMLElement;
  private readonly loader: HTMLElement;
  private readonly loadFill: HTMLElement;
  private readonly loadLabel: HTMLElement;
  private readonly targetLabel: HTMLElement;
  private readonly flightHint: HTMLElement;
  private readonly helpPanel: HTMLElement;
  private readonly intro: HTMLElement;
  private readonly toastElement: HTMLElement;
  private readonly menu: HTMLElement;
  private readonly statsElement: HTMLElement;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  private currentTool: Tool = 'observe';
  private hasFlown = false;
  private vehicleAvailable = false;
  private vehicleState: HelicopterViewState | undefined;
  private lastHelpMode = '';
  private bicycleState:BicycleViewState|undefined;
  private walking = false;
  private walkView: 'first' | 'third' = 'third';
  private mouseMode: 'locked' | 'drag' | 'paused' = 'paused';
  private carAvailable = false;
  private carState: { driving: boolean; speed: number; blocked: boolean; grounded: boolean } | undefined;

  constructor(root: HTMLElement, callbacks: Callbacks) {
    this.callbacks = callbacks;
    this.element = document.createElement('div');
    this.element.className = 'mc-ui';
    this.element.dataset.ui = '';
    this.element.innerHTML = `
      <div class="mc-vignette" aria-hidden="true"></div>
      <header class="mc-topbar">
        <a class="mc-brand" href="#" data-action="home" aria-label="镜海，返回初始视角">
          <span class="mc-brand-mark">${icon('coast')}</span>
          <span><strong>MIRROR COAST<span class="mc-brand-dot">.</span></strong><small>VOXEL FIELD NOTES — 001</small></span>
        </a>
        <div class="mc-save-group mc-panel">
          <div class="mc-save-copy" data-save-status="loading" role="status" aria-live="polite"><i class="mc-status-dot"></i><span><b>本地存档</b><small data-save-message>正在连接…</small></span></div>
          <span class="mc-divider"></span>
          <button class="mc-session-button" data-action="journeys" aria-label="旅程与从头开始">旅程</button>
          <button class="mc-icon-button" data-action="export" title="导出存档" aria-label="导出存档">${icon('download')}</button>
          <button class="mc-icon-button" data-action="import" title="导入存档" aria-label="导入存档">${icon('upload')}</button>
          <button class="mc-icon-button" data-action="more" title="更多选项" aria-label="更多选项" aria-expanded="false">${icon('more')}</button>
          <input class="mc-file-input" type="file" accept="application/json,.json" aria-label="选择存档文件" />
          <div class="mc-more-menu" hidden>
            <button data-action="journeys">继续 / 从头开始<small>新旅程保留旧进度，可随时切回</small></button>
            <button data-action="walk">步行探索<small>沿海岸走进不同街区</small></button>
            <button data-action="rain-night">雨夜街道<small>湿路面、暖店灯与细雨</small></button>
            <button data-action="free-fly">自由镜头<small>从空中查看整片海岸</small></button>
            <button data-action="pilot" class="mc-menu-pilot">驾驶直升机<small>从码头沿海绕城飞行</small></button>
            <button data-action="drive" hidden>驾驶海岸汽车<small>沿公路穿过旧城、港区与山麓</small></button>
            <button data-action="lab">结构试验场<small>单独观察建筑支撑与坍塌</small></button>
            <button data-action="diagnostics">显示诊断<small>查看运行状态</small></button>
            <button data-action="record-flight">录制20秒<small>保存这次实机飞行片段</small></button>
            <button data-action="sound" aria-pressed="false">开启声音<small>听见旋翼与海岸</small></button>
            <button data-action="reset">重新生成城市<small>清空当前场景的本地修改</small></button>
          </div>
        </div>
      </header>

      <div class="mc-location">
        <span class="mc-location-eyebrow"><i></i> A SMALL WORLD, YOURS TO CHANGE</span>
        <div>${icon('pin')}<span>镜海<span class="mc-location-separator">/</span>沿海实验城</span></div>
        <small>SEED 048271 <span>·</span> 1024 × 768 M <span>·</span> LIGHTHOUSE BAY</small>
      </div>

      <div class="mc-top-actions">
        <nav class="mc-mode-bar mc-panel" aria-label="游玩模式">
          <button data-action="walk" data-mode="walk" aria-label="步行探索" aria-pressed="false" title="地面步行 · 身体碰撞">步行</button>
          <button data-action="drive" data-mode="car" aria-label="驾驶海岸汽车" aria-pressed="false" hidden>汽车</button>
          <button data-action="bicycle" data-mode="bicycle" aria-label="骑自行车" aria-pressed="false">自行车</button>
          <button data-action="pilot" data-mode="helicopter" aria-label="驾驶直升机" aria-pressed="false">直升机</button>
          <button data-action="free-fly" data-mode="fly" aria-label="自由镜头" aria-pressed="true" title="空中观察 · 地表防穿透">自由镜头</button>
        </nav>
        <button class="mc-city-overview" data-action="overview">区域总览</button>
        <button class="mc-tour-entry" data-action="tour" aria-haspopup="dialog">海岸导览</button>
        <button class="mc-street-entry" data-action="rain-night">雨夜漫步</button>
        <button class="mc-city-overview mc-return-pad" data-action="return-pad" title="切换至直升机并自动返航降落，落地后 F 下机（H）">自动返航 <kbd>H</kbd></button>
        <button class="mc-icon-button mc-action-button" data-action="home" title="返回初始视角" aria-label="返回初始视角">${icon('home')}</button>
        <button class="mc-icon-button mc-action-button" data-action="help" title="操作说明（Tab）" aria-label="操作说明" aria-expanded="false">${icon('help')}</button>
      </div>

      <section class="mc-street-panel mc-panel" aria-label="地面探索" hidden>
        <div class="mc-street-heading"><span class="mc-street-eyebrow">地面步行</span><b data-street-place>滨海商店街</b></div>
        <label class="mc-place-label"><span class="mc-sr-only">前往街区</span><select aria-label="前往街区"><optgroup label="外围区域 · 道路连通">${STREET_PLACES.filter(p=>'regional' in p).map(p=>`<option value="${p.id}">${p.name}</option>`).join('')}</optgroup><optgroup label="旧城与渔港">${STREET_PLACES.filter(p => !('regional' in p) && p.id !== 'bakery' && p.id !== 'kitchen').map(p => `<option value="${p.id}">${p.name}</option>`).join('')}</optgroup><optgroup label="室内 · 渔港店铺">${STREET_PLACES.filter(p => p.id === 'bakery' || p.id === 'kitchen').map(p => `<option value="${p.id}">${p.name}</option>`).join('')}</optgroup></select></label>
        <div class="mc-walk-actions">
          <button data-action="walk" class="mc-walk-resume" data-control-resume>开始控制</button>
          <button data-action="toggle-view" class="mc-view-toggle" title="C 切换第一 / 第三人称">第三人称 <kbd>C</kbd></button>
          <button data-action="record-flight" title="录制20秒实机画面">录制20秒</button>
        </div>
        <button class="mc-clear-traffic" data-action="clear-traffic" title="清理附近60米的事故车辆，保留建筑、地面和探索进度">清理附近事故</button>
        <div class="mc-mouse-status"><i aria-hidden="true"></i><span data-mouse-status>点击“开始控制”或画面开始</span><small>WASD 行走 · Space 跳跃 · Esc 释放操作</small></div>
        <div class="mc-ground-status" data-ground-status>Space 跳跃 · 靠近长椅或低栏，按 E 互动</div>
      </section>

      <section class="mc-observer-panel mc-panel" aria-label="自由镜头控制" hidden>
        <div class="mc-observer-heading"><b>自由镜头</b><span>空中观察 · 地表防穿透</span></div>
        <div class="mc-observer-actions"><button data-action="start" data-control-resume>开始控制</button><button data-action="record-flight" title="录制20秒实机画面">录制20秒</button></div>
        <small class="mc-observer-keys">WASD 水平移动 · Space / E 升高 · Q 降低<br>遇到台阶或高地，先升高再向前。</small>
        <div class="mc-mouse-status"><i aria-hidden="true"></i><span data-mouse-status>点击“开始控制”或画面开始</span></div>
      </section>

      <section class="mc-car-panel mc-panel" aria-label="海岸驾驶" hidden>
        <div class="mc-car-heading"><div><span>COASTAL ROAD TRIP</span><b>海岸驾驶</b></div><div class="mc-car-speed"><b data-car-speed>0</b><small>km/h</small></div></div>
        <p data-car-status>沿着海岸公路，去下一个街区。</p>
        <div class="mc-car-instruments"><span data-car-left aria-label="左转向灯">◀</span><b data-car-gear>D</b><span data-car-right aria-label="右转向灯">▶</span><small data-car-condition>动力正常 · 无故障降速</small></div>
        <div class="mc-car-actions"><button data-action="exit-drive">停车下车</button><button data-action="reset-look">视角回正</button><button data-action="record-flight" title="录制20秒实机画面">录制20秒</button></div>
        <div class="mc-car-actions mc-car-recovery"><button data-action="recover-car" title="只将你驾驶的汽车救援至附近安全公路">救援我的汽车</button><button data-action="clear-traffic" title="清理附近60米的事故车辆，保留你的汽车和世界变化">清理附近事故</button></div>
        <small class="mc-car-keys"><kbd>W / S</kbd> 油门 / 倒车 <kbd>A / D</kbd> 转向 <kbd>Space</kbd> 刹车 <kbd>Esc</kbd> 下车</small>
        <small class="mc-vehicle-look">鼠标拖动环视 · 滚轮缩放 · <kbd>R</kbd> 回正</small>
        <small class="mc-car-lights"><kbd>Z / C</kbd> 左 / 右灯 <kbd>X</kbd> 双闪 · 转向时自动示意</small>
      </section>

      <section class="mc-region-map mc-panel"></section>

      <section class="mc-collapse-controls mc-panel" aria-label="建筑坍塌">
        <span class="mc-collapse-eyebrow">DESTRUCTION STUDY — 002</span>
        <button data-action="lab" class="mc-collapse-button">进入坍塌试验场 ${icon('arrow')}</button>
        <button data-action="lab-blast" class="mc-collapse-button mc-collapse-fire" hidden>试射支柱 ${icon('blast')}</button>
        <button data-action="city" class="mc-collapse-back" hidden>返回沿海城市</button>
        <small data-collapse-hint>支撑检测 · 真实掉落 · 废墟存档</small>
        <output data-collapse-state>准备就绪</output>
      </section>

      <section class="mc-vehicle-panel mc-panel" aria-label="滨海飞行航线" data-vehicle-state="parked" hidden>
        <div class="mc-vehicle-heading"><span>COASTAL FLIGHT</span><b data-vehicle-status>停机坪待命</b></div>
        <div class="mc-vehicle-destination"><span data-waypoint>码头升空</span><small data-route-count>01 / 07</small></div>
        <ol class="mc-route-stops" aria-label="航线站点">${COAST_ROUTE.map((point, index) => `<li data-route-stop="${index}" title="${point.name}"><i></i><span>${point.shortName}</span></li>`).join('')}</ol>
        <ol class="mc-route-stops" data-return-stops aria-label="自动返航进度" hidden>${['离场','回航','进近','降落','停稳'].map((name,index)=>`<li data-return-stop="${index}"><i></i><span>${name}</span></li>`).join('')}</ol>
        <div class="mc-tour-guidance" aria-label="当前航段指引">
          <div><b data-tour-stage>飞往码头升空</b><small data-tour-distance></small></div>
          <p data-tour-description>自动飞行带你认识旧城与近岸，不需要自己操纵。</p>
          <small data-tour-next>下一站 · 滨海大道</small>
        </div>
        <div class="mc-flight-metrics"><div><b data-vehicle-speed>0</b><span>km/h</span></div><div><b data-vehicle-altitude>0</b><span>m 高度</span></div><div class="mc-rpm"><b data-vehicle-rpm>0%</b><span>旋翼</span></div></div>
        <div class="mc-vehicle-actions"><button data-action="pilot">驾驶直升机</button><button data-action="autopilot">开始自动游览</button><button data-action="reset-look">视角回正</button><button data-action="exit-pilot" hidden>下机步行 · F</button><button data-action="return-pad">自动返航降落 · H</button><button data-action="recover-vehicle" title="只将当前载具移至附近已检查的安全位置；保留世界变化">脱困 · G</button></div>
        <div class="mc-tour-followup" hidden><button data-action="tour-walk">前往渔港步行</button><button data-action="tour-drive">驾车去南湾探索</button><span>缩略地图会标出目标；驾车到沙滩后，再沿栈道步行找救援箱。</span></div>
        <small class="mc-vehicle-look">鼠标拖动环视 · 滚轮缩放 · <kbd>R</kbd> 回正</small>
        <div class="mc-vehicle-foot"><span data-vehicle-note>自动起飞、沿岸游览，最后返航降落。</span><button data-action="tour">路线与操作</button><button data-action="record-flight" title="录制20秒实机画面">录制20秒</button></div>
      </section>

      <section class="mc-bicycle-panel mc-panel" aria-label="自行车骑行" hidden><span class="mc-street-eyebrow">COASTAL CYCLING</span><h3>沿着海风，骑一段。</h3><b data-bicycle-speed>0 km/h</b><p data-bicycle-status>W 蹬车 · S 制动 / 退行 · A / D 转向 · Space 刹车</p><div class="mc-vehicle-actions"><button data-action="exit-bicycle">停稳下车 · F</button><button data-action="reset-look">视角回正 · R</button><button data-action="recover-vehicle" title="将自行车与骑手一起挪到附近安全地面">脱困 · G</button><button data-action="record-flight">录制</button></div><small>鼠标拖动环视 · 滚轮缩放 · M 地图 · F / E 下车</small></section>
      <div class="mc-aim" aria-hidden="true"><span></span><i></i><span></span></div>
      <div class="mc-target" data-target hidden></div>

      <section class="mc-intro">
        <span class="mc-section-number">01 — THE COAST IS CALLING</span>
        <h1>把世界，<br />留下一点不同<span>。</span></h1>
        <p>沿着海岸飞行，在街巷间穿梭。<br />挖去一块，改变一角。你的痕迹会留在这里。</p>
        <div class="mc-intro-actions"><button class="mc-enter" data-action="pilot"><span>登机起飞</span>${icon('arrow')}</button><button class="mc-observe" data-action="start">自由镜头</button></div>
        <small class="mc-intro-note">一公里海岸 · 城区、港区与丘陵相连 · 本机存档</small>
      </section>

      <div class="mc-bottom-center">
        <div class="mc-tool-caption" data-tool-caption>观察 · 移动与查看</div>
        <nav class="mc-toolbar mc-panel" aria-label="选择工具">
          <button class="mc-tool is-active" data-tool="observe" aria-pressed="true"><span class="mc-key">1</span>${icon('observe')}<span>观察</span></button>
          <button class="mc-tool" data-tool="carve" aria-pressed="false"><span class="mc-key">2</span>${icon('carve')}<span>挖除</span></button>
          <button class="mc-tool" data-tool="blast" aria-pressed="false"><span class="mc-key">3</span>${icon('blast')}<span>爆破</span></button>
        </nav>
        <div class="mc-flight-hint">点击画面进入飞行<span>·</span><kbd>Tab</kbd> 操作说明</div>
      </div>

      <section class="mc-daylight mc-panel" aria-label="日照控制">
        <div class="mc-weather-switch" aria-label="天气"><button data-weather="clear" aria-pressed="true">晴天</button><button data-weather="rain" aria-pressed="false">细雨</button></div>
        <div class="mc-daylight-heading"><span>${icon('sun')}日照</span><output data-time>17:30</output></div>
        <input class="mc-time-slider" type="range" min="0" max="23.99" step="0.05" value="17.5" aria-label="一天中的时间" />
        <div class="mc-daylight-labels"><span>午夜</span><span>正午</span><span>午夜</span></div>
      </section>

      <details class="mc-performance mc-panel" hidden><summary>${icon('chart')}<span data-fps>— FPS</span><i>诊断</i></summary><div class="mc-stat-grid" data-stats><span>帧时间<b data-stat="frameMs">—</b></span><span>区块<b data-stat="chunks">—</b></span><span>绘制调用<b data-stat="drawCalls">—</b></span><span>三角形<b data-stat="triangles">—</b></span><span>待处理<b data-stat="pending">—</b></span><span>已修改<b data-stat="edits">—</b></span><span>活动碎块<b data-stat="activeFragments">0</b></span><span>落定废墟<b data-stat="settledFragments">0</b></span><span>支撑检查<b data-stat="supportPending">0</b></span></div><button class="mc-diagnostic-start" data-action="start"><span>进入 / 继续飞行</span>${icon('arrow')}</button></details>

      <div class="mc-pilot-keys" hidden><span><kbd>W S</kbd> 前后</span><span><kbd>A D</kbd> 转向</span><span><kbd>Space</kbd> 升</span><span><kbd>Shift</kbd> 降</span><span><kbd>V</kbd> 观察</span></div>

      <section class="mc-help mc-panel" role="dialog" aria-labelledby="mc-help-title" hidden>
        <div class="mc-help-top"><span class="mc-section-number">操作指南 · 当前模式</span><button class="mc-icon-button" data-action="help" aria-label="关闭操作说明">${icon('close')}</button></div>
        <h2 id="mc-help-title">从海岸，出发。</h2>
        <p>点击画面或「进入城市」开始。按 Esc 释放鼠标，随时调整日照和管理存档。</p>
        <dl class="mc-controls"><div><dt><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></dt><dd>前后与左右飞行</dd></div><div><dt><kbd>Space / E</kbd><kbd>Q</kbd></dt><dd>上升 / 下降</dd></div><div><dt><kbd>Shift</kbd></dt><dd>加速飞行</dd></div><div><dt>鼠标</dt><dd>转动视角</dd></div><div><dt><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd></dt><dd>观察 / 挖除 / 爆破</dd></div><div><dt>鼠标左键</dt><dd>使用当前工具</dd></div><div><dt><kbd>H</kbd></dt><dd>返回初始视角</dd></div><div><dt><kbd>Esc</kbd><kbd>Tab</kbd></dt><dd>释放鼠标 / 操作说明</dd></div></dl>
        <div class="mc-help-foot">改动自动存入本机。导出一份存档，可以把这座小城带走。</div>
      </section>

      <dialog class="mc-tour-dialog mc-panel" aria-labelledby="mc-tour-title" aria-describedby="mc-tour-summary">
        <div class="mc-tour-top"><span>LIGHTHOUSE BAY · COASTAL TOUR</span><button class="mc-icon-button" data-action="close-tour" aria-label="关闭海岸导览">${icon('close')}</button></div>
        <h2 id="mc-tour-title">先从空中，认识这片海岸。</h2>
        <p id="mc-tour-summary">点一次即可自动起飞、游览并返回码头停稳，中途无需操作。<br>完整航线约 2 分钟 · 7 个航段 · 可以随时暂停或自己驾驶</p>
        <p class="mc-tour-resume" data-tour-resume hidden></p>
        <div class="mc-tour-itinerary">
          <svg viewBox="0 0 260 178" role="img" aria-label="旧城近岸导览路线：码头、滨海大道、灯塔、老城、海湾、码头返航">
            <rect width="260" height="178" rx="8" fill="#213f40"/>
            <path d="M0 0H260V99L228 113 189 107 145 118 112 109 70 118 24 112 0 119Z" fill="#637365"/>
            <path d="M0 119 24 112 70 118 112 109 145 118 189 107 228 113 260 99" fill="none" stroke="#bac7ac" stroke-width="1.5"/>
            <path d="M25 42H218M25 72H218M49 24V96M91 24V99M133 24V102M175 24V96M217 24V91" stroke="#a0a98b" stroke-width="2" opacity=".35"/>
            <polyline points="108,134 48,127 229,144 176,35 136,156 108,146 108,134" fill="none" stroke="#efc98b" stroke-width="2" stroke-dasharray="4 3" stroke-linejoin="round"/>
            <g fill="#f5dbad" stroke="#213f40" stroke-width="2"><circle cx="108" cy="134" r="4"/><circle cx="48" cy="127" r="4"/><circle cx="229" cy="144" r="4"/><circle cx="176" cy="35" r="4"/><circle cx="136" cy="156" r="4"/></g>
            <g fill="#f4edd9" font-family="system-ui,sans-serif" font-size="10"><text x="82" y="124">码头</text><text x="20" y="146">滨海大道</text><text x="202" y="163">灯塔</text><text x="184" y="29">老城</text><text x="149" y="166">海湾</text></g>
            <text x="12" y="18" fill="#e2d5b7" font-family="system-ui,sans-serif" font-size="8" letter-spacing="1">旧城 · 近岸航线</text>
          </svg>
          <ol>${COAST_ROUTE.map((point,index)=>`<li data-tour-preview-stop="${index}"><span>${String(index+1).padStart(2,'0')}</span>${point.name}</li>`).join('')}</ol>
        </div>
        <div class="mc-tour-instructions">
          <div><b>只管看风景</b><span>鼠标左拖 / 右拖环视，滚轮缩放，R 回正；不会改变航向。</span></div>
          <div><b>随时停下来</b><span>「暂停游览」减速悬停，「继续游览」接着飞。查看地图或手记时继续飞；切回页面会接着游览。WASD 或升降键切为手动，Esc 退出。</span></div>
        </div>
        <p class="mc-tour-scope">本航线覆盖旧城与近岸。西岸社区、东港和北岭等外围区域，可在返航后步行、驾车或自由飞行探索。</p>
        <div class="mc-tour-start"><button data-action="start-tour">开始自动游览</button><button data-action="close-tour">暂不出发</button></div>
      </dialog>

      <div class="mc-loader" role="status" aria-live="polite"><span class="mc-loading-orbit">${icon('coast')}</span><span data-load-label>正在唤醒海岸…</span><span class="mc-loading-track"><i></i></span></div>
      <div class="mc-toast" role="status" aria-live="polite" hidden></div>
      <div class="mc-corner-line mc-corner-line-left" aria-hidden="true"></div><div class="mc-corner-line mc-corner-line-right" aria-hidden="true"></div>
    `;
    root.append(this.element);
    this.regionMap=new RegionMap(this.require('.mc-region-map'),{open:()=>{this.helpPanel.hidden=true;if(this.isTourOpen)this.closeTour();this.callbacks.onHelpOpen?.();},journal:()=>this.callbacks.onFieldbook?.(),navigate:(id,drive)=>this.callbacks.onMapNavigate?.(id,drive)});
    this.journeyPicker=new JourneyPicker(this.element,{open:()=>{this.helpPanel.hidden=true;this.regionMap.close();this.closeTour();this.callbacks.onHelpOpen?.();},list:()=>this.callbacks.onListJourneys?.()??Promise.resolve([]),choose:slot=>this.callbacks.onChooseJourney?.(slot),create:()=>this.callbacks.onNewJourney?.()});
    this.recordingPanel=new RecordingPanel(this.element,{open:()=>{this.helpPanel.hidden=true;this.regionMap.close();this.closeTour();this.journeyPicker.close();this.callbacks.onHelpOpen?.();},start:settings=>this.callbacks.onBeginRecording?.(settings),stop:()=>this.callbacks.onStopRecording?.()});
    this.element.querySelectorAll<HTMLButtonElement>('[data-action="record-flight"]').forEach(button=>{button.textContent='录制';button.setAttribute('aria-label','录制设置');button.title='纯场景 / 带界面录制 · F9';});
    this.timeSlider = this.require<HTMLInputElement>('.mc-time-slider');
    this.timeLabel = this.require('[data-time]');
    this.saveStatus = this.require('[data-save-status]');
    this.saveMessage = this.require('[data-save-message]');
    this.loader = this.require('.mc-loader');
    this.loadFill = this.require('.mc-loading-track i');
    this.loadLabel = this.require('[data-load-label]');
    this.targetLabel = this.require('[data-target]');
    this.flightHint = this.require('.mc-flight-hint');
    this.helpPanel = this.require('.mc-help');
    this.intro = this.require('.mc-intro');
    this.toastElement = this.require('.mc-toast');
    this.menu = this.require('.mc-more-menu');
    this.statsElement = this.require('[data-stats]');
    this.require<HTMLDetailsElement>('.mc-performance').addEventListener('toggle', () => this.updateIntro());

    this.element.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((button) => {
      const tool = button.dataset.tool as Tool;
      this.toolButtons.set(tool, button);
      button.addEventListener('click', () => {
        this.setTool(tool);
        this.callbacks.onTool(tool);
      });
    });
    this.element.querySelectorAll<HTMLElement>('[data-action]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        const action = button.dataset.action;
        if (action === 'start') this.callbacks.onStart();
        if (action === 'home') this.callbacks.onHome();
        if (action === 'lab') this.callbacks.onLab?.();
        if (action === 'lab-blast') this.callbacks.onLabBlast?.();
        if (action === 'city') this.callbacks.onCity?.();
        if (action === 'pilot') this.callbacks.onPilot?.();
        if (action === 'drive') this.callbacks.onDrive?.();
        if (action === 'exit-drive') this.callbacks.onExitDrive?.();
        if (action === 'reset-look') this.callbacks.onResetLook?.();
        if (action === 'recover-car') this.callbacks.onRecoverCar?.();
        if (action === 'recover-vehicle') this.callbacks.onRecoverVehicle?.();
        if (action === 'clear-traffic') this.callbacks.onClearTraffic?.();
        if (action === 'exit-pilot') this.callbacks.onExitPilot?.();
        if (action === 'return-pad') this.callbacks.onReturnToPad?.();
        if (action === 'bicycle') this.callbacks.onBicycle?.();
        if (action === 'exit-bicycle') this.callbacks.onExitBicycle?.();
        if (action === 'tour') this.openTour();
        if (action === 'close-tour') this.closeTour();
        if (action === 'start-tour') { this.closeTour(); if(this.callbacks.onStartTour)this.callbacks.onStartTour();else this.callbacks.onAutopilot?.(); }
        if (action === 'autopilot') {
          if(this.vehicleState?.tourStatus==='active'||this.vehicleState?.tourStatus==='paused')this.callbacks.onAutopilot?.();
          else this.openTour();
        }
        if (action === 'tour-walk') this.callbacks.onTourExplore?.('walk');
        if (action === 'tour-drive') this.callbacks.onTourExplore?.('car');
        if (action === 'record-flight') this.callbacks.onRecord?.();
        if (action === 'sound') this.callbacks.onSound?.();
        if (action === 'walk') this.callbacks.onWalk?.();
        if (action === 'free-fly') this.callbacks.onFreeFly?.();
        if (action === 'rain-night') this.callbacks.onRainNight?.();
        if (action === 'toggle-view') this.callbacks.onToggleView?.();
        if (action === 'overview') { this.hasFlown = true; this.updateIntro(); this.callbacks.onOverview?.(); }
        if (action === 'diagnostics') {
          const diagnostics = this.require<HTMLDetailsElement>('.mc-performance');
          diagnostics.hidden = !diagnostics.hidden;
          diagnostics.open = !diagnostics.hidden;
        }
        if (action === 'export') this.callbacks.onExport();
        if (action === 'journeys') void this.journeyPicker.open();
        if (action === 'import') this.require<HTMLInputElement>('.mc-file-input').click();
        if (action === 'help') this.toggleHelp();
        if (action === 'reset') {
          this.menu.hidden = true;
          this.callbacks.onReset();
        }
        if (action === 'more') {
          this.menu.hidden = !this.menu.hidden;
          button.setAttribute('aria-expanded', String(!this.menu.hidden));
          if(!this.menu.hidden)this.callbacks.onMenuOpen?.();
        }
        if (action !== 'more' && action !== 'help') {
          this.menu.hidden = true;
          this.require('[data-action="more"]').setAttribute('aria-expanded','false');
        }
      });
    });
    this.element.querySelectorAll<HTMLButtonElement>('[data-weather]').forEach(button => button.addEventListener('click', () => this.callbacks.onWeather?.(button.dataset.weather as 'clear' | 'rain')));
    this.require<HTMLSelectElement>('.mc-street-panel select').addEventListener('change', event => this.callbacks.onPlace?.((event.target as HTMLSelectElement).value));
    this.require<HTMLInputElement>('.mc-file-input').addEventListener('change', (event) => {
      const input = event.target as HTMLInputElement;
      const file = input.files?.[0];
      if (file) this.callbacks.onImport(file);
      input.value = '';
    });
    this.timeSlider.addEventListener('input', () => {
      const hour = Number(this.timeSlider.value);
      this.setTime(hour);
      this.callbacks.onTime(hour);
    });
    for (const name of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'wheel'] as const) {
      this.element.addEventListener(name, (event) => event.stopPropagation());
    }
    this.element.addEventListener('keydown', (event) => {
      if (event.code === 'Tab' && this.isHelpOpen && !this.isModalOpen) {
        event.preventDefault();
        event.stopPropagation();
        this.toggleHelp();
        return;
      }
      const target = event.target;
      if (target instanceof HTMLInputElement || event.key === ' ') event.stopPropagation();
    });
    this.setTime(17.5);
    this.setTool('observe');
    this.setWalkView('third');
    this.setMouseMode('paused');
  }

  private require<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.element.querySelector<T>(selector);
    if (!element) throw new Error(`Missing interface element: ${selector}`);
    return element;
  }

  toggleMap(): void {
    this.regionMap.toggle();
  }
  setMapTerrain(world:VoxelWorld):void{this.regionMap.setTerrain(world);}
  setMapState(snapshot:MapSnapshot):void{this.regionMap.update(snapshot);}
  setGroundState(phase:string,status:string):void{this.require('[data-ground-status]').textContent=status;this.require('.mc-street-panel').dataset.groundPhase=phase;}
  get isMenuOpen(){return !this.menu.hidden;}
  closeMenu(){this.menu.hidden=true;this.require('[data-action="more"]').setAttribute('aria-expanded','false');}

  setTool(tool: Tool): void {
    this.currentTool = tool;
    this.element.dataset.tool = tool;
    this.toolButtons.forEach((button, value) => {
      button.classList.toggle('is-active', value === tool);
      button.setAttribute('aria-pressed', String(value === tool));
    });
    this.require('[data-tool-caption]').textContent = {observe:'观察 · 移动与查看',carve:'挖除 · 点按逐块挖除，长按连续作业',blast:'爆破 · 建筑破拆 / 地面弹坑 · 间隔 0.7 秒'}[tool];
    this.updateMouseLabels();
    this.updateFlightHint();
  }

  configureCollapse(isLab: boolean): void {
    this.element.classList.toggle('is-lab', isLab);
    this.require<HTMLElement>('.mc-collapse-controls').hidden = !isLab;
    this.element.querySelectorAll<HTMLButtonElement>('[data-action="lab"]').forEach(button => { button.hidden = isLab; });
    this.require<HTMLButtonElement>('[data-action="lab-blast"]').hidden = !isLab;
    this.require<HTMLButtonElement>('[data-action="city"]').hidden = !isLab;
    this.require<HTMLDetailsElement>('.mc-performance').hidden = !isLab;
    this.require<HTMLDetailsElement>('.mc-region-map').hidden = isLab;
    this.require('.mc-mode-bar').hidden = isLab;
    if (isLab) {
      this.element.querySelectorAll<HTMLElement>('[data-action="walk"],[data-action="rain-night"],[data-action="free-fly"],[data-action="overview"],[data-action="drive"],.mc-weather-switch').forEach(e => e.hidden = true);
      this.require('.mc-location div span').innerHTML = '镜海<span class="mc-location-separator">/</span>结构试验场';
      this.require('.mc-location small').textContent = 'SEED 048271 · 256 × 256 M · STRUCTURE LAB';
      this.require('.mc-intro-note').textContent = '独立场景 · 建筑支撑与废墟存档';
      this.require('.mc-intro h1').innerHTML = '让建筑，<br />回应每次冲击<span>。</span>';
      this.require('.mc-intro p').innerHTML = '试射支柱，观察楼体如何失去支撑。<br />落下的废墟，也会留在这片海岸。';
      this.require('.mc-enter span').textContent = '自由镜头';
      this.require<HTMLButtonElement>('.mc-enter').dataset.action = 'start';
      this.require<HTMLButtonElement>('.mc-observe').hidden = true;
      this.require('[data-collapse-hint]').textContent = '独立试验存档 · 不影响沿海城市';
    }
  }

  configureVehicle(available: boolean): void {
    this.vehicleAvailable = available;
    this.element.classList.toggle('has-vehicle', available);
    this.require('.mc-vehicle-panel').hidden = !available;
    this.require('.mc-menu-pilot').hidden = !available;
    this.require('[data-mode="helicopter"]').hidden = !available;
    this.require('.mc-tour-entry').hidden = !available;
    this.require('.mc-region-map').hidden=!available;
    if(!available)this.closeTour();
    this.element.querySelectorAll<HTMLButtonElement>('[data-action="record-flight"]').forEach(button => { button.hidden = !available; });
    if (available) {
      this.require<HTMLButtonElement>('.mc-enter').dataset.action = 'walk';
      this.require('.mc-enter span').textContent = '步行探索';
      this.require<HTMLButtonElement>('.mc-observe').dataset.action = 'free-fly';
      this.require<HTMLButtonElement>('.mc-observe').hidden = false;
      this.require('.mc-intro h1').innerHTML = '穿过城市，<br />沿海岸去远方<span>。</span>';
      this.require('.mc-intro p').innerHTML = '驶出旧城，经过东港与白墙社区。<br />沿一公里公路，在沙滩、海岬与北岭之间探索。';
      this.require('.mc-location div span').innerHTML = '镜海<span class="mc-location-separator">/</span>灯塔湾';
    }
    this.updateExplorationPanels();
    this.updateHelp();
  }

  configureCar(available: boolean): void {
    this.carAvailable = available;
    this.element.classList.toggle('has-car', available);
    this.element.querySelectorAll<HTMLElement>('[data-action="drive"]').forEach(button => { button.hidden = !available; });
    if (!available) this.carState = undefined;
    this.updateExplorationPanels(); this.updateHelp();
  }

  setCarState(state: CarViewState): void {
    const changed=this.carState?.driving!==state.driving;
    this.carState = { ...state };
    this.element.classList.toggle('is-driving', state.driving);
    const panel = this.require('.mc-car-panel');
    panel.dataset.driving = String(state.driving);
    panel.dataset.speed = String(state.speed);
    panel.dataset.blocked = String(state.blocked);
    panel.dataset.grounded = String(state.grounded);
    this.require('[data-car-speed]').textContent = String(Math.round(Math.abs(state.speed) * 3.6));
    const feedback=carFeedback(state);this.require('[data-car-status]').textContent=feedback.status;this.require('[data-car-condition]').textContent=feedback.condition;
    this.require('[data-car-gear]').textContent=state.speed<-.2?'R':state.driving?'D':'P';
    for(const side of ['left','right'])this.require(`[data-car-${side}]`).classList.toggle('is-lit',state.signalLit&&(state.signal===side||state.signal==='hazard'));
    if (state.driving) this.hasFlown = true;
    if(changed){this.updateExplorationPanels(); this.updateIntro(); this.updateHelp(); this.updateFlightHint();}
  }

  setTrafficClearanceBusy(busy:boolean):void{
    this.element.classList.toggle('is-clearing-traffic',busy);
    this.element.querySelectorAll<HTMLButtonElement>('[data-action="clear-traffic"]').forEach(button=>button.disabled=busy);
  }

  setExploration(walking: boolean, placeId?: string): void {
    this.walking = walking;
    this.element.classList.toggle('is-walking', walking);
    this.element.dataset.exploration = walking ? 'walk' : 'fly';
    this.updateExplorationPanels();
    if (placeId) {
      const place = STREET_PLACES.find(p => p.id === placeId);
      if (place) {
        this.require<HTMLSelectElement>('.mc-street-panel select').value = place.id;
        this.require('[data-street-place]').textContent = place.name;
      }
    }
    this.updateIntro(); this.updateHelp(); this.updateFlightHint();
  }

  setWalkView(mode: 'first' | 'third'): void {
    this.walkView = mode;
    this.element.dataset.walkView = mode;
    const button = this.require<HTMLButtonElement>('[data-action="toggle-view"]');
    const label = mode === 'first' ? '第一人称' : '第三人称';
    button.innerHTML = `${label} <kbd>C</kbd>`;
    button.setAttribute('aria-label', `切换视角，当前${label}`);
    button.setAttribute('aria-pressed', String(mode === 'third'));
    this.updateFlightHint();
  }

  setMouseMode(mode: 'locked' | 'drag' | 'paused'): void {
    this.mouseMode = mode;
    this.element.dataset.mouseMode = mode;
    const resume = this.hasFlown ? '继续控制' : '开始控制';
    this.updateMouseLabels();
    this.element.querySelectorAll<HTMLButtonElement>('[data-control-resume]').forEach(button => {
      button.textContent = mode === 'paused' ? resume : '重新接管';
    });
    this.updateFlightHint();
  }

  private updateExplorationPanels(): void {
    const state=explorationPresentation({walking:this.walking,piloting:!!this.vehicleState?.piloting,driving:!!this.carState?.driving,vehicleAvailable:this.vehicleAvailable,carAvailable:this.carAvailable});
    const cycling=!!this.bicycleState?.riding;
    this.require('.mc-street-panel').hidden = cycling||!state.street;
    this.require('.mc-observer-panel').hidden = cycling||!state.observer;
    this.require('.mc-car-panel').hidden = cycling||!state.car;
    this.require('.mc-vehicle-panel').hidden = cycling||!state.helicopter;
    this.require('.mc-bicycle-panel').hidden=!cycling;
    this.element.classList.toggle('is-cycling',cycling);
    const mode:ControlMode=cycling?'bicycle':state.mode;
    this.recordingPanel.setMode(mode);
    this.element.dataset.mode=mode;
    this.element.classList.toggle('is-walking',state.street);
    this.element.classList.toggle('is-driving',state.car);
    this.element.classList.toggle('is-piloting',state.helicopter);
    this.element.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button=>{
      button.setAttribute('aria-pressed',String(button.dataset.mode===mode));
    });
    this.element.classList.toggle('is-observing', state.observer);
    this.updateFlightHint();
  }

  setWeather(weather: 'clear' | 'rain'): void {
    this.element.dataset.weather = weather;
    this.element.querySelectorAll<HTMLButtonElement>('[data-weather]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.weather === weather)));
  }

  setBicycleState(state:BicycleViewState):void{const changed=this.bicycleState?.riding!==state.riding;this.bicycleState={...state};this.require('[data-bicycle-speed]').textContent=`${Math.round(Math.abs(state.speed)*3.6)} km/h`;this.require('[data-bicycle-status]').textContent=state.blocked||'W 蹬车 · S 制动 / 退行 · A / D 转向 · Space 刹车';if(changed){this.updateExplorationPanels();this.updateHelp();this.updateFlightHint();}}

  setVehicleState(state: HelicopterViewState): void {
    const wasPiloting = this.vehicleState?.piloting ?? false;
    this.vehicleState = { ...state };
    const panel = this.require('.mc-vehicle-panel');
    const mode = state.autopilot ? 'autopilot' : state.piloting ? 'piloting' : state.grounded ? 'parked' : 'paused';
    panel.dataset.vehicleState = mode;
    panel.dataset.altitude = String(state.altitude);
    panel.dataset.speed = String(state.speed);
    panel.dataset.routeIndex = String(state.routeIndex);
    panel.dataset.rpm = String(state.rpm);
    panel.dataset.grounded = String(state.grounded);
    panel.dataset.routeComplete = String(state.routeComplete);
    panel.dataset.tourStatus=state.tourStatus;
    this.element.classList.toggle('is-piloting', state.piloting);
    this.element.classList.toggle('is-touring',state.autopilot);
    this.updateExplorationPanels();
    this.require('.mc-pilot-keys').hidden = !state.piloting||state.autopilot;
    if (state.piloting) this.hasFlown = true;
    this.updateIntro();
    this.require('[data-vehicle-speed]').textContent = String(Math.max(0, state.speed * 3.6).toFixed(0));
    this.require('[data-vehicle-altitude]').textContent = String(Math.max(0, state.altitude).toFixed(0));
    this.require('[data-vehicle-rpm]').textContent = `${Math.round(Math.max(0, Math.min(1, state.rpm)) * 100)}%`;
    this.require('span[data-waypoint]').textContent = state.routeComplete ? '欢迎回到码头' : state.waypoint;
    this.require('[data-route-count]').textContent = `${String(Math.min(state.routeIndex + 1, COAST_ROUTE.length)).padStart(2, '0')} / ${String(COAST_ROUTE.length).padStart(2, '0')}`;
    this.require('[data-vehicle-status]').textContent = state.routeComplete ? '游览完成 · 已返航' : state.autopilot ? '海岸导览 · 自动飞行' : state.tourStatus==='paused'?'导览暂停 · 可手动驾驶':state.piloting ? state.rpm < .7 ? '旋翼启动中' : state.grounded ? '等待起飞' : '手动驾驶' : state.grounded ? '停机坪待命' : '悬停 · 等待接管';
    this.require('[data-vehicle-note]').textContent = state.autopilot ? '观景航速 · 接近航点自动减速 · 地图、手记照常查看。' : state.tourStatus==='paused'?'当前航段已保留，点击「继续游览」接着飞。':state.piloting ? state.rpm<.72?'旋翼加速中，动力就绪后起飞 · 左红右绿航行灯与防撞灯自动开启。':'W 前进约 115 km/h · 松开回到悬停 · 航行灯自动，低空开启着陆灯。' : '自动起飞、沿岸游览，最后返航降落。';
    const waypoint=COAST_ROUTE[Math.min(state.routeIndex,COAST_ROUTE.length-1)];
    this.require('[data-tour-stage]').textContent=state.routeComplete?'接下来，走进刚才看到的街道':state.tourStatus==='idle'?'想先认识这片海岸？':`${state.autopilot?'飞往':'当前航段'} · ${waypoint.name}`;
    this.require('[data-tour-distance]').textContent=state.routeComplete||state.tourStatus==='idle'?'':`距目标约 ${Math.round(state.waypointDistance)} m`;
    this.require('[data-tour-description]').textContent=state.routeComplete?'直升机已在码头停稳。前往渔港逛木屋街，再去寻找海岸手记里的探索地点。':state.tourStatus==='idle'?'选择「开始自动游览」，飞机会带你看海岸、灯塔和老城，并自动返航。':waypoint.description;
    this.require('[data-tour-next]').textContent=state.routeComplete?'步行、汽车与自由飞行都可以继续探索。':`航段 ${state.routeIndex+1} / ${COAST_ROUTE.length} · ${COAST_ROUTE[state.routeIndex+1]?`下一站：${COAST_ROUTE[state.routeIndex+1].name}`:'最后一段：自动降落'}`;
    this.require('.mc-tour-followup').hidden=!state.routeComplete;
    const resume=this.require('[data-tour-resume]');resume.hidden=state.tourStatus!=='paused'&&state.tourStatus!=='active';
    resume.textContent=state.autopilot?`正在自动执行第 ${state.routeIndex+1} / ${COAST_ROUTE.length} 航段 · ${waypoint.name}。查看说明不会中断飞行。`:`已暂停在第 ${state.routeIndex+1} / ${COAST_ROUTE.length} 航段 · ${waypoint.name}。继续后从当前位置接着飞。`;
    this.require('.mc-tour-start [data-action="close-tour"]').textContent=state.autopilot?'关闭说明':state.tourStatus==='paused'?'保持暂停':'暂不出发';
    panel.querySelectorAll<HTMLElement>('[data-route-stop]').forEach(stop => {
      const index = Number(stop.dataset.routeStop);
      stop.classList.toggle('is-complete', index < state.routeIndex || state.routeComplete);
      stop.classList.toggle('is-current', index === state.routeIndex && !state.routeComplete);
      if (index === state.routeIndex && !state.routeComplete) stop.setAttribute('aria-current', 'step');
      else stop.removeAttribute('aria-current');
    });
    this.element.querySelectorAll<HTMLElement>('[data-tour-preview-stop]').forEach(stop=>{
      const index=Number(stop.dataset.tourPreviewStop),current=index===state.routeIndex&&!state.routeComplete&&state.tourStatus!=='idle';
      stop.classList.toggle('is-current',current);stop.classList.toggle('is-complete',index<state.routeIndex||state.routeComplete);
      if(current)stop.setAttribute('aria-current','step');else stop.removeAttribute('aria-current');
    });
    const pilot = panel.querySelector<HTMLButtonElement>('[data-action="pilot"]')!;
    pilot.hidden = state.piloting;
    const autopilot = panel.querySelector<HTMLButtonElement>('[data-action="autopilot"]')!;
    autopilot.textContent = state.autopilot ? '暂停游览' : state.tourStatus==='paused'?'继续游览':state.routeComplete?'再游览一圈':'开始自动游览';
    autopilot.disabled = false;
    this.require('[data-action="start-tour"]').textContent=state.routeComplete?'重新开始游览':state.autopilot?'返回自动游览':state.tourStatus==='paused'?'继续自动游览':'开始自动游览';
    const exit=panel.querySelector<HTMLButtonElement>('[data-action="exit-pilot"]')!;exit.hidden=!state.piloting;exit.disabled=!state.grounded||state.speed>.8;exit.title=state.grounded?'在机旁安全落脚点下机':'先下降落地，或按 H 自动返航降落';
    if(state.piloting&&!state.grounded)this.require('[data-vehicle-note]').textContent='空中不能下机：Shift 下降，落地后 F；H 自动返航降落。';
    const returning=state.flightMode==='return';
    this.require('.mc-route-stops').hidden=returning;this.require('[data-return-stops]').hidden=!returning;
    if(returning){
      const phase=state.returnPhase??'planning',index={braking:0,planning:0,climb:0,cruise:1,approach:2,landing:3,holding:-1,complete:4}[phase];
      const descriptions={braking:'正在减速并保持高度，稳定后从实际位置规划离场通路。',planning:'正在检查机身、旋翼和尾部的离场空间。确认通路后自动起飞。',climb:'先沿安全通路离开遮挡，再爬升至安全高度。',cruise:'正在飞回码头停机坪。可以拖动鼠标环视，飞行按键随时接管。',approach:'正在减速、对准停机坪并下降；降落区被占用时会悬停等待。',landing:'正在缓慢下降，停稳前不能下机。',holding:'通路受阻，正在悬停。可手动离开障碍后按 H 重新规划；停机坪恢复畅通后会继续进近。',complete:'已在码头停稳。按 F 在机旁下机，接着步行或驾车探索。'};
      panel.dataset.flightMode='return';panel.dataset.returnPhase=phase;
      this.require('[data-route-count]').textContent=phase==='complete'?'已停稳':phase==='holding'?'等待通路':`${String(Math.min(4,index+1)).padStart(2,'0')} / 04`;
      this.require('[data-vehicle-status]').textContent=state.routeComplete?'自动返航完成':!state.autopilot?'返航已暂停 · 可手动驾驶':phase==='holding'?'自动返航 · 悬停等待':'自动返航';
      this.require('[data-tour-stage]').textContent=state.waypoint;
      this.require('[data-tour-distance]').textContent=state.routeComplete?'':`距停机坪约 ${Math.round(state.waypointDistance)} m`;
      this.require('[data-tour-description]').textContent=!state.autopilot&&!state.routeComplete?'已恢复手动飞行：W/S 前后，A/D 转向，Q/E 侧移，Space/Shift 升降。按 H 可重新规划返航。':phase==='climb'&&state.returnAltitude!==undefined?`沿安全通路离场，爬升至约 ${Math.round(state.returnAltitude)} m 后回航。`:descriptions[phase];
      this.require('[data-tour-next]').textContent=state.routeComplete?'落地后 F 下机':!state.autopilot?'H 或「继续返航」重新规划':'离场 → 回航 → 进近 → 降落 · 飞行按键可接管';
      this.require('[data-vehicle-note]').textContent=state.routeComplete?'按 F 下机；Space 或方向控制可重新启动起飞。':!state.autopilot?'手动操纵已恢复 · H 重新返航':'H 自动返航 · 飞行按键接管 · 停稳后 F 下机';
      autopilot.textContent=state.routeComplete?'再游览一圈':state.autopilot?phase==='holding'?'暂停返航':'暂停返航':'继续返航';
      resume.textContent=state.autopilot?'正在自动返航，查看地图和手记不会中断飞行。':'返航已暂停，继续时从当前位置重新检查安全通路。';
      this.require('[data-action="start-tour"]').textContent='开始海岸游览';
      panel.querySelectorAll<HTMLElement>('[data-return-stop]').forEach(stop=>{const n=Number(stop.dataset.returnStop);stop.classList.toggle('is-current',n===index&&(state.autopilot||state.routeComplete));stop.classList.toggle('is-complete',n<index);});
    }else{panel.dataset.flightMode='tour';delete panel.dataset.returnPhase;}
    if(state.recoverySuggested){
      this.require('[data-vehicle-status]').textContent='持续受阻 · 可安全脱困';
      this.require('[data-vehicle-note]').textContent='普通碰撞仍然生效；按 G 或点击「脱困」，检查附近安全空域后解除卡住。';
    }
    if (state.piloting && !wasPiloting && this.isHelpOpen) this.toggleHelp();
    this.updateHelp();
    this.updateFlightHint();
  }

  setRecording(active: boolean): void {
    this.element.querySelectorAll<HTMLButtonElement>('[data-action="record-flight"]').forEach(button => {
      button.disabled = false;
      button.textContent = active ? '停止录制' : '录制';
      button.setAttribute('aria-label', active ? '停止录制并保存' : '录制设置');
    });
    this.element.dataset.recording = String(active);
  }
  openRecording():void{this.recordingPanel.open();}
  recordingProgress(phase:'selecting'|'countdown'|'recording',seconds:number,audio:boolean):void{this.recordingPanel.progress(phase,seconds,audio);}
  finishRecording(blob?:Blob,error?:string):void{this.recordingPanel.finish(blob,error);}
  togglePresentation():void{const root=this.element.parentElement!;const hidden=root.classList.toggle('is-presentation');this.toast(hidden?'常规界面已收起 · F8 恢复，F9 录制设置或停止':'已显示常规界面');}

  setSoundEnabled(enabled: boolean): void {
    const button = this.require<HTMLButtonElement>('[data-action="sound"]');
    button.textContent = enabled ? '关闭声音' : '开启声音';
    button.setAttribute('aria-pressed', String(enabled));
    this.element.dataset.soundEnabled = String(enabled);
  }

  setCollapseState(message: string): void {
    this.require('[data-collapse-state]').textContent = message;
  }

  setTime(hour: number): void {
    const normalized = ((hour % 24) + 24) % 24;
    this.timeSlider.value = String(normalized);
    const minutes = Math.round(normalized * 60) % 1440;
    this.timeLabel.textContent = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    this.timeSlider.style.setProperty('--time-progress', `${normalized / 24 * 100}%`);
  }

  setSaveStatus(status: 'saving' | 'saved' | 'error' | 'loading', message?: string): void {
    this.saveStatus.dataset.saveStatus = status;
    this.saveMessage.textContent = message ?? ({ saving: '正在保存…', saved: '所有改动已保存', error: '保存失败，请导出备份', loading: '正在读取…' }[status]);
    this.saveStatus.title = this.saveMessage.textContent;
  }

  setLoading(progress: number, label?: string): void {
    const value = Math.max(0, Math.min(1, progress));
    this.loader.hidden = value >= 1;
    this.loadFill.style.width = `${value * 100}%`;
    if (label) this.loadLabel.textContent = label;
    this.element.classList.toggle('is-loading', value < 1);
  }

  setStats(stats: Stats): void {
    this.require('[data-fps]').textContent = `${Math.round(stats.fps)} FPS`;
    this.statsElement.dataset.fps = String(Math.round(stats.fps));
    this.statsElement.dataset.frameMs = stats.frameMs.toFixed(2);
    for (const [key, value] of Object.entries(stats)) {
      this.statsElement.dataset[key] = String(value);
      const output = this.element.querySelector<HTMLElement>(`[data-stat="${key}"]`);
      if (output) output.textContent = key === 'frameMs' ? `${value.toFixed(1)} ms` : Math.round(value).toLocaleString();
    }
  }

  setTarget(target: { x: number; y: number; z: number; distance: number } | null): void {
    this.targetLabel.hidden = target === null;
    this.element.classList.toggle('has-target', target !== null);
    if (target) {
      this.targetLabel.textContent = `${target.x} · ${target.y} · ${target.z}  /  ${target.distance.toFixed(1)} m`;
      this.targetLabel.dataset.x = String(target.x);
      this.targetLabel.dataset.y = String(target.y);
      this.targetLabel.dataset.z = String(target.z);
    }
  }

  setFlying(active: boolean): void {
    if (active) this.hasFlown = true;
    this.element.classList.toggle('is-flying', active);
    if (!active) this.setMouseMode('paused');
    else if (this.mouseMode === 'paused') this.setMouseMode('drag');
    this.updateIntro();
    if (active && this.isHelpOpen) this.toggleHelp();
    this.updateFlightHint();
  }

  private updateIntro(): void {
    const collapsed = this.walking || this.hasFlown || !!this.vehicleState?.piloting || !!this.carState?.driving || !!this.bicycleState?.riding || this.require<HTMLDetailsElement>('.mc-performance').open;
    this.intro.classList.toggle('is-collapsed', collapsed);
    this.intro.inert = collapsed;
    this.intro.setAttribute('aria-hidden', String(collapsed));
  }

  private updateMouseLabels(): void {
    const edit=this.currentTool!=='observe';
    const action=this.currentTool==='blast'?'爆破':'挖除';
    const message=this.mouseMode==='paused'
      ? '点击画面或「开始控制」接管 · Esc 释放鼠标'
      : this.mouseMode==='locked'
        ? `移动鼠标转向${edit?` · 左键点按 / 长按${action}`:''} · Esc 释放`
        : edit
          ? `左键点按 / 长按${action} · 左拖或右拖转向`
          : '左键或右键拖动转向 · WASD 移动';
    this.element.querySelectorAll<HTMLElement>('[data-mouse-status]').forEach(label=>{label.textContent=message;});
  }

  private updateFlightHint(): void {
    if(this.bicycleState?.riding){this.flightHint.innerHTML='<kbd>W</kbd> 蹬车<span>·</span><kbd>Space</kbd> 刹车<span>·</span><kbd>F / E</kbd> 下车<span>·</span><kbd>M</kbd> 地图';return;}
    if (this.carState?.driving) { this.flightHint.innerHTML = '<kbd>W / S</kbd> 油门 / 倒车<span>·</span><kbd>A / D</kbd> 转向<span>·</span><kbd>Esc</kbd> 下车'; return; }
    if (this.vehicleState?.piloting) { this.flightHint.innerHTML=this.vehicleState.autopilot?(this.vehicleState.flightMode==='return'?'自动返航中<span>·</span>飞行按键接管<span>·</span>停稳后 <kbd>F</kbd> 下机':'鼠标拖动环视<span>·</span>暂停游览可悬停<span>·</span><kbd>H</kbd> 自动返航'):this.vehicleState.grounded?'<kbd>Space</kbd> 升空<span>·</span><kbd>F</kbd> 下机<span>·</span><kbd>H</kbd> 自动返航':'<kbd>Shift</kbd> 下降落地后 F 下机<span>·</span><kbd>H</kbd> 自动返航';return; }
    const edit=this.currentTool!=='observe';
    const action={observe:'观察',carve:'挖除',blast:'爆破'}[this.currentTool];
    const mouse=this.mouseMode==='paused'?'点击画面接管':this.mouseMode==='locked'?'移动鼠标转向':'左拖 / 右拖转向';
    const use=edit?`${action}准星目标<span>·</span>左键点按 / 长按<span>·</span>`:'';
    const view=this.walking?`<span>·</span><kbd>C</kbd> ${this.walkView==='third'?'第三人称':'第一人称'}`:'';
    this.flightHint.innerHTML=`${use}${mouse}${view}<span>·</span><kbd>Esc</kbd> 释放`;
  }

  toast(message: string, isError = false): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastElement.textContent = message;
    this.toastElement.classList.toggle('is-error', isError);
    this.toastElement.hidden = false;
    this.toastTimer = setTimeout(() => { this.toastElement.hidden = true; }, isError ? 6500 : 3600);
  }

  toggleHelp(): void {
    if(this.recordingPanel.isOpen){this.recordingPanel.close();return;}
    if(this.journeyPicker.isOpen){this.journeyPicker.close();return;}
    if(this.regionMap.isOpen){this.regionMap.close();return;}
    if(this.require<HTMLDialogElement>('.mc-tour-dialog').open){this.closeTour();return;}
    this.helpPanel.hidden = !this.helpPanel.hidden;
    if(!this.helpPanel.hidden)this.callbacks.onHelpOpen?.();
    this.element.querySelector<HTMLElement>('.mc-top-actions [data-action="help"]')?.setAttribute('aria-expanded', String(!this.helpPanel.hidden));
    if (!this.helpPanel.hidden) this.helpPanel.querySelector<HTMLButtonElement>('button')?.focus();
  }

  private openTour():void{
    if(!this.vehicleAvailable)return;
    this.helpPanel.hidden=true;
    this.regionMap.close();
    this.callbacks.onHelpOpen?.();
    const dialog=this.require<HTMLDialogElement>('.mc-tour-dialog');
    if(!dialog.open)dialog.showModal();
    dialog.querySelector<HTMLButtonElement>('[data-action="start-tour"]')!.focus();
  }

  private closeTour():void{
    const dialog=this.require<HTMLDialogElement>('.mc-tour-dialog');
    if(!dialog.open)return;
    dialog.close();
    this.require<HTMLButtonElement>('.mc-tour-entry').focus();
  }

  get isHelpOpen(): boolean { return !this.helpPanel.hidden||this.isModalOpen; }
  get isTourOpen():boolean{return this.require<HTMLDialogElement>('.mc-tour-dialog').open;}
  get isModalOpen():boolean{return this.isTourOpen||this.regionMap.isOpen||this.journeyPicker.isOpen||this.recordingPanel.isOpen;}
  setJourneySlot(slot?:string):void{this.journeyPicker.setCurrent(slot);}
  get isMapOpen():boolean{return this.regionMap.isOpen;}

  private updateHelp(): void {
    const mode = this.bicycleState?.riding?'bicycle':this.carState?.driving ? 'drive' : this.vehicleState?.piloting ? 'pilot' : this.walking ? 'walk' : this.vehicleAvailable ? 'coast' : 'observe';
    if (mode === this.lastHelpMode) return;
    this.lastHelpMode = mode;
    const controls = this.require('.mc-controls');
    if(mode==='bicycle'){this.require('#mc-help-title').textContent='沿海慢骑，也可以停下来。';this.require('.mc-help p').textContent='W 蹬车，S 制动后可以低速退行挪车，Space 刹车。转弯随车速变化，接近高台阶、断边或水面会停住；F / E 安全下车后继续步行。鼠标拖动只环视，不改变车头方向。';}
    else if (mode === 'drive') {
      this.require('#mc-help-title').textContent = '沿着公路，开向海岸。';
      this.require('.mc-help p').textContent = '旧城、工业港、山麓社区与海岬由真实道路相连。按 M 查看导航；停车下车后可以继续步行探索。';
    } else if (mode === 'walk') {
      this.require('#mc-help-title').textContent = '沿着街灯，慢慢走。';
      this.require('.mc-help p').textContent = '靠近长椅、面向座位按 E 坐下；坐着时拖动鼠标看风景，E / Space 起身，WASD 起身后行走。面向有安全落点的低栏按 E 翻越；Space 是普通跳跃。Esc 释放操作，C 切换视角。';
    } else if (mode === 'pilot') {
      this.require('#mc-help-title').textContent = '沿着海岸，飞一圈。';
      this.require('.mc-help p').textContent = '手动起飞按 Space，旋翼启动时需短暂等待。手动巡航更快，自动游览会为观景与返航减速。左红右绿航行灯、尾灯和防撞灯随引擎开启，低空使用着陆灯。拖动环视、滚轮缩放，R 回正；打开地图或手记不打断自动游览。';
    } else {
      this.require('#mc-help-title').textContent = this.vehicleAvailable ? '从码头，出发。' : '从海岸，出发。';
      this.require('.mc-help p').textContent = '自由镜头悬浮观察，WASD 水平移动，Space / E 上升、Q 下降；地面和建筑会挡住镜头。地面探索请选择顶部「步行」。鼠标锁定时直接移动转向，未锁定时左拖或右拖转向；挖除、爆破用左键点按或长按。';
    }
    const guideMode:ControlMode=mode==='bicycle'?'bicycle':mode==='drive'?'car':mode==='pilot'?'helicopter':mode==='walk'?'walk':'fly';
    const guide=[...controlGuide(guideMode),{keys:'鼠标',action:guideMode==='walk'||guideMode==='fly'?'锁定时移动转向；未锁定时左拖 / 右拖转向':'左拖 / 右拖环视；滚轮缩放'},{keys:'M / J',action:'区域地图 / 海岸手记'},{keys:'Tab',action:'打开 / 关闭当前模式说明'},{keys:'F9',action:'录制设置 / 停止并保存'},{keys:'F8',action:'收起 / 显示常规界面'}];
    controls.replaceChildren(...guide.filter(c=>c.keys!=='M / J'||!this.element.classList.contains('is-lab')).map(({keys,action})=>{const row=document.createElement('div'),term=document.createElement('dt'),key=document.createElement('kbd'),description=document.createElement('dd');key.textContent=keys;term.append(key);description.textContent=action;row.append(term,description);return row;}));
  }

  dispose(): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.recordingPanel.dispose();this.journeyPicker.dispose();this.regionMap.dispose();this.element.remove();
  }
}

