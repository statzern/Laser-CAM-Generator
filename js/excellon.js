/* Excellon drill file parser: holes, G85 slots and M15/M16 routed slots. All output in mm. */
(function () {
  'use strict';
  const LG = (globalThis.LG = globalThis.LG || {});

  LG.parseExcellon = function (text) {
    const warnings = [];
    let u = 1, intD = 3, decD = 3, zero = 'T', decimalOnly = false, inHeader = false;
    let sawUnits = false;
    const tools = {};
    let cur = null, x = 0, y = 0, routing = false, routeFrom = null, tool = null;
    const hits = [], slots = [];

    const setUnits = (inch) => {
      u = inch ? 25.4 : 1;
      if (!sawUnits) { intD = inch ? 2 : 3; decD = inch ? 4 : 3; }
      sawUnits = true;
    };
    const num = (s) => {
      if (s.indexOf('.') >= 0) return parseFloat(s) * u;
      let sign = 1;
      if (s[0] === '-' || s[0] === '+') { if (s[0] === '-') sign = -1; s = s.slice(1); }
      if (zero === 'L') s = s.padEnd(intD + decD, '0'); // LZ: leading zeros kept, trailing omitted
      return sign * (parseInt(s || '0', 10) / Math.pow(10, decD)) * u;
    };

    for (let raw of text.replace(/\r/g, '').split('\n')) {
      let line = raw.trim();
      if (!line) continue;
      if (line[0] === ';') {
        const m = line.match(/FORMAT\s*=\s*\{(\d+):(\d+)/i);
        if (m) { intD = +m[1]; decD = +m[2]; sawUnits = true; }
        continue;
      }
      if (line === 'M48') { inHeader = true; continue; }
      if (line === '%' || line === 'M95') { inHeader = false; continue; }
      if (/^(METRIC|INCH)/.test(line)) {
        setUnits(line.startsWith('INCH'));
        if (/TZ/.test(line)) zero = 'T'; else if (/LZ/.test(line)) zero = 'L';
        continue;
      }
      if (/^M71/.test(line)) { setUnits(false); continue; }
      if (/^M72/.test(line)) { setUnits(true); continue; }
      if (/^(FMAT|ICI|VER|DETECT|G90|G05|G93)/.test(line)) continue;
      const td = line.match(/^T(\d+).*?C([\d.]+)/);
      if (td) {
        tools[+td[1]] = parseFloat(td[2]) * u;
        if (!inHeader) cur = tools[+td[1]];
        continue;
      }
      const ts = line.match(/^T(\d+)\s*$/);
      if (ts) { tool = +ts[1]; cur = tools[tool] || null; if (tool && !cur) warnings.push('Drill tool T' + tool + ' has no diameter'); continue; }
      if (inHeader) continue;
      if (/^M30|^M00/.test(line)) break;
      if (/^M15/.test(line)) { routing = true; routeFrom = [x, y]; continue; }
      if (/^M16|^M17/.test(line)) { routing = false; continue; }
      const co = {};
      for (const m of line.matchAll(/([XY])([+-]?[\d.]+)/g)) co[m[1]] = num(m[2]);
      if (/^G0?0/.test(line)) { if (co.X !== undefined) x = co.X; if (co.Y !== undefined) y = co.Y; routeFrom = [x, y]; continue; }
      if (/^G0?1/.test(line) && routing && routeFrom) {
        const nx = co.X !== undefined ? co.X : x, ny = co.Y !== undefined ? co.Y : y;
        if (cur) slots.push({ x0: routeFrom[0], y0: routeFrom[1], x1: nx, y1: ny, d: cur });
        x = nx; y = ny; routeFrom = [x, y]; continue;
      }
      if (co.X === undefined && co.Y === undefined) continue;
      if (/G85/.test(line)) {
        const [a, b] = line.split('G85');
        const c0 = {}, c1 = {};
        for (const m of a.matchAll(/([XY])([+-]?[\d.]+)/g)) c0[m[1]] = num(m[2]);
        for (const m of b.matchAll(/([XY])([+-]?[\d.]+)/g)) c1[m[1]] = num(m[2]);
        const sx = c0.X !== undefined ? c0.X : x, sy = c0.Y !== undefined ? c0.Y : y;
        if (cur) slots.push({ x0: sx, y0: sy, x1: c1.X !== undefined ? c1.X : sx, y1: c1.Y !== undefined ? c1.Y : sy, d: cur });
        x = c1.X !== undefined ? c1.X : sx; y = c1.Y !== undefined ? c1.Y : sy;
        continue;
      }
      if (co.X !== undefined) x = co.X;
      if (co.Y !== undefined) y = co.Y;
      if (cur && !routing) hits.push({ x, y, d: cur });
    }
    if (!hits.length && !slots.length) warnings.push('No drill hits found');
    return { hits, slots, tools, warnings };
  };
})();
