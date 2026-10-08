# XG-SPBT Engine

> **Sample-Point Beam Tracing (SPBT)** — a fast ray-tracing method for 2D optics games.

---

## Introduction

SPBT Engine is the ray-tracing engine used in this project. Instead of tracing every ray inside a beam, it:

1. Uses **sample points** to split a parallel beam into **sub-beams**;
2. Traces only the **boundary rays** of each sub-beam;
3. Reconstructs the full beam path using the **linearity** of planar elements.

Result: **no approximation error in purely planar chains, and cost independent of beam width.**

### Why it matters

Traditional per-ray tracing scales with beam width:

| Beam width | Ray count | Cost  |
| ---------- | --------- | ----- |
| Narrow     | Few       | Low   |
| Wide       | Many      | High  |

In a 2D optics game, players often drag out very wide beams. Per-ray tracing makes the framerate drop linearly. SPBT reduces the cost from "proportional to beam width" to "proportional to sample-point count", **so as long as the sample-point set is unchanged**, a wider beam costs nothing extra.

---

## Core Concepts

### Beam

A set of rays with identical direction and continuous lateral distribution.

- **Axis direction `d`**: the common propagation direction of all rays in the beam
- **Lateral range `[s_left, s_right]`**: the beam's width interval perpendicular to `d`
- **Boundary rays**: the two rays at lateral positions `s_left` and `s_right`

### Sample Point

A position on each element in the scene that has geometric or optical significance.

| Element shape                                        | Sample points                     |
| ---------------------------------------------------- | --------------------------------- |
| Triangle, quad, regular n-gon, polar polygon         | Every vertex                      |
| Circle                                               | Vertices of the discretized polygon |
| Line                                                 | Both endpoints                    |
| SVG path                                             | Vertices of the discretized polyline |
| Target                                               | Center                            |
| Light source                                         | Not included (avoids self-excitation) |

### Core Proposition

> **Propagation of a parallel beam through planar elements is a linear map.**
>
> That is, the lateral coordinate `s` becomes `s'` after reflection/refraction, where `s'` is a linear function of `s`, and every ray in the beam shares the same reflection and refraction angles.

**Corollary**: in a path containing only planar elements, the path of any ray in the beam can be obtained by linear interpolation between the two boundary rays.

### Beam Splitting

Let the beam direction be `d`, the perpendicular be `p`, and the beam origin be `O`. For any sample point `P`:

```
s(P) = (P - O) · p
```

If `s(P) ∈ [s_left, s_right]` and `(P - O) · d > 0`, then `P` lies inside the beam and generates a **split point**.

Sorting and deduplicating all split points gives `s_0 < s_1 < ... < s_n`. Each sub-interval `[s_i, s_{i+1}]` is called a **sub-beam**. Inside each sub-beam:

- No sample points exist;
- All rays hit the same sequence of elements;
- The optical path is linearly consistent.

---

## Installation

```html
<script src="XG-SPBT-engine.js"></script>
```

In a browser, the library is exposed as the global `XGSPBT`; under Node.js it is available via `require`.

```js
// Browser
const { createEngine } = window.XGSPBT;

// Node.js
const { createEngine } = require('./XG-SPBT-engine.js');
```

---

## Quick Start

```js
const engine = createEngine({ width: 800, height: 600 });

// Parallel light
engine.addParallelLight(100, 300, 0, { width: 200, isWhite: true });

// Mirror
engine.addMirror(450, 300, Math.PI / 4, 200);

// Glass
engine.addGlass(600, 300, 100, 100, { n: 1.5 });

// Trace the parallel beam
const beams = engine.traceBeam(engine.elements[0]);
```

---

## API

### Engine Creation

#### `createEngine(opts)`

Creates a new SPBT engine instance.

| Option                | Type      | Default | Description                     |
| --------------------- | --------- | ------- | ------------------------------- |
| `opts.width`          | `number`  | `800`   | Canvas width                    |
| `opts.height`         | `number`  | `600`   | Canvas height                   |
| `opts.canvas`         | `HTMLCanvasElement` | — | If provided, binds a 2D context automatically |
| `opts.maxDepth`       | `number`  | `16`    | Maximum reflection/refraction depth |
| `opts.maxSubBeams`    | `number`  | `256`   | Maximum sub-beam count          |
| `opts.mergeEpsilon`   | `number`  | `0.5`   | Merge threshold for split points |
| `opts.debug`          | `boolean` | `false` | Debug mode                      |

