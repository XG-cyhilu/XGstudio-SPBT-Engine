# XG-SPBT Engine

> **采样点光带追踪（Sample-Point Beam Tracing）** —— 一种面向二维光学游戏的快速光线追踪方法。

---

## 简介

SPBT Engine 是本项目使用的光线追踪引擎。它不逐条追踪光带内的每一条光线，而是：

1. 用**采样点**把平行光带切分成若干**子光带**；
2. 在每个子光带内，只追踪**边界光线**；
3. 利用平面元件的**线性性**，重建整个光带的光路。

结果：**在纯平面元件链路中无近似误差，计算量与光带宽度无关。**

### 为什么需要它

传统的逐条光线追踪，光带越宽，需要追踪的光线越多：

| 光带宽度 | 光线数 | 计算量 |
| -------- | ------ | ------ |
| 窄       | 少     | 低     |
| 宽       | 多     | 高     |

在二维光学游戏里，玩家经常拖出很宽的光带。逐条追踪会让帧率线性下降。SPBT 把计算量从「与光带宽度成正比」降到「与采样点数量成正比」，**在采样点集合不变的前提下**，光带再宽也不增加开销。

---

## 核心概念

### 光带（Beam）

一束方向相同、横向连续分布的光线。

- **光轴方向 `d`**：光带内所有光线的共同传播方向
- **横向范围 `[s_left, s_right]`**：光带在垂直于 `d` 方向上的宽度区间
- **边界光线**：横向位置为 `s_left` 和 `s_right` 的两条光线

### 采样点（Sample Point）

场景中每个元件上具有几何或光学意义的位置点。

| 元件形状                                | 采样点               |
| --------------------------------------- | -------------------- |
| 三角形、四边形、正 n 边形、极坐标多边形 | 每个顶点             |
| 圆                                      | 离散后的多边形顶点   |
| 线                                      | 两个端点             |
| SVG 路径                                | 离散后的折线顶点     |
| 目标点                                  | 中心                 |
| 光源                                    | 不参与（避免自激发） |

### 核心命题

> **平行光带在平面元件上的传播是线性映射。**
>
> 即：光带横向坐标 `s` 经过反射/折射后得到 `s'`，`s'` 是 `s` 的线性函数，且光带内所有光线的反射角、折射角相同。

**推论**：在只经过平面元件的光路中，光带内任意一条光线的路径，都可以由两条边界光线线性插值得到。

### 光带的切分

设光带方向为 `d`，垂直方向为 `p`，光带起点为 `O`。对任意采样点 `P`：

```
s(P) = (P - O) · p
```

若 `s(P) ∈ [s_left, s_right]` 且 `(P - O) · d > 0`，则 `P` 在光带内，产生一个**切分点**。

将所有切分点按 `s` 排序、去重，得到 `s_0 < s_1 < ... < s_n`。每个子区间 `[s_i, s_{i+1}]` 称为一个**子光带**。在每个子光带内部：

- 没有任何采样点；
- 所有光线遇到相同的元件序列；
- 光路是线性一致的。

---

## 安装与引入

```html
<script src="XG-SPBT-engine.js"></script>
```

浏览器环境下会挂载到全局对象 `XGSPBT`；Node.js 环境下通过 `require` 引入。

```js
// 浏览器
const { createEngine } = window.XGSPBT;

// Node.js
const { createEngine } = require('./XG-SPBT-engine.js');
```

---

## 快速开始

```js
const engine = createEngine({ width: 800, height: 600 });

// 平行光
engine.addParallelLight(100, 300, 0, { width: 200, isWhite: true });

// 镜子
engine.addMirror(450, 300, Math.PI / 4, 200);

// 玻璃
engine.addGlass(600, 300, 100, 100, { n: 1.5 });

// 追踪平行光带
const beams = engine.traceBeam(engine.elements[0]);
```

---

## API

### 引擎创建

#### `createEngine(opts)`

创建一个新的 SPBT 引擎实例。

| 参数            | 类型      | 默认值 | 说明                     |
| --------------- | --------- | ------ | ------------------------ |
| `opts.width`    | `number`  | `800`  | 画布宽度                 |
| `opts.height`   | `number`  | `600`  | 画布高度                 |
| `opts.canvas`   | `HTMLCanvasElement` | — | 若提供，自动绑定 2D 上下文 |
| `opts.maxDepth` | `number`  | `16`   | 最大反射/折射深度        |
| `opts.maxSubBeams` | `number` | `256` | 最大子光带数量         |
| `opts.mergeEpsilon` | `number` | `0.5` | 切分点合并阈值        |
| `opts.debug`    | `boolean` | `false`| 调试模式                 |

