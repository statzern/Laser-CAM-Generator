globalThis.ClipperLib = require('../vendor/clipper.js');
for (const f of ['gerber', 'toolpath', 'gcode', 'gsim', 'testcard']) require('../js/' + f + '.js');
const LG = globalThis.LG;
const P = Object.assign({}, LG.defaults);
const tc = LG.testCard(P);
const sim = LG.simulate([{ name: 'card', text: tc.gcode }], { rapid: P.rapid, sMax: P.sMax });
console.log('cells', tc.cells.length, '| size', tc.width.toFixed(1) + ' x ' + tc.height.toFixed(1), 'mm | run time', (sim.total / 60).toFixed(1), 'min | S', sim.minS + '..' + sim.maxS, '| bounds', JSON.stringify(sim.bounds));
const feeds = new Set(), S = new Set();
for (let i = 0; i < sim.n; i++) if (sim.K[i]) { feeds.add(sim.F[i]); S.add(sim.S[i]); }
console.log('distinct feeds', [...feeds].join(','), '| distinct S', [...S].join(','));
// the kept features must stay unburned: sample a point inside the 2x2 pad of cell (0,0) => no cut passes through it
const c0 = tc.cells[0], px = c0.x + 1.5 + 3, py = c0.y + 1.5 + 1;
let hit = 0; for (let i = 0; i < sim.n; i++) if (sim.K[i] && Math.abs(sim.Y0[i] - py) < 0.05 && Math.min(sim.X0[i], sim.X1[i]) < px && Math.max(sim.X0[i], sim.X1[i]) > px) hit++;
console.log('cuts crossing the kept 2x2 pad centre in cell 0:', hit, '(expect 0)');
// threshold + fade
const gb = LG.parseGerber(require('fs').readFileSync(__dirname + '/../samples/copper_top.gbr', 'utf8'));
for (const falloff of ['step', 'fade']) {
  const Q = Object.assign({}, P, { mode: 'isolate', falloff, ablateMin: 45 });
  const r = LG.generate(LG.prepare(gb, Q), Q);
  console.log(falloff.padEnd(4), 'zones', r.zones.length, 'power', r.stats.pMin.toFixed(0) + '-' + r.stats.pMax.toFixed(0), 'below 45%:', r.stats.belowLen.toFixed(0), 'mm of', r.stats.cutLen.toFixed(0), '| derated islands', r.stats.derated);
}
const Qc = Object.assign({}, P, { mode: 'isolate', ablateMin: 45, ablateClamp: true });
const rc = LG.generate(LG.prepare(gb, Qc), Qc);
console.log('clamped   power', rc.stats.pMin.toFixed(0) + '-' + rc.stats.pMax.toFixed(0), 'below 45%:', rc.stats.belowLen.toFixed(0), 'mm');
