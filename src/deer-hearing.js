import {MathUtils,Quaternion,Vector3} from 'three';

const direction=new Vector3(),facing=new Vector3(),up=new Vector3();
const world=new Quaternion(),rotation=new Quaternion();

export function deerEars(actor){
  const skeleton=actor.skin[0].skeleton;
  return [['Ear.l',1],['Ear.r',-1]].map(([name,side])=>{
    const bone=skeleton.bones.find(b=>(b.userData.name||b.name)===name||b.name===name.replace('.',''));
    // Normal of the auricular bowl in the authored, forward-facing mesh.
    const bowl=new Vector3(.15*side,.15,-1).normalize().applyQuaternion(actor.root.getWorldQuaternion(world));
    bowl.applyQuaternion(bone.getWorldQuaternion(world).invert());
    return {bone,side,bowl,yaw:0,authored:new Quaternion()};
  });
}

export function restoreEars(actor){
  if(!actor.earsApplied)return;
  for(const ear of actor.ears)ear.bone.quaternion.copy(ear.authored);
  actor.earsApplied=false;
}

export function listen(actor,visitor,range,moving,dt){
  actor.heard=Math.max(0,(actor.heard||0)-dt);
  if(moving&&range<17)actor.heard=1.6;
  const alert=actor.state==='Attend'||(actor.heard>0&&actor.state!=='Bound');
  const strength=alert?1-MathUtils.smoothstep(range,10,18):0;
  if(strength===0&&actor.ears.every(e=>Math.abs(e.yaw)<.001))return;
  direction.subVectors(visitor,actor.root.position).normalize();
  const heading=actor.root.rotation.y;
  const lateral=direction.x*Math.cos(heading)-direction.z*Math.sin(heading);
  for(const ear of actor.ears){
    const bone=ear.bone;
    bone.getWorldPosition(facing);
    direction.subVectors(visitor,facing);
    facing.copy(ear.bowl).applyQuaternion(bone.getWorldQuaternion(world));
    const angle=Math.atan2(direction.x,direction.z)-Math.atan2(facing.x,facing.z);
    let error=Math.atan2(Math.sin(angle),Math.cos(angle));
    if(Math.abs(error)>2.62&&Math.abs(ear.yaw)>.04)error=Math.sign(ear.yaw)*Math.abs(error);
    const near=MathUtils.smoothstep(lateral*ear.side,-.55,.55);
    const target=MathUtils.clamp(error,-1.13,1.13)*strength*(.42+.54*near);
    const step=MathUtils.damp(ear.yaw,target,4.1+5.4*near,dt)-ear.yaw;
    ear.yaw+=MathUtils.clamp(step,-3.15*dt,3.15*dt);
    ear.authored.copy(bone.quaternion);
    up.set(0,1,0).applyQuaternion(bone.parent.getWorldQuaternion(world).invert());
    bone.quaternion.premultiply(rotation.setFromAxisAngle(up,ear.yaw));
  }
  actor.earsApplied=true;
}
