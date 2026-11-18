import * as THREE from 'three';
import {alpineAirGLSL} from './alpine-atmosphere.js';

// An ordered block of fine cells is also one contiguous block in each coarser
// grid. Keep the four species' canonical matrices and tint values only once.
const cellWidth=40;
const drift=5;
const turn=.048;
function interleave(bits){
  bits=(bits|(bits<<8))&0x00ff00ff;
  bits=(bits|(bits<<4))&0x0f0f0f0f;
  bits=(bits|(bits<<2))&0x33333333;
  return (bits|(bits<<1))&0x55555555;
}
function cellKey(site){
  const x=Math.floor(site.x/cellWidth)+32768,z=Math.floor(site.z/cellWidth)+32768;
  return (interleave(x)|(interleave(z)<<1))>>>0;
}

function packSpecies(sites,geometry){
  const ordered=sites.map(site=>({site,key:cellKey(site)})).sort((a,b)=>a.key-b.key);
  const matrix=new Float32Array(sites.length*16),tints=new Float32Array(sites.length*3);
  const transform=new THREE.Object3D(),cells=[[],[],[],[]],lastKeys=[-1,-1,-1,-1];
  let radius=0,low=0,high=0;
  for(const g of geometry){
    g.computeBoundingBox();const box=g.boundingBox;
    radius=Math.max(radius,Math.hypot(Math.max(-box.min.x,box.max.x),Math.max(-box.min.z,box.max.z)));
    low=Math.min(low,box.min.y);high=Math.max(high,box.max.y);
  }
  for(let i=0;i<ordered.length;i++){
    const {site,key}=ordered[i];site.canopyIndex=i;
    // Use the same Euler/quaternion composition and Float32 storage as the
    // detailed walking trees and the original canopy authoring path.
    transform.position.set(site.x,site.y,site.z);transform.rotation.y=site.angle;
    transform.scale.setScalar(site.scale);transform.updateMatrix();
    transform.matrix.toArray(matrix,16*i);tints.fill(site.color,i*3,i*3+3);
    for(let level=0;level<4;level++){
      const parent=key>>>(2*level),grid=cells[level];
      if(parent!==lastKeys[level]){
        lastKeys[level]=parent;
        grid.push({first:i,end:i,x0:Infinity,x1:-Infinity,z0:Infinity,z1:-Infinity,
          y0:Infinity,y1:-Infinity,pad:0});
      }
      const cell=grid[grid.length-1];
      cell.end=i+1;cell.x0=Math.min(cell.x0,site.x);cell.x1=Math.max(cell.x1,site.x);
      cell.z0=Math.min(cell.z0,site.z);cell.z1=Math.max(cell.z1,site.z);
      cell.y0=Math.min(cell.y0,site.y+site.scale*low);cell.y1=Math.max(cell.y1,site.y+site.scale*high);
      cell.pad=Math.max(cell.pad,site.scale*radius);
    }
  }
  for(const grid of cells)for(const cell of grid){
    cell.x=(cell.x0+cell.x1)*.5;cell.z=(cell.z0+cell.z1)*.5;
    cell.y=(cell.y0+cell.y1)*.5;
    const hx=(cell.x1-cell.x0)*.5,hz=(cell.z1-cell.z0)*.5,hy=(cell.y1-cell.y0)*.5;
    cell.rootRadius=Math.hypot(hx,hz);cell.radius=Math.hypot(hx+cell.pad,hz+cell.pad,hy);
  }
  return {matrix,tints,sites:ordered.map(r=>r.site),cells,halfHeight:(high+low)/2,
    radius:Math.hypot(radius,(high-low)/2)};
}

function attributes(mesh,capacity){
  mesh.instanceMatrix=new THREE.InstancedBufferAttribute(new Float32Array(capacity*16),16).setUsage(THREE.DynamicDrawUsage);
  mesh.instanceColor=new THREE.InstancedBufferAttribute(new Float32Array(capacity*3),3).setUsage(THREE.DynamicDrawUsage);
}
function upload(attribute,n){
  attribute.clearUpdateRanges();attribute.addUpdateRange(0,n*attribute.itemSize);attribute.needsUpdate=true;
}


