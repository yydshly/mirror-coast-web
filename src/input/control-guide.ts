export type ControlMode='walk'|'car'|'helicopter'|'fly'|'bicycle';
export const MODE_NAMES:Record<ControlMode,string>={walk:'步行',car:'汽车',helicopter:'直升机',fly:'自由镜头',bicycle:'自行车'};
export function controlGuide(mode:ControlMode):Array<{keys:string;action:string}>{
 const controls={
  walk:[['WASD','行走'],['Shift','跑步'],['Space','跳跃 / 坐姿起身'],['E','坐下 / 起身 / 翻低栏 / 附近互动'],['C','第一 / 第三人称'],['1 / 2 / 3','观察 / 挖除 / 爆破'],['H','切至直升机并自动返航'],['Esc','释放操作']],
  car:[['W / S','油门 / 制动后倒车'],['A / D','转向'],['Space','刹车'],['Z / C','左 / 右转向灯'],['X','双闪'],['R','视角回正'],['G','救援至附近安全公路'],['F / Esc','停车下车'],['H','切至直升机并自动返航']],
  helicopter:[['W / S','前进 / 后退'],['A / D','转向'],['Q / E','左右侧移'],['Space / Shift','上升 / 下降'],['R','视角回正'],['G','脱困至附近安全空域并悬停'],['F','落地后安全下机'],['H','自动驾驶返航并降落'],['Esc','空中退出并悬停；落地时下机']],
  bicycle:[['W / S','蹬车 / 制动后退行'],['A / D','转向'],['Space','刹车'],['G','挪到附近稳固地面'],['F / E / Esc','停稳下车'],['R','视角回正'],['H','切至直升机并自动返航']],
  fly:[['WASD','水平移动'],['Space / E','上升'],['Q','下降'],['Shift','加速'],['方向键','转动视角'],['1 / 2 / 3','观察 / 挖除 / 爆破'],['V','登机'],['H','切至直升机并自动返航'],['Esc','释放操作']],
 }[mode];
 return controls.map(([keys,action])=>({keys,action}));
}

