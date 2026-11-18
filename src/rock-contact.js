import {Raycaster, Vector3} from 'three';

// The nearby collider shares its triangles and world transform with the visible Blender mesh.
// Cast only inside a rock's world bounds. This keeps ground sampling inexpensive on open trails.
const down=new Vector3(0,-1,0);
const probe=new Raycaster(),hits=[];
const footprint=[[0,0],[.15,0],[-.15,0],[0,.15],[0,-.15]];

export function walkingSurface(land,rocks,x,z){
  let surface=land.height(x,z);
  for(const rock of rocks){
    const box=rock.bounds;
    if(!box||x<box.min.x-.15||x>box.max.x+.15||z<box.min.z-.15||z>box.max.z+.15)continue;
    for(const [dx,dz] of footprint){
      const px=x+dx,pz=z+dz;
      if(px<box.min.x||px>box.max.x||pz<box.min.z||pz>box.max.z)continue;
      probe.ray.origin.set(px,box.max.y+.1,pz);probe.ray.direction.copy(down);
      probe.near=0;probe.far=box.max.y-box.min.y+.2;hits.length=0;
      probe.intersectObject(rock.collider,false,hits);
      if(hits.length)surface=Math.max(surface,hits[0].point.y);
    }
  }
  return surface;
}

export function firstRockHit(rocks,ray,length){
  let nearest=null;
  probe.ray.copy(ray);probe.near=0;probe.far=length;
  for(const rock of rocks){
    if(!rock.bounds||!ray.intersectsBox(rock.bounds))continue;
    hits.length=0;
    probe.intersectObject(rock.collider,false,hits);
    if(hits.length&&(!nearest||hits[0].distance<nearest.distance))nearest=hits[0];
  }
  return nearest;
}
