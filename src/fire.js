/** Ray-integrated fire and wind-advected particulate matter. All coordinates are metres. */
import * as T from 'three';

function turbulenceTexture(){
  const side=128, data=new Uint8Array(side*side*4);
  let seed=41;const random=()=>((seed=Math.imul(seed,1664525)+1013904223|0)>>>0)/4294967296;
  const layers=[4,8,16,32,64].map(n=>({n,field:Float32Array.from({length:n*n},random)}));
  function sample({field,n},x,y){
    x=x*n/side;y=y*n/side;const i=Math.floor(x),j=Math.floor(y);
    let fx=x-i,fy=y-j;fx=fx*fx*(3-2*fx);fy=fy*fy*(3-2*fy);
    const v=(a,b)=>field[((b+n)%n)*n+(a+n)%n];
    return (v(i,j)*(1-fx)+v(i+1,j)*fx)*(1-fy)+(v(i,j+1)*(1-fx)+v(i+1,j+1)*fx)*fy;
  }
  for(let y=0;y<side;y++)for(let x=0;x<side;x++){
    const i=(y*side+x)*4;
    for(let k=0;k<3;k++){
      let value=0;for(let j=0;j<layers.length;j++)value+=2**(-j-1)*sample(layers[j],(x+43*k)%side,(y+29*k)%side);
      data[i+k]=Math.round(value*255);
    }
    data[i+3]=255;
  }
  const tex=new T.DataTexture(data,side,side);tex.wrapS=tex.wrapT=T.RepeatWrapping;
  tex.generateMipmaps=true;tex.magFilter=T.LinearFilter;tex.minFilter=T.LinearMipMapLinearFilter;tex.needsUpdate=true;return tex;
}

