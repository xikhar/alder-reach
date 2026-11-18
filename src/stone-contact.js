import * as T from 'three';

const columns = 4;

function column(value, minimum, scale) {
  return Math.min(columns - 1, Math.max(0, Math.floor((value - minimum) * scale)));
}

// A downward ray on a static stone only needs the front-facing triangles in its XZ column.
function verticalFacets({geometry, matrix, bounds}) {
  const positions = geometry.getAttribute('position'), index = geometry.index;
  const vertices = [];
  for (let i = 0; i < positions.count; i++) {
    vertices.push(new T.Vector3().fromBufferAttribute(positions, i).applyMatrix4(matrix));
  }
  const buckets = Array.from({length: columns * columns}, () => []);
  const scaleX = columns / (bounds.max.x - bounds.min.x || 1);
  const scaleZ = columns / (bounds.max.z - bounds.min.z || 1);
  const mirrored = matrix.determinant() < 0;
  const first = geometry.drawRange.start;
  const end = Math.min(index?.count ?? positions.count, first + geometry.drawRange.count);
  for (let i = first; i + 2 < end; i += 3) {
    const a = vertices[index ? index.getX(i) : i];
    const b = vertices[index ? index.getX(i + 1) : i + 1];
    const c = vertices[index ? index.getX(i + 2) : i + 2];
    const bx = b.x - a.x, bz = b.z - a.z, cx = c.x - a.x, cz = c.z - a.z;
    const det = bx * cz - bz * cx;
    if (mirrored ? det <= 0 : det >= 0) continue;
    const face = {a, bx, bz, cx, cz, by: b.y - a.y, cy: c.y - a.y, det};
    const x0 = column(Math.min(a.x, b.x, c.x), bounds.min.x, scaleX);
    const x1 = column(Math.max(a.x, b.x, c.x), bounds.min.x, scaleX);
    const z0 = column(Math.min(a.z, b.z, c.z), bounds.min.z, scaleZ);
    const z1 = column(Math.max(a.z, b.z, c.z), bounds.min.z, scaleZ);
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) buckets[z * columns + x].push(face);
    }
  }
  return {scaleX, scaleZ, buckets};
}

// Both terrain layers use the placed mesh with its rounded render-buffer matrix.
export function stoneContact(cell,area){
  const bins=new Map(),proxy=new T.Mesh(),probe=new T.Raycaster(),hits=[];
  const key=(i,j)=>i+','+j;
  function add(geometry,pose){
    if(!geometry.boundingBox)geometry.computeBoundingBox();
    if(!geometry.boundingSphere)geometry.computeBoundingSphere();
    const matrix=new T.Matrix4().fromArray(new Float32Array(pose.elements));
    const bounds=geometry.boundingBox.clone().applyMatrix4(matrix),rock={geometry,matrix,bounds};
    for(let i=Math.floor(bounds.min.x/cell);i<=Math.floor(bounds.max.x/cell);i++){
      for(let j=Math.floor(bounds.min.z/cell);j<=Math.floor(bounds.max.z/cell);j++){
        const k=key(i,j);
        if(!bins.has(k))bins.set(k,[]);
        bins.get(k).push(rock);
      }
    }
  }
  function top(x,z,ground){
    if(x<area[0]||x>area[1]||z<area[2]||z>area[3])return ground;
    const rocks=bins.get(key(Math.floor(x/cell),Math.floor(z/cell)));
    if(!rocks)return ground;
    let y=ground;
    for(const rock of rocks){
      const {min,max}=rock.bounds;
      if(x<min.x||x>max.x||z<min.z||z>max.z||max.y<=y)continue;
      const {scaleX, scaleZ, buckets} = rock.facets ??= verticalFacets(rock);
      const bucket = buckets[column(z, min.z, scaleZ) * columns + column(x, min.x, scaleX)];
      for (const face of bucket) {
        const dx = x - face.a.x, dz = z - face.a.z;
        const u = (dx * face.cz - dz * face.cx) / face.det;
        const v = (face.bx * dz - face.bz * dx) / face.det;
        if (u >= 0 && v >= 0 && u + v <= 1) y = Math.max(y, face.a.y + u * face.by + v * face.cy);
      }
    }
    return y;
  }
  const end=new T.Vector3(),tested=new Set();
  function trace(ray,length){
    ray.at(length,end);
    const x0=Math.max(area[0],Math.min(ray.origin.x,end.x)),x1=Math.min(area[1],Math.max(ray.origin.x,end.x));
    const z0=Math.max(area[2],Math.min(ray.origin.z,end.z)),z1=Math.min(area[3],Math.max(ray.origin.z,end.z));
    if(x0>x1||z0>z1)return null;
    probe.ray.copy(ray);probe.near=0;probe.far=length;tested.clear();
    let nearest=null;
    for(let j=Math.floor(z0/cell);j<=Math.floor(z1/cell);j++)for(let i=Math.floor(x0/cell);i<=Math.floor(x1/cell);i++){
      for(const rock of bins.get(key(i,j))??[]){
        if(tested.has(rock))continue;
        tested.add(rock);
        if(!ray.intersectsBox(rock.bounds))continue;
        proxy.geometry=rock.geometry;proxy.matrixWorld.copy(rock.matrix);hits.length=0;proxy.raycast(probe,hits);
        for(const hit of hits)if(!nearest||hit.distance<nearest.distance)nearest=hit;
      }
    }
    return nearest;
  }
  return {add,top,trace};
}
