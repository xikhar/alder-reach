import {talusCover} from './talus.js';
/* Alpine terraces exposed by the former valley glacier. Coordinates are in metres
   on the shared collision mesh. The same moraine and drainage geometry steers the spruce stands. */
const saturate = value => Math.max(0, Math.min(1, value));
function shoulder(x, z, cx, cz, breadth, depth, skew) {
  const east = (x - cx) / breadth;
  const north = (z - cz - (x - cx) * skew) / depth;
  return Math.exp(-east * east - north * north);
}

// Alluvial strath inside the eastern meander. The abandoned channel cut
// through the end moraine before the river migrated to its present bed.
export function innerTerrace(x,z) {
  if(z> -625||z< -1180)return 0;
  return shoulder(x,-z,241,865,154,112,.18);
}

// A former flood chute cuts the southern end of the western moraine. Young
// trees are recolonising its damp floor above the active channel.
export function floodChute(x,z) {
  if(z> -333||z< -774)return 0;
  return shoulder(x,-z,-140,539,83,90,-.36);
}

// Ice and later high water planed off the toe of the western alluvial
// terrace. The older spur survives immediately east of this wet grass strath.
export function westernStrath(x,z) {
  if(z> -1440||z< -2780)return 0;
  const cut=shoulder(x,-z,-389,2020,163,311,-.63);
  return Math.min(1,cut*1.42);
}

export function terraceRelief(x, z, bank) {
  if (z < -1670) {
    // A last pair of blue foothills frames the gorge upstream of the visible oxbows.
    const back = shoulder(x, -z, -440, 2930, 525, 198, -.21);
    const front = shoulder(x, -z, 342, 2700, 376, 187, .23);
    const spur = shoulder(x, -z, -92, 2490, 210, 172, -.27);
    const saddle = shoulder(x, -z, -34, 2110, 290, 240, .17);
    const brow = .94 + .06 * Math.cos(x * .014 + z * .0012);
    const ravine = saturate((bank - 25) / 155);
    const approach = saturate((-z - 1670) / 130);
    return approach * approach * (3 - 2 * approach) * (151 * back + 139 * front + 85 * spur + 119 * saddle) * brow * ravine * ravine * (3 - 2 * ravine);
  }
  if (z > -138) return 0;
  const d = -z;
  // A pair of lateral moraines overlaps behind the exposed grass rim.
  const west = shoulder(x, d, -283, 405, 286, 67, -.33);
  const east = shoulder(x, d, 218, 453, 204, 75, .44);
  const rim = shoulder(x, d, 27, 264, 155, 36, -.09);
  const grassBrow = shoulder(x, d, 46, 220, 147, 18, .10);
  const bluff = shoulder(x, d, -206, 770, 181, 93, .48);
  const outer = shoulder(x, d, 377, 861, 262, 136, -.34);
  const runnel = shoulder(x, d, -67, 467, 155, 28, .24);
  const creek = saturate((bank - 13) / 93);
  return creek * creek * (3 - 2 * creek) * (30 * west + 22 * east + 10 * rim + 3.2 * grassBrow + 19 * bluff + 29 * outer - 5 * runnel);
}

export function terraceWoodland(x, z, bank, broad, fine) {
  const d = -z;
  // Spruce occupies the shaded sides of oblique spurs. Their broad open backs
  // interlock with narrower copses where meltwater runs down onto the flat.
  const warp = (broad - .5) * 53 + (fine - .5) * 17;
  const lean = .30 * x + 17 * Math.sin(.010 * x);
  const west = shoulder(x, d + warp, -244, 395, 310, 39, -.34);
  const east = shoulder(x, d - warp, 221, 431, 245, 49, .45);
  const fringe = shoulder(x, d + warp, -88, 564, 253, 37, -.45);
  const wash = shoulder(x, d - warp, 12, 539, 234, 38, .41);
  const thicket = shoulder(x, d + warp, -242, 738, 264, 53, .44);
  const rib = Math.sin((d + lean + warp) * .031 + 1.1 * Math.sin(.008 * x - .006 * d));
  const toe = shoulder(x, d - warp, -147, 277, 146, 29, -.27);
  const fan = shoulder(x, d + warp, 123, 327, 167, 30, .46);
  const gully = shoulder(x, d + warp, -41, 385, 104, 44, .46);
  const pocket = Math.max(west * .90, east * .91, fringe * .82, wash * .86, thicket * .85, toe * .83, fan * .80);
  // The shaded flanks carry a continuous spruce apron. Two narrow openings
  // descend from the grazing shelf and merge with the broader alluvial flat.
  const westFoot = shoulder(x,d+warp,-232,332,200,97,-.38);
  const eastFoot = shoulder(x,d-warp,161,364,156,112,.48);
  const westWall = shoulder(x,d+warp,-354,662,276,308,-.40);
  const eastWall = shoulder(x,d-warp,345,749,268,369,.64);
  const spur = shoulder(x,d+warp,-3,306,97,25,-.16);
  const clearing = shoulder(x,d+warp,-64,364,37,87,-.25)
                 + .72*shoulder(x,d-warp,72,473,44,103,.32);
  const fringeNoise=.83+.36*(fine-.43)+.23*(broad-.47);
  const apron=Math.max(westFoot,eastFoot,westWall,eastWall,spur*.89)*fringeNoise-clearing*.22;
  const talus = saturate((Math.abs(x) - 235) / 315);
  const corrie = .35 + .59 * (broad - .49) + .46 * (fine - .50) + .19 * rib + talus * .30;
  const wooded = saturate((Math.max(pocket * (.93 + .4 * (fine - .4)), corrie,apron*1.35) - .28 - gully * .26) / .47);
  const riparian = saturate((bank - 8) / 28);
  return wooded * wooded * (3 - 2 * wooded) * riparian;
}

export function terracePigment(x, z, canopy, light, grains) {
  const d = -z;
  const crest = shoulder(x, d, 39, 267, 182, 23, -.10);
  const brow = shoulder(x, d, 53, 220, 166, 24, .10);
  const sunward=shoulder(x,d,24,231,118,9,.067);
  const warm = Math.max(crest * .76, brow);
  const larch = .50 + .50 * Math.sin(d * .017 + x * .005 + 3.1 * light);
  const sun = .73 + .44 * light + .09 * grains;
  const openness = Math.pow(1 - canopy, .62);
  const turf = (a, b, c) => (a + b * larch + c * warm) * sun;
  const soil = [
    .023 + openness * (turf(.079, .026, .119)+.40*sunward - .023),
    .049 + openness * (turf(.117, .021, .022)+.118*sunward - .049),
    .073 + openness * (turf(.104, -.012, -.018)+.014*sunward - .073)
  ];
  // Angular scree grades outward into pale glacial fines on the same terrain.
  const cover=talusCover(x,z);
  const weathering=cover*(.48+.35*grains)*(.72+.28*(1-canopy));
  const mineral=[.152+.034*light,.155+.027*light,.146+.028*grains];
  return soil.map((c,k)=>c+(mineral[k]-c)*weathering);
}
