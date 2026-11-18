import {MathUtils} from 'three';
import {inGrid,random} from './tree-stands.js';
import {trailMargin} from './trail-stones.js';
const TAU=2*Math.PI,SHADE_GRID=2.5;

// Crown shadows share the world seed. Cache the soft projected canopy at ground
// resolution, then sample it for grass, fern and petal colors as the grid streams.
export function shadowField(px,pz,size=65) {
  const half=(size-1)*.5;
  const x0=(Math.floor(px/SHADE_GRID)-half)*SHADE_GRID;
  const z0=(Math.floor(pz/SHADE_GRID)-half)*SHADE_GRID;
  const values=new Float32Array(size*size);
  return {
    add(x,z,height,type) {
      const sx=x+height*.44,sz=z+height*.23;
      const radius=height*(type==='fir'?.27:.25)+.45;
      const ix=Math.round((sx-x0)/SHADE_GRID),iz=Math.round((sz-z0)/SHADE_GRID);
      const cells=Math.ceil(radius*1.9/SHADE_GRID);
      for(let i=Math.max(0,ix-cells);i<=Math.min(size-1,ix+cells);i++) {
        for(let j=Math.max(0,iz-cells);j<=Math.min(size-1,iz+cells);j++) {
          const dx=x0+i*SHADE_GRID-sx,dz=z0+j*SHADE_GRID-sz;
          const along=(dx*.89+dz*.45)/(radius*1.7),across=(-dx*.45+dz*.89)/radius;
          const cover=Math.max(0,1-along*along-across*across);
          values[j*size+i]+=cover*.81;
        }
      }
    },
    at(x,z) {
      const u=MathUtils.clamp((x-x0)/SHADE_GRID,0,size-1.001),v=MathUtils.clamp((z-z0)/SHADE_GRID,0,size-1.001);
      const i=Math.floor(u),j=Math.floor(v),f=u-i,g=v-j,n=j*size+i;
      return Math.min(1,(values[n]*(1-f)+values[n+1]*f)*(1-g)+(values[n+size]*(1-f)+values[n+size+1]*f)*g);
    },
  };
}

export function visitFerns(land,openGround,shade,px,pz,radius,emit){
  inGrid(px,pz,radius,3.1,(i,j,x,z)=>{
    if(Math.abs(x-land.trailX(z))<1.9*trailMargin(z,x-land.trailX(z)) || !openGround(x,z))return;
    const wet=Math.abs(x-land.streamX(z))<5.3;
    if((wet || shade.at(x,z)>.47) && random(i,j,190)<(wet?.73:.38)) {
      const s=.62+random(i,j,137)*.82;
      emit(x,z,random(i,j,157)*TAU,s);
    }
  });
}
