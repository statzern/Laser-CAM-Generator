globalThis.ClipperLib = require('../vendor/clipper.js');
for (const f of ['gerber', 'toolpath', 'gcode']) require('../js/' + f + '.js');
const LG = globalThis.LG, fs = require('fs');
const gb = LG.parseGerber(fs.readFileSync(process.argv[2] || __dirname + '/../samples/demo-top.gbr', 'utf8'));
for (const direction of ['serpentine', 'forward', 'reverse']) {
  const P = Object.assign({}, LG.defaults, { direction });
  const r = LG.generate(LG.prepare(gb, P), P);
  const g = LG.toGcode(r, P).split('\n').filter((l) => /^G[01] /.test(l));
  console.log(direction.padEnd(11), 'cuts', r.cuts.length, 'rapid', r.stats.rapidLen.toFixed(0), 'min', r.stats.minutes.toFixed(2),
    '| first lines:', g.slice(0, 4).join(' / '));
}
