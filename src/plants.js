import {TREE_HEIGHT,inGrid,random} from './tree-stands.js';
import reach from './vegetation-lod.json' with {type:'json'};
import {reservePlantDraws} from './plant-pools.js';
import {flowerDetail,screenPlantDetail} from './plant-detail.js';
import {grassBands,grassRank,grassWindGLSL,rimGrassWeight} from './groundcover.js';
import * as THREE from 'three';
import {createErratics} from './erratics.js';
import {trailMargin} from './trail-stones.js';
import {rockNearBand,screenRock} from './rock-lod.js';
import { windGLSL } from './weather.js';
import {createFlowerSites,crestMeadow} from './flower-sites.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const TAU = Math.PI * 2;
import {shadowField,visitFerns} from './fern-sites.js';
const toolMatrix = new THREE.Object3D();
const tint = new THREE.Color();
async function textureAt(url, repeating = false, relief = false) {
  const map = await new THREE.TextureLoader().loadAsync(url);
  map.colorSpace = relief ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  map.anisotropy = 4;
  map.flipY = false;
  if (repeating) map.wrapS = map.wrapT = THREE.RepeatWrapping;
  return map;
}
// Each pair of distances is shared by the CPU crop and the complementary dither
// gates on adjacent meshes. Small saplings simplify earlier than full-height trees.
const {treeDetail:nearFade,treeMiddle:farFade,treeHorizon:horizonFade,groundShadow:groundShadowFade}=reach;
const midpoint=band=>(band[0]+band[1])*.5;
const forestBands=[[0,nearFade[1]], [nearFade[0],farFade[1]], [farFade[0],horizonFade[1]]];
function lodScale(scale){return THREE.MathUtils.clamp(scale,.49,1.05);}
// Project the transformed local bounding box onto one axis of the sun's map.
function fitsSunAxis(axis,limit,center,half,m,i){
  const alongX=axis.x*m[i]+axis.y*m[i+1]+axis.z*m[i+2];
  const alongY=axis.x*m[i+4]+axis.y*m[i+5]+axis.z*m[i+6];
  const alongZ=axis.x*m[i+8]+axis.y*m[i+9]+axis.z*m[i+10];
  const radius=Math.abs(alongX)*half.x+Math.abs(alongY)*half.y+Math.abs(alongZ)*half.z;
  return Math.abs(center.dot(axis))<=limit+radius;
}
function livingMaterial(name,maps,clock,actors,eye,lightAxes,stage,grassStage,plantBand,detailed,depth=false) {
  const bark=name==='BirchBark'||name==='FirBark', rock=name==='Rock';
  const grass=name==='Grass', brookFlowers=name==='BrookFlowers', flowers=brookFlowers||name==='Flowers', needles=name==='Needles';
  const broadleaf=name==='Leaves'||name==='Understory', living=grass||flowers||needles||broadleaf;
  const common={vertexColors:true,side:bark||rock?THREE.FrontSide:THREE.DoubleSide};
  const mat=depth ? new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking}) :
    bark||rock||brookFlowers ? new THREE.MeshStandardMaterial({...common,roughness:rock?.91:brookFlowers?.72:.84,metalness:0}) : new THREE.MeshLambertMaterial(common);
  if(bark&&!depth){
    mat.map=name==='BirchBark'?maps.birch:maps.fir;
    mat.normalMap=name==='BirchBark'?maps.birchNormal:maps.firNormal;
    mat.normalScale.setScalar(name==='BirchBark'?.43:.63);
  }
  if(needles){mat.map=maps.needles;mat.alphaTest=.30;}
  mat.name=depth?name+' sun depth':name;
  mat.onBeforeCompile=shader=>{
    shader.vertexShader='varying vec3 vForestPoint;\n'+shader.vertexShader;
    shader.fragmentShader='varying vec3 vForestPoint;\n'+shader.fragmentShader;
    let transform='#include <begin_vertex>\nvForestPoint=position;';
    const groundFade=depth && (grass||flowers||name==='Understory');
    if(stage>=0||groundFade){
      shader.uniforms.groveObserver={value:actors.value[0]};
      shader.uniforms.groveRight={value:lightAxes.right};
      shader.uniforms.groveUp={value:lightAxes.up};
      shader.vertexShader='uniform vec2 groveObserver;uniform vec3 groveRight,groveUp;varying vec2 vLodRange,vCoveragePoint;\n'+shader.vertexShader;
      shader.fragmentShader='varying vec2 vLodRange,vCoveragePoint;\n'+shader.fragmentShader;
      const transition=(band,d)=>`smoothstep(${band[0].toFixed(1)},${band[1].toFixed(1)},${d})`;
      const end=groundFade||stage===0?'1.0':transition(stage===1?nearFade:farFade,'d');
      const start=groundFade?transition(groundShadowFade,'rawDistance'):
        stage===2?transition(horizonFade,'rawDistance'):transition(stage===0?nearFade:farFade,'d');
      transform+=`
        vLodRange=vec2(0.,1.);
        #ifdef USE_INSTANCING
        float rawDistance=distance(groveObserver,instanceMatrix[3].xz);
        float d=rawDistance/clamp(length(instanceMatrix[1].xyz),.49,1.05);
        vLodRange=vec2(${start},${end});
        #endif
      `;
      shader.fragmentShader=shader.fragmentShader.replace('#include <clipping_planes_fragment>',`
        #include <clipping_planes_fragment>
        // Anchor coverage perpendicular to the sun, independently of camera rotation.
        // Overlapping surfaces and adjacent detail levels complement each other in the map.
        if(vLodRange.x>0. || vLodRange.y<1.){
          vec2 cell=floor(${stage===2&&!depth?'vLodRange.x>0. ? gl_FragCoord.xy : vCoveragePoint':'vCoveragePoint'});
          float sampleLod=fract(52.9829189*fract(dot(cell,vec2(.06711056,.00583715))));
          if(sampleLod<vLodRange.x || sampleLod>=vLodRange.y)discard;
        }
      `);
    }
    if(living){
      shader.uniforms.forestTime=clock;shader.uniforms.groveActors=actors;
      shader.vertexShader='uniform float forestTime;uniform vec2 groveActors[5];\n'+windGLSL+(grass?grassWindGLSL:'')+shader.vertexShader;
      if(grass){
        shader.vertexShader=shader.vertexShader.replace('#include <uv_vertex>',`
          #include <uv_vertex>
          vec2 grassRoot=modelMatrix[3].xz;
          #ifdef USE_INSTANCING
            grassRoot=(modelMatrix*instanceMatrix[3]).xz;
          #endif
          vec2 grassBreeze=meadowWind(grassRoot,forestTime);
          float rimTurf=rimGrassAmount(grassRoot);
        `);
      }
      transform+=`
        mat4 grovePose=modelMatrix;
        #ifdef USE_INSTANCING
        grovePose=modelMatrix*instanceMatrix;
        #endif
        vec3 grove=(grovePose*vec4(position,1.)).xyz;
        vec2 wind=${grass?'grassBreeze':'windOffset(grove.xz,forestTime)'};
        float heightBend=${grass||flowers||name==='Understory'?'smoothstep(.035,.60,position.y)':'smoothstep(1.35,14.,position.y)'};
        vec2 offset=wind*heightBend*${grass?'1.':flowers?'.51':needles?'.71':'.93'};
        offset+=vec2(.012*sin(grove.z*3.9+forestTime*3.4),.009*cos(grove.x*3.1-forestTime*2.8))*heightBend${grass?'*(1.-.92*rimTurf)':''};
        ${grass||flowers||name==='Understory'?`
          for(int k=0;k<5;k++){
            vec2 away=grove.xz-groveActors[k];float d=length(away);
            float fold=1.-smoothstep(.06,k==0?.64:k==4?.48:.86,d);
            offset+=away/(d+.05)*fold*heightBend*(k==0?.27:k==4?.11:.20);
            transformed.y-=(k==4?.054:.12)*fold*heightBend;
          }`:''}
        vec3 worldDelta=vec3(offset.x,0.,offset.y);
        vec3 bx=grovePose[0].xyz,bz=grovePose[2].xyz;
        transformed.x+=dot(worldDelta,bx)/max(.0001,dot(bx,bx));
        transformed.z+=dot(worldDelta,bz)/max(.0001,dot(bz,bz));
        ${grass?`// Tufts sit on sloping ground. Carry the shared horizontal gust
          // through their tilted local Y basis as well as X and Z.
          vec3 by=grovePose[1].xyz;
          transformed.y+=rimTurf*dot(worldDelta,by)/max(.0001,dot(by,by));`:''}
      `;
      if(grass){
        const [nearStart,nearEnd]=grassBands.detail,[farStart,farEnd]=grassBands.middle;
        transform+=`
          #ifdef USE_INSTANCING
          float grassDistance=distance(groveActors[0],instanceMatrix[3].xz);
          float rank=fract(dot(floor(instanceMatrix[3].xz*32.+.5)/32.,vec2(.59375,.2890625)));
          float at=mix(${nearStart}.,${nearEnd-grassBands.detailFade}.,rank);
          float detailFade=smoothstep(at,at+${grassBands.detailFade}.,grassDistance);
          float lastBlade=mix(${farStart}.,${farEnd}.,rank);
          float middleFade=smoothstep(lastBlade-${grassBands.middleFade}.,lastBlade,grassDistance);
          float stature=${grassStage===0?'1.-detailFade':'detailFade*(1.-middleFade)'};
          transformed.xz*=sqrt(stature);
          transformed.y*=stature;
          #endif
        `;
      }
      if(flowers||name==='Understory'){
        transform+=`
          #ifdef USE_INSTANCING
          float colonyDistance=distance(groveActors[0],instanceMatrix[3].xz);
          float stalk=1.-smoothstep(${(flowers?reach.field.flowers:reach.field.fern).map(v=>v.toFixed(1)).join(',')},colonyDistance);
          transformed*=vec3(sqrt(stalk),stalk,sqrt(stalk));
          #endif
        `;
      }
      // Leaf normals are author-painted tuft and spray normals, stable on either side of a thin lamina.
      shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_begin>','#include <normal_fragment_begin>\nnormal*=faceDirection;');
      shader.fragmentShader=shader.fragmentShader.replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\ntotalEmissiveRadiance+=diffuseColor.rgb*'+(grass?'.19':brookFlowers?'.28':flowers?'.18':'.105')+';');
    }
    if(stage>=0 || groundFade)transform+=`
      vec4 coverageWorld=vec4(transformed,1.);
      #ifdef USE_INSTANCING
        coverageWorld=instanceMatrix*coverageWorld;
      #endif
      vec3 coveragePoint=(modelMatrix*coverageWorld).xyz;
      vCoveragePoint=vec2(dot(coveragePoint,groveRight),dot(coveragePoint,groveUp))*38.;
    `;
    if(needles){
      shader.uniforms.groveEye={value:eye};
      shader.vertexShader='uniform vec3 groveEye;varying float vSprayDistance;\n'+shader.vertexShader;
      shader.fragmentShader='varying float vSprayDistance;\n'+shader.fragmentShader;
      transform+='\nvSprayDistance=distance(groveEye,(grovePose*vec4(transformed,1.)).xyz);';
    }
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',transform);
    if(grass&&!depth){
      // A thin grass leaf transmits light scattered by the leaves around it.
      // Broaden its received contact penumbra; trunks and stones retain their own filter.
      const shadow=THREE.ShaderChunk.shadowmap_pars_fragment.replace(
        'clamp(.92+blockerSum/max(1.,blockerCount)*141.,.92,14.)',
        'clamp(2.8+blockerSum/max(1.,blockerCount)*141.,2.8,14.)');
      shader.fragmentShader=shader.fragmentShader.replace('#include <shadowmap_pars_fragment>',shadow);
      shader.vertexShader=shader.vertexShader.replace('#include <normal_vertex>',`
        #include <normal_vertex>
        #if defined(USE_INSTANCING) && !defined(FLAT_SHADED)
          vNormal=normalize(vNormal+mat3(viewMatrix)*vec3(grassBreeze.x,0.,grassBreeze.y)
            *(1.42*smoothstep(.035,.48,position.y)));
        #endif
      `);
      // Thin grass blades transmit some of the skylight received by adjacent
      // blades. A common up-facing diffuse response keeps the body of a tuft soft.
      shader.fragmentShader=shader.fragmentShader.replace(
        'reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance',
        'reflectedLight.directDiffuse*.73 + reflectedLight.indirectDiffuse*1.15 + totalEmissiveRadiance');
    }
    if(needles)shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`
      vec4 wax=texture2D(map,vMapUv);
      diffuseColor.rgb*=vec3(.56)+wax.rgb*1.69;
      float farSpray=smoothstep(20.,84.,vSprayDistance);
      diffuseColor.a*=mix(wax.a,1.,farSpray*.76);
    `);
    // Match the midpoint of the filtered needle edge in the multisample colour
    // target and the single-sample PCF depth target.
    if(needles)shader.fragmentShader=shader.fragmentShader.replace('#include <alphatest_fragment>',
      'if(diffuseColor.a<.30+.5*fwidth(diffuseColor.a))discard;');
    if(name==='BirchBark')shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`
      #include <map_fragment>
      float foot=(1.-smoothstep(.03,.86+.23*sin(vForestPoint.x*15.),vForestPoint.y));
      diffuseColor.rgb*=mix(vec3(1.05,1.065,1.11),vec3(.41,.46,.35),foot*.80);
    `);
    if(plantBand)screenPlantDetail(shader,{value:eye},plantBand,detailed);
    if(rock)screenRock(shader,0,{value:actors.value[0]});
    if(rock)shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`
      #include <color_fragment>
      vec3 p=vForestPoint;
      float folded=p.y*13.+p.x*2.2+.9*sin(p.z*4.+p.x*1.8)+.17*sin(p.x*12.-p.z*7.);
      float seam=(1.-smoothstep(.025,.080,abs(fract(folded*.29)-.5)))*smoothstep(-.3,.4,sin(p.x*3.4+p.z*2.1));
      float grains=sin(dot(p,vec3(91.,73.,34.)))*sin(dot(p,vec3(43.,82.,69.)));
      float moss=smoothstep(.02,.075,diffuseColor.g-diffuseColor.b);
      diffuseColor.rgb*=1.-seam*.28*(1.-moss)+.064*grains;
    `);
  };
  mat.customProgramCacheKey=()=>'alder-foliage-5-'+name+'-'+stage+'-'+grassStage+'-'+(plantBand?plantBand+'-'+detailed:'')+'-'+depth;
  return mat;
}

