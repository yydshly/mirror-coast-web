import { REGION_PLACES } from '../world/region-layout';

export const STREET_PLACES = [
  {id:'city-beach',name:'旧城东岸 · 潮线沙滩',position:{x:260,y:16.68,z:181.2},lookAt:{x:260,y:15.5,z:195}},
  {id:'coast-rest',name:'海堤长椅 · 港口眺望',position:{x:183,y:17.68,z:172.8},lookAt:{x:183,y:17.4,z:171.7}},
  {id:'seafront',name:'滨海长椅 · 看海',position:{x:61,y:17.68,z:172.8},lookAt:{x:61,y:17.4,z:171.7}},
  { id: 'market', name: '滨海商店街', position: { x: 135.5, y: 17.68, z: 159.5 }, lookAt: { x: 185, y: 18.1, z: 159.5 } },
  { id: 'lane', name: '老城窄巷', position: { x: 124.5, y: 17.68, z: 117.5 }, lookAt: { x: 131, y: 18.3, z: 82 } },
  { id: 'warehouse', name: '港口仓库', position: { x: 140, y: 17.68, z: 169 }, lookAt: { x: 155, y: 19, z: 182 } },
  { id: 'park', name: '海风公园', position: { x: 21, y: 17.68, z: 31 }, lookAt: { x: 15, y: 19, z: 15 } },
  { id: 'harbor', name: '渔港木屋街', position: { x: 16, y: 16.68, z: 232 }, lookAt: { x: 60, y: 17.5, z: 232 } },
  { id: 'bakery', name: '海盐面包房 · 室内', position: { x: 17.3, y: 17.68, z: 225.8 }, lookAt: { x: 19, y: 18.4, z: 220.4 } },
  { id: 'kitchen', name: '港口食堂 · 室内', position: { x: 17.3, y: 17.68, z: 239.3 }, lookAt: { x: 20, y: 18.4, z: 245.1 } },
  ...REGION_PLACES.map(place => ({ ...place, regional: true as const })),
] as const;

export type StreetPlaceId = typeof STREET_PLACES[number]['id'];
