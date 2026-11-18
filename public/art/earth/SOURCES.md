# Ground scan sources

These four maps use CC0 surface scans from Poly Haven. The game ships the derived maps locally. Each 1024 × 1024 PNG carries relative albedo, two tangent-space slopes and warm/cool pigment variation for the Three.js and Blender materials.

| Local map | Scan | Creator |
| --- | --- | --- |
| woodland-floor.png | [Forest Leaves 04](https://polyhaven.com/a/forest_leaves_04) | Rob Tuytel |
| meadow-floor.png | [Withered Grass](https://polyhaven.com/a/withered_grass) | Charlotte Baglioni |
| trail-floor.png | [Stony Dirt Path](https://polyhaven.com/a/stony_dirt_path) | eye-candy.xyz |
| shingle-floor.png | [River Small Rocks](https://polyhaven.com/a/river_small_rocks) | Rob Tuytel and Rico Cilliers |

Run `python scripts/bake-earth.py` from the project to rebuild the maps. The authoring script uses NumPy, SciPy and Pillow. [Poly Haven asset license](https://polyhaven.com/license)