export function createHearthEffects(group,light){
  const flow=turbulenceTexture(),eye=new T.Vector3(),wind=new T.Vector2();
  const material=new T.ShaderMaterial({
    uniforms:{flow:{value:flow},clock:{value:0},eye:{value:eye},wind:{value:wind}},
    transparent:true,depthWrite:false,side:T.FrontSide,
    vertexShader:`
      varying vec3 point;
      void main(){point=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}
    `,
    fragmentShader:`
      varying vec3 point;
      uniform sampler2D flow;uniform float clock;uniform vec3 eye;uniform vec2 wind;
      float burn(vec3 p){
        float h=p.y+.53;
        vec2 at=p.xz-wind*h*h*.27;
        vec3 a=texture2D(flow,at*.85+vec2(h*.13-clock*.07,-h*.41+clock*.29)).rgb;
        vec3 b=texture2D(flow,at*1.83+vec2(h*.38+clock*.12,-h*.61+clock*.61)).rgb;
        at+=((a.rb-.48)*.43+(b.gr-.49)*.17)*(.3+max(h,0.));
        float density=0.;
        for(int j=0;j<5;j++){
          float n=float(j),phi=n*2.40,r=.095+mod(n,2.)*.058;
          float height=.54+.33*(.5+.5*sin(n*9.3+clock*3.2+sin(clock*4.3+n)))+.11*cos(n*3.3);
          float relative=h/height;
          vec2 center=r*vec2(cos(phi),sin(phi))*(1.-.40*h);
          center+=h*.085*vec2(sin(h*7.+n*1.6-clock*3.7),cos(h*10.+n*3.1-clock*3.1));
          float radius=max(.014,(.105+.027*cos(n*12.3))*(1.-relative*.84));
          float lick=1.-length((at-center)*vec2(.94,1.08))/radius;
          density+=max(0.,lick+(b.r-.50)*.73-.20*relative)*smoothstep(-.03,.13,h)*(1.-smoothstep(.71,1.0,relative));
        }
        return density;

      }
      void main(){
        vec3 dir=normalize(point-eye),extent=vec3(.49,.56,.49);
        vec3 inv=1./(dir+vec3(.0000001));vec3 a=(-extent-point)*inv,b=(extent-point)*inv;
        vec3 t=max(a,b);float end=min(t.x,min(t.y,t.z));if(end<.002)discard;
        float ds=min(end,1.7)/28.;vec3 p=point+dir*(ds*.5),sum=vec3(0);float trans=1.;
        for(int i=0;i<28;i++){
          float density=burn(p);float h=p.y+.53;
          float absorb=1.-exp(-density*ds*16.);
          float hot=smoothstep(.11,.68,density)*(.69+.31*(1.-h));
          vec3 c=mix(vec3(1.3,.085,.006),vec3(2.2,.70,.045),smoothstep(.04,.32,density));
          c=mix(c,vec3(3.75,2.5,.76),hot*.68);
          c=mix(c,vec3(.18,.35,1.1),.23*(1.-smoothstep(.06,.20,h))*(1.-hot));
          sum+=trans*absorb*c;trans*=1.-absorb;p+=dir*ds;if(trans<.025)break;
        }
        float alpha=1.-trans;if(alpha<.012)discard;gl_FragColor=vec4(sum/max(.012,alpha),alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `
  });
  const furnace=new T.Mesh(new T.BoxGeometry(.98,1.12,.98),material);
  furnace.name='Buoyant flame volume';furnace.position.y=.64;furnace.renderOrder=5;group.add(furnace);

  const smokeMaterial=new T.ShaderMaterial({uniforms:{flow:{value:flow},clock:{value:0}},
    transparent:true,depthWrite:false,vertexShader:`
      attribute float life;attribute float phase;
      varying float age;varying float seed;varying vec3 puffPoint;varying vec3 puffEye;
      void main(){
        age=life;seed=phase;puffPoint=position;
        mat4 transform=modelViewMatrix*instanceMatrix;
        vec4 center=transform*vec4(0,0,0,1);
        float scale=.17+life*.89;
        vec3 eyeView=-center.xyz;
        puffEye=vec3(dot(eyeView,transform[0].xyz),dot(eyeView,transform[1].xyz),dot(eyeView,transform[2].xyz))/scale;
        gl_Position=projectionMatrix*(center+transform*vec4(position*scale,0.));
      }
    `,fragmentShader:`
      varying float age;varying float seed;varying vec3 puffPoint;varying vec3 puffEye;
      uniform sampler2D flow;uniform float clock;
      void main(){
        vec3 dir=normalize(puffPoint-puffEye);
        float b=dot(dir,puffPoint),disc=b*b+.25-dot(puffPoint,puffPoint);
        if(disc<=0.)discard;
        float travel=max(0.,-b+sqrt(disc)),ds=travel/7.;
        vec3 p=puffPoint+dir*ds*.5;
        float mass=0.;
        for(int i=0;i<7;i++){
          vec3 n=texture2D(flow,p.xz*.83+vec2(seed*.29+p.y*.21,-p.y*.47-clock*.028)).rgb;
          float radial=length(p+vec3(n.g-.48,n.b-.48,n.r-.48)*.26);
          mass+=(1.-smoothstep(.13,.47,radial))*smoothstep(.23,.68,n.r+.17*n.b)*ds;
          p+=dir*ds;
        }
        float a=(1.-exp(-mass*.43))*sin(age*3.14159);
        if(a<.004)discard;
        gl_FragColor=vec4(mix(vec3(.24,.22,.194),vec3(.46,.47,.46),age),a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `});
  const smokeCount=17,smokeGeometry=new T.IcosahedronGeometry(.5,2);
  const ages=new T.InstancedBufferAttribute(new Float32Array(smokeCount),1),phases=new T.InstancedBufferAttribute(new Float32Array(smokeCount),1);
  for(let i=0;i<smokeCount;i++)phases.setX(i,i*2.39996);
  smokeGeometry.setAttribute('life',ages);smokeGeometry.setAttribute('phase',phases);
  const smoke=new T.InstancedMesh(smokeGeometry,smokeMaterial,smokeCount);smoke.frustumCulled=false;smoke.renderOrder=6;group.add(smoke);

  const emberCount=26,emberGeometry=new T.TetrahedronGeometry(1);
  const embers=new T.InstancedMesh(emberGeometry,new T.MeshBasicMaterial({color:0xffffff,toneMapped:false}),emberCount);
  embers.frustumCulled=false;group.add(embers);
  const coalMat=new T.MeshStandardMaterial({color:0x321d15,roughness:.98,emissive:0xff4e07,emissiveIntensity:.22});
  const coals=new T.InstancedMesh(new T.IcosahedronGeometry(1,1),coalMat,24),pose=new T.Object3D(),color=new T.Color();
  for(let i=0;i<24;i++){
    const a=2.39996*i,r=.32*Math.sqrt((i+.5)/24);pose.position.set(r*Math.cos(a),.098+.018*Math.sin(18*i),r*Math.sin(a));
    pose.rotation.set(i,i*5,i*.4);pose.scale.set(.047+.015*Math.sin(i*12),.020,.036);pose.updateMatrix();coals.setMatrixAt(i,pose.matrix);
    coals.setColorAt(i,color.setScalar(.45+.3*Math.sin(i*3.4)));
  }
  group.add(coals);
  light.position.set(.04,.51,-.02);
  return function update(t,camera,wx,wz){
    wind.set(wx,wz);camera.getWorldPosition(eye);furnace.worldToLocal(eye);
    material.uniforms.clock.value=t;smokeMaterial.uniforms.clock.value=t;
    const flicker=.59*Math.sin(17.3*t+1.6*Math.sin(t*4.7))+.29*Math.sin(29.1*t)+.12*Math.sin(53.4*t);
    light.intensity=5.4+.85*flicker;light.position.x=.032*Math.sin(t*3.1);light.position.y=.51+.042*flicker;
    coalMat.emissiveIntensity=.22+.055*Math.sin(.91*t)+.021*flicker;
    for(let i=0;i<smokeCount;i++){
      const a=(t*.274+i/smokeCount)%1,seed=i*2.39996;
      pose.position.set(.06*Math.cos(seed)+wx*a*a*1.17+.17*a*Math.cos(seed+a*6+t*.31),.55+a*2.65,
        .06*Math.sin(seed)+wz*a*a*1.17+.18*a*Math.sin(seed+a*4+t*.27));
      pose.rotation.set(0,0,0);pose.scale.setScalar(1);pose.updateMatrix();smoke.setMatrixAt(i,pose.matrix);ages.setX(i,a);
    }
    ages.needsUpdate=true;smoke.instanceMatrix.needsUpdate=true;
    for(let i=0;i<emberCount;i++){
      const a=(t*(.46+.06*Math.cos(i))+i/emberCount)%1,s=i*2.39996;
      const rise=.45+.7*(.5+.5*Math.sin(i*14.11));const rad=.02+.16*a;
      pose.position.set(.12*Math.sin(s)+rad*Math.sin(5*a+s)+wx*a*a*.54,.20+rise*(1-Math.exp(-a*2.75)),
        .10*Math.cos(s)+rad*Math.cos(3*a+s)+wz*a*a*.54);
      const size=.0029*(1+.45*Math.sin(i*7))*Math.sin(Math.PI*a)**.32;
      pose.scale.set(size,size*(1.6+.5*Math.sin(s+a)),size);pose.rotation.set(a,0,s+2*a);pose.updateMatrix();embers.setMatrixAt(i,pose.matrix);
      embers.setColorAt(i,color.setRGB(2.2,1.15*(1-a)**1.7+.07,.15*(1-a)**2));
    }
    embers.instanceColor.needsUpdate=true;embers.instanceMatrix.needsUpdate=true;
  };
}
