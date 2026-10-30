// target=features: pads are filled, not the area around them
globalThis.ClipperLib = require('../vendor/clipper.js');
for (const f of ['gerber', 'toolpath', 'gcode']) require('../js/' + f + '.js');
const LG = globalThis.LG;
// one big 4x4 pad and one tiny 0.4x0.4 pad
const gbr = `%FSLAX46Y46*%\n%MOMM*%\n%ADD10R,4.0X4.0*%\n%ADD11R,0.4X0.4*%\nD10*\nX5000000Y5000000D03*\nD11*\nX12000000Y5000000D03*\nM02*\n`;
const gb = LG.parseGerber(gbr);
for (const target of ['around', 'features']) {
  for (const mode of ['clear', 'isolate']) {
    const P = Object.assign({}, LG.defaults, { target, mode, clearance: 0 });
    const r = LG.generate(LG.prepare(gb, P), P);
    const xs = r.cuts.flatMap((c) => c.pts.map((p) => p[0])), ys = r.cuts.flatMap((c) => c.pts.map((p) => p[1]));
    const pw = [...new Set(r.cuts.map((c) => c.power.toFixed(0)))].join(',');
    console.log(target.padEnd(8), mode.padEnd(8), 'cuts', String(r.cuts.length).padStart(4), 'x', Math.min(...xs).toFixed(2) + '..' + Math.max(...xs).toFixed(2),
      'y', Math.min(...ys).toFixed(2) + '..' + Math.max(...ys).toFixed(2), 'powers', pw, 'gaps', r.gaps.length);
  }
}
console.log('(pads after zero-at-corner: big 0..4 x 0..4, small ~10..10.4 x 1.8..2.2)');
