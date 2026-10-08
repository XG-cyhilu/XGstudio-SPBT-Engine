/*  XG-SPBT Engine
    采样点光带追踪（Sample-Point Beam Tracing）理论光学引擎
    元件 + 光线追踪 + 光带追踪（SPBT）+ 渲染

    版本：1.2.0
*/

/*
Sample-Point Beam Tracing Engine(SPBTE)
Copyright (C) 2026  XGstudio

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published
by the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

(function (global) {
    'use strict';

    /* ============================================================
       向量工具
       ============================================================ */
    const V = {
        add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y }),
        sub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y }),
        mul: (a, s) => ({ x: a.x * s, y: a.y * s }),
        dot: (a, b) => a.x * b.x + a.y * b.y,
        len: (a) => Math.hypot(a.x, a.y),
        norm: (a) => { const l = Math.hypot(a.x, a.y) || 1; return { x: a.x / l, y: a.y / l }; },
        perp: (a) => ({ x: -a.y, y: a.x }),
        fromAngle: (t) => ({ x: Math.cos(t), y: Math.sin(t) }),
        dist: (a, b) => Math.hypot(a.x - b.x, a.y - b.y),
        lerp: (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }),
    };

    /* ============================================================
       光学公式
       ============================================================ */
    function reflect(d, n) {
        return V.norm(V.sub(d, V.mul(n, 2 * V.dot(d, n))));
    }

    function refract(d, n, n1, n2) {
        const cosI = -V.dot(d, n);
        const eta = n1 / n2;
        const sinT2 = eta * eta * (1 - cosI * cosI);
        if (sinT2 > 1) return null;   // 全反射
        const cosT = Math.sqrt(1 - sinT2);
        return V.norm(V.add(V.mul(d, eta), V.mul(n, eta * cosI - cosT)));
    }

    /* ============================================================
       几何求交
       ============================================================ */
    function raySegment(ray, a, b) {
        const d = ray.dir;
        const e = V.sub(b, a);
        const denom = d.x * e.y - d.y * e.x;
        if (Math.abs(denom) < 1e-9) return null;
        const diff = V.sub(a, ray.origin);
        const t = (diff.x * e.y - diff.y * e.x) / denom;
        const u = (diff.x * d.y - diff.y * d.x) / denom;
        const eps = 1e-9;
        if (t < 1e-4 || u < -eps || u > 1 + eps) return null;
        const point = V.add(ray.origin, V.mul(d, t));
        let normal = V.norm(V.perp(e));
        if (V.dot(normal, d) > 0) normal = V.mul(normal, -1);
        return { t, point, normal };
    }

    // 光线与圆弧求交（解析）
    function rayArc(ray, c, R, a0, a1) {
        const oc = V.sub(ray.origin, c);
        const b = V.dot(oc, ray.dir);
        const cc = V.dot(oc, oc) - R * R;
        const disc = b * b - cc;
        if (disc < 0) return null;
        const sq = Math.sqrt(disc);
        const t1 = -b - sq, t2 = -b + sq;
        const ts = [t1, t2].filter(t => t > 1e-4);
        let best = null;
        for (const t of ts) {
            const p = V.add(ray.origin, V.mul(ray.dir, t));
            let ang = Math.atan2(p.y - c.y, p.x - c.x);
            // 规范化到 [a0, a0+2π)
            let da = ang - a0;
            while (da < 0) da += Math.PI * 2;
            while (da >= Math.PI * 2) da -= Math.PI * 2;
            let span = a1 - a0;
            while (span < 0) span += Math.PI * 2;
            if (da <= span + 1e-9) {
                let normal = V.norm(V.sub(p, c));
                if (V.dot(normal, ray.dir) > 0) normal = V.mul(normal, -1);
                if (!best || t < best.t) best = { t, point: p, normal };
            }
        }
        return best;
    }

    // 光线与抛物线求交（解析，非多段线）
    // 抛物线：局部坐标 y = x^2 / (4f)，顶点 vertex，开口方向 theta（单位向量 openDir），
    // 局部 x 轴沿 perp(openDir)，局部 y 轴沿 openDir
    function rayParabola(ray, vertex, focal, theta, aperture) {
        // 局部坐标变换：世界 → 局部
        const openDir = V.fromAngle(theta);
        const xAxis = V.perp(openDir);         // 局部 x
        const yAxis = openDir;                 // 局部 y（开口方向）
        const rel = V.sub(ray.origin, vertex);
        const o = { x: V.dot(rel, xAxis), y: V.dot(rel, yAxis) };
        const d = { x: V.dot(ray.dir, xAxis), y: V.dot(ray.dir, yAxis) };

        // 局部抛物线： y = x^2 / (4f)
        // 射线： P(t) = o + d*t
        // 满足： o.y + d.y*t = (o.x + d.x*t)^2 / (4f)
        // → d.y*t + o.y - (o.x^2 + 2*o.x*d.x*t + d.x^2*t^2)/(4f) = 0
        // → (-d.x^2/(4f)) * t^2 + (d.y - 2*o.x*d.x/(4f)) * t + (o.y - o.x^2/(4f)) = 0
        const inv4f = 1 / (4 * focal);
        const A = -d.x * d.x * inv4f;
        const B = d.y - 2 * o.x * d.x * inv4f;
        const C = o.y - o.x * o.x * inv4f;

        let ts = [];
        if (Math.abs(A) < 1e-12) {
            if (Math.abs(B) > 1e-12) ts = [-C / B];
        } else {
            const disc = B * B - 4 * A * C;
            if (disc < 0) return null;
            const sq = Math.sqrt(disc);
            ts = [(-B - sq) / (2 * A), (-B + sq) / (2 * A)];
        }

        let best = null;
        for (const t of ts) {
            if (t < 1e-4) continue;
            const pLocal = { x: o.x + d.x * t, y: o.y + d.y * t };
            // 口径范围检查
            if (Math.abs(pLocal.x) > aperture / 2) continue;
            // 局部 → 世界
            const p = V.add(vertex, V.add(V.mul(xAxis, pLocal.x), V.mul(yAxis, pLocal.y)));

            // 局部抛物线在 pLocal.x 处切线方向：(1, pLocal.x/(2f))
            const tx = 1;
            const ty = pLocal.x / (2 * focal);
            // 局部法线（朝开口反方向，即入射面一侧）：(-ty, tx) 归一化
            let nLocal = { x: -ty, y: tx };
            const nl = Math.hypot(nLocal.x, nLocal.y) || 1;
            nLocal = { x: nLocal.x / nl, y: nLocal.y / nl };
            // 局部 → 世界法线
            let normal = {
                x: xAxis.x * nLocal.x + yAxis.x * nLocal.y,
                y: xAxis.y * nLocal.x + yAxis.y * nLocal.y,
            };
            if (V.dot(normal, ray.dir) > 0) normal = V.mul(normal, -1);

            if (!best || t < best.t) best = { t, point: p, normal };
        }
        return best;
    }

    function rayRect(ray, rect) {
        const pts = [
            { x: rect.x, y: rect.y },
            { x: rect.x + rect.w, y: rect.y },
            { x: rect.x + rect.w, y: rect.y + rect.h },
            { x: rect.x, y: rect.y + rect.h },
        ];
        return rayPolygon(ray, pts);
    }

    function rayPolygon(ray, pts) {
        let best = null;
        for (let i = 0; i < pts.length; i++) {
            const hit = raySegment(ray, pts[i], pts[(i + 1) % pts.length]);
            if (hit && (!best || hit.t < best.t)) best = hit;
        }
        return best;
    }

    function pointInPolygon(p, pts) {
        let inside = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
            const xi = pts[i].x, yi = pts[i].y;
            const xj = pts[j].x, yj = pts[j].y;
            const intersect = ((yi > p.y) !== (yj > p.y)) &&
                (p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    function pointInRect(p, rect) {
        return p.x >= rect.x && p.x <= rect.x + rect.w &&
               p.y >= rect.y && p.y <= rect.y + rect.h;
    }

    /* ============================================================
       常量
       ============================================================ */
    const AIR_N = 1.0;
    const WATER_N = 1.33;
    const GLASS_N = 1.5;
    const MAX_BOUNCE = 16;
    const MIN_INTENSITY = 0.01;
    const EPS = 1e-9;
    const SURFACE_OFFSET = 1e-3;
    const FAR_DISTANCE = 3000;

    const SPECTRUM = [
        { name: '红', lambda: 700, n: 1.510, rgb: '#ff2222' },
        { name: '橙', lambda: 620, n: 1.514, rgb: '#ff8800' },
        { name: '黄', lambda: 580, n: 1.517, rgb: '#ffee00' },
        { name: '绿', lambda: 530, n: 1.521, rgb: '#44ff44' },
        { name: '蓝', lambda: 470, n: 1.526, rgb: '#2288ff' },
        { name: '靛', lambda: 445, n: 1.529, rgb: '#4444cc' },
        { name: '紫', lambda: 400, n: 1.532, rgb: '#aa44ff' },
    ];

    function nForLambda(lambda) {
        let best = SPECTRUM[0];
        for (const s of SPECTRUM) {
            if (Math.abs(s.lambda - lambda) < Math.abs(best.lambda - lambda)) best = s;
        }
        return best.n;
    }

    function distanceAttenuation(I, dist, isParallel) {
        const k = isParallel ? 0.001 : 0.005;
        return I * Math.exp(-k * dist);
    }

    function mediumAttenuation(I, dist, kMedium) {
        return I * Math.exp(-kMedium * dist);
    }

    /* ============================================================
       元件工厂（保留原接口）
       ============================================================ */

    function makeMirror(x, y, angle, length) {
        const self = {
            type: 'mirror',
            pos: { x, y }, angle, length,
            a: { x: 0, y: 0 }, b: { x: 0, y: 0 },
            setAngle(a) {
                this.angle = a;
                this.a = V.add(this.pos, V.mul(V.fromAngle(a + Math.PI / 2), this.length / 2));
                this.b = V.add(this.pos, V.mul(V.fromAngle(a - Math.PI / 2), this.length / 2));
            },
            setPos(p) {
                this.pos.x = p.x; this.pos.y = p.y;
                this.setAngle(this.angle);
            },
            intersect(ray) { return raySegment(ray, this.a, this.b); },
            interact(ray, hit) {
                return [{ ...ray, origin: hit.point, dir: reflect(ray.dir, hit.normal), bounce: ray.bounce + 1 }];
            },
            samplePoints() { return [this.a, this.b]; },
            draw(ctx) {
                ctx.strokeStyle = '#8899cc';
                ctx.lineWidth = 4;
                ctx.beginPath();
                ctx.moveTo(this.a.x, this.a.y);
                ctx.lineTo(this.b.x, this.b.y);
                ctx.stroke();
                ctx.strokeStyle = '#ccddff';
                ctx.lineWidth = 1.5;
                ctx.stroke();
                for (const p of [this.a, this.b]) {
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
                    ctx.fillStyle = '#5a5aff';
                    ctx.fill();
                    ctx.strokeStyle = '#aabbff';
                    ctx.lineWidth = 1.5;
                    ctx.stroke();
                }
            },
        };
        self.setAngle(angle);
        return self;
    }

    function makeGlass(x, y, w, h, opts = {}) {
        const rect = { x, y, w, h };
        const n = opts.n ?? GLASS_N;
        return {
            type: 'glass',
            rect, n,
            setPos(p) { this.rect.x = p.x - this.rect.w / 2; this.rect.y = p.y - this.rect.h / 2; },
            intersect(ray) { return rayRect(ray, this.rect); },
            interact(ray, hit) {
                const probe = V.add(hit.point, V.mul(ray.dir, 1e-3));
                const entering = pointInRect(probe, this.rect);
                if (ray.isWhite && entering) {
                    return SPECTRUM.map(s => {
                        const d = refract(ray.dir, hit.normal, AIR_N, s.n);
                        return {
                            ...ray,
                            origin: hit.point,
                            dir: d || reflect(ray.dir, hit.normal),
                            color: s.rgb, lambda: s.lambda, isWhite: false,
                            bounce: ray.bounce + 1,
                        };
                    });
                }
                const nl = ray.lambda ? nForLambda(ray.lambda) : this.n;
                const n1 = entering ? AIR_N : nl;
                const n2 = entering ? nl : AIR_N;
                const d = refract(ray.dir, hit.normal, n1, n2);
                return [{
                    ...ray,
                    origin: hit.point,
                    dir: d || reflect(ray.dir, hit.normal),
                    bounce: ray.bounce + 1,
                }];
            },
            samplePoints() {
                return [
                    { x: rect.x, y: rect.y },
                    { x: rect.x + rect.w, y: rect.y },
                    { x: rect.x + rect.w, y: rect.y + rect.h },
                    { x: rect.x, y: rect.y + rect.h },
                ];
            },
            draw(ctx) {
                ctx.fillStyle = 'rgba(180,220,255,0.15)';
                ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
                ctx.strokeStyle = 'rgba(200,230,255,0.7)';
                ctx.lineWidth = 1.5;
                ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
            },
        };
    }

    function makeWater(x, y, w, h, opts = {}) {
        const rect = { x, y, w, h };
        const n = opts.n ?? WATER_N;
        const kMedium = opts.kMedium ?? 0.0;
        const isMilky = opts.isMilky ?? false;
        return {
            type: 'water',
            rect, n, kMedium, isMilky,
            intersect(ray) { return rayRect(ray, this.rect); },
            interact(ray, hit) {
                const probe = V.add(hit.point, V.mul(ray.dir, 1e-3));
                const entering = pointInRect(probe, this.rect);
                const n1 = entering ? AIR_N : this.n;
                const n2 = entering ? this.n : AIR_N;
                const newDir = refract(ray.dir, hit.normal, n1, n2);
                return [{
                    ...ray,
                    origin: hit.point,
                    dir: newDir || reflect(ray.dir, hit.normal),
                    bounce: ray.bounce + 1,
                }];
            },
            samplePoints() {
                return [
                    { x: rect.x, y: rect.y },
                    { x: rect.x + rect.w, y: rect.y },
                    { x: rect.x + rect.w, y: rect.y + rect.h },
                    { x: rect.x, y: rect.y + rect.h },
                ];
            },
            draw(ctx) {
                ctx.fillStyle = isMilky ? 'rgba(230,235,255,0.55)' : 'rgba(120,180,255,0.18)';
                ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
                ctx.strokeStyle = isMilky ? 'rgba(240,245,255,0.9)' : 'rgba(120,180,255,0.6)';
                ctx.lineWidth = 1.5;
                ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
            },
        };
    }

    function makeLens(cx, cy, length, angle, focalLength, opts = {}) {
        const self = {
            type: 'lens',
            pos: { x: cx, y: cy },
            length, angle, focalLength,
            a: { x: 0, y: 0 }, b: { x: 0, y: 0 },
            setAngle(a) {
                this.angle = a;
                this.a = V.add(this.pos, V.mul(V.fromAngle(a + Math.PI / 2), this.length / 2));
                this.b = V.add(this.pos, V.mul(V.fromAngle(a - Math.PI / 2), this.length / 2));
            },
            setPos(p) {
                this.pos.x = p.x; this.pos.y = p.y;
                this.setAngle(this.angle);
            },
            intersect(ray) { return raySegment(ray, this.a, this.b); },
            interact(ray, hit) {
                let n = V.norm(V.perp(V.sub(this.b, this.a)));
                if (V.dot(ray.dir, n) > 0) n = V.mul(n, -1);

                const f = this.focalLength;
                const F = f > 0
                    ? V.add(this.pos, V.mul(n, -Math.abs(f)))
                    : V.add(this.pos, V.mul(n,  Math.abs(f)));

                let d;
                if (f > 0) {
                    d = V.norm(V.sub(F, hit.point));
                } else {
                    d = V.norm(V.sub(hit.point, F));
                }

                return [{
                    ...ray,
                    origin: hit.point,
                    dir: d,
                    bounce: ray.bounce + 1,
                }];
            },
            samplePoints() { return [this.a, this.b]; },
            draw(ctx) {
                const isConvex = this.focalLength > 0;
                ctx.save();
                ctx.strokeStyle = isConvex ? '#88ddff' : '#ffaa88';
                ctx.lineWidth = 3;
                const mx = (this.a.x + this.b.x) / 2;
                const my = (this.a.y + this.b.y) / 2;
                const n = V.norm(V.perp(V.sub(this.b, this.a)));
                const bulge = isConvex ? 8 : -8;
                ctx.beginPath();
                ctx.moveTo(this.a.x, this.a.y);
                ctx.quadraticCurveTo(
                    mx + n.x * bulge, my + n.y * bulge,
                    this.b.x, this.b.y
                );
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(this.a.x, this.a.y);
                ctx.quadraticCurveTo(
                    mx - n.x * bulge, my - n.y * bulge,
                    this.b.x, this.b.y
                );
                ctx.stroke();
                for (const p of [this.a, this.b]) {
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
                    ctx.fillStyle = isConvex ? '#88ddff' : '#ffaa88';
                    ctx.fill();
                }
                ctx.restore();
            },
        };
        self.setAngle(angle);
        return self;
    }

    // ---- 球面镜 ----
    // 保留原接口，但放宽"反射面朝向"判断：不再强制方向，交给法线朝向决定
    function makeSphericalMirror(cx, cy, aperture, angle, focalLength, opts = {}) {
        const f = focalLength;
        const R = Math.abs(f) * 2;
        const isConcave = f > 0;

        const self = {
            type: 'sphericalMirror',
            pos: { x: cx, y: cy },
            aperture, angle, focalLength: f, R, isConcave,
            center: { x: 0, y: 0 },
            a0: 0, a1: 0,
            vertex: { x: 0, y: 0 },

            recompute() {
                const openDir = V.fromAngle(this.angle);
                const cOff = isConcave ? R : -R;
                this.center = V.add(this.pos, V.mul(openDir, cOff));
                this.vertex = this.pos;

                const halfAng = Math.asin(Math.min(0.99, (this.aperture / 2) / R));
                const baseAng = Math.atan2(this.pos.y - this.center.y, this.pos.x - this.center.x);
                this.a0 = baseAng - halfAng;
                this.a1 = baseAng + halfAng;
            },

            setAngle(a) { this.angle = a; this.recompute(); },
            setPos(p) { this.pos.x = p.x; this.pos.y = p.y; this.recompute(); },

            intersect(ray) {
                // 解析圆求交，真实球面法线
                return rayArc(ray, this.center, R, this.a0, this.a1);
            },

            interact(ray, hit) {
                return [{
                    ...ray,
                    origin: hit.point,
                    dir: reflect(ray.dir, hit.normal),
                    bounce: ray.bounce + 1,
                }];
            },

            samplePoints() {
                const p0 = {
                    x: this.center.x + Math.cos(this.a0) * R,
                    y: this.center.y + Math.sin(this.a0) * R,
                };
                const p1 = {
                    x: this.center.x + Math.cos(this.a1) * R,
                    y: this.center.y + Math.sin(this.a1) * R,
                };
                return [p0, p1, this.vertex];
            },

            draw(ctx) {
                ctx.save();
                ctx.strokeStyle = isConcave ? '#88ddff' : '#ffaa88';
                ctx.lineWidth = 4;
                ctx.beginPath();
                ctx.arc(this.center.x, this.center.y, R, this.a0, this.a1);
                ctx.stroke();
                ctx.strokeStyle = isConcave ? '#ccf0ff' : '#ffddcc';
                ctx.lineWidth = 1.5;
                ctx.stroke();
                ctx.beginPath();
                ctx.arc(this.vertex.x, this.vertex.y, 5, 0, Math.PI * 2);
                ctx.fillStyle = isConcave ? '#88ddff' : '#ffaa88';
                ctx.fill();
                ctx.restore();
            },
        };
        self.recompute();
        return self;
    }

    // ---- 抛物面镜（新增） ----
    // 抛物面：顶点 vertex，焦距 f，开口方向 angle（单位向量 = openDir）
    // 反射面朝开口方向的反方向；光线从开口方向入射，反射后汇聚到焦点
    function makeParabolicMirror(cx, cy, aperture, angle, focalLength, opts = {}) {
        const f = Math.abs(focalLength);
        const self = {
            type: 'parabolicMirror',
            pos: { x: cx, y: cy },
            aperture, angle, focalLength: f,
            vertex: { x: cx, y: cy },
            focus: { x: 0, y: 0 },

            recompute() {
                const openDir = V.fromAngle(this.angle);
                this.focus = V.add(this.pos, V.mul(openDir, f));
            },

            setAngle(a) { this.angle = a; this.recompute(); },
            setPos(p) { this.pos.x = p.x; this.pos.y = p.y; this.recompute(); },

            intersect(ray) {
                // 解析抛物线求交
                return rayParabola(ray, this.vertex, f, this.angle, this.aperture);
            },

            interact(ray, hit) {
                return [{
                    ...ray,
                    origin: hit.point,
                    dir: reflect(ray.dir, hit.normal),
                    bounce: ray.bounce + 1,
                }];
            },

            samplePoints() {
                // 抛物线上均匀取点：局部 x 从 -aperture/2 到 aperture/2
                const pts = [];
                const openDir = V.fromAngle(this.angle);
                const xAxis = V.perp(openDir);
                const yAxis = openDir;
                const N = 6;
                for (let i = 0; i <= N; i++) {
                    const lx = -this.aperture / 2 + this.aperture * i / N;
                    const ly = (lx * lx) / (4 * f);
                    pts.push(V.add(this.vertex, V.add(V.mul(xAxis, lx), V.mul(yAxis, ly))));
                }
                return pts;
            },

            draw(ctx) {
                ctx.save();
                ctx.strokeStyle = '#88ddff';
                ctx.lineWidth = 4;
                const pts = this.samplePoints();
                ctx.beginPath();
                ctx.moveTo(pts[0].x, pts[0].y);
                for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
                ctx.stroke();
                ctx.strokeStyle = '#ccf0ff';
                ctx.lineWidth = 1.5;
                ctx.stroke();
                // 焦点标记
                ctx.beginPath();
                ctx.arc(this.focus.x, this.focus.y, 3, 0, Math.PI * 2);
                ctx.fillStyle = '#ffee88';
                ctx.fill();
                ctx.restore();
            },
        };
        self.recompute();
        return self;
    }

    // ---- 厚透镜（新增） ----
    // 用两段圆弧表示前后表面，光线进入时折射一次，出射时再折射一次
    // 简化版：单个圆盘（两个表面合并为一条光路），用两次折射公式
    // 这里用一个"双面圆弧"结构：两个圆弧圆心沿主轴对称
    function makeThickLens(cx, cy, aperture, angle, thickness, ior = 1.5, opts = {}) {
        const n = ior;
        const self = {
            type: 'thickLens',
            pos: { x: cx, y: cy },
            aperture, angle, thickness, ior: n,

            // 两个表面：front / back
            // 用两段圆弧近似，分别位于 pos ± axis * thickness/2
            front: null,
            back: null,

            recompute() {
                const openDir = V.fromAngle(this.angle);
                const xAxis = V.perp(openDir);
                // 前表面：朝向入射侧，半径 R = 2 * thickness（近似）
                // 简化：两段圆弧圆心在主轴两侧，半径足够大
                const R = 2 * this.thickness + this.aperture; // 大半径，近似平面
                const cOff = R;
                const frontCenter = V.add(this.pos, V.mul(openDir, -cOff + this.thickness / 2));
                const backCenter = V.add(this.pos, V.mul(openDir,  cOff - this.thickness / 2));
                const halfAng = Math.asin(Math.min(0.99, (this.aperture / 2) / R));
                const frontBase = Math.atan2(
                    this.pos.y + openDir.y * this.thickness / 2 - frontCenter.y,
                    this.pos.x + openDir.x * this.thickness / 2 - frontCenter.x
                );
                const backBase = Math.atan2(
                    this.pos.y - openDir.y * this.thickness / 2 - backCenter.y,
                    this.pos.x - openDir.x * this.thickness / 2 - backCenter.x
                );
                this.front = {
                    center: frontCenter, R,
                    a0: frontBase - halfAng, a1: frontBase + halfAng,
                };
                this.back = {
                    center: backCenter, R,
                    a0: backBase - halfAng, a1: backBase + halfAng,
                };
            },

            setAngle(a) { this.angle = a; this.recompute(); },
            setPos(p) { this.pos.x = p.x; this.pos.y = p.y; this.recompute(); },

            intersect(ray) {
                const h1 = this.front ? rayArc(ray, this.front.center, this.front.R, this.front.a0, this.front.a1) : null;
                const h2 = this.back ? rayArc(ray, this.back.center, this.back.R, this.back.a0, this.back.a1) : null;
                let best = null;
                if (h1 && (!best || h1.t < best.t)) best = h1;
                if (h2 && (!best || h2.t < best.t)) best = h2;
                return best;
            },

            interact(ray, hit) {
                // 判断当前是前表面还是后表面：靠命中点与主轴的位置
                const openDir = V.fromAngle(this.angle);
                const rel = V.sub(hit.point, this.pos);
                const along = V.dot(rel, openDir);
                const entering = along > 0;   // 命中后表面 = 出射

                // 判定折射率：从空气进入玻璃 or 玻璃到空气
                const n1 = entering ? n : AIR_N;
                const n2 = entering ? AIR_N : n;

                const newDir = refract(ray.dir, hit.normal, n1, n2);
                return [{
                    ...ray,
                    origin: hit.point,
                    dir: newDir || reflect(ray.dir, hit.normal),
                    bounce: ray.bounce + 1,
                }];
            },

            samplePoints() {
                const openDir = V.fromAngle(this.angle);
                const xAxis = V.perp(openDir);
                const pts = [];
                const N = 4;
                for (let i = 0; i <= N; i++) {
                    const lx = -this.aperture / 2 + this.aperture * i / N;
                    // 前后表面共 2*(N+1) 个点，这里合并
                    pts.push(V.add(this.pos, V.mul(xAxis, lx)));
                }
                return pts;
            },

            draw(ctx) {
                if (!this.front || !this.back) return;
                ctx.save();
                ctx.strokeStyle = '#88ffbb';
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.arc(this.front.center.x, this.front.center.y, this.front.R, this.front.a0, this.front.a1);
                ctx.stroke();
                ctx.beginPath();
                ctx.arc(this.back.center.x, this.back.center.y, this.back.R, this.back.a0, this.back.a1);
                ctx.stroke();
                ctx.restore();
            },
        };
        self.recompute();
        return self;
    }

    /* ---- 三棱镜 ---- */
    function makePrism(cx, cy, size, angle, opts = {}) {
        const n = opts.n ?? GLASS_N;
        const self = {
            type: 'prism',
            pos: { x: cx, y: cy },
            size, angle, n,
            pts: [],
            recompute() {
                this.pts = [];
                for (let i = 0; i < 3; i++) {
                    const a = this.angle + i * (Math.PI * 2 / 3) - Math.PI / 2;
                    this.pts.push({
                        x: this.pos.x + Math.cos(a) * this.size,
                        y: this.pos.y + Math.sin(a) * this.size,
                    });
                }
            },
            setAngle(a) { this.angle = a; this.recompute(); },
            setPos(p) { this.pos.x = p.x; this.pos.y = p.y; this.recompute(); },
            intersect(ray) { return rayPolygon(ray, this.pts); },
            interact(ray, hit) {
                const probe = V.add(hit.point, V.mul(ray.dir, 1e-3));
                const entering = pointInPolygon(probe, this.pts);

                if (ray.isWhite && entering) {
                    return SPECTRUM.map(s => {
                        const d = refract(ray.dir, hit.normal, AIR_N, s.n);
                        return {
                            ...ray,
                            origin: hit.point,
                            dir: d || reflect(ray.dir, hit.normal),
                            color: s.rgb,
                            lambda: s.lambda,
                            isWhite: false,
                            bounce: ray.bounce + 1,
                        };
                    });
                }

                const nl = ray.lambda ? nForLambda(ray.lambda) : this.n;
                const n1 = entering ? AIR_N : nl;
                const n2 = entering ? nl : AIR_N;
                const d = refract(ray.dir, hit.normal, n1, n2);
                return [{
                    ...ray,
                    origin: hit.point,
                    dir: d || reflect(ray.dir, hit.normal),
                    bounce: ray.bounce + 1,
                }];
            },
            samplePoints() { return this.pts; },
            draw(ctx) {
                ctx.save();
                ctx.beginPath();
                ctx.moveTo(this.pts[0].x, this.pts[0].y);
                for (let i = 1; i < this.pts.length; i++) {
                    ctx.lineTo(this.pts[i].x, this.pts[i].y);
                }
                ctx.closePath();
                ctx.fillStyle = 'rgba(180,220,255,0.15)';
                ctx.fill();
                ctx.strokeStyle = 'rgba(200,230,255,0.8)';
                ctx.lineWidth = 1.5;
                ctx.stroke();
                ctx.fillStyle = 'rgba(255,255,255,0.08)';
                ctx.fill();
                ctx.restore();
            },
        };
        self.recompute();
        return self;
    }

    function makeObstacle(x, y, w, h) {
        const rect = { x, y, w, h };
        return {
            type: 'obstacle',
            rect,
            intersect(ray) { return rayRect(ray, this.rect); },
            interact() { return []; },
            samplePoints() {
                return [
                    { x: rect.x, y: rect.y },
                    { x: rect.x + rect.w, y: rect.y },
                    { x: rect.x + rect.w, y: rect.y + rect.h },
                    { x: rect.x, y: rect.y + rect.h },
                ];
            },
            draw(ctx) {
                ctx.fillStyle = '#2a2a3e';
                ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
                ctx.strokeStyle = '#5a5a7a';
                ctx.lineWidth = 2;
                ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
            },
        };
    }

    function makeLight(x, y, angle, opts = {}) {
        return {
            type: 'light',
            pos: { x, y }, angle,
            color: opts.color ?? '#ffffff',
            intensity: opts.intensity ?? 1.0,
            isWhite: opts.isWhite ?? false,
            isParallel: opts.isParallel ?? false,
            intersect() { return null; },
            samplePoints() { return []; },
            draw(ctx) {
                ctx.save();
                ctx.translate(this.pos.x, this.pos.y);
                ctx.rotate(this.angle);
                ctx.fillStyle = this.color;
                ctx.shadowColor = this.color;
                ctx.shadowBlur = 20;
                ctx.beginPath();
                ctx.arc(0, 0, 8, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = this.color;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(8, 0); ctx.lineTo(22, 0);
                ctx.stroke();
                ctx.restore();
            },
        };
    }

    function makeParallelLight(x, y, angle, opts = {}) {
        return {
            type: 'parallelLight',
            pos: { x, y }, angle,
            width: opts.width ?? 160,
            color: opts.color ?? '#ffffff',
            intensity: opts.intensity ?? 1.0,
            isWhite: opts.isWhite ?? false,
            intersect() { return null; },
            samplePoints() { return []; },
            draw(ctx) {
                const dir = V.fromAngle(this.angle);
                const perp = V.perp(dir);
                const half = this.width / 2;
                const a = V.add(this.pos, V.mul(perp,  half));
                const b = V.add(this.pos, V.mul(perp, -half));
                const far = 3000;
                const a2 = V.add(a, V.mul(dir, far));
                const b2 = V.add(b, V.mul(dir, far));
                ctx.save();
                const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
                g.addColorStop(0, 'rgba(255,255,255,0.03)');
                g.addColorStop(0.5, 'rgba(255,255,255,0.12)');
                g.addColorStop(1, 'rgba(255,255,255,0.03)');
                ctx.fillStyle = g;
                ctx.beginPath();
                ctx.moveTo(a.x, a.y); ctx.lineTo(a2.x, a2.y);
                ctx.lineTo(b2.x, b2.y); ctx.lineTo(b.x, b.y);
                ctx.closePath();
                ctx.fill();
                ctx.strokeStyle = this.color;
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(a.x, a.y); ctx.lineTo(a2.x, a2.y);
                ctx.moveTo(b.x, b.y); ctx.lineTo(b2.x, b2.y);
                ctx.stroke();
                ctx.restore();
            },
        };
    }

    function makeTarget(x, y, radius = 16) {
        return {
            type: 'target',
            pos: { x, y }, radius,
            lit: false,
            intersect(ray) {
                const oc = V.sub(ray.origin, this.pos);
                const b = V.dot(oc, ray.dir);
                const c = V.dot(oc, oc) - this.radius * this.radius;
                const disc = b * b - c;
                if (disc < 0) return null;
                const sq = Math.sqrt(disc);
                const t1 = -b - sq, t2 = -b + sq;
                const t = t1 > 1e-4 ? t1 : (t2 > 1e-4 ? t2 : null);
                if (t === null) return null;
                return { t, point: V.add(ray.origin, V.mul(ray.dir, t)), normal: { x: 0, y: 0 } };
            },
            interact(ray, hit) {
                this.lit = true;
                return [];
            },
            samplePoints() { return [this.pos]; },
            draw(ctx) {
                const col = this.lit ? '#44ff88' : '#445566';
                ctx.save();
                ctx.shadowColor = col;
                ctx.shadowBlur = this.lit ? 30 : 0;
                ctx.strokeStyle = col;
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.arc(this.pos.x, this.pos.y, this.radius, 0, Math.PI * 2);
                ctx.stroke();
                ctx.fillStyle = this.lit ? 'rgba(68,255,136,0.3)' : 'rgba(68,85,102,0.2)';
                ctx.fill();
                ctx.restore();
            },
        };
    }

    function makeFluorescent(x, y, radius = 20, opts = {}) {
        const self = {
            type: 'fluorescent',
            pos: { x, y }, radius,
            absorbMin: opts.absorbMin ?? 380,
            absorbMax: opts.absorbMax ?? 780,
            intensityThreshold: opts.intensityThreshold ?? 0.05,
            emitBoost: opts.emitBoost ?? 1.0,
            maxRays: opts.maxRays ?? 64,

            intersect(ray) {
                const oc = V.sub(ray.origin, this.pos);
                const b = V.dot(oc, ray.dir);
                const c = V.dot(oc, oc) - this.radius * this.radius;
                const disc = b * b - c;
                if (disc < 0) return null;
                const sq = Math.sqrt(disc);
                const t1 = -b - sq, t2 = -b + sq;
                const t = t1 > 1e-4 ? t1 : (t2 > 1e-4 ? t2 : null);
                if (t === null) return null;
                return { t, point: V.add(ray.origin, V.mul(ray.dir, t)), normal: { x: 0, y: 0 } };
            },

            interact(ray, hit) {
                if (ray.isFluorescent === true) return [];
                const lambda = ray.lambda ?? 550;
                if (lambda < this.absorbMin || lambda > this.absorbMax) return [];
                if (ray.intensity < this.intensityThreshold) return [];

                const points = [];
                for (const el of this.engine.elements) {
                    if (el === this) continue;
                    if (!el.samplePoints) continue;
                    for (const p of el.samplePoints()) {
                        if (V.len(V.sub(p, this.pos)) < 1e-3) continue;
                        points.push(p);
                    }
                }
                if (points.length === 0) return [];

                let chosen = points;
                if (points.length > this.maxRays) {
                    chosen = [];
                    const step = points.length / this.maxRays;
                    for (let i = 0; i < this.maxRays; i++) {
                        chosen.push(points[Math.floor(i * step)]);
                    }
                }

                const per = ray.intensity * 0.2 * this.emitBoost / chosen.length;

                return chosen.map(p => ({
                    origin: this.pos,
                    dir: V.norm(V.sub(p, this.pos)),
                    intensity: per,
                    color: ray.color || '#ffffff',
                    isWhite: false,
                    isParallel: false,
                    lambda,
                    bounce: ray.bounce + 1,
                    isFluorescent: true,
                    ignoreElement: this,
                }));
            },

            samplePoints() { return [this.pos]; },

            draw(ctx) {
                ctx.save();
                ctx.shadowColor = '#88ff88';
                ctx.shadowBlur = 20;
                ctx.fillStyle = 'rgba(120,255,150,0.4)';
                ctx.beginPath();
                ctx.arc(this.pos.x, this.pos.y, this.radius, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = '#88ff88';
                ctx.lineWidth = 2;
                ctx.stroke();
                ctx.beginPath();
                ctx.arc(this.pos.x, this.pos.y, 3, 0, Math.PI * 2);
                ctx.fillStyle = '#ccffcc';
                ctx.fill();
                ctx.restore();
            },
        };
        return self;
    }

    /* ============================================================
       引擎主体
       ============================================================ */
    function PrismEngine(opts = {}) {
        this.elements = [];
        this.segments = [];
        this.width = opts.width ?? 800;
        this.height = opts.height ?? 600;

        // SPBT 配置
        this.maxDepth = MAX_BOUNCE;
        this.maxSubBeams = 256;
        this.mergeEpsilon = 0.5;
        this.debug = false;

        // 工厂方法
        this.addMirror = (x, y, a, l) => { const e = makeMirror(x, y, a, l); this.elements.push(e); return e; };
        this.addGlass = (x, y, w, h, o) => { const e = makeGlass(x, y, w, h, o); this.elements.push(e); return e; };
        this.addWater = (x, y, w, h, o) => { const e = makeWater(x, y, w, h, o); this.elements.push(e); return e; };
        this.addObstacle = (x, y, w, h) => { const e = makeObstacle(x, y, w, h); this.elements.push(e); return e; };
        this.addLight = (x, y, a, o) => { const e = makeLight(x, y, a, o); this.elements.push(e); return e; };
        this.addParallelLight = (x, y, a, o) => { const e = makeParallelLight(x, y, a, o); this.elements.push(e); return e; };
        this.addTarget = (x, y, r) => { const e = makeTarget(x, y, r); this.elements.push(e); return e; };
        this.addFluorescent = (x, y, r, o) => { const e = makeFluorescent(x, y, r, o); e.engine = this; this.elements.push(e); return e; };
        this.addPrism = (cx, cy, size, a, o) => { const e = makePrism(cx, cy, size, a, o); this.elements.push(e); return e; };
        this.addLens = (cx, cy, len, a, f, o) => { const e = makeLens(cx, cy, len, a, f, o); this.elements.push(e); return e; };
        this.addSphericalMirror = (cx, cy, ap, a, f, o) => { const e = makeSphericalMirror(cx, cy, ap, a, f, o); this.elements.push(e); return e; };

        // 新增（高阶元件）
        this.addParabolicMirror = (cx, cy, ap, a, f, o) => { const e = makeParabolicMirror(cx, cy, ap, a, f, o); this.elements.push(e); return e; };
        this.addThickLens = (cx, cy, ap, a, t, ior, o) => { const e = makeThickLens(cx, cy, ap, a, t, ior, o); this.elements.push(e); return e; };

        // 清空
        this.clear = () => { this.elements.length = 0; this.segments.length = 0; };
    }

    // ----- 原有：单条光线追踪（保留） -----
    PrismEngine.prototype.trace = function (ray, depth = 0) {
        if (depth > MAX_BOUNCE || ray.intensity < MIN_INTENSITY) return;

        let nearest = null;
        for (const el of this.elements) {
            if (!el.intersect) continue;
            if (ray.ignoreElement === el) continue;
            const hit = el.intersect(ray);
            if (hit && (!nearest || hit.t < nearest.hit.t)) {
                nearest = { el, hit };
            }
        }

        if (!nearest) {
            const far = V.add(ray.origin, V.mul(ray.dir, FAR_DISTANCE));
            this.segments.push({ from: ray.origin, to: far, ray });
            return;
        }

        const { el, hit } = nearest;
        const segLen = V.len(V.sub(hit.point, ray.origin));
        this.segments.push({
            from: ray.origin, to: hit.point, ray,
            hitPoint: hit.point, hitNormal: hit.normal,
            drawNormal: (el.type === 'mirror' || el.type === 'glass' || el.type === 'water'),
        });

        let newI = distanceAttenuation(ray.intensity, segLen, ray.isParallel);
        if (el.type === 'water' && el.isMilky && pointInRect(ray.origin, el.rect)) {
            newI = mediumAttenuation(newI, segLen, el.kMedium);
        }

        const newRay = { ...ray, intensity: newI };
        const nextRays = el.interact(newRay, hit);
        for (const nr of nextRays) {
            this.trace(nr, depth + 1);
        }
    };

    // ----- 原有：平行光带追踪（保留） -----
    PrismEngine.prototype.traceParallelLight = function (light) {
        const dir = V.fromAngle(light.angle);
        const perp = V.perp(dir);
        const halfW = light.width / 2;

        const cuts = [-halfW, halfW];
        for (const el of this.elements) {
            if (!el.samplePoints || el === light) continue;
            for (const p of el.samplePoints()) {
                const rel = V.sub(p, light.pos);
                const along = V.dot(rel, dir);
                const side = V.dot(rel, perp);
                if (along > 0 && Math.abs(side) <= halfW) cuts.push(side);
            }
        }
        cuts.sort((a, b) => a - b);
        const uniq = [cuts[0]];
        for (let i = 1; i < cuts.length; i++) {
            if (cuts[i] - uniq[uniq.length - 1] > 1) uniq.push(cuts[i]);
        }

        const K = 96;
        const beamCount = uniq.length - 1;
        if (beamCount <= 0) return;

        for (let i = 0; i < beamCount; i++) {
            const left = uniq[i], right = uniq[i + 1];
            if (right - left < 0.5) continue;
            for (let j = 0; j < K; j++) {
                const t = K === 1 ? 0.5 : j / (K - 1);
                let side = left + (right - left) * t;
                const innerEps = 0.05;
                if (side === left) side += innerEps;
                else if (side === right) side -= innerEps;
                const origin = V.add(light.pos, V.mul(perp, side));
                this.trace({
                    origin, dir,
                    intensity: light.intensity / beamCount,
                    color: light.color,
                    isWhite: light.isWhite,
                    isParallel: true,
                    lambda: light.isWhite ? null : 550,
                    bounce: 0,
                    initialOrigin: light.pos,
                    initialDir: dir,
                    beamId: i,
                    beamSide: side,
                    fromParallelLight: true,
                });
            }
        }
    };

    // ============================================================
    // 新增：SPBT 高层接口
    // ============================================================

    // 单条光线追踪 → 分段数组
    function _traceBeamRay(elements, start, dir, maxDepth, onHit) {
        const segments = [];
        let pos = { x: start.x, y: start.y };
        let d = { x: dir.x, y: dir.y };

        for (let depth = 0; depth < maxDepth; depth++) {
            let nearest = null;
            for (const el of elements) {
                if (!el.intersect) continue;
                if (el.type === 'light' || el.type === 'parallelLight') continue;
                const hit = el.intersect({ origin: pos, dir: d });
                if (hit && (!nearest || hit.t < nearest.hit.t)) {
                    nearest = { el, hit };
                }
            }

            if (!nearest) {
                const far = { x: pos.x + d.x * FAR_DISTANCE, y: pos.y + d.y * FAR_DISTANCE };
                segments.push({ from: pos, to: far, dir: { ...d } });
                break;
            }

            const { el, hit } = nearest;
            segments.push({
                from: pos,
                to: hit.point,
                dir: { ...d },
                hit: { point: hit.point, normal: hit.normal, element: el },
            });

            if (onHit) onHit({
                point: hit.point, normal: hit.normal, element: el,
                depth, incidentDir: { ...d },
            });

            // 计算下一段方向
            const proxyRay = { origin: pos, dir: d, intensity: 1, bounce: depth, lambda: 550 };
            const nextRays = el.interact(proxyRay, hit);
            if (!nextRays || nextRays.length === 0) {
                // 无后续：终点
                break;
            }
            const nr = nextRays[0];
            d = { x: nr.dir.x, y: nr.dir.y };
            pos = { x: hit.point.x + d.x * SURFACE_OFFSET, y: hit.point.y + d.y * SURFACE_OFFSET };
        }

        return segments;
    }

    function _segmentsToPath(segs) {
        if (segs.length === 0) return [];
        const path = [segs[0].from];
        for (let i = 0; i < segs.length; i++) path.push(segs[i].to);
        return path;
    }

    // SPBT 主接口
    PrismEngine.prototype.traceBeam = function (light, opts = {}) {
        // 兼容两种 light 形式：
        //   1. 由 addParallelLight 创建的对象（有 pos / width / angle）
        //   2. 兼容旧版本 main.js 中的 { origin, dir, width }
        const origin = light.pos || light.origin;
        const angle = (light.angle !== undefined) ? light.angle : Math.atan2(light.dir.y, light.dir.x);
        const dir = V.fromAngle(angle);
        const perp = V.perp(dir);
        const halfW = light.width / 2;

        // 1. 收集采样点 → 切分
        const cuts = [-halfW, halfW];
        for (const el of this.elements) {
            if (!el.samplePoints || el === light) continue;
            if (el.type === 'light' || el.type === 'parallelLight') continue;
            for (const p of el.samplePoints()) {
                const rel = V.sub(p, origin);
                const along = V.dot(rel, dir);
                const side = V.dot(rel, perp);
                if (along > EPS && side > -halfW - EPS && side < halfW + EPS) {
                    cuts.push(side);
                }
            }
        }
        cuts.sort((a, b) => a - b);
        const finalCuts = [];
        for (const c of cuts) {
            if (finalCuts.length === 0 ||
                c - finalCuts[finalCuts.length - 1] > this.mergeEpsilon) {
                finalCuts.push(c);
            }
        }

        // 2. 每个子光带追踪两条边界光线
        const subBeams = [];
        const maxN = Math.min(finalCuts.length - 1, this.maxSubBeams);
        const maxDepth = this.maxDepth;
        const elements = this.elements;

        for (let i = 0; i < maxN; i++) {
            const sLeft = finalCuts[i];
            const sRight = finalCuts[i + 1];
            if (sRight - sLeft < EPS) continue;

            const leftStart = V.add(origin, V.mul(perp, sLeft));
            const rightStart = V.add(origin, V.mul(perp, sRight));

            const leftSegs = _traceBeamRay(elements, leftStart, dir, maxDepth, opts.onHit);
            const rightSegs = _traceBeamRay(elements, rightStart, dir, maxDepth, opts.onHit);

            if (leftSegs.length === 0 && rightSegs.length === 0) continue;

            subBeams.push({
                sLeft, sRight,
                leftStart, rightStart,
                leftSegs, rightSegs,
                leftPath: _segmentsToPath(leftSegs),
                rightPath: _segmentsToPath(rightSegs),
            });
        }

        return subBeams;
    };

    PrismEngine.prototype.traceRay = function (start, dir, opts = {}) {
        const segs = _traceBeamRay(this.elements, start, V.norm(dir), this.maxDepth, opts.onHit);
        return _segmentsToPath(segs);
    };

    PrismEngine.prototype.getBeamCuts = function (light) {
        const origin = light.pos || light.origin;
        const angle = (light.angle !== undefined) ? light.angle : Math.atan2(light.dir.y, light.dir.x);
        const dir = V.fromAngle(angle);
        const perp = V.perp(dir);
        const halfW = light.width / 2;
        const cuts = [];
        for (const el of this.elements) {
            if (!el.samplePoints || el === light) continue;
            if (el.type === 'light' || el.type === 'parallelLight') continue;
            for (const p of el.samplePoints()) {
                const rel = V.sub(p, origin);
                const along = V.dot(rel, dir);
                const side = V.dot(rel, perp);
                if (along > EPS && side > -halfW - EPS && side < halfW + EPS) {
                    cuts.push(side);
                }
            }
        }
        cuts.sort((a, b) => a - b);
        return cuts;
    };

    PrismEngine.prototype.getAllSamples = function () {
        const out = [];
        for (const el of this.elements) {
            if (!el.samplePoints) continue;
            for (const p of el.samplePoints()) {
                out.push({ x: p.x, y: p.y, element: el });
            }
        }
        return out;
    };

    PrismEngine.prototype.testHit = function (light, target, radius = 4) {
        const subBeams = this.traceBeam(light);
        const r2 = radius * radius;
        const near = (path, t) => {
            for (const p of path) {
                const dx = p.x - t.x, dy = p.y - t.y;
                if (dx * dx + dy * dy <= r2) return true;
            }
            return false;
        };
        for (const sb of subBeams) {
            if (near(sb.leftPath, target)) return true;
            if (near(sb.rightPath, target)) return true;
        }
        return false;
    };

    // 链式构建器
    function SceneBuilder(engine) { this.engine = engine; }
    SceneBuilder.prototype.mirror = function (x, y, a, l) { this.engine.addMirror(x, y, a, l); return this; };
    SceneBuilder.prototype.glass = function (x, y, w, h, o) { this.engine.addGlass(x, y, w, h, o); return this; };
    SceneBuilder.prototype.water = function (x, y, w, h, o) { this.engine.addWater(x, y, w, h, o); return this; };
    SceneBuilder.prototype.obstacle = function (x, y, w, h) { this.engine.addObstacle(x, y, w, h); return this; };
    SceneBuilder.prototype.light = function (x, y, a, o) { this.engine.addLight(x, y, a, o); return this; };
    SceneBuilder.prototype.parallelLight = function (x, y, a, o) { this.engine.addParallelLight(x, y, a, o); return this; };
    SceneBuilder.prototype.target = function (x, y, r) { this.engine.addTarget(x, y, r); return this; };
    SceneBuilder.prototype.fluorescent = function (x, y, r, o) { this.engine.addFluorescent(x, y, r, o); return this; };
    SceneBuilder.prototype.prism = function (cx, cy, s, a, o) { this.engine.addPrism(cx, cy, s, a, o); return this; };
    SceneBuilder.prototype.lens = function (cx, cy, len, a, f, o) { this.engine.addLens(cx, cy, len, a, f, o); return this; };
    SceneBuilder.prototype.sphericalMirror = function (cx, cy, ap, a, f, o) { this.engine.addSphericalMirror(cx, cy, ap, a, f, o); return this; };
    SceneBuilder.prototype.parabolicMirror = function (cx, cy, ap, a, f, o) { this.engine.addParabolicMirror(cx, cy, ap, a, f, o); return this; };
    SceneBuilder.prototype.thickLens = function (cx, cy, ap, a, t, ior, o) { this.engine.addThickLens(cx, cy, ap, a, t, ior, o); return this; };
    SceneBuilder.prototype.done = function () { return this.engine; };

    PrismEngine.prototype.scene = function () { return new SceneBuilder(this); };

    // 光带插值工具
    function interpolateBeam(subBeam, t) {
        const { leftPath, rightPath } = subBeam;
        const n = Math.min(leftPath.length, rightPath.length);
        const path = [];
        for (let i = 0; i < n; i++) {
            path.push({
                x: leftPath[i].x * (1 - t) + rightPath[i].x * t,
                y: leftPath[i].y * (1 - t) + rightPath[i].y * t,
            });
        }
        return path;
    }

    function getBeamPaths(engine, light) {
        return engine.traceBeam(light);
    }

    function traceAllBeams(engine, opts = {}) {
        const result = [];
        for (const light of engine.elements) {
            if (light.type === 'parallelLight') {
                result.push({ light, subBeams: engine.traceBeam(light, opts) });
            }
        }
        return result;
    }

    function createEngine(opts = {}) {
        const engine = new PrismEngine({
            width: opts.width, height: opts.height,
        });
        if (opts.maxDepth !== undefined) engine.maxDepth = opts.maxDepth;
        if (opts.maxSubBeams !== undefined) engine.maxSubBeams = opts.maxSubBeams;
        if (opts.mergeEpsilon !== undefined) engine.mergeEpsilon = opts.mergeEpsilon;
        if (opts.debug !== undefined) engine.debug = opts.debug;

        // 兼容 canvas 选项
        if (opts.canvas) {
            engine.canvas = opts.canvas;
            engine.ctx = opts.canvas.getContext('2d');
            engine.width = opts.canvas.width;
            engine.height = opts.canvas.height;
        }
        return engine;
    }

    // ----- 原有：update / render / pickAt / allTargetsLit / getSegments（保留） -----
    PrismEngine.prototype.update = function () {
        this.segments.length = 0;
        for (const el of this.elements) if (el.type === 'target') el.lit = false;

        for (const el of this.elements) {
            if (el.type === 'light') {
                this.trace({
                    origin: el.pos,
                    dir: V.fromAngle(el.angle),
                    intensity: el.intensity,
                    color: el.color,
                    isWhite: el.isWhite,
                    isParallel: el.isParallel,
                    lambda: el.isWhite ? null : 550,
                    bounce: 0,
                    initialOrigin: el.pos,
                    initialDir: V.fromAngle(el.angle),
                });
            } else if (el.type === 'parallelLight') {
                this.traceParallelLight(el);
            }
        }
    };

    PrismEngine.prototype.render = function (ctx) {
        ctx.clearRect(0, 0, this.width, this.height);

        ctx.strokeStyle = 'rgba(60,60,100,0.15)';
        ctx.lineWidth = 1;
        for (let x = 0; x < this.width; x += 50) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, this.height); ctx.stroke();
        }
        for (let y = 0; y < this.height; y += 50) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(this.width, y); ctx.stroke();
        }

        for (const el of this.elements) if (el.draw) el.draw(ctx);

        for (const seg of this.segments) {
            if (seg.ray.beamId !== undefined) continue;
            const c = seg.ray.color || '#ffffff';
            ctx.save();
            ctx.strokeStyle = c;
            ctx.shadowColor = c;
            ctx.shadowBlur = 12;
            ctx.globalAlpha = Math.min(1, seg.ray.intensity * 1.2);
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(seg.from.x, seg.from.y);
            ctx.lineTo(seg.to.x, seg.to.y);
            ctx.stroke();
            ctx.restore();
        }

        const beams = new Map();
        for (const seg of this.segments) {
            if (seg.ray.beamId === undefined) continue;
            const key = seg.ray.initialOrigin.x + ',' + seg.ray.initialOrigin.y +
                        '|' + seg.ray.beamId +
                        '|' + (seg.ray.lambda ?? 'w');
            if (!beams.has(key)) beams.set(key, []);
            beams.get(key).push(seg);
        }
        for (const segs of beams.values()) {
            const byBounce = new Map();
            for (const s of segs) {
                const b = s.ray.bounce;
                if (!byBounce.has(b)) byBounce.set(b, []);
                byBounce.get(b).push(s);
            }
            for (const group of byBounce.values()) {
                const dir = group[0].ray.dir;
                const perp = { x: -dir.y, y: dir.x };
                group.sort((a, b) =>
                    (a.from.x * perp.x + a.from.y * perp.y) -
                    (b.from.x * perp.x + b.from.y * perp.y)
                );
                for (let i = 0; i < group.length - 1; i++) {
                    const s1 = group[i], s2 = group[i + 1];
                    const span = Math.hypot(s1.from.x - s2.from.x, s1.from.y - s2.from.y);
                    if (span > 500) continue;
                    ctx.save();
                    ctx.globalAlpha = Math.min(0.25, s1.ray.intensity * 0.4);
                    ctx.fillStyle = s1.ray.color || '#ffffff';
                    ctx.beginPath();
                    ctx.moveTo(s1.from.x, s1.from.y);
                    ctx.lineTo(s1.to.x, s1.to.y);
                    ctx.lineTo(s2.to.x, s2.to.y);
                    ctx.lineTo(s2.from.x, s2.from.y);
                    ctx.closePath();
                    ctx.fill();
                    ctx.restore();
                }
            }
        }

        const edgeGroups = new Map();
        for (const seg of this.segments) {
            if (seg.ray.beamId === undefined) continue;
            const key = seg.ray.initialOrigin.x + ',' + seg.ray.initialOrigin.y +
                        '|' + seg.ray.beamId +
                        '|' + (seg.ray.lambda ?? 'w') +
                        '|' + seg.ray.bounce;
            if (!edgeGroups.has(key)) edgeGroups.set(key, []);
            edgeGroups.get(key).push(seg);
        }
        for (const group of edgeGroups.values()) {
            if (group.length < 1) continue;
            const dir = group[0].ray.dir;
            const perp = { x: -dir.y, y: dir.x };
            group.sort((a, b) =>
                (a.from.x * perp.x + a.from.y * perp.y) -
                (b.from.x * perp.x + b.from.y * perp.y)
            );
            const edges = group.length === 1
                ? [group[0]]
                : [group[0], group[group.length - 1]];
            for (const seg of edges) {
                const c = seg.ray.color || '#ffffff';
                ctx.save();
                ctx.strokeStyle = c;
                ctx.globalAlpha = Math.min(0.9, seg.ray.intensity * 1.2);
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(seg.from.x, seg.from.y);
                ctx.lineTo(seg.to.x, seg.to.y);
                ctx.stroke();
                ctx.restore();
            }
        }

        const NORMAL_LEN = 40;
        const normalDrawn = new Set();
        for (const seg of this.segments) {
            if (!seg.drawNormal || !seg.hitNormal) continue;
            if (seg.ray.fromParallelLight) continue;
            const p = seg.hitPoint, n = seg.hitNormal;
            const k = p.x.toFixed(1) + ',' + p.y.toFixed(1);
            if (normalDrawn.has(k)) continue;
            normalDrawn.add(k);
            const a = V.add(p, V.mul(n,  NORMAL_LEN));
            const b = V.add(p, V.mul(n, -NORMAL_LEN));
            ctx.save();
            ctx.strokeStyle = 'rgba(255,255,180,0.6)';
            ctx.setLineDash([4, 4]);
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
            ctx.restore();
        }
    };

    PrismEngine.prototype.pickAt = function (mx, my) {
        const p = { x: mx, y: my };
        for (const el of this.elements) {
            if (el.type === 'mirror') {
                if (V.len(V.sub(p, el.a)) < 14 || V.len(V.sub(p, el.b)) < 14) return el;
                if (V.len(V.sub(p, el.pos)) < 30) return el;
            } else if (el.type === 'light' || el.type === 'parallelLight') {
                if (V.len(V.sub(p, el.pos)) < 30) return el;
            } else if (el.type === 'glass' || el.type === 'water' || el.type === 'obstacle') {
                if (pointInRect(p, el.rect)) return el;
            } else if (el.type === 'prism') {
                if (pointInPolygon(p, el.pts)) return el;
                if (V.len(V.sub(p, el.pos)) < 30) return el;
            } else if (el.type === 'lens') {
                if (V.len(V.sub(p, el.a)) < 14 || V.len(V.sub(p, el.b)) < 14) return el;
                if (V.len(V.sub(p, el.pos)) < 30) return el;
            } else if (el.type === 'sphericalMirror' || el.type === 'parabolicMirror') {
                if (V.len(V.sub(p, el.vertex)) < 20) return el;
                if (V.len(V.sub(p, el.pos)) < 30) return el;
            } else if (el.type === 'thickLens') {
                if (V.len(V.sub(p, el.pos)) < 30) return el;
            } else if (el.type === 'target' || el.type === 'fluorescent') {
                if (V.len(V.sub(p, el.pos)) < el.radius + 6) return el;
            }
        }
        return null;
    };

    PrismEngine.prototype.allTargetsLit = function () {
        const targets = this.elements.filter(e => e.type === 'target');
        return targets.length > 0 && targets.every(e => e.lit);
    };

    PrismEngine.prototype.getSegments = function () {
        return this.segments;
    };

    /* ============================================================
       导出
       ============================================================ */
    const API = {
        Engine: PrismEngine,
        V,
        // 顶层工具（来自 main.js）
        createEngine,
        SceneBuilder,
        interpolateBeam,
        getBeamPaths,
        traceAllBeams,
        // 元件工厂（方便直接 new）
        makeMirror,
        makeGlass,
        makeWater,
        makeLens,
        makeSphericalMirror,
        makeParabolicMirror,
        makeThickLens,
        makePrism,
        makeObstacle,
        makeLight,
        makeParallelLight,
        makeTarget,
        makeFluorescent,
        version: '1.2.0',
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = API;
        module.exports.default = API;
    }
    global.XGSPBT = Object.assign(global.XGSPBT || {}, API);

})(typeof window !== 'undefined' ? window : globalThis);