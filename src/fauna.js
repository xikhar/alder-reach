import {attachDeerDetail,deerDistanceLibrary} from './deer-detail.js';
import {createFooting,plantHooves,releaseFooting,hasFootSupport,paceDeer} from './deer-footing.js';
import {fitPerch} from './perch-contact.js';
import {deerEars,listen,restoreEars} from './deer-hearing.js';
import {preparePosedContact,intersectPosedMesh} from './posed-mesh-contact.js';
import {walkingSurface} from './rock-contact.js';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

const loader = new GLTFLoader();
const cache = new Map();
export function model(name) {
  if (!cache.has(name)) cache.set(name, loader.loadAsync(import.meta.env.BASE_URL + 'models/' + name + '.glb'));
  return cache.get(name);
}

export async function createFauna({scene, land, player, plants}) {
  const ground={height:land.contactHeight??land.height};
  const species = ['red-deer', 'kingfisher', 'mountain-hare'];
  const [sources,distance]=await Promise.all([
    Promise.all([...species,'red-doe','red-fawn'].map(model)),model('cervid-distance').then(deerDistanceLibrary)
  ]);
  const herd = [],perchModel=await model('bird-perch');
  const perches=[];
  for(const [x,z,angle,width,height] of [[-7.54,-6.30,.08,1,.68],[1.44,-4.35,3.10,.9,.8]]){
    const branch=perchModel.scene.clone(true);branch.name='Trail perch';
    branch.position.set(x,land.height(x,z),z);branch.scale.set(width,height,width);branch.rotation.y=angle;branch.traverse(o=>{if(o.isMesh)o.castShadow=true;});scene.add(branch);
    perches.push({tip:branch.localToWorld(new T.Vector3(.91,1.45,-.005)),branch});
  }
  function spawn(kind, x, z, scale, seed) {
    const index=kind===0 && scale<.8?4:kind===0 && seed%3!==0?3:kind;
    const gltf=sources[index],asset=[...species,'red-doe','red-fawn'][index],root=clone(gltf.scene);
    root.name = species[kind]; root.scale.setScalar(scale);root.rotation.order='YXZ';
    root.position.set(x,land.height(x,z),z);root.rotation.y = seed * 1.76;
    root.traverse(m=>{if(m.isMesh){m.castShadow=true;m.receiveShadow=true;}});scene.add(root);
    const mixer=new T.AnimationMixer(root);
    const actions=Object.fromEntries(gltf.animations.map(clip=>[clip.name,mixer.clipAction(clip)]));
    const a={kind,asset,root,mixer,actions,seed,home:new T.Vector2(x,z),state:'',alarm:0,fall:0,dead:false,phase:seed*.88,speed:0,heading:root.rotation.y,vy:0};
    a.skin=[];a.contacts=[];
    root.traverse(m=>{
      if(!m.isSkinnedMesh)return;
      // Permit the head, feet and folded wings to reach beyond their rest-pose
      // bounds. The narrow phase still intersects the current deformed triangles.
      m.geometry.computeBoundingSphere();
      m.boundingSphere=m.geometry.boundingSphere.clone();
      m.boundingSphere.radius += [1.6,.53,.57][kind];
      m.boundingBox=null;
      a.skin.push(m);preparePosedContact(m);
      const count=m.geometry.attributes.position.count,stride=Math.max(1,Math.floor(count/30));
      for(let i=0;i<count;i+=stride)a.contacts.push([m,i]);
    });
    a.neck=root.getObjectByName('neck');a.head=root.getObjectByName('head');
    if(kind===0)a.ears=deerEars(a);
    a.footing=kind===0?createFooting(root):null;
    if(kind===0)a.detail=attachDeerDetail(a,distance);
    a.gaze=kind===0&&seed===1?[
      [a.neck,.22,.34],[root.getObjectByName('nape'),.24,.34],[a.head,.98,.85]
    ].filter(([bone])=>bone).map(([bone,share,limit])=>({bone,share,limit,yaw:0,rest:new T.Quaternion()})):[];
    herd.push(a);
    setState(a,kind===0&&(seed===1||seed===4||seed===5)?'Attend':['Graze','Flight','Listen'][kind]);
    a.mixer.update(seed*.91);
    if(kind===0&&seed<=5)root.rotation.y=[0,1.51,-1.02,1.88,3.11,2.91][seed];
  }
  function setState(a,name) {
    if(a.state===name)return;
    const rising=a.kind===0&&a.state==='Graze'&&name==='Attend';
    const settling=a.kind===0&&a.state==='Attend'&&name==='Graze';
    const duration=rising?.45:settling?.72:.2;
    a.actions[a.state]?.fadeOut(duration);
    a.actions[name]?.reset().fadeIn(duration).play();
    a.state=name;
  }
  for(const [i,x,z,s] of [[0,10.95,-40.76,1.24],[0,7.60,-41.88,.79],[0,13.57,-40.80,.76],[0,16.22,-31.63,1.04],[0,16.1,-33.48,.67],
      [0,land.streamX(-79)+land.streamWidth(-79)+4.2,-79,1.04],
      [2,-1.8,-10,1.15],[2,3,-44,1.28],[2,5,-73,.96],[2,19,-30,1.2],
      [1,1.5,-9,1.42],[1,6,-17,1.40],[1,15,-25,1.5],[1,-4,-62,1.68],
      [1,land.streamX(-93)-land.streamWidth(-93)-1.5,-93,1.55]]) spawn(i,x,z,s,herd.length+1);
  for(let i=0;i<2;i++){
    const a=herd[10+i],{tip,branch}=perches[i];a.home.set(tip.x,tip.z);a.root.position.copy(tip);a.root.rotation.y=i?1.2:-1.1;
    setState(a,'Perch');a.mixer.update(.4);
    a.stance=fitPerch(a,branch);a.perchHeight=a.stance.height;
  }
  const aim=new T.Vector3(),forward=new T.Vector3(),focus=new T.Vector3(),axis=new T.Vector3();
  const orientation=new T.Quaternion(),turn=new T.Quaternion();
  function attend(a,dt){
    // The body remains broadside. Distribute the glance from the neck to the poll
    // in world yaw, converting each correction into its parent's local space.
    for(const joint of a.gaze){
      const {bone,share,limit}=joint;
      bone.getWorldPosition(aim);focus.subVectors(player,aim);
      forward.set(0,1,0).applyQuaternion(bone.getWorldQuaternion(orientation));
      const error=Math.atan2(focus.x,focus.z)-Math.atan2(forward.x,forward.z);
      let angle=Math.atan2(Math.sin(error),Math.cos(error));
      // A visitor directly behind can be seen over either shoulder. Keep the
      // previous side while the animated, lowered poll passes through that seam.
      if(Math.abs(angle)>2.6&&Math.abs(joint.yaw)>.025)angle=Math.sign(joint.yaw)*Math.abs(angle);
      const visibility=T.MathUtils.smoothstep(Math.hypot(forward.x,forward.z),.045,.27);
      const target=T.MathUtils.clamp(angle*share,-limit,limit)*a.attention;
      const next=T.MathUtils.damp(joint.yaw,target,3.5+7*visibility,dt);
      const maxStep=2.5*limit*dt;
      joint.yaw+=T.MathUtils.clamp(next-joint.yaw,-maxStep,maxStep);
      joint.rest.copy(bone.quaternion);
      axis.set(0,1,0).applyQuaternion(bone.parent.getWorldQuaternion(orientation).invert());
      bone.quaternion.premultiply(turn.setFromAxisAngle(axis,joint.yaw));
    }
    a.gazeApplied=true;
  }
  const walkRay=new T.Ray(),paddedRock=new T.Box3(),rockHit=new T.Vector3(),destination=new T.Vector3();
  const ray=new T.Raycaster(),direction=new T.Vector3(),contact=new T.Vector3();
  function groundContact(a){
    a.root.updateMatrixWorld(true);
    let floor=-Infinity;
    for(const [mesh,index] of a.contacts){
      mesh.getVertexPosition(index,contact).applyMatrix4(mesh.matrixWorld);
      floor=Math.max(floor,walkingSurface(ground,a.obstacles.rocks,contact.x,contact.z)+a.root.position.y-contact.y);
    }
    return floor;
  }
  return {herd,update(dt,t,noisy){
    for(const a of herd){
      const p=a.root.position;
      // Ground contacts and obstacle avoidance follow the animal when the
      // observer travels. The cached neighborhood leaves four metres of margin.
      if((a.kind!==1||a.dead)&&(!a.obstacles||(p.x-a.obstacles.x)**2+(p.z-a.obstacles.z)**2>16)){
        a.obstacles=plants.wildlifeObstacles(p.x,p.z);
      }
      releaseFooting(a.footing);
      restoreEars(a);
      if(a.dead){
        if(a.settled)continue;
        if(a.fall<1){
          a.fall=Math.min(1,a.fall+dt*(a.kind===0?1.23:1.8));
          a.mixer.update(dt);
          const w=a.fall*a.fall*(3-2*a.fall);
          const roll=1.48*w+.12*Math.sin(Math.PI*3*a.fall)*w*(1-w);
          a.root.rotation.z=a.side*roll;
          a.speed*=Math.exp(-dt*5.6);
          p.x-=Math.sin(a.root.rotation.y)*a.speed*dt;
          p.z-=Math.cos(a.root.rotation.y)*a.speed*dt;
        }
        const floor=groundContact(a);
        a.vy-=dt*9.81;p.y+=a.vy*dt;
        if(p.y<=floor){
          p.y=floor;a.vy=0;
          a.settled=a.fall>=1;
        }
        continue;
      }
      if(a.gazeApplied){for(const g of a.gaze)g.bone.quaternion.copy(g.rest);a.gazeApplied=false;}
      a.mixer.update(dt);
      if(a.kind===1){
        const k=t*.38+a.phase, radius=4.2+a.seed*.15;
        const base=a.perchHeight??land.height(a.home.x,a.home.y)+.04;
        const near=Math.hypot(player.x-a.home.x,player.z-a.home.y)<2.7;
        if(near)a.alarm=5;else a.alarm=Math.max(0,a.alarm-dt);
        const perch=a.alarm===0 && (a.perchHeight!==undefined || (t+a.seed*1.7)%24<7);
        if(perch)aim.set(a.home.x,base,a.home.y);
        else aim.set(a.home.x+Math.sin(k)*radius,base+2.25+Math.sin(k*.7),a.home.y+Math.sin(2*k)*radius*.65);
        const distance=p.distanceTo(aim);
        setState(a,perch&&distance<.08?'Perch':'Flight');
        const landing=perch&&a.stance&&distance<.7;
        if(distance>.001||landing){
          const heading=landing?a.stance.yaw:Math.atan2(p.x-aim.x,p.z-aim.z);
          a.root.rotation.y+=Math.atan2(Math.sin(heading-a.root.rotation.y),Math.cos(heading-a.root.rotation.y))*Math.min(1,dt*5);
          if(distance>.001)p.lerp(aim,Math.min(1,dt*(perch?4:6)/distance));else p.copy(aim);
        }
        a.root.rotation.z=perch&&a.stance?T.MathUtils.damp(a.root.rotation.z,a.stance.roll,8,dt):perch?0:.27*Math.sin(k);continue;
      }
      const dx=p.x-player.x,dz=p.z-player.z, range=Math.hypot(dx,dz);
      if(a.startle>0){a.startle-=dt;if(a.startle<=0)a.alarm=3.4;}
      if(range<(noisy?10:4.0))a.alarm=2.6;
      a.alarm=Math.max(0,a.alarm-dt);
      const flee=a.alarm>0;
      const atCreek=a.seed===4 || a.seed===5;
      if(atCreek){
        if(!a.aware&&range<16){a.aware=true;a.watch=4.6+.35*(a.seed%3);}
        if(range>21)a.aware=false;
        a.watch=Math.max(0,(a.watch??0)-dt);
      }
      // A quiet visitor eventually becomes part of the meadow. The younger
      // animal goes back to feeding first. A new footfall renews the watch.
      let meadowWatch=false;
      if(a.kind===0&&a.seed<=2){
        a.quietTime=range>=18||noisy?0:(a.quietTime??0)+dt;
        const firstWatch=a.seed===1?9.6:4.3;
        const cycle=a.seed===1?18.7:24.1;
        const feeding=a.quietTime-firstWatch;
        meadowWatch=feeding<0||feeding%cycle>cycle-(a.seed===1?3.4:2.1);
      }
      const attentive=a.kind===0&&range<18&&(meadowWatch || (atCreek&&(a.watch>0||(t+a.phase*2.5)%26<(a.seed===4?21:12))));
      const roam=!attentive&&(t+a.phase*4)%34>28;
      setState(a,flee?(a.kind===0?'Bound':'Hop'):roam?(a.kind===0?'Walk':'Hop'):(a.kind===0?(attentive?'Attend':'Graze'):'Listen'));
      a.attention=T.MathUtils.damp(a.attention??0,attentive&&!flee&&a.seed===1?1:0,3.8,dt);
      if(a.gaze.length&&(a.attention>.001||a.gaze.some(g=>Math.abs(g.yaw)>.001)))attend(a,dt);
      if(a.ears)listen(a,player,range,noisy,dt);
      const lastX=p.x,lastZ=p.z,lastYaw=a.root.rotation.y;
      if(flee||roam){
        let theta = flee?Math.atan2(-dx,-dz):a.phase+.3*Math.sin(t*.3);
        if(!flee && Math.hypot(p.x-a.home.x,p.z-a.home.y)>8)theta=Math.atan2(p.x-a.home.x,p.z-a.home.y);
        const obstruction=(angle,reach)=>{
          walkRay.origin.copy(p);walkRay.direction.set(-Math.sin(angle),0,-Math.cos(angle));
          walkRay.at(reach,destination);
          const {x,z}=destination,pad=.24*a.root.scale.x,bed=ground.height(x,z);
          if(a.obstacles.rocks.some(({bounds:b})=>{
            if(b.max.y<=bed+pad)return false;
            paddedRock.min.set(b.min.x-pad,p.y-1,b.min.z-pad);
            paddedRock.max.set(b.max.x+pad,p.y+1,b.max.z+pad);
            if(paddedRock.containsPoint(p))return paddedRock.containsPoint(destination);
            // A clear endpoint beyond a corner can still require walking through it.
            return walkRay.intersectBox(paddedRock,rockHit)!==null&&p.distanceToSquared(rockHit)<reach*reach;
          }))return 'rock';
          if(land.isWater(x,z)||a.obstacles.trees.some(b=>!b.removed&&(b.x-x)**2+(b.z-z)**2<(b.radius+.25)**2)
            ||(a.footing&&!hasFootSupport(ground,x,z,angle,a.root.scale.x)))return 'blocked';
          return null;
        };
        const lookAhead=(flee?.85:.47)*a.root.scale.x;
        const blocked=obstruction(theta,lookAhead);
        if(blocked){
          const side=a.detour??(a.seed%2?1:-1);
          // A broad rock face takes several strides to skirt. Follow the
          // chosen side to its corner before considering a reversal.
          const turns=blocked==='rock'?[.75,1.5,1.77,2.3,-.75,-1.5,-1.77,-2.3]:[.75,-.75,1.5,-1.5,2.3,-2.3];
          for(const turn of turns){
            const offset=turn*side;
            if(!obstruction(theta+offset,lookAhead)){theta+=offset;a.detour=Math.sign(offset);break;}
          }
        }
        const error=Math.atan2(Math.sin(theta-lastYaw),Math.cos(theta-lastYaw));
        const maxTurn=(flee?3.6:1.85)*dt;
        const angle=lastYaw+T.MathUtils.clamp(error,-maxTurn,maxTurn);
        a.root.rotation.y=angle;
        const targetSpeed=(flee?(a.kind===0?4.8:2.8):.64)*T.MathUtils.clamp(.25+.75*Math.cos(error),.10,1);
        a.speed=T.MathUtils.damp(a.speed,targetSpeed,flee?6.8:4,dt);
        if(!obstruction(angle,dt*a.speed)){
          p.x-=Math.sin(angle)*dt*a.speed;p.z-=Math.cos(angle)*dt*a.speed;
        }
      }else a.speed=T.MathUtils.damp(a.speed,0,6,dt);
      const stepPhase=a.actions[a.state]?.time??t;
      const bound=a.kind===0&&a.state==='Bound';
      const bounce=a.kind===2&&(flee||roam)?Math.abs(Math.sin(stepPhase*(flee?9.4:6.5)))*.18:
        bound?.055*(1-Math.cos(4*Math.PI*stepPhase/a.actions.Bound.getClip().duration))*a.root.scale.x:0;
      p.y=ground.height(p.x,p.z)+bounce;
      if(a.kind===0){paceDeer(a,Math.hypot(p.x-lastX,p.z-lastZ)+Math.abs(a.root.rotation.y-lastYaw)*.63*a.root.scale.x,dt);plantHooves(a,ground,dt);}
    }
  },hearStep(point,radius){
    for(const a of herd){
      if(!a.ears||a.dead||a.root.position.distanceToSquared(point)>radius*radius)continue;
      a.heard=1.6;
      if(a.seed<=2)a.quietTime=0;
    }
  },hit(from,to){
    direction.subVectors(to,from);const distance=direction.length();
    ray.set(from,direction.normalize());ray.far=distance+.12;
    let nearest;
    for(const a of herd){
      if(ray.ray.distanceSqToPoint(a.root.position)>9 || a.root.position.distanceToSquared(from)>(distance+3)**2)continue;
      a.root.updateMatrixWorld(true);
      const hits=[];
      for(const mesh of a.skin)intersectPosedMesh(mesh,ray,hits);
      for(const hit of hits)if(!nearest||nearest.distance>hit.distance)nearest={...hit,animal:a};
    }
    if(nearest){
      const mesh=nearest.object,weights=mesh.geometry.attributes.skinWeight,indices=mesh.geometry.attributes.skinIndex;
      const totals=new Float32Array(mesh.skeleton.bones.length);
      for(const vertex of [nearest.face.a,nearest.face.b,nearest.face.c]){
        for(let slot=0;slot<4;slot++)totals[indices.getComponent(vertex,slot)]+=weights.getComponent(vertex,slot);
      }
      nearest.bone=mesh.skeleton.bones[totals.indexOf(Math.max(...totals))];
    }
    return nearest;
  }, disturb(p){for(const a of herd)if(a.root.position.distanceToSquared(p)<18**2)a.startle=.23+.018*(a.seed%4);},
  drop(a){
    if(a.dead)return;
    a.dead=true;a.side=Math.sign(Math.sin(a.seed))||1;a.vy=0;
    if(a.actions.Fold){a.actions.Fold.setLoop(T.LoopOnce,1);a.actions.Fold.clampWhenFinished=true;setState(a,'Fold');}
  }};
}
