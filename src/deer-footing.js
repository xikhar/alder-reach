import gaits from './deer-gaits.json';
import {MathUtils,Quaternion,Vector3} from 'three';

const tags=['fl','fr','hl','hr'];
const up=new Vector3(0,1,0),normal=new Vector3(),hoofScale=new Vector3(),ankle=new Vector3();
const anchor=new Vector3(),axis=new Vector3(),original=new Vector3(),desired=new Vector3();
const rotation=new Quaternion(),slopeRotation=new Quaternion(),yawRotation=new Quaternion(),parent=new Quaternion();
const contact=new Vector3();
const kneePole=new Vector3(),hockPole=new Vector3(),line=new Vector3(),perp=new Vector3();

// Locate the horn contact patch on the native skinned mesh once, in hoof-local coordinates.
export function createFooting(root){
  root.updateMatrixWorld(true);
  const rootInverse=root.getWorldQuaternion(new Quaternion()).invert();
  const feet=tags.map(tag=>{
    const bones=['','tibia','cannon','hoof'].map(name=>root.getObjectByName(tag+name)),hoof=bones[3];
    return {tag,planted:false,liftoff:false,pin:new Vector3(),pinYaw:0,hip:bones[0],hoof,bones,patch:[],sole:new Vector3(),at:new Vector3(),goal:new Vector3(),
      soleRotation:hoof.getWorldQuaternion(new Quaternion()).premultiply(rootInverse),
      rotation:new Quaternion(),pose:bones.map(()=>new Quaternion()),
      joints:bones.map(()=>new Vector3()),lengths:[0,0,0]};
  });
  root.traverse(mesh=>{
    if(!mesh.isSkinnedMesh||mesh.material.name!=='Cloven horn')return;
    const indices=mesh.geometry.attributes.skinIndex;
    for(let i=0;i<indices.count;i++){
      const bone=mesh.skeleton.bones[indices.getX(i)],f=feet.find(f=>f.hoof===bone);
      if(f)f.patch.push(mesh.getVertexPosition(i,new Vector3()).applyMatrix4(mesh.matrixWorld));
    }
  });
  for(const f of feet){
    if(!f.patch.length)return null;
    const low=Math.min(...f.patch.map(v=>v.y)),underside=f.patch.filter(v=>v.y<low+.003*root.scale.x);
    for(const v of underside)f.sole.add(v);
    f.sole.multiplyScalar(1/underside.length);f.rest=root.worldToLocal(f.sole.clone());
    f.hoof.worldToLocal(f.sole);
    // Weld coincident corners and keep the two lower rings of the cloven toes.
    const unique=new Map();
    for(const v of f.patch)if(v.y<low+.021*root.scale.x){
      f.hoof.worldToLocal(v);
      unique.set([v.x,v.y,v.z].map(q=>Math.round(q*100000)).join(','),v);
    }
    f.patch=[...unique.values()];
  }
  return {feet,blend:0,posed:false,gait:null};
}

export function releaseFooting(rig){
  if(!rig?.posed)return;
  for(const f of rig.feet)for(let i=0;i<4;i++)f.bones[i].quaternion.copy(f.pose[i]);
  rig.posed=false;
}

// Test the whole resting footprint before stepping onto a steep bank or drop.
export function hasFootSupport(land,x,z,yaw,scale){
  const h=land.height(x,z),r=.70*scale,dx=-Math.sin(yaw)*r,dz=-Math.cos(yaw)*r;
  for(const sign of [-1,1])for(const side of [-.42,.42]){
    const footing=land.height(x+sign*dx-side*dz,z+sign*dz+side*dx);
    if(Math.abs(footing-h)>r*.54)return false;
  }
  return true;
}

