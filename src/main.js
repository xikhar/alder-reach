import {walkingSurface} from './rock-contact.js';
import * as T from 'three';
import './ui.css';
import {createAtmosphere} from './light.js';
import {installSunFilter,addClearingLight} from './sunlight.js';
import * as land from './land.js';
import {createPlants} from './plants.js';
import {createFauna} from './fauna.js';
import {createBow} from './bow.js';
import {createCamp} from './camp.js';
import {createAudio} from './audio.js';
import {createUnderstory} from './understory.js';

const $=id=>document.getElementById(id);
async function start(){
  installSunFilter();
  const renderer=new T.WebGLRenderer({canvas:$('world'),antialias:true,powerPreference:'high-performance'});
  const quality=Math.min(devicePixelRatio,1.5);
  renderer.setPixelRatio(quality);renderer.setSize(innerWidth,innerHeight,false);
  renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1;
  renderer.info.autoReset=false;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;
  const scene=new T.Scene(), camera=new T.PerspectiveCamera(63,innerWidth/innerHeight,.055,8000);
  camera.rotation.order='YXZ';scene.add(camera);
  const hemi=new T.HemisphereLight(0xc4d8f3,0x998b73,1.30),sun=new T.DirectionalLight(0xffcf94,2.72);
  sun.position.set(-75,82,-35);sun.castShadow=true;
  const s=sun.shadow;s.mapSize.set(3072,3072);Object.assign(s.camera,{left:-31,right:31,top:31,bottom:-31,near:.5,far:170});s.bias=-.00032;s.normalBias=.018;
  scene.add(hemi,sun,sun.target);const terrain=await land.createLand(scene);
  const renderForest=createAtmosphere(renderer,camera,sun,land,terrain.cloudSunlight),clearingLight=addClearingLight(scene,land,terrain);
  const player=camera.position,keys=new Set(),audio=createAudio(),look=new T.Vector3();
  const velocity=new T.Vector2(),intent=new T.Vector2();
  let gait=0,bob=0,lean=0;
  let yaw=.08,pitch=-.04,mode='bow',playing=false,wasPlaying=false,book=false,entered=false,hud=true;
  let muted=false,music=true,place='trail',clock=0,last=performance.now(),step=0,noticeUntil=0,jump=0,vertical=0,dusk=0,goalDusk=0;
  const locations={trail:{name:'Birchwood Trail',detail:'Birch grove and wildflower path',x:land.trailX(0),z:0,yaw:.08,pitch:-.04},
    camp:{name:'Woodcutters’ Camp',detail:'Chopping block, wood rack and fire ring',x:6.3,z:-20.3,yaw:-.09,pitch:-.16},
    creek:{name:'Pebble Creek',detail:'Brook trout and a pebbled ford',x:land.streamX(-39.45)+3.08,z:-39.45,yaw:1.54,pitch:.010},
    meadow:{name:'Deer Meadow',detail:'Grazing ground at the forest edge',x:11.9,z:-32.05,yaw:-.21,pitch:-.064},
    overlook:{name:'River Overlook',detail:'High grass above the alpine valley',x:-2.3,z:-84.8,yaw:.08,pitch:-.055}};
  const walkGround={height:land.contactHeight};
  function travel(key){
    const l=locations[key];player.set(l.x,land.contactHeight(l.x,l.z)+1.67,l.z);yaw=l.yaw;pitch=l.pitch;velocity.set(0,0);bob=lean=0;orient();jump=vertical=0;place=key;
  }
  function orient(){camera.rotation.set(pitch,yaw,lean,'YXZ');camera.updateMatrixWorld();}
  travel('trail');
  const notify=msg=>{$('notice').textContent=msg;$('notice').style.opacity=1;noticeUntil=clock+2.7;};
  const plants=await createPlants(scene,land,terrain.woodland,locations.meadow,locations.overlook,locations.camp,locations.creek);
  const ctx={THREE:T,scene,camera,player,land,plants,tool:()=>mode,sound:(name,pos,force)=>{audio.sound(name,pos,force);if(name==='splash'&&pos)land.ripple?.(pos.x,pos.z,force??.85);},notify,setDusk:v=>{goalDusk=T.MathUtils.clamp(v,0,1);}};
  const [fauna,camp,understory]=await Promise.all([createFauna(ctx),createCamp(ctx),createUnderstory(scene,land,plants)]);
  ctx.camp=camp;
  const bow=await createBow(ctx,fauna);
  function equip(m){if(m!==mode){bow.cancel();camp.up();mode=m;}for(const b of document.querySelectorAll('[data-tool]'))b.classList.toggle('active',b.dataset.tool===mode);}
  equip('bow');
  const controls=[
    ['Walk / sprint','W A S D / Shift'],['Look / jump','Mouse / Space'],['Bow / axe / fishing rod','1 / 2 / 3'],['Draw bow / loose arrow','Hold / release click'],['Swing axe / cast rod','Click'],['Pick up / place / cook','E'],['Field guide / hide HUD','G / H'],['Release mouse','Esc']
  ];
  function page(tab){
    for(const el of document.querySelectorAll('[data-tab]'))el.setAttribute('aria-selected',String(el.dataset.tab===tab));
    if(tab==='controls'){
      $('page').innerHTML='<dl>'+controls.map(([a,b])=>'<div><dt>'+a+'</dt><dd>'+b+'</dd></div>').join('')+'</dl><button class="setting" id="mute">Sound <b>'+(muted?'Off':'On')+'</b></button><button class="setting" id="music">Music <b>'+(music?'On':'Off')+'</b></button>';
      $('mute').onclick=()=>{muted=audio.toggle();page(tab);};$('music').onclick=()=>{music=audio.music();page(tab);};
    }else if(tab==='landmarks'){
      $('page').innerHTML=Object.entries(locations).map(([key,l])=>'<button class="destination" data-go="'+key+'"><span><b>'+l.name+'</b><small>'+l.detail+'</small></span><span>Travel ↗</span></button>').join('');
      for(const b of $('page').querySelectorAll('[data-go]'))b.onclick=()=>{travel(b.dataset.go);closeBook(false);enter();};
    }else{
      $('page').innerHTML='<p><b>At the wood camp</b><br>Use the axe on a nearby trunk. Follow its notch and back-cut prompts, then buck the fallen trunk. Carry rounds to the chopping block, split them, and take three pieces to the rack. Build the fire at the stone ring.</p><p><b>Along the water</b><br>Aim the rod at the stream and cast. Click when the float bites. Hold to reel and release to ease tension. Bring your catch to a lit campfire.</p><p><b>In the meadow</b><br>Approach slowly to watch the deer graze. Hold to draw the bow and release to shoot. Walk up to a lodged arrow to recover it.</p><button class="setting" id="dusk">Time of day <b>'+(goalDusk>.5?'Dusk':'Golden hour')+' ↻</b></button>';
      $('dusk').onclick=()=>{goalDusk=goalDusk>.5?0:1;page(tab);};
    }
  }
  function showUI(){
    $('front').hidden=playing||book;$('book').hidden=!book;$('hud').hidden=!playing||!hud;
    $('entryText').textContent=entered?'Return to woodland':'Enter woodland';
  }
  function enter(){
    book=false;playing=true;entered=true;showUI();audio.start().catch(()=>{});
    const result=renderer.domElement.requestPointerLock?.();result?.catch?.(()=>{});
  }
  function pause(){
    playing=false;keys.clear();velocity.set(0,0);bow.cancel();camp.up();showUI();
  }
  function openBook(){wasPlaying=playing;pause();book=true;if(document.pointerLockElement)document.exitPointerLock();showUI();page('controls');}
  function closeBook(resume=true){book=false;if(resume&&wasPlaying)enter();else showUI();}
  // Compile the rigged tools before acknowledging the first click.
  await renderer.compileAsync(scene,camera);
  const deer=fauna.herd.filter(a=>a.detail);
  const updateDeerDetail=()=>{for(const animal of deer)animal.detail.update(camera,renderer.domElement.height);};
  await camp.prepareHearth(hearth=>renderForest.prepare(scene,hearth,deer.map(a=>a.root)));
  function sampleScenery(eye){
    plants.update(0,clock,eye,dusk);terrain.update(0,clock,eye,dusk);understory.update(0,clock,eye,dusk);
  }
  // The close herd and bank first share a full-size colour and shadow pass
  // here. Prepare that view behind the loading screen with the game clock held.
  function prepareView(key){
    travel(key);
    plants.setDisturbance(player,fauna.herd);
    sampleScenery(player);updateDeerDetail();
  }
  prepareView('meadow');renderForest(scene,clock,dusk,false);prepareView('trail');
  $('enter').disabled=false;$('enter').onclick=enter;$('guideLink').onclick=openBook;$('closeGuide').onclick=()=>closeBook();
  for(const b of document.querySelectorAll('[data-tab]'))b.onclick=()=>page(b.dataset.tab);
  for(const b of document.querySelectorAll('[data-tool]'))b.onclick=()=>equip(b.dataset.tool);
  document.addEventListener('pointerlockchange',()=>{if(!document.pointerLockElement&&!book&&playing)pause();});
  window.addEventListener('blur',()=>{keys.clear();if(playing)pause();});
  document.addEventListener('mousemove',e=>{if(!playing||(!document.pointerLockElement&&!(e.buttons&2)))return;
    yaw-=e.movementX*.0022;pitch=T.MathUtils.clamp(pitch-e.movementY*.0022,-1.47,1.47);orient();});
  renderer.domElement.oncontextmenu=e=>e.preventDefault();
  renderer.domElement.onmousedown=e=>{if(e.button!==0||!playing)return;if(mode==='bow')bow.down();else camp.down();};
  window.addEventListener('mouseup',e=>{if(e.button!==0||!playing)return;if(mode==='bow')bow.up();else camp.up();});
  document.addEventListener('keydown',e=>{
    if(e.code==='KeyG'&&!e.repeat){book?closeBook():openBook();return;}
    if(e.code==='Escape'){if(book)closeBook(false);else if(playing)pause();return;}
    if(!playing)return;
    if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();
    keys.add(e.code);if(e.repeat)return;
    if(e.code==='KeyH'){hud=!hud;showUI();}
    if(e.code==='KeyE'&&!bow.interact())camp.interact();
    const m={Digit1:'bow',Digit2:'axe',Digit3:'rod'}[e.code];if(m)equip(m);
    if(e.code==='Space'&&jump<.001)vertical=5;
  });
  document.addEventListener('keyup',e=>keys.delete(e.code));
  window.addEventListener('resize',()=>{renderer.setSize(innerWidth,innerHeight,false);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();});
  function blocksBody(x,z,feet){
    if(camp.collides?.(x,z,feet))return true;
    if(walkingSurface(walkGround,plants.rocks,x,z)>feet+.30)return true;
    return plants.trees.some(t=>!t.removed&&(x-t.x)**2+(z-t.z)**2<(t.radius+.24)**2);
  }
  function move(dt){
    if(keys.has('ArrowLeft'))yaw+=dt*1.55;if(keys.has('ArrowRight'))yaw-=dt*1.55;
    if(keys.has('ArrowUp'))pitch=Math.min(1.47,pitch+dt);if(keys.has('ArrowDown'))pitch=Math.max(-1.47,pitch-dt);
    let f=Number(keys.has('KeyW'))-Number(keys.has('KeyS')),r=Number(keys.has('KeyD'))-Number(keys.has('KeyA'));
    const run=keys.has('ShiftLeft')||keys.has('ShiftRight');const wet=land.isWater(player.x,player.z);
    const speed=wet?2.0:run?6.45:3.65;
    intent.set(r*Math.cos(yaw)-f*Math.sin(yaw),-f*Math.cos(yaw)-r*Math.sin(yaw));
    if(intent.lengthSq()>1)intent.normalize();
    const slope=land.height(player.x+intent.x*.35,player.z+intent.y*.35)-land.height(player.x,player.z);
    intent.multiplyScalar(speed/(1+Math.max(0,slope)*1.10));
    velocity.lerp(intent,1-Math.exp(-dt*(intent.lengthSq()?11:16)));
    const dx=velocity.x*dt,dz=velocity.y*dt,oldX=player.x,oldZ=player.z;
    const feet=player.y-1.67-bob;
    const limit=v=>T.MathUtils.clamp(v,-999.5,999.5);
    if(dx!==0&&!blocksBody(player.x+dx,player.z,feet))player.x=limit(player.x+dx);else velocity.x=0;
    if(dz!==0&&!blocksBody(player.x,player.z+dz,feet))player.z=limit(player.z+dz);else velocity.y=0;
    const dist=Math.hypot(player.x-oldX,player.z-oldZ);
    const stride=run?1.68:wet?1.12:1.33;
    if(jump<.08){step+=dist;gait+=dist*Math.PI/stride;}
    if(step>=stride){
      step%=stride;
      if(wet)land.ripple?.(player.x,player.z,.42);
      const onTrail=Math.abs(player.x-land.trailX(player.z))<1.65*land.trailMargin(player.z,player.x-land.trailX(player.z));
      const onFord=player.x>6&&player.x<land.streamX(player.z)&&Math.abs(player.z-land.fordTrailZ(player.x))<.74*land.fordMargin(player.x);
      audio.sound(wet?'stepWater':onTrail||onFord?'stepTrail':'stepGrass',player);
      fauna.hearStep(player,run?17:wet?14:11);
    }
    const before=jump;
    const support=walkingSurface(walkGround,plants.rocks,player.x,player.z);
    vertical-=dt*(wet?9.6:14);
    const grounded=before<.001&&vertical<=0&&feet-support<.30;
    jump=grounded?0:Math.max(0,feet+vertical*dt-support);
    if(jump===0){
      if(before>.002&&vertical<-2.4&&wet){land.ripple?.(player.x,player.z,1.25);audio.sound('splash',player);}
      vertical=0;
    }
    const gaitStrength=Math.min(1,dist/Math.max(.001,dt)/3.5)*Math.max(0,1-jump*4);
    bob=T.MathUtils.damp(bob,(Math.cos(gait*2)*.024+Math.sin(gait)*.005)*gaitStrength,13,dt);
    const sideSpeed=velocity.x*Math.cos(yaw)-velocity.y*Math.sin(yaw);
    lean=T.MathUtils.damp(lean,-sideSpeed*.0015+.0018*Math.sin(gait)*gaitStrength,8,dt);
    player.y=support+1.67+jump+bob;orient();
    return Boolean(run&&(f||r));
  }
  function getPlace(){if(player.z<-72&&player.z>-142)return 'River Overlook';if(Math.hypot(player.x-camp.location.x,player.z-camp.location.z)<7)return 'Woodcutters’ Camp';if(Math.abs(player.x-land.streamX(player.z))<7)return 'Pebble Creek';if(Math.hypot(player.x-11.7,player.z+39.2)<11)return 'Deer Meadow';if(Math.abs(player.x-land.trailX(player.z))>19)return 'Alder Woods';return 'Birchwood Trail';}
  let infoAt=0;const times=[],frameData={calls:0,triangles:0};let scale=quality,auto=true,avg=16.7,samples=0;
  function tick(now){
    requestAnimationFrame(tick);
    const ms=now-last;last=now;if(ms>0&&ms<2000){times.push(ms);if(times.length>900)times.shift();}
    const dt=Math.min(.055,ms*.001);clock+=dt;
    dusk=T.MathUtils.damp(dusk,goalDusk,1.1,dt);
    const moving=playing&&move(dt);camera.getWorldDirection(look);
    plants.setDisturbance(player,fauna.herd);plants.update(dt,clock,player,dusk);terrain.update(dt,clock,player,dusk);
    understory.update(dt,clock,player,dusk);fauna.update(dt,clock,moving);camp.update(dt,clock);bow.update(dt);
    const tx=Math.round((player.x+look.x*9)*8)/8,tz=Math.round((player.z+look.z*9)*8)/8;
    sun.target.position.set(tx,player.y,tz);sun.position.set(tx-81,player.y+45,tz+12);
    sun.intensity=(2.72-dusk*2.49)*terrain.cloudSunlight(player,clock);hemi.intensity=1.30-dusk*.94;clearingLight(dusk,clock);
    if(entered)audio.update(clock,player,look,{x:land.streamX(player.z),z:player.z,y:land.waterY(player.x,player.z)},camp.state.fire?camp.location:null,dusk,mode==='rod'?'rod':bow.state.charge?'bow':getPlace()==='River Overlook'?'overlook':'explore');
    if(clock>noticeUntil)$('notice').style.opacity=0;
    if(playing&&hud&&clock>infoAt){
      infoAt=clock+.095;const bearing=(((-yaw*180/Math.PI)%360)+360)%360;
      $('bearing').textContent=['N','NE','E','SE','S','SW','W','NW'][Math.round(bearing/45)%8]+'   '+Math.round(bearing)+'°';
      $('place').textContent=getPlace();$('hint').textContent=bow.hint()||camp.hint();
      const tension=camp.state.fishing==='reeling',charge=bow.state.charge;
      $('meter').hidden=!tension&&!charge;$('meterLabel').textContent=tension?'Line tension':'Draw';$('meterFill').style.width=(100*(tension?camp.state.tension:charge))+'%';
    }
    updateDeerDetail();
    renderer.info.reset();renderForest(scene,clock,dusk);
    Object.assign(frameData,{calls:renderer.info.render.calls,triangles:renderer.info.render.triangles});
    if(ms<200){avg=avg*.96+ms*.04;samples++;}
    if(auto&&samples>100&&avg>24&&scale>.67){scale=Math.max(.65,scale-.13);renderer.setPixelRatio(scale);samples=0;}
  }
  showUI();requestAnimationFrame(tick);
  if(new URLSearchParams(location.search).has('qa')){
    window.fieldTest={scene,renderer,camera,player,land,plants,camp,fauna,understory,bow,ctx,audio,travel,equip,enter,pause,keys,times,frameData,locations,
      woodland:terrain.woodland,
      // Sample the same streaming groups used by tick without moving the camera or advancing wildlife.
      sampleScenery,
      get time(){return clock;},setHud(v){hud=v;showUI();},view(x,z,y,p){player.set(x,land.contactHeight(x,z)+1.67,z);yaw=y;pitch=p;velocity.set(0,0);jump=vertical=lean=bob=0;orient();},
      sim(v){playing=v;entered=true;book=false;showUI();},lookAt(x,y,z){camera.lookAt(x,y,z);yaw=camera.rotation.y;pitch=camera.rotation.x;orient();},
      setQuality(ratio){auto=false;scale=ratio;renderer.setPixelRatio(ratio);},setDusk(v){goalDusk=v;}};
  }
}
start().catch(error=>{console.error(error);$('fatal').hidden=false;$('fatal').textContent='The woodland could not open. '+error.message;});
