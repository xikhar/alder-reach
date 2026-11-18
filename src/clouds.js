import * as T from 'three';

// Each column spans 200 m vertically. Both its eroded sides and its density
// move with the weather field. The same field is packed into the Blender scene.
const period=6400;
export const cloudGLSL=`
  uniform sampler2D cloudField;
  float cloudDensity(vec2 p,float layer,float time){
    vec2 uv=(p-vec2(6.3,-2.4)*time)/6400.;
    vec2 weather=texture2D(cloudField,uv).rg;
    float side=2.*layer-1.;
    return max(0.,weather.r*1.18+(weather.g-.5)*.28-.12-side*side*.88)*sin(3.14159*layer);
  }
  vec3 cloudLayer(vec3 air,vec3 origin,vec3 ray,vec3 sun,float clock,float dusk){
    if(ray.y<.018)return air;
    float transmittance=1.;
    vec3 light=vec3(0.);
    float opticalScale=.00049*50./max(.14,ray.y);
    for(int i=0;i<4;i++){
      float layer=(float(i)+.5)*.25;
      float travel=(760.+200.*layer-origin.y)/ray.y;
      vec2 point=origin.xz+ray.xz*travel;
      float density=cloudDensity(point,layer,clock);
      float shadow=cloudDensity(point+sun.xz*95.,min(.96,layer+.16),clock);
      float opacity=1.-exp(-density*opticalScale);
      vec3 illuminated=mix(vec3(.78,.80,.77),vec3(.45,.57,.66),min(1.,1.4*shadow));
      illuminated=mix(illuminated,vec3(.36,.24,.24),.72*dusk);
      light+=transmittance*opacity*illuminated;
      transmittance*=1.-opacity;
    }
    return mix(air,air*transmittance+light,smoothstep(.018,.105,ray.y));
  }`;

export function createClouds(loader){
  let pixels,side=0;
  const field=loader.load(import.meta.env.BASE_URL+'art/cloud-density.png',map=>{
    const canvas=document.createElement('canvas');
    side=map.image.width;canvas.width=side;canvas.height=side;
    const context=canvas.getContext('2d');
    context.drawImage(map.image,0,0);pixels=context.getImageData(0,0,side,side).data;
  });
  field.wrapS=field.wrapT=T.RepeatWrapping;
  field.colorSpace=T.NoColorSpace;
  function sample(u,v){
    const ix=Math.floor(u),iy=Math.floor(v),dx=u-ix,dy=v-iy;
    const at=(x,y)=>pixels[(T.MathUtils.euclideanModulo(y,side)*side+T.MathUtils.euclideanModulo(x,side))*4]/255;
    return T.MathUtils.lerp(T.MathUtils.lerp(at(ix,iy),at(ix+1,iy),dx),T.MathUtils.lerp(at(ix,iy+1),at(ix+1,iy+1),dx),dy);
  }
  function sunlight(ground,time){
    if(!pixels)return 1;
    const height=860-ground.y;
    const x=ground.x-height*81/45-time*6.3,z=ground.z+height*12/45+time*2.4;
    const cover=sample(x/period*side-.5,-z/period*side-.5);
    return Math.exp(-.083*Math.max(0,cover*1.18-.12));
  }
  return {field,sunlight};
}
