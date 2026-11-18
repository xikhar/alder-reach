import {ImageBitmapLoader,LinearMipmapLinearFilter,NoColorSpace,RepeatWrapping,Texture} from 'three';

export async function loadEarth(manager){
  const reader=new ImageBitmapLoader(manager);
  reader.setOptions({imageOrientation:'flipY',premultiplyAlpha:'none',colorSpaceConversion:'none'});
  const fields=await Promise.all(['woodland','meadow','trail','shingle'].map(async name=>{
    const bitmap=await reader.loadAsync(import.meta.env.BASE_URL+'art/earth/'+name+'-floor.png');
    const texture=new Texture(bitmap);
    texture.name=name+' earth relief';texture.colorSpace=NoColorSpace;
    texture.wrapS=texture.wrapT=RepeatWrapping;texture.minFilter=LinearMipmapLinearFilter;
    texture.anisotropy=8;texture.needsUpdate=true;
    return [name+'Earth',{value:texture}];
  }));
  return Object.fromEntries(fields);
}

export const earthGLSL=`
uniform sampler2D woodlandEarth,meadowEarth,trailEarth,shingleEarth;
uniform float earthStrength;
const mat2 earthTurn=mat2(.8,.6,-.6,.8);
vec4 earthSample(sampler2D source,vec2 p,vec2 dx,vec2 dy,float blend){
  vec4 first=textureGrad(source,p/1.60,dx/1.60,dy/1.60)*2.-1.;
  vec4 second=textureGrad(source,earthTurn*p/1.93+vec2(.37,.61),earthTurn*dx/1.93,earthTurn*dy/1.93)*2.-1.;
  // Express both slopes in the same world axes before mixing the two scans.
  second.gb=transpose(earthTurn)*second.gb;
  return mix(first,second,blend);
}
vec3 earthSurface(vec3 base,vec2 p,vec3 normal,float range,float variation,float meadow,
                  float trail,float shingle,out vec3 shadedNormal){
  shadedNormal=normal;
  vec2 dx=dFdx(p),dy=dFdy(p);
  float strength=earthStrength*(1.-smoothstep(38.,118.,range));
  if(strength<=0.)return base;
  float organic=(1.-shingle)*(1.-trail);
  vec4 weights=vec4(organic*(1.-meadow),organic*meadow,(1.-shingle)*trail,shingle);
  vec4 detail=vec4(0.);
  float blend=smoothstep(.28,.72,variation);
  if(weights.x>.0001)detail+=weights.x*earthSample(woodlandEarth,p,dx,dy,blend);
  if(weights.y>.0001)detail+=weights.y*earthSample(meadowEarth,p,dx,dy,blend);
  if(weights.z>.0001)detail+=weights.z*earthSample(trailEarth,p,dx,dy,blend);
  if(weights.w>.0001)detail+=weights.w*earthSample(shingleEarth,p,dx,dy,blend);
  vec3 slope=vec3(detail.g,0.,detail.b)*1.45;
  shadedNormal=normalize(normal+.78*strength*(slope-normal*dot(slope,normal)));
  vec3 pigment=exp2(strength*(1.55*detail.r+detail.a*vec3(.27,.035,-.32)));
  return base*pigment;
}`;
