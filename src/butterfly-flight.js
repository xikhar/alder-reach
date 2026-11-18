import * as T from 'three';

const tau=2*Math.PI;
const smooth=T.MathUtils.smoothstep;
const rimPeriod=14.4;
// Time, world X, lift above the yarrow crown and world Z. The first and last stations meet the surveyed
// highest capitulum of the yarrow on the near bank of River Overlook.
const rimRoute=[
  [0,-.223,0.0,-88.928],[.35,-.223,0.0,-88.928],
  [.74,-.29,0.318,-88.71],[1.10,-.90,1.518,-87.92],
  [1.46,-2.07,1.76,-85.96],[1.82,-2.94,2.02,-86.09],
  [2.36,-4.40,3.155,-89.16],[3.02,-4.74,3.408,-92.68],
  [3.85,-3.85,3.828,-96.50],[4.85,-1.68,4.078,-100.99],
  [6.0,.59,4.228,-105.47],[7.20,3.09,4.018,-107.33],
  [8.65,4.20,2.698,-104.04],[10.34,3.73,1.698,-97.65],
  [11.75,2.25,0.928,-92.40],[12.78,.78,0.378,-90.00],
  [13.56,-.223,0.0,-88.928],[rimPeriod,-.223,0.0,-88.928]
];

function routePoint(time,out){
  let k=1;
  while(k<rimRoute.length-1 && time>rimRoute[k][0])k++;
  const a=rimRoute[k-1],b=rimRoute[k],before=rimRoute[Math.max(0,k-2)],after=rimRoute[Math.min(rimRoute.length-1,k+1)];
  const dt=b[0]-a[0],u=(time-a[0])/dt,u2=u*u,u3=u2*u;
  for(let axis=1;axis<=3;axis++){
    // Zero the tangents at both ends of the visit to the flower.
    const va=k<=2||k===rimRoute.length-1?0:(b[axis]-before[axis])/(b[0]-before[0]);
    const vb=k===1||k>=rimRoute.length-2?0:(after[axis]-a[axis])/(after[0]-a[0]);
    out.setComponent(axis-1,(2*u3-3*u2+1)*a[axis]+(u3-2*u2+u)*dt*va+(-2*u3+3*u2)*b[axis]+(u3-u2)*dt*vb);
  }
}
function stroke(t,start,end,ramp){
  return smooth(t,start,start+ramp)*(1-smooth(t,end-ramp,end));
}

export function createButterflyFlight(land){
  const before=new T.Vector3(),after=new T.Vector3(),euler=new T.Euler(0,0,0,'YXZ'),perched=new T.Quaternion();
  const flowerHeight=land.height(-.301829,-88.816307)+.3482;
  const sites=[
    ['trail swallowtail','Swallowtail',-2.6,-13,1.45,7.25],
    ['meadow swallowtail','Swallowtail',10,-35,1.70,8.4],
    ['ford azure','Azure',land.streamX(-39)-2.6,-37.5,1.65,6.8],
    ['bank azure','Azure',land.streamX(-40)-4.7,-40,1.30,5.7],
    ['rim swallowtail','Swallowtail',rimRoute[0][1],rimRoute[0][3],1.78,rimPeriod],
    ['overlook swallowtail','Swallowtail',3,-88,1.30,7.6],
    ['camp azure','Azure',5,-17,1.17,6.35]
  ].map(([id,kind,x,z,scale,period],i)=>({id,kind,x,z,scale,period,phase:i*2.43,rim:i===4}));
  function position(site,time,out){
    const t=T.MathUtils.euclideanModulo(time,site.period);
    if(site.rim){
      routePoint(t,out);
      out.y=Math.max(flowerHeight+out.y,land.height(out.x,out.z)+.22);
      return;
    }
    const a=tau*t/site.period+site.phase,turn=a+.14*Math.sin(2*a+.5);
    const x=site.x+1.17*Math.cos(turn)+.12*Math.sin(2*a);
    const z=site.z+.83*Math.sin(turn)+.09*Math.cos(2*a);
    out.set(x,land.height(x,z)+.89+.34*Math.sin(2*a+site.phase)+.12*Math.cos(3*a),z);
  }
  function sample(site,time,out){
    const t=T.MathUtils.euclideanModulo(time,site.period);
    // Average the turn over the body�s banking response, across spline knots.
    const dt=site.rim ? .135 : .060;
    position(site,t,out.position);position(site,t-dt,before);position(site,t+dt,after);
    const vx=(after.x-before.x)/(2*dt),vy=(after.y-before.y)/(2*dt),vz=(after.z-before.z)/(2*dt);
    const ax=(after.x+before.x-2*out.position.x)/(dt*dt),az=(after.z+before.z-2*out.position.z)/(dt*dt);
    const speed=Math.hypot(vx,vz),bank=T.MathUtils.clamp(Math.atan2((vz*ax-vx*az)/Math.max(.08,speed),6.4),-.85,.85);
    const tilt=Math.atan2(vy,Math.max(speed,.001))*.68;
    const cycle=t/site.period,phase=tau*(Math.round(site.period*(site.kind==='Azure'?5.85:5.1))*cycle)+site.phase+.56*Math.sin(tau*cycle);
    let flight=1,power=.29+.71*smooth(Math.sin(tau*3*cycle+site.phase),-.71,.25);
    if(site.rim){
      flight=stroke(t,.35,13.56,.42);
      power=stroke(t,.30,1.99,.25)+stroke(t,2.63,3.04,.15)+stroke(t,3.84,4.34,.16)+stroke(t,5.04,5.59,.15)+
        stroke(t,6.28,8.55,.34)+stroke(t,9.14,12.23,.35)+stroke(t,12.43,13.67,.28);
    }
    out.rotation.setFromEuler(euler.set(tilt,Math.atan2(-vx,-vz),bank,'YXZ'));
    if(site.rim&&flight<1){
      perched.setFromEuler(euler.set(.12,2.62,.04,'YXZ'));
      out.rotation.slerp(perched,1-flight);
    }
    // The upstroke folds the wings above the thorax. Small differences between
    // hinges change lift in a turn. During a glide both wings hold a low dihedral.
    const base=.24+.94*(1-flight),turnStroke=.061*bank*flight;
    out.left=-(base+power*(.30+.84*Math.sin(phase+.13*Math.sin(phase)))-turnStroke);
    out.right=base+power*(.30+.84*Math.sin(phase+.08+.13*Math.sin(phase)))+turnStroke;
    return out;
  }
  return {sites,sample};
}
