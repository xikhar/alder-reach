import {MathUtils,Raycaster,Vector3} from 'three';

// Fit the stance to the actual upper surfaces of the crossed twigs. The foot
// mesh stays in its authored gripping pose while the breast and head animate.
export function fitPerch(actor,branch){
  const root=actor.root,ray=new Raycaster(),down=new Vector3(0,-1,0),p=new Vector3();
  root.updateMatrixWorld(true);branch.updateMatrixWorld(true);
  const mesh=actor.skin.find(m=>m.material.name==='Bill and legs');
  const indices=mesh.geometry.attributes.skinIndex;
  const feet=['legL','legR'].map(name=>{
    const vertices=[];
    for(let i=0;i<indices.count;i++){
      if(mesh.skeleton.bones[indices.getX(i)].name===name){
        const vertex=mesh.getVertexPosition(i,new Vector3()).applyMatrix4(mesh.matrixWorld);
        vertices.push(root.worldToLocal(vertex));
      }
    }
    const low=Math.min(...vertices.map(v=>v.y));
    const sole=new Map();
    for(const v of vertices)if(v.y<low+.017){
      const key=[v.x,v.y,v.z].map(n=>Math.round(n*100000)).join(',');
      sole.set(key,v);
    }
    return [...sole.values()];
  });
  function clearance(points){
    let minimum=Infinity;
    for(const point of points){
      root.localToWorld(p.copy(point));const y=p.y;
      p.y+=.15;ray.set(p,down);ray.far=.33;
      const hit=ray.intersectObject(branch,true)[0];
      if(hit)minimum=Math.min(minimum,y-hit.point.y);
    }
    return minimum;
  }
  const width=feet.map(points=>points.reduce((s,v)=>s+v.x,0)/points.length*root.scale.x);
  for(let i=0;i<7;i++){
    root.updateWorldMatrix(true,true);
    const [left,right]=feet.map(clearance);
    if(!Number.isFinite(left+right))break;
    root.position.y+=.00075-(left+right)*.5;
    root.rotation.z+=MathUtils.clamp((left-right)/(width[1]-width[0]),-.12,.12);
    if(Math.max(Math.abs(left-.00075),Math.abs(right-.00075))<.00015)break;
  }
  root.updateWorldMatrix(true,true);
  return {height:root.position.y,roll:root.rotation.z,yaw:root.rotation.y};
}
