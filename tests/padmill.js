// mill pad clearing: concentric pocketing of a big and a tiny pad
globalThis.ClipperLib = require('../vendor/clipper.js');
for (const f of ['gerber', 'toolpath', 'gcode', 'excellon', 'mill']) require('../js/' + f + '.js');
const LG = globalThis.LG;
const gbr = `%FSLAX46Y46*%\n%MOMM*%\n%ADD10R,4.0X4.0*%\n%ADD11R,0.6X0.6*%\nD10*\nX5000000Y5000000D03*\nD11*\nX12000000Y5000000D03*\nM02*\n`;
const gb = LG.parseGerber(gbr);
const P = Object.assign({}, LG.defaults, { process: 'mill', target: 'features' });
const r = LG.generateMill(LG.prepare(gb, P), {}, P);
console.log('jobs', Object.keys(r.jobs), JSON.stringify(r.stats), r.warnings);
const g = r.jobs.pads.gcode.split('\n');
console.log(g.length, 'lines; xs', Math.min(...g.filter(l=>l.startsWith('G1 X')).map(l=>+l.match(/X([-\d.]+)/)[1])), '..', Math.max(...g.filter(l=>l.startsWith('G1 X')).map(l=>+l.match(/X([-\d.]+)/)[1])));
console.log(g.slice(0, 22).join('\n'));
console.log('retracts to safe Z:', g.filter((l) => l === 'G0 Z3').length);