返回值为 `PrismEngine` 实例。

```js
const engine = createEngine({
    width: 1024,
    height: 768,
    canvas: document.getElementById('cv'),
    maxDepth: 24,
});
```

---

### 元件工厂

所有元件通过 `engine.add*` 系列方法创建，创建后自动加入 `engine.elements`。

#### `engine.addMirror(x, y, angle, length)`

添加平面镜（全反射）。

| 参数     | 类型     | 说明                     |
| -------- | -------- | ------------------------ |
| `x, y`   | `number` | 镜子中心坐标             |
| `angle`  | `number` | 镜子朝向（弧度）         |
| `length` | `number` | 镜子长度                 |

#### `engine.addGlass(x, y, w, h, opts)`

添加玻璃矩形（折射）。`opts.n` 指定折射率，默认 `1.5`。

#### `engine.addWater(x, y, w, h, opts)`

添加水矩形（折射）。`opts.n` 默认 `1.33`，`opts.kMedium` 为体内吸收系数，`opts.isMilky` 为乳白水开关。

#### `engine.addPrism(cx, cy, size, angle, opts)`

添加三棱镜。`opts.n` 默认 `1.5`。

#### `engine.addLens(cx, cy, length, angle, focalLength, opts)`

添加薄透镜。`focalLength > 0` 为凸透镜，`< 0` 为凹透镜。

#### `engine.addSphericalMirror(cx, cy, aperture, angle, focalLength, opts)`

添加球面镜。`focalLength > 0` 为凹面镜，`< 0` 为凸面镜。

#### `engine.addParabolicMirror(cx, cy, aperture, angle, focalLength, opts)`

添加抛物面镜（解析抛物线求交，理想聚焦）。

#### `engine.addThickLens(cx, cy, aperture, angle, thickness, ior, opts)`

添加厚透镜（双圆弧面，两次折射）。

#### `engine.addObstacle(x, y, w, h)`

添加障碍物（完全吸收）。

#### `engine.addTarget(x, y, radius)`

添加目标点。光线击中后 `el.lit = true`。

#### `engine.addFluorescent(x, y, radius, opts)`

添加荧光物质。被光击中后朝所有采样点二次发射。

| 参数                        | 默认值 | 说明                 |
| --------------------------- | ------ | -------------------- |
| `opts.absorbMin`            | `380`  | 可吸收波长下限       |
| `opts.absorbMax`            | `780`  | 可吸收波长上限       |
| `opts.intensityThreshold`   | `0.05` | 触发荧光的最小强度   |
| `opts.emitBoost`            | `1.0`  | 发射强度倍率         |
| `opts.maxRays`              | `64`   | 最大二次发射光线数   |

---

### 光源工厂

#### `engine.addLight(x, y, angle, opts)`

添加点光源（单条中心光线）。

#### `engine.addParallelLight(x, y, angle, opts)`

添加平行光带。

| 参数          | 类型     | 默认值      | 说明               |
| ------------- | -------- | ----------- | ------------------ |
| `opts.width`  | `number` | `160`       | 光带宽度           |
| `opts.color`  | `string` | `'#ffffff'` | 颜色               |
| `opts.intensity` | `number` | `1.0`    | 强度               |
| `opts.isWhite` | `boolean` | `false`    | 是否白光（色散）   |

---

### 追踪

#### `engine.traceBeam(light, opts)`

**SPBT 主接口**。追踪一条平行光带，返回子光带数组。

```js
const beams = engine.traceBeam(parallelLight);
for (const sb of beams) {
    console.log(sb.sLeft, sb.sRight, sb.leftPath, sb.rightPath);
}
```

每个子光带对象包含：

| 字段         | 说明                       |
| ------------ | -------------------------- |
| `sLeft`      | 左边界横向坐标             |
| `sRight`     | 右边界横向坐标             |
| `leftStart`  | 左边界光线起点             |
| `rightStart` | 右边界光线起点             |
| `leftSegs`   | 左边界光线分段（含命中信息） |
| `rightSegs`  | 右边界光线分段             |
| `leftPath`   | 左边界光线路径点数组       |
| `rightPath`  | 右边界光线路径点数组       |

`opts.onHit` 为可选回调，每次命中元件时调用。

