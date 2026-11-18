import reach from './vegetation-lod.json' with {type:'json'};

// The two real meshes share a root-plane sample along each eye ray even when
// their leaves lie at different depths. Use it in the colour and depth passes.
export function screenPlantDetail(shader,observer,band,detailed){
  shader.uniforms.plantEye=observer;
  shader.vertexShader='uniform vec3 plantEye;varying vec4 plantScreen;\n'+shader.vertexShader.replace(
    '#include <project_vertex>',`
      plantScreen=vec4(0.,0.,1.,0.);
      #ifdef USE_INSTANCING
      vec3 plantRoot=(modelMatrix*instanceMatrix[3]).xyz;
      vec2 axis=plantRoot.xz-plantEye.xz;
      float rootDistance=length(axis);
      float fade=smoothstep(${band[0].toFixed(1)},${band[1].toFixed(1)},rootDistance);
      if(fade>0. && fade<1.){
        axis/=max(.001,rootDistance);
        vec3 ray=(modelMatrix*instanceMatrix*vec4(transformed,1.)).xyz-plantEye;
        float depth=dot(ray.xz,axis)/max(.001,rootDistance);
        plantScreen=vec4(dot(ray.xz,vec2(-axis.y,axis.x)),
          ray.y-(plantRoot.y-plantEye.y)*depth,depth,fade);
      }
      if(${detailed?'fade>=1.':'fade<=0.'})transformed=vec3(0.);
      #endif
      #include <project_vertex>`);
  shader.fragmentShader='varying vec4 plantScreen;\n'+shader.fragmentShader.replace(
    '#include <clipping_planes_fragment>',`#include <clipping_planes_fragment>
      if(plantScreen.w>0. && plantScreen.w<1.){
        vec2 cell=floor(plantScreen.xy/max(.001,plantScreen.z)*104.);
        float sampleLod=fract(52.9829189*fract(dot(cell,vec2(.06711056,.00583715))));
        if(${detailed?'sampleLod<plantScreen.w':'sampleLod>=plantScreen.w'})discard;
      }`);
}

const {flowerDetail:flowers,bluebellDetail:bluebells,fernDetail:ferns}=reach;
export const flowerDetail={
  Lupine:flowers,LupineSpike:flowers,LupineRose:flowers,MeadowCinquefoil:flowers,
  Paintbrush:flowers,Yarrow:flowers,Bluebell:bluebells,BluebellLeaf:bluebells,Fern:ferns,
};
