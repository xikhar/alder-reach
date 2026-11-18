import * as THREE from 'three';
import reach from './vegetation-lod.json' with {type:'json'};
import optics from './colony-optics.json' with {type:'json'};
const bandGLSL=band=>band.map(v=>v.toFixed(1)).join(',');
const pigment=name=>'vec3('+optics.pigment[name].join(',')+')';

// The fourth flower channel is area, independent of the premultiplied linear
// pigment in RGB. Preserve small RGB values even when area quantizes to zero.
export function createFlowerField(manager){
  const loader=new THREE.ImageBitmapLoader(manager);
  loader.setOptions({premultiplyAlpha:'none',colorSpaceConversion:'none',imageOrientation:'none'});
  function sheet(region,cover){
    const texture=new THREE.Texture();
    // Successive 8-bit mip reductions can round an entire sparse colony to zero.
    texture.type=THREE.HalfFloatType;
    texture.flipY=false;texture.anisotropy=4;texture.minFilter=THREE.LinearMipmapLinearFilter;
    loader.load(import.meta.env.BASE_URL+'art/woods/colony-'+region+'-'+cover+'.png',image=>{
      texture.image=image;texture.needsUpdate=true;
    });
    return {value:texture};
  }
  return {watershedFlowers:sheet('world','flowers'),watershedHeath:sheet('world','heath'),
    bankFlowers:sheet('banks','flowers'),bankHeath:sheet('banks','heath')};
}

export const flowerFieldGLSL=`
uniform sampler2D watershedFlowers,watershedHeath,bankFlowers,bankHeath;
// Extinction and linear pigment are independent area integrals. Linear mipmaps
// conserve both as a screen pixel spans many individual native crowns.
vec3 colonySurface(vec3 soil,vec3 p,vec3 normal,float habitat){
  vec3 view=cameraPosition-p;
  float range=length(view.xz);
  float flowerFade=smoothstep(${bandGLSL(reach.field.flowers)},range),heathFade=smoothstep(${bandGLSL(reach.field.bilberry)},range);
  vec3 ray=normalize(view);
  float incidence=max(.13,abs(dot(normal,ray)));
  vec2 q=p.xz+ray.xz*(.32*normal.y/incidence);
  vec2 dx=dFdx(q),dy=dFdy(q);
  float rootRange=distance(cameraPosition.xz,q);
  float fernFade=smoothstep(${bandGLSL(reach.field.fern)},rootRange),ragwortFade=smoothstep(${bandGLSL(reach.field.ragwort)},rootRange);
  // Ragwort only grows along the wooded trail; avoid any early survey read elsewhere.
  if(q.y< -77. || abs(q.x)>18.)ragwortFade=0.;
  bool readUnder=max(heathFade,max(fernFade,ragwortFade))>0.;
  if(habitat<.0001 || (!readUnder && flowerFade<=0.) || max(abs(q.x),abs(q.y))>=1088.)return soil;
  vec2 uv=(q+1088.)/2176.;
  vec2 local=(q+vec2(32.,120.))/vec2(64.,128.);
  vec2 edge=min(local,1.-local)*vec2(64.,128.);
  float fine=smoothstep(.8,3.5,min(edge.x,edge.y));
  vec4 flowers=vec4(0.),under=vec4(0.);
  if(fine<1.){
    if(flowerFade>0.)flowers=textureGrad(watershedFlowers,uv,dx/2176.,dy/2176.)/vec4(6.,6.,6.,3.);
    if(readUnder)under=textureGrad(watershedHeath,uv,dx/2176.,dy/2176.)/vec4(2.,2.,6.,6.);
  }
  if(fine>0.){
    vec2 scale=vec2(64.,128.);
    if(flowerFade>0.)flowers=mix(flowers,textureGrad(bankFlowers,local,dx/scale,dy/scale),fine);
    if(readUnder)under=mix(under,textureGrad(bankHeath,local,dx/scale,dy/scale),fine);
  }
  // Oblique sight lines cross more foliage. Apply this after spatial filtering
  // so a diffuse kilometre-scale colour converges to the resident population.
  float angular=inversesqrt(incidence);
  vec4 area=(1.-pow(1.-clamp(vec4(under.rg,under.b+under.a,flowers.a),0.,1.),vec4(angular)))*habitat;
  soil=mix(soil,${pigment('Fern')},area.g*fernFade);
  vec3 ragwort=mix(${pigment('RagwortLeaves')},${pigment('RagwortHeads')},under.a/max(.000001,under.a+under.b));
  soil=mix(soil,ragwort,area.b*ragwortFade);
  float rim=step(-15.,q.x)*step(q.x,15.)*step(-108.,q.y)*step(q.y,-83.);
  float bank=step(8.,q.x)*step(q.x,17.)*step(-37.,q.y)*step(q.y,-31.);
  vec3 leaves=${pigment('Bilberry')}*mix(mix(vec3(1.),vec3(.38,.48,.51),rim),vec3(.32,.40,.31),bank);
  soil=mix(soil,leaves,area.r*heathFade);
  return mix(soil,clamp(flowers.rgb/max(.001,flowers.a),0.,1.),area.a*flowerFade);
}
`;
