// node tests/explain.js <gerber>  - explain laser isolation power: which islands/zones set each contour's power
globalThis.ClipperLib = require('../vendor/clipper.js');
for (const f of ['gerber', 'toolpath', 'gcode']) require('../js/' + f + '.js');
const LG = globalThis.LG, fs = require('fs'), S = LG.SCALE;
const gb = LG.parseGerber(fs.readFileSync(process.argv[2], 'utf8'));
console.log('parse warnings:', gb.warnings, '| bbox', Object.values(gb.bbox).map((v) => v.toFixed(1)).join(' '));
const P = Object.assign({}, LG.defaults, { mode: 'isolate', passes: 1, isoPasses: 1 });
const g = LG.prepare(gb, P), r = LG.generate(g, P);
const d0 = P.beam / 2 + P.clearance;
console.log(`params: baseline ${P.power}% min ${P.minPower}% areaRef ${P.areaRef} mm2 exp ${P.areaExp} influence ${P.influence} mm | d0 ${d0}`);
console.log('islands', r.islands.length, '| derated', r.zones.length, '| cuts', r.cuts.length, '| power range', r.stats.pMin.toFixed(0) + '-' + r.stats.pMax.toFixed(0));
const isl = r.islands.map((i, k) => { const bb = i.paths[0].reduce((a, q) => [Math.min(a[0], q.X / S), Math.min(a[1], q.Y / S), Math.max(a[2], q.X / S), Math.max(a[3], q.Y / S)], [1e9, 1e9, -1e9, -1e9]); return { k, area: i.area, s: i.s, bb }; });
isl.sort((a, b) => a.area - b.area);
console.log('\nislands by area (mm2) -> scale -> power%:');
const hist = {};
for (const i of isl) { const p = P.minPower + (P.power - P.minPower) * i.s; const b = i.area < 1 ? '<1' : i.area < 2 ? '1-2' : i.area < 4 ? '2-4' : '>=4'; hist[b] = (hist[b] || 0) + 1; }
console.log(' count by area bucket:', JSON.stringify(hist));
console.log(' smallest 8:', isl.slice(0, 8).map((i) => `${i.area.toFixed(2)}→${(P.minPower + (P.power - P.minPower) * i.s).toFixed(0)}%`).join('  '));
console.log(' just below ref:', isl.filter((i) => i.area < P.areaRef && i.area > 2.5).map((i) => `${i.area.toFixed(2)}→${(P.minPower + (P.power - P.minPower) * i.s).toFixed(0)}%`).join('  '));
console.log(' largest 5:', isl.slice(-5).map((i) => i.area.toFixed(1) + ' mm2').join('  '));

// attribute each cut to the island whose d0-offset it traces
const rings = r.islands.map((i) => LG.offsetPaths(i.paths, d0));
const dist = (x, y, paths) => { let b = 1e9; for (const p of paths) for (let i = 0; i < p.length; i++) { const a = p[i], c = p[(i + 1) % p.length]; const ax = a.X / S, ay = a.Y / S, dx = c.X / S - ax, dy = c.Y / S - ay, l2 = dx * dx + dy * dy || 1e-12; const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)); b = Math.min(b, Math.hypot(x - ax - t * dx, y - ay - t * dy)); } return b; };
const stat = { ownFull: 0, ownDerated: 0, borrowed: 0, mixed: 0 }, len = { ownFull: 0, ownDerated: 0, borrowed: 0 }, examples = [];
for (const c of r.cuts) {
  const mx = (c.pts[0][0] + c.pts[c.pts.length - 1][0]) / 2, my = (c.pts[0][1] + c.pts[c.pts.length - 1][1]) / 2;
  let best = -1, bd = 1e9;
  for (let k = 0; k < rings.length; k++) { const d = dist(mx, my, rings[k]); if (d < bd) { bd = d; best = k; } }
  const own = r.islands[best], L = c.pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - c.pts[i][0], p[1] - c.pts[i][1]), 0);
  const base = P.minPower + (P.power - P.minPower) * own.s;
  if (own.s < 0.9999) { stat.ownDerated++; len.ownDerated += L; }
  else if (c.power < P.power - 0.5) { stat.borrowed++; len.borrowed += L; if (examples.length < 6) examples.push({ x: mx.toFixed(1), y: my.toFixed(1), ownArea: own.area.toFixed(1), power: c.power.toFixed(0) }); }
  else { stat.ownFull++; len.ownFull += L; }
}
console.log('\ncontour segments by cause (count, mm):');
for (const k of Object.keys(len)) console.log(' ', k.padEnd(11), String(stat[k]).padStart(4), len[k].toFixed(0).padStart(6), 'mm');
console.log(' ownDerated  = traces a SMALL island, so its own area sets the power');
console.log(' borrowed    = traces an island that is big enough for full power, but sits inside a small neighbour\'s influence zone');
console.log(' examples of borrowed:', JSON.stringify(examples));
