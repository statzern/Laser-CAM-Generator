/* GRBL-style G-code writer (laser). Power is emitted as S words, scaled to sMax ($30). */
(function () {
  'use strict';
  const LG = (globalThis.LG = globalThis.LG || {});

  LG.toGcode = function (res, P, meta) {
    const f = (v) => (Math.round(v * 1000) / 1000).toFixed(3).replace(/\.?0+$/, '') || '0';
    const out = [];
    const st = res.stats;
    out.push('; Laser Gen');
    if (meta && meta.name) out.push('; source: ' + meta.name);
    out.push(`; mode=${P.mode} beam=${P.beam} spacing=${P.spacing} angle=${P.angle} dir=${P.direction} interleave=${P.interleave} passes=${P.passes}`);
    out.push(`; feed=${P.feed} power=${P.power}% min=${P.minPower}% areaRef=${P.areaRef}mm2 exp=${P.areaExp} influence=${P.influence}mm`);
    out.push(`; est. time ${st.minutes.toFixed(1)} min, cut ${st.cutLen.toFixed(0)} mm, power ${st.pMin.toFixed(0)}-${st.pMax.toFixed(0)}% (mean ${st.pMean.toFixed(0)}%)`);
    for (const l of P.header.split('\n')) if (l.trim()) out.push(l.trim());
    out.push(`${P.laserMode} S0`);
    let cx = null, cy = null, curS = -1;
    let first = true;
    for (const c of res.cuts) {
      const [x0, y0] = c.pts[0];
      if (cx === null || Math.hypot(x0 - cx, y0 - cy) > 1e-4) {
        out.push(`G0 X${f(x0)} Y${f(y0)}`);
      }
      const s = Math.max(0, Math.min(P.sMax, Math.round((c.power / 100) * P.sMax)));
      for (let i = 1; i < c.pts.length; i++) {
        const [x, y] = c.pts[i];
        let line = `G1 X${f(x)} Y${f(y)}`;
        if (s !== curS) { line += ` S${s}`; curS = s; }
        if (first) { line += ` F${f(P.feed)}`; first = false; }
        out.push(line);
      }
      const e = c.pts[c.pts.length - 1];
      cx = e[0]; cy = e[1];
    }
    out.push('M5 S0');
    for (const l of P.footer.split('\n')) if (l.trim()) out.push(l.trim());
    out.push('M2');
    return out.join('\n') + '\n';
  };
})();