function placeJoint(start,end,first,second,pole,out){
  line.subVectors(end,start);
  const d=Math.max(.000001,line.length());line.divideScalar(d);
  const along=MathUtils.clamp((first*first+d*d-second*second)/(2*d),-first,first);
  perp.copy(pole).addScaledVector(line,-line.dot(pole));
  if(perp.lengthSq()<1e-12){
    perp.set(0,0,1).addScaledVector(line,-line.z);
    if(perp.lengthSq()<1e-12)perp.set(1,0,0);
  }
  out.copy(start).addScaledVector(line,along).addScaledVector(perp.normalize(),Math.sqrt(Math.max(0,first*first-along*along)));
}
function solveLeg(f,blend,moving){
  const joints=f.joints;
  for(let i=0;i<4;i++)f.bones[i].getWorldPosition(joints[i]);
  for(let i=0;i<3;i++)f.lengths[i]=joints[i].distanceTo(joints[i+1]);
  anchor.copy(joints[0]);ankle.lerpVectors(joints[3],f.goal,blend);
  if(moving){
    const [hip,knee,hock,hoof]=joints,[a,b,c]=f.lengths;
    kneePole.subVectors(knee,hip);hockPole.subVectors(hock,knee);
    const d=hip.distanceTo(ankle);
    const span=MathUtils.clamp(knee.distanceTo(hoof),Math.max(Math.abs(b-c),d-a),Math.min(b+c,d+a));
    placeJoint(hip,ankle,a,span,kneePole,knee);
    placeJoint(knee,ankle,b,c,hockPole,hock);hoof.copy(ankle);
  }
  // Resting animals retain the native bend in their three-joint grazing stance.
  for(let iter=0;!moving&&iter<42&&joints[3].distanceToSquared(ankle)>0.00000001;iter++){
    joints[3].copy(ankle);
    for(let i=2;i>=0;i--){
      axis.subVectors(joints[i],joints[i+1]).setLength(f.lengths[i]);
      joints[i].copy(joints[i+1]).add(axis);
    }
    joints[0].copy(anchor);
    for(let i=0;i<3;i++){
      axis.subVectors(joints[i+1],joints[i]).setLength(f.lengths[i]);
      joints[i+1].copy(joints[i]).add(axis);
    }
  }
  for(let i=0;i<3;i++){
    const bone=f.bones[i];bone.getWorldPosition(anchor);f.bones[i+1].getWorldPosition(original);
    original.sub(anchor).normalize();desired.subVectors(joints[i+1],anchor).normalize();
    rotation.setFromUnitVectors(original,desired);bone.parent.getWorldQuaternion(parent);
    rotation.premultiply(slopeRotation.copy(parent).invert()).multiply(parent);
    bone.quaternion.premultiply(rotation);bone.updateWorldMatrix(false,true);
  }
  f.hoof.parent.getWorldQuaternion(parent);
  f.hoof.quaternion.slerp(parent.invert().multiply(f.rotation),blend);
}

// The native clip and the simulated body must cover the same ground in a cycle.
export function paceDeer(actor,metres,dt){
  const gait=gaits[actor.state];if(!gait||dt<=0)return;
  const action=actor.actions[actor.state];
  action.timeScale=MathUtils.clamp(metres*action.getClip().duration/(dt*gait.stride*actor.root.scale.x),0,2.7);
}

function setTarget(f,land,x,z,scale,heading,elevation,air){
  const r=.041*scale;
  normal.set(land.height(x-r,z)-land.height(x+r,z),2*r,land.height(x,z-r)-land.height(x,z+r)).normalize();
  yawRotation.setFromAxisAngle(up,heading);
  f.rotation.setFromUnitVectors(up,normal).multiply(yawRotation).multiply(f.soleRotation);
  if(air>0)f.rotation.slerp(f.hoof.getWorldQuaternion(rotation),air);
  f.hoof.getWorldScale(hoofScale);
  let soleY=-Infinity;
  for(const v of f.patch){
    contact.subVectors(v,f.sole).multiply(hoofScale).applyQuaternion(f.rotation);
    soleY=Math.max(soleY,land.height(x+contact.x,z+contact.z)-contact.y);
  }
  f.goal.set(x,soleY+.002+elevation,z).sub(contact.copy(f.sole).multiply(hoofScale).applyQuaternion(f.rotation));
}

