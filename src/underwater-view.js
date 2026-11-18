import * as T from 'three';

// Render the actual fish, gravel and bed into a short-range color/depth buffer.
// Ray marching below the surface then samples the first submerged receiver.
export function createSubmergedView(scene){
  const target=new T.WebGLRenderTarget(720,405,{type:T.HalfFloatType,depthBuffer:true});
  target.texture.name='Submerged stream radiance';
  target.texture.colorSpace=T.LinearSRGBColorSpace;
  target.depthTexture=new T.DepthTexture(720,405);
  const camera=new T.PerspectiveCamera(),size=new T.Vector2(),proj=new T.Matrix4(),flatten=new T.Matrix4();
  const layer=7;
  camera.layers.set(layer);camera.matrixAutoUpdate=false;camera.far=45;
  let prepared=false;
  const uniforms={wetColor:{value:target.texture},wetDepth:{value:target.depthTexture},
    wetProjection:{value:proj},wetClip:{value:new T.Vector2()},hasWaterView:{value:0}};
  function prepare(){
    scene.traverse(o=>{
      const name=o.name;
      if(o.isLight||name==='Watershed trail and channel'||name==='Channel and path cobbles'||name.toLowerCase().includes('boulder'))o.layers.enable(layer);
      if(name==='Brook trout'||name==='Tied fly'||name==='Submerged leader')o.traverse(p=>p.layers.enable(layer));
    });
    prepared=true;
  }
  function draw(renderer,eye,enabled,waterLevel,slope,cosine){
    uniforms.hasWaterView.value=0;
    if(!enabled||renderer.getRenderTarget()===target)return;
    if(!prepared)prepare();
    renderer.getDrawingBufferSize(size);
    // A nearby moving trout needs a current depth silhouette on every frame.
    const scale=Math.min(.68,1000/size.x);
    const w=Math.max(2,Math.round(size.x*scale)),h=Math.max(2,Math.round(size.y*scale));
    if(w!==target.width||h!==target.height)target.setSize(w,h);
    camera.fov=eye.fov;camera.near=eye.near;camera.aspect=eye.aspect;camera.zoom=eye.zoom;camera.updateProjectionMatrix();
    camera.matrix.copy(eye.matrixWorld);camera.updateMatrixWorld(true);
    // Rasterize the bed from its apparent depth along the central Snell ray.
    // This preserves the continuous moving silhouette before the surface shader
    // resolves the local ray at each ripple and off-axis incidence angle.
    const c=T.MathUtils.clamp(cosine,.24,1),n=1.333;
    const k=1/Math.sqrt(n*n+(n*n-1)*(1-c*c)/(c*c));
    const intercept=waterLevel-eye.matrixWorld.elements[14]*slope;
    flatten.set(1,0,0,0, 0,k,(1-k)*slope,(1-k)*intercept, 0,0,1,0, 0,0,0,1);
    camera.projectionMatrix.multiply(camera.matrixWorldInverse).multiply(flatten).multiply(camera.matrixWorld);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    proj.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
    uniforms.wetClip.value.set(camera.near,camera.far);
    const shadows=renderer.shadowMap.autoUpdate,xr=renderer.xr.enabled,back=renderer.getRenderTarget();
    try{
      renderer.xr.enabled=false;renderer.shadowMap.autoUpdate=false;
      renderer.setRenderTarget(target);renderer.clear();renderer.render(scene,camera);
    }finally{
      renderer.setRenderTarget(back);renderer.shadowMap.autoUpdate=shadows;renderer.xr.enabled=xr;
    }
    uniforms.hasWaterView.value=1;
  }
  return {uniforms,draw};
}

export const submergedLight=`
uniform sampler2D wetColor,wetDepth;
uniform mat4 wetProjection;
uniform vec2 wetClip;
uniform float hasWaterView;
bool waterHit(vec3 origin,vec3 direction,float thickness,out vec3 radiance,out float travel){
  float maxTravel=clamp((thickness+.16)/max(.3,-direction.y),.12,2.6);
  vec4 start=wetProjection*vec4(origin,1.);
  float startDepth=texture2D(wetDepth,start.xy/start.w*.5+.5).r;
  float previous=start.w-wetClip.x*wetClip.y/(wetClip.y-startDepth*(wetClip.y-wetClip.x));
  for(int i=1;i<=10;i++){
    float t=maxTravel*float(i)*.1;
    vec3 p=origin+direction*t;
    vec4 clip=wetProjection*vec4(p,1.);
    vec2 uv=clip.xy/clip.w*.5+.5;
    if(clip.w<=0.||any(lessThan(uv,vec2(.002)))||any(greaterThan(uv,vec2(.998))))return false;
    float z=texture2D(wetDepth,uv).r;
    float receiver=wetClip.x*wetClip.y/(wetClip.y-z*(wetClip.y-wetClip.x));
    float gap=clip.w-receiver;
    // Terrain or tackle in front of the interface must never paint across a bank.
    if(gap>=0. && previous<0.){
      float refine=t-(maxTravel*.1)*gap/max(.0001,gap-previous);
      vec4 refined=wetProjection*vec4(origin+direction*refine,1.);
      radiance=texture2D(wetColor,refined.xy/refined.w*.5+.5).rgb;
      travel=refine;return true;
    }
    previous=gap;
  }
  return false;
}`;
