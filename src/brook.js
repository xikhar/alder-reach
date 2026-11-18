import * as T from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import {createSubmergedView,submergedLight} from './underwater-view.js';

// Each impulse is a moving capillary wave packet in world space, shared by the fishing and footstep systems.
const pulseCount=12;
const pulses=Array.from({length:pulseCount},()=>new T.Vector4(0,0,-100,0));
const spreads=new Float32Array(pulseCount);
let index=0,clock=0;
export function ripple(x,z,strength=1,radius=.65) {
  if(!Number.isFinite(x+z+strength+radius))return;
  pulses[index].set(x,z,clock,T.MathUtils.clamp(strength,0,2));
  spreads[index]=T.MathUtils.clamp(radius,.12,2.2);
  index=(index+1)%pulseCount;
}

// Long gravity waves and damped impulse packets displace the mesh. The CPU sampler uses the
// same vertices and triangle split, so floats can follow the actual animated surface.
let surfaceGrid=null;
function smooth01(x){x=Math.min(1,Math.max(0,x));return x*x*(3-2*x);}
function waterOffset(x,z,depth,tangent,cross,down,t){
  const length=Math.hypot(tangent,1),ax=-tangent/length,az=-1/length;
  const u=down*4.7-t*2.55,v=(.63*down+.77*cross)*7.9-t*3.23;
  let wave=.014*Math.sin(u)+.0065*Math.sin(v);
  for(let i=0;i<pulseCount;i++){
    const pulse=pulses[i],age=t-pulse.z;
    if(age<=0||age>=3.3||pulse.w===0)continue;
    const dx=x-pulse.x-ax*age*.115,dz=z-pulse.y-az*age*.115;
    const lag=Math.hypot(dx,dz)-age*(.67+spreads[i]*.65);
    const envelope=Math.exp(-lag*lag/(.025+.042*age)-1.64*age)*smooth01(age/.075);
    wave+=.032*pulse.w*envelope*Math.cos(14*lag);
  }
  return wave*smooth01(depth/.37);
}
export function sampleWaterSurface(x,z){
  if(!surfaceGrid)return null;
  const {rows,positions,flows,current,bands}=surfaceGrid;
  let lo=0,hi=rows.length-1;
  if(z<rows[lo]||z>rows[hi])return null;
  while(hi-lo>1){const mid=(hi+lo)>>1;if(z<rows[mid])hi=mid;else lo=mid;}
  const t=(z-rows[lo])/(rows[hi]-rows[lo]),base=lo*(bands+1),next=base+bands+1;
  const interpolate=(v,w)=>v+t*(w-v);
  const edge=k=>interpolate(positions[(base+k)*3],positions[(next+k)*3]);
  const u=(x-edge(0))/(edge(bands)-edge(0));
  if(u<0||u>1)return null;
  const k=Math.min(bands-1,Math.floor(bands*u)),a=base+k,b=next+k;
  const vertex=i=>positions[i*3+1]+waterOffset(positions[i*3],positions[i*3+2],flows[i*4+1],flows[i*4+2],current[i*2],current[i*2+1],clock);
  const mid=interpolate(positions[a*3],positions[(b+1)*3]);
  const yMid=interpolate(vertex(a),vertex(b+1));
  const left=x<mid,side=edge(left?k:k+1),denom=side-mid;
  if(Math.abs(denom)<1e-9)return yMid;
  const ySide=left?interpolate(vertex(a),vertex(b)):interpolate(vertex(a+1),vertex(b+1));
  return yMid+(ySide-yMid)*(x-mid)/denom;
}

