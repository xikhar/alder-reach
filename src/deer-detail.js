import {MathUtils,MeshDepthMaterial,MeshDistanceMaterial,RGBADepthPacking,SkinnedMesh,Vector2} from 'three';

// Pixel heights of an upright adult, adjusted at runtime for the actual model
// scale, drawing buffer, projection and camera position.
const fullBand=[57.5,77.5],middleBand=[34,50];
const clip='#include <clipping_planes_fragment>';
const coverageGLSL=`
  if(deerCoverage.x>0. || deerCoverage.y<1.){
    float threshold=fract(52.9829189*fract(dot(floor(gl_FragCoord.xy),vec2(.06711056,.00583715))));
    if(threshold<deerCoverage.x || threshold>=deerCoverage.y)discard;
  }
`;

function gate(material,coverage){
  const compile=material.onBeforeCompile,program=material.customProgramCacheKey();
  material.onBeforeCompile=function(shader,renderer){
    compile.call(this,shader,renderer);
    shader.uniforms.deerCoverage=coverage;
    shader.fragmentShader='uniform vec2 deerCoverage;\n'+shader.fragmentShader.replace(clip,clip+'\n'+coverageGLSL);
  };
  material.customProgramCacheKey=()=>program+'-cervid-coverage-v1';
  return material;
}

export function deerDistanceLibrary(gltf){
  const species=new Map();
  gltf.scene.traverse(mesh=>{
    if(!mesh.isSkinnedMesh)return;
    const {cervidAsset,cervidDetail}=mesh.userData;
    if(!species.has(cervidAsset))species.set(cervidAsset,[]);
    species.get(cervidAsset)[cervidDetail-1]=mesh;
  });
  return species;
}

export function attachDeerDetail(actor,library){
  const base=actor.skin[0],rig=base.skeleton,middleAndFar=library.get(actor.asset);
  const blink=actor.skin.find(m=>m.material.name==='Upper eyelid fur');
  const stages=[actor.skin.slice()];
  for(const template of middleAndFar){
    // Both exported palettes use the master armature's joint order and rest
    // transforms. No template bone or extra AnimationMixer enters the scene.
    if(template.skeleton.bones.length!==rig.bones.length||template.skeleton.bones.some((b,i)=>
      (b.userData.name??b.name)!==(rig.bones[i].userData.name??rig.bones[i].name)))
      throw Error('Distance mesh joint order differs from '+actor.asset);
    const mesh=new SkinnedMesh(template.geometry,template.material);
    mesh.name=template.name+' / '+actor.seed;mesh.userData.cervidDetail=template.userData.cervidDetail;
    mesh.position.copy(base.position);mesh.quaternion.copy(base.quaternion);mesh.scale.copy(base.scale);
    mesh.castShadow=mesh.receiveShadow=true;base.parent.add(mesh);mesh.bind(rig,base.bindMatrix);
    mesh.boundingSphere=base.boundingSphere.clone();
    mesh.morphTargetDictionary=template.morphTargetDictionary;
    if(mesh.morphTargetDictionary.Blink!==blink.morphTargetDictionary.Blink)throw Error('Incompatible cervid blink channel');
    mesh.morphTargetInfluences=blink.morphTargetInfluences;
    mesh.visible=false;stages.push([mesh]);
  }
  const bands=stages.map((meshes,i)=>{
    const coverage={value:new Vector2(0,i===0?1:0)};
    for(const mesh of meshes){
      mesh.material=gate(mesh.material.clone(),coverage);
      mesh.customDepthMaterial=gate(new MeshDepthMaterial({depthPacking:RGBADepthPacking,side:mesh.material.side}),coverage);
      mesh.customDistanceMaterial=gate(new MeshDistanceMaterial({side:mesh.material.side}),coverage);
    }
    return coverage.value;
  });
  const height=actor.asset==='red-deer'?2.34:2.04;
  return {update(camera,drawingBufferHeight){
    const p=actor.root.position,size=height*actor.root.scale.y,e=camera.matrixWorldInverse.elements;
    const cy=p.y+.5*size;
    const viewDepth=-(e[2]*p.x+e[6]*cy+e[10]*p.z+e[14]);
    const range=Math.hypot(p.x-camera.position.x,cy-camera.position.y,p.z-camera.position.z);
    // For off-screen or rearward animals retain an appropriate shadow mesh.
    const pixels=.5*drawingBufferHeight*camera.projectionMatrix.elements[5]*size/Math.max(.55*range,viewDepth,.03);
    const full=MathUtils.smoothstep(pixels,...fullBand),throughMiddle=MathUtils.smoothstep(pixels,...middleBand);
    bands[0].set(0,full);bands[1].set(full,throughMiddle);bands[2].set(throughMiddle,1);
    for(let i=0;i<stages.length;i++){
      const visible=bands[i].y>bands[i].x;
      for(const m of stages[i])m.visible=visible;
    }
  }};
}
