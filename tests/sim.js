// The simulator re-reads the G-code text; its numbers must match what the engine planned.
globalThis.ClipperLib = require('../vendor/clipper.js');
for (const f of ['gerber', 'toolpath', 'gcode', 'excellon', 'mill', 'gsim']) require('../js/' + f + '.js');
const LG = globalThis.LG, fs = require('fs'), path = require('path');
const file = process.argv[2] || path.join(__dirname, '../samples/demo-top.gbr');
const gb = LG.parseGerber(fs.readFileSync(file, 'utf8'));
for (const direction of ['serpentine', 'forward']) {
  const P = Object.assign({}, LG.defaults, { direction });
  const r = LG.generate(LG.prepare(gb, P), P);
  const sim = LG.simulate([{ name: 'laser', text: LG.toGcode(r, P) }], { rapid: P.rapid, sMax: P.sMax });
  const d = (a, b) => (100 * (a - b) / b).toFixed(2) + '%';
  console.log(direction.padEnd(10), 'engine cut', r.stats.cutLen.toFixed(1), 'sim laser', sim.laserLen.toFixed(1), '(Δ' + d(sim.laserLen, r.stats.cutLen) + ')',
    '| rapid', r.stats.rapidLen.toFixed(0), 'vs', sim.rapidLen.toFixed(0), '| time', r.stats.minutes.toFixed(2), 'min vs', (sim.total / 60).toFixed(2),
    '| S', sim.minS + '-' + sim.maxS, 'kind', sim.kind);
}
const at = LG.simAt(LG.simulate([{ name: 'x', text: 'G21\nM4 S0\nG0 X10 Y0\nG1 X20 Y0 S500 F600\nM5\n' }]), 0);
const s2 = LG.simulate([{ name: 'x', text: 'G21\nM4 S0\nG0 X10 Y0\nG1 X20 Y0 S500 F600\nG2 X20 Y0 I-5 J0\nM5\n' }], { rapid: 3000 });
console.log('mini: segs', s2.n, 'laserLen', s2.laserLen.toFixed(2), '(expect 10 + 31.42 circle)', 'time', s2.total.toFixed(2), 's', LG.simAt(s2, 1.0));
