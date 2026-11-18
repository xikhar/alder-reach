/** All excitation signals, envelopes, acoustic cues and environment loops are synthesized here. */
export function createAudio() {
  let ac,master,recording,noise,wind,water,crickets,fireBed,muted=false,music=true;
  let chirpAt=0,noteAt=0,clickAt=0,beat=0;
  const ears={x:0,y:0,z:0};
  function out(pos,gain=1){
    const level=ac.createGain();level.gain.value=gain;
    if(!pos){level.connect(master);return level;}
    const pan=ac.createPanner();pan.panningModel='equalpower';pan.distanceModel='inverse';pan.refDistance=3;pan.rolloffFactor=.85;
    pan.setPosition(pos.x,pos.y,pos.z);level.connect(pan);pan.connect(master);level.pan=pan;return level;
  }
  function cleanup(src,nodes,t){src.stop(t);src.onended=()=>{for(const n of [src,...nodes])n?.disconnect();};}
  function hiss(pos,vol,dur,hz,q=.65,type='bandpass'){
    const t=ac.currentTime,s=ac.createBufferSource(),f=ac.createBiquadFilter(),g=ac.createGain(),d=out(pos);
    s.buffer=noise;s.loop=true;f.type=type;f.frequency.value=hz;f.Q.value=q;
    g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(vol,t+.009);g.gain.exponentialRampToValueAtTime(.0001,t+dur);
    s.connect(f);f.connect(g);g.connect(d);s.start(t,Math.random()*1.8);cleanup(s,[f,g,d,d.pan],t+dur+.03);
  }
  function tone(pos,freq,end,dur,amp,wave='sine',delay=0){
    const s=ac.createOscillator(),g=ac.createGain(),d=out(pos),t=ac.currentTime+delay;
    s.type=wave;s.frequency.setValueAtTime(freq,t);s.frequency.exponentialRampToValueAtTime(Math.max(16,end),t+dur);
    g.gain.setValueAtTime(.00001,t);g.gain.exponentialRampToValueAtTime(amp,t+Math.min(.024,dur*.15));g.gain.exponentialRampToValueAtTime(.00005,t+dur);
    s.connect(g);g.connect(d);s.start(t);cleanup(s,[g,d,d.pan],t+dur+.01);
  }
  function bed(pos,hz,type){
    const s=ac.createBufferSource(),f=ac.createBiquadFilter(),d=out(pos,.001);s.buffer=noise;s.loop=true;
    f.type=type;f.frequency.value=hz;f.Q.value=.68;s.connect(f);f.connect(d);s.start(0,Math.random());return d;
  }
  async function start(){
    if(ac){await ac.resume();return;}
    ac=new AudioContext();const limit=ac.createDynamicsCompressor();limit.threshold.value=-13;limit.ratio.value=5;
    master=ac.createGain();master.gain.value=muted?0:.77;master.connect(limit);limit.connect(ac.destination);recording=ac.createMediaStreamDestination();limit.connect(recording);
    noise=ac.createBuffer(1,ac.sampleRate*3,ac.sampleRate);const a=noise.getChannelData(0);
    for(let i=0;i<a.length;i++)a[i]=Math.random()*2-1;
    wind=bed({x:-5,y:2,z:4},850,'lowpass');water=bed({x:15,y:0,z:-25},1950,'highpass');
    crickets=bed({x:2,y:1,z:-5},5400,'bandpass');fireBed=bed({x:0,y:1,z:0},670,'bandpass');await ac.resume();
  }
  function sound(name,p,strength=.5){
    if(!ac||ac.state!=='running')return;
    switch(name){
      case 'bowCreak':tone(p,107,174,.48,.042,'triangle');hiss(p,.043,.54,620,1.8);break;
      case 'bowRelease':tone(p,202,64,.145,.20,'triangle');hiss(p,.12,.07,1020);break;
      case 'arrowWhoosh':hiss(p,.065,.26,2700);break;
      case 'arrowThunk':tone(p,149,48,.23,.19);hiss(p,.28,.13,630);break;
      case 'axeHit':tone(p,179-strength*51,64,.18,.22,'triangle');hiss(p,.5,.16+strength*.07,1450-strength*680);break;
      case 'woodCrack': case 'logSplit':hiss(p,.49,.23,1230,.45);tone(p,164,44,.30,.15,'triangle');break;
      case 'treeFall':hiss(p,.39,1.55,660);tone(p,117,41,1.4,.09,'triangle');break;
      case 'treeImpact':{
        tone(p,110,29,.92,.39);hiss(p,.47,.78,610);
        const distance=Math.hypot(p.x-ears.x,p.y-ears.y,p.z-ears.z);
        tone(null,72,33,.65,.15/(1+distance*.049),'sine',.018);
        break;
      }
      case 'woodPlace':tone(p,139,65,.21,.16);hiss(p,.19,.12,920);break;
      case 'fire':hiss(p,.12,.65,2500);break;
      case 'cast':hiss(p,.17,.27,2450,1);break;
      case 'reel':if(ac.currentTime-clickAt>.085){clickAt=ac.currentTime;tone(p,910,383,.037,.06,'triangle');}break;
      case 'splash':hiss(p,.33,.42,1640);tone(p,510,160,.14,.08);break;
      case 'stepGrass':hiss(p,.19,.24,1640);tone(p,99,45,.13,.076);break;
      case 'stepTrail':hiss(p,.31,.16,1020);tone(p,103,44,.14,.11);break;
      case 'stepWater':hiss(p,.21,.32,2380);tone(p,390,130,.16,.06);break;
    }
  }
  function update(t,p,dir,stream,fire,dusk,mode){
    if(!ac||ac.state!=='running')return;
    Object.assign(ears,{x:p.x,y:p.y,z:p.z});
    const l=ac.listener;
    if(l.positionX){for(const [k,v] of Object.entries({positionX:p.x,positionY:p.y,positionZ:p.z,forwardX:dir.x,forwardY:dir.y,forwardZ:dir.z,upX:0,upY:1,upZ:0}))l[k].value=v;}
    else{l.setPosition(p.x,p.y,p.z);l.setOrientation(dir.x,dir.y,dir.z,0,1,0);}
    const time=ac.currentTime;
    const move=(node,xyz,g)=>{node.pan.setPosition(xyz.x,xyz.y,xyz.z);node.gain.setTargetAtTime(g,time,.18);};
    move(wind,{x:p.x-5,y:p.y+2,z:p.z+3},.034+.016*Math.sin(t*.54));
    move(water,stream,.13);move(crickets,{x:p.x+3,y:p.y-.5,z:p.z-4},(.006+dusk*.037)*(.55+.45*Math.sin(t*24)));
    if(fire){move(fireBed,fire,.115);if(Math.random()<.032)hiss(fire,.22,.065,2600);}
    else fireBed.gain.value=0;
    if(time>chirpAt){
      chirpAt=time+2+Math.random()*5;const side=Math.sin(t*7.13);
      const pos={x:p.x+side*9,y:p.y+4,z:p.z-6};const f=1790+Math.random()*1100;
      tone(pos,f,f*1.4,.15,.082);tone(pos,f*1.21,f*.89,.21,.07,'sine',.21);
    }
    if(music&&time>noteAt){
      const notes=mode==='bow'?[146.83,174.61,220,261.63]:mode==='rod'?[196,246.94,293.66,369.99]:mode==='overlook'?[174.61,220,261.63,329.63,392]:[146.83,196,220,293.66,329.63];
      const melody=[0,2,1,3,2,0,4,1];const f=notes[melody[beat%8]%notes.length];
      tone(null,f,f*.999,1.62,.031,'triangle');tone(null,f*2,f*2,1.03,.009);
      if(beat%4===0)tone(null,notes[0]/2,notes[0]/2,3.5,.035);
      beat++;noteAt=time+(mode==='bow'?.71:mode==='overlook'?1.48:1.12)+(beat%8===0?2:0);
    }
  }
  return {start,sound,update,get context(){return ac;},get capture(){return recording?.stream;},toggle(){muted=!muted;if(master)master.gain.setTargetAtTime(muted?0:.77,ac.currentTime,.06);return muted;},
    music(){music=!music;return music;},suspend(){ac?.suspend();}};
}
