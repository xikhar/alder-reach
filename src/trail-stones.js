import * as T from 'three';
import {weatheredStone} from './stone-surface.js';
import shapes from './trail-stone-prototypes.json';
import {stoneContact} from './stone-contact.js';

const families=['WeatheredBasalt','RoundedQuartzite','BeddedSlate','Ironstone','LichenGrit'];
const switchBase=30,switchScale=130,transition=18,recropDistance=1.8;
const palette=['#4b535b','#66676a','#414e59','#69574d','#575e57'];

export function trailMargin(z,offset=0){
  const grass=T.MathUtils.smoothstep(-z,64,77);
  const shoulder=offset<0?.66*Math.exp(-((z+3.2)**2)/5.3):0;
  return shoulder+(1-.45*grass)*(1-T.MathUtils.smoothstep(-z,77,84));
}

function geometry(form){
  const g=new T.BufferGeometry();
  for(const [name,key] of [['position','p'],['normal','n'],['color','c']])
    g.setAttribute(name,new T.Float32BufferAttribute(form[key],3));
  g.setIndex(form.i);return g;
}

function surface(low,eye,scan){
  const mat=new T.MeshStandardMaterial({name:'Worn trail stone',vertexColors:true,roughness:.77});
  mat.onBeforeCompile=shader=>{
    shader.uniforms.trailEye=eye;
    weatheredStone(shader,scan,'stoneFace','0.');
    shader.vertexShader='uniform vec2 trailEye;varying vec2 coverage;varying vec3 stoneFace;varying vec3 mineral;varying float clastSeed;\n'+shader.vertexShader;
    shader.fragmentShader='varying vec2 coverage;varying vec3 stoneFace;varying vec3 mineral;varying float clastSeed;\n'+shader.fragmentShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
      mineral=position;stoneFace=(instanceMatrix*vec4(position,1.)).xyz;
      float d=distance(instanceMatrix[3].xz,trailEye);
      float scale=length(instanceMatrix[0].xyz);
      float switchAt=${switchBase.toFixed(1)}+${switchScale.toFixed(1)}*scale;
      float horizon=max(switchAt+${transition.toFixed(1)},clamp(870.*scale,56.,168.));
      float rim=smoothstep(switchAt,switchAt+${transition.toFixed(1)},d);
      coverage=${low?'vec2(smoothstep(horizon,horizon*1.24,d),rim)':'vec2(rim,1.)'};

      clastSeed=fract(sin(dot(instanceMatrix[3].xz,vec2(12.81,4.13)))*5623.4);
    `);
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      if(coverage.x>0.||coverage.y<1.){
        float cover=fract(52.9829189*fract(dot(floor(gl_FragCoord.xy),vec2(.06711056,.00583715))));
        if(cover<coverage.x||cover>=coverage.y)discard;
      }
      float stratum=sin(mineral.x*5.4+mineral.y*8.1+mineral.z*1.3+4.*clastSeed+.4*sin(mineral.z*4.2));
      float inclusion=smoothstep(.964,.998,stratum)*smoothstep(.78,.96,clastSeed);
      diffuseColor.rgb*=.96+.045*stratum+.10*smoothstep(.01,.48,mineral.y);
      float grain=sin(mineral.x*28.1+mineral.y*8.7-mineral.z*19.2)*sin(mineral.x*12.6+mineral.z*32.7+clastSeed*24.);
      diffuseColor.rgb*=1.+grain*.071;
      diffuseColor.rgb+=vec3(.014,.016,.021)*inclusion;
    `);
    shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_begin>',`#include <normal_fragment_begin>
      vec3 facet=normalize(cross(dFdx(-vViewPosition),dFdy(-vViewPosition)));
      normal=normalize(mix(normal,facet,.28));
    `);
    shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`
      float polish=smoothstep(.02,.46,mineral.y);
      outgoingLight+=diffuseColor.rgb*vec3(.15,.15,.14)*polish*(.86+.20*clastSeed);
      #include <opaque_fragment>
    `);
    shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
      roughnessFactor-=.16*smoothstep(.15,.55,mineral.y);
    `);
  };
  mat.customProgramCacheKey=()=>'path-stone-mineral-'+low;return mat;
}