#### `engine.traceRay(start, dir, opts)`

追踪单条光线，返回路径点数组。

#### `engine.getBeamCuts(light)`

返回该光带在当前场景下的所有切分点（横向坐标数组）。

#### `engine.getAllSamples()`

返回场景中所有采样点，格式为 `{ x, y, element }`。

#### `engine.testHit(light, target, radius)`

判断光带是否击中目标点，返回布尔值。

---

### 渲染与更新

#### `engine.update()`

执行完整场景追踪，结果写入 `engine.segments`，同时重置所有目标点的 `lit` 状态。

#### `engine.render(ctx)`

将当前 `engine.segments` 渲染到 2D 上下文。包含：

- 网格背景
- 所有元件的 `draw()`
- 普通光线（逐条）
- 平行光带（按 `beamId` 分组，填充多边形 + 边缘描线）
- 法线虚线（可选）

#### `engine.clear()`

清空所有元件与光段。

#### `engine.pickAt(mx, my)`

返回鼠标坐标命中的元件，未命中返回 `null`。

#### `engine.allTargetsLit()`

返回所有目标点是否全部被点亮。

#### `engine.getSegments()`

返回当前所有光段。

---

### 场景构建器

链式 API，便于快速搭建场景：

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

可用方法：

| 方法                          | 对应工厂                |
| ----------------------------- | ----------------------- |
| `.mirror(x, y, a, l)`         | `addMirror`             |
| `.glass(x, y, w, h, o)`       | `addGlass`              |
| `.water(x, y, w, h, o)`       | `addWater`              |
| `.obstacle(x, y, w, h)`       | `addObstacle`           |
| `.light(x, y, a, o)`          | `addLight`              |
| `.parallelLight(x, y, a, o)`  | `addParallelLight`      |
| `.target(x, y, r)`            | `addTarget`             |
| `.fluorescent(x, y, r, o)`    | `addFluorescent`        |
| `.prism(cx, cy, s, a, o)`     | `addPrism`              |
| `.lens(cx, cy, len, a, f, o)` | `addLens`               |
| `.sphericalMirror(cx, cy, ap, a, f, o)` | `addSphericalMirror` |
| `.parabolicMirror(cx, cy, ap, a, f, o)` | `addParabolicMirror` |
| `.thickLens(cx, cy, ap, a, t, ior, o)`  | `addThickLens`       |
| `.done()`                     | 返回 `engine`           |

---

### 工具函数

#### `interpolateBeam(subBeam, t)`

在子光带内按参数 `t ∈ [0, 1]` 插值出一条光线路径。

```js
const midPath = XGSPBT.interpolateBeam(beams[0], 0.5);
```

#### `getBeamPaths(engine, light)`

等价于 `engine.traceBeam(light)`。

#### `traceAllBeams(engine, opts)`

追踪场景中所有平行光带，返回 `[{ light, subBeams }]`。

---

### 顶层导出

`XGSPBT` 对象包含：

| 导出项                | 说明                           |
| --------------------- | ------------------------------ |
| `Engine`              | `PrismEngine` 构造函数         |
| `V`                   | 二维向量工具                   |
| `createEngine`        | 引擎工厂函数                   |
| `SceneBuilder`        | 场景构建器                     |
| `interpolateBeam`     | 子光带插值                     |
| `getBeamPaths`        | 光带路径提取                   |
| `traceAllBeams`       | 批量追踪                       |
| `makeMirror`          | 平面镜工厂                     |
| `makeGlass`           | 玻璃工厂                       |
| `makeWater`           | 水工厂                         |
| `makeLens`            | 透镜工厂                       |
| `makeSphericalMirror` | 球面镜工厂                     |
| `makeParabolicMirror` | 抛物面镜工厂                   |
| `makeThickLens`       | 厚透镜工厂                     |
| `makePrism`           | 三棱镜工厂                     |
| `makeObstacle`        | 障碍物工厂                     |
| `makeLight`           | 点光源工厂                     |
| `makeParallelLight`   | 平行光工厂                     |
| `makeTarget`          | 目标点工厂                     |
| `makeFluorescent`     | 荧光物质工厂                   |
| `version`             | 引擎版本号                     |

---

## 物理模型

材质包含四个光学参数：

| 参数                | 含义            | 作用                       |
| ------------------- | --------------- | -------------------------- |
| `n`（refractiveIndex） | 折射率 n    | 决定折射方向（斯涅尔定律） |
| `reflectivity`      | 表面反射率 R    | 叠加在菲涅耳反射之上       |
| `absorptivity`      | 表面吸收率 A    | 直接吸收                   |
| `opacity`           | 体内吸收系数 α  | 比尔-朗伯衰减              |

