import * as T from 'three';
import clearings from './woodland-air.json';

// These finite columns describe locally denser air below canopy gaps. Their
// cross-sections follow the sun direction and their visibility comes from the
// current shadow map, including moving foliage and fallen trees.
const [trail,meadow] = clearings;
function columnBounds({ground,radii,height}){
  const number=value=>value.toFixed(4);
  return `vec3(${ground.map(number)}),vec2(${radii.map(number)}),${number(height)}`;
}

const triangleVS=`
  varying vec2 uvScreen;
  void main(){uvScreen=position.xy*.5+.5; gl_Position=vec4(position.xy,0.,1.);}
`;
function buffer(depth=false){
  const rt=new T.WebGLRenderTarget(1,1,{type:T.HalfFloatType,format:T.RGBAFormat,depthBuffer:depth,
    minFilter:T.LinearFilter,magFilter:T.LinearFilter,samples:depth?2:0});
  if(depth)rt.depthTexture=new T.DepthTexture(1,1,T.UnsignedIntType);
  return rt;
}
function program(uniforms,fragment){
  return new T.ShaderMaterial({uniforms,depthTest:false,depthWrite:false,vertexShader:triangleVS,fragmentShader:fragment});
}
const viewRay=`
  varying vec2 uvScreen;
  uniform sampler2D sceneDepth;
  uniform mat4 invProjection, cameraWorld;
  uniform vec3 eye;
  uniform vec2 pixel;
  vec3 viewPosition(vec2 uv,float d){
    vec4 v=invProjection*vec4(uv*2.-1.,d*2.-1.,1.);
    return v.xyz/v.w;
  }
  float linearDepth(vec2 uv){return -viewPosition(uv,texture2D(sceneDepth,uv).r).z;}
`;

