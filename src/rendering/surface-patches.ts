/** Split a surface dressing along voxel boundaries. Each patch belongs to the
 * ground directly under it, so a crater cannot leave a stripe across thin air. */
export function surfacePatches(x:number,z:number,width:number,depth:number){
 const patches:Array<{x:number;z:number;width:number;depth:number;anchorX:number;anchorZ:number}>=[];
 const minX=x-width/2,maxX=x+width/2,minZ=z-depth/2,maxZ=z+depth/2;
 for(let iz=Math.floor(minZ);iz<Math.ceil(maxZ);iz++)for(let ix=Math.floor(minX);ix<Math.ceil(maxX);ix++){
  const a=Math.max(minX,ix),b=Math.min(maxX,ix+1),c=Math.max(minZ,iz),d=Math.min(maxZ,iz+1);
  if(b-a<1e-6||d-c<1e-6)continue;
  patches.push({x:(a+b)/2,z:(c+d)/2,width:b-a,depth:d-c,anchorX:ix,anchorZ:iz});
 }return patches;
}
