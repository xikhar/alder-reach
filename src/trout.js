import * as T from 'three';

const tau=Math.PI*2;
const clamp=T.MathUtils.clamp;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
function hash(a,b){
  let n=Math.imul(a,1597334677)^Math.imul(b+31,3812015801);
  n=Math.imul(n^(n>>>16),2246822519);
  return ((n^(n>>>13))>>>0)/4294967296;
}

// Each holding pool is fixed to the streambed. The same fish can be inspected,
// approached with a cast, hooked, released, or removed from this population.
export function createTroutSchool(group,model,clip,land){
  const fish=[],caught=new Set(),target=new T.Vector3();
  const lastEye=new T.Vector2(Infinity,Infinity);
  for(let i=0;i<12;i++){
    const root=model('Trout'),mixer=new T.AnimationMixer(root);
    const action=mixer.clipAction(clip);action.play();
    root.name='Brook trout';root.visible=false;group.add(root);
    fish.push({root,mixer,action,site:null,returning:false});
  }
  function sitesAround(eye){
    const options=[];
    for(let row=Math.floor((eye.z-38)/5);row<=Math.ceil((eye.z+38)/5);row++){
      const z=row*5+hash(row,5)*1.8;
      const mid=land.streamX(z),width=land.streamWidth(z);
      const lanes=Math.max(1,Math.ceil(width*.13));
      for(let lane=0;lane<lanes;lane++){
        const id=row+'/'+lane;
        if(caught.has(id))continue;
        const fraction=(lane+.38+.24*hash(row,lane))/lanes*1.44-.72;
        const x=mid+fraction*width,range=Math.hypot(eye.x-x,eye.z-z);
        if(range>39)continue;
        options.push({id,z,fraction,range,phase:tau*hash(row,lane+7),
          scale:.63+.34*hash(row,lane+36),period:17+10*hash(row,lane+13)});
      }
    }
    return options.sort((a,b)=>a.range-b.range);
  }
  const water=land.waterSurfaceY,bedHeight=land.contactHeight??land.height,downstream=new T.Vector3();
  // Enclose the body and fins between the moving surface and the channel bed.
  function submerge(pos,scale,yaw,depth){
    let bed=-Infinity,surface=Infinity;
    const dx=Math.cos(yaw),dz=-Math.sin(yaw);
    for(const offset of [-.45,0,.32]){
      const x=pos.x+offset*scale*dx,z=pos.z+offset*scale*dz;
      bed=Math.max(bed,bedHeight(x,z));surface=Math.min(surface,water(x,z));
    }
    pos.y=clamp(surface-depth,bed+.145*scale+.024,surface-.18*scale-.014);
  }
  function course(site,time,out){
    const a=time*tau/site.period+site.phase,b=a+.17*Math.sin(2*a);
    const z=site.z+2.05*Math.sin(b),width=land.streamWidth(z);
    const x=land.streamX(z)+width*site.fraction+.38*Math.cos(b)+.09*Math.sin(3*a);
    out.set(x,0,z);
  }
  function pose(site,time,pos){
    course(site,time,pos);course(site,time+.04,downstream);
    const yaw=Math.atan2(pos.z-downstream.z,downstream.x-pos.x);
    const b=time*tau/site.period+site.phase;
    submerge(pos,site.scale,yaw,.31+.065*Math.sin(2*b)+.02*Math.sin(5*b));
    return {yaw,pitch:.042*Math.sin(2*b+site.phase),roll:.045*Math.cos(3*b)};
  }
  function stations(eye,elapsed,active){
    if(Math.hypot(lastEye.x-eye.x,lastEye.y-eye.z)<2.5)return;
    lastEye.set(eye.x,eye.z);
    const desired=sitesAround(eye).slice(0,fish.length);
    const ids=new Set(desired.map(s=>s.id));
    for(const f of fish)if(f!==active&&f.site&&!ids.has(f.site.id)){
      f.root.visible=false;f.site=null;f.returning=false;
    }
    const occupied=new Set(fish.filter(f=>f.site).map(f=>f.site.id));
    for(const site of desired){
      if(occupied.has(site.id))continue;
      const f=fish.find(f=>!f.site);if(!f)break;
      f.site=site;f.root.visible=true;f.root.scale.setScalar(site.scale);
      f.action.time=site.phase/tau*f.action.getClip().duration;
      const p=pose(site,elapsed,f.root.position);
      f.root.rotation.set(p.roll,p.yaw,p.pitch,'YXZ');
    }
  }
  function swimTo(f,goal,dt,speed,turnRate){
    const root=f.root,dx=goal.x-root.position.x,dz=goal.z-root.position.z;
    const length=root.position.distanceTo(goal);
    if(dx*dx+dz*dz>.0004){
      const delta=Math.atan2(-dz,dx)-root.rotation.y;
      root.rotation.y+=clamp(Math.atan2(Math.sin(delta),Math.cos(delta)),-turnRate*dt,turnRate*dt);
    }
    if(length>.00001)root.position.lerp(goal,Math.min(1,dt*speed/length));
    return length;
  }
  function update(dt,time,eye,active){
    stations(eye,time,active);
    for(const f of fish){
      if(!f.site||f===active)continue;
      const p=pose(f.site,time,target);
      if(f.returning){
        if(swimTo(f,target,dt,1.0,4.2)<.035)f.returning=false;
        submerge(f.root.position,f.site.scale,f.root.rotation.y,.30);
      }else{f.root.position.copy(target);f.root.rotation.y=p.yaw;}
      f.root.rotation.x=p.roll;f.root.rotation.z=p.pitch;
      f.mixer.timeScale=.84+.12*Math.cos(time*tau/f.site.period+f.site.phase);f.mixer.update(dt);
    }
  }
  function nearest(point){
    let result=null,range=18;
    for(const f of fish)if(f.site&&f.root.visible){
      const d=distance(f.root.position,point);
      if(d<range){range=d;result=f;}
    }
    return result;
  }
  function release(f,harvest){
    if(!f)return;
    if(harvest){
      caught.add(f.site.id);f.root.visible=false;f.site=null;
      lastEye.set(Infinity,Infinity);
    }else f.returning=true;
  }
  function wetTarget(position,point,scale){
    const z=position.z,middle=land.streamX(z);
    let x=position.x;
    // A caught fish can beach only once lifted. Follow the channel's last
    // sufficiently deep water while the angler reels from a high or dry bank.
    for(let i=0;i<16;i++){
      const half=.26*scale;
      const depth=Math.min(water(x-half,z)-bedHeight(x-half,z),water(x+half,z)-bedHeight(x+half,z));
      if(depth>.41*scale+.045)break;
      x+=(middle-x)*.21;
    }
    point.set(x,position.y,z);
    return point;
  }
  return {fish,pose,nearest,release,update,swimTo,submerge,wetTarget,sitesAround};
}
