import {describe,expect,it} from 'vitest';
import {makeBeaconBeam,makeBeaconGlow} from '../src/exploration/beacon-light';

describe('soft coastal navigation light',()=>{
  it('tapers from a small lens and fades to zero at every boundary instead of drawing a rectangular panel',()=>{
    const {geometry,material,texture}=makeBeaconBeam();
    const position=geometry.getAttribute('position');
    expect(Math.abs(position.getY(2))).toBeGreaterThan(Math.abs(position.getY(0))*10);
    const {width,height}=texture.image,data=texture.image.data!;
    const intensity=(x:number,y:number)=>data[(y*width+x)*4+1];
    for(let x=0;x<width;x++){expect(intensity(x,0)).toBe(0);expect(intensity(x,height-1)).toBe(0);}
    for(let y=0;y<height;y++){expect(intensity(0,y)).toBe(0);expect(intensity(width-1,y)).toBe(0);}
    expect(intensity(16,Math.floor(height/2))).toBeGreaterThan(intensity(100,Math.floor(height/2))*5);
    expect(material.depthWrite).toBe(false);
    geometry.dispose();material.dispose();texture.dispose();
  });
  it('gives the lamp a small bright core and a transparent halo edge without a point light',()=>{
    const {texture,material}=makeBeaconGlow();const {width,height}=texture.image,data=texture.image.data!;
    expect(data[(Math.floor(height/2)*width+Math.floor(width/2))*4+3]).toBeGreaterThan(245);
    expect(data[3]).toBe(0);expect(material.depthWrite).toBe(false);
    material.dispose();texture.dispose();
  });
});
