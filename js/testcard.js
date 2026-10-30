/* Power / speed test card for the laser.
 * A grid of cells: columns step the feed rate, rows step the power. Each cell clears the area around a few kept
 * features (a tiny pad, a thin trace, bigger blocks) so one burn on scrap shows both
 *   - the lowest power that clears the resist cleanly at that speed, and
 *   - where the resist on the small kept features starts to lift, char or shrink. */
(function () {
  'use strict';
  const CL = globalThis.ClipperLib;
  const LG = (globalThis.LG = globalThis.LG || {});
  const S = LG.SCALE;

  Object.assign(LG.defaults, { tcP0: 10, tcP1: 60, tcPn: 6, tcF0: 600, tcF1: 2400, tcFn: 4 });

  const lin = (a, b, n) => Array.from({ length: n }, (_, i) => (n === 1 ? a : a + ((b - a) * i) / (n - 1)));
  const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([a, b]) => ({ X: Math.round(a * S), Y: Math.round(b * S) }));

  LG.testCard = function (P) {
    const powers = lin(P.tcP0, P.tcP1, Math.max(1, Math.round(P.tcPn)));
    const feeds = lin(P.tcF0, P.tcF1, Math.max(1, Math.round(P.tcFn)));
    // kept features of one cell: [x, y, w, h] in mm
    const feats = [[0, 0, 0.8, 0.8], [2, 0, 2, 2], [5.5, 0, 0.25, 4], [0, 2.8, 4, 2.2]];
    const paths = LG.normalizePaths(feats.map((f) => rect(...f)));
    const merged = LG.clip(CL.ClipType.ctUnion, paths, []);
    const bbox = { minX: 0, minY: 0, maxX: 5.75, maxY: 5 };
    const margin = 1.5, gap = 2.5;
    const cw = bbox.maxX - bbox.minX + 2 * margin, ch = bbox.maxY - bbox.minY + 2 * margin;
    const Pc = Object.assign({}, P, {
      mode: 'clear', target: 'around', margin, passes: 1, crossHatch: false, direction: 'serpentine', interleave: 1,
      islandDerate: false, patchDerate: false, lineDerate: false, ablateClamp: false, minPower: 0,
    });
    const f3 = (v) => (Math.round(v * 1000) / 1000).toFixed(3).replace(/\.?0+$/, '') || '0';
    const out = ['; Laser Gen test card', `; columns = feed ${feeds.map((f) => Math.round(f)).join(' / ')} mm/min (left to right)`,
      `; rows = power ${powers.map((p) => p.toFixed(0)).join(' / ')} % (bottom to top)`, '; each cell clears around: tiny pad, thin trace, 2 mm pad, 4x2.2 block'];
    for (const l of P.header.split('\n')) if (l.trim()) out.push(l.trim());
    out.push(`${P.laserMode} S0`);
    const cells = [];
    let cx = null, cy = null, curS = -1, curF = -1;
    powers.forEach((pw, r) => feeds.forEach((fd, c) => {
      const ox = c * (cw + gap) + margin, oy = r * (ch + gap) + margin;
      cells.push({ x: ox - margin, y: oy - margin, w: cw, h: ch, p: pw, f: fd, row: r, col: c });
      const res = LG.generate({ paths: merged, bbox, warnings: [] }, Object.assign({}, Pc, { power: pw, feed: fd }));
      out.push(`; cell row ${r + 1} (${pw.toFixed(0)}%) col ${c + 1} (F${Math.round(fd)})`);
      const s = Math.max(0, Math.min(P.sMax, Math.round((pw / 100) * P.sMax)));
      for (const cut of res.cuts) {
        const [x0, y0] = [cut.pts[0][0] + ox, cut.pts[0][1] + oy];
        if (cx === null || Math.hypot(x0 - cx, y0 - cy) > 1e-4) out.push(`G0 X${f3(x0)} Y${f3(y0)}`);
        const [x1, y1] = [cut.pts[1][0] + ox, cut.pts[1][1] + oy];
        let line = `G1 X${f3(x1)} Y${f3(y1)}`;
        if (s !== curS) { line += ` S${s}`; curS = s; }
        if (fd !== curF) { line += ` F${f3(fd)}`; curF = fd; }
        out.push(line);
        cx = x1; cy = y1;
      }
    }));
    out.push('M5 S0');
    for (const l of P.footer.split('\n')) if (l.trim()) out.push(l.trim());
    out.push('M2');
    return { gcode: out.join('\n') + '\n', cells, powers, feeds, width: feeds.length * (cw + gap) - gap, height: powers.length * (ch + gap) - gap };
  };
})();
