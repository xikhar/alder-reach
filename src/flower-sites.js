import {MathUtils} from 'three';
import {inGrid,random} from './tree-stands.js';
import {trailMargin} from './trail-stones.js';
import {plantMeadowFlowers,meadowGrassOpening} from './meadow-flowers.js';

const TAU=2*Math.PI;
export function crestMeadow(x,z){
  const width=16+Math.max(0,-83-z)*.51;
  return z< -72 && z> -152 && Math.abs(x+2.4)<width;
}

// The renderer visits a circle around the player. The optical-area bake visits
// the same population across the walkable watershed, including its planted banks.
export function createFlowerSites(land){
  function fordGap(x,z){
    if(x<6||x>21)return 0;
    const margin=land.fordMargin(x);
    return .98*(1-MathUtils.smoothstep(Math.abs(z-land.fordTrailZ(x)),.54*margin,1.02*margin));
  }
  function openGround(x,z) {
    if (land.isWater(x,z)) return false;
    return Math.hypot(x-(land.streamX(-25)-8),z+25)>2.95;
  }
  function visit(px,pz,radius,emitFlower,groundTint){
    function flowerPatch(i,j,x,z,band,species) {
      if (!openGround(x,z)||random(i,j,208)<.93*land.talusCover(x,z))return;
      const a=Math.abs(x-land.trailX(z));
      if (a<1.33*trailMargin(z,x-land.trailX(z)) || (!band && random(i,j,29)>(z< -72?.13:.36))) return;
      const patch=random(Math.floor(x/5),Math.floor(z/7),722);
      const crest=crestMeadow(x,z);
      const rightVerge=z> -10.8 && z<1 && x>land.trailX(z)+1 && x<land.trailX(z)+7;
      const type=species??(rightVerge?'Yarrow':crest?(patch<.93?'Yarrow':'Lupine'):patch<.40?'Lupine':patch<.68?'Paintbrush':'Yarrow');
      if(crest && type==='Paintbrush')return;
      const count=crest?2:type==='Bluebell'?2:band?4:2;
      for(let n=0;n<count;n++) {
        const xx=x+(random(i,j,722+n)-.5)*1.28,zz=z+(random(j,i,502+n)-.5)*1.28;
        if (meadowGrassOpening(xx,zz)||fordGap(xx,zz)>random(i,j,194+n)||Math.abs(xx-land.trailX(zz))<1.32*trailMargin(zz,xx-land.trailX(zz)) || !openGround(xx,zz)) continue;
        const s=(crest?.69:type==='Bluebell'?1.04:.87)+(crest?.29:.53)*random(i,j,523+n);
        emitFlower(type,xx,land.height(xx,zz)-.012,zz,random(i,j,213+n)*TAU,s,groundTint(xx,zz,true));
      }
    }
    // White flat-topped yarrow, vermilion paintbrush and periwinkle rosettes
    // form distinct drifts along the sunny bank and the meadow rim.
    // Rosettes occupy the moist, well-lit strip above the gravel. Their
    // individual crowns stay distinct at the edges of each colony.
    for(let row=0;row<5;row++){
      const inland=.49+row*.40;
      for(let cell=0;cell<36;cell++){
        const z=-52+cell*.62+row*.17+(random(cell,row,319)-.5)*.23;
        const bank=land.streamX(z)-land.streamWidth(z);
        const x=bank-inland-(random(cell,row,912)-.5)*.27;
        const range=Math.hypot(x-px,z-pz);
        if(range>radius || !openGround(x,z)||fordGap(x,z)>random(row,cell,152))continue;
        const center=(z+38.96)/(3.28-row*.22);
        const middle=1-center*center;
        const outer=1-((z+44.6)/1.95)**2;
        const left=1-((z+31.4)/1.12)**2;
        const shoulder=row>1?1-((z+42.9)/1.38)**2:0;
        const colony=Math.max(middle,outer*.67,shoulder*.57,left*.55);
        if(colony<=.02 || random(row,cell,823)>.42+.54*colony)continue;
        const size=.77+.25*random(row,cell,898)+.48*Math.max(0,middle)*(.45+row*.18);
        const crown=random(row,cell,425)<(row<2?.39:.19)?'BluebellLeaf':'Bluebell';
        const heading=random(row,cell,631)*TAU;
        const dx=land.height(x+.27,z)-land.height(x-.27,z);
        const dz=land.height(x,z+.27)-land.height(x,z-.27);
        const tilt=Math.min(.74,.70/Math.max(.01,Math.hypot(dx,dz)));
        const localX=(-dx*Math.cos(heading)+dz*Math.sin(heading))*tilt;
        const localZ=(-dz*Math.cos(heading)-dx*Math.sin(heading))*tilt;
        const tiltX=Math.atan(localZ),tiltZ=-Math.atan2(localX,Math.hypot(1,localZ));
        emitFlower(crown,x,land.height(x,z)+.014,z,heading,size,groundTint(x,z,true),tiltX,tiltZ);
      }
    }
    for(let z=-52;z<-30;z+=3.65){
      const bank=land.streamX(z)-land.streamWidth(z);
      if((bank-px)**2+(z-pz)**2<radius**2)flowerPatch(Math.round(z*10),229,bank-3.,z,true,'Lupine');
    }
    for(let j=-38;j<=-12;j+=2){
      const type=j%6===0?'Yarrow':j%6===-2?'Lupine':'Bluebell';
      const x=land.streamX(j)+(land.streamWidth?.(j)??2.4)+.67+random(j,2,29)*.94;
      if((x-px)**2+(j-pz)**2<radius**2){
        flowerPatch(907,j,x,j,true,type);
        flowerPatch(777,j,x+1.25,j+.65,true,j%4===0?'Bluebell':'Paintbrush');
      }
    }
    for(const [x,z,type] of [[.48,-3.76,'Yarrow'],[-.32,-5.22,'Yarrow'],[2.18,-3.16,'Yarrow'],[-3.7,-89.4,'Yarrow'],[1.35,-92.2,'Yarrow'],[-7.1,-94.7,'Yarrow'],[-1.47,-10.2,'Paintbrush'],[-2.72,-10.52,'Paintbrush'],[-4.9,-5.0,'Lupine'],[-6.85,-8.2,'Lupine'],[-8.45,-12.4,'Lupine'],[-8.9,-12.8,'Paintbrush']]){
      if((x-px)**2+(z-pz)**2<radius**2)flowerPatch(Math.round(x*10),Math.round(z*10),x,z,true,type);
    }
    for(const [x,z,s] of [[-5.24,-87.78,.86],[-5.06,-87.69,.71],[-4.86,-87.82,.73],
        [-4.15,-88.68,.73],[-4.4,-88.75,.77],[-2.91,-87.89,.80],[-2.73,-87.74,.72],
        [-1.78,-87.31,.75],[-1.92,-87.44,.64],[-.57,-88.57,.82],[-.79,-88.42,.77],[.50,-88.64,.72]]){
      if(Math.hypot(x-px,z-pz)<=radius)emitFlower('Yarrow',x,land.height(x,z)-.013,z,x*3.87,s,groundTint(x,z,true));
    }
    plantMeadowFlowers(px,pz,land,openGround,emitFlower,groundTint,radius);
    for(const [z,side,type] of [[-4,-1,'Yarrow'],[-5.7,1,'Paintbrush'],[-8.2,-1,'Yarrow'],[-11,1,'Bluebell'],[-71,-1,'Yarrow'],[-77,-1,'Yarrow'],[-81,-1,'Yarrow']]){
      const x=land.trailX(z)+side*1.96;
      if((x-px)**2+(z-pz)**2<radius**2)flowerPatch(701,Math.floor(z),x,z,true,type);
    }
    inGrid(px,pz,radius,4.7,(i,j,x,z)=>flowerPatch(i,j,x,z,false));
    // At the meadow rim the trail disappears under drifts of yarrow and lupine.
    if (pz-radius< -71 && pz+radius> -111) inGrid(px,pz,radius,2.95,(i,j,x,z)=>{
      if(z<-71 && z>-111 && random(i,j,910)>.85) flowerPatch(i,j,x,z,true,'Yarrow');
    });
    for (let j=Math.floor((pz-radius)/2.6);j<=(pz+radius)/2.6;j++) {
      for (const side of [-1,1]) {
        const z=(j+random(j,side,63))*2.6;
        if(z< -71 && z> -119 && random(j,side,801)>.12)continue;
        const x=land.trailX(z)+side*(1.72+random(j,side,94)*1.56);
        if ((x-px)**2+(z-pz)**2<radius**2) flowerPatch(side,j,x,z,true);
      }
    }
  }
  return {visit,openGround,fordGap};
}
