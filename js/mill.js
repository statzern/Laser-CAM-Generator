/* Milling: isolation routing (V-bit / endmill), drilling, outline + slots with tabs.
 * Z=0 is the copper surface; cuts go to negative Z. Everything is in the same machine frame as the laser path. */
(function () {
  'use strict';
  const CL = globalThis.ClipperLib;
  const LG = (globalThis.LG = globalThis.LG || {});
  const S = LG.SCALE;

  Object.assign(LG.defaults, {
    process: 'laser', // 'laser' | 'mill'
    toolType: 'vbit', vTip: 0.1, vAngle: 30, endDia: 0.2,
    isoDepth: 0.08, mPasses: 3, mOverlap: 0.3,
    mFeed: 300, mPlunge: 100, spindle: 10000, zSafe: 3, zClear: 0.5,
    doIso: true, doDrill: true, doOutline: true,
    drillVias: true, drillDepth: 1.9, drillFeed: 60, peck: 0, millHolesAbove: 0,
    outTool: 1.0, outDepth: 1.9, outStep: 0.6, outFeed: 150, outPlunge: 50,
    padTool: 0.8, padDepth: 0.1, padStep: 0.1, padOverlap: 0.3, padInset: 0, padFeed: 200, padPlunge: 60,
    outSide: 'outside', tabs: 4, tabW: 2, tabH: 0.5, outMargin: 2,
  });

  const toPts = (path) => path.map((q) => [q.X / S, q.Y / S]);
  const toInt = (pts) => pts.map((p) => ({ X: Math.round(p[0] * S), Y: Math.round(p[1] * S) }));
  const loopLen = (pts) => { let l = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; l += Math.hypot(b[0] - a[0], b[1] - a[1]); } return l; };

  /** Join stroked polylines end-to-end into closed loops. */
  function chainLoops(lines, tol) {
    const left = lines.map((l) => l.slice());
    const closed = [], open = [];
    const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol;
    while (left.length) {
      let chain = left.pop();
      let grew = true;
      while (grew && !(chain.length > 2 && near(chain[0], chain[chain.length - 1]))) {
        grew = false;
        for (let i = 0; i < left.length; i++) {
          const l = left[i], end = chain[chain.length - 1];
          if (near(end, l[0])) chain = chain.concat(l.slice(1));
          else if (near(end, l[l.length - 1])) chain = chain.concat(l.slice(0, -1).reverse());
          else continue;
          left.splice(i, 1); grew = true; break;
        }
      }
      if (chain.length > 3 && near(chain[0], chain[chain.length - 1])) closed.push(chain.slice(0, -1)); else open.push(chain);
    }
    return { closed, open };
  }

  /** Close a ring with tabs; returns 3D points for one depth pass. */
  function ringWithTabs(ring, tabs, zTab) {
    const pts = ring.concat([ring[0]]);
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const L = cum[cum.length - 1];
    const spans = [];
    if (tabs.n > 0 && L > tabs.n * tabs.w * 2) {
      const o = tabs.phase || 0;
      for (let k = 0; k < tabs.n; k++) {
        const c = ((k + 0.5) / tabs.n) * L + o;
        spans.push([c - tabs.w / 2, c + tabs.w / 2]);
      }
    }
    const marks = spans.flatMap((s) => [s[0], s[1]]).filter((d) => d > 0 && d < L).sort((a, b) => a - b);
    const out = [[pts[0][0], pts[0][1], cum[0]]];
    let mi = 0;
    for (let i = 1; i < pts.length; i++) {
      while (mi < marks.length && marks[mi] < cum[i] - 1e-9) {
        const t = (marks[mi] - cum[i - 1]) / (cum[i] - cum[i - 1]);
        if (t > 1e-9) out.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t, marks[mi]]);
        mi++;
      }
      out.push([pts[i][0], pts[i][1], cum[i]]);
    }
    return out.map(([x, y, d]) => ({ x, y, tab: spans.some((s) => d >= s[0] - 1e-6 && d <= s[1] + 1e-6), d }));
  }

  function depthLevels(total, step) {
    const n = Math.max(1, Math.ceil(total / Math.max(step, 0.01) - 1e-9));
    return Array.from({ length: n }, (_, i) => -(total * (i + 1)) / n);
  }

  function circlePts(cx, cy, r) {
    const n = Math.max(16, Math.min(96, Math.ceil(Math.PI / Math.acos(Math.max(0, 1 - 0.01 / Math.max(r, 0.02))))));
    return Array.from({ length: n }, (_, i) => [cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n)]);
  }

  LG.vbitWidth = (P) => (P.toolType === 'vbit' ? P.vTip + 2 * P.isoDepth * Math.tan((P.vAngle * Math.PI) / 360) : P.endDia);

  /**
   * gb: prepared copper (mirrored/zeroed). extra.drill / extra.outline: raw parsed files (original coords).
   * Returns jobs (each with gcode text), plus preview geometry.
   */
  LG.generateMill = function (gb, extra, P) {
    const xf = gb.xf, warnings = [];
    const tx = (x, y) => LG.xfPt(xf, x, y);
    const res = { jobs: {}, preview: { iso: [], holes: [], slots: [], route: [], tabs: [], pads: [] }, warnings, stats: {} };
    const W = LG.vbitWidth(P);
    res.W = W;
    if (P.target === 'features') { millPads(gb, P, res); res.jobs.pads.gcode = millGcode(res.jobs.pads, P, 'pads'); return res; }
    if (P.toolType === 'vbit' && W > 0.5) warnings.push('V-bit cut width is ' + W.toFixed(2) + ' mm at this depth.');

    // ---------------- isolation
    res.gapT = 2 * (W / 2 + P.clearance);
    res.gaps = LG.findNarrowGaps(gb.paths, res.gapT, W);
    if (P.doIso) warnings.push(...LG.gapWarnings(res.gaps, res.gapT));
    if (P.doIso) {
      const step = W * (1 - P.mOverlap), d0 = W / 2 + P.clearance;
      const items = [];
      let cur = [gb.bbox.minX, gb.bbox.minY], len = 0;
      for (let i = 0; i < P.mPasses; i++) {
        const loops = LG.offsetPaths(gb.paths, d0 + i * step).filter((l) => l.length > 2);
        const cand = loops.map((l) => ({ l, c: [l[0].X / S, l[0].Y / S] }));
        for (const it of LG.nearestOrder(cand, cur)) {
          const pts = toPts(it.l);
          const z = -P.isoDepth;
          items.push({ kind: 'cut', pts: pts.concat([pts[0]]).map(([x, y]) => [x, y, z]), f: P.mFeed, pf: P.mPlunge });
          res.preview.iso.push(pts);
          len += loopLen(pts);
          cur = it.c;
        }
      }
      res.jobs.iso = { title: 'Isolation routing', tool: P.toolType === 'vbit' ? `V-bit ${P.vAngle}deg, tip ${P.vTip} mm (cut width ${W.toFixed(3)} mm at ${P.isoDepth} mm depth)` : `Endmill ${P.endDia} mm`, items };
      res.stats.iso = { passes: P.mPasses, len, min: len / P.mFeed };
    }

    // ---------------- drill & slots
    const drill = extra.drill;
    const routeItems = [];
    const drillHits = [];
    if (drill && P.doDrill) {
      const hits = drill.hits.filter((h) => P.drillVias || h.role !== 'via').map((h) => { const [x, y] = tx(h.x, h.y); return { x, y, d: h.d, role: h.role }; });
      for (const h of hits) {
        if (P.doOutline && P.millHolesAbove > 0 && h.d >= P.millHolesAbove && h.d - P.outTool > 0.05) {
          routeItems.push({ kind: 'hole', x: h.x, y: h.y, d: h.d });
          res.preview.holes.push({ x: h.x, y: h.y, d: h.d, milled: true });
        } else {
          drillHits.push(h);
          res.preview.holes.push({ x: h.x, y: h.y, d: h.d });
        }
      }
      for (const s of P.doOutline ? drill.slots : []) {
        const [x0, y0] = tx(s.x0, s.y0), [x1, y1] = tx(s.x1, s.y1);
        routeItems.push({ kind: 'slot', x0, y0, x1, y1, d: s.d });
        res.preview.slots.push({ x0, y0, x1, y1, d: s.d });
      }
      if (!P.millHolesAbove && drill.hits.length === 0 && !drill.slots.length) warnings.push('Drill file has no holes.');
      // group by diameter
      // cluster nearly-equal diameters (e.g. 0.305 / 0.306) so they share one bit
      const groups = new Map(), roles = new Map();
      let anchor = null, key = null;
      for (const h of drillHits.slice().sort((p, q) => p.d - q.d)) {
        if (anchor === null || h.d - anchor > 0.02) { anchor = h.d; key = h.d.toFixed(3); groups.set(key, []); roles.set(key, new Set()); }
        groups.get(key).push(h); if (h.role) roles.get(key).add(h.role === 'via' ? 'vias' : 'PTH');
      }
      const items = [];
      let cur = [0, 0], total = 0;
      for (const k of [...groups.keys()].sort((a, b) => a - b)) {
        items.push({ kind: 'pause', msg: `Insert ${k} mm drill bit${roles.get(k).size ? ' (' + [...roles.get(k)].join('+') + ')' : ''}, set Z zero, resume` });
        const cand = groups.get(k).map((h) => ({ h, c: [h.x, h.y] }));
        for (const it of LG.nearestOrder(cand, cur)) { items.push({ kind: 'drill', x: it.h.x, y: it.h.y }); cur = it.c; total++; }
      }
      res.jobs.drill = { title: 'Drilling', tool: [...groups.keys()].map((k) => k + ' mm').join(', ') || 'none', items };
      res.stats.drill = { holes: total, sizes: groups.size };
    }

    // ---------------- outline / route
    if (P.doOutline) {
      const r = P.outTool / 2;
      let rings = [];
      const ol = extra.outline;
      if (ol) {
        const lines = ol.centerlines.map((l) => l.map(([x, y]) => LG.xfPt(xf, x, y)));
        const ch = chainLoops(lines, 0.02);
        rings = ch.closed.concat(ol.loops.map((l) => l.map(([x, y]) => LG.xfPt(xf, x, y))));
        if (ch.open.length) warnings.push(ch.open.length + ' open outline segment(s) could not be closed; check the outline layer.');
        if (!rings.length) warnings.push('No closed outline loop found in the outline file.');
      }
      if (!rings.length) {
        const b = gb.bbox, m = P.outMargin;
        rings = [[[b.minX - m, b.minY - m], [b.maxX + m, b.minY - m], [b.maxX + m, b.maxY + m], [b.minX - m, b.maxY + m]]];
        if (ol) warnings.push('Using a rectangle around the copper instead.');
      }
      const c = new CL.Clipper();
      c.AddPaths(rings.map(toInt), CL.PolyType.ptSubject, true);
      const board = new CL.Paths();
      c.Execute(CL.ClipType.ctUnion, board, CL.PolyFillType.pftEvenOdd, CL.PolyFillType.pftEvenOdd);
      const delta = P.outSide === 'outside' ? r : P.outSide === 'inside' ? -r : 0;
      const paths = delta ? LG.offsetPaths(board, delta) : board;
      const levels = depthLevels(P.outDepth, P.outStep);
      const zTab = -(P.outDepth - P.tabH);
      const items = [];
      let len = 0;

      // inner features first, then cut-outs, outer boundary last
      for (const it of routeItems) {
        if (it.kind === 'hole') {
          const rr = (it.d - P.outTool) / 2, ring = circlePts(it.x, it.y, rr);
          for (const z of levels) items.push({ kind: 'cut', pts: ring.concat([ring[0]]).map(([x, y]) => [x, y, z]), f: P.outFeed, pf: P.outPlunge });
          len += loopLen(ring) * levels.length;
          res.preview.route.push(ring);
        } else {
          const w = it.d - P.outTool;
          if (w > 0.05) {
            const co = new CL.ClipperOffset(2, 0.004 * S);
            co.AddPath(toInt([[it.x0, it.y0], [it.x1, it.y1]]), CL.JoinType.jtRound, CL.EndType.etOpenRound);
            const sol = new CL.Paths(); co.Execute(sol, (w / 2) * S);
            for (const loop of sol) {
              const ring = toPts(loop);
              for (const z of levels) items.push({ kind: 'cut', pts: ring.concat([ring[0]]).map(([x, y]) => [x, y, z]), f: P.outFeed, pf: P.outPlunge });
              len += loopLen(ring) * levels.length; res.preview.route.push(ring);
            }
          } else {
            levels.forEach((z, i) => {
              const a = i % 2 ? [it.x1, it.y1] : [it.x0, it.y0], b = i % 2 ? [it.x0, it.y0] : [it.x1, it.y1];
              items.push({ kind: 'cut', pts: [[a[0], a[1], z], [b[0], b[1], z]], f: P.outFeed, pf: P.outPlunge });
              len += Math.hypot(b[0] - a[0], b[1] - a[1]);
            });
            res.preview.route.push([[it.x0, it.y0], [it.x1, it.y1]]);
          }
        }
      }
      const outer = [], inner = [];
      for (const p of paths) (CL.Clipper.Orientation(p) ? outer : inner).push(toPts(p));
      for (const ring of inner.concat(outer)) {
        const isOuter = outer.includes(ring);
        const tabs = isOuter ? { n: P.tabs, w: P.tabW } : { n: 0, w: 0 };
        const base = ringWithTabs(ring, tabs, zTab);
        for (const z of levels) {
          items.push({ kind: 'cut', pts: base.map((p) => [p.x, p.y, p.tab ? Math.max(z, zTab) : z]).concat([[base[0].x, base[0].y, base[0].tab ? Math.max(z, zTab) : z]]), f: P.outFeed, pf: P.outPlunge });
        }
        len += loopLen(ring) * levels.length;
        res.preview.route.push(ring);
        if (isOuter && tabs.n) {
          let a = null;
          for (const p of base) {
            if (p.tab) { if (!a) a = []; a.push([p.x, p.y]); } else if (a) { res.preview.tabs.push(a); a = null; }
          }
          if (a) res.preview.tabs.push(a);
        }
      }
      res.jobs.outline = { title: 'Slots & outline', tool: `Endmill ${P.outTool} mm`, items };
      res.stats.outline = { len, min: len / P.outFeed, loops: paths.length, tabs: P.tabs };
    }

    for (const k of Object.keys(res.jobs)) res.jobs[k].gcode = millGcode(res.jobs[k], P, k, gb.name);
    return res;
  };

  /** Pocket the features themselves (mask / paste layer): concentric passes inward within each feature. */
  function millPads(gb, P, res) {
    const D = P.padTool, r = D / 2, step = D * (1 - P.padOverlap);
    const levels = depthLevels(P.padDepth, P.padStep);
    const islands = LG.groups(gb.paths);
    const feats = [];
    let skipped = 0;
    for (const isl of islands) {
      const loops = [];
      for (let i = 0; i < 400; i++) {
        const ins = LG.offsetPaths(isl.paths, -(r + P.padInset + i * step)).filter((l) => l.length > 2);
        if (!ins.length) break;
        loops.push(...ins.map(toPts));
      }
      if (!loops.length) { skipped++; continue; }
      const bb = loops[0].reduce((a, q) => [Math.min(a[0], q[0]), Math.min(a[1], q[1])], [Infinity, Infinity]);
      feats.push({ loops, c: bb });
    }
    const items = [];
    let cur = [0, 0], len = 0;
    for (const f of LG.nearestOrder(feats, cur)) {
      for (const z of levels) {
        for (const ring of f.loops) {
          items.push({ kind: 'cut', pts: ring.concat([ring[0]]).map(([x, y]) => [x, y, z]), f: P.padFeed, pf: P.padPlunge });
          len += loopLen(ring);
        }
      }
      f.loops.forEach((l) => res.preview.pads.push(l));
    }
    if (skipped) res.warnings.push(skipped + ' feature(s) are smaller than the ' + D + ' mm tool and were skipped. Use a smaller endmill.');
    if (!items.length) res.warnings.push('Nothing to clear. Check the tool size against the feature sizes.');
    res.jobs.pads = { title: 'Pad clearing', tool: `Endmill ${D} mm`, items };
    res.stats.pads = { features: feats.length, skipped, len, min: len / P.padFeed, passes: levels.length };
  }

  function millGcode(job, P, kind, name) {
    const f = (v) => (Math.round(v * 1000) / 1000).toFixed(3).replace(/\.?0+$/, '') || '0';
    const o = [];
    o.push('; Laser Gen - ' + job.title);
    o.push('; tool: ' + job.tool);
    o.push(`; Z0 = copper surface. safe Z ${P.zSafe}, clearance ${P.zClear}`);
    for (const l of P.header.split('\n')) if (l.trim()) o.push(l.trim());
    o.push(`G0 Z${f(P.zSafe)}`);
    let spin = false, cx = null, cy = null, cz = P.zSafe, fCur = null;
    const startSpin = () => { if (!spin) { o.push(`M3 S${Math.round(P.spindle)}`, 'G4 P2'); spin = true; } };
    const retract = () => { if (cz < P.zSafe - 1e-6) { o.push(`G0 Z${f(P.zSafe)}`); cz = P.zSafe; } };
    const feed = (v) => (fCur === v ? '' : ((fCur = v), ` F${f(v)}`));
    if (kind !== 'drill') o.push(`(MSG, Install: ${job.tool})`, 'M0');
    for (const it of job.items) {
      if (it.kind === 'pause') {
        if (spin) { o.push('M5'); spin = false; }
        retract();
        o.push(`(MSG, ${it.msg})`, 'M0');
      } else if (it.kind === 'drill') {
        startSpin(); retract();
        o.push(`G0 X${f(it.x)} Y${f(it.y)}`, `G0 Z${f(P.zClear)}`);
        if (P.peck > 0) {
          for (let d = 0; d < P.drillDepth - 1e-9;) {
            d = Math.min(d + P.peck, P.drillDepth);
            o.push(`G1 Z${f(-d)}${feed(P.drillFeed)}`);
            if (d < P.drillDepth - 1e-9) o.push(`G0 Z${f(P.zClear)}`, `G0 Z${f(0.3 - d)}`);
          }
        } else o.push(`G1 Z${f(-P.drillDepth)}${feed(P.drillFeed)}`);
        o.push(`G0 Z${f(P.zClear)}`);
        cx = it.x; cy = it.y; cz = P.zClear;
      } else {
        startSpin();
        const [x0, y0, z0] = it.pts[0];
        const same = cx !== null && Math.hypot(x0 - cx, y0 - cy) < 1e-3 && cz <= 0.01;
        if (!same) {
          // short hops stay just above the surface instead of lifting to safe Z
          if (cx !== null && cz <= P.zClear + 1e-6 && Math.hypot(x0 - cx, y0 - cy) < 5) {
            if (cz < P.zClear - 1e-6) o.push(`G0 Z${f(P.zClear)}`);
            o.push(`G0 X${f(x0)} Y${f(y0)}`);
          } else {
            retract();
            o.push(`G0 X${f(x0)} Y${f(y0)}`, `G0 Z${f(P.zClear)}`);
          }
        }
        o.push(`G1 Z${f(z0)}${feed(it.pf)}`);
        for (let i = 1; i < it.pts.length; i++) {
          const [x, y, z] = it.pts[i], [px, py, pz] = it.pts[i - 1];
          o.push(`G1 X${f(x)} Y${f(y)}${Math.abs(z - pz) > 1e-6 || i === 1 ? ' Z' + f(z) : ''}${feed(it.f)}`);
        }
        const e = it.pts[it.pts.length - 1];
        cx = e[0]; cy = e[1]; cz = e[2];
      }
    }
    retract();
    o.push('M5');
    for (const l of P.footer.split('\n')) if (l.trim()) o.push(l.trim());
    o.push('M2');
    return o.join('\n') + '\n';
  }
})();
