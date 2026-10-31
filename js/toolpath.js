/* Toolpath generation: clearing hatch + isolation contours with area-based power management.
 *
 * Power model
 *   Every copper island (connected copper, minus its holes) has an area A.
 *   Islands smaller than `areaRef` get a scale s = (A/areaRef)^exp in [0,1].
 *   The laser power inside an "influence zone" around such an island is
 *       P = minPower + (power - minPower) * s
 *   Optionally the same law is applied to the area of each separate cleared patch,
 *   and to the length of each hatch line (short lines have little cool-down time).
 *   Where several rules overlap the smallest s wins.
 */
(function () {
  'use strict';
  const CL = globalThis.ClipperLib;
  const LG = (globalThis.LG = globalThis.LG || {});
  const S = LG.SCALE;

  LG.defaults = {
    mode: 'clear', // 'clear' | 'isolate'
    target: 'around', // 'around' = clear around the features (copper); 'features' = remove the features (mask / paste)
    // geometry
    beamX: 0.04, // mm, spot size across X (the dot is an ellipse; a round spot has beamX = beamY)
    beamY: 0.08, // mm, spot size across Y
    dirComp: true, // scale power with the line width the spot cuts in the travel direction (constant dose)
    clearance: 0.05, // mm, extra standoff from copper edge
    margin: 1.0, // mm, clearing border around copper bbox
    // hatching
    angle: 0, // deg
    spacing: 0.08, // mm
    autoSpacing: true, // spacing = spacingPct % of the line width at the hatch angle
    spacingPct: 80,
    crossHatch: false,
    direction: 'serpentine', // 'serpentine' | 'forward' | 'reverse'
    interleave: 1, // process every Nth line, then the next offset (cool-down)
    passes: 1,
    // isolation
    isoPasses: 2,
    clearStyle: 'hatch', // clear mode: 'hatch' = scan lines, 'contour' = concentric passes out from the copper edge
    contourMax: 8, // clear mode, contour style: most passes from each copper edge (0 = until the area is clear)
    isoOverlap: 0.2,
    fillIslands: true, // hatch away resist strips / specks left between isolation passes
    fillWidth: 0.3, // mm, leftover resist strips narrower than this are cleared
    fillMaxArea: 0.5, // mm^2, enclosed pockets of leftover resist up to this size are cleared
    fillIgnore: 0.02, // mm^2, leftover pieces smaller than this are ignored (corner blips)
    // motion / power
    feed: 1500, // mm/min
    rapid: 3000, // mm/min, only for time estimate
    power: 80, // % baseline
    minPower: 15, // %
    islandDerate: true,
    areaRef: 4, // mm^2, islands >= this get full baseline power
    areaExp: 0.5,
    influence: 0.5, // mm around a small island that is derated
    falloff: 'fade', // 'fade' = power rises back to baseline across the influence distance; 'step' = flat inside it
    ablateMin: 0, // % power below which the resist no longer clears cleanly (0 = unknown / off)
    ablateClamp: false, // raise the effective minimum power to the threshold
    patchDerate: false,
    patchRef: 6, // mm^2
    lineDerate: false,
    lineRef: 1.5, // mm
    // machine
    sMax: 1000,
    laserMode: 'M4',
    mirrorX: false,
    zeroAtCorner: true,
    offsetX: 0,
    offsetY: 0,
    header: 'G21 ; mm\nG90 ; absolute\nG17',
    footer: 'G0 X0 Y0',
  };

  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const areaMm2 = (path) => CL.Clipper.Area(path) / (S * S);

  function offsetPaths(paths, deltaMm) {
    if (!paths.length) return [];
    const co = new CL.ClipperOffset(2, 0.004 * S);
    co.AddPaths(paths, CL.JoinType.jtRound, CL.EndType.etClosedPolygon);
    const sol = new CL.Paths();
    co.Execute(sol, deltaMm * S);
    return sol;
  }

  /**
   * Offset by an ellipse with semi-axes rx (X) and ry (Y); `sign` < 0 erodes. An affine map commutes with
   * Minkowski sums, so scale Y until the ellipse is a circle, offset by it, and scale back.
   */
  function offsetEll(paths, rx, ry, sign) {
    if (!paths.length) return [];
    const d = sign < 0 ? -1 : 1;
    if (rx < 1e-9 && ry < 1e-9) return paths;
    if (Math.abs(rx - ry) < 1e-9) return offsetPaths(paths, d * rx);
    const f = rx / ry;
    const sc = (ps, k) => ps.map((p) => p.map((q) => ({ X: q.X, Y: Math.round(q.Y * k) })));
    return sc(offsetPaths(sc(paths, f), d * rx), 1 / f);
  }
  LG.offsetEll = offsetEll;

  /** Width of the line the elliptical spot cuts when travelling at angle th (rad): its extent perpendicular to travel. */
  const lineWidthAt = (P, th) => {
    const a = P.beamX / 2, b = P.beamY / 2;
    return 2 * Math.sqrt(a * a * Math.sin(th) ** 2 + b * b * Math.cos(th) ** 2);
  };
  LG.lineWidthAt = lineWidthAt;
  /** Power multiplier that keeps energy per unit area constant: narrower lines concentrate the same energy. */
  const dirK = (P, th) => (P.dirComp ? lineWidthAt(P, th) / Math.max(P.beamX, P.beamY) : 1);

  /** Group a polygon set into islands: outer contour + holes, with net area. */
  function groups(paths) {
    const c = new CL.Clipper();
    c.AddPaths(paths, CL.PolyType.ptSubject, true);
    const tree = new CL.PolyTree();
    c.Execute(CL.ClipType.ctUnion, tree, CL.PolyFillType.pftNonZero, CL.PolyFillType.pftNonZero);
    const out = [];
    (function walk(node) {
      for (const ch of node.Childs()) {
        if (ch.IsHole()) continue;
        const ps = [ch.Contour()];
        let a = Math.abs(areaMm2(ch.Contour()));
        for (const h of ch.Childs()) {
          ps.push(h.Contour());
          a -= Math.abs(areaMm2(h.Contour()));
          walk(h);
        }
        out.push({ paths: ps, area: a });
      }
    })(tree);
    return out;
  }

  function bboxOf(paths) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of paths) for (const q of p) {
      if (q.X < x0) x0 = q.X; if (q.X > x1) x1 = q.X;
      if (q.Y < y0) y0 = q.Y; if (q.Y > y1) y1 = q.Y;
    }
    return { x0: x0 / S, y0: y0 / S, x1: x1 / S, y1: y1 / S };
  }

  function pointInPaths(px, py, paths) {
    let inside = false;
    for (const p of paths) {
      for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
        const yi = p[i].Y / S, yj = p[j].Y / S;
        if ((yi > py) !== (yj > py)) {
          const xi = p[i].X / S, xj = p[j].X / S;
          if (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
        }
      }
    }
    return inside;
  }

  LG.pointInPaths = pointInPaths;

  /**
   * Find places where copper features are closer than T mm (the narrowest gap the toolpath can resolve:
   * 2 x (tool radius + clearance)). The keep-outs of both features merge there, so no toolpath passes through
   * and the copper stays bridged. Wt is the physical tool width: gaps narrower than Wt are `severe`
   * (the tool cannot fit at all); the rest could be resolved by reducing the extra clearance.
   * Returns [{x, y, gap, severe}] sorted narrowest first (gap in mm, measured at the widest point).
   */
  LG.findNarrowGaps = function (copper, T, Wt, opt) {
    if (!copper.length || T <= 0) return [];
    // opt = {rx, ry, wx, wy}: per-axis reach (spot semi-axis + clearance) and spot width, for an elliptical spot
    const rx = Math.max(((opt && opt.rx) || T / 2) - 0.002, 0.001), ry = Math.max(((opt && opt.ry) || T / 2) - 0.002, 0.001);
    const closed = offsetEll(offsetEll(copper, rx, ry, 1), rx, ry, -1); // directional closing fills gaps the spot cannot enter
    const prob = LG.clip(CL.ClipType.ctDifference, closed, offsetPaths(copper, 0.01)); // drop corner slivers
    const segs = [];
    for (const p of copper) for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      segs.push([a.X / S, a.Y / S, b.X / S, b.Y / S]);
    }
    const distToCopper = (x, y) => {
      let best = T;
      for (const [ax, ay, bx, by] of segs) {
        if (x < Math.min(ax, bx) - best || x > Math.max(ax, bx) + best || y < Math.min(ay, by) - best || y > Math.max(ay, by) + best) continue;
        const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1e-12;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
        const d = Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
        if (d < best) best = d;
      }
      return best;
    };
    const out = [];
    for (const g of groups(prob)) {
      if (g.area < 0.1 * T * T) continue;
      const o = g.paths[0];
      let per = 0;
      for (let i = 0; i < o.length; i++) { const a = o[i], b = o[(i + 1) % o.length]; per += Math.hypot(b.X - a.X, b.Y - a.Y) / S; }
      const bb = bboxOf([o]);
      let gap = (2 * g.area) / per + 0.02, N = 8;
      for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
        const x = bb.x0 + ((bb.x1 - bb.x0) * i) / N, y = bb.y0 + ((bb.y1 - bb.y0) * j) / N;
        if (pointInPaths(x, y, g.paths)) gap = Math.max(gap, 2 * distToCopper(x, y));
      }
      // a strip wider than tall separates features vertically, so the spot's Y extent is what has to fit
      const wide = opt && opt.wx && opt.wy ? (bb.y1 - bb.y0 <= bb.x1 - bb.x0 ? opt.wy : opt.wx) : Wt;
      out.push({ x: (bb.x0 + bb.x1) / 2, y: (bb.y0 + bb.y1) / 2, gap, severe: gap < wide });
    }
    return out.sort((a, b) => a.gap - b.gap).slice(0, 300);
  };
  /** Human-readable warnings for a gap list. */
  LG.gapWarnings = function (gaps, T) {
    const sev = gaps.filter((g) => g.severe), mild = gaps.filter((g) => !g.severe), out = [];
    const at = (g) => `X${g.x.toFixed(1)} Y${g.y.toFixed(1)}`;
    if (sev.length) out.push(`${sev.length} spot(s) where copper features are closer than the tool is wide: they cannot be separated and will stay shorted. Narrowest ≈ ${sev[0].gap.toFixed(2)} mm at ${at(sev[0])}. Fix the design or use a finer tool.`);
    if (mild.length) out.push(`${mild.length} spot(s) are wide enough for the tool but narrower than the ${T.toFixed(2)} mm it needs including extra clearance. Lower "Extra clearance" to isolate them (widest ≈ ${mild[mild.length - 1].gap.toFixed(2)} mm).`);
    return out;
  };

  /** Mirror / re-origin the parsed gerber so that all later work is in machine coordinates. */
  LG.prepare = function (gb, P) {
    const bb = gb.bbox;
    let paths = gb.paths;
    const cx = Math.round((bb.minX + bb.maxX) * S);
    if (P.mirrorX) paths = paths.map((p) => p.map((q) => ({ X: cx - q.X, Y: q.Y })).reverse());
    const mb = bboxOf(paths);
    let dx = P.offsetX, dy = P.offsetY;
    if (P.zeroAtCorner) { dx -= mb.x0; dy -= mb.y0; }
    const ox = Math.round(dx * S), oy = Math.round(dy * S);
    if (ox || oy) paths = paths.map((p) => p.map((q) => ({ X: q.X + ox, Y: q.Y + oy })));
    const b = bboxOf(paths);
    return {
      paths, bbox: { minX: b.x0, minY: b.y0, maxX: b.x1, maxY: b.y1 }, warnings: gb.warnings,
      xf: { mirror: !!P.mirrorX, cx: cx / S, ox: ox / S, oy: oy / S },
    };
  };
  /** Apply the same mirror/origin transform used by prepare() to a point in mm. */
  LG.xfPt = (xf, x, y) => [(xf.mirror ? xf.cx - x : x) + xf.ox, y + xf.oy];
  LG.offsetPaths = offsetPaths;
  LG.groups = groups;
  LG.nearestOrder = nearestOrder;

  const islandScale = (area, P) => clamp01(Math.pow(Math.max(area, 0) / P.areaRef, P.areaExp));
  const powerFor = (s, P) => {
    const lo = P.ablateClamp ? Math.max(P.minPower, P.ablateMin || 0) : P.minPower;
    return Math.max(0, lo + (P.power - lo) * s);
  };

  /** Build scan lines for one hatch angle. Returns Map(patchIndex -> records). */
  function hatchPatches(patches, zones, angleDeg, spacing, P) {
    const a = (angleDeg * Math.PI) / 180, ct = Math.cos(a), st = Math.sin(a);
    const rot = (q) => [(q.X * ct + q.Y * st) / S, (-q.X * st + q.Y * ct) / S];
    const back = (u, v) => [u * ct - v * st, u * st + v * ct];

    // crossings of a polygon set with the scanline grid, bucketed by line index
    const crossings = (paths, into) => {
      for (const p of paths) {
        const n = p.length;
        let prev = rot(p[n - 1]);
        for (let i = 0; i < n; i++) {
          const cur = rot(p[i]);
          const [u0, v0] = prev, [u1, v1] = cur;
          prev = cur;
          if (v0 === v1) continue;
          const lo = Math.min(v0, v1), hi = Math.max(v0, v1);
          const k0 = Math.ceil(lo / spacing - 0.5), k1 = Math.ceil(hi / spacing - 0.5) - 1;
          const slope = (u1 - u0) / (v1 - v0);
          for (let k = k0; k <= k1; k++) {
            const v = (k + 0.5) * spacing;
            let arr = into.get(k);
            if (!arr) into.set(k, (arr = []));
            arr.push(u0 + (v - v0) * slope);
          }
        }
      }
    };
    const intervals = (xs) => {
      xs.sort((p, q) => p - q);
      const out = [];
      for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] > xs[i]) out.push([xs[i], xs[i + 1]]);
      return out;
    };

    // zone intervals per scanline
    const zoneLines = new Map();
    for (const z of zones) {
      const m = new Map();
      crossings(z.paths, m);
      for (const [k, xs] of m) {
        let arr = zoneLines.get(k);
        if (!arr) zoneLines.set(k, (arr = []));
        for (const [p, q] of intervals(xs)) arr.push({ a: p, b: q, s: z.s });
      }
    }

    const result = [];
    patches.forEach((patch) => {
      const m = new Map();
      crossings(patch.paths, m);
      const recs = [];
      const ks = [...m.keys()].sort((p, q) => p - q);
      ks.forEach((k, rank) => {
        const v = (k + 0.5) * spacing;
        const zl = zoneLines.get(k) || [];
        for (const [ia, ib] of intervals(m.get(k))) {
          if (ib - ia < 0.005) continue;
          let s0 = patch.s;
          if (P.lineDerate && P.lineRef > 0) s0 = Math.min(s0, clamp01((ib - ia) / P.lineRef));
          const bps = [ia, ib], ov = [];
          for (const z of zl) {
            if (z.b <= ia || z.a >= ib) continue;
            const oa = Math.max(ia, z.a), ob = Math.min(ib, z.b);
            ov.push({ a: oa, b: ob, s: z.s });
            bps.push(oa, ob);
          }
          bps.sort((p, q) => p - q);
          const pieces = [];
          for (let i = 0; i + 1 < bps.length; i++) {
            const pa = bps[i], pb = bps[i + 1];
            if (pb - pa < 1e-6) continue;
            const mid = (pa + pb) / 2;
            let s = s0;
            for (const o of ov) if (o.a <= mid && mid <= o.b && o.s < s) s = o.s;
            const last = pieces[pieces.length - 1];
            if (last && Math.abs(last.s - s) < 1e-4) last.b = pb;
            else pieces.push({ a: pa, b: pb, s });
          }
          recs.push({ k, rank, v, a: ia, b: ib, pieces });
        }
      });
      result.push({ recs, back });
    });
    return result;
  }

  function nearestOrder(items, startPt) {
    const left = items.slice(), out = [];
    let cur = startPt;
    while (left.length) {
      let bi = 0, bd = Infinity;
      for (let i = 0; i < left.length; i++) {
        const d = Math.hypot(left[i].c[0] - cur[0], left[i].c[1] - cur[1]);
        if (d < bd) { bd = d; bi = i; }
      }
      const it = left.splice(bi, 1)[0];
      out.push(it);
      cur = it.c;
    }
    return out;
  }

  LG.generate = function (gb, P) {
    const t0 = performance.now ? performance.now() : Date.now();
    const copper = gb.paths;
    const bb = gb.bbox;
    const ba = P.beamX / 2, bb2 = P.beamY / 2, cl = P.clearance;
    const rx0 = ba + cl, ry0 = bb2 + cl; // reach of the first pass from the copper edge, per axis
    const d0 = Math.max(rx0, ry0);
    const sPass = (i) => 1 + 2 * i * (1 - P.isoOverlap); // ellipse scale of pass i: steps by the line width in every direction
    const passEll = (i) => [sPass(i) * ba + cl, sPass(i) * bb2 + cl];
    const res = { stats: {}, fillRegion: [], copper, bbox: bb, cuts: [], zones: [], islands: [], patches: [], keepout: [], clearRegion: [], warnings: [] };

    // --- islands & influence zones -------------------------------------------------
    res.islands = groups(copper);
    const feat = P.target === 'features';
    res.gapT = 2 * d0;
    res.gaps = feat ? [] : LG.findNarrowGaps(copper, res.gapT, Math.max(P.beamX, P.beamY), { rx: rx0, ry: ry0, wx: P.beamX, wy: P.beamY });
    const zones = [];
    // power scale of the feature (island) that contains a point; used when the features themselves are cleared
    const islandAt = (x, y) => res.islands.find((i) => pointInPaths(x, y, i.paths));
    if (feat) {
      res.islands.forEach((i) => (i.s = P.islandDerate ? islandScale(i.area, P) : 1));
    } else if (P.islandDerate) {
      for (const isl of res.islands) {
        isl.s = islandScale(isl.area, P);
        if (isl.s < 0.9999) {
          // nested rings: innermost has the island's own scale, outer rings fade back towards full power
          const R = Math.max(P.influence, d0), K = P.falloff === 'fade' ? 4 : 1;
          for (let j = 0; j < K; j++) {
            const rj = j === K - 1 ? R : Math.max(d0 + 0.01, (R * (j + 1)) / K);
            const zp = offsetPaths(isl.paths, rj);
            if (zp.length) zones.push({ paths: zp, s: isl.s + ((1 - isl.s) * j) / K, bb: bboxOf(zp), area: isl.area });
          }
        }
      }
    } else res.islands.forEach((i) => (i.s = 1));
    res.zones = zones;

    const cuts = [];
    let hatchLen = 0;

    // hatch a patch set at the given angles, ordered nearest-first; appends to cuts, returns the end point
    const emitHatch = (patches, angles, from) => {
      let cur = from;
      for (const ang of angles) {
        const th = (ang * Math.PI) / 180, lw = lineWidthAt(P, th), k = dirK(P, th);
        const sp = P.autoSpacing ? Math.max(0.005, (P.spacingPct / 100) * lw) : P.spacing;
        if (!P.autoSpacing && sp > lw * 1.001) res.warnings.push(`Line spacing ${sp} mm is wider than the ${lw.toFixed(3)} mm line the spot cuts at ${ang}°: resist ridges will be left between lines.`);
        const hp = hatchPatches(patches, zones, ang, sp, P);
        const items = hp.map((h, i) => {
          const r = h.recs[0];
          const c = r ? h.back(r.a, r.v) : [0, 0];
          return { h, c };
        }).filter((it) => it.h.recs.length);
        for (const it of nearestOrder(items, cur)) {
          const { recs, back } = it.h;
          const n = Math.max(1, Math.round(P.interleave));
          // direction is decided per scan line (not per piece), so a line split by copper stays coherent
          const byRank = new Map();
          for (const rec of recs) { if (!byRank.has(rec.rank)) byRank.set(rec.rank, []); byRank.get(rec.rank).push(rec); }
          const order = [];
          let lineNo = 0;
          for (let r = 0; r < n; r++) {
            for (const rank of [...byRank.keys()].sort((p, q) => p - q)) {
              if (rank % n !== r) continue;
              const rev = P.direction === 'reverse' || (P.direction === 'serpentine' && lineNo % 2 === 1);
              lineNo++;
              const line = byRank.get(rank).sort((p, q) => p.a - q.a);
              for (const rec of rev ? line.slice().reverse() : line) order.push({ rec, rev });
            }
          }
          order.forEach(({ rec, rev }) => {
            const pcs = rev ? rec.pieces.slice().reverse() : rec.pieces;
            for (const pc of pcs) {
              const pa = rev ? pc.b : pc.a, pb = rev ? pc.a : pc.b;
              cuts.push({ pts: [back(pa, rec.v), back(pb, rec.v)], power: powerFor(pc.s, P) * k, s: pc.s });
            }
          });
          const last = cuts[cuts.length - 1];
          if (last) cur = last.pts[1];
        }
      }
      return cur;
    };


    // concentric passes out from every copper edge (into the features when clearing them), power sampled from
    // influence zones. `clip` {x0,y0,x1,y1} trims passes to a box without tracing its edge. Returns {cur, used}.
    const emitContours = (from, maxN, clip, setKeep, src = copper) => {
      let cur = from, used = 0;
      for (let i = 0; i < maxN; i++) {
        const [px_, py_] = passEll(i);
        const loops = offsetEll(src, px_, py_, feat ? -1 : 1);
        if (i === 0 && setKeep) res.keepout = loops;
        const before = cuts.length;
        const items = loops.filter((l) => l.length > 2);
        while (items.length) {
          // next loop = the one with a vertex nearest the laser; start it at that vertex so travel stays short
          let bi = 0, bj = 0, bd = Infinity;
          items.forEach((l, k) => { for (let j = 0; j < l.length; j++) { const d = Math.hypot(l[j].X / S - cur[0], l[j].Y / S - cur[1]); if (d < bd) { bd = d; bi = k; bj = j; } } });
          const lp = items.splice(bi, 1)[0];
          const pts = lp.slice(bj).concat(lp.slice(0, bj)).map((q) => [q.X / S, q.Y / S]);
          pts.push(pts[0]);
          let run = null;
          const flushRun = () => { if (run && run.pts.length > 1) cuts.push(run); run = null; };
          for (let j = 1; j < pts.length; j++) {
            const [x0, y0] = pts[j - 1], [x1, y1] = pts[j];
            const len = Math.hypot(x1 - x0, y1 - y0);
            const n = Math.max(1, Math.ceil(len / 0.2));
            for (let t = 0; t < n; t++) {
              const ax = x0 + ((x1 - x0) * t) / n, ay = y0 + ((y1 - y0) * t) / n;
              const bx = x0 + ((x1 - x0) * (t + 1)) / n, by = y0 + ((y1 - y0) * (t + 1)) / n;
              const mx = (ax + bx) / 2, my = (ay + by) / 2;
              let s = 1;
              if (feat) { const isl = islandAt(mx, my); if (isl) s = isl.s; }
              for (const z of zones) {
                if (mx < z.bb.x0 || mx > z.bb.x1 || my < z.bb.y0 || my > z.bb.y1) continue;
                if (z.s < s && pointInPaths(mx, my, z.paths)) s = z.s;
              }
              if (clip && (mx < clip.x0 || mx > clip.x1 || my < clip.y0 || my > clip.y1)) { flushRun(); continue; }
            const pw = powerFor(s, P) * dirK(P, Math.atan2(y1 - y0, x1 - x0));
              if (run && Math.abs(run.s - s) < 1e-4 && Math.abs(run.power - pw) < 1.5) run.pts.push([bx, by]);
              else { flushRun(); run = { pts: [[ax, ay], [bx, by]], power: pw, s }; }
            }
          }
          flushRun();
          cur = pts[0];
        }
        if (!loops.length || (clip && cuts.length === before)) break; // erosion is empty / every pass is outside the box
        used++;
      }
      return { cur, used };
    };

    // hatch away the thin resist strips and specks the passes could not reach, so no stray copper is left
    const emitFill = (from, used, edge) => {
      const ins = 2 * Math.max(P.beamX, P.beamY); // stay off the edge of the cleared area
      const box = (g) => [
        { X: Math.round((bb.minX - g) * S), Y: Math.round((bb.minY - g) * S) },
        { X: Math.round((bb.maxX + g) * S), Y: Math.round((bb.minY - g) * S) },
        { X: Math.round((bb.maxX + g) * S), Y: Math.round((bb.maxY + g) * S) },
        { X: Math.round((bb.minX - g) * S), Y: Math.round((bb.maxY + g) * S) },
      ];
      // what the beam really swept: the actual pass lines, widened by the spot. Where two fronts merge the pass
      // lines stop, so this (unlike a plain offset of the copper) keeps the strip that is left between them.
      const f = ba / bb2, co = new CL.ClipperOffset(2, 0.002 * S);
      const cov = new CL.Clipper();
      cov.AddPaths(offsetEll(copper, cl, cl, 1), CL.PolyType.ptSubject, true); // protected standoff
      for (let i = 0; i < used; i++) {
        const [qx, qy] = passEll(i);
        const loops = offsetEll(copper, qx, qy, feat ? -1 : 1).filter((l) => l.length > 2);
        co.Clear();
        co.AddPaths(loops.map((l) => l.map((q) => ({ X: q.X, Y: Math.round(q.Y * f) }))), CL.JoinType.jtRound, CL.EndType.etClosedLine);
        const band = new CL.Paths();
        co.Execute(band, ba * S);
        cov.AddPaths(band.map((l) => l.map((q) => ({ X: q.X, Y: Math.round(q.Y / f) }))), CL.PolyType.ptSubject, true);
      }
      const covered = new CL.Paths();
      cov.Execute(CL.ClipType.ctUnion, covered, CL.PolyFillType.pftNonZero, CL.PolyFillType.pftNonZero);
      const left = LG.clip(CL.ClipType.ctDifference, [box(edge - ins)], covered);
      const w2 = P.fillWidth / 2;
      const opened = offsetPaths(offsetPaths(left, -w2), w2);
      const narrow = LG.clip(CL.ClipType.ctDifference, left, offsetPaths(opened, 0.005));
      const specks = [];
      for (const g of groups(left)) if (g.area < P.fillMaxArea) specks.push(...g.paths);
      // grow so a strip thinner than the line spacing still gets a scan line; never into the copper standoff
      const lw0 = lineWidthAt(P, (P.angle * Math.PI) / 180);
      const grow = Math.max(0.02, P.autoSpacing ? (P.spacingPct / 100) * lw0 : P.spacing); // wide enough that a scan line always lands in it
      // a piece smaller than fillIgnore is a corner blip, not a strip worth a burn of its own
      const pieces = groups(LG.clip(CL.ClipType.ctUnion, narrow, specks));
      res.fillAreas = pieces.map((g) => g.area);
      const keep = pieces.filter((g) => g.area >= P.fillIgnore).flatMap((g) => g.paths);
      res.stats.fillIgnored = pieces.length - groups(keep).length;
      const fill = LG.clip(CL.ClipType.ctDifference,
        offsetPaths(keep, grow), offsetEll(copper, rx0, ry0, 1));
      const fp = groups(fill).filter((g) => g.area > 0.002);
      fp.forEach((g) => (g.s = 1));
      res.fillRegion = fp.flatMap((g) => g.paths);
      res.stats.fillPatches = fp.length;
      const angles = [P.angle];
      if (P.crossHatch) angles.push(P.angle + 90);
      return fp.length ? emitHatch(fp, angles, from) : from;
    };

    if (P.mode === 'clear') {
      res.keepout = feat ? [] : offsetEll(copper, rx0, ry0, 1);
      const m = P.margin;
      const rect = [
        { X: Math.round((bb.minX - m) * S), Y: Math.round((bb.minY - m) * S) },
        { X: Math.round((bb.maxX + m) * S), Y: Math.round((bb.minY - m) * S) },
        { X: Math.round((bb.maxX + m) * S), Y: Math.round((bb.maxY + m) * S) },
        { X: Math.round((bb.minX - m) * S), Y: Math.round((bb.maxY + m) * S) },
      ];
      // 'features': the cleared area is the features, pulled in so the beam edge lands on the feature boundary
      res.clearRegion = feat ? offsetEll(copper, rx0, ry0, -1) : LG.clip(CL.ClipType.ctDifference, [rect], res.keepout);
      const patches = groups(res.clearRegion);
      patches.forEach((p) => {
        if (feat) {
          const q = p.paths[0][0], isl = islandAt(q.X / S, q.Y / S);
          p.s = isl ? isl.s : 1;
          if (isl) p.featArea = isl.area;
        } else p.s = P.patchDerate ? islandScale(p.area, { areaRef: P.patchRef, areaExp: P.areaExp }) : 1;
      });
      res.patches = patches;

      let cur = [bb.minX, bb.minY];
      if (P.clearStyle === 'contour') {
        // outside in: trace the edge of the cleared area next to the copper, then step away from it until the area
        // is clear (or `contourMax` passes). Nothing outside the copper's bounding box is cleared: that edge is cut away
        // with the board outline, so the clearing border is ignored here.
        const clip = feat ? null : { x0: bb.minX, y0: bb.minY, x1: bb.maxX, y1: bb.maxY };
        let used = 0;
        const maxN = P.contourMax > 0 ? P.contourMax : 400;
        for (let rep = 0; rep < P.passes; rep++) {
          if (feat) {
            // finish each pad completely (all its passes, outside in) before moving to the nearest unfinished one
            const left = res.islands.slice();
            while (left.length) {
              let bi = 0, bd = Infinity;
              left.forEach((isl, k) => {
                for (const q of isl.paths[0]) { const d = Math.hypot(q.X / S - cur[0], q.Y / S - cur[1]); if (d < bd) { bd = d; bi = k; } }
              });
              cur = emitContours(cur, maxN, null, false, left.splice(bi, 1)[0].paths).cur;
            }
          } else {
            const r = emitContours(cur, maxN, clip, false);
            cur = r.cur; used = r.used;
          }
        }
        if (P.fillIslands && !feat) emitFill(cur, used, 0);
      } else {
        const angles = [P.angle];
        if (P.crossHatch) angles.push(P.angle + 90);
        for (let rep = 0; rep < P.passes; rep++) cur = emitHatch(patches, angles, cur);
      }
    } else {
      // isolation: concentric offsets of all copper, power sampled from influence zones
      let cur = [bb.minX, bb.minY];
      for (let rep = 0; rep < P.passes; rep++) cur = emitContours(cur, P.isoPasses, null, true).cur;
      if (P.fillIslands && !feat) emitFill(cur, P.isoPasses, P.margin);
    }

    res.cuts = cuts;
    const fillCount = res.stats && res.stats.fillPatches, fillIgn = res.stats && res.stats.fillIgnored;
    res.stats = LG.stats(cuts, P);
    res.stats.fillPatches = fillCount || 0;
    res.stats.fillIgnored = fillIgn || 0;
    res.stats.islands = res.islands.length;
    res.stats.derated = res.islands.filter((i) => i.s < 0.9999).length;
    res.stats.genMs = Math.round((performance.now ? performance.now() : Date.now()) - t0);
    return res;
  };

  LG.stats = function (cuts, P) {
    let cutLen = 0, rapidLen = 0, pSum = 0, pMin = Infinity, pMax = -Infinity;
    const hist = new Array(21).fill(0); // 5% buckets by length
    let px = null, py = null;
    for (const c of cuts) {
      const [sx, sy] = c.pts[0];
      if (px !== null && Math.hypot(sx - px, sy - py) > 1e-4) rapidLen += Math.hypot(sx - px, sy - py);
      for (let i = 1; i < c.pts.length; i++) {
        const l = Math.hypot(c.pts[i][0] - c.pts[i - 1][0], c.pts[i][1] - c.pts[i - 1][1]);
        cutLen += l; pSum += l * c.power;
        hist[Math.min(20, Math.round(c.power / 5))] += l;
      }
      if (c.power < pMin) pMin = c.power;
      if (c.power > pMax) pMax = c.power;
      const e = c.pts[c.pts.length - 1];
      px = e[0]; py = e[1];
    }
    let below = 0;
    if (P.ablateMin > 0) for (const c of cuts) if (c.power < P.ablateMin - 1e-6) for (let i = 1; i < c.pts.length; i++) below += Math.hypot(c.pts[i][0] - c.pts[i - 1][0], c.pts[i][1] - c.pts[i - 1][1]);
    const minutes = cutLen / P.feed + rapidLen / P.rapid;
    return {
      cuts: cuts.length, cutLen, rapidLen, minutes, belowLen: below,
      pMean: cutLen ? pSum / cutLen : 0, pMin: cuts.length ? pMin : 0, pMax: cuts.length ? pMax : 0, hist,
    };
  };
})();
