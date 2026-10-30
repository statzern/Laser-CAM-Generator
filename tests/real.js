// node tests/real.js <copper.gbr> [outline.gbr] [drill.drl ...]  - run real files through laser + mill, report
const fs = require('fs'), path = require('path');
globalThis.ClipperLib = require('../vendor/clipper.js');
for (const f of ['gerber', 'toolpath', 'gcode', 'excellon', 'mill']) require('../js/' + f + '.js');
const LG = globalThis.LG;
const [cu, ol, ...drl] = process.argv.slice(2);
const mirror = process.env.MIRROR === '1';
const gb = LG.parseGerber(fs.readFileSync(cu, 'utf8'));
const b = gb.bbox;
console.log(path.basename(cu), 'bbox', [b.minX, b.minY, b.maxX, b.maxY].map((v) => v.toFixed(2)).join(' '), 'paths', gb.paths.length, 'warn', gb.warnings);
const P = Object.assign({}, LG.defaults, { mirrorX: mirror });
const Pl = Object.assign({}, P, { mode: 'clear' });
const r = LG.generate(LG.prepare(gb, Pl), Pl);
const st = r.stats;
console.log('laser gaps', r.gaps.length, r.gaps.filter(g=>g.severe).length+' severe;', r.gaps.slice(0,3).map(g=>g.gap.toFixed(3)+'@'+g.x.toFixed(1)+','+g.y.toFixed(1)).join(' '), 'T', r.gapT.toFixed(3));
console.log('laser clear: islands', r.islands.length, 'derated', r.zones.length, 'patches', r.patches.length,
  'cuts', st.cuts, 'len', st.cutLen.toFixed(0), 'min', st.minutes.toFixed(1), 'power', st.pMin.toFixed(0) + '-' + st.pMax.toFixed(0), 'genMs', st.genMs);
const areas = r.islands.map((i) => i.area).sort((a, c) => a - c);
console.log('island areas mm2: min', areas[0].toFixed(3), 'median', areas[areas.length >> 1].toFixed(3), 'max', areas[areas.length - 1].toFixed(1));
const Pm = Object.assign({}, P, { process: 'mill' });
const extra = { outline: ol ? LG.parseGerber(fs.readFileSync(ol, 'utf8')) : null };
if (drl.length) {
  const all = drl.map((f) => LG.parseExcellon(fs.readFileSync(f, 'utf8')));
  extra.drill = { hits: all.flatMap((d) => d.hits), slots: all.flatMap((d) => d.slots), warnings: all.flatMap((d) => d.warnings) };
  console.log('drill hits', extra.drill.hits.map((h) => `${h.x.toFixed(2)},${h.y.toFixed(2)}:${h.d}`).join(' '), extra.drill.warnings);
}
const mr = LG.generateMill(LG.prepare(gb, Pm), extra, Pm);
console.log('mill gaps', mr.gaps.length, mr.gaps.filter(g=>g.severe).length+' severe;', mr.gaps.slice(0,3).map(g=>g.gap.toFixed(3)).join(' '), 'T', mr.gapT.toFixed(3));
console.log('mill warnings', mr.warnings, JSON.stringify(mr.stats));
if (extra.outline) console.log('outline centerlines', extra.outline.centerlines.length, 'loops', extra.outline.loops.length);
if (process.env.OUT) {
  fs.writeFileSync(path.join(process.env.OUT, 'laser.nc'), LG.toGcode(r, Pl, { name: cu }));
  for (const k of Object.keys(mr.jobs)) fs.writeFileSync(path.join(process.env.OUT, 'mill-' + k + '.nc'), mr.jobs[k].gcode);
}
