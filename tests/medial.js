// node tests/medial.js - where passes from two neighbouring pads meet, the strip between them must end up cleared
globalThis.ClipperLib = require('../vendor/clipper.js');
for (const f of ['gerber', 'toolpath', 'gcode']) require('../js/' + f + '.js');
const LG = globalThis.LG;
// two 1.95 x 0.6 pads (an SOIC-8 row) with 0.67 mm between them, inside a copper frame
const gb = LG.parseGerber('%FSLAX46Y46*%\n%MOMM*%\n%ADD10R,1.95X0.6*%\n%ADD11R,0.3X5.0*%\n%ADD12R,5.0X0.3*%\nD10*\nX5000000Y5000000D03*\nX5000000Y6270000D03*\nD11*\nX2500000Y5600000D03*\nX7500000Y5600000D03*\nD12*\nX5000000Y3100000D03*\nX5000000Y8100000D03*\nM02*\n');
let ok = true;
const run = (o) => { const P = Object.assign({}, LG.defaults, { mode: 'clear', clearStyle: 'contour', contourMax: 8, zeroAtCorner: false, passes: 1 }, o); return { P, r: LG.generate(LG.prepare(gb, P), P) }; };
function gapUncleared({ P, r }) {
  // pads span y 4.7..5.3 and 5.97..6.57, so the gap is y 5.3..5.97; look at x 4.2..5.8 (away from the pad ends)
  const g = 0.005, x0 = 4.2, y0 = 5.3, W = Math.round(1.6 / g), H = Math.round(0.67 / g), hit = new Uint8Array(W * H);
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
  let bad = 0, tot = 0;
  for (let jy = 0; jy < H; jy++) { const y = y0 + (jy + 0.5) * g; if (y < 5.3 + P.clearance || y > 5.97 - P.clearance) continue; for (let jx = 0; jx < W; jx++) { tot++; if (!hit[jy * W + jx]) bad++; } }
  return bad / tot;
}
const off = run({ fillIslands: false }), on = run({ fillIslands: true });
const u0 = gapUncleared(off), u1 = gapUncleared(on);
const pass = (n, c, i) => { ok = ok && c; console.log(c ? 'ok  ' : 'FAIL', n, i); };
pass('contours alone leave a strip where the two pads\' passes meet', u0 > 0.02, (100 * u0).toFixed(1) + '% of the gap uncleared');
pass('the leftover fill clears it', u1 < 0.01, (100 * u1).toFixed(2) + '% uncleared, patches ' + on.r.stats.fillPatches);
process.exit(ok ? 0 : 1);
