/* GUI: parameter form, canvas preview, export. */
(function () {
  'use strict';
  const LG = window.LG, S = LG.SCALE;
  const $ = (s) => document.querySelector(s);
  const STORE = 'lasergen.params.v1';

  const isClear = (p) => p.mode === 'clear';
  const isIso = (p) => p.mode === 'isolate';
  const isFeat = (p) => p.target === 'features';
  const isAround = (p) => !isFeat(p);
  const SECTIONS = [
    { title: 'Process', open: true, fields: [
      { k: 'process', l: 'Process', t: 'select', o: [['laser', 'Laser'], ['mill', 'Milling / drilling']] },
    ] },
    { title: 'Job', open: true, proc: 'laser', fields: [
      { k: 'mode', l: 'Mode', t: 'select', o: [['clear', 'Clear copper (hatch or contour)'], ['isolate', 'Isolation contours']] },
      { k: 'target', l: 'Clear target', t: 'select', o: [['around', 'Around the features (copper layer)'], ['features', 'The features (solder mask / paste)']], h: 'Mask and paste files: the openings / pads are what gets removed.' },
      { k: 'beamX', l: 'Spot width (X)', u: 'mm', step: 0.005, min: 0.005, h: 'Size of the laser dot across X. The dot is treated as an ellipse; set both sizes equal for a round dot.' },
      { k: 'beamY', l: 'Spot height (Y)', u: 'mm', step: 0.005, min: 0.005, h: 'Size of the laser dot across Y. The line it cuts is as wide as the dot is across the direction of travel: the Y size when moving along X, the X size when moving along Y.' },
      { k: 'dirComp', l: 'Scale power with line width', t: 'check', show: (p) => p.process === 'laser' && p.beamX !== p.beamY, h: 'A narrower line concentrates the same energy, so power is scaled to keep the dose per area constant. The widest direction gets the baseline power.' },
      { k: 'clearance', l: 'Extra clearance', u: 'mm', step: 0.01, min: 0, h: 'Additional standoff from the feature edge so the laser does not nibble it.' },
      { k: 'margin', l: 'Clear border', u: 'mm', step: 0.5, min: 0, show: (p) => isClear(p) && isAround(p) && p.clearStyle !== 'contour', h: 'How far past the copper bounding box to clear. Contour clearing never clears outside the copper edge, so this only applies to hatching.' },
      { k: 'passes', l: 'Repeat passes', u: '×', step: 1, min: 1 },
    ] },
    { title: 'Clearing', open: true, proc: 'laser', show: isClear, fields: [
      { k: 'clearStyle', l: 'Clear with', t: 'select', o: [['hatch', 'Hatch lines'], ['contour', 'Contours (outside in)']], h: 'Contours trace the edge of the cleared area next to the copper first, then add passes stepping away from it until the area is clear. Nothing outside the copper edge is cleared.' },
      { k: 'contourMax', l: 'Max contour passes', step: 1, min: 0, show: (p) => p.clearStyle === 'contour', h: 'Most passes out from each copper edge. Wide areas stop here instead of being cleared completely. 0 = keep going until the area is clear (can be very long).' },
      { k: 'isoOverlap', l: 'Pass overlap', step: 0.05, min: 0, max: 0.9, show: (p) => p.clearStyle === 'contour', h: 'Fraction of the line width shared between concentric passes.' },
      { k: 'angle', l: 'Hatch angle', u: '°', step: 5, h: '0° = lines along X. 90° = along Y.', show: (p) => p.clearStyle === 'hatch' },
      { k: 'autoSpacing', l: 'Spacing from line width', t: 'check', h: 'Sets the spacing as a percentage of the line width the dot cuts at the hatch angle. With a narrow dot, 0° (along X) cuts the wider line and needs fewer passes.', show: (p) => p.clearStyle === 'hatch' },
      { k: 'spacingPct', l: 'Spacing', u: '% of line', step: 5, min: 10, max: 100, show: (p) => p.clearStyle === 'hatch' && p.autoSpacing, h: 'Normally 60–90 % for solid clearing.' },
      { k: 'spacing', l: 'Line spacing', u: 'mm', step: 0.01, min: 0.01, show: (p) => p.clearStyle === 'hatch' && !p.autoSpacing, h: 'Keep this at or below the line width at the hatch angle, normally 60–90 % of it.' },
      { k: 'crossHatch', l: 'Cross-hatch (+90° pass)', t: 'check', show: (p) => p.clearStyle === 'hatch' },
      { k: 'direction', l: 'Directionality', t: 'select', o: [['serpentine', 'Serpentine (bidirectional)'], ['forward', 'One-way, low→high'], ['reverse', 'One-way, high→low']], h: 'One-way keeps heat/kerf uniform at the cost of rapids.', show: (p) => p.clearStyle === 'hatch' },
      { k: 'interleave', l: 'Line interleave', u: '×', step: 1, min: 1, h: 'N = burn every Nth line first, then fill in. Gives each area time to cool.', show: (p) => p.clearStyle === 'hatch' },
    ] },
    { title: 'Isolation', proc: 'laser', show: isIso, open: true, fields: [
      { k: 'isoPasses', l: 'Contour passes', step: 1, min: 1 },
      { k: 'isoOverlap', l: 'Pass overlap', step: 0.05, min: 0, max: 0.9, h: 'Fraction of beam width shared between concentric passes.' },
    ] },
    { title: 'Leftover islands', proc: 'laser', open: true, show: (p) => isAround(p) && (isIso(p) || (isClear(p) && p.clearStyle === 'contour')), fields: [
      { k: 'fillIslands', l: 'Clear leftover islands', t: 'check', show: isAround, h: 'Resist strips and specks the passes leave between neighbouring features are hatched away so they cannot hold stray copper.' },
      { k: 'fillIgnore', l: 'Ignore leftovers smaller than', u: 'mm²', step: 0.005, min: 0, show: (p) => isAround(p) && p.fillIslands, h: 'Leftover pieces below this area are skipped: corner blips and specks too small to matter. Raise it if you still see many tiny patches; lower it if thin strips are left behind.' },
      { k: 'fillWidth', l: 'Widest strip to clear', u: 'mm', step: 0.05, min: 0.05, show: (p) => isAround(p) && p.fillIslands, h: 'Leftover strips up to this width are cleared. Wider leftovers are the areas you chose not to clear (max passes) and are left alone. Use at least one spot width.' },
      { k: 'fillMaxArea', l: 'Largest pocket to clear', u: 'mm²', step: 0.1, min: 0, show: (p) => isAround(p) && p.fillIslands, h: 'Enclosed pockets of leftover resist up to this area are cleared.' },
    ] },
    { title: 'Speed & power', open: true, proc: 'laser', fields: [
      { k: 'feed', l: 'Feed rate', u: 'mm/min', step: 50, min: 1 },
      { k: 'power', l: 'Baseline power', u: '%', step: 1, min: 0, max: 100, h: 'Power on large / well-heat-sunk features.' },
      { k: 'minPower', l: 'Minimum power', u: '%', step: 1, min: 0, max: 100, h: 'Floor for the smallest features.' },
      { k: 'ablateMin', l: 'Clean-ablation threshold', u: '%', step: 1, min: 0, max: 100, h: 'Lowest power that clears your resist cleanly at the feed above (find it with the test card). 0 = unknown. Cuts below it are warned about and shown in magenta.' },
      { k: 'ablateClamp', l: 'Never go below the threshold', t: 'check', h: 'Raises the effective minimum power to the threshold.' },
    ] },
    { title: 'Area-based power', open: true, proc: 'laser', fields: [
      { k: 'islandDerate', l: 'Protect resist near small features', t: 'check', show: isAround, h: 'Beam heat flows into the copper you keep. Small pads and traces have little copper to absorb it, so their resist heats most. Power is lowered near them, by their copper area.' },
      { k: 'islandDerate', l: 'Derate small features', t: 'check', show: isFeat, h: 'Lowers power on each feature being cleared, by its own area, so tiny pads do not overheat.' },
      { k: 'areaRef', l: 'Full-power area', u: 'mm²', step: 0.5, min: 0.01, h: 'Copper islands at or above this area get baseline power.' },
      { k: 'areaExp', l: 'Curve exponent', step: 0.05, min: 0.05, max: 3, h: 'power scale = (area/ref)^exp. <1 gentle on mid sizes, 1 linear, >1 aggressive.' },
      { k: 'influence', l: 'Influence distance', u: 'mm', step: 0.1, min: 0, show: isAround, h: 'How far from a small feature the reduction reaches.' },
      { k: 'falloff', l: 'Falloff', t: 'select', show: isAround, o: [['fade', 'Fade back to baseline'], ['step', 'Flat inside the distance']], h: 'Fade: full reduction at the feature, rising to baseline at the influence distance.' },
      { k: 'patchDerate', l: 'Derate small cleared patches', t: 'check', show: (p) => isClear(p) && isAround(p), h: 'Apply the same law to the area of each separate cleared region.' },
      { k: 'patchRef', l: 'Patch full-power area', u: 'mm²', step: 0.5, min: 0.01, show: (p) => isClear(p) && isAround(p) && p.patchDerate },
      { k: 'lineDerate', l: 'Derate short lines', t: 'check', show: isClear, h: 'Short hatch lines revisit the same spot quickly, so they run cooler.' },
      { k: 'lineRef', l: 'Full-power line length', u: 'mm', step: 0.1, min: 0.1, show: (p) => isClear(p) && p.lineDerate },
    ] },
    { title: 'Tool', open: true, proc: 'mill', fields: [
      { k: 'target', l: 'Layer type', t: 'select', o: [['around', 'Copper layer (isolation, drill, outline)'], ['features', 'Mask / paste layer (clear the pads)']], h: 'For mask or paste files the features are the areas to remove.' },
      { k: 'doIso', l: 'Generate isolation', t: 'check', show: isAround },
      { k: 'doDrill', l: 'Generate drilling', t: 'check', show: isAround },
      { k: 'doOutline', l: 'Generate outline & slots', t: 'check', show: isAround, h: 'Slots and routed holes are part of the outline job.' },
      { k: 'toolType', l: 'Isolation tool', show: isAround, t: 'select', o: [['vbit', 'V-bit'], ['endmill', 'Flat endmill']] },
      { k: 'vTip', l: 'V-bit tip width', u: 'mm', step: 0.01, min: 0, show: (p) => isAround(p) && p.toolType === 'vbit' },
      { k: 'vAngle', l: 'V-bit included angle', u: '°', step: 5, min: 5, max: 120, show: (p) => isAround(p) && p.toolType === 'vbit', h: 'Cut width = tip + 2·depth·tan(angle/2).' },
      { k: 'endDia', l: 'Endmill diameter', u: 'mm', step: 0.01, min: 0.05, show: (p) => isAround(p) && p.toolType === 'endmill' },
      { k: 'clearance', l: 'Extra clearance', u: 'mm', step: 0.01, min: 0, show: isAround, h: 'Standoff of the first pass from copper.' },
      { k: 'spindle', l: 'Spindle speed (S)', step: 500, min: 0 },
      { k: 'zSafe', l: 'Safe Z (travel)', u: 'mm', step: 0.5, min: 0.5 },
      { k: 'zClear', l: 'Clearance Z (plunge start)', u: 'mm', step: 0.1, min: 0.1 },
    ] },
    { title: 'Pad clearing', open: true, proc: 'mill', show: isFeat, fields: [
      { k: 'padTool', l: 'Endmill diameter', u: 'mm', step: 0.1, min: 0.05, h: 'Features smaller than this are skipped.' },
      { k: 'padDepth', l: 'Cut depth', u: 'mm', step: 0.01, min: 0.01, h: 'Shallow: just through the mask or paste layer.' },
      { k: 'padStep', l: 'Depth per pass', u: 'mm', step: 0.01, min: 0.01 },
      { k: 'padOverlap', l: 'Stepover overlap', step: 0.05, min: 0, max: 0.9, h: 'Fraction of the tool shared by neighbouring passes.' },
      { k: 'padInset', l: 'Extra inset from edge', u: 'mm', step: 0.01, h: 'Positive stays inside the feature edge; negative overshoots.' },
      { k: 'padFeed', l: 'Feed', u: 'mm/min', step: 10, min: 1 },
      { k: 'padPlunge', l: 'Plunge feed', u: 'mm/min', step: 10, min: 1 },
    ] },
    { title: 'Isolation routing', open: true, proc: 'mill', show: isAround, fields: [
      { k: 'isoDepth', l: 'Cut depth', u: 'mm', step: 0.01, min: 0.01, h: 'Z0 = copper surface. Deeper V-bit cuts are wider.' },
      { k: 'mPasses', l: 'Passes', step: 1, min: 1 },
      { k: 'mOverlap', l: 'Pass overlap', step: 0.05, min: 0, max: 0.9 },
      { k: 'mFeed', l: 'Feed', u: 'mm/min', step: 10, min: 1 },
      { k: 'mPlunge', l: 'Plunge feed', u: 'mm/min', step: 10, min: 1 },
    ] },
    { title: 'Drilling', open: false, proc: 'mill', show: isAround, fields: [
      { k: 'drillVias', l: 'Drill vias', t: 'check', h: 'Holes from a file named *Via* are skipped when off.' },
      { k: 'drillDepth', l: 'Drill depth', u: 'mm', step: 0.1, min: 0.1, h: 'Board thickness plus a little extra.' },
      { k: 'drillFeed', l: 'Drill feed', u: 'mm/min', step: 10, min: 1 },
      { k: 'peck', l: 'Peck depth (0 = off)', u: 'mm', step: 0.1, min: 0 },
      { k: 'millHolesAbove', l: 'Route holes ≥ (0 = off)', u: 'mm', step: 0.1, min: 0, h: 'Larger holes are milled with the outline tool instead of drilled.' },
    ] },
    { title: 'Outline & slots', open: false, proc: 'mill', show: isAround, fields: [
      { k: 'outTool', l: 'Outline endmill', u: 'mm', step: 0.1, min: 0.1 },
      { k: 'outSide', l: 'Cut side', t: 'select', o: [['outside', 'Outside the line'], ['inside', 'Inside the line'], ['on', 'On the line']] },
      { k: 'outDepth', l: 'Cut depth', u: 'mm', step: 0.1, min: 0.1 },
      { k: 'outStep', l: 'Depth per pass', u: 'mm', step: 0.1, min: 0.05 },
      { k: 'outFeed', l: 'Feed', u: 'mm/min', step: 10, min: 1 },
      { k: 'outPlunge', l: 'Plunge feed', u: 'mm/min', step: 10, min: 1 },
      { k: 'tabs', l: 'Holding tabs', step: 1, min: 0 },
      { k: 'tabW', l: 'Tab width', u: 'mm', step: 0.5, min: 0.5 },
      { k: 'tabH', l: 'Tab height', u: 'mm', step: 0.1, min: 0.1, h: 'Material left at the bottom in each tab.' },
      { k: 'outMargin', l: 'Fallback border', u: 'mm', step: 0.5, min: 0, h: 'If no outline file is loaded, cut a rectangle this far around the copper.' },
    ] },
    { title: 'Test card', open: false, proc: 'laser', actions: [['tc-prev', 'Preview'], ['tc-dl', 'Download .nc']], fields: [
      { k: 'tcP0', l: 'Power from', u: '%', step: 1, min: 1, max: 100, h: 'Rows step the power. Burn on scrap board with the same resist.' },
      { k: 'tcP1', l: 'Power to', u: '%', step: 1, min: 1, max: 100 },
      { k: 'tcPn', l: 'Power steps', step: 1, min: 1 },
      { k: 'tcF0', l: 'Feed from', u: 'mm/min', step: 100, min: 10, h: 'Columns step the feed rate.' },
      { k: 'tcF1', l: 'Feed to', u: 'mm/min', step: 100, min: 10 },
      { k: 'tcFn', l: 'Feed steps', step: 1, min: 1 },
    ] },
    { title: 'Machine & output', open: false, fields: [
      { k: 'sMax', l: 'Max S value ($30)', step: 1, min: 1, proc: 'laser' },
      { k: 'laserMode', l: 'Laser mode', proc: 'laser', t: 'select', o: [['M4', 'M4 dynamic power ($32=1)'], ['M3', 'M3 constant power']] },
      { k: 'mirrorX', l: 'Mirror X (bottom layer)', t: 'check' },
      { k: 'zeroAtCorner', l: 'Zero at copper lower-left', t: 'check' },
      { k: 'offsetX', l: 'Offset X', u: 'mm', step: 0.1 },
      { k: 'offsetY', l: 'Offset Y', u: 'mm', step: 0.1 },
      { k: 'rapid', l: 'Rapid rate (time est.)', proc: 'laser', u: 'mm/min', step: 100, min: 1 },
      { k: 'header', l: 'Header', t: 'text' },
      { k: 'footer', l: 'Footer', t: 'text' },
    ] },
  ];

  const state = {
    P: Object.assign({}, LG.defaults),
    gb: null, name: '', res: null, gcode: '', drill: null, outline: null, mill: null,
    view: { sc: 1, tx: 0, ty: 0 }, tNow: 0, sim: null, ext: null, pc: null, jobW: null,
    layers: { dir: false, iso: true, holes: true, outline: true, gaps: true, copper: true, clear: true, keepout: false, zones: true, path: true, rapid: false },
    cache: null,
  };
  try { Object.assign(state.P, JSON.parse(localStorage.getItem(STORE) || '{}')); } catch (_) {}
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(state.P)); } catch (_) {} };

  // ---------------------------------------------------------------- form
  const rows = [];
  function buildForm() {
    const root = $('#form'); root.innerHTML = ''; rows.length = 0;
    for (const sec of SECTIONS) {
      const d = document.createElement('details'); d.open = !!sec.open;
      const sm = document.createElement('summary'); sm.textContent = sec.title; d.appendChild(sm);
      for (const f of sec.fields) {
        const row = document.createElement('div'); row.className = 'row' + (f.t === 'text' ? ' wide' : '');
        const lab = document.createElement('label');
        lab.innerHTML = f.l + (f.u ? `<span class="unit">${f.u}</span>` : '') + (f.h ? `<small>${f.h}</small>` : '');
        let inp;
        if (f.t === 'select') {
          inp = document.createElement('select');
          for (const [v, t] of f.o) inp.add(new Option(t, v));
          inp.value = state.P[f.k];
        } else if (f.t === 'check') {
          inp = document.createElement('input'); inp.type = 'checkbox'; inp.checked = !!state.P[f.k];
        } else if (f.t === 'text') {
          inp = document.createElement('textarea'); inp.value = state.P[f.k];
        } else {
          inp = document.createElement('input'); inp.type = 'number'; inp.value = state.P[f.k];
          if (f.step) inp.step = f.step; if (f.min !== undefined) inp.min = f.min; if (f.max !== undefined) inp.max = f.max;
        }
        const ev = f.t === 'select' || f.t === 'check' ? 'change' : 'input';
        inp.addEventListener(ev, () => {
          let v;
          if (f.t === 'check') v = inp.checked; else if (f.t === 'select' || f.t === 'text') v = inp.value;
          else { v = parseFloat(inp.value); if (!isFinite(v)) return; }
          state.P[f.k] = v; save();
          if (f.k === 'process' || f.k === 'target') { buildForm(); generate(); return; }
          refreshVisibility();
          if (['mirrorX', 'zeroAtCorner', 'offsetX', 'offsetY'].includes(f.k)) state.prep = null;
          schedule();
        });
        if (f.t === 'check') { const w = document.createElement('div'); w.appendChild(inp); row.append(lab, w); } else row.append(lab, inp);
        d.appendChild(row);
        rows.push({ el: row, f, sec });
      }
      if (sec.actions) {
        const bar = document.createElement('div'); bar.className = 'profile';
        for (const [id, label] of sec.actions) { const b = document.createElement('button'); b.className = 'btn ghost'; b.id = id; b.textContent = label; bar.appendChild(b); }
        d.appendChild(bar);
      }
      sec.el = d; root.appendChild(d);
    }
    refreshVisibility();
  }
  function refreshVisibility() {
    const P = state.P, pOk = (o) => !o.proc || o.proc === P.process;
    for (const sec of SECTIONS) sec.el.style.display = pOk(sec) && (!sec.show || sec.show(P)) ? '' : 'none';
    for (const r of rows) r.el.style.display = pOk(r.f) && (!r.f.show || r.f.show(P)) ? '' : 'none';
    document.body.dataset.process = P.process;
  }

  // ---------------------------------------------------------------- generate
  let timer = null;
  function schedule() { if ($('#auto').checked) { clearTimeout(timer); timer = setTimeout(generate, 250); } }

  function generate() {
    clearTimeout(timer);
    if (!state.gb) return;
    const msgs = $('#msgs'); msgs.innerHTML = '';
    const add = (t, cls) => { const li = document.createElement('li'); li.textContent = t; if (cls) li.className = cls; msgs.appendChild(li); };
    try {
      const P = state.P;
      if (!state.prep) state.prep = LG.prepare(state.gb, P);
      if (P.process === 'mill') { generateMill(P, add); return; }
      const res = LG.generate(state.prep, P);
      state.res = res; state.gcode = LG.toGcode(res, P, { name: state.name });
      buildCache(); runSim();
      for (const w of state.gb.warnings) add(w);
      for (const w of state.sim.warnings) add('G-code: ' + w);
      res.warnings.forEach((w) => add(w));
      LG.gapWarnings(res.gaps, res.gapT).forEach((w) => add(w));
      if (P.ablateMin > 0) {
        if (P.power < P.ablateMin) add(`Baseline power (${P.power}%) is below the clean-ablation threshold (${P.ablateMin}%): the resist may not clear anywhere.`);
        else if (state.sim.belowLen > 0.5 && !P.ablateClamp) add(`${state.sim.belowLen.toFixed(0)} mm of toolpath runs below the ${P.ablateMin}% clean-ablation threshold (magenta in the preview). The resist may not clear there. Raise the minimum power or tick "Never go below the threshold".`);
      }
      if (P.power < P.minPower) add('Baseline power is below minimum power; minimum is used as the floor.');
      if (res.cuts.length > 400000) add('Very large toolpath (' + res.cuts.length + ' segments). Consider a larger line spacing.');
      if (!res.cuts.length) add('No toolpath produced. Check beam/clearance against feature spacing.');
      else add('Generated in ' + res.stats.genMs + ' ms', 'ok');
      $('#save').disabled = !res.cuts.length;
    } catch (e) {
      console.error(e); add('Error: ' + e.message);
    }
    updateInfo(); draw();
  }

  const JOBS = [['iso', '#dl-iso', 'isolation'], ['drill', '#dl-drill', 'drill'], ['outline', '#dl-out', 'outline'], ['pads', '#dl-pads', 'pads']];
  function generateMill(P, add) {
    const mr = LG.generateMill(state.prep, { drill: state.drill, outline: state.outline }, P);
    state.mill = mr;
    state.cache = { copper: polyPath(state.prep.paths) };
    runSim();
    for (const w of state.gb.warnings.concat(mr.warnings)) add(w);
    if (!isFeat(P)) {
      if (P.doDrill && !state.drill) add('No drill file loaded: drilling and slots are skipped.');
      if (P.doOutline && !state.outline) add('No outline file loaded: outline will be a rectangle around the copper.');
    }
    if (Object.keys(mr.jobs).length) add('Generated ' + Object.keys(mr.jobs).length + ' job(s)', 'ok');
    for (const [k, sel] of JOBS) $(sel).disabled = !mr.jobs[k];
    const dl = $('#stats'); dl.innerHTML = '';
    const st = mr.stats, bb = state.prep.bbox;
    const rows = [['Board size', `${(bb.maxX - bb.minX).toFixed(1)} × ${(bb.maxY - bb.minY).toFixed(1)} mm`], ['G-code run time', fmtSec(state.sim.total)]];
    if (st.pads) rows.push(['Pads cleared', `${st.pads.features} features${st.pads.skipped ? ', ' + st.pads.skipped + ' skipped' : ''}`], ['Pad clearing', `${st.pads.len.toFixed(0)} mm, ~${fmtTime(st.pads.min)}`]);
    else {
      if (st.iso) rows.push(['Isolation cut width', mr.W.toFixed(3) + ' mm'], ['Isolation', `${st.iso.passes} passes, ${st.iso.len.toFixed(0)} mm, ~${fmtTime(st.iso.min)}`]);
      if (st.drill) rows.push(['Drill', `${st.drill.holes} holes, ${st.drill.sizes} size(s)`]);
      if (st.iso) rows.push(['Narrow gaps (severe / total)', mr.gaps.length ? `<span style="color:#ff6b6b">${mr.gaps.filter((g) => g.severe).length}</span> / ${mr.gaps.length}` : '0']);
      if (st.outline) rows.push(['Outline & slots', `${st.outline.len.toFixed(0)} mm, ~${fmtTime(st.outline.min)}`]);
    }
    for (const [k, v] of rows) dl.insertAdjacentHTML('beforeend', `<dt>${k}</dt><dd>${v}</dd>`);
    const first = mr.jobs.iso || mr.jobs.drill || mr.jobs.outline || mr.jobs.pads;
    if (!first) add('All jobs are switched off.');
    const g = first ? first.gcode.split('\n') : [];
    $('#gcode').textContent = g.slice(0, 300).join('\n') + (g.length > 300 ? `\n… (${g.length - 300} more lines, first job shown)` : '');
    const h = $('#hist'); h.getContext('2d').clearRect(0, 0, h.width, h.height);
    draw();
  }

  function updateInfo() {
    if (state.P.process === 'mill') return;
    const r = state.res, dl = $('#stats'); dl.innerHTML = '';
    if (!r) return;
    const st = r.stats, bb = r.bbox;
    const rows = [
      ['Board size', `${(bb.maxX - bb.minX).toFixed(1)} × ${(bb.maxY - bb.minY).toFixed(1)} mm`],
      ['Run time (from G-code)', fmtSec(state.sim.total)],
      ['Cut length', st.cutLen.toFixed(0) + ' mm'],
      ['Rapid length', st.rapidLen.toFixed(0) + ' mm'],
      ['Segments', st.cuts.toLocaleString()],
      ['Power min / mean / max', `${st.pMin.toFixed(0)} / ${st.pMean.toFixed(0)} / ${st.pMax.toFixed(0)} %`],
      ['G-code check', gcodeCheck(r, state.sim)],
      ...(state.P.ablateMin > 0 ? [['Below clean-ablation threshold', state.sim.belowLen > 0.5 ? `<span style="color:#ff2bd6">${state.sim.belowLen.toFixed(0)} mm (${((100 * state.sim.belowLen) / Math.max(state.sim.laserLen, 1)).toFixed(0)}%)</span>` : '<span style="color:#35c27a">none</span>']] : []),
      ['Narrow gaps (severe / total)', r.gaps.length ? `<span style="color:#ff6b6b">${r.gaps.filter((g) => g.severe).length}</span> / ${r.gaps.length}` : '0'],
      ['Copper islands', st.islands],
      ...(state.P.fillIslands && !(state.P.target === 'features') ? [['Leftover islands cleared', st.fillPatches + (st.fillIgnored ? ` (${st.fillIgnored} tiny ignored)` : '')]] : []),
      ['Derated islands', st.derated],
      ['G-code lines', state.gcode.split('\n').length.toLocaleString()],
    ];
    for (const [k, v] of rows) { dl.insertAdjacentHTML('beforeend', `<dt>${k}</dt><dd>${v}</dd>`); }
    drawHist(state.sim.hist);
    const pre = $('#gcode');
    const lines = state.gcode.split('\n');
    pre.textContent = lines.slice(0, 300).join('\n') + (lines.length > 300 ? `\n… (${lines.length - 300} more lines)` : '');
    drawLegend();
  }
  /** Compare what the engine planned with what the G-code text actually does. */
  function gcodeCheck(r, sim) {
    const d = (100 * (sim.laserLen - r.stats.cutLen)) / Math.max(r.stats.cutLen, 1e-9);
    const sMaxOk = sim.maxS <= state.P.sMax + 1e-6;
    return Math.abs(d) < 0.5 && sMaxOk ? `<span style="color:#35c27a">✓ matches (Δ${d.toFixed(2)}%)</span>` : `<span style="color:#e9b25a">⚠ Δ${d.toFixed(1)}%${sMaxOk ? '' : ', S over max'}</span>`;
  }
  const fmtTime = (m) => (m >= 60 ? Math.floor(m / 60) + ' h ' + Math.round(m % 60) + ' min' : m.toFixed(1) + ' min');

  function drawHist(h) {
    const c = $('#hist'), g = c.getContext('2d'), W = c.width, H = c.height;
    g.clearRect(0, 0, W, H);
    const mx = Math.max(...h, 1e-9), bw = W / h.length;
    h.forEach((v, i) => {
      if (!v) return;
      const bh = (v / mx) * (H - 16);
      g.fillStyle = colorFor(i * 5, 0, 100);
      g.fillRect(i * bw + 1, H - 14 - bh, bw - 2, bh);
    });
    g.fillStyle = '#8b95a5'; g.font = '10px sans-serif';
    g.fillText('0%', 2, H - 3); g.fillText('50%', W / 2 - 8, H - 3); g.fillText('100%', W - 26, H - 3);
  }

  // ---------------------------------------------------------------- preview (plays back the simulated G-code)
  const cv = $('#cv'), ctx = cv.getContext('2d');
  const NB = 32;
  const colorFor = (p, lo, hi) => {
    const t = hi > lo ? Math.max(0, Math.min(1, (p - lo) / (hi - lo))) : 1;
    return `hsl(${230 - 230 * t},90%,${52 + 6 * (1 - t)}%)`;
  };
  const JOBCOL = { iso: 'rgba(70,200,230,.9)', drill: '#ff6b6b', outline: '#f2f2f7', pads: 'rgba(127,224,192,.9)', file: 'rgba(70,200,230,.9)' };
  const fmtSec = (s) => { s = Math.round(s); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  function polyPath(paths) {
    const p = new Path2D();
    for (const poly of paths) {
      poly.forEach((q, i) => (i ? p.lineTo(q.X / S, q.Y / S) : p.moveTo(q.X / S, q.Y / S)));
      p.closePath();
    }
    return p;
  }
  function buildCache() {
    const r = state.res;
    state.cache = {
      copper: polyPath(r.copper), clear: polyPath(r.clearRegion), fill: polyPath(r.fillRegion || []), keepout: polyPath(r.keepout),
      zones: r.zones.map((z) => polyPath(z.paths)),
    };
  }
  const curSim = () => (state.ext ? state.ext.sim : state.sim);

  /** Simulate the real G-code text; everything drawn in the toolpath layer comes from this. */
  function runSim() {
    const P = state.P;
    const jobs = P.process === 'mill'
      ? Object.keys(state.mill.jobs).map((k) => ({ name: k, text: state.mill.jobs[k].gcode }))
      : [{ name: 'laser', text: state.gcode }];
    state.sim = LG.simulate(jobs, { rapid: P.rapid, sMax: P.sMax, thr: P.process === 'laser' ? (P.ablateMin / 100) * P.sMax : 0 });
    state.ext = null; state.tc = null;
    state.jobW = { iso: state.mill ? state.mill.W : 0.1, drill: 0.5, outline: P.outTool, pads: P.padTool };
    resetPlayback();
  }
  function resetPlayback() {
    const sim = curSim();
    state.tNow = sim ? sim.total : 0; state.pc = null;
    scr.value = 1000; updateClock();
  }

  /** Path2D caches for the segments already played: incremental while moving forward, rebuilt when going back. */
  function ensurePaths(idx) {
    const sim = curSim();
    let pc = state.pc;
    if (!pc || idx < pc.idx || pc.sim !== sim) {
      pc = state.pc = { sim, idx: 0, bk: null, below: new Path2D(), off: new Path2D(), rap: new Path2D(), jobs: {}, dots: [] };
      if (sim.kind === 'laser') pc.bk = Array.from({ length: NB }, () => new Path2D());
      pc.lo = sim.minS; pc.hi = sim.maxS;
    }
    const nm = sim.jobNames;
    for (let i = pc.idx; i < idx; i++) {
      const x0 = sim.X0[i], y0 = sim.Y0[i], x1 = sim.X1[i], y1 = sim.Y1[i];
      if (!sim.K[i]) { if (sim.n < 120000) { pc.rap.moveTo(x0, y0); pc.rap.lineTo(x1, y1); } continue; }
      if (sim.kind === 'laser') {
        const p = sim.S[i];
        if (p <= 0) { pc.off.moveTo(x0, y0); pc.off.lineTo(x1, y1); continue; }
        if (sim.thr && p < sim.thr - 1e-6) { pc.below.moveTo(x0, y0); pc.below.lineTo(x1, y1); }
        const t = pc.hi > pc.lo ? (p - pc.lo) / (pc.hi - pc.lo) : 1;
        const b = pc.bk[Math.round(t * (NB - 1))];
        b.moveTo(x0, y0); b.lineTo(x1, y1);
      } else {
        const name = nm[sim.J[i]];
        if (x0 === x1 && y0 === y1) {
          if (name === 'drill' && sim.Z1[i] < sim.Z0[i] && sim.Z0[i] - sim.Z1[i] > 0.5) pc.dots.push([x0, y0]);
          continue;
        }
        const shallow = name === 'outline' && sim.Z0[i] > sim.jobMinZ[sim.J[i]] + 0.01 && sim.Z1[i] > sim.jobMinZ[sim.J[i]] + 0.01;
        const key = shallow ? 'tab' : name;
        (pc.jobs[key] = pc.jobs[key] || new Path2D()).moveTo(x0, y0);
        pc.jobs[key].lineTo(x1, y1);
      }
    }
    pc.idx = idx;
    return pc;
  }

  function resize() {
    const dpr = window.devicePixelRatio || 1, r = cv.getBoundingClientRect();
    cv.width = Math.max(1, r.width * dpr); cv.height = Math.max(1, r.height * dpr);
    draw();
  }
  function fit() {
    let b = state.prep ? state.prep.bbox : state.gb ? state.gb.bbox : null, m = (state.P.margin || 0) + 4;
    if (state.ext || !b) { const sim = curSim(); if (sim && sim.n) { b = sim.bounds; m = 4; } }
    const r = cv.getBoundingClientRect();
    if (!b || !r.width) return;
    const w = b.maxX - b.minX + 2 * m, h = b.maxY - b.minY + 2 * m;
    const sc = Math.min(r.width / w, (r.height - 70) / h);
    state.view = { sc, tx: r.width / 2 - ((b.minX + b.maxX) / 2) * sc, ty: (r.height - 50) / 2 - ((b.minY + b.maxY) / 2) * sc };
    draw();
  }
  function draw() {
    const dpr = window.devicePixelRatio || 1, H = cv.height / dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0e1014'; ctx.fillRect(0, 0, cv.width, cv.height);
    const { sc, tx, ty } = state.view, c = state.cache;
    ctx.setTransform(dpr * sc, 0, 0, -dpr * sc, dpr * tx, dpr * (H - ty));
    const px = 1 / sc;
    ctx.lineWidth = px; ctx.strokeStyle = '#2a313b';
    ctx.beginPath(); ctx.moveTo(-1e4, 0); ctx.lineTo(1e4, 0); ctx.moveTo(0, -1e4); ctx.lineTo(0, 1e4); ctx.stroke();
    const feat = state.P.target === 'features', mill = state.P.process === 'mill';
    if (c && !state.ext) {
      if (!mill) {
        if (feat && state.layers.copper) { ctx.fillStyle = 'rgba(201,162,74,.4)'; ctx.fill(c.copper, 'evenodd'); }
        if (state.layers.clear) { ctx.fillStyle = feat ? 'rgba(40,170,160,.45)' : 'rgba(40,160,150,.16)'; ctx.fill(c.clear, 'evenodd'); }
        if (!feat && state.layers.copper) { ctx.fillStyle = '#c9a24a'; ctx.fill(c.copper, 'evenodd'); }
        if (state.layers.clear && c.fill) { ctx.fillStyle = 'rgba(80,200,255,.35)'; ctx.fill(c.fill, 'evenodd'); }
        if (state.layers.zones) { ctx.fillStyle = 'rgba(255,120,40,.14)'; for (const z of c.zones) ctx.fill(z, 'evenodd'); }
        if (state.layers.keepout) { ctx.strokeStyle = '#e66'; ctx.lineWidth = px; ctx.stroke(c.keepout); }
      } else if (state.layers.copper) { ctx.fillStyle = feat ? 'rgba(201,162,74,.4)' : '#c9a24a'; ctx.fill(c.copper, 'evenodd'); }
    }
    const sim = curSim();
    if (sim && sim.n) {
      const idx = LG.simIndex(sim, state.tNow);
      const pc = ensurePaths(idx);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      if (state.layers.rapid) { ctx.strokeStyle = 'rgba(200,200,200,.35)'; ctx.lineWidth = px; ctx.setLineDash([3 * px, 3 * px]); ctx.stroke(pc.rap); ctx.setLineDash([]); }
      if (sim.kind === 'laser') {
        if (state.layers.path) {
          ctx.lineWidth = Math.max(Math.max(state.P.beamX, state.P.beamY), 1.1 * px);
          ctx.strokeStyle = 'rgba(150,150,160,.35)'; ctx.stroke(pc.off);
          pc.bk.forEach((b, i) => { ctx.strokeStyle = colorFor(pc.lo + ((pc.hi - pc.lo) * i) / (NB - 1), pc.lo, pc.hi); ctx.stroke(b); });
          if (sim.thr) { ctx.strokeStyle = '#ff2bd6'; ctx.lineWidth = Math.max(Math.max(state.P.beamX, state.P.beamY) * 0.5, 1.4 * px); ctx.stroke(pc.below); }
        }
      } else {
        const W = state.jobW || {};
        const show = (name) => (name === 'iso' || name === 'pads' ? state.layers.iso : name === 'drill' ? state.layers.holes : state.layers.outline);
        for (const key of Object.keys(pc.jobs)) {
          const name = key === 'tab' ? 'outline' : key;
          if (!show(name)) continue;
          ctx.strokeStyle = key === 'tab' ? '#f5b942' : JOBCOL[name] || JOBCOL.file;
          ctx.lineWidth = Math.max((name === 'outline' ? W.outline : W[name]) || 0.2, 1.1 * px);
          if (name === 'outline') { ctx.globalAlpha = 0.45; ctx.stroke(pc.jobs[key]); ctx.globalAlpha = 1; ctx.lineWidth = 1.2 * px; }
          ctx.stroke(pc.jobs[key]);
        }
        if (state.layers.holes) for (const [hx, hy] of pc.dots) { ctx.beginPath(); ctx.arc(hx, hy, 0.35, 0, 2 * Math.PI); ctx.fillStyle = '#ff6b6b'; ctx.fill(); }
      }
      // the segment currently being executed, then the head
      const at = LG.simAt(sim, state.tNow);
      if (at && idx < sim.n && at.u > 0) {
        ctx.strokeStyle = at.rapid ? '#aaa' : '#fff'; ctx.lineWidth = Math.max(sim.kind === 'laser' ? Math.max(state.P.beamX, state.P.beamY) : 0.3, 1.5 * px);
        ctx.beginPath(); ctx.moveTo(sim.X0[at.i], sim.Y0[at.i]); ctx.lineTo(at.x, at.y); ctx.stroke();
      }
      ctx.lineCap = 'butt';
      drawDirection(px, sim, idx);
      if (at && (playing || state.tNow < sim.total)) {
        ctx.strokeStyle = at.rapid ? '#9aa' : at.s > 0 || sim.kind === 'mill' ? '#fff' : '#9aa'; ctx.lineWidth = 1.5 * px;
        ctx.beginPath(); ctx.arc(at.x, at.y, 6 * px, 0, 2 * Math.PI); ctx.moveTo(at.x - 10 * px, at.y); ctx.lineTo(at.x + 10 * px, at.y); ctx.moveTo(at.x, at.y - 10 * px); ctx.lineTo(at.x, at.y + 10 * px); ctx.stroke();
      }
    }
    if (!state.ext) drawGaps(px);
    ctx.strokeStyle = '#4f9cf5'; ctx.lineWidth = 1.5 * px;
    ctx.beginPath(); ctx.moveTo(-6 * px, 0); ctx.lineTo(10 * px, 0); ctx.moveTo(0, -6 * px); ctx.lineTo(0, 10 * px); ctx.stroke();
    drawTcLabels(dpr, H);
  }
  function drawTcLabels(dpr, H) {
    if (!state.tc || !state.ext) return;
    const { sc, tx, ty } = state.view;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = '11px ui-monospace, Menlo, monospace'; ctx.fillStyle = '#e6edf7'; ctx.strokeStyle = 'rgba(40,48,60,.9)';
    ctx.lineWidth = 1;
    for (const c of state.tc.cells) {
      const sx = tx + c.x * sc, sy = H - (ty + (c.y + c.h) * sc);
      ctx.strokeRect(sx, sy, c.w * sc, c.h * sc);
      ctx.fillText(`${c.p.toFixed(0)}%  F${Math.round(c.f)}`, sx + 3, sy + 12);
    }
  }
  function drawDirection(px, sim, idx) {
    if (!state.layers.dir) return;
    const step = Math.max(1, Math.floor(idx / 220)), sz = 5 * px;
    ctx.fillStyle = '#fff';
    for (let i = 0; i < idx; i += step) {
      if (!sim.K[i] || (sim.kind === 'laser' && sim.S[i] <= 0)) continue;
      const dx = sim.X1[i] - sim.X0[i], dy = sim.Y1[i] - sim.Y0[i], l = Math.hypot(dx, dy);
      if (l < 6 * px) continue;
      const ux = dx / l, uy = dy / l, mx = (sim.X0[i] + sim.X1[i]) / 2, my = (sim.Y0[i] + sim.Y1[i]) / 2;
      ctx.beginPath(); ctx.moveTo(mx + ux * sz, my + uy * sz); ctx.lineTo(mx - ux * sz - uy * sz * 0.7, my - uy * sz + ux * sz * 0.7); ctx.lineTo(mx - ux * sz + uy * sz * 0.7, my - uy * sz - ux * sz * 0.7); ctx.fill();
    }
  }
  function drawGaps(px) {
    const g = state.P.process === 'mill' ? state.mill && state.mill.gaps : state.res && state.res.gaps;
    if (!g || !state.layers.gaps) return;
    ctx.lineWidth = 2 * px;
    for (const q of g) { ctx.strokeStyle = q.severe ? '#ff3b3b' : '#f5b942'; ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(0.35, 7 * px), 0, 2 * Math.PI); ctx.stroke(); }
  }
  function drawLegend() {
    const sim = curSim(), g = $('#lg').getContext('2d'), w = 160;
    if (!sim) return;
    for (let x = 0; x < w; x++) { g.fillStyle = colorFor(x, 0, w - 1); g.fillRect(x, 0, 1, 10); }
    $('#lg-lo').textContent = Math.round((sim.minS / sim.sMax) * 100) + '%';
    $('#lg-hi').textContent = Math.round((sim.maxS / sim.sMax) * 100) + '%';
  }

  // ---- live readout: what the machine is doing at the playback time
  function updateClock() {
    const sim = curSim();
    $('#scr-l').textContent = sim ? fmtSec(state.tNow) + ' / ' + fmtSec(sim.total) : '';
    const live = $('#live');
    if (!sim || !sim.n) { live.textContent = ''; return; }
    const at = LG.simAt(sim, state.tNow);
    const ln = sim.lines[at.line].replace(/\s+/g, ' ').trim();
    const pw = sim.kind === 'laser' ? `S${Math.round(at.s)} (${((at.s / sim.sMax) * 100).toFixed(0)}%)  ` : '';
    live.textContent = `L${at.line + 1 - sim.jobStart[at.job]}  ${ln}   |  ${at.rapid ? 'rapid' : pw + 'F' + Math.round(at.f)}  Z${at.z.toFixed(2)}`;
  }

  // interactions
  let dragging = null;
  cv.addEventListener('mousedown', (e) => { dragging = { x: e.clientX, y: e.clientY, tx: state.view.tx, ty: state.view.ty }; cv.classList.add('drag'); });
  window.addEventListener('mouseup', () => { dragging = null; cv.classList.remove('drag'); });
  window.addEventListener('mousemove', (e) => {
    if (dragging) {
      state.view.tx = dragging.tx + (e.clientX - dragging.x);
      state.view.ty = dragging.ty - (e.clientY - dragging.y);
      draw();
    }
  });
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = r.height - (e.clientY - r.top);
    const k = Math.exp(-e.deltaY * 0.0015), v = state.view;
    const wx = (mx - v.tx) / v.sc, wy = (my - v.ty) / v.sc;
    v.sc *= k; v.tx = mx - wx * v.sc; v.ty = my - wy * v.sc;
    draw();
  }, { passive: false });
  cv.addEventListener('dblclick', fit);
  let hoverQueued = false;
  cv.addEventListener('mousemove', (e) => {
    if (dragging || hoverQueued) return;
    hoverQueued = true;
    requestAnimationFrame(() => { hoverQueued = false; hover(e); });
  });
  function hover(e) {
    const sim = curSim(), r = state.res;
    const rc = cv.getBoundingClientRect(), v = state.view;
    const x = (e.clientX - rc.left - v.tx) / v.sc, y = (rc.height - (e.clientY - rc.top) - v.ty) / v.sc;
    let txt = `X ${x.toFixed(2)}  Y ${y.toFixed(2)}`;
    if (sim && sim.n && state.layers.path) {
      const tol = 6 / v.sc, n = LG.simIndex(sim, state.tNow);
      let best = -1, bd = tol;
      for (let i = 0; i < n; i++) {
        if (!sim.K[i]) continue;
        const x0 = sim.X0[i], y0 = sim.Y0[i], x1 = sim.X1[i], y1 = sim.Y1[i];
        if (x < Math.min(x0, x1) - tol || x > Math.max(x0, x1) + tol || y < Math.min(y0, y1) - tol || y > Math.max(y0, y1) + tol) continue;
        const dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy || 1e-12;
        const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / l2));
        const d = Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy));
        if (d < bd) { bd = d; best = i; }
      }
      if (best >= 0) txt += sim.kind === 'laser'
        ? `   G-code line ${sim.L[best] + 1 - sim.jobStart[sim.J[best]]}: S${Math.round(sim.S[best])} (${((sim.S[best] / sim.sMax) * 100).toFixed(0)}%)  F${Math.round(sim.F[best])}`
        : `   ${sim.jobNames[sim.J[best]]}: Z${sim.Z1[best].toFixed(2)}  F${Math.round(sim.F[best])}`;
    }
    if (r && !state.ext && state.P.process === 'laser') {
      for (const isl of r.islands) {
        if (LG.pointInPaths(x, y, isl.paths)) { txt += `   copper island ${isl.area.toFixed(3)} mm² → scale ${isl.s.toFixed(2)}`; break; }
      }
    }
    $('#readout').textContent = txt;
  }

  // layers / scrub / playback
  document.querySelectorAll('[data-layer]').forEach((el) => el.addEventListener('change', () => { state.layers[el.dataset.layer] = el.checked; draw(); }));
  $('#fit').onclick = fit;
  const scr = $('#scr');
  scr.addEventListener('input', () => {
    const sim = curSim(); if (!sim) return;
    state.tNow = (scr.value / 1000) * sim.total;
    updateClock(); draw();
  });
  let playing = false, lastTs = 0;
  function tick(ts) {
    if (!playing) return;
    const sim = curSim();
    state.tNow = Math.min(sim.total, state.tNow + ((ts - lastTs) / 1000) * +$('#spd').value);
    lastTs = ts;
    scr.value = Math.round((state.tNow / sim.total) * 1000);
    updateClock(); draw();
    if (state.tNow >= sim.total) stop(); else requestAnimationFrame(tick);
  }
  function stop() { playing = false; $('#play').innerHTML = '&#9654;'; draw(); }
  $('#play').onclick = () => {
    const sim = curSim(); if (!sim || !sim.n) return;
    if (playing) { stop(); return; }
    if (state.tNow >= sim.total - 1e-6) { state.tNow = 0; state.pc = null; }
    playing = true; lastTs = performance.now(); $('#play').innerHTML = '&#10074;&#10074;';
    requestAnimationFrame(tick);
  };

  // ---------------------------------------------------------------- files
  function loadText(text, name) {
    try {
      state.gb = LG.parseGerber(text); state.name = name; state.prep = null;
      $('#fname').textContent = name;
      generate(); fit();
    } catch (e) { console.error(e); $('#msgs').innerHTML = '<li>Could not parse: ' + e.message + '</li>'; }
  }
  $('#file').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (f) loadText(await f.text(), f.name); e.target.value = '';
  });
  $('#gfile').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const text = await f.text();
    const sim = LG.simulate([{ name: 'file', text }], { rapid: state.P.rapid, sMax: state.P.sMax });
    state.ext = { name: f.name, sim }; e.target.value = '';
    resetPlayback(); fit();
    const dl = $('#stats'); dl.innerHTML = '';
    for (const [k, v] of [['Previewing', f.name], ['Detected as', sim.kind], ['Segments', sim.n.toLocaleString()], ['Run time', fmtSec(sim.total)], ['Cut length', sim.cutLen.toFixed(0) + ' mm'], ['Rapid length', sim.rapidLen.toFixed(0) + ' mm'], ['Max S', sim.maxS]]) dl.insertAdjacentHTML('beforeend', `<dt>${k}</dt><dd>${v}</dd>`);
    drawHist(sim.hist); drawLegend();
    $('#msgs').innerHTML = '<li class="ok">Showing an external G-code file. Press Generate to return to your job.</li>' + sim.warnings.map((w) => `<li>${w}</li>`).join('');
    $('#gcode').textContent = sim.lines.slice(0, 300).join('\n');
    document.body.dataset.sim = sim.kind; draw();
  });
  function makeCard() {
    const tc = LG.testCard(state.P);
    const sim = LG.simulate([{ name: 'card', text: tc.gcode }], { rapid: state.P.rapid, sMax: state.P.sMax });
    return { tc, sim };
  }
  $('#form').addEventListener('click', (e) => {
    if (e.target.id === 'tc-dl') { download('laser-test-card.nc', makeCard().tc.gcode); return; }
    if (e.target.id !== 'tc-prev') return;
    const { tc, sim } = makeCard();
    state.ext = { name: 'Test card', sim }; state.tc = tc;
    resetPlayback(); fit();
    const dl = $('#stats'); dl.innerHTML = '';
    for (const [k, v] of [['Showing', 'Power / speed test card'], ['Cells', tc.cells.length], ['Size', tc.width.toFixed(0) + ' × ' + tc.height.toFixed(0) + ' mm'], ['Run time', fmtSec(sim.total)], ['Power rows', tc.powers.map((p) => p.toFixed(0)).join(', ') + ' %'], ['Feed columns', tc.feeds.map((f) => Math.round(f)).join(', ')]]) dl.insertAdjacentHTML('beforeend', `<dt>${k}</dt><dd>${v}</dd>`);
    drawHist(sim.hist); drawLegend();
    $('#msgs').innerHTML = '<li class="ok">Rows step the power (bottom to top), columns step the feed (left to right). Gaps in each cell are kept features.</li><li class="ok">Find the lowest power that clears cleanly per column, then the highest before the tiny pad or thin trace resist lifts or chars. Enter the first as the clean-ablation threshold.</li>';
    $('#gcode').textContent = tc.gcode.split('\n').slice(0, 300).join('\n');
    draw();
  });
  $('#demo').onclick = () => {
    state.drill = LG.parseExcellon(LG.SAMPLE_DRILL); state.outline = LG.parseGerber(LG.SAMPLE_OUTLINE);
    $('#fname2').textContent = 'demo.drl, demo-outline.gbr';
    loadText(LG.SAMPLE, 'demo-top.gbr');
  };
  $('#drillfile').addEventListener('change', async (e) => {
    const fs = [...e.target.files]; if (!fs.length) return;
    const all = [];
    for (const f of fs) {
      const d = LG.parseExcellon(await f.text());
      const role = /via/i.test(f.name) ? 'via' : 'pth';
      d.hits.forEach((h) => (h.role = role));
      all.push(d);
    }
    state.drill = { hits: all.flatMap((d) => d.hits), slots: all.flatMap((d) => d.slots), tools: {}, warnings: all.flatMap((d) => d.warnings) };
    $('#fname2').textContent = [fs.map((f) => f.name).join('+'), state.outline && 'outline'].filter(Boolean).join(', ');
    e.target.value = ''; generate();
  });
  $('#outfile').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    state.outline = LG.parseGerber(await f.text()); $('#fname2').textContent = [state.drill && 'drill', f.name].filter(Boolean).join(', ');
    e.target.value = ''; generate();
  });
  for (const [k, sel, tag] of JOBS) {
    $(sel).onclick = () => download((state.name.replace(/\.[^.]+$/, '') || 'job') + '-' + tag + '.nc', state.mill.jobs[k].gcode);
  }
  const stage = $('#stage');
  ['dragenter', 'dragover'].forEach((t) => stage.addEventListener(t, (e) => { e.preventDefault(); stage.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => stage.addEventListener(t, (e) => { e.preventDefault(); stage.classList.remove('over'); }));
  stage.addEventListener('drop', async (e) => {
    const f = e.dataTransfer.files[0]; if (!f) return;
    const t = await f.text();
    if (/^M48|^;\s*DRILL|\.(drl|xln|exc)$/i.test(f.name) || /^\s*M48/.test(t)) { state.drill = LG.parseExcellon(t); $('#fname2').textContent = f.name; generate(); } else loadText(t, f.name);
  });

  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: type || 'text/plain' }));
    a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  $('#save').onclick = () => download((state.name.replace(/\.[^.]+$/, '') || 'job') + '-' + state.P.mode + '.nc', state.gcode);
  $('#gen').onclick = () => { state.prep = null; generate(); };
  $('#togg').onclick = () => { const p = $('#gcode'); p.hidden = !p.hidden; $('#togg').textContent = p.hidden ? 'Show' : 'Hide'; };
  $('#prof-save').onclick = () => download('lasergen-profile.json', JSON.stringify(state.P, null, 2), 'application/json');
  $('#prof-load').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { Object.assign(state.P, JSON.parse(await f.text())); save(); buildForm(); state.prep = null; generate(); } catch (err) { alert('Bad profile: ' + err.message); }
    e.target.value = '';
  });
  $('#prof-reset').onclick = () => { state.P = Object.assign({}, LG.defaults); save(); buildForm(); state.prep = null; generate(); };
  $('#auto').addEventListener('change', schedule);

  window.addEventListener('resize', resize);
  buildForm(); resize();
})();
