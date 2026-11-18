import {floodChute,westernStrath} from './alpine.js';
const TREE_GRID = 8.05;
export const TREE_HEIGHT = { Fir0:17.6, Fir1:21.4, Birch0:15.1, Birch1:17.85 };
export const BARK_RADIUS = { Fir0:.36, Fir1:.36, Birch0:.2166, Birch1:.2565 };
export function random(x, z, seed) {
  let h = Math.imul(x, 73856093) ^ Math.imul(z, 19349663) ^ Math.imul(seed, 83492791);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}
export function inGrid(x, z, radius, step, visit, limit=1002) {
  for (let i = Math.floor((x-radius)/step); i <= (x+radius)/step; i++) {
    for (let j = Math.floor((z-radius)/step); j <= (z+radius)/step; j++) {
      const px = (i + random(i,j,103)) * step;
      const pz = (j + random(i,j,158)) * step;
      const dsq = (px-x)**2+(pz-z)**2;
      if (dsq <= radius*radius && Math.abs(px)<limit && Math.abs(pz)<limit) visit(i,j,px,pz,dsq);
    }
  }
}
const frameTrees = [
  // The birches pick out the right rim of the trail. The darker conifers behind them
  // interleave above the bend and set a cool horizon behind the nearest warm verge.
  [-11.4,-13.45,'Birch1',1.04],[2.48,-5.92,'Fir0',1.09],[-10.45,-11.05,'Fir1',1.12],
  [-.87,-7.12,'Birch1',.97],[.75,-5.42,'Birch0',.79],[-12.0,-14.8,'Birch0',.70],
  [-10.3,-14,'Birch0',1.04],[-8.8,-19.2,'Birch1',.84],[6.4,-10.2,'Birch1',.85],
  [-.72,-19.3,'Fir0',1.16],[-7.65,-22.4,'Fir1',1.07],[2.75,-25.3,'Birch1',1.04],
  [-8.1,-31.2,'Birch0',.94],[-.10,-31.6,'Fir1',1.21],[3.72,-35.3,'Fir0',.94],
  [-9.2,-27,'Fir0',1.12],[-4,-45.1,'Birch0',.85],[7.28,-47.5,'Fir1',1.00],
  [-6.7,-57.3,'Fir0',1.19],[2.78,-54.2,'Fir1',1.20],[5.4,-59.7,'Birch0',1.06],
  [14.1,-55.7,'Birch0',.96],[20.7,-50.8,'Birch1',1.11],[22.3,-60.3,'Fir0',1.03],
  [-8.8,-53,'Birch1',.94],[-13.8,-7.5,'Fir0',.44],[-13.8,-16.1,'Fir0',.48],
  [11.4,-7.8,'Fir0',.27],[-8.5,-32.4,'Fir0',.36],[-8.4,-77,'Fir1',1.03],[8.6,-81.3,'Birch0',.96],
  [-6.95,3.49,'Fir0',.93],
  // A staggered double row of mature firs and younger spruce fills the gaps
  // below the high crowns on the two slopes behind the grazing ledge.
  [-1.8,-55.1,'Fir0',.76],[4.2,-55.8,'Fir1',.73],[9.8,-54.3,'Fir0',.56],
  [12.1,-60.5,'Fir1',.96],[16.0,-54.7,'Fir0',.62],[13.8,-66.9,'Fir0',.76],
  [6.0,-63.5,'Fir0',.81],[4.35,-68.9,'Fir1',1.13],[-5.6,-66.4,'Fir0',.71],
  [26.9,-56.1,'Fir0',.77],[31.3,-61.5,'Fir1',.88],[24.4,-68.1,'Fir0',.68],
  [13.0,-26.7,'Fir0',.85],[10.2,-23.5,'Fir1',1.06],[26.47,-46.55,'Fir1',1.09],[1.1,-15.8,'Fir1',.78],[-3.2,-16.1,'Fir0',.58],
  [-2.2,-12.7,'Fir1',.44],
  [-9.1,-40.3,'Fir0',.67],[-12.9,-38.1,'Fir1',.98],[-11.2,-47.8,'Fir0',.83],
  [13.45,-46.20,'Birch0',.94],[15.82,-48.45,'Birch1',.66],[3.08,-46.5,'Fir0',.81],
  [8.9,-65.7,'Birch0',1.04],[-1.28,-12.8,'Birch0',.66],[-.74,-10.05,'Fir1',.60],
  [-19.8,-99.4,'Fir0',.42],
  [2.53,-82.45,'Birch0',.80],[4.91,-83.8,'Birch1',.88],
  [4.16,-85.53,'Fir0',.61],[-9.9,-83.5,'Fir0',.66],
];

