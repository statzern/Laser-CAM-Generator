// synthetic check: two pads with known gaps; the finder must flag the narrow one and not the wide one
globalThis.ClipperLib = require('../vendor/clipper.js');
for (const f of ['gerber', 'toolpath']) require('../js/' + f + '.js');
const LG = globalThis.LG;
const gbr = (gap) => `%FSLAX46Y46*%\n%MOMM*%\n%ADD10R,2.0X2.0*%\nD10*\nX1000000Y1000000D03*\nX${(3 + gap) * 1e6}Y1000000D03*\nM02*\n`;
for (const gap of [0.05, 0.10, 0.15, 0.20, 0.40]) {
  const gb = LG.parseGerber(gbr(gap));
  const found = LG.findNarrowGaps(gb.paths, 0.2, 0.1);
  console.log('actual gap', gap.toFixed(2), '-> flagged', found.length, found.map((f) => 'est ' + f.gap.toFixed(3) + (f.severe ? ' SEVERE' : ' mild')).join(','), '(expect flagged if < 0.20)');
}
