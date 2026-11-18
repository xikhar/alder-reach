import * as THREE from 'three';
import reach from './vegetation-lod.json' with {type:'json'};
import {windGLSL} from './weather.js';

// At most sqrt(2)*5.8 m of player movement between streamed populations.
export const grassBands=reach.grass;

// Root position gives a stable LOD rank independently of the local wind direction.
export function grassRank(x,z){
  // A 1/32 m grid makes the phase exact in both JS and GPU float32.
  const phase=(Math.floor(x*32+.5)*.59375+Math.floor(z*32+.5)*.2890625)/32;
  return phase-Math.floor(phase);
}
// The sheltered rim uses finer, denser grass. Soften its edge into the
// established understory field over several metres in both representations.
export function rimGrassWeight(x,z){
  const smooth=THREE.MathUtils.smoothstep;
  return (1-smooth(Math.abs(x+2.4),12,19))*smooth(z,-130,-120)*(1-smooth(z,-78,-72));
}
export const grassWindGLSL=`
float rimGrassAmount(vec2 p){
  return (1.-smoothstep(12.,19.,abs(p.x+2.4)))*smoothstep(-130.,-120.,p.y)*(1.-smoothstep(-78.,-72.,p.y));
}
vec2 meadowWind(vec2 p,float t){
  float slope=sin(dot(p,vec2(.53,-.28))-t*1.96+.68*sin(p.y*.21+t*.32));
  float swell=smoothstep(-.83,.88,slope);
  return windOffset(p,t)*.60+vec2(.073,-.027)*swell-vec2(.015,-.005)
    -vec2(.077,-.031)*rimGrassAmount(p);
}
`;

export function createGrassField(loader){
  function strata(file){
    const map=loader.load(import.meta.env.BASE_URL+'art/woods/'+file);
    map.wrapS=map.wrapT=THREE.RepeatWrapping;
    map.flipY=false;map.anisotropy=4;map.colorSpace=THREE.NoColorSpace;
    return {value:map};
  }
  return {bladeStrata:strata('blade-strata.png'),rimStrata:strata('rim-strata.png'),grassTime:{value:0}};
}

export const grassSurfaceGLSL=`
uniform sampler2D bladeStrata,rimStrata;
uniform float grassTime;
${windGLSL}
${grassWindGLSL}
// Integrate bottom, middle, and upper portions of a 6 m square of native blades.
// Each mip texel contains fractional area. The incidence correction accounts for
// more than one tuft along almost-horizontal rays. Near geometry supplies silhouettes.
vec4 distantGrass(vec3 p,vec3 n,float distanceToEye,float habitat,float woods){
  // Keep fractional coverage physical at partially covered terrain edges.
  habitat=clamp(habitat,0.,1.);
  woods=clamp(woods,0.,1.);
  float handoff=smoothstep(${grassBands.field[0].toFixed(1)},${grassBands.field[1].toFixed(1)},distanceToEye);
  vec2 field=p.xz+vec2(.12*p.y,-.08*p.y);
  vec2 gradX=dFdx(field),gradY=dFdy(field);
  float footprint=max(length(gradX),length(gradY));
  float rim=rimGrassAmount(p.xz);
  // Matted leaf litter shows through gaps between the rooted, standing blades.
  vec3 litterPigment=vec3(.310,.364,.260);
  float litter=rim*habitat*.74*(1.-handoff);
  if(handoff*habitat<.001)return vec4(litterPigment,litter);
  vec3 eyeRay=(cameraPosition-p)/max(distanceToEye,.001);
  float incidence=max(.16,abs(dot(eyeRay,n)));
  vec2 ray=eyeRay.xz*n.y/incidence;
  float swale=.62*valueNoise(field*.019)+.38*valueNoise(field*.074+7.6);
  swale=mix(swale,.5,smoothstep(7.,38.,footprint));
  vec2 bend=meadowWind(p.xz,grassTime);
  vec2 uv=field+vec2(1.45*sin(field.y*.13),1.7*sin(field.x*.081+field.y*.047));
  vec2 basalUV=(uv+ray*.065-bend*.05)/6.,midUV=(uv+ray*.20-bend*.27)/6.,tipUV=(uv+ray*.35-bend*.63)/6.;
  float root=textureGrad(bladeStrata,basalUV,gradX/6.,gradY/6.).r;
  float middle=textureGrad(bladeStrata,midUV,gradX/6.,gradY/6.).g;
  float tip=textureGrad(bladeStrata,tipUV,gradX/6.,gradY/6.).b;
  if(rim>0.){
    root=mix(root,textureGrad(rimStrata,basalUV,gradX/6.,gradY/6.).r,rim);
    middle=mix(middle,textureGrad(rimStrata,midUV,gradX/6.,gradY/6.).g,rim);
    tip=mix(tip,textureGrad(rimStrata,tipUV,gradX/6.,gradY/6.).b,rim);
  }
  float area=1.-(1.-root)*(1.-middle)*(1.-tip);
  area=1.-pow(max(.001,1.-area),inversesqrt(incidence));
  vec3 pigment=mix(vec3(.058,.080,.038),vec3(.192,.179,.082),smoothstep(.18,.82,swale));
  pigment*=.77+.30*max(0.,dot(normalize(n+vec3(bend.x,0.,bend.y)*.60),normalize(vec3(-.81,.54,.16))));
  // Diffuse self-occlusion at the root, brighter exposed tips. The ratios
  // converge to their area mean as the texture footprint covers whole tufts.
  pigment*=.88+.19*(tip+.5*middle);
  float crown=area*handoff*habitat*(.93-.46*woods);
  litter*=1.-crown;
  return vec4((pigment*crown+litterPigment*litter)/max(.00001,crown+litter),crown+litter);
}
`;

