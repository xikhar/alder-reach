# Alder Reach

A first-person woodland game for desktop mouse and keyboard, built with Three.js and Vite. Walk the birch trail, watch the meadow herd, work timber at the creek camp, fish for brook trout, and follow the wildflowers to the river overlook.

**[Play in the browser](https://xikhar.github.io/alder-reach/)**

## Run locally

Use Node.js 22.12 or newer.

```sh
npm ci
npm run dev
```

Open the address printed by Vite. To build a release, run `npm run build`. To serve that build, run `node scripts/play.mjs` and open its printed address; on Windows, double-click **Play Alder Reach.cmd** instead.

## In the field

| Input | Action |
| --- | --- |
| WASD / Shift / Space | Walk, sprint, jump |
| Mouse / arrow keys | Look around |
| 1 / 2 / 3 | Equip bow, axe, fishing rod |
| Left mouse | Hold and release bow, swing axe, cast or hook fish |
| E | Recover arrow, lift, drop, stack, build fire or cook |
| G | Open the field guide, travel to landmarks or change sound and time of day |
| H / Esc | Hide the HUD / release the mouse |

**Timber.** Pick a nearby tree. Follow the cut prompts, then move around the tree for the back cut. Buck the fallen trunk near its base. Carry rounds to the chopping block, split them, and stack three pieces at the rack. Build the fire at the stone ring. One starter round lies beside the block.

**Fishing.** Cast into visible water. Click when the float bites. Hold to reel and ease off before the line tension peaks. Bring the fish to a lit fire and press E to cook it.

**Wildlife.** At Deer Meadow, approach slowly to watch the herd graze. An alert doe turns her head toward the visitor, and a closer approach sends her bounding away. Deer, hares and birds keep moving when you leave the clearing. Trout swim along the creek, approach the fly and return to their patrol after an escape.

All sound is synthesized in Web Audio. Ground scan credits are in [public/art/earth/SOURCES.md](public/art/earth/SOURCES.md).
