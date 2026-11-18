import {Box3,Matrix4,Vector3} from 'three';

const clustersByGeometry=new WeakMap();
const start=new Vector3(),lower=new Vector3(),upper=new Vector3(),delta=new Vector3();
const envelope=new Box3(),posed=new Box3(),segment=new Box3(),end=new Vector3();
const boneMatrices=[],binding=new Matrix4();

// A linear blend of joint positions lies inside their combined bounds. Retain
// bounds for every contributing joint, including the full range of morphs.
// The leaf ranges address the original glTF triangles without reordering them.
export function preparePosedContact(mesh){
  const g=mesh.geometry;
  if(clustersByGeometry.has(g))return;
  const {position,skinWeight,skinIndex}=g.attributes;
  const index=g.index,morphs=g.morphAttributes.position??[],clusters=[];
  const total=index?index.count:position.count;
  for(let offset=0;offset<total;offset+=288){
    const count=Math.min(288,total-offset),joints=new Map(),visited=new Set();
    for(let j=offset;j<offset+count;j++){
      const id=index?index.getX(j):j;
      if(visited.has(id))continue;
      visited.add(id);start.fromBufferAttribute(position,id);lower.copy(start);upper.copy(start);
      for(const morph of morphs){
        delta.fromBufferAttribute(morph,id);
        if(!g.morphTargetsRelative)delta.sub(start);
        for(const axis of ['x','y','z']){
          lower[axis]+=Math.min(delta[axis],0);upper[axis]+=Math.max(delta[axis],0);
        }
      }
      for(let k=0;k<4;k++){
        if(skinWeight.getComponent(id,k)<=0)continue;
        const joint=skinIndex.getComponent(id,k);
        if(!joints.has(joint))joints.set(joint,new Box3());
        joints.get(joint).expandByPoint(lower).expandByPoint(upper);
      }
    }
    clusters.push({offset,count,joints:[...joints]});
  }
  clustersByGeometry.set(g,clusters);
}

export function intersectPosedMesh(mesh,ray,hits){
  const geometry=mesh.geometry,clusters=clustersByGeometry.get(geometry);
  const {bones,boneInverses}=mesh.skeleton;
  binding.multiplyMatrices(mesh.matrixWorld,mesh.bindMatrixInverse);
  for(let i=0;i<bones.length;i++){
    const transform=boneMatrices[i]??=new Matrix4();
    transform.copy(binding).multiply(bones[i].matrixWorld).multiply(boneInverses[i]).multiply(mesh.bindMatrix);
  }
  ray.ray.at(ray.far,end);
  segment.makeEmpty().expandByPoint(ray.ray.origin).expandByPoint(end);
  const originalStart=geometry.drawRange.start,originalCount=geometry.drawRange.count;
  try{
    for(const {joints,offset,count} of clusters){
      envelope.makeEmpty();
      for(const [bone,box] of joints)envelope.union(posed.copy(box).applyMatrix4(boneMatrices[bone]));
      envelope.expandByScalar(.00001);
      if(!envelope.intersectsBox(segment)||!ray.ray.intersectsBox(envelope))continue;
      const from=Math.max(originalStart,offset),to=Math.min(originalStart+originalCount,offset+count);
      if(to<=from)continue;
      geometry.setDrawRange(from,to-from);mesh.raycast(ray,hits);
    }
  }finally{geometry.setDrawRange(originalStart,originalCount);}
}
