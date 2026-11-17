import {describe,it,expect} from 'vitest';
import {ShadowCadence} from '../src/rendering/shadow-cadence';
describe('bounded city shadow refresh',()=>{
 it('retains a ready shadow on intervening frames and refreshes moving actors within 34ms',()=>{
  const s=new ShadowCadence();expect(s.update(0)).toBe(true);
  expect(s.update(1/60)).toBe(false);expect(s.update(1/60)).toBe(true);
  s.invalidate();expect(s.update(0)).toBe(true);expect(s.update(.05)).toBe(false);expect(s.update(.05)).toBe(true);
 });
 it('still avoids a full city redraw on every frame when the browser is below 30 FPS',()=>{
  const s=new ShadowCadence();const updates=Array.from({length:20},()=>s.update(.05));expect(updates.filter(Boolean)).toHaveLength(10);s.invalidate();expect(s.update(0)).toBe(true);
 });
});
