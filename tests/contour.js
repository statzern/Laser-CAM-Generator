// node tests/contour.js - contour clearing: passes stay in the box, respect the cap, and leave nothing uncleared
globalThis.ClipperLib = require('../vendor/clipper.js');
for (const f of ['gerber', 'toolpath', 'gcode']) require('../js/' + f + '.js');
const LG = globalThis.LG;
// two 2x2 pads 0.30 mm apart (a gap that is not a multiple of the pass step) plus a lone pad
const gb = LG.parseGerber('%FSLAX46Y46*%\n%MOMM*%\n%ADD10R,2.0X2.0*%\nD10*\nX5000000Y5000000D03*\nX7300000Y5000000D03*\nX5000000Y8000000D03*\nM02*\n');
let ok = true;
const check = (name, pass, info = '') => { ok = ok && pass; console.log(pass ? 'ok  ' : 'FAIL', name, info); };
const base = Object.assign({}, LG.defaults, { mode: 'clear', clearStyle: 'contour', beamX: 0.04, beamY: 0.08, clearance: 0.02, margin: 0.6, isoOverlap: 0.2, zeroAtCorner: false, islandDerate: false, passes: 1 });
const run = (o) => { const P = Object.assign({}, base, o); return { P, r: LG.generate(LG.prepare(gb, P), P) }; };

const capped = run({ contourMax: 3 });
const bb = capped.r.bbox, m = base.margin;
const inBox = capped.r.cuts.every((c) => c.pts.every(([x, y]) => x >= bb.minX - m - 0.25 && x <= bb.maxX + m + 0.25 && y >= bb.minY - m - 0.25 && y <= bb.maxY + m + 0.25));
check('capped passes stay inside the clearing box', inBox);
const full = run({ contourMax: 0 });
check('unlimited makes more cuts than a cap of 3', full.r.cuts.length > capped.r.cuts.length, `${full.r.cuts.length} vs ${capped.r.cuts.length}`);
// with the cap, the 3 passes from the first pad's left edge sit at 0.02*(1+2*i*0.8)+0.02 clearance
const leftXs = [...new Set(capped.r.cuts.flatMap((c) => c.pts).filter(([x, y]) => y > 4.5 && y < 5.5 && x < 4).map(([x]) => +(4 - x).toFixed(3)))].sort((a, b) => a - b);
check('pass offsets from the left edge', leftXs.length === 3 && Math.abs(leftXs[0] - 0.04) < 0.004 && Math.abs(leftXs[1] - (0.02 * 2.6 + 0.02)) < 0.004, leftXs.join(','));

// coverage: rasterise the swept beam and look for uncleared resist away from copper and the border
function uncovered(P, r, gapOnly) {
  const g = 0.01, x0 = bb.minX - m, y0 = bb.minY - m, W = Math.ceil((bb.maxX - bb.minX + 2 * m) / g), H = Math.ceil((bb.maxY - bb.minY + 2 * m) / g);
  const hit = new Uint8Array(W * H);
  const a = P.beamX / 2, b = P.beamY / 2;
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
  const pads = [[4, 4, 6, 6], [6.3, 4, 8.3, 6], [4, 7, 6, 9]];
  const near = (x, y, d) => pads.some(([px0, py0, px1, py1]) => x > px0 - d && x < px1 + d && y > py0 - d && y < py1 + d);
  let bad = 0, tot = 0;
  for (let jy = 0; jy < H; jy++) for (let jx = 0; jx < W; jx++) {
    const x = x0 + (jx + 0.5) * g, y = y0 + (jy + 0.5) * g;
    // only check the gap between the two pads and the ring just around the copper, not the far border
    if (gapOnly) { if (!(x > 6.03 && x < 6.27 && y > 4.1 && y < 5.9)) continue; }
    else if (near(x, y, P.clearance + 0.03) || !near(x, y, 0.45)) continue;
    tot++; if (!hit[jy * W + jx]) bad++;
  }
  return bad / tot;
}
const u1 = uncovered(full.P, full.r), f2 = run({ contourMax: 0, fillIslands: true }), u2 = uncovered(f2.P, f2.r);
check('unlimited contours clear the area around copper (uncleared < 2%)', u1 < 0.02, (100 * u1).toFixed(2) + '% uncleared');
console.log('     with leftover fill:', (100 * u2).toFixed(2) + '% uncleared', '| fill patches', f2.r.stats.fillPatches);
check('leftover fill does not make coverage worse', u2 <= u1 + 1e-9);
// a capped run leaves a strip between the pads that the passes from either side cannot reach: the fill must take it
const c2 = run({ contourMax: 2 }), c2f = run({ contourMax: 2, fillIslands: true });
const g1 = uncovered(c2.P, c2.r, true), g2 = uncovered(c2f.P, c2f.r, true);
check('capped contours leave a strip in the 0.30 mm gap', g1 > 0.2, (100 * g1).toFixed(1) + '% uncleared');
check('leftover fill clears that strip', g2 < 0.05, (100 * g2).toFixed(1) + '% uncleared, patches ' + c2f.r.stats.fillPatches);
// clearing the features (mask openings): passes erode inward and stop on their own
const feat = run({ target: 'features', contourMax: 0 });
check('features mode: passes stop when the pad is filled', feat.r.cuts.length > 0 && feat.r.cuts.length < 5000, feat.r.cuts.length + ' cuts');
process.exit(ok ? 0 : 1);
