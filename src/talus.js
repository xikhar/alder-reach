// Talus fans follow the lower flanks of glacial shoulders. Azimuth is their
// downslope axis in the X/Z plane. These same ellipses seed the physical clasts.
export const talusFans = [
  [-112,-253,36,12,-.35,1.65], [182,-293,77,16,.64,2.4],
  [-246,-444,104,25,.47,3.2], [321,-544,83,22,-.62,2.9],
  [-491,-698,119,27,-.56,4.6], [534,-879,162,33,.73,4.8],
  [-316,-1122,146,25,-.53,3.9], [692,-1226,195,48,-.49,5.1],
  [-913,-1408,179,39,.69,6.3], [882,-1677,218,49,-.54,6.4],
  [-1092,-1911,259,67,.38,7.1], [607,-2149,169,40,-.94,5.4],
  [-882,-2613,292,54,.34,7.3], [894,-2792,227,62,-.47,6.4],
  [-1538,-2465,335,74,-.26,8.6], [1555,-2406,262,79,-.71,7.3],
  [840,-3198,246,55,.20,7.4], [-988,-3261,221,71,-.34,7.8],
  [1316,-392,197,40,-.32,5.9], [-1647,-260,222,71,.53,6.2],
  [2120,216,230,57,.85,6.7], [-1943,429,211,54,-.39,6.6],
  [-827,986,118,39,.83,4.7], [713,1056,103,29,-.83,4.2],
  [934,1878,182,43,.41,5.6], [-1044,2184,176,54,.27,6.1],
].map(([x,z,length,width,angle,scale])=>({
  x,z,length,width,angle,scale,dx:Math.cos(angle),dz:Math.sin(angle)
}));

export function talusCover(x,z) {
  let cover=0;
  for(const fan of talusFans){
    const x0=x-fan.x,z0=z-fan.z;
    if(Math.abs(x0)>fan.length+fan.width || Math.abs(z0)>fan.length+fan.width)continue;
    const u=(x0*fan.dx+z0*fan.dz)/fan.length;
    const v=(z0*fan.dx-x0*fan.dz)/fan.width;
    const seam=.11*Math.sin(6.2*u+fan.x);
    const r=u*u+((v-seam)/(1.08-.31*u))**2;
    const t=Math.max(0,Math.min(1,1.12-r));
    cover=Math.max(cover,t*t*(3-2*t));
  }
  return cover;
}
