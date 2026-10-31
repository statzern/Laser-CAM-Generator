// node tests/combo.js - "contour edge, then hatch": each pad is fully cleared, edge first, one pad at a time
globalThis.ClipperLib = require('../vendor/clipper.js');
for (const f of ['gerber', 'toolpath', 'gcode']) require('../js/' + f + '.js');
const LG = globalThis.LG;
// three pads of different shapes: 3.0x1.2, 1.0x1.0 and a 0.5x2.0 one
const pads = [[5, 5, 3.0, 1.2], [9, 5, 1.0, 1.0], [12, 5, 0.5, 2.0]];
const gb = LG.parseGerber('%FSLAX46Y46*%\n%MOMM*%\n' + pads.map((p, i) => `%ADD${10 + i}R,${p[2]}X${p[3]}*%`).join('\n') + '\n' + pads.map((p, i) => `D${10 + i}*\nX${p[0] * 1e6}Y${p[1] * 1e6}D03*`).join('\n') + '\nM02*\n');
let ok = true;
const check = (name, pass, info = '') => { ok = ok && pass; console.log(pass ? 'ok  ' : 'FAIL', name, info); };
const base = Object.assign({}, LG.defaults, { mode: 'clear', target: 'features', beamX: 0.04, beamY: 0.08, clearance: 0.02, zeroAtCorner: false, passes: 1, isoOverlap: 0.2, islandDerate: false });
const run = (o) => { const P = Object.assign({}, base, o); return { P, r: LG.generate(LG.prepare(gb, P), P) }; };
const combo = run({ clearStyle: 'combo', edgePasses: 2 }), cont = run({ clearStyle: 'contour', contourMax: 0 }), hatch = run({ clearStyle: 'hatch' });

// rasterise what the beam sweeps and look inside each pad (inset by the standoff) for resist that was left
function uncovered({ P, r }) {
  const g = 0.01, x0 = 3, y0 = 3, W = 1200, H = 500, hit = new Uint8Array(W * H), a = P.beamX / 2, b = P.beamY / 2;
  for (const c of r.cuts) for (let i = 1; i < c.pts.length; i++) {
    const [ax, ay] = c.pts[i - 1], [bx, by] = c.pts[i], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 0.004));
    for (let t = 0; t <= n; t++) {
      const x = ax + ((bx - ax) * t) / n, y = ay + ((by - ay) * t) / n;
      for (let jy = Math.floor((y - b - y0) / g); jy <= Math.ceil((y + b - y0) / g); jy++) for (let jx = Math.floor((x - a - x0) / g); jx <= Math.ceil((x + a - x0) / g); jx++) {
        if (jx < 0 || jy < 0 || jx >= W || jy >= H) continue;
        const dx = (x0 + (jx + 0.5) * g - x) / a, dy = (y0 + (jy + 0.5) * g - y) / b;
        if (dx * dx + dy * dy <= 1) hit[jy * W + jx] = 1;
      }
    }
  }
  let bad = 0, tot = 0;
  for (const [cx, cy, w, h] of pads) for (let jy = 0; jy < H; jy++) for (let jx = 0; jx < W; jx++) {
    const x = x0 + (jx + 0.5) * g, y = y0 + (jy + 0.5) * g;
    if (Math.abs(x - cx) > w / 2 - P.clearance - 0.01 || Math.abs(y - cy) > h / 2 - P.clearance - 0.01) continue;
    tot++; if (!hit[jy * W + jx]) bad++;
  }
  return bad / tot;
}
const u = uncovered(combo);
check('combo clears every pad completely', u < 0.01, (100 * u).toFixed(2) + '% of the pad area left');

// the first cuts on a pad are its edge contour: closed loops, before any straight hatch line
const first = combo.r.cuts.slice(0, 40);
const loops = combo.r.cuts.filter((c) => c.pts.length > 4).length;
check('edge contour loops are cut', loops > 0, loops + ' contour runs');
const straight = (c) => c.pts.length === 2;
const lastLoop = combo.r.cuts.map((c, i) => (c.pts.length > 4 ? i : -1)).filter((i) => i >= 0);
const firstHatch = combo.r.cuts.findIndex(straight);
check('on the first pad the edge contours come before the hatch', firstHatch > 0 && combo.r.cuts.slice(0, firstHatch).every((c) => c.pts.length > 2), 'first hatch line is cut #' + firstHatch);

// one pad at a time
const which = (c) => pads.findIndex(([cx, cy, w, h]) => Math.abs(c.pts[0][0] - cx) <= w / 2 + 0.2 && Math.abs(c.pts[0][1] - cy) <= h / 2 + 0.2);
let returns = 0, prev = -1; const seen = new Set();
for (const c of combo.r.cuts) { const v = which(c); if (v < 0) continue; if (v !== prev && seen.has(v)) returns++; seen.add(v); prev = v; }
check('one pad at a time', returns === 0 && seen.size === pads.length, `${seen.size} pads, ${returns} returns`);

check('combo is shorter than all-contour', combo.r.stats.cutLen < cont.r.stats.cutLen, `${combo.r.stats.cutLen.toFixed(0)} vs ${cont.r.stats.cutLen.toFixed(0)} mm cut, ${combo.r.stats.minutes.toFixed(2)} vs ${cont.r.stats.minutes.toFixed(2)} min`);
console.log('     for reference, plain hatch:', hatch.r.stats.cutLen.toFixed(0), 'mm,', hatch.r.stats.minutes.toFixed(2), 'min, uncovered', (100 * uncovered(hatch)).toFixed(2) + '%');
process.exit(ok ? 0 : 1);