export function plantHooves(a,land,dt){
  const rig=a.footing;if(!rig)return;
  const gait=gaits[a.state],moving=!!gait;
  const standing=a.state==='Graze'||a.state==='Attend';
  rig.blend=moving?1:MathUtils.damp(rig.blend,standing?1:0,9,dt);
  if((standing||moving)&&rig.blend>.995)rig.blend=1;
  if(rig.blend<.003){a.root.rotation.x=0;a.root.rotation.z=0;return;}
  const heading=a.root.rotation.y,x=a.root.position.x,z=a.root.position.z,scale=a.root.scale.x;
  const stride=.52*scale,fx=-Math.sin(heading)*stride,fz=-Math.cos(heading)*stride;
  const grade=(ax,az)=>Math.atan2(land.height(x+ax,z+az)-land.height(x-ax,z-az),2*stride);
  a.root.rotation.x=MathUtils.damp(a.root.rotation.x,.82*MathUtils.clamp(grade(fx,fz),-.54,.54)*rig.blend,8,dt);
  a.root.rotation.z=MathUtils.damp(a.root.rotation.z,.72*MathUtils.clamp(grade(-fz,fx),-.46,.46)*rig.blend,8,dt);
  const action=a.actions[a.state],phase=moving?action.time/action.getClip().duration:0;
  if(rig.gait!==a.state){
    for(const f of rig.feet){f.planted=false;f.liftoff=false;}
    rig.gait=a.state;
  }
  a.root.updateWorldMatrix(true,true);
  let lower=moving?0:.14*scale;
  for(const f of rig.feet){
    for(let i=0;i<4;i++)f.pose[i].copy(f.bones[i].quaternion);
    f.hoof.localToWorld(f.at.copy(f.sole));
    let x=f.at.x,z=f.at.z,yaw=heading,lift=0,air=0;
    if(moving){
      const step=(phase-gait.touchdown[f.tag]+1)%1;
      if(step<gait.duty){
        if(!f.planted){
          // Place the hoof ahead of its neutral footprint at touchdown.
          // The body passes over that point through the support interval.
          f.pin.copy(f.rest);f.pin.z-=(gait.duty*.5-step)*gait.stride;
          a.root.localToWorld(f.pin);f.pinYaw=heading;
        }
        f.planted=true;f.liftoff=true;x=f.pin.x;z=f.pin.z;yaw=f.pinYaw;
      }else{
        f.planted=false;
        const flight=(step-gait.duty)/(1-gait.duty);
        air=Math.sin(Math.PI*flight)**1.3;
        const ease=flight*flight*(3-2*flight);
        contact.copy(f.rest);contact.z-=gait.stride*(ease-.5*gait.duty-(1-gait.duty)*flight);
        a.root.localToWorld(contact);x=contact.x;z=contact.z;
        if(f.liftoff){
          const swing=MathUtils.smoothstep(flight,0,.32);
          x=MathUtils.lerp(f.pin.x,x,swing);z=MathUtils.lerp(f.pin.z,z,swing);
        }
        // Keep authored fore/hind recovery and toe curl over uneven ground.
        const local=a.root.worldToLocal(ankle.copy(f.at));
        lift=Math.max((a.state==='Bound'?.15:.075)*scale*air,
          (local.y-f.rest.y)*scale*MathUtils.smoothstep(air,0,.5));
      }
    }
    setTarget(f,land,x,z,scale,yaw,lift,air);
    if(moving){
      // Allow the pelvis to settle until all supporting legs can reach their
      // targets while keeping their original segment lengths.
      for(let i=0;i<4;i++)f.bones[i].getWorldPosition(f.joints[i]);
      const [hip,knee,pastern,hoof]=f.joints;
      const reach=.97*(hip.distanceTo(knee)+knee.distanceTo(pastern)+pastern.distanceTo(hoof));
      const lateral=(hip.x-f.goal.x)**2+(hip.z-f.goal.z)**2;
      lower=Math.min(lower,f.goal.y+Math.sqrt(Math.max(.01,reach*reach-lateral))-hip.y);
    }else{
      f.hoof.getWorldPosition(ankle);lower=Math.min(lower,f.goal.y-ankle.y);
    }
  }
  a.root.position.y+=(moving?Math.max(lower,-.28*scale):lower-.022*scale)*rig.blend;
  a.root.updateWorldMatrix(true,true);
  for(const f of rig.feet)solveLeg(f,rig.blend,moving);
  rig.posed=true;
}
