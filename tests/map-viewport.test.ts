import {describe,it,expect} from 'vitest';
import {minimapViewport} from '../src/ui/map-viewport';
import {journeyURL,validJourneySlot,journeyLabel} from '../src/persistence/journeys';

describe('map controls and journey links',()=>{
 it('zooms around the player and clamps coastal and regional edges without moving the full map',()=>{
  expect(minimapViewport(512,384,1)).toBe('0 0 1024 768');expect(minimapViewport(512,384,2)).toBe('256 192 512 384');
  expect(minimapViewport(0,0,4)).toBe('0 0 256 192');expect(minimapViewport(1024,768,4)).toBe('768 576 256 192');
  expect(minimapViewport(512,384,NaN)).toBe('0 0 1024 768');
 });
 it('changes only the selected journey, preserving scene and origin when returning to the original',()=>{
  const href='http://localhost:5174/?scene=collision-audit#view';expect(journeyURL(href,'trip-test')).toBe('http://localhost:5174/?scene=collision-audit&journey=trip-test');
  expect(journeyURL(journeyURL(href,'trip-test'))).toBe('http://localhost:5174/?scene=collision-audit');expect(validJourneySlot('../old')).toBeUndefined();expect(journeyLabel(null)).toBe('原旅程');
 });
});
