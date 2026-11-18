// The approach leaves the meadow trail, turns around the lupine bank, then
// descends to the stony ford. Distances are in world metres.
const smooth = (a,b,x) => {
  const t=Math.min(1,Math.max(0,(x-a)/(b-a)));
  return t*t*(3-2*t);
};

export function fordTrailZ(x) {
  const approach=4.8*Math.exp(-((x-6.5)**2)/21)+1.2*Math.exp(-((x-11.85)**2)/2.7);
  const meadow=smooth(11.03,12.36,x)*(1-smooth(14.8,17.45,x));
  const turn=meadow*(1.02+.51*Math.exp(-((x-12.43)**2)/1.13));
  return -34.1-.19*(20.5-x)-.46*Math.sin((x-16.5)*.8)+approach-turn;
}

export function fordMargin(x) {
  // The sharp near turn crosses the X transect at an angle. Its projected
  // Z width grows here while the traversable width stays roughly constant.
  const bend=.72*Math.exp(-((x-11.83)**2)/.37);
  return 1-.40*smooth(9.1,11.6,x)*(1-smooth(15.3,17.8,x))+bend;
}

export const fordPathGLSL = `
float fordCenter(float x){
  float approach=4.8*exp(-(x-6.5)*(x-6.5)/21.)+1.2*exp(-(x-11.85)*(x-11.85)/2.7);
  float meadow=smoothstep(11.03,12.36,x)*(1.-smoothstep(14.8,17.45,x));
  float turn=meadow*(1.02+.51*exp(-(x-12.43)*(x-12.43)/1.13));
  return -34.1-.19*(20.5-x)-.46*sin((x-16.5)*.8)+approach-turn;
}
float fordMargin(float x){
  float bend=.72*exp(-(x-11.83)*(x-11.83)/.37);
  return 1.-.40*smoothstep(9.1,11.6,x)*(1.-smoothstep(15.3,17.8,x))+bend;
}
`;
