/** World-metric mineral inclusions on the faces of the actual cobble meshes. */
export function weatheredStone(shader,scan,world,wet){
  shader.uniforms.stoneGrain=scan;
  shader.fragmentShader='uniform sampler2D stoneGrain;\n'+shader.fragmentShader;
  shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',`
    // Oblique projection continues the bedding around the knocked sides. Two
    // grain sizes share the ground scan and its mipmaps at grazing angles.
    vec2 face=${world}.xz+vec2(.47,-.63)*${world}.y;
    vec4 mottling=texture2D(stoneGrain,face*1.12)*2.-1.;
    vec4 crystals=texture2D(stoneGrain,face*5.7+vec2(.37,.61))*2.-1.;
    vec4 rind=mottling*.67+crystals*.33;
    float saturation=1.-.27*${wet};
    vec3 iron=vec3(.52,.01,-.48)*rind.a;
    diffuseColor.rgb*=exp2(saturation*(1.16*rind.r+iron))*(1.-.10*${wet});
    #include <roughnessmap_fragment>
  `);
  shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`
    #include <normal_fragment_maps>
    vec3 slope=mat3(viewMatrix)*vec3(rind.g,.47*rind.g-.63*rind.b,rind.b);
    normal=normalize(normal+(.49-.23*${wet})*(slope-normal*dot(normal,slope)));
  `);
}
