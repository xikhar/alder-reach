import {createTroutSchool} from './trout.js';
import { createHearthEffects } from './fire.js';
import { windAt } from './weather.js';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneRig } from 'three/addons/utils/SkeletonUtils.js';

const up = new T.Vector3(0, 1, 0);
const clamp = T.MathUtils.clamp;
const tau = Math.PI * 2;
const cutHeight = 0.57;
const horizontal = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const timber = new T.MeshStandardMaterial({ color: 0xc59a66, roughness: 1, side: T.DoubleSide });
const rings = new T.MeshStandardMaterial({ color: 0x997248, roughness: 1, side: T.DoubleSide });

function cylinder(a, b, r, material, r2 = r, sides = 12) {
  const delta = new T.Vector3().subVectors(b, a);
  const o = new T.Mesh(new T.CylinderGeometry(r2, r, delta.length(), sides), material);
  o.position.copy(a).lerp(b, .5);
  o.quaternion.setFromUnitVectors(up, delta.normalize());
  return o;
}

function cap(radius) {
  const root = new T.Group();
  const face = new T.Mesh(new T.CircleGeometry(radius, 20), timber);
  face.rotation.x = -Math.PI / 2;
  root.add(face);
  for (const fraction of [.34, .62, .86]) {
    const ring = new T.Mesh(new T.RingGeometry(radius * fraction, radius * (fraction + .018), 20), rings);
    ring.rotation.x = face.rotation.x;
    ring.position.y = .001;
    root.add(ring);
  }
  return root;
}

// Clip individual trunk triangles in metre-scale tree coordinates. Vertex records retain
// original local positions, normals, UVs and pigment so bark follows every exposed edge.
function splitPolygon(poly,dist) {
  const inside=[],outside=[];
  for(let i=0;i<poly.length;i++){
    const a=poly[i],b=poly[(i+1)%poly.length],da=dist(a),db=dist(b);
    (da>=0?inside:outside).push(a);
    if((da<0)!==(db<0)){
      const f=da/(da-db),v=a.map((x,j)=>x+(b[j]-x)*f);
      inside.push(v);outside.push(v);
    }
  }
  return [inside,outside];
}

function subtract(polygon,planes) {
  const kept=[];
  let candidate=polygon;
  for(const dist of planes) {
    const [inside,outside]=splitPolygon(candidate,dist);
    if(outside.length>2)kept.push(outside);
    candidate=inside;
    if(candidate.length<3)break;
  }
  return kept;
}

function prepareTrunk(tree,record){
  tree.updateWorldMatrix(true,true);
  const base=new T.Matrix4().makeTranslation(-record.x,-record.y,-record.z);
  const parts=[];
  let maxRadiusSq=0;
  tree.traverse(mesh=>{
    if(!mesh.isMesh||!(mesh.userData.part==='trunk'||/trunk/i.test(mesh.name)))return;
    const g=mesh.geometry,xform=base.clone().multiply(mesh.matrixWorld),pos=g.attributes.position;
    const channels=['position','normal','uv','uv1','color'].filter(key=>g.attributes[key]);
    const coords=[];
    let nearest=Infinity;
    for(let i=0;i<pos.count;i++){
      const p=new T.Vector3().fromBufferAttribute(pos,i).applyMatrix4(xform);
      nearest=Math.min(nearest,Math.abs(p.y-cutHeight));const data=p.toArray();
      for(const key of channels){
        const a=g.attributes[key];
        for(let k=0;k<a.itemSize;k++)data.push(a.getComponent(i,k));
      }
      coords.push(data);
    }
    for(const p of coords)if(Math.abs(p[1]-cutHeight)<nearest+.06)maxRadiusSq=Math.max(maxRadiusSq,p[0]**2+p[2]**2);
    parts.push({mesh,g,channels,coords});
  });
  return {parts,radius:maxRadiusSq?clamp(Math.sqrt(maxRadiusSq),record.radius*.65,record.radius*1.7):record.radius};
}

