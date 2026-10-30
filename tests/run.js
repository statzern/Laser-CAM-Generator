// node tests/run.js [file.gbr]  - smoke test: parse, generate (both modes), emit gcode
const fs = require('fs'), path = require('path');
globalThis.ClipperLib = require('../vendor/clipper.js');
if (!globalThis.ClipperLib.Clipper) globalThis.ClipperLib = globalThis.ClipperLib.ClipperLib || globalThis.ClipperLib;
for (const f of ['gerber', 'toolpath', 'gcode']) require('../js/' + f + '.js');
const LG = globalThis.LG;
const file = process.argv[2] || path.join(__dirname, '../samples/demo-top.gbr');
const gb = LG.parseGerber(fs.readFileSync(file, 'utf8'));
console.log('bbox', gb.bbox, 'paths', gb.paths.length, 'warnings', gb.warnings);
for (const mode of ['clear', 'isolate']) {
  const P = Object.assign({}, LG.defaults, { mode });
  const r = LG.generate(LG.prepare(gb, P), P);
  console.log(mode, 'island areas', r.islands.map((i) => i.area.toFixed(2)).join(','),
    '\n  derated', r.zones.length, 'patches', r.patches.length);
  console.log('  ', JSON.stringify(r.stats, (k, v) => (k === 'hist' ? undefined : v)));
  const g = LG.toGcode(r, P, { name: path.basename(file) });
  const out = path.join(process.env.OUT || __dirname, `out-${mode}.nc`);
  fs.writeFileSync(out, g);
  console.log(g.split('\n').slice(0, 12).join('\n'));
}

// ---- milling
require('../js/excellon.js'); require('../js/mill.js');
const dr = LG.parseExcellon(fs.readFileSync(path.join(__dirname, '../samples/demo.drl'), 'utf8'));
const ol = LG.parseGerber(fs.readFileSync(path.join(__dirname, '../samples/demo-outline.gbr'), 'utf8'));
console.log('drill', dr.hits.length, 'hits', dr.slots.length, 'slots', dr.warnings, '| outline strokes', ol.centerlines.length);
const PM = Object.assign({}, LG.defaults, { process: 'mill', millHolesAbove: 3 });
const mr = LG.generateMill(LG.prepare(gb, PM), { drill: dr, outline: ol }, PM);
console.log('mill warnings', mr.warnings, 'W', mr.W.toFixed(3), JSON.stringify(mr.stats));
for (const k of Object.keys(mr.jobs)) {
  fs.writeFileSync(path.join(process.env.OUT || __dirname, `out-mill-${k}.nc`), mr.jobs[k].gcode);
  console.log('---', k, mr.jobs[k].gcode.split('\n').length, 'lines');
  console.log(mr.jobs[k].gcode.split('\n').slice(0, 16).join('\n'));
}

// ---- job switches
const off = Object.assign({}, PM, { doOutline: false, doIso: false });
const mo = LG.generateMill(LG.prepare(gb, off), { drill: dr, outline: ol }, off);
console.log('outline+iso off -> jobs', Object.keys(mo.jobs), 'milled holes in drill?', mo.stats.drill.holes);