// Hand-shaped anchors establish the framing at the trailhead and the meadow rim.
// The same deterministic biome population continues for the full 2 km walk.
function treeSite(i,j,x,z,land) {
  // The gravel scarp beside the ford drains too freely for a mature trunk.
  if(x>16.3&&x<19.2&&z> -38&&z< -34.5)return false;
  const along = Math.abs(x-land.trailX(z));
  if (along < 3.15 || land.isWater(x,z)) return false;
  if(z< -6 && z> -40 && Math.abs(x-.079*z)<1.05-z*.019) return false;
  if (Math.hypot(x-(land.streamX(-25)-8),z+25)<8.6) return false;
  if (z < -72 && z > -300 && Math.abs(x-land.trailX(-92)) < Math.min(97,11.8+(-72-z)*.60)) return false;
  const field = Math.sin(x*.068+Math.sin(z*.06))*.21+Math.cos(z*.042-x*.034)*.15;
  if (random(i,j,240) > .84+field) return false;
  if (Math.abs(x)<21 && z<8 && z>-92 && frameTrees.some(([tx,tz])=>(tx-x)**2+(tz-z)**2<9)) return false;
  return true;
}

const TAU=Math.PI*2;
const fineTile=TREE_GRID*16;
const drawTile=fineTile*3;
const key=(i,j)=>i*128+j;
const smooth=(a,b,x)=>{
  const t=Math.max(0,Math.min(1,(x-a)/(b-a)));
  return t*t*(3-2*t);
};

