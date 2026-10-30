// node tests/fill.js file.gbr - isolation with and without leftover-island clearing
const fs = require('fs'), path = require('path');
globalThis.ClipperLib = require('../vendor/clipper.js');
for (const f of ['gerber', 'toolpath', 'gcode']) require('../js/' + f + '.js');
const LG = globalThis.LG;
const file = process.argv[2] || path.join(__dirname, '../samples/copper_top.gbr');
const gb = LG.parseGerber(fs.readFileSync(file, 'utf8'));
for (const fillIslands of [false, true]) {
  const P = Object.assign({}, LG.defaults, { mode: 'isolate', fillIslands });
  const r = LG.generate(LG.prepare(gb, P), P);
  console.log('fill', fillIslands, 'cuts', r.stats.cuts, 'cutLen', r.stats.cutLen.toFixed(0), 'min', r.stats.minutes.toFixed(1), 'fillPatches', r.stats.fillPatches, 'fillArea', r.fillRegion.length ? LG.groups(r.fillRegion).reduce((a, g) => a + g.area, 0).toFixed(2) : 0);
}
{
  const P = Object.assign({}, LG.defaults, { mode: 'isolate', fillIslands: true });
  const r = LG.generate(LG.prepare(gb, P), P);
  const a = LG.groups(r.fillRegion).map((g) => g.area).sort((x, y) => x - y);
  const q = (f) => a[Math.floor(f * (a.length - 1))].toFixed(3);
  console.log('patch areas mm2  min', q(0), 'median', q(0.5), 'p90', q(0.9), 'max', q(1), 'count<0.01:', a.filter((x) => x < 0.01).length);
}
