// node tests/ellipse.js - an elliptical spot must offset per axis and scale power with travel direction
globalThis.ClipperLib = require('../vendor/clipper.js');
for (const f of ['gerber', 'toolpath', 'gcode']) require('../js/' + f + '.js');
const LG = globalThis.LG;
const gb = LG.parseGerber('%FSLAX46Y46*%\n%MOMM*%\n%ADD10R,2.0X2.0*%\nD10*\nX5000000Y5000000D03*\nM02*\n');
let ok = true;
const check = (name, got, want, tol = 0.003) => { const pass = Math.abs(got - want) <= tol; ok = ok && pass; console.log(pass ? 'ok  ' : 'FAIL', name, got.toFixed(4), 'want', want); };
const base = { mode: 'isolate', isoPasses: 2, isoOverlap: 0.2, clearance: 0, islandDerate: false, zeroAtCorner: false, passes: 1 };
{
  const P = Object.assign({}, LG.defaults, base, { beamX: 0.04, beamY: 0.08, power: 80, minPower: 0 });
  const r = LG.generate(LG.prepare(gb, P), P);
  const xs = [], ys = [];
  for (const c of r.cuts) for (const [x, y] of c.pts) { xs.push(x); ys.push(y); }
  const xmin = Math.min(...xs), xmax = Math.max(...xs), ymin = Math.min(...ys), ymax = Math.max(...ys);
  // pad spans 4..6; pass 1 is scaled by 1+2(1-0.2)=2.6 -> outer pass at 2.6*(0.02, 0.04)
  check('pass0 left offset (X, half of 0.04)', 4 - Math.min(...xs.filter((x) => 4 - x > 0.015 && 4 - x < 0.03)), 0.02);
  check('outer pass left offset', 4 - xmin, 2.6 * 0.02);
  check('outer pass bottom offset', 4 - ymin, 2.6 * 0.04);
  check('outer pass right offset', xmax - 6, 2.6 * 0.02);
  const horiz = r.cuts.filter((c) => c.pts.length > 1 && Math.abs(c.pts[0][1] - c.pts[c.pts.length - 1][1]) < 1e-6 && Math.abs(c.pts[0][0] - c.pts[c.pts.length - 1][0]) > 0.5);
  const vert = r.cuts.filter((c) => c.pts.length > 1 && Math.abs(c.pts[0][0] - c.pts[c.pts.length - 1][0]) < 1e-6 && Math.abs(c.pts[0][1] - c.pts[c.pts.length - 1][1]) > 0.5);
  check('power travelling along X (0.08 line)', Math.max(...horiz.map((c) => c.power)), 80, 0.01);
  check('power travelling along Y (0.04 line)', Math.max(...vert.map((c) => c.power)), 40, 0.01);
}
{
  const P = Object.assign({}, LG.defaults, base, { mode: 'clear', beamX: 0.04, beamY: 0.08, margin: 0.5, angle: 0, spacingPct: 80 });
  const r = LG.generate(LG.prepare(gb, P), P);
  const ys = [...new Set(r.cuts.map((c) => c.pts[0][1].toFixed(4)))].map(Number).sort((a, b) => a - b);
  check('hatch at 0 deg: spacing = 80% of 0.08', ys[2] - ys[1], 0.064, 0.0005);
  const P2 = Object.assign({}, P, { angle: 90 });
  const r2 = LG.generate(LG.prepare(gb, P2), P2);
  const xs = [...new Set(r2.cuts.map((c) => c.pts[0][0].toFixed(4)))].map(Number).sort((a, b) => a - b);
  check('hatch at 90 deg: spacing = 80% of 0.04', xs[2] - xs[1], 0.032, 0.0005);
  check('hatch at 90 deg power (narrow line)', r2.cuts[0].power, 40, 0.01);
}
{ // a round spot must reproduce the old behaviour exactly
  const P = Object.assign({}, LG.defaults, base, { beamX: 0.1, beamY: 0.1, power: 80 });
  const r = LG.generate(LG.prepare(gb, P), P);
  const xs = r.cuts.flatMap((c) => c.pts.map((q) => q[0]));
  check('round spot, outer pass offset = 0.05 + 0.08', 4 - Math.min(...xs), 0.05 + 0.1 * 0.8 * 1, 0.003);
}
process.exit(ok ? 0 : 1);