function cutGeometry(part,cut,stump=false) {
  const {g,coords,channels}=part;
  const arrays=Object.fromEntries(channels.map(key=>[key,[]]));
  const result=new T.BufferGeometry(), r=cut.radius, start=r-cut.frontDepth;
  const s=p=>p[0]*cut.face.x+p[2]*cut.face.z;
  const operations=[];
  if(cut.frontDepth)operations.push([p=>s(p)-start,p=>p[1]-cutHeight+.06*(s(p)-start),p=>cutHeight+.51*(s(p)-start)-p[1]]);
  if(cut.backDepth)operations.push([p=>-r+cut.backDepth-s(p),p=>p[1]-cutHeight+.008,p=>cutHeight+.044-p[1]]);
  if(stump)operations.push([p=>p[1]-cutHeight]);
  else if(cut.trim>0)operations.push([p=>cut.trim-p[1]]);
  const count=g.index?.count??coords.length;
  for(const batch of g.groups.length?g.groups:[{start:0,count,materialIndex:0}]){
    const batchStart=arrays.position.length/3;
    for(let i=batch.start;i<batch.start+batch.count;i+=3){
      const triangle=[0,1,2].map(k=>coords[g.index?g.index.getX(i+k):i+k]);
      let pieces=[triangle];
      for(const planes of operations)pieces=pieces.flatMap(poly=>subtract(poly,planes));
      for(const poly of pieces)for(let j=1;j<poly.length-1;j++)for(const v of [poly[0],poly[j],poly[j+1]]){
        let n=3;
        for(const key of channels){
          const size=g.attributes[key].itemSize;
          for(let k=0;k<size;k++)arrays[key].push(v[n++]);
        }
      }
    }
    const length=arrays.position.length/3-batchStart;
    if(length)result.addGroup(batchStart,length,batch.materialIndex);
  }
  for(const key of channels)result.setAttribute(key,new T.Float32BufferAttribute(arrays[key],g.attributes[key].itemSize));
  if(!result.attributes.normal)result.computeVertexNormals();
  result.computeBoundingSphere();result.computeBoundingBox();
  return result;
}
function carve(cut){
  for(const part of cut.parts){
    if(part.mesh.geometry!==part.g)part.mesh.geometry.dispose();
    part.mesh.geometry=cutGeometry(part,cut);
  }
}
function notchFaces(cut) {
  if (cut.faces) {
    cut.faces.removeFromParent();
    cut.faces.geometry.dispose();
  }
  const r = cut.radius;
  const forward = cut.face;
  const right = new T.Vector3(-forward.z, 0, forward.x);
  const verts = [];
  function strip(start, end, yAt) {
    const point = (s, sign) => right.clone().multiplyScalar(sign * Math.sqrt(Math.max(0, r*r - s*s)))
      .addScaledVector(forward, s).setY(yAt(s)).toArray();
    for (let i = 0; i < 16; i++) {
      const a = T.MathUtils.lerp(start, end, i / 16);
      const b = T.MathUtils.lerp(start, end, (i + 1) / 16);
      verts.push(...point(a,-1), ...point(a,1), ...point(b,1), ...point(a,-1), ...point(b,1), ...point(b,-1));
    }
  }
  const start = r - cut.frontDepth;
  strip(start, r, s => cutHeight - (s - start)*.06);
  strip(start, r, s => cutHeight + (s - start)*.51);
  if (cut.back) {
    strip(-r, -r + cut.backDepth, () => cutHeight - .008);
    strip(-r, -r + cut.backDepth, () => cutHeight + .044);
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position',new T.Float32BufferAttribute(verts,3)); g.computeVertexNormals();
  cut.faces = new T.Mesh(g,timber);
  cut.faces.position.set(cut.record.x,cut.record.y,cut.record.z);
  cut.parent.add(cut.faces);cut.faces.updateWorldMatrix(true,false);
}

function paintKit(kit) {
  for(const name of ['ChopStump','RoundLog','Firewood','FireRing','WoodRack','Axe','Rod']){
    kit.scene.getObjectByName(name).traverse(part=>{
      if(!part.isMesh)return;
      const material=part.material.clone();
      // Narrow streaks follow the wood fibers; the hearth uses isotropic stone flecks.
      const coords=name==='FireRing'?'vGrain * 24.':
        ['RoundLog','Firewood'].includes(name)?'vGrain * vec3(5.,135.,135.)':'vGrain * vec3(135.,5.,135.)';
      material.onBeforeCompile=shader=>{
        shader.vertexShader='varying vec3 vGrain;\n'+shader.vertexShader;
        shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvGrain=position;');
        shader.fragmentShader=`varying vec3 vGrain;
          float grainHash(vec3 p){p=fract(p*.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);}
          float grainField(vec3 p){vec3 c=floor(p),f=fract(p);f=f*f*(3.-2.*f);
            return mix(mix(mix(grainHash(c),grainHash(c+vec3(1,0,0)),f.x),mix(grainHash(c+vec3(0,1,0)),grainHash(c+vec3(1,1,0)),f.x),f.y),
                     mix(mix(grainHash(c+vec3(0,0,1)),grainHash(c+vec3(1,0,1)),f.x),mix(grainHash(c+vec3(0,1,1)),grainHash(c+1.),f.x),f.y),f.z);}
          `+shader.fragmentShader;
        shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
          vec3 g=${coords};
          float mark=grainField(g+.18*sin(vGrain.yzx*5.))*.66+grainField(g*.31)*.34;
          diffuseColor.rgb*=.78+.44*mark;
          ${name==='FireRing'?`
          float soot=1.-smoothstep(.39,.58,length(vGrain.xz));
          float mineral=grainField(vGrain*96.)+.4*grainField(vGrain*249.);
          diffuseColor.rgb*=mix(.48,1.32,smoothstep(.36,.91,mineral))*(1.-.62*soot);
          diffuseColor.rgb+=vec3(.066,.057,.041)*smoothstep(.80,.89,mineral)*(1.-soot);
          `:''}`);
      };
      material.customProgramCacheKey=()=> 'field-kit-grain:'+coords;part.material=material;
    });
  }
}
export async function createCamp(ctx) {
  const {scene,camera,land,plants,player,tool,sound,notify,setDusk}=ctx;
  const loader=new GLTFLoader();
  const [kit,tackle]=await Promise.all(['art/camp-kit.glb','models/stream-tackle.glb'].map(path=>loader.loadAsync(import.meta.env.BASE_URL+path)));
  paintKit(kit);
  const group=new T.Group(); group.name='River camp'; scene.add(group);
  const model = name => {
    const source=kit.scene.getObjectByName(name);
    if (!source) throw Error('Missing camp mesh '+name);
    return cloneRig(source);
  };
  const ground = (x,z) => new T.Vector3(x,land.contactHeight(x,z),z);
  const streamCenter=land.streamX(-25);
  let shoreX=streamCenter;
  for(let i=0;i<55&&land.isWater(shoreX,-25);i++) shoreX-=.5;
  const shore=ground(shoreX-.65,-25);
  let campX=streamCenter-8;
  while(land.isWater(campX+1,-25)&&campX>streamCenter-35) campX-=.5;
  const location=ground(campX,-25);
  function place(name,x,z,angle=0) {
    const o=model(name);o.position.copy(ground(x,z));o.rotation.y=angle;group.add(o);return o;
  }
  const stump=place('ChopStump',campX-1.5,-24);
  const pit=place('FireRing',campX+1.6,-25.8);
  const rack=place('WoodRack',campX-1.2,-27.2,Math.PI/2);
  const state={fish:0,cooked:0,stacked:0,carried:null,fire:false,fishing:'idle',tension:0,stock:0,progress:0,cooking:0,felled:0,bucked:0,split:0};
  const loose=[], cuts=[], cutByTree=new Map(), chips=[];
  let block=null, carry=null, cookFish=null, cookDuration=0, fireTick=0, lastHit=-1, time=0;

  function item(kind,pos,angle=0) {
    const o=model(kind==='round'?'RoundLog':'Firewood');
    o.position.copy(pos);
    o.position.y+=kind==='round'?.21:.09;
    o.rotation.y=angle;
    group.add(o);
    const rec={kind,o};loose.push(rec);return rec;
  }
  item('round',ground(stump.position.x-.75,stump.position.z+.14),.35);

  const grip=model('Grip'), axe=model('Axe'), rod=model('Rod'), held=model('RoundLog'), splitHeld=model('Firewood');
  const view=new T.Group();view.name='Camp action hands'; camera.add(view);
  view.add(grip,axe,rod,held,splitHeld);view.visible=false;
  const gripMixer=new T.AnimationMixer(grip);
  const handClip=kit.animations.find(a=>a.name==='Grip_action');
  const handAction=handClip&&gripMixer.clipAction(handClip).setLoop(T.LoopOnce,1);
  let swing=0, handTime=0, rodRecover=0;
  const sleeve=model('JacketSleeve');camera.add(sleeve);sleeve.visible=false;
  const bladeEdge=new T.Vector3(-.146,.25,0), elbow=new T.Vector3(.15,-.135,.301);
  const shoulder=new T.Vector3(.46,-.50,.04), poseAim=new T.Vector3(), sleeveAxis=new T.Vector3();
  const contactRay=new T.Raycaster();
  let contact=null, swingKind='';
  const action=()=>{if(handAction)handAction.reset().play();};

  const chipGeo=new T.CylinderGeometry(.035,.09,.018,3);
  const chipMesh=new T.InstancedMesh(chipGeo,timber,80);chipMesh.count=0;chipMesh.frustumCulled=false;group.add(chipMesh);
  const chipPose=new T.Object3D();
  function spit(pos,dir,count) {
    for(let i=0;i<count;i++){
      if(chips.length>=80)chips.shift();
      const v=dir.clone().multiplyScalar(.8+Math.random()*1.7);
      v.x+=(Math.random()-.5)*2;v.z+=(Math.random()-.5)*2;v.y=1+Math.random()*2.3;
      chips.push({p:pos.clone(),v,life:4+Math.random()*6,roll:Math.random()*6,size:.45+Math.random()*.8,floor:null});
    }
  }
  function handleChips(dt){
    for(let i=chips.length-1;i>=0;i--){
      const c=chips[i];c.life-=dt;
      if(c.life<=0){chips.splice(i,1);continue;}
      if(c.floor===null) {
        c.v.y-=9.81*dt;c.p.addScaledVector(c.v,dt);c.roll+=dt*6;
        const floor=land.contactHeight(c.p.x,c.p.z)+.018;
        if(c.p.y<=floor){c.p.y=floor;c.floor=floor;}
      }
    }
    chipMesh.count=chips.length;
    for(let i=0;i<chips.length;i++){
      const c=chips[i];chipPose.position.copy(c.p);chipPose.rotation.set(c.floor===null?c.roll:0,c.roll,0);chipPose.scale.setScalar(c.size*Math.min(c.life,1));chipPose.updateMatrix();chipMesh.setMatrixAt(i,chipPose.matrix);
    }
    if(chips.length)chipMesh.instanceMatrix.needsUpdate=true;
  }

  const gaze=new T.Vector3();
  function score(pos,range,cone=.05) {
    const x=pos.x-player.x,z=pos.z-player.z,dist=Math.hypot(x,z);
    if(dist>range || Math.abs(pos.y-player.y)>3.7)return Infinity;
    camera.getWorldDirection(gaze);
    const facing=(x*gaze.x+z*gaze.z)/Math.max(.0001,dist*Math.hypot(gaze.x,gaze.z));
    if(dist>.8 && facing<cone)return Infinity;
    return dist*.32+(1-facing)*2;
  }
  function targetAxe(){
    let target=null,best=Infinity;
    const add=(kind,obj,p,r)=>{
      const s=score(p,r);if(s<best){target={kind,obj};best=s;}
    };
    if(block)add('block',block,stump.position,2.7);
    for(const cut of cuts){
      if(cut.phase==='upright')add('standing',cut.record,cut.record,cut.record.radius+2.65);
      else if(cut.phase==='landed')add('fallen',cut,cut.nextPos,3.2+cut.record.radius);
    }
    for(const tree of plants.trees){
      if(tree.removed||cutByTree.has(tree)||Math.abs(tree.x-player.x)>4.8||Math.abs(tree.z-player.z)>4.8)continue;
      add('standing',tree,tree,tree.radius+2.65);
    }
    return target;
  }
  function treeSide(cut) {
    const dx=player.x-cut.record.x,dz=player.z-cut.record.z;
    return (dx*cut.face.x+dz*cut.face.z)/Math.max(.01,Math.hypot(dx,dz));
  }
  function getCut(record) {
    if(cutByTree.has(record))return cutByTree.get(record);
    const tree=plants.removeTree(record);if(!tree)return null;
    for(const arrow of record.lodged??[])if(arrow.parent)tree.attach(arrow);
    const face=new T.Vector3(player.x-record.x,0,player.z-record.z).normalize();
    const {parts,radius}=prepareTrunk(tree,record);

    const cut={record,tree,face,front:0,back:0,parts,radius,frontDepth:0,backDepth:0,trim:0,phase:'upright',faces:null,parent:group,
      axis:new T.Vector3(face.z,0,-face.x),angle:0,speed:.093,sections:0,buckHits:0,nextPos:new T.Vector3()};
    cuts.push(cut);cutByTree.set(record,cut);return cut;
  }
  function setNextCut(cut){
    const h=cutHeight+1.03*(cut.sections+1);
    cut.nextPos.set(0,h-cutHeight,0).applyQuaternion(cut.pivot.quaternion).add(cut.pivot.position);
  }
  function beginFall(cut){
    const {record,tree}=cut;
    cut.phase='falling';cut.faces?.removeFromParent();cut.faces?.geometry.dispose();cut.faces=null;
    // A standing trunk fragment retains the original bark, taper and world transform.
    const stumpRoot=new T.Group();group.add(stumpRoot);
    tree.updateWorldMatrix(true,true);
    for(const part of cut.parts){
      const st=part.mesh.clone(false);
      st.geometry=cutGeometry(part,cut,true);
      part.mesh.matrixWorld.decompose(st.position,st.quaternion,st.scale);stumpRoot.add(st);
    }
    cut.stump=stumpRoot;
    const radius=cut.radius;
    const top=cap(radius);top.position.set(record.x,record.y+cutHeight+.003,record.z);stumpRoot.add(top);
    const cross=new T.Vector3(-cut.face.z,0,cut.face.x);
    for(let j=-3;j<=3;j++){
      const p=top.position.clone().addScaledVector(cross,j*radius*.17);
      const q=p.clone().addScaledVector(cut.face,.02);q.y+=.06+.035*Math.cos(j*2.4);
      stumpRoot.add(cylinder(p,q,.025,timber,.008,4));
    }
    const pivot=new T.Group();pivot.position.set(record.x,record.y+cutHeight,record.z);
    group.add(pivot);pivot.updateWorldMatrix(true,false);pivot.attach(tree);cut.pivot=pivot;
    cut.trim=cutHeight+.015;carve(cut);
    cut.butt=cap(radius);cut.butt.rotation.z=Math.PI;cut.butt.position.y=.016;pivot.add(cut.butt);
    sound('woodCrack',top.position,1);sound('treeFall',top.position,1);
    notify('Timber!'); state.felled++;
  }
  function fellStep(cut,dt){
    const length=Math.max(2,cut.record.height-cutHeight);
    cut.speed+=dt*(.105+1.65*Math.sin(cut.angle));
    const prev=cut.angle;cut.angle=Math.min(cut.angle+cut.speed*dt,Math.PI*.65);
    const p=cut.pivot.position;
    // Sweep crown and bole colliders against the actual terrain to find first contact.
    function touches(angle){
      for(const q of [.28,.57,.82,1]){
        const reach=length*q*Math.sin(angle);
        const floor=land.contactHeight(p.x+cut.face.x*reach,p.z+cut.face.z*reach);
        if(p.y+length*q*Math.cos(angle)<=floor+cut.record.radius*(1-.7*q))return true;
      }
      return false;
    }
    if(cut.angle>.7&&touches(cut.angle)){
      let a=prev,b=cut.angle;
      for(let i=0;i<6;i++){const m=(a+b)*.5;if(touches(m))b=m;else a=m;}
      cut.angle=b;cut.phase='landed';
      const hit=ground(p.x+cut.face.x*length*.8,p.z+cut.face.z*length*.8);
      sound('treeImpact',hit,1);spit(hit,cut.face,15);notify('Fallen timber · buck the trunk near its base');
    }
    cut.pivot.quaternion.setFromAxisAngle(cut.axis,cut.angle);setNextCut(cut);
  }
  function contactAt(target) {
    if(!target)return null;
    const cut=target.kind==='standing'?cutByTree.get(target.obj):target.obj;
    let roots=[],origin,direction,limit,fallback;
    if(target.kind==='standing'){
      const r=target.obj, radius=cut?.radius??r.radius;
      const out=new T.Vector3(player.x-r.x,0,player.z-r.z).normalize();
      origin=new T.Vector3(r.x,r.y+cutHeight+.021,r.z).addScaledVector(out,radius+.55);
      direction=out.clone().negate();limit=2*radius+.58;
      fallback=new T.Vector3(r.x,r.y+cutHeight+.021,r.z).addScaledVector(out,radius);
      if(cut)roots=[...cut.parts.map(p=>p.mesh),...(cut.faces?[cut.faces]:[])];
    }else{
      const isBlock=target.kind==='block';
      const center=isBlock?block.o.position:cut.nextPos;
      fallback=center.clone().addScaledVector(up,isBlock?.455:cut.radius);
      roots=isBlock?[block.o]:cut.parts.map(p=>p.mesh);
      origin=center.clone().addScaledVector(up,2.4);direction=up.clone().negate();limit=3.5;
    }
    for(const root of roots)root.updateWorldMatrix(true,true);
    contactRay.set(origin,direction);contactRay.far=limit;
    const surface=contactRay.intersectObjects(roots,true)[0]?.point??fallback;
    // At a downward viewing angle the near lip can obscure the inner notch face.
    // Stop the blade at the first physical surface along that sightline.
    const sight=surface.clone().sub(player);
    contactRay.far=sight.length()+.002;
    contactRay.set(player,sight.normalize());
    return contactRay.intersectObjects(roots,true)[0]?.point??surface;
  }
  function hitTree(record){
    const cut=getCut(record);if(!cut)return;
    const r=cut.radius;
    const dir=new T.Vector3(player.x-record.x,0,player.z-record.z).normalize();
    const target={kind:'standing',obj:record};
    const side=treeSide(cut);
    if(side>.25 && cut.front<3){
      cut.front++;cut.frontDepth=r*.91*cut.front/3;
    }else if(side<-.25 && cut.front>=3){
      cut.back++;cut.backDepth=r*.87*cut.back/2;
    }else{
      contact=contactAt(target);sound('axeHit',contact,.16);spit(contact,dir,3);
      notify(cut.front<3?'Finish the notch from the first side':'Walk around the trunk to cut from behind');return;
    }
    carve(cut);notchFaces(cut);
    contact=contactAt(target);sound('axeHit',contact,(cut.front+cut.back)/5);spit(contact,dir,7+cut.front);
    if(cut.back>=2)beginFall(cut);
    else if(cut.front===3 && !cut.back)notify('Notch open · circle behind the tree for the back cut');
  }
  function buck(cut) {
    const p=cut.nextPos.clone();
    sound('axeHit',contact,.46+cut.buckHits*.32);spit(contact,cut.face,6);
    if(++cut.buckHits<2)return;
    cut.buckHits=0;cut.sections++;state.bucked++;
    const rest=p.clone().addScaledVector(cut.face,-.50);
    rest.y=land.contactHeight(rest.x,rest.z);
    const log=item('round',rest,Math.atan2(-cut.face.z,cut.face.x));
    log.o.scale.set(1.04,clamp(cut.radius/.205,.65,2),clamp(cut.radius/.205,.65,2));
    log.o.position.y=rest.y+.205*log.o.scale.y;
    cut.trim=cutHeight+1.03*cut.sections;carve(cut);
    cut.butt.position.y=1.03*cut.sections;
    sound('logSplit',p,.7);
    if(cut.trim+1.1>cut.record.height*.68) {
      cut.phase='spent';notify('Trunk bucked · collect the rounds');
    }else {setNextCut(cut);notify('Round freed · E to carry');}
  }
  function split(){
    sound('logSplit',contact,1);spit(contact,new T.Vector3(0,0,1),13);
    block.o.removeFromParent();block=null;state.split++;
    for(let i=0;i<3;i++){
      const a=(i-1)*.85+.2, x=stump.position.x+Math.sin(a)*.9,z=stump.position.z+Math.cos(a)*.9;
      item('split',ground(x,z),a+.35);
    }
    notify('Three pieces of firewood · carry them to the rack');
  }
  function axeSwing() {
    if(time-lastHit<.50 || carry)return false;
    lastHit=time;swing=.53;action();
    const target=targetAxe();contact=contactAt(target);swingKind=target?.kind??'';
    // Capture the hit at the action's contact frame, allowing the player to turn mid-swing.
    hitDue=.15;return true;
  }
  let hitDue=-1;
  function strike(){
    const target=targetAxe();contact=contactAt(target);swingKind=target?.kind??'';if(!target)return;
    if(target.kind==='standing')hitTree(target.obj);
    else if(target.kind==='fallen')buck(target.obj);
    else split();
  }
  function pick(q){
    carry=q;state.carried=q.kind;q.o.removeFromParent();loose.splice(loose.indexOf(q),1);
    sound('woodPlace',player,.4);action();
  }
  function drop(){
    camera.getWorldDirection(gaze);gaze.y=0;gaze.normalize();
    const p=player.clone().addScaledVector(gaze,1.0);
    const q=carry;group.add(q.o);q.o.position.copy(ground(p.x,p.z));q.o.position.y+=q.kind==='round'?.21:.09;
    loose.push(q);carry=null;state.carried=null;sound('woodPlace',q.o.position,.55);
  }
  function setBlock(){
    block=carry;carry=null;state.carried=null;group.add(block.o);
    block.o.position.copy(stump.position).y+=.59+.455;
    block.o.rotation.set(0,0,Math.PI/2);block.o.scale.set(1,1,1);sound('woodPlace',stump.position,.7);
  }
  const stacked=[];
  function stack(){
    const wood=carry.o;carry=null;state.carried=null;
    rack.add(wood);const n=stacked.length;
    wood.position.set((n%5-2)*.265,.20+Math.floor(n/5)*.12,(n%2-.5)*.025);
    wood.rotation.set(0,Math.PI/2,(n%3-1)*.03);stacked.push(wood);
    state.stacked=stacked.length;state.stock=stacked.length;sound('woodPlace',rack.position,.64);
    if(n===2)notify('Three pieces stacked · light the fire at the stone ring');
  }

  const hearth=new T.Group();hearth.position.copy(pit.position);group.add(hearth);
  const fireGroup=new T.Group();fireGroup.name='Live hearth';hearth.add(fireGroup);fireGroup.visible=false;
  // Keep the light layout stable. Igniting the fire only changes the lamp's output.
  const fireLight=new T.PointLight(0xffac68,0,12,2);
  hearth.add(fireLight);
  const stirFire=createHearthEffects(fireGroup,fireLight),hearthWind=new T.Vector2(),charTime={value:0};
  const heartwood=new T.MeshStandardMaterial({color:0x302622,roughness:.97});
  heartwood.onBeforeCompile=shader=>{
    shader.uniforms.charringTime=charTime;
    shader.vertexShader='varying vec3 woodFiber;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nwoodFiber=position;');
    shader.fragmentShader='varying vec3 woodFiber;uniform float charringTime;\n'+shader.fragmentShader.replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
      float grain=woodFiber.y*51.+woodFiber.z*23.+.58*sin(woodFiber.x*28.+woodFiber.z*11.)+.18*sin(woodFiber.x*94.+woodFiber.y*22.);
      float crossCrack=pow(max(0.,cos(woodFiber.x*47.+2.*sin(woodFiber.z*45.))),31.);
      float fissure=pow(max(0.,cos(grain*3.14159)),21.);
      float glowing=smoothstep(-.17,.73,sin(woodFiber.x*12.2+woodFiber.z*36.+charringTime*.42));
      totalEmissiveRadiance+=vec3(1.25,.113,.011)*(fissure+.31*crossCrack)*glowing;`);
  };
  function lightFire(){
    if(stacked.length<3)return;
    for(let i=0;i<3;i++){
      const w=stacked.pop();w.traverse(o=>{if(o.isMesh)o.material=heartwood;});fireGroup.add(w);const a=i*Math.PI/3;
      w.position.set(Math.cos(a)*.115,.13+i*.074,Math.sin(a)*.115);w.rotation.set(0,a,0);
    }
    state.stacked=stacked.length;state.stock=stacked.length;state.fire=true;fireGroup.visible=true;
    setDusk(.86);notify('Campfire lit · dusk settles over the creek');sound('fire',pit.position,.9);
  }
  function updateFire(dt){
    if(!state.fire)return;
    const close=horizontal(player,pit.position)<80;
    fireGroup.visible=close;
    if(!close)fireLight.intensity=0;
    if(close){
      windAt(pit.position.x,pit.position.z,time,hearthWind);charTime.value=time;
      stirFire(time,camera,hearthWind.x*4,hearthWind.y*4);
      fireTick-=dt;if(fireTick<=0){sound('fire',pit.position,.48);fireTick=.5+Math.random()*.55;}
    }
    if(cookDuration>0){
      cookDuration=Math.max(0,cookDuration-dt);state.cooking=cookDuration;
      const toast=1-cookDuration/4;
      cookFish.rotation.x=.38*Math.sin(toast*Math.PI*1.6);
      for(const finish of cookFish.userData.finishes)finish.color.setRGB(1-.34*toast,.98-.50*toast,.93-.59*toast);
      if(cookDuration===0){state.cooked++;cookFish.removeFromParent();for(const finish of cookFish.userData.finishes)finish.dispose();cookFish=null;notify('Trout cooked · one meal packed');}
    }
  }
  function cook(){
    if(!state.fire||state.fish<1||cookDuration>0)return;
    state.fish--;cookDuration=4;state.cooking=4;cookFish=model('Trout');
    fireGroup.add(cookFish);cookFish.position.set(.05,.76,.28);cookFish.rotation.z=.025;
    const materials=new Map();
    cookFish.traverse(mesh=>{
      if(!mesh.isMesh)return;
      if(!materials.has(mesh.material))materials.set(mesh.material,mesh.material.clone());
      mesh.material=materials.get(mesh.material);
    });
    cookFish.userData.finishes=[...materials.values()];
    if(!fireGroup.getObjectByName('CookingSpit'))fireGroup.add(model('CookingSpit'));
    notify('Cooking trout over the coals');
  }

  const bobber=tackle.scene.getObjectByName('QuillFloat'),fly=tackle.scene.getObjectByName('HackleFly');
  bobber.name='Cork float';fly.name='Tied fly';
  bobber.visible=fly.visible=false;group.add(bobber,fly);
  const leaderPos=new Float32Array(3*3),leaderGeo=new T.BufferGeometry();
  leaderGeo.setAttribute('position',new T.BufferAttribute(leaderPos,3));
  const leader=new T.Line(leaderGeo,new T.LineBasicMaterial({color:0xa3b8a9,transparent:true,opacity:.59}));
  leader.name='Submerged leader';leader.visible=false;leader.frustumCulled=false;group.add(leader);
  const knot=new T.Vector3(),floatUp=new T.Vector3(),floatTilt=new T.Quaternion();
  function driftingFly(target){
    // The current draws the fly downstream from the lower quill eye.
    const slope=land.streamX(bobber.position.z+.5)-land.streamX(bobber.position.z-.5);
    const drift=.064/Math.hypot(slope,1);
    return target.set(bobber.position.x-slope*drift,bobber.position.y-.212,bobber.position.z-drift);
  }
  function updateTackle(dt){
    fly.visible=leader.visible=bobber.visible;
    if(!bobber.visible)return;
    if(selected&&(state.fishing==='reeling'||landingTime>0)){
      jaw(fly.position);
      // Buoyancy holds the cork at the surface until the fish is lifted clear.
      const height=landingTime>0?fly.position.y+.212:Math.min(waterSurfaceY(fly.position.x,fly.position.z)+.004,fly.position.y+.212);
      bobber.position.set(fly.position.x+.023,height,fly.position.z+.035);
      fly.quaternion.copy(selected.root.quaternion);
    }else{
      driftingFly(fly.position);fly.rotation.set(.10*Math.sin(time*3),time*.48,-.17);
    }
    const floating=!landingTime&&state.fishing!=='casting';
    if(floating){
      const {x,z}=bobber.position,h=.06;
      floatUp.set(waterSurfaceY(x-h,z)-waterSurfaceY(x+h,z),2*h,waterSurfaceY(x,z-h)-waterSurfaceY(x,z+h)).normalize();
    }else floatUp.set(0,1,0);
    floatTilt.setFromUnitVectors(up,floatUp);bobber.quaternion.slerp(floatTilt,1-Math.exp(-dt*9));
    knot.set(0,-.055,0).applyQuaternion(bobber.quaternion).add(bobber.position);
    knot.toArray(leaderPos);fly.position.toArray(leaderPos,6);
    knot.lerp(fly.position,.5);knot.z-=.006;knot.toArray(leaderPos,3);
    leaderGeo.attributes.position.needsUpdate=true;
    drawLine();
  }
  const linePos=new Float32Array(21*3);
  const lineGeo=new T.BufferGeometry();lineGeo.setAttribute('position',new T.BufferAttribute(linePos,3));
  const line=new T.Line(lineGeo,new T.LineBasicMaterial({color:0xddd6ae,transparent:true,opacity:.68}));
  line.frustumCulled=false;line.visible=false;group.add(line);
  const castStart=new T.Vector3(), castTarget=new T.Vector3(), hookStart=new T.Vector3(), rodTip=new T.Vector3();
  let castClock=0, biteDelay=0, reeling=false, clickIn=0, escape=0;
  const waterSurfaceY=land.waterSurfaceY??land.waterY;
  const shoal=createTroutSchool(group,model,kit.animations.find(a=>a.name==='Trout_swim'),land);
  const swimTarget=new T.Vector3(),mouth=new T.Vector3();
  let selected=null,hookWake=0,landingTime=0,approachYaw=null;
  const landingStart=new T.Vector3(),landingGoal=new T.Vector3();
  function jaw(target){
    target.set(.31,-.004,0).multiplyScalar(selected.site.scale);
    return target.applyQuaternion(selected.root.quaternion).add(selected.root.position);
  }
  function returnTrout(harvest=false){
    shoal.release(selected,harvest);selected=null;approachYaw=null;
  }
  function updateShoal(dt) {
    shoal.update(dt,time,player,selected);
    if(!selected)return;
    const hooked=selected.root,hookMixer=selected.mixer;
    if(landingTime>0){
      if(tool()!=='rod'||horizontal(player,landingStart)>7){landingTime=0;returnTrout(true);clearLine();return;}
      else{
        landingTime=Math.max(0,landingTime-dt);
        const lift=1-Math.max(0,1-(1.6-landingTime)/.66)**2;
        landingGoal.set(-.13+.04*Math.sin(time*4.2),-.13+Math.sin(time*5.2)*.025,-1.07);
        camera.localToWorld(landingGoal);
        hooked.position.lerpVectors(landingStart,landingGoal,lift);
        hooked.rotation.y=Math.atan2(camera.matrixWorld.elements[8],camera.matrixWorld.elements[10]);
        hooked.rotation.z=.62+.21*Math.sin(time*9);
        hookMixer.timeScale=1.5;hookMixer.update(dt);

        if(!landingTime){returnTrout(true);clearLine();}
        return;
      }
    }
    const activity=state.fishing;
    if(!['waiting','bite','reeling'].includes(activity))return;
    const struggling=activity==='reeling',approach=activity==='waiting';
    const thrash=struggling?Math.max(0,Math.sin(castClock*3.6+.31)):0;
    const scale=selected.site.scale;
    driftingFly(knot);shoal.wetTarget(knot,swimTarget,scale);
    const dx=swimTarget.x-hooked.position.x,dz=swimTarget.z-hooked.position.z;
    if(approachYaw===null||Math.hypot(dx,dz)>.75)approachYaw=Math.atan2(-dz,dx);
    const yaw=struggling?hooked.rotation.y:approachYaw;
    swimTarget.x-=Math.cos(yaw)*.31*scale;
    swimTarget.z+=Math.sin(yaw)*.31*scale;
    shoal.submerge(swimTarget,scale,yaw,approach?.21*scale:.12*scale);
    if(struggling){
      swimTarget.x+=Math.sin(castClock*6.3)*.13*(1-state.progress);
      swimTarget.y+=thrash**3*.16;
    }
    shoal.swimTo(selected,swimTarget,dt,struggling?2.2:1.18,struggling?5.3:3.5);
    if(!struggling){
      const turn=approachYaw-hooked.rotation.y;
      hooked.rotation.y+=Math.atan2(Math.sin(turn),Math.cos(turn))*Math.min(1,dt*5);
    }
    hooked.rotation.z=struggling?.28*Math.sin(castClock*7)*thrash:.028*Math.sin(time*2);
    hooked.rotation.x=struggling?.30*thrash*Math.sin(castClock*8.1):.02;
    hookMixer.timeScale=struggling?2.3:1.28;hookMixer.update(dt);
    if(struggling&&(hookWake-=dt)<=0&&thrash>.58){
      land.ripple?.(hooked.position.x,hooked.position.z,.33+thrash*.25,.48);hookWake=.61;
    }
  }
  function castPoint() {
    camera.getWorldDirection(gaze);
    const flat=Math.hypot(gaze.x,gaze.z);
    const dx=flat>.001?gaze.x/flat:1,dz=flat>.001?gaze.z/flat:0;
    let best=null,error=Infinity;
    for(let dist=1.5;dist<=26;dist+=.35){
      const x=player.x+dx*dist,z=player.z+dz*dist;
      if(!land.isWater(x,z))continue;
      const y=waterSurfaceY(x,z);
      const miss=Math.abs(player.y+gaze.y/Math.max(.12,flat)*dist-y)+.004*Math.abs(land.streamX(z)-x);
      if(miss<error){best=new T.Vector3(x,y,z);error=miss;}
    }
    if(gaze.y>.40 || (gaze.y<-.80 && error>1.5))return null;
    return best;
  }
  function clearLine(message){
    bobber.visible=false;line.visible=false;reeling=false;state.fishing='idle';state.tension=0;state.progress=0;
    if(selected&&!landingTime)returnTrout();
    rodRecover=.38;if(message)notify(message);
  }
  function fishingDown(){
    if(state.fishing==='idle'){
      if(landingTime>0){landingTime=0;returnTrout(true);clearLine();}
      const p=castPoint();
      if(!p){notify('Face the water and cast from the bank');return true;}
      castTarget.copy(p);castStart.copy(player).y-=.12;
      state.fishing='casting';state.progress=0;castClock=0;biteDelay=2.8+Math.random()*1.3;
      bobber.visible=true;line.visible=true;bobber.position.copy(castStart);action();sound('cast',player,.9);
    }else if(state.fishing==='bite'){
      state.fishing='reeling';state.tension=.26;state.progress=.02;castClock=0;clickIn=0;escape=0;reeling=true;
      hookStart.copy(bobber.position);sound('splash',bobber.position,.7);notify('Trout hooked · hold to reel, release to ease tension');
    }else if(state.fishing==='reeling')reeling=true;
    else if(state.fishing==='waiting')clearLine('Line retrieved · cast again');
    return true;
  }
  function fishStep(dt){
    if(state.fishing==='idle')return;
    if(tool()!=='rod'||horizontal(player,castTarget)>38){clearLine();return;}
    castClock+=dt;
    if(state.fishing==='casting'){
      const t=Math.min(1,castClock/.72);
      bobber.position.lerpVectors(castStart,castTarget,t);bobber.position.y+=2.4*4*t*(1-t);
      if(t>=1){
        state.fishing='waiting';castClock=0;selected=shoal.nearest(castTarget);hookWake=.4;
        sound('splash',castTarget,.7);
      }
    }else if(state.fishing==='waiting'){
      bobber.position.y=waterSurfaceY(castTarget.x,castTarget.z)+.025+Math.sin(time*3.4)*.014;
      if(selected&&castClock>biteDelay&&jaw(mouth).distanceTo(driftingFly(knot))<.080){castClock=0;state.fishing='bite';sound('splash',castTarget,.48);notify('Bite! Press to hook the trout');}
      else if(castClock>18){clearLine('No rise here · try another pool');return;}
    }else if(state.fishing==='bite'){
      bobber.position.y=waterSurfaceY(castTarget.x,castTarget.z)-.022+Math.sin(time*16)*.071;
      if(castClock>4.8)clearLine('The trout slipped away');
    }else if(state.fishing==='reeling'){
      const pull=Math.sin(castClock*1.8+.5)>.14;
      state.tension=clamp(state.tension+dt*(reeling?(pull?.47:.12):-.58),.035,1.02);
      state.progress=clamp(state.progress+dt*(reeling?(pull?.115:.255):-.019),0,1);
      escape=(!reeling && state.tension<.08)?escape+dt:0;
      if(state.tension>=1){clearLine('The line snapped · ease off as tension rises');return;}
      if(escape>2.6){clearLine('The trout shook the hook');return;}
      const p=state.progress;
      bobber.position.lerpVectors(hookStart,player,p*.94);
      bobber.position.x+=Math.sin(time*5.1)*(1-p)*.25;
      bobber.position.y=waterSurfaceY(bobber.position.x,bobber.position.z)+Math.sin(time*7)*.045;
      if(reeling&&(clickIn-=dt)<=0){sound('reel',player,.58+.2*state.tension);clickIn=.17;}
      if(p>=1){
        state.fish++;sound('splash',bobber.position,.8);
        landingStart.copy(selected.root.position);landingTime=1.6;
        clearLine('Brook trout caught · cook it at the campfire');rodRecover=1.6;line.visible=bobber.visible=true;
      }
    }
  }
  function drawLine(){
    rodTip.set(0,1.62,0);rod.localToWorld(rodTip);
    knot.set(0,.083,0).applyQuaternion(bobber.quaternion).add(bobber.position);
    const sag=state.fishing==='reeling'?.025:(state.fishing==='casting'?.17:.09);
    const slack=sag*Math.min(3.5,horizontal(rodTip,bobber.position)*.35);
    for(let i=0;i<21;i++){
      const f=i/20,j=i*3;
      linePos[j]=T.MathUtils.lerp(rodTip.x,knot.x,f);
      linePos[j+1]=T.MathUtils.lerp(rodTip.y,knot.y,f)-4*f*(1-f)*slack;
      linePos[j+2]=T.MathUtils.lerp(rodTip.z,knot.z,f);
    }
    lineGeo.attributes.position.needsUpdate=true;
  }
  function contextAction() {
    if(carry){
      if(carry.kind==='round'&&!block&&score(stump.position,3.2,-.12)<Infinity)return 'place';
      if(carry.kind==='split'&&score(rack.position,3.15,-.12)<Infinity)return 'stack';
      return 'drop';
    }
    const options=[];
    for(const q of loose){
      const s=score(q.o.position,2.55,.15);if(Number.isFinite(s))options.push({s,key:q});
    }
    const pitScore=score(pit.position,2.8,.1);
    if(state.fire&&state.fish>0&&!cookDuration&&Number.isFinite(pitScore))options.push({s:pitScore-.18,key:'cook'});
    if(!state.fire&&stacked.length>=3&&Number.isFinite(pitScore))options.push({s:pitScore-.18,key:'light'});
    options.sort((a,b)=>a.s-b.s);
    return options[0]?.key??null;
  }
  function interact(){
    const what=contextAction();if(!what)return false;
    if(typeof what==='object')pick(what);
    else if(what==='place')setBlock();
    else if(what==='stack')stack();
    else if(what==='drop')drop();
    else if(what==='light')lightFire();
    else if(what==='cook')cook();
    return true;
  }
  function hint(){
    const what=contextAction();
    if(typeof what==='object'&&what)return what.kind==='round'?'E · Carry log':'E · Carry firewood';
    if(what==='place')return 'E · Set log on chopping block';
    if(what==='stack')return 'E · Stack firewood ('+stacked.length+' stacked)';
    if(what==='drop')return carry.kind==='round'?'Carry to chopping block  ·  E Drop':'Carry to wood rack  ·  E Drop';
    if(what==='light')return 'E · Build campfire (3 firewood)';
    if(what==='cook')return 'E · Cook brook trout';
    if(tool()==='rod'){
      if(state.fishing==='reeling')return 'Hold to reel · release to ease  |  Tension '+Math.round(state.tension*100)+'%  ·  Catch '+Math.round(state.progress*100)+'%';
      if(state.fishing==='bite')return 'Bite! · Click to hook';
      if(state.fishing==='waiting')return 'Watch the float · click to recast';
      if(state.fishing==='casting')return 'Casting';
      if(horizontal(player,shore)<12||Math.abs(player.x-land.streamX(player.z))<10)return 'Aim at water · click to cast';
    }
    if(tool()==='axe'){
      const target=targetAxe();
      if(target?.kind==='block')return 'Swing · Split log';
      if(target?.kind==='standing'){
        const cut=cutByTree.get(target.obj);
        if(!cut)return 'Swing · Start a notch';
        if(cut.front<3)return 'Swing · Deepen notch ('+cut.front+'/3)';
        return treeSide(cut)<-.25?'Swing · Back cut ('+cut.back+'/2)':'Circle behind the notch for the back cut';
      }
      if(target?.kind==='fallen')return 'Swing · Buck a round ('+target.obj.buckHits+'/2)';
    }
    if(score(stump.position,2.7)<Infinity&&block)return 'Equip axe to split the round';
    if(score(pit.position,2.6)<Infinity){
      if(cookDuration>0)return 'Cooking trout · '+Math.ceil(cookDuration)+'s';
      if(!state.fire)return 'Campfire · stack '+Math.max(0,3-stacked.length)+' more firewood';
    }
    return '';
  }

  function viewStep(dt){
    swing=Math.max(0,swing-dt);rodRecover=Math.max(0,rodRecover-dt);handTime+=dt;
    const rodOut=tool()==='rod'&&(state.fishing!=='idle'||rodRecover>0);
    sleeve.visible=swing>0&&!carry;view.visible=swing>0||rodOut||!!carry;if(!view.visible)return;
    gripMixer.update(dt);axe.visible=swing>0&&!carry;rod.visible=rodOut&&!carry;
    held.visible=carry?.kind==='round';splitHeld.visible=carry?.kind==='split';
    held.position.set(0,.10,-.12);held.scale.setScalar(.72);held.rotation.set(-.1,.55,.14);
    splitHeld.position.set(0,.048,-.045);splitHeld.rotation.set(0,.32,0);
    if(carry){
      view.position.set(.22,-.29+Math.sin(handTime*2)*.004,-.55);view.rotation.set(.08,-.04,-.15);
    }else if(axe.visible){
      const elapsed=.53-swing;
      // Ease into impact, hold for two 60 Hz frames, then extract the blade.
      const phase=elapsed<.15?elapsed/.15:elapsed<=.196?1:Math.max(0,1-(elapsed-.196)/.334);
      const reach=phase*phase*(3-2*phase);
      const chopping=swingKind==='block'||swingKind==='fallen';
      view.rotation.set(
        T.MathUtils.lerp(.47,chopping?.18:.52,reach),
        T.MathUtils.lerp(-.21,chopping?-.16:-.94,reach),
        T.MathUtils.lerp(-.49,chopping?1.1:.50,reach)
      );
      view.position.set(.34,-.24-(1-Math.min(1,swing*10))*.30,-.47);
      if(contact){
        // Transform the modeled cutting edge back from its exact world-space hit.
        // Solving the grip translation from that edge keeps impact stable as the camera turns.
        poseAim.copy(contact);camera.worldToLocal(poseAim);
        poseAim.sub(sleeveAxis.copy(bladeEdge).applyQuaternion(view.quaternion));
        view.position.lerp(poseAim,reach);
      }else{
        view.position.x-=.12*reach;view.position.y-=.06*reach;view.position.z-=.16*reach;
      }
      sleeve.position.copy(elbow).applyQuaternion(view.quaternion).add(view.position);
      sleeveAxis.subVectors(shoulder,sleeve.position);
      sleeve.scale.y=sleeveAxis.length()/.7;
      sleeve.quaternion.setFromUnitVectors(up,sleeveAxis.normalize());
    }else{
      const cast=state.fishing==='casting' ? Math.sin(Math.min(1,castClock/.72)*Math.PI) : 0;
      const tug=state.fishing==='reeling'?state.tension*.24:0;
      view.position.set(.26,-.235+Math.sin(time*4)*tug*.045,-.46);
      view.rotation.set(-.87-cast*.48+tug,.18,-.24);
    }
    view.updateWorldMatrix(true,true);
  }
  const raycaster=new T.Raycaster(), rayTargets=[];
  function raycast(ray,maxDistance=Infinity) {
    raycaster.ray.copy(ray);raycaster.near=0;raycaster.far=maxDistance;
    rayTargets.length=0;rayTargets.push(stump,pit,rack);
    if(block)rayTargets.push(block.o);
    for(const q of loose)rayTargets.push(q.o);
    for(const cut of cuts){
      rayTargets.push(cut.tree);
      if(cut.stump)rayTargets.push(cut.stump);
      if(cut.faces)rayTargets.push(cut.faces);
      if(cut.butt)rayTargets.push(cut.butt);
    }
    for(const object of rayTargets)object.updateWorldMatrix(true,true);
    return raycaster.intersectObjects(rayTargets,true)[0]??null;
  }
  function collides(x,z,footY) {
    const radius=.23,head=footY+1.60;
    const disk=(p,r,h)=>head>p.y&&footY<p.y+h&&Math.hypot(x-p.x,z-p.z)<radius+r;
    if(disk(stump.position,.38,.59)||disk(pit.position,.54,.19))return true;
    if(footY<rack.position.y+.82&&head>rack.position.y&&Math.abs(x-rack.position.x)<radius+.37&&Math.abs(z-rack.position.z)<radius+.80)return true;
    for(const cut of cuts){
      const r=cut.record,p=cut.pivot?.position;
      if(disk(r,cut.radius,cut.phase==='upright'?r.height:cutHeight))return true;
      if(!p)continue;
      const along=(x-p.x)*cut.face.x+(z-p.z)*cut.face.z;
      const sn=Math.sin(cut.angle);
      if(sn<.01)continue;
      const t=clamp(along/sn,Math.max(0,cut.trim-cutHeight),r.height-cutHeight);
      const reach=t*sn,cy=p.y+t*Math.cos(cut.angle),cr=cut.radius*(1-.72*t/(r.height-cutHeight));
      if(cy+cr>footY&&cy-cr<head&&Math.hypot(x-p.x-cut.face.x*reach,z-p.z-cut.face.z*reach)<cr+radius)return true;
    }
    return false;
  }
  return {
    async prepareHearth(draw){
      // This material first appears when stacked billets are moved into the fire.
      const billet=model('Firewood');
      billet.traverse(part=>{if(part.isMesh)part.material=heartwood;});
      fireGroup.add(billet);
      try{
        stirFire(0,camera,0,0);
        await draw(fireGroup);
      }finally{
        fireLight.intensity=0;
        billet.removeFromParent();
      }
    },
    raycast,collides,shoal,get respondingTrout(){return selected;},
    update(dt,elapsed){
      time=elapsed??time+dt;dt=Math.min(dt,.08);
      if(hitDue>=0){hitDue-=dt;if(hitDue<=0){hitDue=-1;strike();}}
      for(const cut of cuts)if(cut.phase==='falling')fellStep(cut,dt);
      if(chips.length||chipMesh.count)handleChips(dt);
      updateFire(dt);viewStep(dt);fishStep(dt);updateShoal(dt);updateTackle(dt);
    },
    down(){if(carry)return false;if(tool()==='axe')return axeSwing();if(tool()==='rod')return fishingDown();return false;},
    up(){reeling=false;return tool()==='rod';}, interact,hint,location,shore,state
  };
}

