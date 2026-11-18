import {addForestLOD} from './canopy-lod.js';
import {earthGLSL,loadEarth} from './earth.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createTreeStands} from './tree-stands.js';
export {nativeRockLevel} from './rock-lod.js';
import {talusCover} from './talus.js';
export {talusCover};
import {createFlowerField,flowerFieldGLSL} from './flower-field.js';
import {createGrassField,grassSurfaceGLSL} from './groundcover.js';
export {nativeGrassHabitat,nativeGroundStature} from './groundcover.js';
import * as THREE from 'three';
import {buildBrook,ripple,sampleWaterSurface} from './brook.js';
import {floodChute,westernStrath,innerTerrace,terraceRelief,terraceWoodland,terracePigment} from './alpine.js';
import {alpineAirGLSL} from './alpine-atmosphere.js';
import {addTrailStones,trailMargin} from './trail-stones.js';
import {fordTrailZ,fordMargin,fordPathGLSL} from './ford-path.js';
export {fordTrailZ,fordMargin};
export {trailMargin};
import {addShingle} from './shingle.js';
import {createClouds,cloudGLSL} from './clouds.js';
export {ripple};

const TAU = Math.PI * 2;
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const mix = (a, b, t) => a + (b - a) * t;
const gaussian = value => Math.exp(-value*value);
function smooth(a,b,v) {
  const t = clamp((v-a)/(b-a));
  return t*t*(3-2*t);
}
function hash(x,z) {
  let h = Math.imul(x, 374761393) + Math.imul(z, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise(x,z) {
  const i=Math.floor(x), j=Math.floor(z);
  const u=smooth(0,1,x-i), v=smooth(0,1,z-j);
  return mix(mix(hash(i,j),hash(i+1,j),u),mix(hash(i,j+1),hash(i+1,j+1),u),v);
}
function fbm(x,z) {
  return noise(x,z)*.55 + noise(2.05*x+16, 2.05*z+12)*.3 + noise(4.2*x-3,4.2*z+8)*.15;
}
function rng(seed) {
  return () => {seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed / 4294967296;};
}

export function trailX(z) {
  const bend=8.1*Math.exp(-((z+20.4)**2)/54)+.68*Math.exp(-((z+2.55)**2)/2.24)*(1-smooth(-1,0,z));
  return 3.7*Math.sin(z*.077)+2.15*Math.sin(z*.018)+.8*Math.sin(z*.16)-bend;
}
// Chain of broad glacial meanders, from the tributary headwater to the distant valley.
const meanders=[[90,20],[143,82],[227,182],[312,260],[425,260],[525,136],
  [640,-172],[713,-206],[812,-89],[946,233],[1015,321],[1090,254],[1235,93],
  [1315,77],[1465,188],[1650,411],[1765,423],[1900,184],[2040,-114],[2200,-437],[2310,-507],[2430,-351],[2540,-37],[2640,102],[2770,32],[3060,-184],[3550,32]];
function riverCourse(d) {
  if(d<meanders[0][0])return meanders[0][1];
  let i=1;
  while(i<meanders.length-1 && d>meanders[i][0])i++;
  const left=meanders[i-1],right=meanders[i],delta=right[0]-left[0];
  const t=clamp((d-left[0])/delta),t2=t*t,t3=t2*t;
  const before=meanders[Math.max(0,i-2)],after=meanders[Math.min(meanders.length-1,i+1)];
  const m0=(right[1]-before[1])/(right[0]-before[0])*delta;
  const m1=(after[1]-left[1])/(after[0]-left[0])*delta;
  return (2*t3-3*t2+1)*left[1]+(t3-2*t2+t)*m0+(-2*t3+3*t2)*right[1]+(t3-t2)*m1;
}
// The east bank opens into a scour pool beside the ford while its west gravel point stays fixed.
function fordPoolOffset(z) {
  if(z<=-51 || z>=-32)return 0;
  return .54*Math.exp(-((z+40.1)**2)/16)*smooth(-51,-48,z)*(1-smooth(-36,-32,z));
}
function courseX(z) {
  const u=-z-25,near=15+6.2*Math.sin(u*.038)+3.9*Math.sin(u*.09);
  // The ford wraps around a gravel point, then opens into the next pool upstream.
  const ford=2.85*Math.exp(-((z+32.9)**2)/18)-1.30*Math.exp(-((z+43.3)**2)/9);
  return mix(near+ford+fordPoolOffset(z),riverCourse(-z),smooth(86,153,-z));
}
function courseWidth(z) {
  const w=2.15+.45*Math.sin(z*.086)+.22*Math.sin(z*.18);
  if(z>=-105)return w+fordPoolOffset(z);
  const base=w+smooth(125,580,-z)*9.6+smooth(620,1130,-z)*9.1+smooth(1150,2100,-z)*3.1+smooth(1800,2670,-z)*13.;
  const slope=riverCourse(-z+.5)-riverCourse(-z-.5);
  // The western reach spreads across a gravel outwash fan before turning
  // back between the older foothills. Width is perpendicular to the channel.
  const outwash=36*smooth(2050,2220,-z)*(1-smooth(2410,2580,-z));
  return (base+outwash)*mix(1,Math.min(2.55,Math.hypot(1,slope)),smooth(125,255,-z));
}
function channelSample(z,field,fallback) {
  if(!surface)return fallback(z);
  const rows=surface.rows,n=rows.length;
  if(z<=rows[0] || z>=rows[n-1])return fallback(z);
  let lo=0,hi=n-1;
  while(hi-lo>1){const mid=(lo+hi)>>1;if(z<rows[mid])hi=mid;else lo=mid;}
  return mix(surface[field][lo],surface[field][hi],(z-rows[lo])/(rows[hi]-rows[lo]));
}
export function streamX(z){return channelSample(z,'centers',courseX);}
export function streamWidth(z){return channelSample(z,'widths',courseWidth);}
function plateau(z) {
  return 3.8*smooth(16,76,-z) - 85*(1-Math.exp(-Math.pow(Math.max(0,-z-88)/108,1.15))) - 13*smooth(330,1200,-z) + z*.001;
}
function levelAt(z) {
  return plateau(z) - 1.2 + .22*Math.sin(z*.028);
}
export function waterY(x,z){return channelSample(z,'levels',levelAt);}
export function waterSurfaceY(x,z){return sampleWaterSurface(x,z)??waterY(x,z)+.012;}
function localFloor(x,z) {
  const close = 1-smooth(75,190,Math.max(Math.abs(x)*1.45,Math.abs(z+30)*.8));
  const undulations = ((fbm(x*.052,z*.052)-.48)*1.35 + (fbm(x*.011+9,z*.011)-.42)*5.5)*close
                    + (fbm(x*.0037,z*.0037)-.49)*18*(1-close);
  const valleyAxis=mix(25*Math.sin(z*.004),streamX(z)*.50,smooth(710,1060,-z));
  const floorEdge=Math.max(0,Math.abs(x-valleyAxis)-195-187*smooth(670,1020,-z));
  const valleyRise=smooth(110,360,-z)*Math.pow(clamp(floorEdge/595),1.36)*(58+fbm(x*.004,z*.004)*136);
  const floodplain=smooth(205,450,-z)*(1-smooth(170,365,Math.abs(x)));
  // Low spurs extend like fingers into the basin, exposing successively more distant woodland.
  const down=-z;
  const wall=(1-Math.exp(-((x-10)**2)/49000));
  const lateral=fbm(x*.0035+11,z*.0036+37);
  const spur1=16*Math.exp(-((down-225-20*Math.sin(x*.013))**2)/5500)*(.38+.62*wall);
  const spur2=24*Math.exp(-((down-475+54*Math.sin(x*.007))**2)/18200)*(.32+.68*wall);
  const spur3=26*Math.exp(-((down-860-82*Math.cos(x*.004+1.2))**2)/42500)*wall*(1-.92*Math.exp(-(((x-176)/152)**2)));
  const bank=Math.abs(x-streamX(z))-streamWidth(z);
  const moraine=(6+25*smooth(129,239,x))*Math.exp(-(((down-310-19*Math.sin(x*.008))/78)**2+((x-126)/175)**2));
  const landform=(spur1+spur2+spur3+moraine)*(0.73+.62*lateral)*smooth(16,91,bank)+terraceRelief(x,z,bank);
  const ripple=.52*Math.sin(x*.22+z*.084)*smooth(64,77,down)*(1-smooth(83,115,down));
  // A folded pocket of woodland encloses the trail and the far bank behind the grazing herd.
  const crestZ=-55.9+3.35*Math.sin(x*.081);
  const meadowHollow=1-.63*Math.exp(-(((x-8.3)/13.7)**2));
  const northWall=4.30*meadowHollow*Math.exp(-(((z-crestZ)/8.8)**2+((x+1.2)/22.)**2));
  const westWall=5.45*Math.exp(-(((x+19.-2.*Math.sin(z*.11))/8.9)**2+((z+38.5)/18.)**2));
  const meanderTerrace=smooth(570,770,down)*(1-smooth(33,164,bank));
  // Soil bank beside the opening. The trail follows its toe around the birches.
  const trailBank=1.20*Math.exp(-((x+8.6)**2)/24-((z+7.7)**2)/45)*smooth(.7,3.6,trailX(z)-x);
  const rimOffset=(z+93.6-.063*x-1.10*Math.sin(x*.11))/4.7;
  const meadowBench=smooth(89,100,down)*(1-smooth(111,137,down))*gaussian(((x+4)/20)**2);
  const benchHeight=1.08-.32*(down-95)+.39*Math.sin(x*.075+z*.052);
  const meadowRim=.38*Math.exp(-rimOffset*rimOffset-(x/43)**2)+meadowBench*Math.max(0,benchHeight-plateau(z));
  const upland=plateau(z)+(undulations*(1-floodplain*.73)+valleyRise+landform)*(1-.98*meanderTerrace)+ripple+northWall+westWall+trailBank+meadowRim-25*innerTerrace(x,z)-12*floodChute(x,z);
  const strath=westernStrath(x,z);
  return mix(upland,Math.min(upland,plateau(z)+1.8+2.6*lateral),strath);
}
function sampledHeight(x,z) {
  const bed = waterY(x,z), dx=Math.abs(x-streamX(z)), w=streamWidth(z);
  const floor = Math.max(localFloor(x,z),bed+.38);
  const s = dx/w;
  const bar=(.10+.15*fbm(z*.13+7,x*.09))*smooth(.48,.91,s)*(1-smooth(.96,1.5,s));
  const cut = bed-.92 + .92*smooth(.10,1,s) + .36*(s-1)+bar;
  const ground=mix(cut, floor, smooth(1,1 + 3/w, s));
  if(z< -50||z> -24||x<6||x>32)return ground;
  const bank=streamX(z)-x-w;
  // Alluvial bench above the low gravel shelf. Its brow shelters the lower meadow.
  const meadow=(1-smooth(2.8,7.7,Math.abs(z+33.)))*(1-smooth(5.,11.,bank));
  const shelf=2.72-.040*(z+33.)+.12*Math.sin(x*.52+z*.24);
  const brow=1.64*smooth(14.8,16.3,x)*Math.exp(-((z+39.45)**2)/8.6-((x-16.28)**2)/2.65);
  const bankRise=Math.max(0,shelf-ground)*meadow*smooth(.25,2.6,bank)+brow*smooth(.65,2.6,bank);
  const eastRise=.17*Math.exp(-((z+39.)**2)/16-((x-25.8)**2)/4.9)*smooth(0.,1.6,-bank-2*w);
  const crest=ground+bankRise+eastRise;
  const track=(1-smooth(.64,1.85,Math.abs(z-fordTrailZ(x))))*smooth(12.4,15.8,x)*smooth(-.2,.72,bank);
  const trackGrade=bed+.22+Math.max(0,bank)*.48;
  const footpath=mix(crest,Math.min(crest,trackGrade),track);
  // A submerged cobble sill continues the walking grade into the water.
  const fordCrossing=(1-smooth(.72,2.1,Math.abs(z-fordTrailZ(x))))*(1-smooth(.5,1.1,bank));
  const sill=bed-.52+.44*smooth(.2,.9,s);
  return mix(footpath,Math.max(footpath,sill),fordCrossing);
}
// Terrain collision uses the same pair of triangles submitted for every grid cell.
let surface=null;
let rangeSurfaces=[];
export function exposedHeight(x,z){
  let y=height(x,z);
  for(const range of rangeSurfaces)y=Math.max(y,range(x,z));
  return y;
}
export function height(x,z) {
  if(!surface)return sampledHeight(x,z);
  const {rows,positions,columns}=surface;
  let lo=0,hi=rows.length-1;
  if(z<rows[lo] || z>rows[hi])return sampledHeight(x,z);
  while(hi-lo>1){const mid=(lo+hi)>>1;if(z<rows[mid])hi=mid;else lo=mid;}
  const blend=(z-rows[lo])/(rows[hi]-rows[lo]);
  const start=lo*columns*3,next=start+columns*3;
  lo=0;hi=columns-1;
  while(hi-lo>1){
    const mid=(lo+hi)>>1,offset=mid*3;
    if(x<mix(positions[start+offset],positions[next+offset],blend))hi=mid;else lo=mid;
  }
  const a=start+3*lo,b=next+3*lo;
  const diagonal=mix(positions[a+3],positions[b],blend);
  const yDiagonal=mix(positions[a+4],positions[b+1],blend);
  const left=x<diagonal,c=left?a:a+3,d=left?b:b+3;
  const edge=mix(positions[c],positions[d],blend);
  const frac=Math.abs(edge-diagonal)>1e-9?(x-diagonal)/(edge-diagonal):0;
  return mix(yDiagonal,mix(positions[c+1],positions[d+1],blend),frac);
}
let shingleTop=null,trailSurface=null;
export function traceTrail(ray,length){return trailSurface?.trace(ray,length)??null;}
export function withNativeTrail(visit){return trailSurface?trailSurface.native(visit):visit();}

export function contactHeight(x,z){
  const ground=height(x,z);
  const ford=shingleTop?shingleTop(x,z,ground):ground;
  return trailSurface?trailSurface.top(x,z,ford):ford;
}
export function isWater(x,z) {
  return Math.abs(x-streamX(z)) < streamWidth(z) && height(x,z)<waterY(x,z)+.012;
}

function geo(positions,colors,indices,uvs) {
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  if(colors)g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  if(uvs)g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
  if(indices)g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}
const terrainVS = `
varying vec3 vWorld;
varying vec3 vNormal;
#include <fog_pars_vertex>
void main(){
  vWorld=position; vNormal=normal;
  vec4 mvPosition=modelViewMatrix*vec4(position,1.);
  gl_Position=projectionMatrix*mvPosition;
  #include <fog_vertex>
}`;
const grain = `
float hash2(vec2 p) {
 vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33);
 return fract((p3.x+p3.y)*p3.z);
}
float valueNoise(vec2 p) {
 vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
 return mix(mix(hash2(i),hash2(i+vec2(1,0)),f.x),mix(hash2(i+vec2(0,1)),hash2(i+1.),f.x),f.y);
}
float turf(vec2 p) {
 return .52*valueNoise(p)+.31*valueNoise(p*2.13+1.6)+.17*valueNoise(p*4.42-3.);
}
float trail(float z){
  float bend=8.1*exp(-(z+20.4)*(z+20.4)/54.)+.68*exp(-(z+2.55)*(z+2.55)/2.24)*(1.-smoothstep(-1.,0.,z));
  return 3.7*sin(z*.077)+2.15*sin(z*.018)+.8*sin(z*.16)-bend;
}

`;
function shaderMat(vs,fs,uniforms={},props={}) {
  return new THREE.ShaderMaterial({
    vertexShader:vs,fragmentShader:fs,fog:true,
    uniforms:{...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),...uniforms},...props
  });
}
export function forestCover(x,z) {
  const broad=fbm(x*.0063+9,z*.0063-2),fine=fbm(x*.022,z*.022);
  const bank=Math.abs(x-streamX(z))-streamWidth(z);
  const riparian=(1-smooth(5,40,Math.abs(bank-53)))*.12-.20*(1-smooth(1,23,bank))*smooth(220,410,-z);
  const cover=smooth(.38,.63,broad*.75+fine*.25+riparian);
  if(z> -150)return cover;
  const stands=mix(cover,terraceWoodland(x,z,bank,broad,fine),smooth(150,260,-z))*(1-.93*innerTerrace(x,z))*(1-.62*floodChute(x,z))*(1-.75*westernStrath(x,z));
  if(z> -470||z< -2780)return stands;
  // Migrating meanders leave low, wet scroll bars. Rushes and young trees
  // colonise these former channels before mature spruce reaches the terrace.
  let oldBank=bank;
  for(const offset of [-82,54])oldBank=Math.min(oldBank,Math.abs(x-streamX(z+offset))-streamWidth(z+offset));
  const terrace=smooth(16,111+29*broad,oldBank);
  return stands*mix(1,.11+.89*terrace,smooth(470,660,-z));
}
function buildFloor(scene,groundTexture,duffTexture,cloudField,grassField,flowerField,earth) {
  // Every cross section follows the channel. Bank edges retain their shape at distant LOD.
  const zs=[];
  for(let z=-3500;z<2600;){
    zs.push(z);
    const near=Math.abs(z+39);
    z+=near<77?1.05:near<142?1.8:near<290?4.6:near<850?14:39;
  }
  const offsets=[0,.22,.46,.64,.77,.86,.94,1.01,1.095,1.20,1.36]; // in channel half-widths
  const outside=[];
  for(let x=.92;x<3600;x+=x<16?.92:x<49?1.8:x<145?4.5:x<325?10:x<1100?22:53)outside.push(x);
  const p=[];
  let columns=0;
  for(let row=0;row<zs.length;row++){
    const z=zs[row], w=streamWidth(z), c=streamX(z);
    const positive=[...offsets.map(t=>t*w),...outside.map(t=>t+1.36*w)];
    const coords=[...positive.slice(1).reverse().map(x=>c-x),...positive.map(x=>c+x)];
    columns=coords.length;
    for(const x of coords) p.push(x,sampledHeight(x,z),z);
  }
  const openingParameters={
    openingSource:{value:new THREE.Vector3()},openingAxis:{value:new THREE.Vector3()},
    openingCone:{value:new THREE.Vector3(0,1,1)},openingColor:{value:new THREE.Color(0)}
  };
  const floorVS=('uniform vec3 openingSource,openingAxis,openingCone;varying float openingLight;uniform sampler2D cloudField;uniform float weatherTime;varying float cloudSun;attribute vec4 basinPaint;centroid varying vec4 vBasin;attribute float canopy;centroid varying float vWoods;attribute vec2 channel;varying vec2 vChannel;\n'+terrainVS).replace('vWorld=position;',`
    vWorld=position;vBasin=basinPaint;vWoods=canopy;vChannel=channel;
    vec2 column=position.xz+(860.-position.y)*vec2(-81.,12.)/45.-weatherTime*vec2(6.3,-2.4);
    float cover=texture2D(cloudField,column/6400.).r;
    cloudSun=exp(-.083*max(0.,cover*1.18-.12));
    vec3 toOpening=openingSource-position;
    float d=max(.001,length(toOpening));
    float cone=smoothstep(openingCone.x,openingCone.y,dot(toOpening/d,openingAxis));
    float end=clamp(1.-pow(d*openingCone.z,4.),0.,1.);
    openingLight=cone*end*end*max(0.,dot(normalize(normal),toOpening/d));`).replace('#include <fog_pars_vertex>',
    '#include <common>\n#include <shadowmap_pars_vertex>\n#include <fog_pars_vertex>')
    .replace('#include <fog_vertex>', `
      vec3 transformedNormal=normalMatrix*normal;
      vec4 worldPosition=modelMatrix*vec4(position,1.);
      #include <shadowmap_vertex>
      #include <fog_vertex>
    `);
  const fragment=`
  varying vec3 vWorld;varying vec3 vNormal;
  uniform vec3 openingColor;varying float openingLight;varying float cloudSun;centroid varying vec4 vBasin;centroid varying float vWoods;varying vec2 vChannel;uniform float dusk;uniform sampler2D wash;uniform sampler2D duff;uniform float painted;
  #include <common>
  #include <packing>
  #include <lights_pars_begin>
  #include <shadowmap_pars_fragment>
  #include <shadowmask_pars_fragment>
  #include <fog_pars_fragment>
  ${grain}
  ${earthGLSL}
  ${grassSurfaceGLSL}
  ${flowerFieldGLSL}
  ${fordPathGLSL}
  ${alpineAirGLSL}
  void main(){
    vec2 p=vWorld.xz;
    float blade=turf(p*vec2(2.2,1.3)),m=turf(p*.115),light=turf(p*.047+2.7);
    float dist=distance(vWorld,cameraPosition);
    float path=abs(p.x-trail(p.y));
    float needleNoise=valueNoise(p*18.);
    float radius=1.19+.23*sin(.22*p.y)+.35*m+.49*(valueNoise(p*1.7)-.5)+.18*(needleNoise-.5);
    float shoulder=step(p.x,trail(p.y))*.66*exp(-(p.y+3.2)*(p.y+3.2)/5.3);
    float summit=shoulder+(1.-.45*smoothstep(64.,77.,-p.y))*(1.-smoothstep(77.,84.,-p.y));
    float trailMask=(1.-smoothstep(radius* summit-.14,radius*summit+.18,path))*smoothstep(0.,.26,summit);
    float fordWidth=fordMargin(p.x);
    float spur=(1.-smoothstep(.44*fordWidth,1.02*fordWidth,abs(p.y-fordCenter(p.x))+.22*(needleNoise-.5)))*smoothstep(-3.,1.,p.x)*(1.-smoothstep(vChannel.x-vChannel.y-.8,vChannel.x-vChannel.y+.55,p.x));
    trailMask=max(trailMask,spur*.85);
    vec2 duv=p*vec2(.47,.49)+vec2(.013*valueNoise(p),.014*valueNoise(p*.9+4.));
    vec3 duff1=texture2D(duff,duv).rgb;
    vec3 duff2=texture2D(duff,mat2(.80,.60,-.60,.80)*p*.225+vec2(.15,.79)).rgb;
    vec3 litter=mix(duff1,duff2,smoothstep(.25,.77,m)*.57);
    float nearLevel=1.-smoothstep(28.,105.,dist);
    vec3 green=litter*mix(vec3(.65,.68,.71),vec3(1.19,1.16,.98),smoothstep(.26,.68,m));
    vec3 dirt=mix(vec3(.038,.029,.026),vec3(.116,.091,.07),clamp(m*.62+blade*.42,0.,1.));
    float dx=abs(p.x-vChannel.x)/vChannel.y;
    vec3 bed=mix(vec3(.024,.029,.041),vec3(.09,.095,.109),blade*m+.15)*(1.+.42*(needleNoise-.5));
    vec3 ground=mix(green,dirt,trailMask);
    // A mat of old blades and moss shows through the standing meadow grass.
    vec2 glade=(p-vec2(10.,-40.))/vec2(13.,8.1);
    float turfFloor=max(exp(-dot(glade,glade)),smoothstep(72.,84.,-p.y)*(1.-smoothstep(110.,153.,-p.y)));
    vec3 sod=mix(vec3(.040,.046,.022),vec3(.118,.119,.055),.28+.43*m+.29*blade);
    ground=mix(ground,sod,turfFloor*.76*(1.-trailMask));
    ground=mix(ground,bed,(1.-smoothstep(1.,1.42,dx))*.93);
    float meadow=smoothstep(53.,107.,-p.y);
    float canopy=.70*light+.20*valueNoise(p*.7+3.4)+.10*valueNoise(p*2.81);
    float sun=mix(.44,1.35,smoothstep(.36,.59,canopy));
    ground*=mix(sun,1.12,meadow*.75)*(.73+.35*max(0.,dot(normalize(vNormal),normalize(vec3(-81.,45.,12.)))));
    // Decouple mineral scale from the large soil patches, then light the relief in world space.
    vec2 gravelUv=p*.79+vec2(.043*valueNoise(p*.78),.038*valueNoise(p*.68+4.));
    vec3 gravel=texture2D(wash,gravelUv).rgb;
    vec3 gravel2=texture2D(wash,mat2(.8,.6,-.6,.8)*p*1.19).rgb;
    vec3 cobbles=mix(gravel,gravel2,.23+.10*m);
    float relief=dot(cobbles,vec3(.26,.57,.17));
    vec2 grad=vec2(dFdx(relief),dFdy(relief));
    float burn=clamp((grad.x-grad.y)*5.8,-.10,.11)*nearLevel;
    cobbles*=vec3(.75,.79,.88)*(.75+.47*m+.4*blade+burn);
    float wheel=(1.-smoothstep(.15,.64,abs(path-.56)));
    cobbles=mix(cobbles,cobbles*vec3(.81,.84,.91),wheel*.29);
    // Ochre silt gathers outside the traffic-polished, blue-grey mineral spine.
    float edgeSoil=smoothstep(.57,1.28,path+.21*(m-.5)+.10*sin(p.y*2.3));
    float weather=.65+.43*m+.15*blade;
    vec3 spine=vec3(.076,.088,.111)*weather;
    vec3 softShoulder=vec3(.080,.052,.043)*weather;
    vec3 tread=mix(cobbles*.73,mix(spine,softShoulder,edgeSoil),.65);
    ground=mix(ground,mix(tread,ground,.12)*sun,trailMask*painted*(1.-smoothstep(67.,145.,dist)));
    float barZone=(1.-smoothstep(4.6,10.,abs(p.y+38.)))*step(p.x,vChannel.x);
    float barWidth=1.20+barZone*.47;
    vec3 gravelBed=mix(bed,vec3(.035,.035,.04)*(.77+.30*blade),barZone*.37);
    ground=mix(ground,gravelBed*(.63+.41*needleNoise),1.-smoothstep(1.,barWidth,dx));
    float dryBank=smoothstep(8.5,11.,p.x)*(1.-smoothstep(16.,18.,p.x));
    float drySoil=smoothstep(12.4,15.1,p.x);
    vec3 loam=mix(vec3(.048,.045,.054),vec3(.160,.119,.096),drySoil);
    loam*=.84+.36*relief+.12*(m-.5);
    vec3 crossingMaterial=mix(dirt*.39,cobbles*.62,.35);
    crossingMaterial=mix(crossingMaterial,mix(loam,cobbles*mix(.72,1.40,drySoil),.28),dryBank);
    ground=mix(ground,crossingMaterial*sun,spur*.90);
    float alpineMix=smoothstep(108.,155.,-p.y);
    vec3 nBasin=normalize(vNormal);
    float basinSun=.86+.27*dot(nBasin,normalize(vec3(-.72,.49,.45)));
    float sedge=.52*turf(p*vec2(.11,.24))+.48*turf(p*vec2(.034,.072));
    vec3 alps=vBasin.rgb*basinSun*mix(.82,1.17,smoothstep(.22,.77,sedge));
    float woods=vWoods*smoothstep(79.,290.,dist);
    ground*=mix(vec3(1.),vec3(.43,.56,.68),woods);
    ground=mix(ground,alps,alpineMix);
    vec3 soilNormal;
    float meadowSoil=clamp(max(turfFloor,.86*(1.-clamp(vWoods,0.,1.))),0.,1.);
    float bankGravel=1.-smoothstep(1.01,barWidth+.12,dx);
    ground=earthSurface(ground,p,nBasin,dist,m,meadowSoil,trailMask,bankGravel,soilNormal);
    vec3 keyLight=normalize(vec3(-81.,45.,12.));
    float microLight=(.42+.78*max(0.,dot(soilNormal,keyLight)))/(.42+.78*max(0.,dot(nBasin,keyLight)));
    ground*=mix(1.,microLight,(1.-dusk)*cloudSun);
    float grassHabitat=(1.-.93*vBasin.a)*(1.-trailMask)*smoothstep(barWidth-.12,barWidth+.19,dx)*smoothstep(.59,.91,nBasin.y);
    vec4 turfLayer=distantGrass(vWorld,nBasin,dist,grassHabitat,vWoods);
    ground=colonySurface(mix(ground,turfLayer.rgb,turfLayer.a),vWorld,nBasin,grassHabitat);
    float shingle=smoothstep(100.,330.,dist)*(1.-smoothstep(1.04,1.4+valueNoise(p*.091)*.25,dx));
    ground=mix(ground,vec3(.129,.145,.119)*(.83+.22*m),shingle*.44);
    ground*=mix(vec3(1.),vec3(.38,.43,.58),dusk);
    ground*=mix(vec3(.43,.50,.57),vec3(mix(cloudSun,1.,dusk)),getShadowMask());
    ground*=1.+openingColor*(.36*openingLight*cloudSun*(1.-dusk)*(1.-dusk));
    #if NUM_POINT_LIGHTS > 0
      vec3 viewPoint=(viewMatrix*vec4(vWorld,1.)).xyz;
      vec3 nView=normalize(mat3(viewMatrix)*soilNormal);
      for(int i=0;i<NUM_POINT_LIGHTS;i++){
        IncidentLight glow;
        getPointLightInfo(pointLights[i],viewPoint,glow);
        ground+=ground*glow.color*max(0.,dot(nView,glow.direction))*.52;
      }
    #endif
    float aerial=1.-exp(-max(0.,dist-85.)*.00064);
    vec3 haze=vec3(.107,.187,.271)*mix(vec3(1.),vec3(.42,.49,.65),dusk);
    vec3 valley=valleyRadiance(ground,dist,vWorld.y,dusk);
    ground=mix(mix(ground,haze,aerial*.93),valley,smoothstep(112.,232.,-vWorld.z));
    gl_FragColor=vec4(ground,1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;
  const mat=shaderMat(floorVS,fragment,{...earth,earthStrength:{value:1},...grassField,...flowerField,...openingParameters,...THREE.UniformsUtils.clone(THREE.UniformsLib.lights),dusk:{value:0},weatherTime:{value:0},cloudField:{value:cloudField},wash:{value:groundTexture||null},duff:{value:duffTexture},painted:{value:groundTexture?1:0}},{lights:true});
  // Share position/normal buffers between twenty geographic tiles; only visible tile indices are drawn.
  const base=new THREE.BufferGeometry();
  const pos=new THREE.Float32BufferAttribute(p,3), normals=new Float32Array(pos.array.length);
  const n=new THREE.Vector3(),woods=new Float32Array(pos.count),pigment=new Float32Array(pos.count*4),bands=new Float32Array(pos.count*2);
  for(let i=0;i<pos.count;i++){
    const x=pos.getX(i),z=pos.getZ(i);woods[i]=forestCover(x,z);
    if(z< -108)pigment.set(terracePigment(x,z,woods[i],fbm(x*.0061+41,z*.0061-27),noise(x*.039,z*.039)),i*4);
    pigment[i*4+3]=talusCover(x,z);
    bands[i*2]=courseX(z);bands[i*2+1]=courseWidth(z);
    n.set(sampledHeight(x-.25,z)-sampledHeight(x+.25,z),.5,sampledHeight(x,z-.25)-sampledHeight(x,z+.25)).normalize();
    normals.set([n.x,n.y,n.z],i*3);
  }
  surface={rows:zs.map(Math.fround),positions:pos.array,columns,centers:zs.map(courseX),widths:zs.map(courseWidth),levels:zs.map(levelAt)};
  const basinPaint=new THREE.BufferAttribute(pigment,4);
  const norm=new THREE.BufferAttribute(normals,3),canopy=new THREE.BufferAttribute(woods,1),channel=new THREE.BufferAttribute(bands,2);
  const zCuts=[0,...[-350,-80,35,260].map(z=>zs.findIndex(t=>t>=z)),zs.length-1];
  const xCuts=[0,Math.floor(columns*.27),Math.floor(columns*.5),Math.floor(columns*.73),columns-1];
  const v=new THREE.Vector3();
  for(let iz=0;iz<zCuts.length-1;iz++)for(let ix=0;ix<xCuts.length-1;ix++){
    const g=base.clone(),idx=[],box=new THREE.Box3();
    for(let r=zCuts[iz];r<=zCuts[iz+1];r++)for(let c=xCuts[ix];c<=xCuts[ix+1];c++){
      const a=r*columns+c;box.expandByPoint(v.fromBufferAttribute(pos,a));
      if(r<zCuts[iz+1] && c<xCuts[ix+1])idx.push(a,a+columns,a+1,a+1,a+columns,a+columns+1);
    }
    g.setAttribute('position',pos);g.setAttribute('normal',norm);g.setAttribute('canopy',canopy);g.setAttribute('basinPaint',basinPaint);g.setAttribute('channel',channel);g.setIndex(idx);
    g.boundingBox=box;g.boundingSphere=box.getBoundingSphere(new THREE.Sphere());
    const tile=new THREE.Mesh(g,mat);tile.name='Watershed trail and channel';tile.receiveShadow=true;scene.add(tile);
  }
  return mat;
}
function addRange(scene,layer,mountainSurfaces,grassField) {
  // Overlapping angular alpine massifs. Each summit owns its position, spurs and drainage basin.
  const rand=rng(3342+layer*79),baseR=[3500,2440,1630][layer];
  const peaks=[],num=[43,31,25][layer],sectors=[968,408,324][layer],belts=[68,32,25][layer];
  function summit(a,r,h,reach,seed) {
    peaks.push({x:r*Math.sin(a),z:-r*Math.cos(a),h,reach,seed,turn:rand()*TAU,
      stretch:.76+rand()*.25,flutes:4+Math.floor(rand()*4)});
  }
  for(let k=0;k<num;k++){
    const a=-Math.PI+TAU*(k+.65*rand())/num;
    const side=1-Math.exp(-Math.pow(a/.44,2));
    const h=[62+110*side+rand()**1.75*139,-28+117*side+rand()**1.27*88,-91+87*side+rand()**1.4*71][layer];
    summit(a,baseR*(.89+.23*rand()),h,[990,860,720][layer]*(.75+.61*rand()),k+13);
  }
  const hero=[[-1.18,.08,595],[-.99,.07,507],[-.80,-.05,564],[-.71,-.04,459],[-.63,.03,428],[-.55,.13,329],[-.22,.11,240],[-.073,.09,347],[.06,.10,223],[.18,.12,170],[.43,.05,348],[.53,.08,387],[.67,-.03,439],[.84,-.03,493],[1.05,.04,507]];
  for(const [a,shift,h] of hero){
    const offset=[0,.14,-.18][layer];
    const side=1-Math.exp(-Math.pow(a/.54,2));
    const alt=layer===0?h:layer===1?h*.37-27:h*.15-63;
    summit(a+offset,baseR*(1+shift),alt,[1280,985,800][layer]*(.84+.27*side),200+8*a);
  }
  if(layer===0){
    for(const [bearing,height,reach] of [[-.258,269,560],[-.183,295,487],[-.134,315,543],[-.015,297,497],[.044,270,460]]){
      summit(bearing,baseR*1.085,height,reach,230+bearing*14);
    }
  }
  const rockLow=new THREE.Color([0x496d8e,0x355575,0x253f56][layer]);
  const rockHigh=new THREE.Color([0x7696ae,0x607f96,0x496575][layer]);
  const snowColor=new THREE.Color([0xc4d9e6,0xadc7d7,0x92b5c0][layer]);
  const v=[],col=[],ind=[],fields=[],columns=sectors+1;
  for(let row=0;row<=belts;row++){
    const u=row/belts,radius=baseR*(.54+u*.82);
    for(let i=0;i<=sectors;i++){
      const a=(i/sectors-.5)*TAU, x=radius*Math.sin(a),z=-radius*Math.cos(a);
      let y=-178,dominant=0,drain=0,secondary=-178;
      for(const peak of peaks){
        const dx=x-peak.x,dz=z-peak.z;
        if(Math.abs(dx)>peak.reach*1.55 || Math.abs(dz)>peak.reach*1.55)continue;
        const dir=Math.atan2(dz,dx),t=dir-peak.turn;
        const ex=Math.hypot(dx,dz)/peak.reach;
        const flank=Math.sqrt(Math.cos(t)**2*peak.stretch+Math.sin(t)**2/peak.stretch);
        const a0=t+.13*Math.sin(ex*3+peak.seed)+.07*Math.sin(ex*7-peak.seed);
        const gullies=Math.abs(Math.sin(a0*peak.flutes*.5));
        const spurs=.82+.28*gullies+.16*Math.abs(Math.sin(a0*(peak.flutes+2)*.5+.74));
        const extent=ex*flank*spurs;
        const altitude=peak.h-(peak.h+177)*Math.pow(extent,.85);
        if(altitude>y){
          secondary=y;y=altitude;dominant=peak.h;
          // Wind loading curls around rock ribs before draining into the cirque.
          const apron=.5+.5*Math.cos(3.7*dir+.57*peak.seed+1.28*Math.sin(5.4*ex+.15*peak.seed));
          const fall=dz/peak.reach;
          const fan=dx/peak.reach/(Math.max(0,fall)+.049);
          const drift=.43*Math.sin(peak.seed*.73)-1.75*peak.x/baseR;
          const fork=.46+drift+.32*Math.sin(fall*12.+peak.seed*.59)+.074*Math.sin(fall*37.+peak.seed);
          const feeder=-.48+drift+.14*Math.sin(fall*18.+peak.seed*.27);
          const catchment=Math.max(Math.exp(-(((fan-fork)/.22)**2)),.94*Math.exp(-(((fan-feeder)/.18)**2)));
          drain=mix(.81*apron+.19*gullies,.94*catchment+.06*gullies,smooth(-.006,.08,fall));
        }else secondary=Math.max(secondary,altitude);
      }
      const n=fbm(x*.011+13,z*.011-4),strata=fbm(x*.035+2,z*.035+7);
      // Rounded cols join adjacent glacial cirques; long spurs descend from each crest.
      const shoulder=Math.max(0,83-Math.abs(y-secondary));
      y+=shoulder*shoulder/480;
      y+=(n-.49)*[41,30,19][layer]+(strata-.48)*[12,8,5][layer];
      // The distant glacial headwall joins the central summits in a broad, low saddle.
      if(layer===0){
        const headwall=(1.-smooth(.22,.44,Math.abs(a+.015)))*(1.-smooth(.14,.40,Math.abs(radius/baseR-1.07)));
        const shelf=.70*Math.max(0,210-y)*smooth(8,145,y)-.28*Math.max(0,y-258);
        y+=headwall*(shelf+19*Math.exp(-((a+.088)**2)/.013)*smooth(45,175,y));
        // Long granite aretes join neighbouring summits above the cirque walls.
        for(let k=1;k<hero.length;k++){
          const [a0,r0,h0]=hero[k-1],[a1,r1,h1]=hero[k];
          if(a<a0 || a>a1 || a1-a0>.24)continue;
          const f=(a-a0)/(a1-a0),sag=Math.sin(Math.PI*f);
          const crest=baseR*(1+mix(r0,r1,f))+.026*baseR*sag*Math.sin(3.2*f+k);
          const lower=Math.abs(radius-crest);
          const spine=mix(h0,h1,f)-sag*(10+85*(a1-a0))-.50*lower-(n-.45)*7;
          y+=.88*Math.max(0,spine-y);
        }
      }else if(layer===1 && z<0){
        const slope=smooth(.14,.60,Math.abs(a+.07));
        const col=(1.-smooth(.16,.42,Math.abs(radius/baseR-1.04)));
        y+=col*smooth(-144,-12,y)*(18+50*slope);
        // Interlocking U-valley shoulders sit in front of the snowfields. The
        // west arête falls into a saddle; the east ridge leaves the river visible.
        const west=smooth(.30,.99,-a),east=smooth(.20,.83,a);
        const crestRadius=baseR*(.865+.040*Math.sin(a*7)+.025*Math.cos(a*13));
        const lip=18+232*west+155*east+7*Math.sin(17*a)+5*(n-.5);
        const flank=Math.abs(radius-crestRadius)*(.32+.095*Math.cos(a*4));
        const join=smooth(.17,.42,Math.abs(a))*(1.-smooth(1.2,1.75,Math.abs(a)));
        y+=join*Math.max(0,lip-flank-y);
        const centralCol=gaussian((a+.29)/.20)*gaussian((radius/baseR-.98)/.29);
        y-=38*centralCol;
      }
      if(layer===0&&z<0){
        // The west shoulder breaks into a saddle with a longer arête on either side.
        const summitBand=gaussian((radius/baseR-1.0)/.22);
        y+=summitBand*(55*gaussian((a+.944)/.074)-73*gaussian((a+.86)/.038));
        // Paired avalanche gullies converge below the crest. Their cut into
        // the face supplies both real relief and persistent pockets of snow.
        for(const k of [1,2,4,10,12,13]){
          const [bearing,offset]=hero[k],sn=Math.sin(bearing),cs=Math.cos(bearing);
          const run=baseR*(1+offset)-(x*sn-z*cs);
          if(run<0||run>680)continue;
          const across=x*cs+z*sn,side=bearing<0?1:-1;
          const axis=side*(.61*run+.0005*run*run+22*Math.sin(run*.012+k));
          const window=smooth(12,78,run)*(1-smooth(398,655,run));
          const groove=gaussian((across-axis)/(21+.095*run));
          const feeder=gaussian((across-axis-side*(112-run*.29))/(12+.044*run));
          const channel=window*Math.max(groove,.84*feeder);
          y-=38*channel;
          drain=Math.max(drain,channel*(1.05+.16*n));
        }
      }
      y=mix(-218,y,smooth(1040,1310,Math.max(Math.abs(x),Math.abs(z))));
      // The through-valley continues between the 3D mountain belts. Alluvial terraces
      // remain the upper physical surface along the river instead of overlapping granite.
      const valleyAxis=.5*courseX(z);
      const through=(1-smooth(376,735,Math.abs(x-valleyAxis)))*smooth(991,1260,-z)*(1-smooth(2440,3260,-z));
      y=mix(y,Math.min(y,levelAt(z)-13),through);
      const ground=sampledHeight(x,z);
      // The river terrace overlies the bedrock toe. Feather their junction
      // below the western valley shoulder, leaving the snowy arêtes intact.
      y=mix(y,Math.min(y,ground-2),smooth(.12,.49,westernStrath(x,z)));
      v.push(x,y,z);fields.push([y,dominant,drain,n,strata,y-ground,forestCover(x,z)]);
      if(row&&i){const q=row*columns+i;ind.push(q-columns-1,q-1,q,q-columns-1,q,q-columns);}
    }
  }
  mountainSurfaces.push((x,z)=>{
    // Resolve the actual triangle under the trunk on the concentric, chordal grid.
    const azimuth=Math.atan2(x,-z),column=(azimuth/TAU+.5)*sectors;
    const c=Math.min(sectors-1,Math.floor(column)),half=Math.PI/sectors;
    const delta=(column-c-.5)*2*half;
    const radius=Math.hypot(x,z)*Math.cos(delta)/Math.cos(half);
    const row=(radius/baseR-.54)/.82*belts;
    if(row<0 || row>=belts)return -400;
    const j=Math.floor(row),b=row-j,t=.5+.5*Math.tan(delta)/Math.tan(half);
    const inner=baseR*(.54+.82*j/belts),outer=inner+baseR*.82/belts;
    const across=t*radius,diagonal=b*outer,i=(j*columns+c)*3+1,n=i+columns*3;
    if(across<=diagonal){
      const w=across/outer;
      return (1-b)*v[i]+(b-w)*v[n]+w*v[n+3];
    }
    const w=(across-diagonal)/inner;
    return (1-b-w)*v[i]+w*v[i+3]+b*v[n+3];
  });
  const g=geo(v,null,ind),normal=g.attributes.normal,face=new THREE.Vector3(),c=new THREE.Color();
  const light=new THREE.Vector3(-81,45,12).normalize(), deposits=[];
  for(let i=0;i<fields.length;i++){
    const [y,top,drain,n,strata]=fields[i];
    face.fromBufferAttribute(normal,i);if(face.y<0)face.negate();
    const lit=face.dot(light),alt=smooth(-68,475,y);
    c.copy(rockLow).lerp(rockHigh,.1+.37*alt+.26*n);
    c.multiplyScalar(.67+.48*(.48+.52*lit)+.18*strata);
    if(layer===1){
      const shade=1-smooth(.13,.55,lit);
      c.multiplyScalar(1-.43*shade);c.r*=1-.21*shade;c.g*=1-.07*shade;
    }
    const az=Math.atan2(v[i*3],-v[i*3+2]);
    const saddle=layer===0?(1.-smooth(.19,.43,Math.abs(az+.08))):0.;
    const load=(.56*y/Math.max(top,180)-.16)+1.12*(drain-.67)+.16*(face.y-.78)+.10*(n-.5)+.23*saddle;
    const snowHeight=smooth([116,188,244][layer],[181,246,298][layer],y);
    const crag=smooth(.48,.72,strata)*smooth(.40,.65,n);
    const cap=.31*smooth(.81,1.00,y/Math.max(top,255));
    const snowLoad=load+cap-.96*(1.-snowHeight)-.35*crag+.33*(n-.52);
    deposits.push(c.r,c.g,c.b,snowLoad);
    const snow=smooth(.18,.27,snowLoad);
    c.lerp(snowColor,snow*(.80+.09*Math.max(0,lit)));
    col.push(c.r,c.g,c.b);
  }
  g.setAttribute('color',new THREE.Float32BufferAttribute(col,3));
  g.setAttribute('snowCatchment',new THREE.Float32BufferAttribute(deposits,4));
  g.setAttribute('terrainSeam',new THREE.Float32BufferAttribute(fields.flatMap((f,i)=>[f[5],f[6],talusCover(v[i*3],v[i*3+2])]),3));
  const mat=new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide,fog:false});
  mat.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,grassField);
    shader.vertexShader='attribute vec4 snowCatchment;attribute vec3 terrainSeam;centroid varying vec3 seamData;varying vec4 snowfield;varying vec3 alpinePos,alpineNormal;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nalpinePos=position;alpineNormal=normal;snowfield=snowCatchment;seamData=terrainSeam;');
    shader.fragmentShader='centroid varying vec3 seamData;varying vec3 alpinePos,alpineNormal;varying vec4 snowfield;\n'+grain+grassSurfaceGLSL+alpineAirGLSL+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`
      #include <color_fragment>
      vec2 massif=vec2(atan(alpinePos.x,-alpinePos.z),alpinePos.y);
      float rock=turf(vec2(massif.x*144.,massif.y*.021));
      float fissure=turf(alpinePos.xz*.032+vec2(massif.y*.016,0.));
      float snow=smoothstep(.17,.29,snowfield.a+.32*(rock-.5)+.16*(fissure-.5));
      vec3 deposit=mix(snowfield.rgb,vec3(.69,.79,.88)*(.88+.24*rock),snow*.90);
      float dist=distance(alpinePos,cameraPosition);
      vec3 slopeNormal=normalize(alpineNormal);
      if(slopeNormal.y<0.)slopeNormal=-slopeNormal;
      float grassHabitat=(1.-.93*seamData.z)*(1.-snow)*(1.-smoothstep(100.,285.,alpinePos.y))*smoothstep(.67,.94,slopeNormal.y);
      vec4 turfLayer=distantGrass(alpinePos,slopeNormal,dist,grassHabitat,seamData.y);
      deposit=mix(deposit,turfLayer.rgb,turfLayer.a);
      diffuseColor.rgb=deposit*(.95+.10*rock)*diffuse;
      float saddle=${layer===0?'1.':'0.'}*(1.-smoothstep(.15,.43,abs(massif.x+.08)));
      vec3 aerial=mix(vec3(.110,.210,.302),vec3(.195,.327,.433),smoothstep(-66.,560.,alpinePos.y));
      aerial=mix(aerial,vec3(.288,.430,.534),saddle);
      diffuseColor.rgb=mix(diffuseColor.rgb,aerial*diffuse,.20*saddle);
      float dusk=clamp((1.-diffuse.b)/.4,0.,1.);
      float flank=smoothstep(.32,.86,abs(massif.x));
      diffuseColor.rgb=valleyRadiance(diffuseColor.rgb,dist*(${layer===1?'(.64-.30*flank)':layer===2?'.62':'1.'}+.14*saddle),alpinePos.y,dusk);
      vec3 skylight=mix(vec3(.36,.56,.69),vec3(.089,.116,.17),dusk);
      diffuseColor.rgb=mix(diffuseColor.rgb,skylight,.38*saddle);
      float heath=turf(alpinePos.xz*.007+14.)*.71+turf(alpinePos.xz*.023)*.29;
      vec3 baseHeath=mix(vec3(.040,.075,.070),vec3(.161,.181,.083),smoothstep(.25,.71,heath));
      baseHeath*=mix(.78,1.20,smoothstep(.33,.67,turf(alpinePos.xz*.003+4.)));
      baseHeath=mix(baseHeath,vec3(.030,.069,.107),smoothstep(130.,1160.,dist)*.70);
      baseHeath*=mix(vec3(1.),vec3(.43,.56,.68),seamData.y);
      baseHeath=mix(baseHeath,turfLayer.rgb,turfLayer.a);
      baseHeath=valleyRadiance(baseHeath*diffuse,dist,alpinePos.y,dusk);
      diffuseColor.rgb=mix(baseHeath,diffuseColor.rgb,smoothstep(-1.,65.,seamData.x));
    `);
  };
  const mesh=new THREE.Mesh(g,mat);mesh.name=['Granite divide','Blue ridge','Lower foothills'][layer];scene.add(mesh);
  return mat;
}

function addSky(scene,skyTexture,cloudField){
  const dir=new THREE.Vector3(-81,45,12).normalize();
  const mat=new THREE.ShaderMaterial({
    side:THREE.BackSide,depthWrite:false,fog:false,
    uniforms:{clock:{value:0},dusk:{value:0},paint:{value:skyTexture||null},painted:{value:skyTexture?1:0},sun:{value:dir},cloudField:{value:cloudField}},
    vertexShader:`
      varying vec3 worldDir;
      void main(){worldDir=position;vec4 clip=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_Position=clip.xyww;}
    `,
    fragmentShader:`
    varying vec3 worldDir;uniform float dusk;uniform sampler2D paint;uniform float painted;uniform vec3 sun;uniform float clock;
    ${grain}
    ${cloudGLSL}
    void main(){
      vec3 d=normalize(worldDir);
      float h=max(0.,d.y);
      vec3 zenith=vec3(.014,.265,.539),horizon=vec3(.74,.96,1.09);
      vec3 sky=mix(zenith,horizon,exp(-h*3.96));
      float az=atan(d.x,-d.z)/6.2831853+.5;
      vec2 uv=vec2(fract(az+.000046*clock),clamp(pow(h,.72)*1.35+.22,0.,.99));
      vec3 brush=texture2D(paint,uv).rgb;
      sky=mix(sky,mix(sky,brush,.49),painted*.42);
      float alignment=max(0.,dot(d,sun));
      sky+=vec3(.14,.074,.022)*pow(alignment,27.)+vec3(.78,.58,.29)*smoothstep(.999957,.999988,alignment);
      vec3 evening=mix(vec3(.48,.25,.19),vec3(.033,.059,.137),smoothstep(-.03,.45,h));
      sky=mix(sky,evening,dusk*.85);
      sky=cloudLayer(sky,cameraPosition,d,sun,clock,dusk);
      gl_FragColor=vec4(sky,1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`
  });
  const sky=new THREE.Mesh(new THREE.SphereGeometry(4600,40,20),mat);
  sky.renderOrder=-100;sky.name='Painted evening sky';sky.frustumCulled=false;scene.add(sky);
  return sky;
}
export async function createLand(scene,options={}) {
  const base=import.meta.env.BASE_URL;
  const crownLibrary=new GLTFLoader().loadAsync(base+'models/watershed-crowns.glb');
  surface=null;shingleTop=null;trailSurface=null;
  const loader=new THREE.TextureLoader();
  function texture(value,fallback,repeat){
    if(value===false || value===null)return null;
    const map=value?.isTexture?value:loader.load(value||fallback);
    map.colorSpace=THREE.SRGBColorSpace;map.wrapS=THREE.RepeatWrapping;
    map.wrapT=repeat?THREE.RepeatWrapping:THREE.ClampToEdgeWrapping;
    map.anisotropy=4;return map;
  }
  const ground=texture(options.groundTexture,base+'art/ground.webp',true);
  const clouds=createClouds(loader),sky=addSky(scene,texture(options.skyTexture,base+'art/sky.webp',false),clouds.field);
  const grassField=createGrassField(loader),mountainsAt=[];
  const mountains=[0,1,2].map(l=>addRange(scene,l,mountainsAt,grassField));
  rangeSurfaces=mountainsAt;
  const duff=texture(options.duffTexture,base+'art/woodland-duff.webp',true);
  const colonyMaps=createFlowerField(loader.manager);
  const floor=buildFloor(scene,ground,duff,clouds.field,grassField,colonyMaps,await loadEarth(loader.manager)),water=buildBrook(scene,surface.rows,{height,streamX,streamWidth,waterY});
  const streamStones=addShingle(scene,{height,waterY,streamX,streamWidth,trailX,fordTrailZ},rng(705311),floor.uniforms.shingleEarth);
  shingleTop=streamStones.top;
  trailSurface=addTrailStones(scene,{height,trailX,streamX,streamWidth,isWater,fordTrailZ,fordMargin},rng(610072),floor.uniforms.shingleEarth);
  trailSurface.update({x:trailX(0),z:0});

  const woodland=createTreeStands({height,streamX,streamWidth,trailX,isWater,forestCover,standNoise:noise,
    treeGround(x,z){
      const near=Math.max(Math.abs(x),Math.abs(z))<840;
      if(near)return height(x,z);
      let top=z>=surface.rows[0] && z<=surface.rows.at(-1) && Math.abs(x-streamX(z))<3550?height(x,z):-Infinity;
      for(const range of mountainsAt){const y=range(x,z);if(y> -399)top=Math.max(top,y);}
      return top;
    }});
  const lod=addForestLOD(scene,woodland,(await crownLibrary).scene);
  const fogDay=new THREE.Color(0x809fb6),fogNight=new THREE.Color(0x5a606f);
  scene.fog=new THREE.Fog(fogDay,90,2180);
  let lastDusk=-1;
  function setGroundOpening(lamp){
    const u=floor.uniforms;
    u.openingSource.value.copy(lamp.position);
    u.openingAxis.value.subVectors(lamp.position,lamp.target.position).normalize();
    u.openingCone.value.set(Math.cos(lamp.angle),Math.cos(lamp.angle*(1-lamp.penumbra)),1/lamp.distance);
    u.openingColor.value.copy(lamp.color).multiplyScalar(lamp.intensity);
  }
  return {woodland,ripple,setGroundOpening,cloudSunlight:clouds.sunlight,update(dt,time,player,dusk=0){
    grassField.grassTime.value=time;
    water.update(time);streamStones.update(player);trailSurface.update(player);sky.material.uniforms.clock.value=floor.uniforms.weatherTime.value=time;
    lod.update(player);sky.position.copy(player);
    const evening=clamp(dusk);
    if(Math.abs(evening-lastDusk)<.002)return;
    lastDusk=evening;
    floor.uniforms.dusk.value=water.uniforms.dusk.value=sky.material.uniforms.dusk.value=evening;
    lod.daylight.value=1-.56*evening;
    scene.fog.color.copy(fogDay).lerp(fogNight,evening);
    for(const mat of mountains)mat.color.setRGB(1-.62*evening,1-.55*evening,1-.4*evening);
  }};
}

