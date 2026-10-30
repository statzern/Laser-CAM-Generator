/* G-code simulator: turns G-code text back into motion segments, the way a GRBL-style controller would run it.
 * Used by the preview so what you see is what the file really does.
 * Handles G0/G1/G2/G3 (I/J arcs), G4, G20/G21, G90/G91, M0/M3/M4/M5, F/S, ';' and '(...)' comments.
 * Laser rule: power = S while M3/M4 is on and the move is G1/G2/G3; G0 always has the laser off. */
(function () {
  'use strict';
  const LG = (globalThis.LG = globalThis.LG || {});

  LG.simulate = function (jobs, opt) {
    if (typeof jobs === 'string') jobs = [{ name: 'job', text: jobs }];
    opt = opt || {};
    const rapidF = opt.rapid || 3000, sMax = opt.sMax || 1000;
    const X0 = [], Y0 = [], Z0 = [], X1 = [], Y1 = [], Z1 = [], S = [], F = [], K = [], J = [], L = [], T0 = [], T1 = [];
    const lines = [], jobStart = [], jobMinZ = [], warnings = [], events = [];
    const hist = new Array(21).fill(0);
    const thr = opt.thr || 0;
    let belowLen = 0;
    let t = 0, cutLen = 0, rapidLen = 0, laserLen = 0, maxS = 0, minS = Infinity, hasZCut = false;
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;

    jobs.forEach((job, ji) => {
      let x = 0, y = 0, z = 0, f = 0, s = 0, spin = 0, abs = true, unit = 1, motion = 0, mz = 0;
      jobStart.push(lines.length);
      const src = job.text.split('\n');
      for (let li = 0; li < src.length; li++) {
        const gi = lines.length;
        lines.push(src[li]);
        const clean = src[li].replace(/;.*$/, '').replace(/\([^)]*\)/g, '').toUpperCase();
        const w = [...clean.matchAll(/([A-Z])\s*([-+]?(?:\d+\.?\d*|\.\d+))/g)].map((m) => [m[1], parseFloat(m[2])]);
        if (!w.length) continue;
        const v = {};
        let arcWanted = false, ended = false;
        for (const [c, n] of w) {
          if (c === 'G') {
            if (n === 0 || n === 1) motion = n;
            else if (n === 2 || n === 3) motion = n;
            else if (n === 4) v.dwell = true;
            else if (n === 20) unit = 25.4;
            else if (n === 21) unit = 1;
            else if (n === 90) abs = true;
            else if (n === 91) abs = false;
          } else if (c === 'M') {
            if (n === 3 || n === 4) spin = n;
            else if (n === 5) spin = 0;
            else if (n === 0 || n === 1) events.push({ t, line: gi, type: 'pause' });
            else if (n === 2 || n === 30) ended = true;
          } else v[c] = n;
        }
        if (v.F !== undefined) f = v.F * unit;
        if (v.S !== undefined) s = v.S;
        if (v.dwell && v.P !== undefined) t += v.P;
        if (ended) break;
        if (v.X === undefined && v.Y === undefined && v.Z === undefined) continue;
        const nx = v.X === undefined ? x : abs ? v.X * unit : x + v.X * unit;
        const ny = v.Y === undefined ? y : abs ? v.Y * unit : y + v.Y * unit;
        const nz = v.Z === undefined ? z : abs ? v.Z * unit : z + v.Z * unit;
        const push = (ax, ay, az, bx, by, bz) => {
          const len3 = Math.hypot(bx - ax, by - ay, bz - az);
          if (len3 < 1e-9) return;
          const rapid = motion === 0;
          const p = !rapid && spin ? s : 0;
          const dt = (len3 / (rapid ? rapidF : f > 0 ? f : rapidF)) * 60;
          X0.push(ax); Y0.push(ay); Z0.push(az); X1.push(bx); Y1.push(by); Z1.push(bz);
          S.push(p); F.push(rapid ? 0 : f); K.push(rapid ? 0 : 1); J.push(ji); L.push(gi);
          T0.push(t); t += dt; T1.push(t);
          const xy = Math.hypot(bx - ax, by - ay);
          if (rapid) rapidLen += len3;
          else {
            cutLen += len3;
            if (p > 0) {
              laserLen += xy; if (thr && p < thr - 1e-6) belowLen += xy; if (p > maxS) maxS = p; if (p < minS) minS = p;
              hist[Math.min(20, Math.round((p / sMax) * 20))] += xy;
            }
            if (spin && (az < -0.001 || bz < -0.001)) hasZCut = true;
          }
          if (bz < mz) mz = bz;
          for (const [px, py] of [[ax, ay], [bx, by]]) {
            if (px < bx0) bx0 = px; if (px > bx1) bx1 = px; if (py < by0) by0 = py; if (py > by1) by1 = py;
          }
        };
        if (motion === 2 || motion === 3) {
          if (v.I === undefined && v.J === undefined) { warnings.push('Line ' + (li + 1) + ': arc without I/J (R form) is not supported'); x = nx; y = ny; z = nz; continue; }
          const cx = x + (v.I || 0) * unit, cy = y + (v.J || 0) * unit;
          const r = Math.hypot(x - cx, y - cy);
          const a0 = Math.atan2(y - cy, x - cx);
          let a1 = Math.atan2(ny - cy, nx - cx);
          if (motion === 2) { if (a1 >= a0 - 1e-9) a1 -= 2 * Math.PI; } else if (a1 <= a0 + 1e-9) a1 += 2 * Math.PI;
          const n = Math.max(4, Math.min(720, Math.ceil((Math.abs(a1 - a0) * r) / 0.1)));
          let px = x, py = y, pz = z;
          for (let k = 1; k <= n; k++) {
            const a = a0 + ((a1 - a0) * k) / n;
            const qx = k === n ? nx : cx + r * Math.cos(a), qy = k === n ? ny : cy + r * Math.sin(a), qz = z + ((nz - z) * k) / n;
            push(px, py, pz, qx, qy, qz);
            px = qx; py = qy; pz = qz;
          }
        } else push(x, y, z, nx, ny, nz);
        x = nx; y = ny; z = nz;
      }
      jobMinZ.push(mz);
    });

    const n = X0.length;
    const f32 = (a) => Float32Array.from(a);
    return {
      n, total: t, cutLen, rapidLen, laserLen, maxS, belowLen, thr, minS: minS === Infinity ? 0 : minS, hist,
      hasZCut, kind: hasZCut ? 'mill' : 'laser', sMax,
      X0: f32(X0), Y0: f32(Y0), Z0: f32(Z0), X1: f32(X1), Y1: f32(Y1), Z1: f32(Z1), S: f32(S), F: f32(F),
      K: Uint8Array.from(K), J: Int32Array.from(J), L: Int32Array.from(L), T0: Float64Array.from(T0), T1: Float64Array.from(T1),
      lines, jobNames: jobs.map((j) => j.name), jobStart, jobMinZ, warnings, events,
      bounds: n ? { minX: bx0, minY: by0, maxX: bx1, maxY: by1 } : { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    };
  };

  /** Number of segments fully finished by time t (seconds). */
  LG.simIndex = function (sim, t) {
    let lo = 0, hi = sim.n;
    while (lo < hi) { const m = (lo + hi) >> 1; if (sim.T1[m] <= t) lo = m + 1; else hi = m; }
    return lo;
  };

  /** Machine state at time t: position, S, F, Z and the G-code line being executed. */
  LG.simAt = function (sim, t) {
    if (!sim.n) return null;
    const i = Math.min(sim.n - 1, LG.simIndex(sim, t));
    const d = sim.T1[i] - sim.T0[i], u = d > 0 ? Math.max(0, Math.min(1, (t - sim.T0[i]) / d)) : 1;
    return {
      i, u, x: sim.X0[i] + (sim.X1[i] - sim.X0[i]) * u, y: sim.Y0[i] + (sim.Y1[i] - sim.Y0[i]) * u,
      z: sim.Z0[i] + (sim.Z1[i] - sim.Z0[i]) * u, s: sim.S[i], f: sim.F[i], rapid: !sim.K[i], line: sim.L[i], job: sim.J[i],
    };
  };
})();
