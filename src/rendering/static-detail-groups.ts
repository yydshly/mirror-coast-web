import type {Matrix4} from 'three';

/** Small groups stay batched; large static sets acquire useful culling bounds. */
export function staticDetailGroups<T>(details:readonly T[],matrix:(detail:T)=>Matrix4):T[][]{
 if(details.length<128)return details.length?[Array.from(details)]:[];
 const sectors=new Map<string,T[]>();for(const detail of details){const e=matrix(detail).elements,key=`${Math.floor(e[12]/64)},${Math.floor(e[14]/64)}`,bucket=sectors.get(key);if(bucket)bucket.push(detail);else sectors.set(key,[detail]);}
 return [...sectors.values()];
}