const gravity=`
uniform float time;uniform vec4 pulse[12];uniform float radius[12];
vec3 waterWaves(vec2 p,float depth,float tangent,vec2 st){
  vec2 along=normalize(vec2(-tangent,-1.));
  vec2 slant=.63*along+.77*vec2(-along.y,along.x);
  float u=st.y*4.7-time*2.55,v=(.63*st.y+.77*st.x)*7.9-time*3.23;
  vec3 w=vec3(.014*sin(u)+.0065*sin(v),.014*4.7*cos(u)*along+.0065*7.9*cos(v)*slant);
  for(int i=0;i<12;i++){
    float age=time-pulse[i].z;
    if(age>0. && age<3.3 && pulse[i].w>0.){
      vec2 d=p-pulse[i].xy-along*age*.115;
      float r=length(d),lag=r-age*(.67+radius[i]*.65),width=.025+.042*age;
      float amp=.032*pulse[i].w*exp(-lag*lag/width-1.64*age)*smoothstep(0.,.075,age);
      w.x+=amp*cos(14.*lag);
      w.yz+=amp*(-14.*sin(14.*lag)-2.*lag/width*cos(14.*lag))*d/max(.0001,r);
    }
  }
  return w*smoothstep(0.,.37,depth);
}`;
const vs=`
varying vec3 surface;
varying vec4 channelDetail;
varying vec4 mirrored;varying vec2 riverCoord;
attribute vec4 flow;attribute vec2 current;attribute vec4 bankHorizon;varying float openHorizon;
uniform mat4 mirrorMatrix;
${gravity}
#include <fog_pars_vertex>
void main(){
  surface=position;
  riverCoord=current;
  surface.y+=waterWaves(position.xz,flow.y,flow.z,current).x;
  channelDetail=flow;
  vec2 az=normalize(surface.xz-cameraPosition.xz+vec2(.00001));
  vec2 horizon=vec2(az.x<0.?bankHorizon.x:bankHorizon.y,az.y<0.?bankHorizon.z:bankHorizon.w);
  openHorizon=dot(horizon,az*az);
  mirrored=mirrorMatrix*vec4(surface,1.);
  vec4 mvPosition=modelViewMatrix*vec4(surface,1.);
  gl_Position=projectionMatrix*mvPosition;
  #include <fog_vertex>
}`;
const fs=`
varying vec3 surface;varying vec4 channelDetail;varying vec4 mirrored;varying vec2 riverCoord;
varying float openHorizon;uniform float dusk,hasMirror;uniform sampler2D treeReflection;
${submergedLight}
${gravity}
#include <fog_pars_fragment>
float h2(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h2(i),h2(i+vec2(1,0)),f.x),mix(h2(i+vec2(0,1)),h2(i+1.),f.x),f.y);}
vec2 wave(vec2 p,vec2 d,float k,float steep,float v,float phase){
  float theta=k*dot(p,d)-v*time+phase;
  return d*steep*(cos(theta)+.2*cos(2.*theta+.73));
}
void main(){
  vec2 world=surface.xz;float side=channelDetail.x,depth=channelDetail.y;
  vec2 along=normalize(vec2(-channelDetail.z,-1.)),crossFlow=vec2(-along.y,along.x);
  vec2 st=(world.y>=-57. && world.y<=-23.) ? riverCoord : vec2(dot(world,crossFlow),dot(world,along));
  float r=length(surface-cameraPosition);
  vec3 eye=normalize(cameraPosition-surface);
  float swirl=noise(world*.85+along*time*.07)*2.+.43*sin(st.y*1.24+st.x*.75-time*.48);
  float riffle=.16+.84*smoothstep(.30,.74,noise(world*vec2(.88,.45)+vec2(.11*time,0.)));
  vec2 gradient=wave(st,vec2(.21,.978),13.5,.043,2.3,swirl)+wave(st,vec2(-.45,.893),23.8,.036,3.7,-swirl*.9);
  gradient+=riffle*(wave(st,vec2(.7,.71),43.6,.026,4.42,swirl*1.72)+wave(st,vec2(-.31,.95),67.,.017,5.62,-swirl));
  gradient*=1.-smoothstep(18.,90.,r);
  vec2 slope=crossFlow*gradient.x+along*gradient.y;
  slope+=waterWaves(world,depth,channelDetail.z,st).yz;
  vec3 N=normalize(vec3(-slope.x,1.,-channelDetail.w-slope.y));
  float facing=clamp(dot(eye,N),0.,1.);
  float fresnel=.028+.88*pow(1.-facing,4.);
  float waterColumn=clamp(depth/max(.15,facing),0.,5.);
  float absorption=1.-exp(-waterColumn*1.29);
  vec3 ray=reflect(-eye,N);
  float treeLine=.19+.13*sin(atan(ray.x,ray.z)*4.+1.)+.055*cos(atan(ray.x,ray.z)*10.);
  vec3 sky=mix(vec3(.170,.263,.343),vec3(.32,.46,.52),clamp(ray.y,0.,1.));
  vec3 canopy=mix(vec3(.013,.028,.044),vec3(.050,.087,.102),noise(ray.xz*15.+4.));
  vec3 reflection=mix(canopy,sky,smoothstep(treeLine-.13,treeLine+.16,ray.y));
  vec2 muv=mirrored.xy/max(.005,mirrored.w)*.5+.5;
  vec2 jitter=vec2(slope.x*.54+slope.y*.24,slope.y)*(.026+.027*(1.-facing));
  vec2 sampleUV=muv+jitter;
  float inside=smoothstep(0.,.04,min(min(sampleUV.x,1.-sampleUV.x),min(sampleUV.y,1.-sampleUV.y)));
  float planar=hasMirror*inside*(1.-smoothstep(15.,53.,r))*step(0.,mirrored.w);
  vec3 image=texture2D(treeReflection,clamp(sampleUV,.002,.998)).rgb;
  reflection=mix(reflection,min(image*vec3(.72,.80,.94),vec3(.75)),planar*.55);
  vec3 deep=mix(vec3(.004,.019,.039),vec3(.009,.033,.067),.33+.67*noise(world*.27+12.));
  float pool=1.-smoothstep(5.,15.,length(world-vec2(22.,-39.)));
  deep*=mix(vec3(1.),vec3(.86,.85,.835),pool);
  vec3 sun=normalize(vec3(-81.,45.,12.));
  float glint=pow(max(0.,dot(ray,sun)),168.)*(.35+.65*riffle);
  float edge=smoothstep(.18,.93,depth+.04);
  float alpha=clamp(.09+.75*absorption+.45*fresnel,.09,.96);
  float reflectMix=clamp(fresnel+.065*(1.-facing)+edge*.027,0.,.84);
  vec3 color=mix(deep,reflection,reflectMix)+glint*vec3(.13,.11,.095);
  // Low western light reaches the bend through the opening over the gravel.
  // Reevaluate the reflected direction on the sloped, moving surface so the
  // highlight breaks around individual ripples as the observer crosses it.
  vec3 clearing=normalize(vec3(-.72,.41,.56));
  float clearSky=exp(-13.*pow(dot(ray-clearing,vec3(.63,0.,.78)),2.)-48.*pow(ray.y-clearing.y,2.));
  clearSky*=smoothstep(.15,.65,dot(ray,clearing))*exp(-dot(world-vec2(22.,-37.),world-vec2(22.,-37.))*.016);
  float skyExposure=mix(1.,.50+.50*smoothstep(.025,.25,dot(image,vec3(.2126,.7152,.0722))),planar);
  vec3 westSky=vec3(2.55,1.48,1.11)*clearSky*skyExposure*(1.-dusk);
  color+=westSky*fresnel;
  float farShine=smoothstep(40.,550.,r);
  vec3 alpine=mix(vec3(.215,.359,.424),vec3(.63,.77,.81),.44+.53*noise(world*vec2(.016,.029)));
  // Skylight catches the open turn, while the distant channel reflects the wooded slopes.
  float rim=smoothstep(.42,.97,abs(side));
  // At grazing angles the cross-valley reaches pick up open sky, while the narrower
  // north-running reaches reflect their spruce banks. Wind breaks up each highlight.
  float exposure=abs(dot(along,normalize(vec2(.94,.34))));
  float cloud=.68+.32*noise(world*vec2(.0054,.0069));
  float gleam=smoothstep(.19,.85,.75*exposure+.27*cloud);
  vec3 woodedBank=vec3(.081,.135,.185);
  float openBend=smoothstep(710.,910.,-world.y)*(1.-smoothstep(1150.,1510.,-world.y));
  float openSky=(.13+.68*gleam*cloud+.43*openBend)*mix(.28,1.,smoothstep(630.,836.,-world.y));
  alpine=mix(woodedBank,alpine,min(1.,openSky));
  float distant=smoothstep(945.,2200.,r);
  // The open headwater reflects the sky between the moraines. Its contrast
  // falls with distance, while the shaded banks still reflect the hillside.
  vec3 farSky=mix(vec3(.107,.171,.224),vec3(.279,.383,.454),openSky);
  // At a low viewing angle an open upstream bank returns the pale horizon.
  // Bank angles come from the actual surrounding terrain in four directions.
  float upland=smoothstep(2000.,2250.,-world.y)*openHorizon;
  farSky=mix(farSky,vec3(.66,.81,.88),upland*(.50+.50*fresnel));
  alpine=mix(alpine,farSky,distant*.68);
  alpine*=1.-.18*rim*smoothstep(170.,480.,r);
  color=mix(color,alpine,farShine*.96);
  color*=mix(vec3(1.),vec3(.43,.48,.64),dusk);
  gl_FragColor=vec4(color,mix(alpha,.995,farShine));
  if(hasWaterView>.0001 && r<32. && facing>.10 && depth>.035){
    vec3 bed;float travel;
    if(waterHit(surface,refract(-eye,N,1./1.333),depth,bed,travel)){
      // Radiance crosses the water once on its way to the bed and again
      // toward the observer. Long red wavelengths attenuate fastest.
      vec3 submergedRay=refract(-eye,N,1./1.333);
      vec3 transmission=exp(-vec3(1.23,.77,.49)*travel*(1.+max(0.,-submergedRay.y)*1.25));
      vec3 below=bed*transmission+deep*(1.-transmission);
      float blend=hasWaterView*(1.-smoothstep(20.,32.,r))*smoothstep(.10,.24,facing)*smoothstep(.035,.12,depth);
      vec3 refracted=mix(below,reflection,fresnel)+glint*vec3(.13,.11,.095)
        +westSky*fresnel;
      gl_FragColor=mix(gl_FragColor,vec4(refracted,1.),blend);
    }
  }
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export function buildBrook(scene,terrainRows,land){
  const pos=[],attributes=[],coordinates=[],indices=[],rows=[],reaches=[];const bands=26;
  for(let i=0;i<terrainRows.length-1;i++){
    const z=terrainRows[i],span=terrainRows[i+1]-z;
    const subdivisions=Math.abs(z+28)<151?Math.ceil(span/.195):1;
    for(let j=0;j<subdivisions;j++)rows.push(z+j*span/subdivisions);
  }
  rows.push(terrainRows.at(-1));
  const centers=rows.map(z=>land.streamX(z)),stations=[0];
  for(let i=1;i<rows.length;i++)stations.push(stations[i-1]+Math.hypot(rows[i]-rows[i-1],centers[i]-centers[i-1]));
  const origin=rows.findIndex(z=>z>=-39),baseZ=rows[origin],baseX=centers[origin];
  const baseSlope=land.streamX(baseZ+.5)-land.streamX(baseZ-.5),baseLen=Math.hypot(1,baseSlope);
  const baseCross=(baseX-baseZ*baseSlope)/baseLen,baseDown=(-baseZ-baseX*baseSlope)/baseLen;
  const horizons=[],closedHorizon=[0,0,0,0],directions=[[-1,0],[1,0],[0,-1],[0,1]];
  let reach=new T.Box3();
  const corner=new T.Vector3();
  for(let i=0;i<rows.length;i++){
    const z=rows[i],c=centers[i],w=land.streamWidth(z),y=land.waterY(c,z);
    // Adjacent bounds share their boundary row. Allow for the full ripple envelope.
    reach.expandByPoint(corner.set(c-w,y-.13,z));reach.expandByPoint(corner.set(c+w,y+.15,z));
    if(i && (i%24===0 || i===rows.length-1)){
      reaches.push(reach);reach=new T.Box3();
      reach.expandByPoint(corner.set(c-w,y-.13,z));reach.expandByPoint(corner.set(c+w,y+.15,z));
    }
    const tangent=land.streamX(z+.5)-land.streamX(z-.5);
    const slope=land.waterY(c,z+.5)-land.waterY(c,z-.5),length=Math.hypot(1,tangent);
    const bend=T.MathUtils.smoothstep(z,-57,-47)*(1-T.MathUtils.smoothstep(z,-32,-23));
    const horizon=z>=-2000?closedHorizon:directions.map(([dx,dz])=>{
      let slope=0;
      for(const d of [75,160,320,520])slope=Math.max(slope,(land.height(c+dx*d,z+dz*d)-y)/d);
      return Math.round(255*(1-T.MathUtils.smoothstep(slope,.025,.23)));
    });
    for(let k=0;k<=bands;k++){
      horizons.push(...horizon);
      const side=k/bands*2-1,x=c+side*w;
      pos.push(x,y+.012,z);
      // Measure distance along the bend so a change in heading cannot stretch a passing ripple.
      coordinates.push(T.MathUtils.lerp((x-z*tangent)/length,baseCross+(x-c)/length,bend),
        T.MathUtils.lerp((-z-x*tangent)/length,baseDown+stations[origin]-stations[i]-(x-c)*tangent/length,bend));
      attributes.push(side,Math.max(.0,y-land.height(x,z)),tangent,slope);
      if(i&&k){const a=i*(bands+1)+k;indices.push(a-bands-2,a-1,a,a-bands-2,a,a-bands-1);}
    }
  }
  const geometry=new T.BufferGeometry();
  geometry.setAttribute('position',new T.Float32BufferAttribute(pos,3));
  geometry.setAttribute('bankHorizon',new T.Uint8BufferAttribute(horizons,4,true));
  geometry.setAttribute('current',new T.Float32BufferAttribute(coordinates,2));
  geometry.setAttribute('flow',new T.Float32BufferAttribute(attributes,4));geometry.setIndex(indices);geometry.computeVertexNormals();
  surfaceGrid={rows:rows.map(Math.fround),positions:geometry.attributes.position.array,flows:geometry.attributes.flow.array,current:geometry.attributes.current.array,bands};
  const mirror=new Reflector(new T.PlaneGeometry(1,1),{textureWidth:512,textureHeight:288,clipBias:.008,multisample:0});
  const underwater=createSubmergedView(scene);
  const uniforms={...underwater.uniforms,...T.UniformsUtils.clone(T.UniformsLib.fog),time:{value:0},dusk:{value:0},treeReflection:{value:mirror.getRenderTarget().texture},
    hasMirror:{value:0},mirrorMatrix:{value:new T.Matrix4()},pulse:{value:pulses},radius:{value:spreads}};
  const material=new T.ShaderMaterial({name:'Clearwater',uniforms,vertexShader:vs,fragmentShader:fs,fog:true,transparent:true,depthWrite:false,side:T.DoubleSide,forceSinglePass:true});
  const mesh=new T.Mesh(geometry,material);mesh.name='Clearwater';mesh.renderOrder=3;scene.add(mesh);
  let lastTime=-100;
  const eye=new T.Vector3(),forward=new T.Vector3(),normal=new T.Vector3(),localUp=new T.Vector3(0,0,1);
  const lastEye=new T.Vector3(Infinity,Infinity,Infinity),lastDir=new T.Vector3();
  const frustum=new T.Frustum(),viewProjection=new T.Matrix4();
  mesh.onBeforeRender=(renderer,s,camera)=>{
    eye.setFromMatrixPosition(camera.matrixWorld);camera.getWorldDirection(forward);
    const z=eye.z,bx=land.streamX(z),w=land.streamWidth(z),water=land.waterY(bx,z);
    const smooth=T.MathUtils.smoothstep,height=eye.y-water;
    const nearBank=(1-smooth(Math.abs(eye.x-bx)-w,9,14))*(1-smooth(height,4.9,7))*
      smooth(height,-.05,.13)*(1-smooth(forward.y,.16,.27));
    let closest=Infinity;
    if(nearBank>.0001){
      frustum.setFromProjectionMatrix(viewProjection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
      for(const box of reaches){
        if(box.max.z<z-53 || box.min.z>z+53 || !frustum.intersectsBox(box))continue;
        closest=Math.min(closest,box.distanceToPoint(eye));
      }
    }
    underwater.draw(renderer,camera,closest<32,water+.012,land.waterY(bx,z+.5)-land.waterY(bx,z-.5),-forward.y);
    uniforms.hasWaterView.value*=nearBank;
    uniforms.hasMirror.value=closest<53?nearBank:0;
    if(closest>=53)return;
    if(clock-lastTime<.19 && lastEye.distanceToSquared(eye)<.75 && lastDir.dot(forward)>.987)return;
    lastTime=clock;lastEye.copy(eye);lastDir.copy(forward);
    normal.set(0,1,-(land.waterY(bx,z+.5)-land.waterY(bx,z-.5))).normalize();
    mirror.position.set(bx,water,z);mirror.quaternion.setFromUnitVectors(localUp,normal);mirror.updateMatrixWorld();
    const wasVisible=camera.visible;mesh.visible=false;camera.visible=false;
    try{
      mirror.onBeforeRender(renderer,s,camera);
      uniforms.mirrorMatrix.value.multiplyMatrices(mirror.camera.projectionMatrix,mirror.camera.matrixWorldInverse);
    }finally{mesh.visible=true;camera.visible=wasVisible;}
  };
  return {uniforms,update(t){clock=t;uniforms.time.value=t;}};
}
