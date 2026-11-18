import * as T from 'three';

// Estimate the contact-hardening penumbra from blockers in the existing directional depth map.
// A fixed world-space pattern stays quiet when the camera pans.
export function installSunFilter(){
  const chunk=T.ShaderChunk.shadowmap_pars_fragment;
  const start=chunk.indexOf('#elif defined( SHADOWMAP_TYPE_PCF_SOFT )');
  const end=chunk.indexOf('#elif defined( SHADOWMAP_TYPE_VSM )',start);
  if(start<0||end<0)return;
  T.ShaderChunk.shadowmap_pars_fragment=chunk.slice(0,start)+`#elif defined( SHADOWMAP_TYPE_PCF_SOFT )
    vec2 texel=1./shadowMapSize;
    float zReceiver=shadowCoord.z;
    float blockerSum=0., blockerCount=0.;
    for(int j=0;j<7;++j){
      float angle=float(j)*2.39996;
      vec2 offset=vec2(cos(angle),sin(angle))*sqrt((float(j)+.5)/7.)*7.*texel;
      float zBlock=unpackRGBAToDepth(texture2D(shadowMap,shadowCoord.xy+offset));
      float covered=step(zBlock+.00008,zReceiver);
      blockerSum+=(zReceiver-zBlock)*covered;blockerCount+=covered;
    }
    float sizePx=clamp(.92+blockerSum/max(1.,blockerCount)*141.,.92,14.);
    shadow=0.;
    for(int j=0;j<13;++j){
      float a=float(j)*2.39996+.67;
      vec2 off=vec2(cos(a),sin(a))*sqrt((float(j)+.5)/13.)*sizePx*texel;
      shadow+=texture2DCompare(shadowMap,shadowCoord.xy+off,zReceiver);
    }
    shadow/=13.;
  `+chunk.slice(end);
}

/** Forest openings admit a broad lobe of warm bounce light, strongest on the sunward edge. */
export function addClearingLight(scene,land,terrain){
  const portals=[];
  function opening(x,z,power,radius,offset=new T.Vector3(-7.4,8.4,4.9),color=0xffdab0){
    const target=new T.Object3D();target.position.set(x,land.height(x,z)+.6,z);
    // A canopy opening transmits distant sunlight. Match its floor illuminance
    // while avoiding an inverse-square hot spot on branches beside the opening.
    const illuminance=power/offset.lengthSq();
    const lamp=new T.SpotLight(color,illuminance,26,radius,.68,0);
    lamp.position.copy(target.position).add(offset);
    lamp.target=target;lamp.name='Light through canopy';scene.add(lamp,target);
    portals.push({lamp,power:illuminance});
    return lamp;
  }
  opening(-5.5,-6.9,780,.52,new T.Vector3(-7.4,8.4,4.9),0xffdc9d);
  opening(10.7,-40.6,478,.61,new T.Vector3(-7.4,8.4,4.9),0xffd6a6);
  // The creek-side opening lights the dry shelf and falls away before the wet shingle.
  const bank=opening(17.4,-36.1,376,.47,new T.Vector3(7.8,7,1.6),0xffc28a);
  terrain.setGroundOpening(bank);
  opening(10.9,-40.0,752,.55,new T.Vector3(-8.4,6.2,-8.9),0xffce89);
  return function setTime(dusk,clock){
    for(const {lamp,power} of portals){
      lamp.intensity=power*(1-dusk)**2*terrain.cloudSunlight(lamp.target.position,clock);
    }
  };
}