// Small, deterministic subpixel offsets integrate thin needles and grass tips across frames.
const jitter=[[0,-1/6],[-.25,1/6],[.25,-7/18],[-.375,-1/18],[.125,5/18],[-.125,-5/18],[.375,1/18],[-.4375,7/18]];
export function createAtmosphere(renderer,camera,sun,land,cloudSunlight){
  const openingCenters=clearings.map(profile=>new T.Vector3(...profile.ground));
  const hdr=buffer(true),mist=buffer(),history=[buffer(),buffer()],bloom0=buffer(),bloom1=buffer();
  const viewport=new T.Vector2(),previousView=new T.Matrix4(),oldEye=new T.Vector3(1e6,0,0);
  let frame=0,front=0,valid=false;
  const u={
    sceneDepth:{value:hdr.depthTexture},sceneColor:{value:hdr.texture},fogMap:{value:mist.texture},
    lastFrame:{value:history[1].texture},previousView:{value:previousView},pixel:{value:new T.Vector2()},
    cameraWorld:{value:camera.matrixWorld},eye:{value:camera.position},invProjection:{value:camera.projectionMatrixInverse},
    keyDepth:{value:null},keyMatrix:{value:sun.shadow.matrix},keyDirection:{value:new T.Vector3()},
    keyActive:{value:0},openingSun:{value:new T.Vector2(1,1)},dusk:{value:0},time:{value:0},reuse:{value:0},bloomMap:{value:null},
    resolved:{value:null},blurAxis:{value:new T.Vector2()},forestAmount:{value:1},bankShade:{value:0},meadowLight:{value:0}
  };
  const volumetric=program(u,viewRay+`
    #include <packing>
    uniform sampler2D keyDepth;
    uniform mat4 keyMatrix;
    uniform vec3 keyDirection;
    uniform float time,dusk,keyActive,forestAmount,bankShade;
    uniform vec2 openingSun;
    // Refine the eye-ray integration continuously near the elliptical column.
    // Rays across the far valley retain the coarse, uniform sampling.
    float rayOverlap(vec3 ground,vec2 radius,float height,vec3 dir,float reach){
      float h=eye.y-ground.y;
      float end=h+dir.y*reach;
      float vertical=smoothstep(-3.,-1.5,max(h,end))*(1.-smoothstep(height,height+2.,min(h,end)));
      vec2 slope=keyDirection.xz/keyDirection.y;
      vec2 o=(eye.xz-ground.xz-h*slope)/radius;
      vec2 d=(dir.xz-dir.y*slope)/radius;
      float t=clamp(-dot(o,d)/max(.000001,dot(d,d)),0.,reach);
      return vertical*(1.-smoothstep(1.,1.69,dot(o+t*d,o+t*d)));
    }
    float airColumn(vec3 ground,vec2 radius,float height,float amount,vec3 p){
      float h=p.y-ground.y;
      vec2 floorPoint=p.xz-h*keyDirection.xz/keyDirection.y;
      vec2 q=(floorPoint-ground.xz)/radius;
      float edge=max(0.,1.-dot(q,q));
      return amount*edge*edge*(1.-smoothstep(0.,height,h))*smoothstep(-1.5,0.,h);
    }
    float visibility(vec3 p,float broad){
      vec3 light=(keyMatrix*vec4(p,1.)).xyz;
      vec2 boundary=min(light.xy,1.-light.xy);
      float inside=smoothstep(0.,.085,min(boundary.x,boundary.y))*keyActive;
      float receiver=light.z-.0003;
      float lit=step(receiver,unpackRGBAToDepth(texture2D(keyDepth,light.xy)));
      if(broad>.001){
        // Average incident light over a small parcel of air. The projected
        // footprint reduces sparkling when thin needles pass the parcel.
        float soft=0.;
        for(int j=0;j<8;j++){
          float a=(float(j)+.5)*2.39996;
          vec2 d=vec2(cos(a),sin(a))*sqrt((float(j)+.5)/8.)*.0068;
          soft+=step(receiver,unpackRGBAToDepth(texture2D(keyDepth,light.xy+d)));
        }
        lit=mix(lit,soft*.125,smoothstep(.001,.006,broad));
      }
      return mix(.30,lit,inside);
    }
    void main(){
      float depth=texture2D(sceneDepth,uvScreen).r;
      vec3 local=viewPosition(uvScreen,depth);
      float total=length(local);
      vec3 dir=normalize(mat3(cameraWorld)*local);
      // The low suspended layer follows the forest floor. Open meadows have much less haze.
      float lengthInAir=min(total,76.);
      float inTrail=rayOverlap(${columnBounds(trail)},dir,lengthInAir);
      float inMeadow=rayOverlap(${columnBounds(meadow)},dir,lengthInAir);
      float refinement=max(inTrail,inMeadow);
      float density=mix(.0015,.010,forestAmount);
      vec3 sum=vec3(0.);
      float trans=1.;
      vec3 cool=mix(vec3(.059,.083,.120),vec3(.019,.029,.049),dusk);
      vec3 warm=mix(vec3(.55,.32,.115),vec3(.13,.062,.038),dusk);
      float phase=.27+1.26*pow(max(0.,dot(dir,keyDirection)),5.);
      warm*=1.-.82*bankShade;
      for(int i=0;i<36;++i){
        float fi=float(i);
        float nearStart=fi<16.?fi:fi<30.?16.+(fi-16.)*2.:44.+(fi-30.)*5.5;
        float nearStep=fi<16.?1.:fi<30.?2.:5.5;
        float coarse=lengthInAir*.05;
        float start=mix(min(fi,20.)*coarse,min(nearStart,lengthInAir),refinement);
        if(start>=lengthInAir)break;
        float ds=mix(i<20?coarse:0.,clamp(lengthInAir-nearStart,0.,nearStep),refinement);
        float distance=start+.5*ds;
        vec3 p=eye+dir*distance;
        float heightFalloff=exp(-max(0.,p.y-eye.y-2.)*.16);
        float wisps=.87+.13*sin(p.x*.18+p.z*.13+time*.047)*sin(p.z*.21-p.y*.18);
        // A pocket of low, sunlit air behind the clearing gives the herd a readable silhouette.
        vec2 clearing=(p.xz-vec2(5.,-56.))/vec2(17.,14.);
        float pocket=exp(-dot(clearing,clearing))*exp(-max(0.,p.y-6.5)*.38);
        vec2 backbank=(p.xz-vec2(3.,-26.))/vec2(15.,13.);
        float fordAir=exp(-dot(backbank,backbank))*exp(-max(0.,p.y-6.)*.25);
        float localDensity=density+(.041*pocket+.023*fordAir)*(1.-dusk*.74);
        float trailAir=inTrail>0.?airColumn(${columnBounds(trail)},${trail.density.toFixed(4)},p):0.;
        float meadowAir=inMeadow>0.?airColumn(${columnBounds(meadow)},${meadow.density.toFixed(4)},p):0.;
        float daylight=(1.-dusk)*(1.-dusk);
        float column=(trailAir+meadowAir)*daylight;
        float medium=localDensity*heightFalloff+column;
        float extinction=exp(-medium*wisps*ds);
        float lit=visibility(p,column);
        vec3 inscatter=mix(cool,vec3(.14,.081,.05),fordAir*(1.-dusk)) +warm*phase*lit;
        inscatter+=pocket*(.24+.76*lit)*vec3(.25,.13,.052)*(1.-dusk);
        float meadowShare=meadowAir/max(.00001,trailAir+meadowAir);
        float transmission=mix(openingSun.x,openingSun.y,meadowShare);
        vec3 indirect=mix(cool,vec3(.16,.076,.037),meadowShare*transmission);
        vec3 sunlitDust=indirect+vec3(2.2,1.24,.53)*(.64+phase)*lit*transmission;
        inscatter=mix(inscatter,sunlitDust,column/medium);
        sum+=trans*(1.-extinction)*inscatter;
        trans*=extinction;
      }
      gl_FragColor=vec4(sum,trans);
    }`);
  const resolve=program(u,viewRay+`
    uniform sampler2D sceneColor,fogMap,lastFrame;
    uniform mat4 previousView;
    uniform float reuse;
    float contactShade(vec3 p){
      float z=-p.z;
      if(z>32. || z<.24)return 1.;
      vec3 vx=dFdx(p),vy=dFdy(p);
      vec3 n=normalize(cross(vx,vy));
      if(dot(n,-p)<0.)n=-n;
      float accum=0.;
      float radius=clamp(.21+.011*z,.21,.51);
      vec2 rad=pixel*(radius/(max(z,.3)*pixel.y*1.18));
      for(int i=0;i<6;i++){
        float a=float(i)*2.39996+.23;
        vec2 uv=uvScreen+vec2(cos(a),sin(a))*rad*(.31+.117*float(i));
        vec3 q=viewPosition(uv,texture2D(sceneDepth,uv).r)-p;
        float len=length(q);
        accum+=max(0.,dot(n,q)/max(len,.001)-.12)*(1.-smoothstep(radius*.16,radius*1.6,len));
      }
      return 1.-min(.22,accum*.085)*(1.-smoothstep(18.,32.,z));
    }
    void main(){
      vec3 local=viewPosition(uvScreen,texture2D(sceneDepth,uvScreen).r);
      float viewZ=max(.025,-local.z);
      vec3 world=(cameraWorld*vec4(local,1.)).xyz;
      vec4 prev=previousView*vec4(world,1.);
      vec2 prevUv=.5+.5*prev.xy/max(.0001,prev.w);
      vec4 old=texture2D(lastFrame,prevUv);
      vec4 fog=texture2D(fogMap,uvScreen);
      float ao=contactShade(local);
      vec3 base=texture2D(sceneColor,uvScreen).rgb;
      vec3 lo=base,hi=base;
      for(int i=0;i<4;i++){
        vec2 d=i==0?vec2(1,0):i==1?vec2(-1,0):i==2?vec2(0,1):vec2(0,-1);
        vec3 neighbor=texture2D(sceneColor,uvScreen+d*pixel).rgb;
        lo=min(lo,neighbor);hi=max(hi,neighbor);
      }
      // Clamp motion history to its current neighbourhood to reject silhouettes on disocclusion.
      vec3 color=base*ao*fog.a+fog.rgb;
      vec3 pad=(hi-lo)*.08+vec3(.002);
      vec3 prior=clamp(old.rgb,(lo-pad)*ao*fog.a+fog.rgb,(hi+pad)*ao*fog.a+fog.rgb);
      vec2 edge=min(prevUv,1.-prevUv);
      float aligned=(1.-smoothstep(.024,.10,abs(old.a-prev.w)/max(.45,viewZ)))*step(.0005,min(edge.x,edge.y))*step(0.,prev.w);
      float movement=length((prevUv-uvScreen)/pixel);
      float weight=mix(.80,.56,smoothstep(.9,17.,movement))*aligned*reuse;
      gl_FragColor=vec4(mix(color,prior,weight),min(viewZ,15000.));
    }`);
  const bloomFirst=program(u,`
    varying vec2 uvScreen;uniform sampler2D resolved;uniform vec2 pixel;
    void main(){
      vec3 c=vec3(0.);
      for(int i=0;i<4;i++){
        vec2 d=vec2(float(i%2)*2.-1.,float(i/2)*2.-1.)*1.8*pixel;
        vec3 s=texture2D(resolved,uvScreen+d).rgb;
        float l=max(max(s.r,s.g),s.b);
        c+=s*smoothstep(.48,1.52,l)*.25;
      }
      gl_FragColor=vec4(c,1.);
    }`);
  const blur=program(u,`
    varying vec2 uvScreen;uniform sampler2D bloomMap;uniform vec2 blurAxis;
    void main(){
      vec3 b=texture2D(bloomMap,uvScreen).rgb*.227027;
      b+=(texture2D(bloomMap,uvScreen+1.384615*blurAxis).rgb+texture2D(bloomMap,uvScreen-1.384615*blurAxis).rgb)*.316216;
      b+=(texture2D(bloomMap,uvScreen+3.230769*blurAxis).rgb+texture2D(bloomMap,uvScreen-3.230769*blurAxis).rgb)*.070270;
      gl_FragColor=vec4(b,1.);
    }`);
  const display=program(u,`
    varying vec2 uvScreen;uniform sampler2D resolved,bloomMap;uniform float dusk,forestAmount,bankShade,meadowLight;
    uniform mat4 invProjection;
    void main(){
      vec3 color=max(vec3(0.),texture2D(resolved,uvScreen).rgb);
      vec3 halation=texture2D(bloomMap,uvScreen).rgb;
      color+=halation*.125;
      float value=dot(color,vec3(.2126,.7152,.0722));
      float lift=(1.-smoothstep(.02,.27,value));
      float day=1.-dusk;
      // Skylight dominates the sheltered creek; sun-warmed grass opens into cooler alpine air.
      vec3 air=mix(vec3(.94,1.0,1.055),vec3(1.05,.98,.99),forestAmount);
      air=mix(air,vec3(.54,.62,.78),bankShade);
      air=mix(air,vec3(.97,.88,.83),meadowLight*(1.-bankShade));
      color=mix(vec3(value),color,.90)*mix(vec3(1.),air,day);
      color*=mix(vec3(1.),vec3(.98,1.,1.045),lift);
      vec2 vignette=uvScreen*(1.-uvScreen);
      color*=.93+.07*clamp(16.*vignette.x*vignette.y,0.,1.);
      // Wide-open views lose light toward the edges of the lens. Evaluate
      // the actual view angle so the narrow wildlife portrait retains its exposure.
      vec2 slope=(uvScreen*2.-1.)*vec2(invProjection[0][0],invProjection[1][1]);
      float angle2=dot(slope,slope);
      float loss=1.-1./(1.+angle2*angle2);
      float openAir=(1.-forestAmount)*day;
      color*=1.-openAir*loss*mix(.51,.93,smoothstep(.06,.37,value))*vec3(1.03,1.,.94);
      gl_FragColor=vec4(color,1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`);
  const screen=new T.Scene(),ortho=new T.Camera();
  const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute([-1,-1,0,3,-1,0,-1,3,0],3));
  const tri=new T.Mesh(geo,display);tri.frustumCulled=false;screen.add(tri);
  function pass(mat,target){tri.material=mat;renderer.setRenderTarget(target);renderer.render(screen,ortho);}
  function render(scene,time,dusk,present=true){
    renderer.getDrawingBufferSize(viewport);
    const w=viewport.x,h=viewport.y;
    if(hdr.width!==w||hdr.height!==h){
      hdr.setSize(w,h);for(const rt of history)rt.setSize(w,h);
      mist.setSize(Math.ceil(w/2),Math.ceil(h/2));
      for(const rt of [bloom0,bloom1])rt.setSize(Math.ceil(w/5),Math.ceil(h/5));
      u.pixel.value.set(1/w,1/h);valid=false;
    }
    camera.updateMatrixWorld();
    const proj=camera.projectionMatrix,ox=proj.elements[8],oy=proj.elements[9],j=jitter[frame++%jitter.length];
    proj.elements[8]+=2*j[0]/w;proj.elements[9]+=2*j[1]/h;camera.projectionMatrixInverse.copy(proj).invert();
    renderer.setRenderTarget(hdr);renderer.render(scene,camera);
    u.time.value=time;u.dusk.value=dusk;
    u.openingSun.value.set(cloudSunlight(openingCenters[0],time),cloudSunlight(openingCenters[1],time));u.forestAmount.value=1.-T.MathUtils.smoothstep(-camera.position.z,59,81);
    const bankDistance=Math.abs(camera.position.x-land.streamX(camera.position.z));
    const nearFord=1.-T.MathUtils.smoothstep(Math.abs(camera.position.z+39),6,26);
    u.bankShade.value=(1.-T.MathUtils.smoothstep(bankDistance,3.7,9.5))*nearFord;
    u.meadowLight.value=1.-T.MathUtils.smoothstep(Math.hypot(camera.position.x-12,camera.position.z+36),9,23);
    u.keyDirection.value.subVectors(sun.position,sun.target.position).normalize();
    u.keyActive.value=sun.shadow.map?1:0;u.keyDepth.value=sun.shadow.map?.texture??hdr.texture;
    pass(volumetric,mist);
    u.reuse.value=valid&&oldEye.distanceToSquared(camera.position)<9?1:0;
    front^=1;u.lastFrame.value=history[1-front].texture;
    pass(resolve,history[front]);u.resolved.value=history[front].texture;
    previousView.multiplyMatrices(proj,camera.matrixWorldInverse);oldEye.copy(camera.position);valid=true;
    proj.elements[8]=ox;proj.elements[9]=oy;camera.projectionMatrixInverse.copy(proj).invert();
    pass(bloomFirst,bloom0);
    u.bloomMap.value=bloom0.texture;u.blurAxis.value.set(1.7/bloom0.width,0);pass(blur,bloom1);
    u.bloomMap.value=bloom1.texture;u.blurAxis.value.set(0,1.7/bloom0.height);pass(blur,bloom0);
    u.bloomMap.value=bloom0.texture;
    if(present)pass(display,null);else renderer.setRenderTarget(null);
  }
  render.prepare=async (scene,hearth,deer)=>{
    const before=renderer.getRenderTarget();
    renderer.setRenderTarget(hdr);
    const prior=[];
    try{
      // Shader compilation alone leaves first-use morph textures, skinned bounds and VAOs lazy.
      // Draw every deer tier once so approaching the herd can reveal the
      // detailed coat, blink and shadow without a first-use upload.
      const bird=scene.getObjectByName('kingfisher');
      const warmObjects=[...camera.children,hearth,...deer];
      if(bird)warmObjects.push(bird);
      for(const child of warmObjects)child.traverse(part=>{
        prior.push([part,part.visible,part.frustumCulled]);
        part.visible=true;part.frustumCulled=false;
      });
      await renderer.compileAsync(scene,camera);
      renderer.render(scene,camera);
    }finally{
      for(const [part,visible,culled] of prior){part.visible=visible;part.frustumCulled=culled;}
      renderer.setRenderTarget(before);
    }
  };
  return render;
}