Returns a `PrismEngine` instance.

```js
const engine = createEngine({
    width: 1024,
    height: 768,
    canvas: document.getElementById('cv'),
    maxDepth: 24,
});
```

---

### Element Factories

All elements are created via the `engine.add*` family; each is appended to `engine.elements` automatically.

#### `engine.addMirror(x, y, angle, length)`

Adds a flat mirror (full reflection).

| Parameter | Type     | Description               |
| --------- | -------- | ------------------------- |
| `x, y`    | `number` | Mirror center coordinates |
| `angle`   | `number` | Mirror orientation (radians) |
| `length`  | `number` | Mirror length             |

#### `engine.addGlass(x, y, w, h, opts)`

Adds a rectangular glass block (refraction). `opts.n` sets the refractive index, default `1.5`.

#### `engine.addWater(x, y, w, h, opts)`

Adds a rectangular water block (refraction). `opts.n` defaults to `1.33`, `opts.kMedium` is the bulk absorption coefficient, `opts.isMilky` toggles milky water.

#### `engine.addPrism(cx, cy, size, angle, opts)`

Adds a triangular prism. `opts.n` defaults to `1.5`.

#### `engine.addLens(cx, cy, length, angle, focalLength, opts)`

Adds a thin lens. `focalLength > 0` is convex, `< 0` is concave.

#### `engine.addSphericalMirror(cx, cy, aperture, angle, focalLength, opts)`

Adds a spherical mirror. `focalLength > 0` is concave, `< 0` is convex.

#### `engine.addParabolicMirror(cx, cy, aperture, angle, focalLength, opts)`

Adds a parabolic mirror (analytic parabola intersection, ideal focusing).

#### `engine.addThickLens(cx, cy, aperture, angle, thickness, ior, opts)`

Adds a thick lens (two circular surfaces, two refractions).

#### `engine.addObstacle(x, y, w, h)`

Adds an obstacle (fully absorbing).

#### `engine.addTarget(x, y, radius)`

Adds a target. When a ray hits it, `el.lit = true`.

#### `engine.addFluorescent(x, y, radius, opts)`

Adds a fluorescent substance. When hit, it re-emits toward every sample point.

| Option                     | Default | Description                     |
| -------------------------- | ------- | ------------------------------- |
| `opts.absorbMin`           | `380`   | Minimum absorbable wavelength   |
| `opts.absorbMax`           | `780`   | Maximum absorbable wavelength   |
| `opts.intensityThreshold`  | `0.05`  | Minimum intensity to trigger fluorescence |
| `opts.emitBoost`           | `1.0`   | Emission intensity multiplier   |
| `opts.maxRays`             | `64`    | Maximum number of re-emitted rays |

---

### Light Factories

#### `engine.addLight(x, y, angle, opts)`

Adds a point light (single center ray).

#### `engine.addParallelLight(x, y, angle, opts)`

Adds a parallel beam.

| Option            | Type     | Default     | Description             |
| ----------------- | -------- | ----------- | ----------------------- |
| `opts.width`      | `number` | `160`       | Beam width              |
| `opts.color`      | `string` | `'#ffffff'` | Color                   |
| `opts.intensity`  | `number` | `1.0`       | Intensity               |
| `opts.isWhite`    | `boolean`| `false`     | Whether it is white light (dispersion) |

---

### Tracing

#### `engine.traceBeam(light, opts)`

**Main SPBT interface.** Traces one parallel beam and returns an array of sub-beams.

```js
const beams = engine.traceBeam(parallelLight);
for (const sb of beams) {
    console.log(sb.sLeft, sb.sRight, sb.leftPath, sb.rightPath);
}
```

Each sub-beam object contains:

| Field        | Description                             |
| ------------ | --------------------------------------- |
| `sLeft`      | Left boundary lateral coordinate        |
| `sRight`     | Right boundary lateral coordinate       |
| `leftStart`  | Start point of the left boundary ray    |
| `rightStart` | Start point of the right boundary ray   |
| `leftSegs`   | Left boundary ray segments (with hit info) |
| `rightSegs`  | Right boundary ray segments             |
| `leftPath`   | Path points of the left boundary ray    |
| `rightPath`  | Path points of the right boundary ray   |

`opts.onHit` is an optional callback invoked on every element hit.

#### `engine.traceRay(start, dir, opts)`

Traces a single ray and returns the path points.

#### `engine.getBeamCuts(light)`

Returns all split points (lateral coordinates) for that beam in the current scene.