// The walking meshes, their trunk contacts and every distant crown query the
// same site. Fixed world cells also keep a travelling player's forest stable.
export function createTreeStands(land){
  const cells=new Map(),tiles=new Map(),byId=new Map(),removed=new Set();
  function insert(id,x,z,y,model,scale,angle,color){
    const site={id,x,z,y,model,scale,angle,color,radius:BARK_RADIUS[model]*scale};
    const i=Math.floor(x/fineTile),j=Math.floor(z/fineTile),cellKey=key(i,j);
    let sites=cells.get(cellKey);
    if(!sites){sites=[];cells.set(cellKey,sites);}
    sites.push(site);
    if(Math.max(Math.abs(x),Math.abs(z))<1210)byId.set(id,site);
    const a=Math.floor(i/3),b=Math.floor(j/3),tileKey=key(a,b);
    let tile=tiles.get(tileKey);
    if(!tile){tile={x:(a+.5)*drawTile,z:(b+.5)*drawTile,stands:new Map()};tiles.set(tileKey,tile);}
    if(!tile.stands.has(model))tile.stands.set(model,[]);
    tile.stands.get(model).push(site);
  }
  for(const [i,[x,z,model,scale]] of frameTrees.entries()){
    if(!land.isWater(x,z))insert('a'+i,x,z,land.height(x,z)-.035,model,scale,i*2.36,.84+.23*random(i,73,100));
  }
  for(let tx=-36;tx<36;tx++)for(let tz=-36;tz<36;tz++){
    const radius=Math.hypot(tx+.5,tz+.5)*fineTile;
    if(radius>4610)continue;
    const stride=radius>3000?4:radius>1610?2:1;
    for(let ix=0;ix<16;ix+=stride)for(let iz=0;iz<16;iz+=stride){
      const i=16*tx+ix,j=16*tz+iz;
      const x=(i+stride*random(i,j,103))*TREE_GRID,z=(j+stride*random(i,j,158))*TREE_GRID;
      if(radius>4420 && random(i,j,430)<smooth(4420,4560,Math.hypot(x,z)))continue;
      const bank=Math.abs(x-land.streamX(z))-land.streamWidth(z);
      if(bank<.3||!treeSite(i,j,x,z,land))continue;
      const inGrove=1-smooth(140,260,Math.max(Math.abs(x)*.89,-z,z*.90));
      const cover=land.forestCover(x,z);
      // The common age of a stand and irregular gaps around it are visible
      // both in the close boughs and in a two-pixel silhouette on the ridge.
      const heath=Math.max(0,cover-.12)/.88;
      const crowded=heath*heath*(3-2*heath);
      const density=.008+.975*crowded;
      if(random(i,j,709)>inGrove+(1-inGrove)*density)continue;
      const soil=land.treeGround(x,z);
      if(!Number.isFinite(soil))continue;
      const treeline=151+39*land.standNoise(x*.0037,z*.0037);
      if(soil>treeline||random(i,j,641)<smooth(treeline-37,treeline,soil))continue;
      const lee=land.standNoise(x*.015+14,z*.015-37);
      const altColor=land.standNoise(x*.006+21,z*.006-17);
      const birches=inGrove*(.38+.20*Math.sin(z*.12+x*.051))+(1-inGrove)*(.017+.19*smooth(.53,.82,altColor)*(1-smooth(33,145,bank)));
      const model=(random(i,j,7)<birches?'Birch':'Fir')+(random(i,j,6)<.51?'0':'1');
      const age=random(i,j,68),old=age<.17?.16+age*2.6:.70+random(i,j,73)*.62;
      const recruit=age<.20?.26+.92*age:.59+.49*random(i,j,73);
      const alpine=recruit*(.71+.46*lee)*(1-.54*smooth(66,treeline,soil));
      const scale=(alpine+(old-alpine)*inGrove)*(1-.56*floodChute(x,z))*(1-.62*westernStrath(x,z));
      const tint=.74+.31*altColor+.12*random(i,j,431);
      insert('t'+i+'/'+j,x,z,soil-.035,model,scale,random(i,j,23)*TAU,tint);
      if(inGrove>.05||stride>1||crowded<.53)continue;
      // Advance regeneration follows the canopy margin in short, unequal
      // runs. Its younger crowns share the ground, not the parent's height.
      const count=random(i,j,701)<.57*crowded?1+(random(i,j,822)>.66):0;
      for(let n=0;n<count;n++){
        const angle=(lee*2+.42*random(i,j,368+n))*TAU,r=2.7+3.7*random(i,j,474+n);
        const xx=x+Math.cos(angle)*r,zz=z+Math.sin(angle)*r;
        if(Math.abs(xx-land.streamX(zz))-land.streamWidth(zz)<2.5||Math.abs(xx-land.trailX(zz))<3.15)continue;
        const y=land.treeGround(xx,zz);
        if(Number.isFinite(y))insert('s'+i+'/'+j+'/'+n,xx,zz,y-.035,model,scale*(.29+.50*random(i,j,976+n)),angle+.6,tint*.94);
      }
    }
  }
  // The secondary young copses beside the original woodland trail.
  for(let i=-14;i<=13;i++)for(let j=-6;j<=85;j++){
    const x=(i+random(i,j,103))*13.1,z=(j+random(i,j,158))*13.1;
    if(z< -69||Math.abs(x)>163||!treeSite(i+91,j-43,x,z,land))continue;
    for(let k=0;k<2+Math.floor(random(i,j,729)*2);k++){
      const angle=random(i+k,j,663)*TAU,span=.85+random(i,j+k,449)*2.7;
      const xx=x+Math.cos(angle)*span,zz=z+Math.sin(angle)*span;
      if(!treeSite(i+91,j-43,xx,zz,land))continue;
      const model=(random(i+k,j,995)>.35?'Fir':'Birch')+(k%2);
      const scale=k===0?.67+random(i,j,701)*.37:.16+random(j+k,i,710)*.45;
      insert('c'+i+'/'+j+'/'+k,xx,zz,land.height(xx,zz)-.035,model,scale,angle,1);
    }
  }
  return {tiles,drawTile,around(x,z,radius,visit){
    for(let i=Math.floor((x-radius)/fineTile);i<=Math.floor((x+radius)/fineTile);i++){
      for(let j=Math.floor((z-radius)/fineTile);j<=Math.floor((z+radius)/fineTile);j++){
        const sites=cells.get(key(i,j));
        if(!sites)continue;
        for(const site of sites){
          const d=(site.x-x)**2+(site.z-z)**2;
          if(d<=radius*radius&&!removed.has(site.id))visit(site,d);
        }
      }
    }
  },remove(id){
    const site=byId.get(id);
    if(!site||removed.has(id))return;
    removed.add(id);
    site.removed=true;
    this.onCanopyRemoval?.(site);
  }};
}
