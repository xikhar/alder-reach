// The shader and native exporter use the same per-instance transition limits.
// Scale is the third column length of the world matrix for all three levels.
export const rockNearBand=[192,224];

export function rockRanges(scale){
  const shelf=Math.max(rockNearBand[1],164+70*Math.min(2.8,scale));
  const talus=Math.min(5200,Math.max(290,scale*825));
  return [...rockNearBand,shelf,shelf*1.27,talus,talus*1.23];
}
export function nativeRockLevel(distance,scale) {
  const [a,b,c,d,e,f]=rockRanges(scale);
  return distance<(a+b)*.5?0:distance<(c+d)*.5?1:distance<(e+f)*.5?2:-1;
}
export function screenRock(shader,detail,observer){
  shader.uniforms.rockObserver=observer;
  shader.vertexShader='uniform vec2 rockObserver;varying vec2 rockCoverage;\n'+shader.vertexShader;
  shader.fragmentShader='varying vec2 rockCoverage;\n'+shader.fragmentShader;
  // Keep the coverage interval on one side of the same screen-door threshold for
  // both silhouettes. Their common pixels remain filled through each handoff.
  shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>',`
    rockCoverage=vec2(0.,1.);
    #ifdef USE_INSTANCING
      float rawRange=distance(rockObserver,instanceMatrix[3].xz);
      float rockScale=length(instanceMatrix[2].xyz);
      float shelf=max(${rockNearBand[1].toFixed(1)},164.+70.*min(2.8,rockScale));
      float talus=clamp(rockScale*825.,290.,5200.);
      float a=smoothstep(${rockNearBand[0].toFixed(1)},${rockNearBand[1].toFixed(1)},rawRange);
      float b=smoothstep(shelf,1.27*shelf,rawRange);
      float c=smoothstep(talus,1.23*talus,rawRange);
      rockCoverage=${['vec2(a,1.)','vec2(b,a)','vec2(c,b)'][detail]};
    #endif
    #include <project_vertex>
  `);
  shader.fragmentShader=shader.fragmentShader.replace('#include <clipping_planes_fragment>',`
    #include <clipping_planes_fragment>
    if(rockCoverage.x>0. || rockCoverage.y<1.){
      float screenDoor=fract(52.9829189*fract(dot(floor(gl_FragCoord.xy),vec2(.06711056,.00583715))));
      if(screenDoor<rockCoverage.x || screenDoor>=rockCoverage.y)discard;
    }
  `);
}
