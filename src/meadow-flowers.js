// Flowering clumps on the dry meadow bank. Each line gives metres, uniform
// plant scale and heading. The taller indigo spikes follow the near grass edge.
const colonies={
  LupineSpike:[
    [10.65,-35.88,1.09,2.4],[11.16,-35.91,1.02,4.9],[11.62,-35.74,1.07,.8],
    [12.13,-35.88,1.14,5.4],[12.28,-35.78,.98,1.6],[12.57,-35.79,1.02,3.0],
    [7.25,-40.15,.94,.3],[8.43,-39.47,.84,1.4],[6.36,-40.78,.65,2.9],
  ],
  LupineRose:[[13.51,-35.61,.80,2.4],[13.80,-35.47,.71,4.7]],
  MeadowCinquefoil:[[10.88,-36.39,1.02,2.5],[11.42,-36.09,.85,5.7],[13.86,-35.45,.71,.9],[15.52,-36.23,.84,2.6]],
  Yarrow:[[9.93,-37.40,.82,.56],[8.65,-38.65,.79,4.2],[12.63,-36.63,.78,1.3],[13.68,-33.14,.93,4.8]],
  Bluebell:[[8.77,-36.41,1.04,4.5],[9.53,-35.90,.92,2.5],[7.84,-38.09,.98,4.4]],
  Paintbrush:[
    [15.73,-35.88,.82,1.2],[16.15,-36.24,.82,3.5],[16.51,-36.52,.91,4.1],[16.93,-36.59,.76,2.8],
    [17.24,-36.81,.88,2.4],[17.56,-37.03,.77,5.8],[17.78,-36.83,.90,.2],[18.18,-37.14,.81,4.7],
  ],
  Lupine:[[15.26,-36.60,.88,4.3],[15.15,-37.22,.85,3.0],[16.03,-37.52,.83,1.3],[17.56,-37.87,.84,5.4]],
};

// The narrow grassy bank below the flowering stems stays open between the path and the drift.
export function meadowGrassOpening(x,z){
  return ((x-11.55)/1.15)**2+((z+34.49)/.93)**2<1;
}

export function plantMeadowFlowers(px,pz,land,openGround,emitFlower,groundTint,radius=45){
  for(const [species,plants] of Object.entries(colonies)){
    for(const [x,z,scale,heading] of plants){
      const range=Math.hypot(x-px,z-pz);
      if(range>radius || !openGround(x,z))continue;
      const pigment=groundTint(x,z,true);
      if(species==='Bluebell'){
        pigment.r*=.10;pigment.g*=.21;pigment.b*=.65;
      }
      emitFlower(species,x,land.height(x,z)-.012,z,heading,scale,pigment);
    }
  }
}