export function addForestLOD(scene,woodland,library){
  const observer={value:new THREE.Vector2()},daylight={value:1};
  const tiers=[
    {entry:[166,190],exit:[278,352],bake:[0,315]},
    {entry:[278,352],exit:[581,757],bake:[315,669]},
    {entry:[581,757],exit:[1195,1485],bake:[669,1340]},
    {entry:[1195,1485],exit:[8500,9000],bake:[1340,10000]}
  ];
  for(const tier of tiers){
    const mat=new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide,fog:false});
    tier.material=mat;
    mat.onBeforeCompile=shader=>{
      shader.uniforms.observer=observer;
      shader.uniforms.daylight=daylight;
      shader.uniforms.transition={value:new THREE.Vector4(...tier.entry,...tier.exit)};
      shader.vertexShader='uniform vec2 observer; uniform vec4 transition; varying float airDistance,treeHeight,canopyLight; varying vec2 coverage;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`
        float range=length(instanceMatrix[3].xz-observer);
        airDistance=range;
        treeHeight=instanceMatrix[3].y;
        vec3 crownNormal=normalize(mat3(instanceMatrix)*normal);
        canopyLight=.78+.42*max(0.,dot(crownNormal,normalize(vec3(-81.,45.,12.))));
        coverage=vec2(smoothstep(transition.x,transition.y,range),smoothstep(transition.z,transition.w,range));
        vec3 transformed=position*(step(0.000001,coverage.x)*(1.-step(.999999,coverage.y)));
      `);
      shader.fragmentShader='uniform float daylight; varying float airDistance,treeHeight,canopyLight; varying vec2 coverage;\n'+alpineAirGLSL+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
        float threshold=fract(52.9829189*fract(dot(floor(gl_FragCoord.xy),vec2(.06711056,.00583715))));
        if(threshold>=coverage.x || threshold<coverage.y)discard;
        diffuseColor.rgb=valleyRadiance(diffuseColor.rgb*vec3(.78,.88,1.07)*canopyLight*daylight,airDistance,treeHeight,clamp((1.-daylight)/.56,0.,1.));
      `);
    };
  }
  const camera=scene.getObjectByProperty('isPerspectiveCamera',true);
  const populations=new Map(),species=[],byModel=new Map();
  for(const tile of woodland.tiles.values())for(const [model,sites] of tile.stands){
    if(!populations.has(model))populations.set(model,[]);
    for(const site of sites)populations.get(model).push(site);
  }
  for(const [model,sites] of populations){
    const geometry=tiers.map((_,level)=>library.getObjectByName(model+'Canopy'+level).geometry);
    const packed=packSpecies(sites,geometry);
    packed.meshes=tiers.map((tier,level)=>{
      const mesh=new THREE.InstancedMesh(geometry[level],tier.material,0);
      mesh.name=model+' watershed canopy '+level;mesh.userData.bakeRange=tier.bake;
      mesh.userData.canopyLevel=level;mesh.frustumCulled=false;mesh.visible=false;
      attributes(mesh,Math.min(sites.length,[650,2000,4800,9200][level]));
      scene.add(mesh);return mesh;
    });
    packed.cutCount=0;species.push(packed);byModel.set(model,packed);
  }
  const frustum=new THREE.Frustum(),projection=new THREE.Matrix4(),lastProjection=new THREE.Matrix4();
  const lastEye=new THREE.Vector3(Infinity,Infinity,Infinity),lastRotation=new THREE.Quaternion();
  const selected=[],edgePlanes=[];let exportDepth=0,dirty=true;
  function append(start,end){
    const n=selected.length;
    if(n&&selected[n-1]===start)selected[n-1]=end;
    else selected.push(start,end);
  }
  function stream(source,tier,level,p){
    const mesh=source.meshes[level],inner=Math.max(0,tier.entry[0]-drift-.01),outer=tier.exit[1]+drift+.01;
    const inner2=inner*inner,outer2=outer*outer;
    selected.length=0;
    for(const cell of source.cells[level]){
      const dx=cell.x-p.x,dz=cell.z-p.z,r=cell.rootRadius,d=Math.sqrt(dx*dx+dz*dz);
      if(d+r<inner || d-r>outer)continue;
      const range=Math.hypot(dx,cell.y-p.y,dz);
      const sphereRadius=cell.radius+drift+.06*(range+cell.radius);
      let outside=false;edgePlanes.length=0;
      if(camera)for(const plane of frustum.planes){
        const delta=plane.normal.x*cell.x+plane.normal.y*cell.y+plane.normal.z*cell.z+plane.constant;
        if(delta < -sphereRadius){outside=true;break;}
        if(delta<cell.radius)edgePlanes.push(plane);
      }
      if(outside)continue;
      const entireBand=d-r>=inner&&d+r<=outer;
      if(entireBand&&!cell.hasCuts&&!edgePlanes.length){append(cell.first,cell.end);continue;}
      let first=-1;
      for(let i=cell.first;i<cell.end;i++){
        const site=source.sites[i],dd=(site.x-p.x)**2+(site.z-p.z)**2;
        let include=!site.removed&&(entireBand||(dd>=inner2&&dd<=outer2));
        if(include&&edgePlanes.length){
          const cy=site.y+source.halfHeight*site.scale;
          const safe=source.radius*site.scale+sphereRadius-cell.radius;
          for(const plane of edgePlanes){
            if(plane.normal.x*site.x+plane.normal.y*cy+plane.normal.z*site.z+plane.constant < -safe){
              include=false;break;
            }
          }
        }
        if(include){if(first<0)first=i;}
        else if(first>=0){append(first,i);first=-1;}
      }
      if(first>=0)append(first,cell.end);
    }
    let count=0;
    for(let j=0;j<selected.length;j+=2)count+=selected[j+1]-selected[j];
    if(count>mesh.instanceMatrix.count){
      // The exploratory player can climb into a much denser stand than the
      // starting valley. Dispose previous instance buffers before growing.
      mesh.dispose();attributes(mesh,Math.max(count,Math.ceil(mesh.instanceMatrix.count*1.5)));
    }
    mesh.count=count;mesh.visible=count>0;
    if(!count)return;
    let at=0;
    for(let j=0;j<selected.length;j+=2){
      const a=selected[j],b=selected[j+1];
      mesh.instanceMatrix.array.set(source.matrix.subarray(a*16,b*16),16*at);
      mesh.instanceColor.array.set(source.tints.subarray(a*3,b*3),3*at);at+=b-a;
    }
    upload(mesh.instanceMatrix,count);upload(mesh.instanceColor,count);
  }
  function update(p){
    if(exportDepth)return;
    observer.value.set(p.x,p.z);
    if(!dirty&&lastEye.distanceToSquared(p)<drift*drift){
      if(!camera)return;
      const current=camera.projectionMatrix.elements,previous=lastProjection.elements;
      const horizontal=Math.abs(Math.atan(1/current[0])-Math.atan(1/previous[0]));
      const vertical=Math.abs(Math.atan(1/current[5])-Math.atan(1/previous[5]));
      const angularBudget=turn-horizontal-vertical;
      if(angularBudget>0&&Math.abs(lastRotation.dot(camera.quaternion))>Math.cos(angularBudget*.5)
        &&current[8]===previous[8]&&current[9]===previous[9]&&current[10]===previous[10]&&current[14]===previous[14])return;
    }
    dirty=false;lastEye.set(p.x,p.y,p.z);
    if(camera){
      camera.updateMatrixWorld();projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(projection);lastRotation.copy(camera.quaternion);lastProjection.copy(camera.projectionMatrix);
    }
    for(const source of species)for(let level=0;level<tiers.length;level++)stream(source,tiers[level],level,p);
  }
  woodland.onCanopyRemoval=site=>{
    const source=byModel.get(site.model);
    source.cutCount++;source.full=null;
    for(const grid of source.cells){
      const cell=grid.find(c=>c.first<=site.canopyIndex&&c.end>site.canopyIndex);
      cell.hasCuts=true;
    }
    dirty=true;
    if(Number.isFinite(lastEye.x))update(camera?.position??lastEye);
  };
  woodland.withFullCanopy=async visit=>{
    if(exportDepth)return visit();
    exportDepth++;
    const saved=[];
    try{
      for(const source of species){
        if(!source.full){
          let matrices=source.matrix,colors=source.tints;
          if(source.cutCount){
            const n=source.sites.length-source.cutCount;
            matrices=new Float32Array(n*16);colors=new Float32Array(n*3);
            let start=0,at=0;
            for(let i=0;i<=source.sites.length;i++)if(i===source.sites.length||source.sites[i].removed){
              matrices.set(source.matrix.subarray(start*16,i*16),at*16);
              colors.set(source.tints.subarray(start*3,i*3),at*3);at+=i-start;start=i+1;
            }
          }
          source.full=[new THREE.InstancedBufferAttribute(matrices,16),new THREE.InstancedBufferAttribute(colors,3)];
        }
        const [transforms,tints]=source.full;
        for(const mesh of source.meshes){
          saved.push([mesh,mesh.instanceMatrix,mesh.instanceColor,mesh.count,mesh.visible]);
          mesh.instanceMatrix=transforms;mesh.instanceColor=tints;mesh.count=transforms.count;mesh.visible=mesh.count>0;
        }
      }
      return await visit();
    }finally{
      for(const [mesh,matrix,color,count,visible] of saved){
        mesh.instanceMatrix=matrix;mesh.instanceColor=color;mesh.count=count;mesh.visible=visible;
      }
      exportDepth--;if(dirty&&camera)update(camera.position);
    }
  };
  if(camera)update(camera.position);
  return {observer,daylight,update};
}