能量守恒：

```
R + A + T = 1
T = 1 - R - A
```

- **菲涅耳公式**：给定入射角和两侧折射率，算出反射率与透射率的比例；
- **比尔-朗伯定律**：`exp(-αd)`，光在介质内传播距离 d 后的衰减；
- **能量守恒**：若 `R + A > 1`，按比例压缩 R 和 A。

引擎内置色散表 `SPECTRUM`（红→紫，400–700 nm），白光经过玻璃或三棱镜时按 7 个波段展开。

---

## 精确性

| 元件     | 方法                    | 精度                   |
| -------- | ----------------------- | ---------------------- |
| 平面元件 | 线性映射 + 边界光线     | 纯平面链路中无近似误差 |
| 圆形     | 离散成多边形 + 边界光线 | 离散精度决定           |
| SVG 曲线 | 离散成折线 + 边界光线   | 离散精度决定           |
| 球面/抛物面 | 解析求交 + 真实法线  | 解析精度               |
| 荧光物质 | 朝采样点离散发射        | 离散采样近似           |

**注**：曲面元件（圆、SVG 曲线）在重建子光带时，用两端点方向的平均值作为新光带方向，属于近似处理。

---

## 复杂度

| 步骤                   | 复杂度              |
| ---------------------- | ------------------- |
| 切分（排序采样点）     | O(N log N)          |
| 子光带追踪（边界光线） | O(N × M)            |
| 总计                   | O(N log N + N × M)  |

其中 N = 采样点数量，M = 元件数量。

**关键性质**：在采样点集合不变的前提下，计算量与光带宽度无关。

---

## 与逐条光线追踪的对比

| 维度         | 逐条光线追踪       | SPBT        |
| ------------ | ------------------ | ----------- |
| 光线数量     | 与光带宽度成正比   | O(采样点数) |
| 平面元件精度 | 精确               | 精确        |
| 曲面元件精度 | 精确（若解析求交） | 可控近似    |
| 光带宽度扩展 | 线性增长           | 不增长      |
| 实现复杂度   | 低                 | 中          |
| 视觉表现     | 离散线条           | 连续光带    |

**适用场景**：

- 光带宽、元件多、平面为主的关卡 → SPBT 优势最大
- 光线稀疏、曲面为主、需要极高精度的关卡 → 逐条追踪更简单

---

## 完整示例

```js
const engine = createEngine({ width: 1000, height: 700, canvas: cv });

// 白光平行光带
const light = engine.addParallelLight(100, 350, 0, {
    width: 240,
    isWhite: true,
    intensity: 1.0,
});

// 三棱镜（色散）
engine.addPrism(500, 350, 80, 0, { n: 1.5 });

// 抛物面镜（聚焦）
engine.addParabolicMirror(800, 350, 160, Math.PI, 120);

// 目标点
engine.addTarget(850, 350, 12);

// 逐条追踪 + 渲染
engine.update();
engine.render(engine.ctx);

// 或使用 SPBT 接口获取光带
const beams = engine.traceBeam(light);
console.log(`共 ${beams.length} 条子光带`);
```

---

## 已知限制

- **曲面元件**：圆、SVG 曲线离散成折线后走边界光线，重建子光带时有近似；
- **荧光物质**：朝所有采样点发射，采样点多时开销大，已用 `maxRays` 限制；
- **光带宽度**：如果光带变宽导致更多元件落入光带，采样点数量增加，计算量仍会上升；
- **split 分支**：子光带跨元件边界时会重新切分，极端情况下可能递归较深；
- **二维限制**：目前只支持二维，三维需要重新推导。

---

## 一句话总结

SPBT 用采样点将平行光带切分为若干子光带，每个子光带内光路线性一致，因此只需追踪每个子光带的边界光线，即可重建整个光带的光路。在纯平面元件链路中无近似误差，**在采样点集合不变的前提下**计算量与光带宽度无关。

---

## 许可证

GNU Affero General Public License v3.0

```
Sample-Point Beam Tracing Engine (SPBTE)
Copyright (C) 2026 XGstudio
```

---

## 参考文献

- 本项目源码：`XG-SPBT-engine.js`
- 理论文档：`XG-SPBTE.md`
- 关卡定义：`prism-game.js`
