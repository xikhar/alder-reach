import {DynamicDrawUsage,InstancedBufferAttribute} from 'three';

// Trunk, leaf and shadow primitives share their population buffers. Replace
// every owner's attribute together when a dense patch fills the starting pool.
export function reservePlantDraws(draws,capacity,casters=[]){
  const first=draws[0];
  if(capacity<=first.instanceMatrix.count)return;
  function grow(old){
    if(!old)return null;
    const data=new Float32Array(capacity*old.itemSize);
    data.set(old.array);
    return new InstancedBufferAttribute(data,old.itemSize).setUsage(DynamicDrawUsage);
  }
  const matrix=grow(first.instanceMatrix),color=grow(first.instanceColor);
  const shadows=casters.length?grow(casters[0].instanceMatrix):null;
  for(const draw of [...draws,...casters])draw.dispose();
  for(const draw of draws){draw.instanceMatrix=matrix;draw.instanceColor=color;}
  for(const draw of casters){draw.instanceMatrix=shadows;draw.instanceColor=color;}
}
