/* RS-274X (Gerber) parser -> unioned copper polygons.
 * Output geometry is Clipper integer paths at LG.SCALE units per mm.
 * Supports: FS/MO, AD (C R O P + macros), AM (prims 1,4,5,20,21,22), D01/D02/D03,
 * G01/G02/G03, G74/G75, G36/G37 regions, LPD/LPC polarity. */
(function () {
  'use strict';
  const CL = globalThis.ClipperLib;
  const LG = (globalThis.LG = globalThis.LG || {});
  const S = 10000; // clipper units per mm
  const ARC_TOL = 0.004; // mm
  LG.SCALE = S;

  const toInt = (pts) => pts.map((p) => ({ X: Math.round(p[0] * S), Y: Math.round(p[1] * S) }));

  function normalize(paths) {
    return paths.map((p) => (CL.Clipper.Orientation(p) ? p : p.slice().reverse()));
  }

  function clip(type, subj, clp) {
    const c = new CL.Clipper();
    c.AddPaths(subj, CL.PolyType.ptSubject, true);
    if (clp && clp.length) c.AddPaths(clp, CL.PolyType.ptClip, true);
    const sol = new CL.Paths();
    c.Execute(type, sol, CL.PolyFillType.pftNonZero, CL.PolyFillType.pftNonZero);
    return sol;
  }
  LG.clip = clip;
  LG.normalizePaths = normalize;

  function arcSteps(r, sweep) {
    const rr = Math.max(r, ARC_TOL * 2);
    const step = 2 * Math.acos(1 - ARC_TOL / rr);
    return Math.max(2, Math.min(720, Math.ceil(Math.abs(sweep) / step)));
  }

  function circlePts(cx, cy, r) {
    const n = Math.max(12, Math.min(128, arcSteps(r, 2 * Math.PI)));
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n;
      out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    return out;
  }

  function obroundPts(w, h) {
    const r = Math.min(w, h) / 2;
    const horiz = w >= h;
    const half = (Math.max(w, h) - 2 * r) / 2;
    const n = Math.max(6, arcSteps(r, Math.PI));
    const out = [];
    for (let i = 0; i <= n; i++) {
      const a = -Math.PI / 2 + (Math.PI * i) / n;
      out.push([half + r * Math.cos(a), r * Math.sin(a)]);
    }
    for (let i = 0; i <= n; i++) {
      const a = Math.PI / 2 + (Math.PI * i) / n;
      out.push([-half + r * Math.cos(a), r * Math.sin(a)]);
    }
    return horiz ? out : out.map((p) => [p[1], p[0]]);
  }

  function rectPts(w, h, cx = 0, cy = 0) {
    return [
      [cx - w / 2, cy - h / 2],
      [cx + w / 2, cy - h / 2],
      [cx + w / 2, cy + h / 2],
      [cx - w / 2, cy + h / 2],
    ];
  }

  function rotPts(pts, deg) {
    if (!deg) return pts;
    const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    return pts.map((p) => [p[0] * c - p[1] * s, p[0] * s + p[1] * c]);
  }

  function polygonPts(d, n, rotDeg) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n;
      out.push([(d / 2) * Math.cos(a), (d / 2) * Math.sin(a)]);
    }
    return rotPts(out, rotDeg || 0);
  }

  function hull(points) {
    const p = points.slice().sort((a, b) => a.X - b.X || a.Y - b.Y);
    if (p.length < 3) return p;
    const cross = (o, a, b) => (a.X - o.X) * (b.Y - o.Y) - (a.Y - o.Y) * (b.X - o.X);
    const lo = [];
    for (const q of p) {
      while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
      lo.push(q);
    }
    const up = [];
    for (let i = p.length - 1; i >= 0; i--) {
      const q = p[i];
      while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop();
      up.push(q);
    }
    lo.pop(); up.pop();
    return lo.concat(up);
  }

  function evalExpr(expr, vars) {
    const e = expr
      .replace(/\$(\d+)/g, (m, i) => '(' + (vars[i] || 0) + ')')
      .replace(/[xX]/g, '*');
    if (!/^[\d\s.+\-*/()eE]*$/.test(e)) return 0;
    try { const v = Function('return (' + e + ')')(); return isFinite(v) ? v : 0; } catch (_) { return 0; }
  }

  function macroShape(def, params, u, warn) {
    const vars = {};
    params.forEach((v, i) => (vars[i + 1] = v));
    let acc = [];
    for (const blk of def) {
      const b = blk.trim();
      if (!b || b[0] === '0' && /^0\s/.test(b)) continue;
      if (b[0] === '$') {
        const m = b.match(/^\$(\d+)\s*=\s*(.*)$/);
        if (m) vars[m[1]] = evalExpr(m[2], vars);
        continue;
      }
      const a = b.split(',').map((t) => evalExpr(t, vars));
      const code = a[0], exp = a[1];
      let pts = null;
      if (code === 1) pts = rotPts(circlePts(a[3] || 0, a[4] || 0, a[2] / 2), a[5] || 0);
      else if (code === 20) {
        const [, , w, x1, y1, x2, y2, rot] = a;
        const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
        const nx = (-dy / len) * (w / 2), ny = (dx / len) * (w / 2);
        pts = rotPts([[x1 + nx, y1 + ny], [x2 + nx, y2 + ny], [x2 - nx, y2 - ny], [x1 - nx, y1 - ny]], rot || 0);
      } else if (code === 21) pts = rotPts(rectPts(a[2], a[3], a[4], a[5]), a[6] || 0);
      else if (code === 22) pts = rotPts(rectPts(a[2], a[3], a[4] + a[2] / 2, a[5] + a[3] / 2), a[6] || 0);
      else if (code === 4) {
        const n = a[2];
        pts = [];
        for (let i = 0; i <= n; i++) pts.push([a[3 + 2 * i], a[4 + 2 * i]]);
        pts = rotPts(pts, a[3 + 2 * (n + 1)] || 0);
      } else if (code === 5) {
        const base = polygonPts(a[5], a[2], 0).map((p) => [p[0] + a[3], p[1] + a[4]]);
        pts = rotPts(base, a[6] || 0);
      } else { warn('Unsupported aperture macro primitive ' + code); continue; }
      const paths = normalize([toInt(pts.map((p) => [p[0] * u, p[1] * u]))]);
      acc = exp ? clip(CL.ClipType.ctUnion, acc, paths) : clip(CL.ClipType.ctDifference, acc, paths);
    }
    return acc;
  }

  function parseNum(s, f) {
    if (s.indexOf('.') >= 0) return parseFloat(s);
    let sign = 1;
    if (s[0] === '-' || s[0] === '+') { if (s[0] === '-') sign = -1; s = s.slice(1); }
    if (f.zero === 'T') s = s.padEnd(f.i + f.d, '0');
    return (sign * parseInt(s || '0', 10)) / Math.pow(10, f.d);
  }

  LG.parseGerber = function parseGerber(text) {
    const warnings = [];
    const warn = (m) => { if (warnings.indexOf(m) < 0) warnings.push(m); };
    text = text.replace(/\r/g, '');

    // tokenise into extended (%...%) and data blocks
    const tokens = [];
    for (let i = 0; i < text.length;) {
      const ch = text[i];
      if (ch === '%') {
        const e = text.indexOf('%', i + 1);
        const end = e < 0 ? text.length : e;
        tokens.push({ ext: text.slice(i + 1, end).split('*').map((s) => s.replace(/\n/g, '').trim()).filter(Boolean) });
        i = end + 1;
      } else if (/\s/.test(ch)) i++;
      else {
        const e = text.indexOf('*', i);
        const end = e < 0 ? text.length : e;
        tokens.push({ data: text.slice(i, end).replace(/\s+/g, '') });
        i = end + 1;
      }
    }

    let u = 1; // unit factor to mm
    let fmt = { i: 2, d: 4, zero: 'L' };
    const apertures = {}, macros = {};
    let curAp = null, x = 0, y = 0, mode = 1, multiQuad = true;
    let region = false, regionContours = [], contour = null;
    let dark = true, pend = [], pendDark = true, acc = [];
    let stroke = [];
    let ended = false;

    const flush = () => {
      if (!pend.length) return;
      const merged = clip(CL.ClipType.ctUnion, pend, []);
      acc = pendDark ? clip(CL.ClipType.ctUnion, acc, merged) : clip(CL.ClipType.ctDifference, acc, merged);
      pend = [];
    };
    const emit = (paths) => {
      if (dark !== pendDark) { flush(); pendDark = dark; }
      for (const p of paths) pend.push(p);
    };

    const flash = (fx, fy) => {
      if (!curAp) return;
      const ox = Math.round(fx * S), oy = Math.round(fy * S);
      emit(curAp.paths.map((p) => p.map((q) => ({ X: q.X + ox, Y: q.Y + oy }))));
    };

    const centerlines = [], loops = [];
    const flushStroke = () => {
      if (stroke.length < 2) { stroke = []; return; }
      const ap = curAp;
      if (!ap) { stroke = []; return; }
      centerlines.push(stroke.map((p) => p.slice()));
      if (ap.kind === 'C') {
        if (ap.d > 0) {
          const co = new CL.ClipperOffset(2, ARC_TOL * S);
          co.AddPath(toInt(stroke), CL.JoinType.jtRound, CL.EndType.etOpenRound);
          const sol = new CL.Paths();
          co.Execute(sol, (ap.d / 2) * S);
          emit(sol);
        }
      } else if (ap.base) {
        const out = [];
        for (let i = 1; i < stroke.length; i++) {
          const a = stroke[i - 1], b = stroke[i];
          const pts = [];
          for (const q of ap.base) {
            pts.push({ X: q.X + Math.round(a[0] * S), Y: q.Y + Math.round(a[1] * S) });
            pts.push({ X: q.X + Math.round(b[0] * S), Y: q.Y + Math.round(b[1] * S) });
          }
          out.push(hull(pts));
        }
        emit(normalize(out));
      } else warn('Stroke with macro aperture ignored');
      stroke = [];
    };

    function arcPoints(x0, y0, x1, y1, i, j, cw) {
      let cx, cy;
      if (multiQuad) { cx = x0 + i; cy = y0 + j; }
      else {
        let best = null;
        for (const sx of [1, -1]) for (const sy of [1, -1]) {
          const px = x0 + sx * Math.abs(i), py = y0 + sy * Math.abs(j);
          const err = Math.abs(Math.hypot(x0 - px, y0 - py) - Math.hypot(x1 - px, y1 - py));
          let a0 = Math.atan2(y0 - py, x0 - px), a1 = Math.atan2(y1 - py, x1 - px);
          let sw = cw ? a0 - a1 : a1 - a0;
          while (sw < 0) sw += 2 * Math.PI;
          if (sw > Math.PI / 2 + 1e-6) continue;
          if (!best || err < best.err) best = { err, px, py };
        }
        if (!best) best = { px: x0 + i, py: y0 + j };
        cx = best.px; cy = best.py;
      }
      const r = Math.hypot(x0 - cx, y0 - cy);
      const a0 = Math.atan2(y0 - cy, x0 - cx);
      let a1 = Math.atan2(y1 - cy, x1 - cx);
      if (cw) { if (a1 >= a0 - 1e-9) a1 -= 2 * Math.PI; }
      else if (a1 <= a0 + 1e-9) a1 += 2 * Math.PI;
      const n = arcSteps(r, a1 - a0);
      const out = [];
      for (let k = 1; k < n; k++) {
        const a = a0 + ((a1 - a0) * k) / n;
        out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
      }
      out.push([x1, y1]);
      return out;
    }

    function defineAperture(code, kind, args) {
      const p = args ? args.split('X').map(parseFloat) : [];
      let paths = [], base = null, d = 0;
      if (kind === 'C') {
        d = p[0] * u;
        paths = [toInt(circlePts(0, 0, d / 2))];
        if (p[1] > 0) paths = clip(CL.ClipType.ctDifference, paths, normalize([toInt(circlePts(0, 0, (p[1] * u) / 2))]));
      } else if (kind === 'R' || kind === 'O') {
        const w = p[0] * u, h = p[1] * u;
        const pts = kind === 'R' ? rectPts(w, h) : obroundPts(w, h);
        base = toInt(pts);
        paths = [base];
        if (p[2] > 0) {
          const hole = p[3] > 0 ? rectPts(p[2] * u, p[3] * u) : circlePts(0, 0, (p[2] * u) / 2);
          paths = clip(CL.ClipType.ctDifference, paths, normalize([toInt(hole)]));
        }
      } else if (kind === 'P') {
        const pts = polygonPts(p[0] * u, p[1], p[2] || 0);
        base = toInt(pts);
        paths = [base];
        if (p[3] > 0) paths = clip(CL.ClipType.ctDifference, paths, normalize([toInt(circlePts(0, 0, (p[3] * u) / 2))]));
      } else if (macros[kind]) {
        paths = macroShape(macros[kind], p, u, warn);
      } else { warn('Unknown aperture type ' + kind); return; }
      apertures[code] = { kind: macros[kind] ? 'M' : kind, d, paths: normalize(paths), base };
    }

    function handleData(blk) {
      if (/^G0?4/.test(blk)) return;
      if (/^M0?[023]/.test(blk) && !/[XYD]/.test(blk)) { if (/^M0?2/.test(blk)) ended = true; return; }
      let g = [...blk.matchAll(/G(\d+)/g)].map((m) => parseInt(m[1], 10));
      for (const gc of g) {
        if (gc === 1) mode = 1;
        else if (gc === 2) mode = 2;
        else if (gc === 3) mode = 3;
        else if (gc === 74) multiQuad = false;
        else if (gc === 75) multiQuad = true;
        else if (gc === 36) { flushStroke(); region = true; regionContours = []; contour = null; }
        else if (gc === 37) {
          if (contour && contour.length >= 3) regionContours.push(contour);
          regionContours.forEach((c) => { if (c.length >= 3) loops.push(c.slice()); });
          const paths = regionContours.filter((c) => c.length >= 3).map((c) => toInt(c));
          if (paths.length) emit(normalize(paths));
          region = false; regionContours = []; contour = null;
        } else if (gc === 70) u = 25.4;
        else if (gc === 71) u = 1;
      }
      const coords = {};
      for (const m of blk.matchAll(/([XYIJ])([+-]?[\d.]+)/g)) coords[m[1]] = parseNum(m[2], fmt);
      const dm = blk.match(/D0*(\d+)/);
      const d = dm ? parseInt(dm[1], 10) : null;
      if (d !== null && d >= 10) {
        flushStroke();
        curAp = apertures[d] || null;
        if (!curAp) warn('Undefined aperture D' + d);
        return;
      }
      const hasXY = coords.X !== undefined || coords.Y !== undefined;
      if (d === null && !hasXY) return;
      const nx = coords.X !== undefined ? coords.X * u : x;
      const ny = coords.Y !== undefined ? coords.Y * u : y;
      const op = d !== null ? d : 1; // modal D is rare; assume draw
      if (op === 2) {
        flushStroke();
        if (region) {
          if (contour && contour.length >= 3) regionContours.push(contour);
          contour = [[nx, ny]];
        }
      } else if (op === 1) {
        const pts = mode === 1 ? [[nx, ny]] : arcPoints(x, y, nx, ny, (coords.I || 0) * u, (coords.J || 0) * u, mode === 2);
        if (region) {
          if (!contour) contour = [[x, y]];
          for (const p of pts) contour.push(p);
        } else {
          if (!stroke.length) stroke.push([x, y]);
          for (const p of pts) stroke.push(p);
        }
      } else if (op === 3) {
        flushStroke();
        if (!region) flash(nx, ny);
      }
      x = nx; y = ny;
    }

    function handleExt(blocks) {
      const first = blocks[0] || '';
      if (first.startsWith('FS')) {
        const m = first.match(/FS([LTDA]*)([AI]?)X(\d)(\d)Y(\d)(\d)/);
        if (m) fmt = { i: +m[3], d: +m[4], zero: m[1].includes('T') ? 'T' : 'L' };
        for (const b of blocks.slice(1)) if (b.startsWith('MO')) u = b.includes('IN') ? 25.4 : 1;
      }
      for (const b of blocks) {
        if (b.startsWith('MO')) u = b.includes('IN') ? 25.4 : 1;
        else if (b.startsWith('LP')) { flushStroke(); dark = b[2] === 'D'; }
        else if (/^(LM|LR|LS)/.test(b)) warn('Aperture transforms (LM/LR/LS) not supported');
        else if (b.startsWith('AD')) {
          const m = b.match(/^ADD(\d+)([^,]+)(?:,(.*))?$/);
          if (m) defineAperture(parseInt(m[1], 10), m[2], m[3]);
        }
      }
      if (first.startsWith('AM')) macros[first.slice(2)] = blocks.slice(1);
    }

    for (const t of tokens) {
      if (ended) break;
      if (t.ext) handleExt(t.ext);
      else if (t.data) handleData(t.data);
    }
    flushStroke();
    flush();

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of acc) for (const q of p) {
      if (q.X < minX) minX = q.X; if (q.X > maxX) maxX = q.X;
      if (q.Y < minY) minY = q.Y; if (q.Y > maxY) maxY = q.Y;
    }
    if (!acc.length) { minX = minY = maxX = maxY = 0; warn('No copper geometry found'); }
    return {
      paths: acc,
      bbox: { minX: minX / S, minY: minY / S, maxX: maxX / S, maxY: maxY / S },
      warnings,
      centerlines, // stroked polylines (mm), used for board outlines
      loops, // region contours (mm)
    };
  };
})();
