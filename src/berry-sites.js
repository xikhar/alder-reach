export function hash(i,j,s){
  let x=Math.imul(i,73856093)^Math.imul(j,19349663)^Math.imul(s,83492791);
  x=Math.imul(x^(x>>>16),0x45d9f3b);
  return ((x^(x>>>15))>>>0)/4294967296;
}
const TAU=2*Math.PI;
export function createBerrySites(land){
  const edgePatches=[[-3.9,-7.2,1.28],[3.7,-6.0,1.05],[-6.8,-14.3,1.24],[5.2,-12.1,1.10],
    [3.98,-4.6,1.80],[4.02,-5.64,2.26],[4.46,-6.78,1.84],[4.62,-8.1,1.74],[5.12,-8.9,1.66],
    [8.3,-36.7,.9],[15.7,-38.5,.92],[5.1,-41,1.2],[-7.4,-51,.88],[12.42,-34.08,.83],[15.1,-36.5,.98],[13.94,-40.5,.93],
    [-7.46,-95.3,1.62],[-7.83,-95.68,1.28],[-7.13,-95.59,1.18],
    [4.45,-98.4,1.52],[4.10,-98.3,1.15],[5.12,-98.52,1.36],
    [-5.99,-87.92,1.12],[-6.31,-88.18,1.07],[3.87,-90.93,1.32],[4.17,-91.08,1.16],
    [land.streamX(-39)-land.streamWidth(-39)-1.8,-40.8,1.16],
    [land.streamX(-39)-land.streamWidth(-39)-2.5,-34.2,1.24],[-8.2,-88,.88],[6.5,-89,.85]];
  return function visit(eye,radius,shrub){
    for(const [x,z,s] of edgePatches)if(Math.hypot(x-eye.x,z-eye.z)<=radius)shrub(x,z,x*1.54,s);
    const cells=Math.ceil(radius/6);
    const gx=Math.floor(eye.x/6),gz=Math.floor(eye.z/6);
    for(let i=gx-cells;i<=gx+cells;i++)for(let j=gz-cells;j<=gz+cells;j++){
      if(hash(i,j,73)>.33)continue;
      const x=(i+hash(i,j,7))*6,z=(j+hash(i,j,8))*6,d=Math.hypot(x-eye.x,z-eye.z);
      if(d>radius||Math.abs(x)>1064||Math.abs(z)>1064||land.isWater(x,z)||Math.abs(x-land.trailX(z))<2.55||Math.hypot(x-7,z+25)<4.2)continue;
      shrub(x,z,hash(i,j,21)*TAU,.60+hash(i,j,88)*.76);
    }
  };
}

export function visitRagwort(land,eye,radius,emit){
  for(let j=Math.floor((eye.z-radius-2)/3.4);j<=Math.ceil((eye.z+radius+2)/3.4);j++)for(const side of [-1,1]){
    const z=j*3.4+hash(j,side,46)*1.8;
    if(z < -75)continue;
    const x=land.trailX(z)+side*(1.65+hash(j,side,12)*1.45);
    if(hash(j,side,113)>.64 || Math.hypot(eye.x-x,eye.z-z)>radius || land.isWater(x,z))continue;
    for(let k=0;k<3;k++)emit(x+hash(j,k,346)*.46,z+hash(j,k,54)*.64,k*2.4,.78+.64*hash(j,k,35));
  }
}
