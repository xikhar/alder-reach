import * as T from 'three';
import reach from './vegetation-lod.json' with {type:'json'};
import {reservePlantDraws} from './plant-pools.js';
import {screenPlantDetail} from './plant-detail.js';
import {model} from './fauna.js';
import {createButterflyFlight} from './butterfly-flight.js';
import {windGLSL,windAt} from './weather.js';

import {createBerrySites,hash,visitRagwort} from './berry-sites.js';
const TAU=2*Math.PI;
const berryBand=reach.berryDetail,streamStep=5;
const [berryNear,berryFar]=berryBand;
const berryMid=(berryNear+berryFar)*.5;
export async function createUnderstory(scene,land,plants){
  const library=await model('understory'),group=new T.Group();group.name='Woodland understory';scene.add(group);
  const time={value:0},observer={value:new T.Vector3()},pose=new T.Object3D(),batches={};
  function scatter(name,capacity){
    const prototype=library.scene.getObjectByName(name),mesh=prototype.children[0];
    const pigment=new T.MeshStandardMaterial({vertexColors:true,roughness:.80,side:T.DoubleSide});
    pigment.name=name+' pigment';
    const berry=name!=='Ragwort',detailed=name==='Bilberry';
    const outer=name==='Ragwort'?reach.field.ragwort:reach.field.bilberry;
    pigment.onBeforeCompile=shader=>{
      shader.uniforms.seasonTime=time;shader.uniforms.shrubEye=observer;
      shader.vertexShader='uniform vec3 shrubEye;uniform float seasonTime;\n'+windGLSL+shader.vertexShader.replace('#include <begin_vertex>',`
        #include <begin_vertex>
        float flexibility=pow(clamp(position.y/.56,0.,1.),2.);
        vec2 offset=windOffset(instanceMatrix[3].xz+position.xz,seasonTime);
        transformed.xz+=offset*flexibility*${name==='Ragwort'?'0.60':'0.30'};
        ${name==='Bilberry'?'':`float stature=1.-smoothstep(${outer.map(v=>v.toFixed(1)).join(',')},distance(shrubEye.xz,instanceMatrix[3].xz));
        transformed*=vec3(sqrt(stature),stature,sqrt(stature));`}
      `);
      if(berry)screenPlantDetail(shader,observer,berryBand,detailed);
    };
    pigment.customProgramCacheKey=()=>name+'-gust';
    const batch=new T.InstancedMesh(mesh.geometry,pigment,capacity);
    batch.name=name+' patches';batch.count=0;batch.receiveShadow=true;batch.castShadow=name==='Bilberry';
    if(berry)batch.userData.nativeShrubRange=detailed?[0,berryMid]:[berryMid,outer[1]];
    if(detailed){
      batch.customDepthMaterial=new T.MeshDepthMaterial({depthPacking:T.RGBADepthPacking});
      batch.customDepthMaterial.onBeforeCompile=pigment.onBeforeCompile;
      batch.customDepthMaterial.customProgramCacheKey=pigment.customProgramCacheKey;
    }
    if(name!=='Bilberry')batch.userData.groundcoverFade=outer;
    group.add(batch);batches[name]=batch;
  }
  scatter('Bilberry',160);scatter('BilberryLow',550);scatter('Ragwort',144);
  const leafTint=new T.Color();
  function put(name,x,z,rotation,scale){
    const b=batches[name];
    if(b.count===b.instanceMatrix.count)reservePlantDraws([b],b.count*2);
    pose.position.set(x,land.height(x,z)-.015,z);
    pose.rotation.set(0,rotation,0);pose.scale.setScalar(scale);
    if(name.startsWith('Bilberry')){
      const rim=z< -83&&z> -108&&Math.abs(x)<15;
      if(rim)pose.scale.set(scale*1.18,scale*.89,scale*1.18);
      const meadowEdge=x>8&&x<17&&z< -31&&z> -37;
      if(meadowEdge)leafTint.setRGB(.32,.40,.31);
      else leafTint.setRGB(rim?.38:1,rim?.48:1,rim?.51:1);
      b.setColorAt(b.count,leafTint);
    }
    pose.updateMatrix();
    b.setMatrixAt(b.count++,pose.matrix);
  }
  const visitBerries=createBerrySites(land);
  let px=-1e4,pz=-1e4;
  function populate(eye){
    for(const b of Object.values(batches))b.count=0;
    function shrub(x,z,a,s){
      const d=Math.hypot(x-eye.x,z-eye.z);
      if(d<=berryFar+streamStep+.1)put('Bilberry',x,z,a,s);
      if(d>=berryNear-streamStep-.1)put('BilberryLow',x,z,a,s);
    }
    visitBerries(eye,61,shrub);
    visitRagwort(land,eye,reach.field.ragwort[1]+streamStep+1,(x,z,a,s)=>put('Ragwort',x,z,a,s));
    for(const b of Object.values(batches)){b.instanceMatrix.needsUpdate=true;if(b.instanceColor)b.instanceColor.needsUpdate=true;b.computeBoundingSphere();}
    px=eye.x;pz=eye.z;
  }

  const flight=createButterflyFlight(land);
  const insects=flight.sites.map(site=>{
    const body=library.scene.getObjectByName(site.kind).clone(true);
    group.add(body);body.name=site.id;body.scale.setScalar(site.scale);
    body.traverse(ob=>{if(ob.isMesh){ob.material=ob.material.clone();ob.material.side=T.DoubleSide;ob.receiveShadow=true;}});
    const left=body.children.find(ob=>ob.name.includes('left')),right=body.children.find(ob=>ob.name.includes('right'));
    for(const wing of [left,right]){
      // Pass light from the opposite hemisphere through the thin pigmented
      // membrane. The direct-light record already includes the canopy shadow.
      wing.material.customProgramCacheKey=()=>'butterfly wing membrane';
      wing.material.onBeforeCompile=shader=>{
        const indirect='irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );';
        const direct=T.ShaderChunk.lights_fragment_begin.replace(indirect,
          indirect+'\nirradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], -geometryNormal );').replaceAll(
          'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );',
          `RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
          reflectedLight.directDiffuse +=  max(0., -dot(geometryNormal, directLight.direction)) * directLight.color * BRDF_Lambert(material.diffuseColor);`);
        shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_begin>',direct)
          .replace('#include <color_fragment>','#include <color_fragment>\ndiffuseColor.rgb *= .50;');
      };
    }
    return {site,body,left,right,pose:{position:body.position,rotation:body.quaternion,left:0,right:0},launch:null};
  });
  const leaf=library.scene.getObjectByName('FallenLeaf').children[0];
  const leafMat=new T.MeshLambertMaterial({vertexColors:true,side:T.DoubleSide});
  const leaves=new T.InstancedMesh(leaf.geometry,leafMat,18);leaves.name='Windblown birch leaves';leaves.frustumCulled=false;leaves.count=0;group.add(leaves);
  const fallen=[],wind=new T.Vector2();
  let spawnAt=1.2,generation=0;
  function leafUpdate(dt,clock,eye){
    if(clock>spawnAt){
      spawnAt=clock+1.7+1.1*hash(generation,1,7);generation++;
      const available=plants.trees.filter(t=>!t.removed&&t.type==='birch'&&Math.hypot(eye.x-t.x,eye.z-t.z)<17);
      if(available.length){
        const tree=available[Math.floor(hash(generation,18,4)*available.length)];
        const a=TAU*hash(generation,9,4);const pos=new T.Vector3(tree.x+1.6*Math.cos(a),tree.y+3.8+3.2*hash(generation,0,7),tree.z+1.6*Math.sin(a));
        fallen.push({pos,age:0,angle:a,landed:false});
      }
    }
    leaves.count=0;
    for(let i=fallen.length-1;i>=0;i--){
      const l=fallen[i];l.age+=dt;
      if(l.age>19||l.pos.distanceToSquared(eye)>36**2){fallen.splice(i,1);continue;}
      const p=l.pos;
      if(!l.landed){
        windAt(p.x,p.z,clock,wind);
        p.x+=(wind.x*3.4+.23*Math.cos(clock*2.7+l.angle))*dt;
        p.z+=(wind.y*3.4+.16*Math.sin(clock*3.25+l.angle))*dt;
        p.y-=dt*(.46+.17*Math.cos(clock*3.14+l.angle));
        const floor=land.height(p.x,p.z)+.012;
        if(p.y<floor){p.y=floor;l.landed=true;}
      }
      pose.position.copy(p);pose.rotation.set(l.landed?.10:Math.sin(clock*3.1+l.angle)*1.12,l.angle+clock*(l.landed?0:.45),l.landed?.12:Math.sin(clock*2.84+l.angle)*.83);
      pose.scale.setScalar(Math.min(1,(19-l.age)*.9));pose.updateMatrix();
      if(leaves.count<18)leaves.setMatrixAt(leaves.count++,pose.matrix);
    }
    leaves.instanceMatrix.needsUpdate=true;
  }
  return {insects,flight,update(dt,clock,eye,dusk){
    observer.value.copy(eye);time.value=clock;if(Math.hypot(eye.x-px,eye.z-pz)>streamStep)populate(eye);
    for(const insect of insects){
      const {body,site,pose}=insect;
      const distance=Math.hypot(site.x-eye.x,site.z-eye.z);
      let t=clock;
      if(site.rim){
        if(insect.launch===null&&distance<10&&dusk<.8)insect.launch=clock;
        t=insect.launch===null?0:clock-insect.launch;
        if(t>=site.period){
          if(distance>10){insect.launch=null;t=0}
          else{t%=site.period;insect.launch=clock-t;}
        }
      }
      body.visible=distance<(site.rim?56:38)&&dusk<.8;
      if(!body.visible)continue;
      flight.sample(site,t,pose);
      insect.left.rotation.z=pose.left;insect.right.rotation.z=pose.right;
    }
    leafUpdate(dt,clock,eye);
  }};
}
