import * as T from 'three';
import {stoneContact} from './stone-contact.js';
import {weatheredStone} from './stone-surface.js';
import solids from './pebble-prototypes.json';

const types=['BlueSlate','Gneiss','RiverBasalt','CleavedGreywacke'];
const natural=['#726e68','#958b76','#817c72','#606569','#978574','#74786a','#80756c','#626d73'];
const inundated=['#5d5e62','#726858','#524e4a','#5d5d5e','#655851','#51584f','#686059','#545d62'];
function geometry(asset) {
  const g=new T.BufferGeometry();
  g.setAttribute('position',new T.Float32BufferAttribute(asset.p,3));
  g.setAttribute('normal',new T.Float32BufferAttribute(asset.n,3));
  g.setAttribute('color',new T.Float32BufferAttribute(asset.c,3));g.setIndex(asset.i);return g;
}
// Evaluate the damp band across the surface, including partly submerged fracture faces.
function pigment(far,scan) {
  const m=new T.MeshStandardMaterial({name:far?'River shingle distant':'River shingle',color:0xffffff,vertexColors:true,roughness:.65});
  m.onBeforeCompile=shader=>{
    weatheredStone(shader,scan,'stoneWorld','wet');
    shader.vertexShader='varying vec3 mineral;varying vec3 stoneWorld;varying float stoneId;\n'+shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
      mineral=position;
      stoneWorld=(instanceMatrix*vec4(position,1.)).xyz;
      stoneId=fract(4375.2*sin(dot(instanceMatrix[3].xz,vec2(.613,.321))));
    `);
    shader.fragmentShader='varying vec3 mineral;varying vec3 stoneWorld;varying float stoneId;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      float north=-stoneWorld.z;
      float water=3.8*smoothstep(16.,76.,north)-85.*(1.-exp(-pow(max(0.,north-88.)/108.,1.15)))-.001*north-1.2-.22*sin(.028*north);
      float wet=1.-smoothstep(.045,.34,stoneWorld.y-water);
      float bands=sin(dot(mineral,vec3(6.2,11.5,-5.3))+2.6*sin(mineral.z*1.9)+7.2*stoneId);
      float vein=smoothstep(.976,.999,bands)*smoothstep(.68,.94,stoneId);
      diffuseColor.rgb*=mix(1.02,.84,wet)*(.98+.044*bands);
      diffuseColor.rgb+=vec3(.026,.023,.022)*vein;
    `);
    shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
      roughnessFactor=mix(.74+.12*stoneId,.23+.09*stoneId,wet);
    `);
    shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`
      vec3 mirror=reflect(normalize(stoneWorld-cameraPosition),inverseTransformDirection(normal,viewMatrix));
      float sky=smoothstep(-.08,.43,mirror.y);
      float glancing=pow(1.-clamp(dot(normal,normalize(vViewPosition)),0.,1.),2.);
      float exposed=smoothstep(-.12,.84,inverseTransformDirection(normal,viewMatrix).y);
      outgoingLight+=diffuseColor.rgb*vec3(.114,.133,.159)*exposed*(.66+.54*stoneId);
      outgoingLight+=vec3(.063,.071,.089)*(.19+.81*sky)*wet*(.26+.79*glancing);
      #include <opaque_fragment>
    `);
  };
  m.customProgramCacheKey=()=>far?'shingleFar':'shingleNear';return m;
}
// Index the real high-detail faces only around the walkable ford. The native
// Bullet shell uses the same bounds and exported transforms in landscape-physics.py.
export function addShingle(scene,land,random,scan){
  const forms=types.map(t=>[geometry(solids[t]),geometry(solids[t+'Low'])]);
  const paints=[pigment(false,scan),pigment(true,scan)];
  const ob=new T.Object3D(),color=new T.Color(),tiles=new Map(),ranges=[];
  const floor=stoneContact(.48,[12,30,-50,-25]);
  const wetColor=new T.Color(),up=new T.Vector3(0,1,0),normal=new T.Vector3(),turn=new T.Quaternion();
  function place(x,z,r,width,flatten,stone=null,heading=0,burial=0){
    const kind=stone??Math.floor(random()*types.length),key=Math.floor(x/15)+','+Math.floor(z/13);
    if(!tiles.has(key))tiles.set(key,types.map(()=>[]));
    const y=land.height(x,z),pace=Math.max(.065,r*.68);
    const sx=(land.height(x+pace,z)-land.height(x-pace,z))/(2*pace);
    const sz=(land.height(x,z+pace)-land.height(x,z-pace))/(2*pace);
    normal.set(-sx*.78+(random()-.5)*.17,1,-sz*.78+(random()-.5)*.19).normalize();
    ob.quaternion.setFromUnitVectors(up,normal);
    turn.setFromAxisAngle(up,stone==null?random()*Math.PI*2:heading);
    ob.quaternion.multiply(turn);
    const contact=x>=13.5&&x<=28.5&&z>=-48&&z<=-27;
    const fordTread=contact?1.-T.MathUtils.smoothstep(Math.abs(z-land.fordTrailZ(x)),.45,1.02):0;
    ob.position.set(x,y-r*flatten*(.075+.24*random()+burial+.45*fordTread),z);
    ob.scale.set(r*width,r*flatten,r*(.67+.28*random()));ob.updateMatrix();
    const pick=Math.floor(random()*natural.length);
    const wet=T.MathUtils.clamp((land.waterY(x,z)+.32-y)/.34,0,1);
    color.set(natural[pick]);
    color.lerp(wetColor.set(inundated[pick]),wet*.67);
    color.multiplyScalar(.78+.49*random());
    // The steep dry bluff has soil and roots above the strandline.
    if(contact && y>land.waterY(x,z)+.78 && (sx*sx+sz*sz>.72 || y>land.waterY(x,z)+1.07))return;
    const detailEnd=2*Math.max(9+ob.scale.x*43,contact?22:0);
    tiles.get(key)[kind].push([ob.matrix.clone(),color.clone(),detailEnd*detailEnd]);
    if(contact)floor.add(forms[kind][0],ob.matrix);
  }
  // Gravel tongues deposition follows every bend. A joint distribution keeps the large cobbles in the
  // exposed strandline, and finer material in the inundated bed and the dry upper bank.
  for(let z=-167;z<121;z+=.247){
    for(const sign of [-1,1]){
      const channel=land.streamX(z),w=land.streamWidth(z);
      let width=1.1+.42*Math.sin(z*.125+sign*2.3)+.25*Math.sin(z*.52+.3*sign);
      const ford=z>-51&&z<-30;
      if(sign===-1 && z> -50 && z< -26.5)continue;

      const strips=ford?10:7;
      for(let j=0;j<strips;j++){
        const zz=z+(random()-.5)*.22;
        const a=(j+.55*random())/(strips-1),offset=(-1.16+a*2.36)*width;
        if(random()<.12+Math.max(0,a-.76)*1.3)continue;
        const x=channel+sign*(w+offset+.12*Math.sin(z*.61+sign));
        const crest=1-Math.min(1,Math.abs(a-.58)*2.5);
        const r=(.047+.098*random()**.7+.093*crest)*(ford?1.10:.94);
        place(x,zz,r,.87+.53*random(),.48+.46*random());
      }
    }
    // A lower density coarse bed visible in the moving water.
    for(let j=0;j<4;j++){
      const zz=z+random()*.243,x=land.streamX(zz)+(random()-.5)*1.42*land.streamWidth(zz);
      place(x,zz,.057+.118*random()**1.6,1.10+random()*.43,.45+.28*random());
    }
  }
  // A coarse imbricated lag collects in the lee of the gravel point. Finer
  // spalls fill the interstices. The passage through the ford exposes the dark bed.
  const bar=[];
  function fits(x,z,r){
    for(const clast of bar)if((x-clast.x)**2+(z-clast.z)**2<(r+clast.r)**2)return false;
    bar.push({x,z,r});return true;
  }
  const west=z=>land.streamX(z)-land.streamWidth(z);
  for(const [center,offset,spread] of [
    [-49.4,.10,.91],[-47.8,-.25,.81],[-46.3,.29,.72],[-44.9,-.01,.97],[-43.4,-.21,.93],
    [-42.0,.04,1.07],[-40.3,.29,.71],[-39.0,-.13,.75],[-37.6,.20,.92],[-36.2,-.25,.65],
    [-34.7,-.19,.83],[-33.2,.22,1.05],[-31.9,-.08,.91],[-30.1,.29,.80],[-28.3,-.18,.75],[-26.9,.10,.74]
  ]){
    const strike=.05+random()*.73;
    for(let i=0;i<31;i++){
      const theta=random()*Math.PI*2,rho=Math.sqrt(random());
      const z=center+Math.sin(theta)*rho*1.02*spread;
      const x=west(z)-offset+Math.cos(theta)*rho*.70*spread;
      const r=(i<6?.21+random()*.14:.10+random()*.13)*spread;
      if(!fits(x,z,r*.77))continue;
      const type=random(),kind=type<.24?0:type<.55?1:type<.86?2:3;
      const tread=Math.abs(z-land.fordTrailZ(x))<.62;
      place(x,z,r,1.0+random()*.63,(kind===2?.79:.57)+.19*random(),kind,
        strike+Math.PI*.5+(random()-.5)*.93,tread?.25:0);
    }
  }
  // Overlapping lobes drape the last metre of bank on the outside of the bend.
  // Each lobe has its own long axis and grain size. Silt remains in the gaps.
  for(const [center,offset,length,radius] of [
    [-48.1,.61,1.5,.22],[-46.3,-.76,1.45,.24],[-44.0,.77,1.64,.27],[-42.3,-.65,1.39,.22],
    [-40.4,.73,1.48,.24],[-39.2,-.67,1.32,.22],[-37.8,.69,1.28,.21],[-36.41,-.73,1.49,.22],
    [-34.93,.68,1.42,.26],[-33.0,-.62,1.72,.28],[-31.5,.82,1.84,.25],[-29.4,-.84,1.7,.28],[-27.4,.58,1.3,.22]
  ]){
    const strike=.70+random()*.68;
    for(let i=0;i<51;i++){
      const u=random()*2-1,z=center+u*length;
      const x=west(z)-offset+.28*u+(random()-.5)*1.52*Math.sqrt(1-u*u);
      const r=radius*(.43+random()**1.2*.95);
      if(!fits(x,z,r*.66))continue;
      const type=random(),kind=type<.17?0:type<.52?1:type<.87?2:3;
      place(x,z,r,1.05+.44*random(),.57+.33*random(),kind,strike+(random()-.5)*1.6);
    }
  }
  // Pebble-sized cobbles collect on the damp hinge of the shelf, in front
  // of the coarse lobes. Grain size falls off towards the path and deep trough.
  for(let i=0;i<1450;i++){
    const z=-49.8+random()*23.1;
    const offset=-.48+random()*1.26+.11*Math.sin(z*1.2);
    const x=west(z)-offset,r=.103+.133*random()**.68;
    const tread=Math.abs(z-land.fordTrailZ(x))<.56;
    if(!fits(x,z,r*.65))continue;
    const type=random(),kind=type<.17?0:type<.52?1:type<.91?2:3;
    place(x,z,r,1.04+.44*random(),.65+.30*random(),kind,.80+.58*Math.sin(z*.63)+random()*.93,tread?.25:0);
  }
  // Small deposits dissipate into single chips on wet sand and the dry bank.
  for(let i=0;i<2450;i++){
    const z=-50+random()*23.5,t=random();
    const offset=-1.13+t*2.18+.18*Math.sin(z*.77);
    const x=west(z)-offset,r=.031+random()**1.6*.106;
    if(!fits(x,z,r*.66))continue;
    place(x,z,r,.88+.79*random(),.36+.32*random());
  }
  for(const [key,groups] of tiles)for(let kind=0;kind<types.length;kind++){
    const points=groups[kind];if(!points.length)continue;
    const [gx,gz]=key.split(',').map(Number);
    const packs=[];
    for(let lod=0;lod<2;lod++){
      const batch=new T.InstancedMesh(forms[kind][lod],paints[lod],points.length);
      for(let i=0;i<points.length;i++){batch.setMatrixAt(i,points[i][0]);batch.setColorAt(i,points[i][1]);}
      batch.name='Channel and path cobbles';batch.receiveShadow=true;batch.computeBoundingSphere();scene.add(batch);packs.push(batch);
    }
    const x=gx*15+7.5,z=gz*13+6.5;
    let tileEnd=0;
    for(const [matrix,,detailSquared] of points){
      const e=matrix.elements;
      tileEnd=Math.max(tileEnd,Math.hypot(e[12]-x,e[14]-z)+Math.max(97,Math.sqrt(detailSquared)));
    }
    ranges.push({packs,points,x,z,tileEnd});
  }
  let lastX=Infinity,lastZ=Infinity;
  function update(p){
    if((p.x-lastX)**2+(p.z-lastZ)**2<2.5)return;
    lastX=p.x;lastZ=p.z;
    for(const {packs,points,x,z,tileEnd} of ranges){
      const dist=Math.hypot(x-p.x,z-p.z);const counts=[0,0];
      if(dist<=tileEnd){
        for(const [matrix,color,detailSquared] of points){
          const m=matrix.elements;
          const d=(m[12]-p.x)**2+(m[14]-p.z)**2;
          if(d>Math.max(97*97,detailSquared))continue;
          const lod=d<detailSquared?0:1,n=counts[lod]++;
          packs[lod].setMatrixAt(n,matrix);packs[lod].setColorAt(n,color);
        }
      }
      for(let i=0;i<2;i++){
        const batch=packs[i];batch.count=counts[i];batch.visible=counts[i]>0;
        if(batch.visible){batch.instanceMatrix.needsUpdate=true;batch.instanceColor.needsUpdate=true;}
      }
    }
  }
  return {update,top:floor.top};
}
