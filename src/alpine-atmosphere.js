// Vertical optical density in the alpine basin. The closed-form integral makes
// looking down into the alluvium different from looking up at an exposed summit.
export const alpineAirGLSL = `
  float valleyOpticalDepth(float range, float eyeHeight, float surfaceHeight) {
    const float scaleHeight=335.;
    float dz=clamp((surfaceHeight-eyeHeight)/scaleHeight,-7.,7.);
    float meanDensity=abs(dz)<.008 ? 1.-.5*dz : (1.-exp(-dz))/dz;
    return max(0.,range-45.)*.00046*exp(-clamp((eyeHeight+48.)/scaleHeight,-2.,5.))*meanDensity;
  }
  vec3 valleyRadiance(vec3 pigment,float range,float height,float dusk) {
    float tau=valleyOpticalDepth(range,cameraPosition.y,height);
    vec3 air=mix(vec3(.194,.344,.471),vec3(.059,.080,.126),dusk);
    return mix(pigment,air,1.-exp(-tau));
  }
`;
