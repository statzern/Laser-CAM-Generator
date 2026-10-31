// node tests/residual.js file.gbr [json-params] - what the beam leaves uncleared inside the reach of the passes
const fs = require('fs');
globalThis.ClipperLib = require('../vendor/clipper.js');
for (const f of ['gerber', 'toolpath', 'gcode']) require('../js/' + f + '.js');
const LG = globalThis.LG, CL = globalThis.ClipperLib, S = 10000;
const gb = LG.parseGerber(fs.readFileSync(process.argv[2], 'utf8'));
const P = Object.assign({}, LG.defaults, { mode: 'clear', clearStyle: 'contour', margin: 0.5 }, JSON.parse(process.argv[3] || '{}'));
const g = LG.prepare(gb, P), r = LG.generate(g, P);
const a = P.beamX / 2, b = P.beamY / 2;
// swept area of every cut: scale Y so the ellipse is a circle, round-offset the open paths, scale back
const f = a / b, co = new CL.ClipperOffset(2, 0.002 * S);
for (const c of r.cuts) co.AddPath(c.pts.map(([x, y]) => ({ X: Math.round(x * S), Y: Math.round(y * f * S) })), CL.JoinType.jtRound, CL.EndType.etOpenRound);
const sw = new CL.Paths(); co.Execute(sw, a * S);
const swept = sw.map((p) => p.map((q) => ({ X: q.X, Y: Math.round(q.Y / f) })));
// the zone the passes were meant to clear: from the protected standoff out to the outer pass edge
const used = P.contourMax || 400, sl = 1 + 2 * (used - 1) * (1 - P.isoOverlap) + 1;
const band = LG.clip(CL.ClipType.ctDifference, LG.offsetEll(g.paths, sl * a + P.clearance, sl * b + P.clearance, 1), LG.offsetEll(g.paths, P.clearance, P.clearance, 1));
const left = LG.clip(CL.ClipType.ctDifference, band, swept);
const w = 0.008; // ignore anything thinner than 8 micron: rounding
const real = LG.clip(CL.ClipType.ctDifference, left, LG.offsetEll(LG.offsetEll(left, w, w, -1), w, w, 1).length ? [] : []);
const comps = LG.groups(left).filter((c) => c.area > 1e-4).sort((x, y) => y.area - x.area);
const tot = comps.reduce((s, c) => s + c.area, 0);
console.log('cuts', r.cuts.length, 'fillPatches', r.stats.fillPatches, '| uncleared inside reach:', comps.length, 'regions,', tot.toFixed(3), 'mm2 of band', LG.groups(band).reduce((s, c) => s + c.area, 0).toFixed(1));
const bbox = (c) => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const q of c.paths[0]) { x0 = Math.min(x0, q.X / S); x1 = Math.max(x1, q.X / S); y0 = Math.min(y0, q.Y / S); y1 = Math.max(y1, q.Y / S); } return [x0, y0, x1, y1]; };
for (const c of comps.slice(0, 12)) { const q = bbox(c); console.log('  area', c.area.toFixed(4), 'bbox', q.map((v) => v.toFixed(2)).join(' '), 'w~', (2 * c.area / (2 * ((q[2] - q[0]) + (q[3] - q[1])) || 1)).toFixed(3)); }
fs.writeFileSync(process.env.OUT || '/tmp/shots/residual.json', JSON.stringify(comps.map((c) => c.paths[0].map((q) => [q.X / S, q.Y / S]))));