// Native meshes carry the habitat, woodland density and the amount of detailed
// grass available around the five exported landmarks. This is calculated only
// during export. It adds no GPU streams to the game terrain.
export function nativeGrassHabitat(geometry,indices,land,views){
  const {position,normal,channel,canopy,basinPaint,snowCatchment,terrainSeam}=geometry.attributes;
  if(!channel&&!snowCatchment)return null;
  const result=new Float32Array(indices.length*3),smooth=THREE.MathUtils.smoothstep;
  for(let j=0;j<indices.length;j++){
    const i=indices[j],x=position.getX(i),y=position.getY(i),z=position.getZ(i),ny=Math.abs(normal.getY(i));
    let habitat,woods;
    if(channel){
      const dx=Math.abs(x-channel.getX(i))/channel.getY(i);
      const bar=1.20+.47*(1-smooth(Math.abs(z+38),4.6,10))*(x<channel.getX(i)?1:0);
      const trail=smooth(Math.abs(x-land.trailX(z)),1.18,1.66);
      const margin=land.fordMargin(x);
      const ford=smooth(Math.abs(z-land.fordTrailZ(x)),.44*margin,1.02*margin);
      const spur=(1-ford)*smooth(x,-3,1)*(1-smooth(x,channel.getX(i)-channel.getY(i)-.8,channel.getX(i)-channel.getY(i)+.55));
      habitat=smooth(dx,bar-.12,bar+.19)*smooth(ny,.59,.91)*(1-Math.max((1-trail)*(1-smooth(-z,58,73)),spur*.85));
      woods=canopy.getX(i);
    }else{
      habitat=(1-smooth(snowCatchment.getW(i),.17,.29))*(1-smooth(y,100,285))*smooth(ny,.67,.94);
      woods=terrainSeam.getY(i);
    }
    habitat*=1-.93*(channel?basinPaint.getW(i):terrainSeam.getZ(i));
    let nearest=Infinity;
    for(const v of views)nearest=Math.min(nearest,Math.hypot(x-v.x,z-v.z));
    result.set([habitat,woods,smooth(nearest,...grassBands.field)],j*3);
  }
  return result;
}

// The native distribution is stationary around each exported landmark. Record
// the outer blades' size at that landmark so the last tufts settle into the field.
export function nativeGroundStature(object,matrix,distance){
  let band=object.userData.groundcoverFade;
  if(object.userData.grassTuft){
    const m=matrix.elements,rank=grassRank(m[12],m[14]);
    const end=THREE.MathUtils.lerp(...grassBands.middle,rank);
    band=[end-grassBands.middleFade,end];
  }
  return band?1-THREE.MathUtils.smoothstep(distance,...band):1;
}
