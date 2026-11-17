import {
  AdditiveBlending,BufferGeometry,DataTexture,DoubleSide,Float32BufferAttribute,
  LinearFilter,MeshBasicMaterial,RGBAFormat,SpriteMaterial,
} from 'three';

const smooth=(a:number,b:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};

/** A tapered light sheet with no hard side or far edge; three sheets form a volume. */
export function makeBeaconBeam(){
  const width=128,height=64,data=new Uint8Array(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const u=x/(width-1),v=y/(height-1),side=Math.pow(Math.max(0,1-Math.abs(v*2-1)),2.4);
    const along=smooth(0,.025,u)*Math.pow(1-u,1.7)*(1-smooth(.78,1,u));
    const value=Math.round(255*side*along),offset=(y*width+x)*4;
    data[offset]=data[offset+1]=data[offset+2]=value;data[offset+3]=255;
  }
  const texture=new DataTexture(data,width,height,RGBAFormat);texture.minFilter=texture.magFilter=LinearFilter;texture.needsUpdate=true;
  const geometry=new BufferGeometry();
  geometry.setAttribute('position',new Float32BufferAttribute([.20,-.10,0,.20,.10,0,24,-2.8,0,24,2.8,0],3));
  geometry.setAttribute('uv',new Float32BufferAttribute([0,0,0,1,1,0,1,1],2));geometry.setIndex([0,2,1,2,3,1]);geometry.computeVertexNormals();
  const material=new MeshBasicMaterial({color:'#f4cf82',alphaMap:texture,side:DoubleSide,transparent:true,opacity:.08,depthWrite:false,blending:AdditiveBlending,toneMapped:false});
  return {geometry,material,texture};
}

export function makeBeaconGlow(){
  const size=48,data=new Uint8Array(size*size*4);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const r=Math.hypot((x/(size-1)-.5)*2,(y/(size-1)-.5)*2),offset=(y*size+x)*4;
    data[offset]=data[offset+1]=data[offset+2]=255;
    data[offset+3]=Math.round(255*Math.exp(-r*r*6)*(1-smooth(.72,1,r)));
  }
  const texture=new DataTexture(data,size,size,RGBAFormat);texture.minFilter=texture.magFilter=LinearFilter;texture.needsUpdate=true;
  const material=new SpriteMaterial({map:texture,color:'#ffdd9c',transparent:true,opacity:.65,depthWrite:false,blending:AdditiveBlending,toneMapped:false});
  return {texture,material};
}
