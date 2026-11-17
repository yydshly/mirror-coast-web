export const validJourneySlot=(slot:string|null):string|undefined=>slot&&/^[a-zA-Z0-9_-]{1,64}$/.test(slot)?slot:undefined;
export function journeyURL(href:string,slot?:string):string{const url=new URL(href);if(slot)url.searchParams.set('journey',slot);else url.searchParams.delete('journey');url.hash='';return url.href;}
export function journeyLabel(slot:string|null|undefined):string{
 if(!slot)return'原旅程';
 const stamp=parseInt(slot.split('-')[1]??'',36),date=new Date(stamp);
 return slot.startsWith('trip-')&&Number.isFinite(date.getTime())?`新旅程 · ${date.toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}`:'独立旅程';
}