export function addTrailStones(scene,land,random,scan){
  const forms=families.map(name=>[geometry(shapes[name]),geometry(shapes[name+'Low'])]);
  const eye={value:new T.Vector2()},paints=[surface(false,eye,scan),surface(true,eye,scan)];
  const pose=new T.Object3D(),normal=new T.Vector3(),vertical=new T.Vector3(0,1,0),turn=new T.Quaternion();
  const contacts=stoneContact(.42,[-19,22,-85,1001]),spacing=new Map(),bands=new Map(),tiles=[];
  const colors=palette.map(color=>new T.Color(color));
  // The trafficked centre has intermixed flints and broader polished caps. Raised,
  // mossy verges carry a few stray stones and leave irregular seams of humus.
  function settle(z,x,size,chip){
    const cell=.42;
    const ix=Math.floor(x/cell),iz=Math.floor(z/cell);
    for(let j=iz-1;j<=iz+1;j++)for(let i=ix-1;i<=ix+1;i++){
      for(const old of spacing.get(i+','+j)??[])
        if((x-old.x)**2+(z-old.z)**2<(size*.88+old.radius)**2)return;
    }
    const key=ix+','+iz;
    if(!spacing.has(key))spacing.set(key,[]);
    spacing.get(key).push({x,z,radius:size*.84});
    const pick=random(),kind=pick<.40?0:pick<.64?1:pick<.86?2:pick<.91?3:4;
    const stretch=.85+.46*random(),aspect=.66+.28*random();
    const sx=size*stretch,sy=size*(chip?.58:.77)*(.71+.30*random()),sz=size*aspect;
    const pace=Math.max(.06,size*.90);
    normal.set(land.height(x-pace,z)-land.height(x+pace,z),2*pace,land.height(x,z-pace)-land.height(x,z+pace)).normalize();
    pose.quaternion.setFromUnitVectors(vertical,normal);
    turn.setFromAxisAngle(vertical,random()*Math.PI*2);pose.quaternion.multiply(turn);
    const soil=land.height(x,z),bury=sy*(.12+.21*random()+.035*Math.cos(z*.74+x*3.2));
    pose.position.set(x,soil-bury,z);pose.scale.set(sx,sy,sz);pose.updateMatrix();
    const tint=colors[kind].clone().multiplyScalar(.75+.53*random());
    const index=Math.floor(z/18);
    if(!bands.has(index))bands.set(index,families.map(()=>[]));
    bands.get(index)[kind].push({matrix:pose.matrix.clone(),tint});
    contacts.add(forms[kind][0],pose.matrix);
  }
  for(let meter=-84;meter<1000;meter++){
    for(let sample=0;sample<41;sample++){
      const z=meter+random(),width=trailMargin(z)*(1.28+.16*Math.sin(z*.22)+.12*Math.sin(z*.61+.3));
      if(width<.055)continue;
      const lane=(random()*2-1)*width,x=land.trailX(z)+lane;
      const r=Math.abs(lane)/width,chip=sample>26;
      const ribbon=.42*Math.sin(z*.79+.75*Math.sin(z*.24))+.22*Math.sin(z*1.43);
      const nest=.52+.29*Math.sin(z*1.5+lane*2.6)+.19*Math.cos(z*.77-lane*4.7);
      const tread=.39+.46*Math.exp(-((lane-ribbon)**2)/.52)+.20*nest;
      const patch=chip?.85:.40+.60*T.MathUtils.smoothstep(nest,.16,.72);
      if(random()>tread*patch*(1-.78*T.MathUtils.smoothstep(r,.65,1))*Math.min(1,width/.46))continue;
      if(land.isWater(x,z) || Math.abs(x-land.streamX(z))<land.streamWidth(z)+1)continue;
      const size=chip?.026+.048*random()**.64:.051+.085*random()**.88+.020*nest;
      settle(z,x,size,chip);
    }
  }
  // Occasional flattened stones show through the dry turf. The dense wet
  // shingle downstream has its own distribution and collision geometry.
  for(let i=0;i<152;i++){
    const x=6.5+random()*11.2,offset=(2*random()-1)*.47*land.fordMargin(x);
    const z=land.fordTrailZ(x)+offset;
    if(Math.abs(x-land.streamX(z))<land.streamWidth(z)+1.25)continue;
    const patch=.5+.5*Math.cos(2.5*x-.45*Math.sin(4.1*x));
    if(random()>.35+.57*patch)continue;
    const size=.024+.066*random()**1.6;
    settle(z,x,size,true);
  }
  for(const [index,group] of bands){
    const high=[],low=[],z=(index+.5)*18,x=land.trailX(z);
    let highEnd=0,lowStart=Infinity,lowEnd=0;
    for(let kind=0;kind<families.length;kind++){
      const stones=group[kind];
      if(!stones.length)continue;
      const base=new T.InstancedMesh(forms[kind][0],paints[0],stones.length);
      stones.forEach(({matrix,tint},i)=>{
        base.setMatrixAt(i,matrix);base.setColorAt(i,tint);
        const e=matrix.elements,scale=Math.hypot(e[0],e[1],e[2]);
        const switchAt=switchBase+switchScale*scale,offset=Math.hypot(e[12]-x,e[14]-z)+recropDistance;
        const horizon=Math.max(switchAt+transition,T.MathUtils.clamp(870*scale,56,168));
        highEnd=Math.max(highEnd,switchAt+transition+offset);
        lowStart=Math.min(lowStart,switchAt-offset);lowEnd=Math.max(lowEnd,1.24*horizon+offset);
      });
      base.name='Pack trail '+families[kind];base.userData.trailTile=index;
      base.computeBoundingSphere();base.receiveShadow=true;
      const remote=new T.InstancedMesh(forms[kind][1],paints[1],0);
      remote.count=stones.length;remote.instanceMatrix=base.instanceMatrix;remote.instanceColor=base.instanceColor;
      remote.boundingSphere=base.boundingSphere;remote.name=base.name+' distant';remote.receiveShadow=true;
      scene.add(base,remote);high.push(base);low.push(remote);
    }
    tiles.push({high,low,x,z,highEnd,lowStart,lowEnd});
  }
  let seenX=Infinity,seenZ=Infinity;
  function update(player,force=false){
    eye.value.set(player.x,player.z);
    if(!force&&Math.hypot(player.x-seenX,player.z-seenZ)<recropDistance)return;
    seenX=player.x;seenZ=player.z;
    for(const t of tiles){
      const d=Math.hypot(player.x-t.x,player.z-t.z);
      for(const m of t.high)m.visible=d<t.highEnd;
      for(const m of t.low)m.visible=d>t.lowStart&&d<t.lowEnd;
    }
  }
  function native(visit){
    for(const t of tiles){for(const m of t.high)m.visible=true;for(const m of t.low)m.visible=false;}
    try{return visit();}finally{update({x:seenX,z:seenZ},true);}
  }
  return {top:contacts.top,trace:contacts.trace,update,native};
}