export async function createPlants(scene,land,woodland,...arrivalSites) {
  const base=import.meta.env.BASE_URL;
  const [library,rockLibrary,birch,fir,needles,birchNormal,firNormal]=await Promise.all([
    new GLTFLoader().loadAsync(base+'models/woods.glb'),
    new GLTFLoader().loadAsync(base+'models/distant-rocks.glb'),
    textureAt(base+'art/woods/birch-silver.webp',true),
    textureAt(base+'art/woods/spruce-bark.webp',true),
    textureAt(base+'art/woods/needle-weave.webp',true),
    textureAt(base+'art/woods/birch-relief.webp',true,true),
    textureAt(base+'art/woods/spruce-relief.webp',true,true),
  ]);
  const maps={birch,fir,needles,birchNormal,firNormal};
  const time={value:0};
  const actors={value:Array.from({length:5},()=>new THREE.Vector2(1e6,1e6))};
  const camera=scene.getObjectByProperty('isPerspectiveCamera',true);
  const eye=camera?.position??new THREE.Vector3();
  const sun=scene.children.find(o=>o.isDirectionalLight && o.castShadow);
  const lightAxes={right:new THREE.Vector3(1,0,0),up:new THREE.Vector3(0,1,0)};
  const materials = {};
  const depthMaterials={};
  const shadowPools=new Map();
  const sunCasters=new THREE.Group();
  sunCasters.name='Forest sun casters';sunCasters.userData.shadowOnly=true;
  scene.add(sunCasters);
  const rimSeats=new Map(),rimRoots=new Map();
  const sources = new Map();
  const pools = new Map();
  const uncropped = new Map();
  const forest = new THREE.Group();
  forest.name = 'Forest vegetation';
  scene.add(forest);
  const erratics=createErratics(scene,land,rockLibrary.scene,random,inGrid,{value:actors.value[0]});
  for (const group of library.scene.children) {
    if (!group.children.length) continue;
    const name = group.name;
    const plantBand=flowerDetail[name.replace(/Low$/,'')],detailed=!name.endsWith('Low');
    const sizes = ['GrassLow','GrassMeadowLow','GrassRimLow'].includes(name) ? 6600 : (name==='GrassMeadow'||name==='GrassRim')?8200 : name.startsWith('Grass') ? 5000 :
      name.endsWith('Far') ? 1500 : /^(Lupine|Bluebell|Paintbrush|Yarrow)/.test(name) ? 540 : name.endsWith('Low') ? 320 : name.startsWith('Boulder') ? erratics.nearCapacities[Number(name.slice(-1))] : 190;
    const batches = [],casters=[];
    group.traverse(part => {
      if (!part.isMesh) return;
      const key = part.material.name;
      const stage=/^(Fir|Birch)/.test(name)?(name.endsWith('Low')?1:name.endsWith('Far')?2:0):-1;
      const grassStage=key==='Grass'?(name.endsWith('Low')?1:0):-1;
      const materialID=key+'/'+stage+'/'+grassStage+(plantBand?'/'+plantBand+'/'+detailed:'');
      materials[materialID]??=livingMaterial(key,maps,time,actors,eye,lightAxes,stage,grassStage,plantBand,detailed);
      part.material=materials[materialID];
      part.userData.part = part.name.includes('Trunk') ? 'trunk' : 'crown';
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, sizes);
      mesh.name = part.name + ' instances';
      if(plantBand)mesh.userData.plantDetail=plantBand;
      if(grassStage===1)mesh.userData.grassTuft=true;
      if(key==='Flowers'||key==='BrookFlowers')mesh.userData.groundcoverFade=reach.field.flowers;
      if(key==='Understory')mesh.userData.groundcoverFade=reach.field.fern;
      if(key==='Rock')mesh.userData.rockDetail=0;
      if(batches.length){
        mesh.instanceMatrix=batches[0].instanceMatrix;
        mesh.instanceColor=batches[0].instanceColor;
      }else{
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.instanceColor=new THREE.InstancedBufferAttribute(new Float32Array(sizes*3),3);
        mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      }
      // World-centred instance groups move with the player. Culling happens before upload.
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.receiveShadow = true;
      if(sun){
        depthMaterials[materialID]??=livingMaterial(key,maps,time,actors,eye,lightAxes,stage,grassStage,plantBand,detailed,true);
        part.customDepthMaterial=depthMaterials[materialID];
        const caster=new THREE.InstancedMesh(part.geometry,part.material,sizes);
        caster.name=part.name+' sun casters';caster.userData.shadowOnly=true;
        caster.customDepthMaterial=part.customDepthMaterial;
        if(casters.length)caster.instanceMatrix=casters[0].instanceMatrix;
        else caster.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        caster.instanceColor=mesh.instanceColor;
        caster.frustumCulled=false;caster.castShadow=true;caster.count=0;caster.userData.casterCount=0;
        // This draw uses its own light-space subset. Three skips the zero-instance
        // draw in the colour pass, and native scene exports see the originals once.
        caster.onBeforeShadow=(_renderer,_object,_camera,shadowCamera)=>{
          caster.count=shadowCamera===sun.shadow.camera?caster.userData.casterCount:0;
        };
        caster.onAfterShadow=()=>{
          caster.count=0;caster.userData.shadowPrepared=true;
          caster.visible=caster.userData.casterCount>0;
        };
        casters.push(caster);sunCasters.add(caster);
      }
      forest.add(mesh);
      batches.push(mesh);
    });
    if(!batches.length)continue;
    sources.set(name,group);
    pools.set(name,batches);
    if(casters.length){
      const box=new THREE.Box3().setFromObject(group);
      shadowPools.set(name,{draws:casters,center:box.getCenter(new THREE.Vector3()),
        half:box.getSize(new THREE.Vector3()).multiplyScalar(.5),ground:!/^(Fir|Birch|Boulder)/.test(name)});
    }
    uncropped.set(name,{name,count:0,capacity:sizes,matrices:new Float32Array(sizes*16),colors:new Float32Array(sizes*3)});
  }
  const rockSurfaces=new WeakMap();
  const rockFootprints=[0,1,2].map(variant=>{
    const geometry=pools.get('Boulder'+variant)[0].geometry;
    geometry.computeBoundingBox();geometry.computeBoundingSphere();
    const {min,max}=geometry.boundingBox;
    return Math.hypot(Math.max(-min.x,max.x),Math.max(-min.z,max.z));
  });
  function rockSurface(stone){
    if(rockSurfaces.has(stone))return rockSurfaces.get(stone);
    const {x,y,z,s,variant}=stone,name='Boulder'+variant,batch=pools.get(name)[0];
    const collider=new THREE.Mesh(batch.geometry,batch.material);
    collider.name=name+' collision surface';collider.matrixAutoUpdate=false;
    collider.matrix.copy(stone.matrix);collider.matrixWorld.copy(stone.matrix);
    const bounds=batch.geometry.boundingBox.clone().applyMatrix4(stone.matrix);
    const surface={x,y,z,radius:s*.84,height:s*.71,collider,bounds};
    rockSurfaces.set(stone,surface);
    return surface;
  }
  function wildlifeObstacles(x,z){
    const trees=[],rocks=[],radius=8;
    woodland.around(x,z,radius,site=>trees.push(site));
    const search=radius+Math.max(...rockFootprints)*erratics.maximumHorizontalScale;
    erratics.around(x,z,search,stone=>{
      const span=rockFootprints[stone.variant]*Math.max(stone.sx,stone.s);
      if((stone.x-x)**2+(stone.z-z)**2<=(radius+span)**2)rocks.push(rockSurface(stone));
    });
    return {x,z,trees,rocks};
  }
  const trees = [];
  const rocks = [];
  const felled = new Map();
  const records = new Map();
  let lastX=Infinity,lastZ=Infinity;
  let viewX=Infinity,viewZ=Infinity,lastHeading=Infinity,lastPitch=Infinity,lastAspect=0;
  const eyeDirection=new THREE.Vector3();
  const lightDirection=new THREE.Vector3(),previousLight=new THREE.Vector3();
  const casterCenter=new THREE.Vector3();
  let exportsInProgress=0;
  function finishCasters(pool,count){
    for(const caster of pool.draws){
      caster.userData.casterCount=count;
      // A first zero-instance sun pass uploads this mesh and compiles its depth
      // program before the player first encounters this plant on another trail.
      caster.visible=count>0||!caster.userData.shadowPrepared;
    }
    if(count){
      const attr=pool.draws[0].instanceMatrix;
      attr.clearUpdateRanges();attr.addUpdateRange(0,count*16);attr.needsUpdate=true;
    }
  }
  function cropToView(player,force=false) {
    if(!camera){
      if(!force)return;
      erratics.crop(player,0,0,0,true);
      for(const [name,cache] of uncropped){
        const batch=pools.get(name)[0];if(!batch)continue;
        batch.instanceMatrix.array.set(cache.matrices);
        batch.instanceColor.array.set(cache.colors);
        finishBatch(name,cache.count);
        const pool=shadowPools.get(name);
        if(pool){
          pool.draws[0].instanceMatrix.array.set(cache.matrices);
          finishCasters(pool,cache.count);
        }
      }
      return;
    }
    camera.getWorldDirection(eyeDirection);
    if(sun)lightDirection.subVectors(sun.position,sun.target.position).normalize();
    const heading=Math.atan2(eyeDirection.x,eyeDirection.z);
    if(!force && Math.abs(heading-lastHeading)<.075 && Math.abs(eyeDirection.y-lastPitch)<.075 && Math.hypot(player.x-viewX,player.z-viewZ)<1.8 && camera.aspect===lastAspect && (!sun||lightDirection.dot(previousLight)>.99999))return;
    const length=Math.hypot(eyeDirection.x,eyeDirection.z)||1;
    const fx=eyeDirection.x/length,fz=eyeDirection.z/length;
    const halfFov=Math.atan(Math.tan(camera.fov*Math.PI/360)*camera.aspect);
    const cosLimit=Math.cos(Math.min(2.7,halfFov+.26+Math.abs(eyeDirection.y)*.65));
    erratics.crop(player,fx,fz,cosLimit,exportsInProgress>0);
    if(sun){
      lightAxes.right.crossVectors(THREE.Object3D.DEFAULT_UP,lightDirection).normalize();
      lightAxes.up.crossVectors(lightDirection,lightAxes.right);
      previousLight.copy(lightDirection);
    }
    for(const [name,cache] of uncropped) {
      let visible=0,shadowCount=0;
      const pool=shadowPools.get(name);
      const batch=pools.get(name)[0];if(!batch)continue;
      const matrices=batch.instanceMatrix.array,colors=batch.instanceColor.array;
      const trees=/^(Fir|Birch)/.test(name),grass=name.startsWith('Grass'),rock=name.startsWith('Boulder'),coverFade=batch.userData.groundcoverFade;
      const stage=name.endsWith('Low')?1:name.endsWith('Far')?2:0;
      const plantBand=batch.userData.plantDetail;
      const margin=trees?8:2.1;
      const preserveShadow=trees?16:4;
      for(let n=0;n<cache.count;n++) {
        const offset=n*16;
        const dx=cache.matrices[offset+12]-player.x,dz=cache.matrices[offset+14]-player.z;
        const dist=Math.hypot(dx,dz);
        if(rock && dist>rockNearBand[1]+2.2)continue;
        if(trees){
          const size=lodScale(cache.matrices[offset+5]);
          if(exportsInProgress){
            const exportStage=dist<midpoint(nearFade)*size?0:dist<midpoint(farFade)*size?1:2;
            if(stage!==exportStage)continue;
          }
          if(dist<forestBands[stage][0]*size-2.1 || dist>forestBands[stage][1]*(stage===2?1:size)+2.1)continue;
        }
        if(plantBand){
          if(exportsInProgress && (stage===0)!==(dist<(plantBand[0]+plantBand[1])*.5))continue;
          if(stage===0?dist>plantBand[1]+2.1:dist<plantBand[0]-2.1)continue;
        }
        if(coverFade && dist>coverFade[1]+2.1)continue;
        if(grass){
          const a=cache.matrices,rank=grassRank(a[offset+12],a[offset+14]);
          const start=grassBands.detail[0]+(grassBands.detail[1]-grassBands.detailFade-grassBands.detail[0])*rank;
          if(exportsInProgress && (stage===0)!==(dist<start+grassBands.detailFade*.5))continue;
          if(stage===0 && dist>start+grassBands.detailFade+2.1)continue;
          if(stage===1){
            if(dist<start-2.1)continue;
            const end=grassBands.middle[0]+(grassBands.middle[1]-grassBands.middle[0])*rank;
            if(dist>end+2.1)continue;
          }
        }
        if(pool && !exportsInProgress){
          let casts=dist<=groundShadowFade[1]+2.1;
          if(!pool.ground){
            // Check the whole tree or rock against the sun's orthographic footprint.
            // The target may look 9 m ahead; the 2.1 m crop hysteresis covers motion.
            const a=cache.matrices,c=pool.center;
            casterCenter.set(
              dx+a[offset]*c.x+a[offset+4]*c.y+a[offset+8]*c.z,
              a[offset+13]-eye.y+a[offset+1]*c.x+a[offset+5]*c.y+a[offset+9]*c.z,
              dz+a[offset+2]*c.x+a[offset+6]*c.y+a[offset+10]*c.z);
            const lightCamera=sun.shadow.camera;
            casts=fitsSunAxis(lightAxes.right,lightCamera.right+11.2,casterCenter,pool.half,a,offset) &&
              fitsSunAxis(lightAxes.up,lightCamera.top+11.2,casterCenter,pool.half,a,offset);
          }
          if(casts){
            const a=pool.draws[0].instanceMatrix.array,start=shadowCount++*16;
            for(let j=0;j<16;j++)a[start+j]=cache.matrices[offset+j];
          }
        }
        const sideMargin=rock?Math.max(margin,1.5*Math.hypot(cache.matrices[offset],cache.matrices[offset+2])):margin;
        if(!exportsInProgress && dist>preserveShadow && dx*fx+dz*fz+sideMargin<dist*cosLimit)continue;
        const target=visible*16;
        for(let j=0;j<16;j++)matrices[target+j]=cache.matrices[offset+j];
        for(let j=0;j<3;j++)colors[visible*3+j]=cache.colors[n*3+j];
        visible++;
      }
      finishBatch(name,visible);
      if(pool)finishCasters(pool,shadowCount);
    }
    viewX=player.x;viewZ=player.z;lastHeading=heading;lastPitch=eyeDirection.y;lastAspect=camera.aspect;
  }
  // Trunk and canopy primitives share the same instance transforms and pigments.
  function finishBatch(name,count){
    const group=pools.get(name);
    for(const mesh of group)mesh.count=count;
    if(!count)return;
    for(const attribute of [group[0].instanceMatrix,group[0].instanceColor]){
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(0,count*attribute.itemSize);
      attribute.needsUpdate=true;
    }
  }
  function reservePopulation(cache,required){
    if(required<=cache.capacity)return;
    const capacity=Math.max(required,Math.ceil(cache.capacity*1.5));
    const matrices=new Float32Array(capacity*16),colors=new Float32Array(capacity*3);
    matrices.set(cache.matrices);colors.set(cache.colors);
    cache.capacity=capacity;cache.matrices=matrices;cache.colors=colors;
    reservePlantDraws(pools.get(cache.name),capacity,shadowPools.get(cache.name)?.draws);
  }
  function emit(name,x,y,z,angle,sx,sy,sz,color,tiltX=0,tiltZ=0) {
    const cache=uncropped.get(name);
    if(!cache)return -1;
    reservePopulation(cache,cache.count+1);
    const n=cache.count++;
    toolMatrix.position.set(x,y,z);
    toolMatrix.rotation.set(tiltX,angle,tiltZ,tiltX||tiltZ?'YXZ':'XYZ');
    toolMatrix.scale.set(sx,sy,sz);
    toolMatrix.updateMatrix();
    toolMatrix.matrix.toArray(cache.matrices,n*16);
    color.toArray(cache.colors,n*3);
    return n;
  }
  const flowerSites=createFlowerSites(land),{openGround,fordGap}=flowerSites;
  const preparedSites=arrivalSites.filter(Boolean),arrivalCovers=new Map();
  function fillInstances(px,pz,remember=false) {
    const previous = new Map(records);
    const shade=shadowField(px,pz);
    function groundTint(x,z,flower=false) {
      const ripple=.5+.27*Math.sin(x*.43-z*.19+1.6*Math.sin(z*.21))+.22*Math.cos(z*.32-x*.23);
      const opening=.55+.44*THREE.MathUtils.smoothstep(ripple,.43,.83);
      const meadow=THREE.MathUtils.smoothstep(-z,64,87)*.38;
      let light=THREE.MathUtils.clamp(opening-shade.at(x,z)*.63+meadow,0,1);
      const rim=THREE.MathUtils.smoothstep(-z,69,83)*(1-THREE.MathUtils.smoothstep(-z,109,130));
      if(rim>.001){
        if(flower)return tint.setRGB(.71,.80,.91);
        return tint.setRGB(.48+.21*light,.55+.22*light,.62+.23*light);
      }
      if(flower)light=.46+.54*light;
      tint.setRGB(.25+.91*light,.33+.76*light,.38+.57*light);
      if(!flower && z> -24 && z<3){
        const distance=land.trailX(z)-x;
        const pool=Math.exp(-((distance-2.85)**2)/3.75-((z+6.4)**2)/43);
        tint.r+=pool*.40;tint.g+=pool*.23;tint.b*=1-pool*.15;
      }
      return tint;
    }
    // Seed-bearing grasses occupy the dry, narrow shoulder above the valley.
    function rimGrass(x,z,low,jitter){
      if(jitter>=rimGrassWeight(x,z))return 'GrassMeadow'+(low?'Low':'');
      const hollow=z+106.3+1.2*Math.sin(x*.42);
      const bank=Math.exp(-((x-1.3)**2)/25-hollow*hollow/7.4);
      return 'GrassRim'+(bank>.13+.47*jitter?'Straw':'')+(low?'Low':'');
    }
    // Align each tuft to the actual triangle slope and shorten its footprint
    // where a shoulder or a gully would otherwise leave its far roots in air.
    // The seeded grid revisits these same sites on each streaming update.
    function emitGrass(name,i,j,x,z,yaw,span,height,crest,bury){
      let floor=land.height(x,z),pitch=0,roll=0;
      if(x>9.5&&x<16.8&&z> -38&&z< -31){
        // Close to the walked edge, bent and cropped leaves leave the tread
        // visible even where a tuft's outer blades reach beyond its roots.
        const edge=Math.abs(z-land.fordTrailZ(x))/land.fordMargin(x);
        const verge=THREE.MathUtils.smoothstep(edge,.70,2.47);
        height*=.09+.91*verge;
        span*=.22+.78*verge;
      }
      if(crest){
        const key=((i+512)*2048+j+512)*2+Number(name.endsWith('Low'));
        let seat=rimSeats.get(key);
        if(!seat){
          const reach=.45,dx=(land.height(x+reach,z)-land.height(x-reach,z))/(2*reach);
          const dz=(land.height(x,z+reach)-land.height(x,z-reach))/(2*reach);
          const c=Math.cos(yaw),s=Math.sin(yaw),alongZ=dx*s+dz*c;
          pitch=-Math.atan(alongZ);roll=Math.atan2(dx*c-dz*s,Math.hypot(1,alongZ));
          function separation(radius){
            let gap=0;
            for(let k=0;k<8;k++){
              const a=k*Math.PI/4,ox=Math.cos(a)*radius,oz=Math.sin(a)*radius;
              gap=Math.max(gap,floor+dx*ox+dz*oz-land.height(x+ox,z+oz));
            }
            return gap;
          }
          const sheath=name.startsWith('GrassRim')?(name.endsWith('Low')?.25:.13)*height*Math.hypot(1,dx,dz):0;
          if(Math.max(separation(span*.75),separation(span*.39))>sheath*.75){
            let roots=rimRoots.get(name);
            if(!roots){
              const pos=pools.get(name)[0].geometry.attributes.position;roots=[];
              for(let i=0;i<pos.count;i++)if(pos.getY(i)<.001)roots.push(new THREE.Vector3().fromBufferAttribute(pos,i));
              rimRoots.set(name,roots);
            }
            function exposedRoot(width){
              toolMatrix.position.set(x,floor-bury,z);toolMatrix.rotation.set(pitch,yaw,roll,'YXZ');
              toolMatrix.scale.set(width,height,width);toolMatrix.updateMatrix();
              const m=toolMatrix.matrix.elements;let gap=0;
              for(const p of roots){
                const px=m[0]*p.x+m[4]*p.y+m[8]*p.z+x,pz=m[2]*p.x+m[6]*p.y+m[10]*p.z+z;
                gap=Math.max(gap,m[1]*p.x+m[5]*p.y+m[9]*p.z+floor-bury-land.height(px,pz));
              }
              return gap;
            }
            let gap=exposedRoot(span);
            if(gap>.11){span*=Math.max(.22,Math.sqrt(.11/gap));gap=exposedRoot(span);}
            floor-=gap;
          }
          seat={floor,pitch,roll,span};rimSeats.set(key,seat);
        }else({floor,pitch,roll,span}=seat);
      }
      emit(name,x,floor-bury,z,yaw,span,height,span,grassTint(x,z,crest),pitch,roll);
    }
    function grassTint(x,z,crest){
      if(crest){
        // Short grass on the brow runs sage-green in the cool valley light.
        const swale=.5+.5*Math.sin(x*.33+z*.41+.65*Math.sin(z*.26));
        const bank=Math.exp(-((z+89)**2)/40),brow=Math.exp(-((x+3.35)**2)/6.8);
        const east=THREE.MathUtils.smoothstep(x,-2.3,.45);
        tint.setRGB((.62+.059*swale)*(1+bank*(.22*brow-.23-.17*east)),
          (.68+.056*swale)*(1+bank*(.25*brow-.34-.15*east)),
          (.745+.042*swale)*(1+bank*(.23*brow-.37-.20*east)));
        const verge=Math.abs(x-land.trailX(z));
        const dry=Math.exp(-((z+77.2)**2)/44-((verge-3.3)**2)/9)*(.74+.26*swale);
        tint.r+=1.34*dry;tint.g+=.56*dry;tint.b*=1-.31*dry;
        const rim=rimGrassWeight(x,z);
        tint.r*=1-rim*(.074+.106*east);
        tint.g*=1-rim*(.067+.052*east);
        tint.b*=1-rim*(.077+.085*east);
        return tint;
      }
      // The meadow's near verge is in shade, with two lit shelves stepping
      // back towards the animals. The dry tips stay warm in those openings.
      const c=groundTint(x,z);
      if(x<1||x>25||z< -51||z> -22)return c;
      const shadeVerge=Math.exp(-((x-12.5)**2)/32-((z+34.3)**2)/2.9);
      const shadeSpur=Math.exp(-((x-15.7)**2)/6.5-((z+35.8)**2)/3.2);
      const shadow=Math.max(shadeVerge,shadeSpur);
      const sun=Math.exp(-((x-11.7)**2)/18-((z+38.6)**2)/1.6)
        +.71*Math.exp(-((x-16.8)**2)/3.8-((z+36.1)**2)/1.9);
      c.r=c.r*(1-.83*shadow+.79*sun)+.20*sun;
      c.g=c.g*(1-.75*shadow+.62*sun)+.16*sun;
      c.b=c.b*(1-.57*shadow+.45*sun)+.10*sun;
      return c;
    }
    function tuftHeading(x,z,jitter){
      const normal=.88+1.10*Math.sin(.24*x+.15*z)+.64*Math.cos(.29*z-.10*x)+1.20*(jitter-.5);
      const rim=rimGrassWeight(x,z);
      if(!rim)return normal;
      const shelter=1-THREE.MathUtils.smoothstep(x,-2.7,.5);
      const swale=1.55+1.21*shelter+.57*Math.sin(.47*x+.33*(z+88)+.75*Math.sin(.23*z))
        +.31*Math.sin(.70*x-.32*(z+88))+(.24+.50*(1-shelter))*(jitter-.5);
      // Tiller headings turn across short swales on the eastern lip.
      const east=THREE.MathUtils.smoothstep(x,-2.05,-.50)*(1-THREE.MathUtils.smoothstep(x,4,8))
        *THREE.MathUtils.smoothstep(z,-99,-95)*(1-THREE.MathUtils.smoothstep(z,-85,-82));
      const bend=east>0?.94*Math.sin(1.57*x+.94*(z+88)+.48*Math.sin(1.15*(z+88)))
        +.46*Math.cos(2.02*(z+88)-.47*x)-.15:0;
      return normal+rim*(swale+east*bend-normal);
    }
    function tuftHeight(x,z){
      const wave=.48*Math.sin(.39*x+.32*z+.68*Math.sin(z*.18))+.29*Math.cos(.23*x-.66*z);
      return 1+.21*wave;
    }
    records.clear();
    trees.length = 0;
    rocks.length = 0;
    for(const cache of uncropped.values())cache.count=0;
    function addTree(site,dsq) {
      const {id,x,z,y,model,scale,angle}=site;
      if (felled.has(id)) return;
      const distance=Math.sqrt(dsq),size=lodScale(scale);
      if(dsq<84**2)shade.add(x,z,TREE_HEIGHT[model]*scale,model.startsWith('Fir')?'fir':'birch');
      const light = Math.max(.63,1-Math.max(0,Math.sqrt(dsq)-166)/110);
      tint.setRGB(light,light,light);
      let available=false;
      for(let stage=0;stage<3;stage++){
        const [from,to]=forestBands[stage];
        if(distance<from*size-8.3 || distance>to*(stage===2?1:size)+8.3)continue;
        const name=model+['','Low','Far'][stage];
        if(emit(name,x,y,z,angle,scale,scale,scale,tint)>=0)available=true;
      }
      if (dsq < 90*90 && available) {
        const rec=previous.get(id) ?? {id,x,z,y,model,scale,angle,height:TREE_HEIGHT[model]*scale,
          radius:site.radius,type:model.startsWith('Fir')?'fir':'birch',removed:false};
        records.set(id,rec); trees.push(rec);
      }
    }
    woodland.around(px,pz,200,addTree);
    function grassOnWetShingle(x,z,variation) {
      if(z< -46 || z> -29)return false;
      const inland=land.streamX(z)-land.streamWidth(z)-x;
      if(inland<-.45 || inland>.38)return false;
      const smooth=THREE.MathUtils.smoothstep;
      const shelf=smooth(inland,-.45,-.25)*(1-smooth(inland,.17,.38));
      return variation<.94*shelf*smooth(z,-46,-45.1)*(1-smooth(z,-29.9,-29));
    }
    erratics.update(px,pz,(stone,color)=>{
      const {x,y,z,s:scale,sx,sy,angle,variant}=stone;
      const pool='Boulder'+variant;
      if(emit(pool,x,y,z,angle,sx,sy,scale,color)<0 || (x-px)**2+(z-pz)**2>=30**2)return;
      rocks.push(rockSurface(stone));
    });
    // Trees and boulders above always rebuild their live records and colliders.
    const site=preparedSites.find(p=>p.x===px&&p.z===pz);
    const arrivalCover=arrivalCovers.get(site);
    if(arrivalCover){
      for(const {batch,matrices,colors} of arrivalCover){
        reservePopulation(batch,batch.count+colors.length/3);
        batch.matrices.set(matrices,batch.count*16);
        batch.colors.set(colors,batch.count*3);
        batch.count+=colors.length/3;
      }
      return;
    }
    const coverStarts=remember ? Array.from(uncropped.values(),batch=>({batch,start:batch.count})) : null;
    // Individual leafy clumps in the near field and coarser blades beyond.
    inGrid(px,pz,grassBands.detail[1]+grassBands.reserve,.69,(i,j,x,z,dsq) => {
      const rank=grassRank(Math.fround(x),Math.fround(z));
      const start=grassBands.detail[0]+(grassBands.detail[1]-grassBands.detailFade-grassBands.detail[0])*rank;
      if(dsq>(start+grassBands.detailFade+grassBands.reserve)**2)return;
      const edge=Math.abs(x-land.trailX(z));
      if(random(i,j,208)<.93*land.talusCover(x,z))return;
      if (edge<(1.22+random(i,j,39)*.45)*trailMargin(z,x-land.trailX(z)) || !openGround(x,z)) return;
      const v=random(i,j,421);
      if(fordGap(x,z)>random(i,j,885)||grassOnWetShingle(x,z,random(i,j,887)))return;
      const field=Math.hypot((x-11.6)*.47,(z+39.4)*.83);
      const grazed=.47+.085*(1+Math.sin(x*1.7+Math.cos(z*.85)));
      const opening=grazed+(1-grazed)*THREE.MathUtils.smoothstep(field,1.7,5.3);
      const bankDist=Math.abs(x-land.streamX(z))-land.streamWidth(z);
      const bankScale=.59+.41*THREE.MathUtils.smoothstep(bankDist,.2,2.1);
      const crest=crestMeadow(x,z);
      const rimScale=crest?.91:1-.22*THREE.MathUtils.smoothstep(-z,70,84);
      const s=tuftHeight(x,z)*rimScale*opening*bankScale*(.83+v*.52)*Math.max(1-trailMargin(z,x-land.trailX(z)),Math.min(1,.52+(edge-1.3)*.58));
      const spread=s*(crest?1.48:1.21);
      emitGrass(crest?rimGrass(x,z,false,random(i,j,403)):'Grass'+Math.floor(random(i,j,403)*3),i,j,x,z,tuftHeading(x,z,random(i,j,35)),spread,s,crest,.025);
    },1090);
    inGrid(px,pz,grassBands.middle[1]+grassBands.reserve,1.46,(i,j,x,z,dsq) => {
      if (fordGap(x,z)>random(i,j,188)||grassOnWetShingle(x,z,random(i,j,889))||dsq<(grassBands.detail[0]-grassBands.reserve)**2 || Math.abs(x-land.trailX(z))<1.5*trailMargin(z,x-land.trailX(z)) || !openGround(x,z)) return;
      if(random(i,j,208)<.93*land.talusCover(x,z))return;
      const angle=tuftHeading(x,z,random(i,j,64));
      const end=grassBands.middle[0]+(grassBands.middle[1]-grassBands.middle[0])*grassRank(Math.fround(x),Math.fround(z));
      if(dsq>(end+grassBands.reserve)**2)return;
      const crest=crestMeadow(x,z);
      const s=tuftHeight(x,z)*(1+random(i,j,27)*.57)*(crest?.89:1-.27*THREE.MathUtils.smoothstep(-z,67,83));
      emitGrass(crest?rimGrass(x,z,true,random(i,j,403)):'GrassLow',i,j,x,z,angle,s*2.7,s,crest,.03);
    },1090);
    // populate may move 5.8 m on each axis before rebuilding. Load both
    // meshes across that diagonal reserve; the smaller view crop gates draws.
    function emitFlower(type,x,y,z,angle,scale,color,tiltX=0,tiltZ=0){
      const [start,end]=flowerDetail[type],d=Math.hypot(x-px,z-pz);
      if(d<=end+8.3)emit(type,x,y,z,angle,scale,scale,scale,color,tiltX,tiltZ);
      if(d>=start-8.3)emit(type+'Low',x,y,z,angle,scale,scale,scale,color,tiltX,tiltZ);
    }
    flowerSites.visit(px,pz,reach.field.flowers[1]+grassBands.reserve+2,emitFlower,groundTint);
    // A newly felled tree opens the light without instantly uprooting its ferns.
    let formerShade;
    for(const tree of felled.values()){
      if((tree.x-px)**2+(tree.z-pz)**2>=84**2)continue;
      formerShade??=shadowField(px,pz);
      formerShade.add(tree.x,tree.z,tree.height,tree.type);
    }
    const fernShade=formerShade?{at:(x,z)=>shade.at(x,z)+formerShade.at(x,z)}:shade;
    visitFerns(land,openGround,fernShade,px,pz,reach.field.fern[1]+grassBands.reserve+1,(x,z,heading,scale)=>{
      emitFlower('Fern',x,land.height(x,z)-.025,z,heading,scale,groundTint(x,z,true));
    });
    if(remember){
      arrivalCovers.set(site,coverStarts.filter(({batch,start})=>batch.count>start).map(({batch,start})=>({
        batch,
        matrices:batch.matrices.slice(start*16,batch.count*16),
        colors:batch.colors.slice(start*3,batch.count*3)
      })));
    }
  }
  function populate(px,pz) {
    fillInstances(px,pz);
    lastX=px;lastZ=pz;
    cropToView({x:px,z:pz},true);
  }
  function removeTree(tree) {
    if(!tree || tree.removed || felled.has(tree.id)) return null;
    felled.set(tree.id,{x:tree.x,z:tree.z,height:tree.height,type:tree.type});tree.removed=true;woodland.remove(tree.id);
    // Grass and flower pigment incorporates the shade from standing trees.
    arrivalCovers.clear();
    // Repack visible instances immediately so a cut cannot hide an unrelated tree.
    populate(lastX,lastZ);
    const detached = sources.get(tree.model).clone(true);
    detached.name='Cut '+tree.type;
    detached.position.set(tree.x,tree.y,tree.z);
    const shape=new THREE.Matrix4().makeRotationY(tree.angle);
    shape.scale(new THREE.Vector3().setScalar(tree.scale));
    detached.traverse(part=>{
      if (!part.isMesh) return;
      part.geometry=part.geometry.clone().applyMatrix4(shape);
      part.customDepthMaterial=depthMaterials[part.material.name+'/0'];
      part.castShadow=true;part.receiveShadow=true;
    });
    scene.add(detached);
    return detached;
  }
  async function withUncroppedInstances(exportScene) {
    const position={x:viewX,z:viewZ};
    exportsInProgress++;
    cropToView(position,true);
    try{return await woodland.withFullCanopy(exportScene);}
    finally{exportsInProgress--;cropToView(position,true);}
  }
  function setDisturbance(player,animals=[]) {
    actors.value[0].set(player.x,player.z);
    const near=animals.filter(a=>a.kind!==1&&!a.dead).map(a=>a.root?.position??a.position??a).filter(p=>p&&Number.isFinite(p.x))
      .sort((a,b)=>(a.x-player.x)**2+(a.z-player.z)**2-(b.x-player.x)**2-(b.z-player.z)**2);
    for(let k=1;k<4;k++){const p=near[k-1];actors.value[k].set(p?.x??1e6,p?.z??1e6);}
  }
  function update(dt,elapsed,player) {
    time.value=elapsed;actors.value[0].set(player.x,player.z);
    const wake=actors.value[4],body=actors.value[0];
    if(wake.distanceToSquared(body)>16)wake.copy(body);
    else wake.lerp(body,1-Math.exp(-3.6*dt));
    if (Math.abs(player.x-lastX)>5.8 || Math.abs(player.z-lastZ)>5.8) populate(player.x,player.z);
    else cropToView(player);
  }
  for(const site of preparedSites)fillInstances(site.x,site.z,true);
  populate(land.trailX(0),0);
  return {trees,rocks,update,removeTree,setDisturbance,withUncroppedInstances,wildlifeObstacles};
}

