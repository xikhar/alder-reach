import {firstRockHit} from './rock-contact.js';
import * as T from 'three';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {model} from './fauna.js';
export async function createBow(ctx,fauna) {
  const {scene,camera,player,land,plants,notify,sound}=ctx;
  const [bow,arrow,hand]=await Promise.all(['field-bow','field-arrow','archer-hand'].map(model));
  const view=new T.Group(), grip=clone(bow.scene), left=clone(hand.scene),right=clone(hand.scene);
  const nock=clone(arrow.scene);
  view.add(grip,left,right,nock);camera.add(view);view.visible=false;view.scale.setScalar(.69);
  grip.position.set(-.18,-.17,-.81);grip.rotation.z=-.24;
  left.position.copy(grip.position);left.rotation.set(.70,-.69,.43);right.scale.x=-1;
  const grips=[left,right].map(h=>{const m=new T.AnimationMixer(h);m.clipAction(hand.animations[0]).play();return m;});
  const vertices=new Float32Array(9);
  const cord=new T.BufferGeometry();cord.setAttribute('position',new T.BufferAttribute(vertices,3));
  const line=new T.Line(cord,new T.LineBasicMaterial({color:0x998573}));line.frustumCulled=false;view.add(line);
  const arrows=[];const temp=new T.Vector3(),next=new T.Vector3(),dir=new T.Vector3(),axis=new T.Vector3(0,0,-1);
  let draw=-1,release=0,releasedCharge=0,count=12;
  const state={get count(){return count},get charge(){return Math.max(0,Math.min(1,draw/1.1))},arrows};
  function down(){if(draw>=0)return;if(!count){notify('Retrieve an arrow to refill your quiver');return;}draw=0;sound('bowCreak',player);}
  function up(){
    if(draw<0)return;
    const power=Math.min(1,draw/1.1);releasedCharge=power;draw=-1;release=.38;
    const root=clone(arrow.scene);scene.add(root);
    camera.getWorldDirection(dir);root.position.copy(player).addScaledVector(dir,.9);
    root.quaternion.setFromUnitVectors(axis,dir);arrows.push({root,velocity:dir.clone().multiplyScalar(20+29*power),stuck:false,age:0});
    count--;sound('bowRelease',player);sound('arrowWhoosh',root.position);fauna.disturb(player);
  }
  function nearest(){let nearest=null,d=3.8;for(const a of arrows)if(a.stuck){a.root.getWorldPosition(temp);const dist=temp.distanceTo(player);if(dist<d){d=dist;nearest=a;}}return nearest;}
  const flightRay=new T.Ray(),contact=new T.Vector3();
  function objectCollision(from,to){
    const length=from.distanceTo(to);
    flightRay.set(from,dir.subVectors(to,from).normalize());
    let nearest=ctx.camp.raycast(flightRay,length);
    const consider=(distance,point,tree)=>{
      if(distance>=0 && distance<=length && (!nearest||distance<nearest.distance))
        nearest={distance,point:point.clone(),tree};
    };
    for(const tree of plants.trees){
      if(tree.removed||Math.abs(tree.x-from.x)>length+1||Math.abs(tree.z-from.z)>length+1)continue;
      const px=from.x-tree.x,pz=from.z-tree.z,v=flightRay.direction;
      const a=v.x*v.x+v.z*v.z,b=px*v.x+pz*v.z,c=px*px+pz*pz-tree.radius**2;
      const disc=b*b-a*c;if(disc<0||a<.000001)continue;
      const d=(-b-Math.sqrt(disc))/a;
      flightRay.at(d,contact);
      if(contact.y>tree.y && contact.y<tree.y+tree.height)consider(d,contact,tree);
    }
    const rockHit=firstRockHit(plants.rocks,flightRay,length);
    if(rockHit)consider(rockHit.distance,rockHit.point);
    const trailHit=land.traceTrail(flightRay,length);
    if(trailHit)consider(trailHit.distance,trailHit.point);
    return nearest;
  }
  function surfaceHit(from,to){
    const probe=new T.Vector3();
    const level=p=>land.isWater(p.x,p.z)?land.waterSurfaceY(p.x,p.z):land.height(p.x,p.z);
    if(to.y>level(to))return null;
    let lo=0,hi=1;
    for(let i=0;i<8;i++){
      const t=(lo+hi)*.5;probe.lerpVectors(from,to,t);
      if(probe.y>level(probe))lo=t;else hi=t;
    }
    probe.lerpVectors(from,to,hi);probe.y=level(probe);
    return {point:probe,distance:from.distanceTo(probe),water:land.isWater(probe.x,probe.z)};
  }
  return {state,down,up,cancel(){draw=-1;release=0;view.visible=false;},hint(){return nearest()?'E  ·  Retrieve arrow':'';},
    interact(){const a=nearest();if(!a)return false;a.root.removeFromParent();arrows.splice(arrows.indexOf(a),1);count++;notify('Arrow recovered');return true;},
    update(dt){
      if(draw>=0)draw+=dt;release=Math.max(0,release-dt);
      view.visible=ctx.tool()==='bow'&&(draw>=0||release>0);
      if(view.visible){
        const p=draw>=0?state.charge:releasedCharge*Math.exp(-(.38-release)*17);
        grip.traverse(o=>{if(o.morphTargetInfluences)o.morphTargetInfluences[0]=p;});
        const recoil=draw>=0?0:Math.sin((.38-release)*29)*Math.exp(-(.38-release)*12);
        view.rotation.z=recoil*.034;view.position.y=release>0?-.22*(1-release/.38)**2:0;
        right.position.set(-.158+.20*p,-.148+.024*p,-.63+.39*p);
        right.rotation.set(.60,.63,-.68);
        const rest=new T.Vector3(-.145,-.135,-.89);
        dir.subVectors(rest,right.position).normalize();nock.position.copy(right.position).addScaledVector(dir,.31);
        nock.quaternion.setFromUnitVectors(axis,dir);nock.visible=draw>=0;
        const top=new T.Vector3(.03,.75-.052*p,.14+.14*p).applyQuaternion(grip.quaternion).add(grip.position);
        const bottom=new T.Vector3(-.03,-.75+.052*p,.14+.14*p).applyQuaternion(grip.quaternion).add(grip.position);
        top.toArray(vertices,0);right.position.toArray(vertices,3);bottom.toArray(vertices,6);cord.attributes.position.needsUpdate=true;
        for(const m of grips)m.update(dt);
      }
      for(const a of arrows){
        if(a.stuck)continue;
        a.age+=dt;const p=a.root.position;
        a.velocity.y-=9.81*dt;next.copy(p).addScaledVector(a.velocity,dt);
        const animal=fauna.hit(p,next), solid=objectCollision(p,next);
        const surface=surfaceHit(p,next);
        a.root.quaternion.setFromUnitVectors(axis,dir.copy(a.velocity).normalize());
        const hit=[animal,solid,surface].filter(Boolean).sort((left,right)=>left.distance-right.distance)[0];
        if(hit){
          p.copy(hit.point);
          if(hit===animal){
            fauna.drop(animal.animal);(animal.bone || animal.animal.root).attach(a.root);
          }else if(hit===solid){
            if(solid.object)solid.object.attach(a.root);
            if(solid.tree){solid.tree.lodged??=[];solid.tree.lodged.push(a.root);}
          }
          a.stuck=true;a.root.getWorldPosition(temp);sound(hit.water?'splash':'arrowThunk',temp);continue;
        }
        p.copy(next);
      }
    }};
}
