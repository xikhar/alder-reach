import * as THREE from 'three';
import {rockNearBand,rockRanges,screenRock} from './rock-lod.js';
import {talusFans} from './talus.js';

// Build a single set of metric world placements. The original 8.3 m scatter
// starts each cell from its integer hash. Camera travel only repacks instances.
export function createErratics(scene,land,library,random,inGrid,observer){
  const tau=2*Math.PI,tiles=new Map(),forms=[0,0,0],tileSize=140;
  const matrix=new THREE.Object3D(),tint=new THREE.Color();
  let maximumHorizontalScale=0;
  function add(x,z,s,angle,variant,stretch=1,heightRatio=1,fan=false){
    const ground=fan?land.exposedHeight:land.height;
    const center=ground(x,z);
    // Upper snowfields and the channel stay exposed. Only stone below the local treeline
    // receives the clustered talus, including on the physical outer mountain surfaces.
    if(fan&&(center>154 || Math.abs(x-land.streamX(z))<land.streamWidth(z)+8))return;
    let low=center;
    for(let k=0;k<6;k++){
      const a=k*tau/6,dx=s*.83*Math.cos(a)*stretch,dz=s*.83*Math.sin(a);
      const az=fan?-angle:angle;
      low=Math.min(low,ground(x+dx*Math.cos(az)-dz*Math.sin(az),z+dx*Math.sin(az)+dz*Math.cos(az)));
    }
    const y=Math.max(center-s*.24,low)-s*(fan?.20:.14);
    const dry=THREE.MathUtils.smoothstep(Math.abs(x-land.streamX(z))-land.streamWidth(z),2.3,4.4);
    // Exposed granite receives a buff weathering rind in open, dry alpine turf.
    // Keep this world-locked so the surface colour also holds on close approach.
    const exposure=(1-land.forestCover(x,z))*THREE.MathUtils.smoothstep(-z,128,202)*dry;
    const sx=s*1.21*stretch,sy=s*.93*heightRatio;
    maximumHorizontalScale=Math.max(maximumHorizontalScale,sx,s);
    matrix.position.set(x,y,z);matrix.rotation.set(0,angle,0);matrix.scale.set(sx,sy,s);matrix.updateMatrix();
    const [,,midStart,midEnd,,farEnd]=rockRanges(s);
    const stone={x,z,y,s,sx,sy,angle,variant,dry,exposure,midStart,midEnd,farEnd,matrix:matrix.matrix.clone()};
    const i=Math.floor(x/tileSize),j=Math.floor(z/tileSize),key=i+','+j;
    if(!tiles.has(key))tiles.set(key,{x:(i+.5)*tileSize,z:(j+.5)*tileSize,points:[]});
    tiles.get(key).points.push(stone);forms[variant]++;
  }
  for(const site of [
    [-8.1,-7.6,1.46,.7,1],[-7.24,-8.3,.74,.8,0],[-8.9,-7.7,.59,1.9,2],
    [2.96,-12.4,.79,1.1,2],[3.6,-13.24,.42,2.4,1],
    [land.streamX(-19)-3.15,-19,1.17,1.7,2],[land.streamX(-18)-3.9,-18,.71,.3,0],
    [land.streamX(-33)+3.05,-33,1.87,.75,1],[land.streamX(-33)+4.4,-32,.8,2.2,0],
    [-7,-68,1.59,.2,1],[-8.2,-67,.76,1.2,0],
    [land.streamX(-46.1)-land.streamWidth(-46.1)-3.1,-46.1,1.93,2.9,0],
    [land.streamX(-49)-land.streamWidth(-49)-4.55,-49,2.38,.80,2],
    [land.streamX(-42.85)-land.streamWidth(-42.85)-2.5,-42.85,.91,2.1,1],
    [land.streamX(-36.9)-land.streamWidth(-36.9)-2.16,-36.9,.84,.52,0]
  ])add(...site);
  inGrid(0,0,1420,8.3,(i,j,x,z)=>{
    if(random(i,j,312)>.26||land.isWater(x,z)||Math.hypot(x-land.streamX(-25)+8,z+25)<=2.95||Math.abs(x-land.trailX(z))<3.1)return;
    add(x,z,.31+random(i,j,371)**2*2,random(i,j,192)*tau,Math.floor(random(i,j,632)*3));
  });
  // Large leaders sit near the head. Smaller blocks spill out down-valley into
  // lobes with a little transverse spread, reproducing the strike of the apron.
  talusFans.forEach((f,index)=>{
    const count=Math.round(17+Math.sqrt(f.length*f.width)*.72);
    for(let k=0;k<count;k++){
      const a=random(k,index,817)*tau,r=Math.sqrt(random(k,index,683));
      const u=r*Math.cos(a),v=r*Math.sin(a)*(1.08-.31*u)+.11*Math.sin(6.2*u+f.x);
      const x=f.x+f.length*u*f.dx-f.width*v*f.dz,z=f.z+f.length*u*f.dz+f.width*v*f.dx;
      const s=f.scale*(.26+random(k,index,416)**2.35*1.01)*(.98+.30*u);
      const strike=-f.angle+(random(k,index,289)-.5)*.68;
      add(x,z,s,strike,Math.floor(random(k,index,653)*3),1.15+.80*random(k,index,381),.61+.31*random(k,index,772),true);
    }
  });
  // Each full-detail pool must hold the uncropped circle before view and shadow
  // culling. Bound it with the actual population of overlapping world tiles.
  const nearLimit=rockNearBand[1]+10,reach=Math.ceil(nearLimit/tileSize);
  const nearCapacities=[0,0,0],neighbours=new Map();
  for(const tile of tiles.values()){
    const counts=[0,0,0];
    for(const stone of tile.points)counts[stone.variant]++;
    const i=Math.floor(tile.x/tileSize),j=Math.floor(tile.z/tileSize);
    for(let dz=-reach;dz<=reach;dz++)for(let dx=-reach;dx<=reach;dx++){
      const key=(i+dx)+','+(j+dz);
      if(!neighbours.has(key))neighbours.set(key,[0,0,0]);
      const total=neighbours.get(key);
      for(let k=0;k<3;k++){
        total[k]+=counts[k];nearCapacities[k]=Math.max(nearCapacities[k],total[k]);
      }
    }
  }
  const batches=[],active=new Map();
  for(const [detail,group] of [[1,'Shelf'],[2,'Talus']]){
    const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.91,fog:false});
    material.name=detail===1?'Erratic granite':'Talus granite';
    material.onBeforeCompile=shader=>{
      screenRock(shader,detail,observer);
      shader.uniforms.rockHaze={value:scene.fog.color};
      shader.vertexShader='varying float rockAir;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>','rockAir=distance(rockObserver,instanceMatrix[3].xz);\n#include <project_vertex>');
      shader.fragmentShader='uniform vec3 rockHaze;varying float rockAir;\n'+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`float air=1.-exp(-max(0.,rockAir-92.)*.00077);
        outgoingLight=mix(outgoingLight,rockHaze*vec3(.51,.55,.59),air*.94);
        #include <opaque_fragment>`);
    };
    material.customProgramCacheKey=()=>'rock-scree-'+detail;
    batches[detail]=forms.map((count,variant)=>{
      const g=library.getObjectByName(group+variant).geometry;
      const mesh=new THREE.InstancedMesh(g,material,count);
      mesh.name='Granite '+group.toLowerCase()+' '+variant;
      mesh.userData.rockDetail=detail;mesh.count=0;mesh.frustumCulled=false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor=new THREE.InstancedBufferAttribute(new Float32Array(count*3),3);
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      active.set(mesh,[]);scene.add(mesh);return mesh;
    });
  }
  function shade(stone) {
    const d=stone.dry;
    return tint.setRGB(.38+.58*d+1.35*stone.exposure,.55+.43*d+1.04*stone.exposure,.72+.28*d+.66*stone.exposure);
  }
  function pack(batch,stone){
    const slot=batch.count++;batch.setMatrixAt(slot,stone.matrix);
    batch.setColorAt(slot,shade(stone));
  }
  function update(px,pz,near){
    for(const list of active.values())list.length=0;
    for(const tile of tiles.values()){
      const nearTile=Math.hypot(tile.x-px,tile.z-pz)<tileSize*Math.SQRT1_2+nearLimit;
      for(const p of tile.points){
        const d=Math.hypot(p.x-px,p.z-pz);
        if(nearTile && d<nearLimit)near(p,shade(p));
        // Keep eight metres of unwritten-screen margin while the player moves
        // between instance uploads. The per-pixel transition uses the live eye.
        if(d>rockNearBand[0]-9 && d<p.midEnd+9)active.get(batches[1][p.variant]).push(p);
        if(d>p.midStart-9 && d<p.farEnd+9)active.get(batches[2][p.variant]).push(p);
      }
    }
  }
  function crop(player,fx,fz,cosLimit,uncropped=false){
    for(const [mesh,points] of active){
      mesh.count=0;
      for(const point of points){
        if(!uncropped){
          const dx=point.x-player.x,dz=point.z-player.z;
          const pad=3+1.5*point.sx;
          if(dx*fx+dz*fz+pad<Math.hypot(dx,dz)*cosLimit)continue;
        }
        pack(mesh,point);
      }
      for(const attr of [mesh.instanceMatrix,mesh.instanceColor]){
        attr.clearUpdateRanges();attr.addUpdateRange(0,mesh.count*attr.itemSize);attr.needsUpdate=true;
      }
    }
  }
  function around(x,z,radius,visit){
    for(let i=Math.floor((x-radius)/tileSize);i<=Math.floor((x+radius)/tileSize);i++){
      for(let j=Math.floor((z-radius)/tileSize);j<=Math.floor((z+radius)/tileSize);j++){
        const tile=tiles.get(i+','+j);
        if(tile)for(const stone of tile.points)if((stone.x-x)**2+(stone.z-z)**2<=radius*radius)visit(stone);
      }
    }
  }
  return {update,crop,around,maximumHorizontalScale,nearCapacities};
}
