/** Broad gust fronts shared by grass tips, flower stems and the fire plume. */
export const windGLSL=`
float windGust(vec2 p,float t){
  float longWave=sin(dot(p,vec2(.119,-.074))-t*1.31+.68*sin(p.y*.082+t*.24));
  float eddy=sin(dot(p,vec2(.37,.21))-t*2.23);
  return smoothstep(-.8,1.,longWave*.79+eddy*.21);
}
vec2 windOffset(vec2 p,float t){
  float pulse=windGust(p,t);
  return vec2(.038+.126*pulse,-.021-.046*pulse)+vec2(.012*sin(p.y*.64+t*3.1),.016*sin(p.x*.41-t*2.7));
}
`;
export function windAt(x,z,t,out){
  const wide=Math.sin(x*.119-z*.074-t*1.31+.68*Math.sin(z*.082+t*.24));
  const eddy=Math.sin(x*.37+z*.21-t*2.23);
  const k=Math.max(0,Math.min(1,(wide*.79+eddy*.21+.8)/1.8));
  const gust=k*k*(3-2*k);
  return out.set(.038+.126*gust+.012*Math.sin(z*.64+t*3.1),-.021-.046*gust+.016*Math.sin(x*.41-t*2.7));
}
