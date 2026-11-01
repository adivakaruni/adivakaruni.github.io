/* Small SVG plotting helpers shared by the prediction-market and news tabs (markets.js, news.js).
 * Every function returns an SVG string sized to the width it is given, so text keeps its size in
 * narrow panes. Colours come from CSS classes (.op-c1 … .op-c5, .op-neg, .op-pos) in outside.css. */
(function (global) {
  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const f1 = (v) => (Math.abs(v) >= 100 ? Math.round(v).toLocaleString('en-US') : +v.toFixed(Math.abs(v) >= 10 ? 0 : Math.abs(v) >= 1 ? 1 : 2));

  // Round tick values covering [lo, hi].
  function ticks(lo, hi, n = 4) {
    if (!(hi > lo)) { hi = lo + 1; }
    const raw = (hi - lo) / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), r = raw / mag;
    const step = (r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10) * mag;
    // Start at or below the lowest value and end at or above the highest, so nothing is drawn outside the axes.
    const a = Math.floor(lo / step + 1e-9) * step, z = Math.ceil(hi / step - 1e-9) * step;
    const out = [];
    for (let v = a; v <= z + step * 1e-6; v += step) out.push(+v.toPrecision(12));
    return out;
  }
  const dayMs = 864e5;
  const fmtMonth = (t, long) => { const d = new Date(t); return `${MON[d.getUTCMonth()]}${long ? ` ${String(d.getUTCFullYear()).slice(2)}` : ''}`; };
  function timeTicks(lo, hi, w) {
    const span = (hi - lo) / dayMs, want = Math.max(3, Math.min(7, Math.floor(w / 90)));
    const out = [];
    if (span <= 45) { const step = Math.ceil(span / want); for (let t = lo; t <= hi; t += step * dayMs) { const d = new Date(t); out.push([t, `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`]); } return out; }
    const months = Math.max(1, Math.round(span / 30 / want));
    const d0 = new Date(lo); let y = d0.getUTCFullYear(), m = d0.getUTCMonth() + 1;
    for (;;) { if (m > 11) { y += Math.floor(m / 12); m %= 12; } const t = Date.UTC(y, m, 1); if (t > hi) break; out.push([t, fmtMonth(t, span > 300 || m === 0)]); m += months; }
    return out;
  }

  /* Vertical bars: rows [{label, value, cls, tip}], optional reference lines refs [{v, label, cls}]. */
  function vbars(rows, o = {}) {
    const W = o.w || 600, H = o.h || 170, L = 40, R = 8, T = 12, B = o.rot ? 46 : 26;
    const vals = rows.map((r) => r.value).concat((o.refs || []).map((r) => r.v));
    const lo = Math.min(0, ...vals), hi = Math.max(o.max || 0, ...vals);
    const tk = ticks(lo, hi, 4), y0 = tk[0], y1 = tk[tk.length - 1];
    const Y = (v) => T + (1 - (v - y0) / ((y1 - y0) || 1)) * (H - T - B);
    const bw = (W - L - R) / Math.max(1, rows.length);
    const fmt = o.fmt || f1;
    const grid = tk.map((v) => `<g class="op-grid"><line x1="${L}" x2="${W - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text x="${L - 5}" y="${(Y(v) + 3).toFixed(1)}" text-anchor="end">${esc(fmt(v))}</text></g>`).join('');
    const every = Math.max(1, Math.ceil(rows.length / Math.floor((W - L - R) / (o.rot ? 18 : 46))));
    const bars = rows.map((r, i) => { const w = Math.max(1, Math.min(bw * 0.76, 64)), x = L + i * bw + (bw - w) / 2, a = Y(Math.max(0, r.value)), b = Y(Math.min(0, r.value)); return `<rect class="op-bar ${r.cls || 'op-c1'}" x="${x.toFixed(1)}" y="${a.toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(0.5, b - a).toFixed(1)}"${r.tip ? ` data-tip="${esc(r.tip)}"` : ''}/>${o.values ? `<text class="op-val" x="${(x + w / 2).toFixed(1)}" y="${(a - 3).toFixed(1)}" text-anchor="middle">${esc(fmt(r.value))}</text>` : ''}${i % every === 0 ? (o.rot ? `<text class="op-xl" transform="translate(${(x + w / 2).toFixed(1)},${H - B + 10}) rotate(-35)" text-anchor="end">${esc(r.label)}</text>` : `<text class="op-xl" x="${(x + w / 2).toFixed(1)}" y="${H - B + 15}" text-anchor="middle">${esc(r.label)}</text>`) : ''}`; }).join('');
    const refs = (o.refs || []).map((r) => `<line class="op-ref ${r.cls || ''}" x1="${L}" x2="${W - R}" y1="${Y(r.v).toFixed(1)}" y2="${Y(r.v).toFixed(1)}"/><text class="op-reft ${r.cls || ''}" x="${W - R - 2}" y="${(Y(r.v) - 4).toFixed(1)}" text-anchor="end">${esc(r.label)}</text>`).join('');
    return `<svg class="op" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria || 'Bar chart')}">${grid}<line class="op-axis" x1="${L}" x2="${W - R}" y1="${Y(0).toFixed(1)}" y2="${Y(0).toFixed(1)}"/>${bars}${refs}</svg>`;
  }

  /* Horizontal bars: rows [{label, value, cls, note}]. */
  function hbars(rows, o = {}) {
    const W = o.w || 600, rowH = o.rowH || 22, Lw = Math.min(o.labelW || 170, W * 0.42), R = 54, H = rows.length * rowH + 6;
    const mx = Math.max(o.max || 0, ...rows.map((r) => r.value)) || 1;
    const fmt = o.fmt || f1;
    const body = rows.map((r, i) => { const y = 3 + i * rowH, w = Math.max(1, (W - Lw - R) * r.value / mx); return `<g${r.tip ? ` data-tip="${esc(r.tip)}"` : ''}><text class="op-hl" x="${Lw - 8}" y="${y + rowH * 0.66}" text-anchor="end">${esc(String(r.label).length > 30 ? String(r.label).slice(0, 29) + '…' : r.label)}</text><rect class="op-bar ${r.cls || 'op-c1'}" x="${Lw}" y="${y + 3}" width="${w.toFixed(1)}" height="${rowH - 7}" rx="2"/><text class="op-val" x="${(Lw + w + 5).toFixed(1)}" y="${y + rowH * 0.66}">${esc(r.note != null ? r.note : fmt(r.value))}</text></g>`; }).join('');
    return `<svg class="op" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria || 'Bar chart')}">${body}</svg>`;
  }

  /* Lines over time or a numeric x: series [{pts:[{x,y}], cls, band:[{x,lo,hi}], dash, label}],
     marks [{x, label, cls}] (vertical), hlines [{y, label, cls}], right axis series in y2 {series, fmt, min, max}. */
  function lines(o) {
    const W = o.w || 600, H = o.h || 190, L = 44, R = o.y2 ? 44 : 10, T = 12, B = 26;
    const all = o.series.flatMap((s) => s.pts.concat(s.band ? s.band.flatMap((b) => [{ x: b.x, y: b.lo }, { x: b.x, y: b.hi }]) : []));
    if (!all.length) return '';
    const xs = all.map((p) => p.x).concat((o.marks || []).map((m) => m.x)).filter((x) => x != null);
    const x0 = o.xMin != null ? o.xMin : Math.min(...xs), x1 = o.xMax != null ? o.xMax : Math.max(...xs);
    const ys = all.map((p) => p.y).concat((o.hlines || []).map((h) => h.y));
    const tk = ticks(o.yMin != null ? o.yMin : Math.min(...ys), o.yMax != null ? o.yMax : Math.max(...ys), 4), y0 = tk[0], y1 = tk[tk.length - 1];
    const X = (x) => L + ((x - x0) / ((x1 - x0) || 1)) * (W - L - R), Y = (y) => T + (1 - (y - y0) / ((y1 - y0) || 1)) * (H - T - B);
    const fmt = o.yfmt || f1;
    const grid = tk.map((v) => `<g class="op-grid"><line x1="${L}" x2="${W - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text x="${L - 5}" y="${(Y(v) + 3).toFixed(1)}" text-anchor="end">${esc(fmt(v))}</text></g>`).join('');
    const xt = o.x === 'num' ? ticks(x0, x1, Math.max(3, Math.floor(W / 90))).map((v) => [v, (o.xfmt || f1)(v)]) : timeTicks(x0, x1, W);
    const xl = xt.filter(([v]) => v >= x0 && v <= x1).map(([v, l]) => `<text class="op-xl" x="${X(v).toFixed(1)}" y="${H - 8}" text-anchor="middle">${esc(l)}</text>`).join('');
    const path = (pts) => pts.filter((p) => p.y != null && isFinite(p.y)).map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
    const bands = o.series.filter((s) => s.band && s.band.length > 1).map((s) => `<path class="op-band ${s.cls || 'op-c1'}" d="${s.band.map((b, i) => `${i ? 'L' : 'M'}${X(b.x).toFixed(1)},${Y(b.hi).toFixed(1)}`).join('')}${s.band.slice().reverse().map((b) => `L${X(b.x).toFixed(1)},${Y(b.lo).toFixed(1)}`).join('')}Z"/>`).join('');
    const ls = o.series.map((s) => (s.dots ? s.pts.filter((p) => p.y != null && isFinite(p.y)).map((p) => `<circle class="op-dot ${s.cls || 'op-c1'}" cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="3"${p.tip ? ` data-tip="${esc(p.tip)}"` : ''}/>`).join('') : '') + (s.noLine ? '' : `<path class="op-line ${s.cls || 'op-c1'}${s.dash ? ' dash' : ''}" d="${path(s.pts)}"/>`)).join('');
    let y2 = '';
    if (o.y2 && o.y2.series.some((s) => s.pts.length)) {
      const v2 = o.y2.series.flatMap((s) => s.pts.map((p) => p.y));
      const t2 = ticks(o.y2.min != null ? o.y2.min : Math.min(...v2), o.y2.max != null ? o.y2.max : Math.max(...v2), 4), a = t2[0], b = t2[t2.length - 1];
      const Y2 = (y) => T + (1 - (y - a) / ((b - a) || 1)) * (H - T - B);
      y2 = t2.map((v) => `<text class="op-y2" x="${W - R + 5}" y="${(Y2(v) + 3).toFixed(1)}">${esc((o.y2.fmt || f1)(v))}</text>`).join('') + o.y2.series.map((s) => `<path class="op-line ${s.cls || 'op-c2'}${s.dash ? ' dash' : ''}" d="${s.pts.filter((p) => p.y != null).map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y2(p.y).toFixed(1)}`).join('')}"/>`).join('');
    }
    const marks = (o.marks || []).filter((m) => m.x >= x0 && m.x <= x1).map((m) => `<g class="op-mark ${m.cls || ''}"${m.label ? ` data-tip="${esc(m.label)}"` : ''}><line x1="${X(m.x).toFixed(1)}" x2="${X(m.x).toFixed(1)}" y1="${T}" y2="${H - B}"/><circle cx="${X(m.x).toFixed(1)}" cy="${T}" r="3"/></g>`).join('');
    const hl = (o.hlines || []).map((h) => `<line class="op-ref ${h.cls || ''}" x1="${L}" x2="${W - R}" y1="${Y(h.y).toFixed(1)}" y2="${Y(h.y).toFixed(1)}"/>${h.label ? `<text class="op-reft ${h.cls || ''}" x="${L + 4}" y="${(Y(h.y) - 4).toFixed(1)}">${esc(h.label)}</text>` : ''}`).join('');
    return `<svg class="op" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria || 'Line chart')}">${grid}${bands}${hl}${marks}${ls}${y2}${xl}</svg>`;
  }

  /* Scatter with an optional least-squares line: pts [{x, y, label, cls, tip}]. */
  function scatter(o) {
    const W = o.w || 600, H = o.h || 220, L = 46, R = 12, T = 12, B = 34;
    const pts = o.pts.filter((p) => isFinite(p.x) && isFinite(p.y));
    if (pts.length < 2) return '';
    const tx = ticks(Math.min(...pts.map((p) => p.x)), Math.max(...pts.map((p) => p.x)), 4), ty = ticks(Math.min(0, ...pts.map((p) => p.y)), Math.max(0, ...pts.map((p) => p.y)), 4);
    const X = (x) => L + ((x - tx[0]) / ((tx[tx.length - 1] - tx[0]) || 1)) * (W - L - R), Y = (y) => T + (1 - (y - ty[0]) / ((ty[ty.length - 1] - ty[0]) || 1)) * (H - T - B);
    const gx = tx.map((v) => `<text class="op-xl" x="${X(v).toFixed(1)}" y="${H - B + 14}" text-anchor="middle">${esc((o.xfmt || f1)(v))}</text>`).join('');
    const gy = ty.map((v) => `<g class="op-grid"><line x1="${L}" x2="${W - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text x="${L - 5}" y="${(Y(v) + 3).toFixed(1)}" text-anchor="end">${esc((o.yfmt || f1)(v))}</text></g>`).join('');
    let fit = '';
    const s = stats(pts);
    if (o.fit && s) fit = `<line class="op-fit" x1="${X(tx[0]).toFixed(1)}" x2="${X(tx[tx.length - 1]).toFixed(1)}" y1="${Y(s.a + s.b * tx[0]).toFixed(1)}" y2="${Y(s.a + s.b * tx[tx.length - 1]).toFixed(1)}"/>`;
    const dots = pts.map((p) => `<circle class="op-dot ${p.cls || 'op-c1'}" cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="${p.r || 4.5}"${p.tip ? ` data-tip="${esc(p.tip)}"` : ''}/>`).join('');
    const labs = `${o.xlab ? `<text class="op-axl" x="${(L + W - R) / 2}" y="${H - 3}" text-anchor="middle">${esc(o.xlab)}</text>` : ''}${o.ylab ? `<text class="op-axl" x="${L + 4}" y="${T + 8}">${esc(o.ylab)}</text>` : ''}`;
    return `<svg class="op" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria || 'Scatter plot')}">${gy}${gx}${fit}${dots}${labs}</svg>`;
  }
  // Pearson correlation and least-squares slope.
  function stats(pts) {
    const n = pts.length;
    if (n < 3) return null;
    const mx = pts.reduce((a, p) => a + p.x, 0) / n, my = pts.reduce((a, p) => a + p.y, 0) / n;
    let sxx = 0, syy = 0, sxy = 0;
    for (const p of pts) { sxx += (p.x - mx) ** 2; syy += (p.y - my) ** 2; sxy += (p.x - mx) * (p.y - my); }
    if (!sxx || !syy) return null;
    const b = sxy / sxx;
    return { n, r: sxy / Math.sqrt(sxx * syy), b, a: my - b * mx };
  }

  /* Key-figure tiles: [{k, v, sub, cls, tip}]. */
  const tiles = (items) => `<div class="op-tiles">${items.filter(Boolean).map((t) => `<div class="op-tile ${t.cls || ''}"${t.tip ? ` data-tip="${esc(t.tip)}"` : ''}><span class="op-k">${esc(t.k)}</span><b class="op-v">${esc(t.v)}</b>${t.sub ? `<span class="op-s">${esc(t.sub)}</span>` : ''}</div>`).join('')}</div>`;
  const fig = (title, svg, note, legend) => (svg ? `<figure class="op-fig"><figcaption>${esc(title)}</figcaption>${legend || ''}${svg}${note ? `<p class="op-note">${note}</p>` : ''}</figure>` : '');
  const legend = (items) => `<p class="op-legend">${items.map(([cls, label]) => `<span><i class="${cls}"></i>${esc(label)}</span>`).join('')}</p>`;

  global.OPlot = { ticks, vbars, hbars, lines, scatter, stats, tiles, fig, legend, esc };
})(window);
