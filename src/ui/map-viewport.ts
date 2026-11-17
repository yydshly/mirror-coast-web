export const MINIMAP_ZOOMS=[1,1.5,2,3,4]as const;
export function minimapViewport(x:number,y:number,zoom:number):string{
 const scale=Number.isFinite(zoom)?Math.max(1,Math.min(4,zoom)):1,w=1024/scale,h=768/scale;
 const left=Math.max(0,Math.min(1024-w,x-w/2)),top=Math.max(0,Math.min(768-h,y-h/2));
 return`${left} ${top} ${w} ${h}`;
}
