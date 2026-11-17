export const BAY_NOTES=['kite','pool','vista'] as const;
export type BayNote=typeof BAY_NOTES[number];
export type BayState={notes:BayNote[];kiteFlying:boolean};
export const BAY_BEACH_WALK=[{x:628,z:164},{x:640,z:158},{x:657.5,z:150},{x:674,z:155},{x:690,z:163},{x:694,z:164},{x:698,z:163.8},{x:698,z:166.2},{x:701,z:165.5}] as const;
export const BAY_STOPS=[
 {id:'bay-camp',name:'南湾风帆营地',shortName:'风帆',position:{x:628,z:162},approach:{x:628,z:143},trail:[{x:628,z:143},{x:628,z:150},{x:628,z:162}],description:'沙丘背后是一顶随风起伏的帆布遮棚。到线轴旁放飞风筝，也可以把它收回来。',access:'停车后步行到遮棚，靠近木线轴按 E 放飞或收回风筝。'},
 {id:'bay-pools',name:'南湾岩岸 · 潮池',shortName:'潮池',position:{x:694,z:164},approach:{x:680,z:133},trail:[{x:680,z:133},{x:686,z:146},{x:694,z:164}],description:'避风岩窝里留着一小汪潮水。停下脚步，看看沙蟹怎样退回石缝；傍晚潮池会泛起微光。',access:'沿沙地步行到岩窝旁，按 E 静看潮池。不要向深水中走。'},
 {id:'bay-overlook',name:'海蚀门 · 看海长椅',shortName:'海蚀门',position:{x:701,z:165.5},approach:{x:680,z:133},trail:[{x:680,z:133},{x:690,z:151},{x:698,z:163.8},{x:698,z:166.2},{x:701,z:165.5}],description:'两座海蚀岩柱托起一道天然石门。坐在岩岸长椅上，回望搁浅救援船和整片南湾。',access:'绕到长椅前按 E 坐下，拖动环视。海岸手记会留下这段眺望。'},
] as const;
export function validateBay(value:unknown):BayState{const v=value as BayState;if(!v||!Array.isArray(v.notes)||v.notes.length>3||v.notes.some(n=>!BAY_NOTES.includes(n))||new Set(v.notes).size!==v.notes.length||typeof v.kiteFlying!=='boolean')throw new Error('南湾探索存档无效。');return{notes:[...v.notes],kiteFlying:v.kiteFlying};}