#### `engine.getAllSamples()`

Returns every sample point in the scene as `{ x, y, element }`.

#### `engine.testHit(light, target, radius)`

Returns whether the beam hits the target.

---

### Rendering & Update

#### `engine.update()`

Runs a full scene trace, writes the result into `engine.segments`, and resets every target's `lit` flag.

#### `engine.render(ctx)`

Renders the current `engine.segments` onto a 2D context. Includes:

- Grid background
- Every element's `draw()`
- Ordinary rays (per-ray)
- Parallel beams (grouped by `beamId`, filled polygon + edge stroke)
- Optional normal dashed lines

#### `engine.clear()`

Clears all elements and segments.

#### `engine.pickAt(mx, my)`

Returns the element at the given mouse coordinates, or `null`.

#### `engine.allTargetsLit()`

Returns whether every target is lit.

#### `engine.getSegments()`

Returns all current segments.

---

### Scene Builder

Chained API for quick scene setup:

```js
const engine = createEngine({ width: 800, height: 600 });

engine.scene()
    .parallelLight(100, 300, 0, { width: 200, isWhite: true })
    .mirror(450, 300, Math.PI / 4, 200)
    .glass(600, 300, 100, 100, { n: 1.5 })
    .prism(700, 400, 60, 0, { n: 1.5 })
    .target(750, 450, 16)
    .done();
```

Available methods:

| Method                                 | Corresponds to          |
| -------------------------------------- | ----------------------- |
| `.mirror(x, y, a, l)`                  | `addMirror`             |
| `.glass(x, y, w, h, o)`                | `addGlass`              |
| `.water(x, y, w, h, o)`                | `addWater`              |
| `.obstacle(x, y, w, h)`                | `addObstacle`           |
| `.light(x, y, a, o)`                   | `addLight`              |
| `.parallelLight(x, y, a, o)`           | `addParallelLight`      |
| `.target(x, y, r)`                     | `addTarget`             |
| `.fluorescent(x, y, r, o)`             | `addFluorescent`        |
| `.prism(cx, cy, s, a, o)`              | `addPrism`              |
| `.lens(cx, cy, len, a, f, o)`          | `addLens`               |
| `.sphericalMirror(cx, cy, ap, a, f, o)`| `addSphericalMirror`    |
| `.parabolicMirror(cx, cy, ap, a, f, o)`| `addParabolicMirror`    |
| `.thickLens(cx, cy, ap, a, t, ior, o)` | `addThickLens`          |
| `.done()`                              | Returns the `engine`    |

---

### Utility Functions

#### `interpolateBeam(subBeam, t)`

Interpolates a ray path inside a sub-beam by parameter `t ∈ [0, 1]`.

```js
const midPath = XGSPBT.interpolateBeam(beams[0], 0.5);
```

#### `getBeamPaths(engine, light)`

Equivalent to `engine.traceBeam(light)`.

#### `traceAllBeams(engine, opts)`

Traces every parallel beam in the scene and returns `[{ light, subBeams }]`.

---

### Top-Level Exports

The `XGSPBT` object exposes:

| Export                | Description                    |
| --------------------- | ------------------------------ |
| `Engine`              | `PrismEngine` constructor      |
| `V`                   | 2D vector utilities            |
| `createEngine`        | Engine factory                 |
| `SceneBuilder`        | Scene builder                  |
| `interpolateBeam`     | Sub-beam interpolation         |
| `getBeamPaths`        | Beam path extraction           |
| `traceAllBeams`       | Batch tracing                  |
| `makeMirror`          | Flat mirror factory            |
| `makeGlass`           | Glass factory                  |
| `makeWater`           | Water factory                  |
| `makeLens`            | Lens factory                   |
| `makeSphericalMirror` | Spherical mirror factory       |
| `makeParabolicMirror` | Parabolic mirror factory       |
| `makeThickLens`       | Thick lens factory             |
| `makePrism`           | Prism factory                  |
| `makeObstacle`        | Obstacle factory               |
| `makeLight`           | Point light factory            |
| `makeParallelLight`   | Parallel light factory         |
| `makeTarget`          | Target factory                 |
| `makeFluorescent`     | Fluorescent factory            |
| `version`             | Engine version                 |

---

## Physical Model

Materials have four optical parameters:

| Parameter                  | Meaning              | Role                              |
| -------------------------- | -------------------- | --------------------------------- |
| `n` (refractiveIndex)      | Refractive index     | Determines refraction direction (Snell's law) |
| `reflectivity`             | Surface reflectance R| Added on top of Fresnel reflection |
| `absorptivity`             | Surface absorptance A| Direct absorption                 |
| `opacity`                  | Bulk absorption α    | Beer–Lambert attenuation          |

Energy conservation:

```
R + A + T = 1
T = 1 - R - A
```

- **Fresnel equations**: given incidence angle and both refractive indices, they yield the reflectance/transmittance ratio;
- **Beer–Lambert law**: `exp(-αd)`, attenuation after propagating a distance d inside the medium;
- **Energy conservation**: if `R + A > 1`, both R and A are scaled down proportionally.

The engine includes a built-in dispersion table `SPECTRUM` (red → violet, 400–700 nm); white light is split into 7 bands when it passes through glass or a prism.

---

## Accuracy

| Element           | Method                            | Accuracy                             |
| ----------------- | --------------------------------- | ------------------------------------ |
| Planar elements   | Linear mapping + boundary rays    | No approximation error in planar chains |
| Circles           | Discretized into polygons + boundary rays | Determined by discretization |
| SVG curves        | Discretized into polylines + boundary rays | Determined by discretization |
| Sphere / parabola | Analytic intersection + true normals | Analytic precision                |
| Fluorescent       | Discrete emission toward sample points | Discrete sampling approximation |

**Note**: for curved elements (circles, SVG curves), when reconstructing a sub-beam, the average of the two endpoint directions is used as the new beam direction, which is an approximation.

---

## Complexity

| Step                              | Complexity          |
| --------------------------------- | ------------------- |
| Splitting (sorting sample points) | O(N log N)          |
| Sub-beam tracing (boundary rays)  | O(N × M)            |
| Total                             | O(N log N + N × M)  |

where N = number of sample points and M = number of elements.

**Key property**: as long as the sample-point set is unchanged, cost is independent of beam width.

---

## Comparison with Per-Ray Tracing

| Aspect                | Per-Ray Tracing          | SPBT          |
| --------------------- | ------------------------ | ------------- |
| Ray count             | Proportional to beam width | O(sample points) |
| Planar element accuracy | Exact                  | Exact         |
| Curved element accuracy | Exact (if analytic)    | Controlled approximation |
| Beam-width scaling    | Linear growth            | No growth     |
| Implementation complexity | Low                  | Medium        |
| Visual style          | Discrete lines           | Continuous beams |

**When to use**:

- Wide beams, many elements, mostly planar levels → SPBT wins
- Sparse rays, mostly curved elements, extreme precision → per-ray tracing is simpler

---

## Full Example

```js
const engine = createEngine({ width: 1000, height: 700, canvas: cv });

// White parallel beam
const light = engine.addParallelLight(100, 350, 0, {
    width: 240,
    isWhite: true,
    intensity: 1.0,
});

// Prism (dispersion)
engine.addPrism(500, 350, 80, 0, { n: 1.5 });

// Parabolic mirror (focusing)
engine.addParabolicMirror(800, 350, 160, Math.PI, 120);

// Target
engine.addTarget(850, 350, 12);

// Per-ray trace + render
engine.update();
engine.render(engine.ctx);

// Or use the SPBT interface to get beams
const beams = engine.traceBeam(light);
console.log(`${beams.length} sub-beams`);
```

---

## Known Limitations

- **Curved elements**: circles and SVG curves are discretized into polylines and traced with boundary rays, so sub-beam reconstruction is approximate;
- **Fluorescent substances**: they emit toward every sample point, which is costly when there are many sample points; capped by `maxRays`;
- **Beam width**: if a wider beam brings more elements inside, sample-point count grows and so does cost;
- **Split branching**: sub-beams crossing element boundaries are re-split, which can recurse deeply in extreme cases;
- **2D only**: only 2D is supported for now; 3D requires a new derivation.

---

## TL;DR

SPBT uses sample points to split a parallel beam into sub-beams, each of which is linearly consistent, so only the boundary rays of each sub-beam need to be traced to reconstruct the entire beam path. There is no approximation error in purely planar chains, and **as long as the sample-point set is unchanged**, cost is independent of beam width.

---

## License

GNU Affero General Public License v3.0

```
Sample-Point Beam Tracing Engine (SPBTE)
Copyright (C) 2026 XGstudio
```

---

## References

- Source code: `XG-SPBT-engine.js`
- Theory document: `XG-SPBTE.md`
- Level definition: `prism-game.js`
