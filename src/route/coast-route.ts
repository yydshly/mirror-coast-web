import type { Vec3 } from '../destruction/types';

export const HELIPAD = { position: { x: 108, y: 15.04, z: 209 }, radius: 5.2 };
export const HELICOPTER_SPAWN: Vec3 = { x: 108, y: 16.6, z: 209 };
export const COAST_ROUTE: Array<{ id: string; name: string; shortName:string; description:string; position: Vec3; radius: number }> = [
  { id: 'departure', name: '码头升空', shortName:'起飞', description:'自动启动旋翼并升高。向下看看停机坪与木栈渔港，接下来沿岸飞行。', position: { x: 108, y: 36, z: 209 }, radius: 6 },
  { id: 'promenade', name: '滨海大道', shortName:'海岸', description:'沿海岸掠过商店街。拖动鼠标环视，看看街屋、滨海步道与近岸船只。', position: { x: 48, y: 40, z: 202 }, radius: 10 },
  { id: 'lighthouse', name: '灯塔海岬', shortName:'灯塔', description:'沿海湾飞向灯塔。留意海岬上的白色塔身与岸边浪线，也可以暂停下来慢慢看。', position: { x: 229, y: 66, z: 219 }, radius: 12 },
  { id: 'city', name: '老城上空', shortName:'老城', description:'升高俯瞰老城的街道网格与屋顶。远处还能看到向港区和山麓延伸的道路。', position: { x: 176, y: 78, z: 110 }, radius: 12 },
  { id: 'bay', name: '海湾回航', shortName:'海湾', description:'离开屋顶，回到开阔海湾。返航后可换成步行或汽车，继续探索刚才看到的地方。', position: { x: 136, y: 55, z: 231 }, radius: 10 },
  { id: 'approach', name: '码头进近', shortName:'进近', description:'正在减速并对准停机坪，接下来会自动下降。无需按键，也可以继续拖动鼠标环视。', position: { x: 108, y: 30, z: 221 }, radius: 5 },
  { id: 'landing', name: '返回停机坪', shortName:'降落', description:'缓慢下降至木栈停机坪。等旋翼停下后，选择前往渔港步行，或再游览一圈。', position: { ...HELICOPTER_SPAWN }, radius: 1.5 },
];
