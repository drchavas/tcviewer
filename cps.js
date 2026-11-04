/* cps.js — Hart (2003) cyclone phase space for tcviewer.org (single-storm view), from RABTracks.
   Data: data/cps_<basin>.json, built by build_cps.py from RABTracks (TRACK tracker on ERA5, 1940–2025):
   {storms: {sid: {p: [[t, B, VTL, VTU(, raw)], ...], et: [onset, complete]}}}; VTL/VTU > 0 = warm core
   (Hart's −VTL/−VTU), centred 24-h running means (raw=1: unsmoothed end-of-track value), m.
   Adds: a "Hart phase space (RAB)" link under the storm title, rows at the bottom of the point pop-up,
   and a window with Hart's two diagrams that stays in sync with the selected track point. */
(function(){
  if(window.__cpsLoaded) return; window.__cpsLoaded = true;
  const NAME = 'Hart phase space (RAB)';
  const cache = {};
  const load = b => cache[b] || (cache[b] = fetch('data/cps_' + b + '.json')
    .then(r => r.ok ? r.json() : {storms:{}}).catch(() => ({storms:{}})));
  let hart = null;       // sid -> {src, a, b}: Bob Hart's own diagrams (data/hart_links.json, build_hart_links.py)
  const loadHart = () => hart || (hart = fetch('data/hart_links.json').then(r => r.ok ? r.json() : {}).catch(() => ({})));
  const SRC = {era5:'ERA5', erai:'ERA-Interim', gfs:'GFS', avn:'GFS/AVN', ec:'ECMWF', ncep:'NCEP reanalysis',
               ngp:'NOGAPS', cmc:'CMC', ukm:'UKMET', jma:'JMA', merra:'MERRA'};
  let cur = null;        // {storm, pts, cps:[[t,B,VTL,VTU,trackIndex,raw]], byT:Map, et:[on,end]}
  let sel = null;        // selected track index

  // ---- phase categories (Hart 2003: asymmetric if B ≥ 10 m; warm core if −VTL > 0; deep if −VTU > 0 too)
  const PH = {
    sdw: {l:'Symmetric deep warm core',    s:'tropical',               c:'#ff6b4a'},
    ssw: {l:'Symmetric shallow warm core', s:'tropical, shallow core', c:'#ffb14e'},
    aw:  {l:'Asymmetric warm core',        s:'hybrid / transitioning', c:'#c58cff'},
    ac:  {l:'Asymmetric cold core',        s:'extratropical',          c:'#46a3ff'},
    sc:  {l:'Symmetric cold core',         s:'cold-core low',          c:'#5fd0c0'}
  };
  const MUTED = '#8a97a6';
  function phase(B, L, U){
    if(L > 0) return B >= 10 ? 'aw' : (U > 0 ? 'sdw' : 'ssw');
    return B >= 10 ? 'ac' : 'sc';
  }
  const phOf = p => phase(p[1], p[2], p[3]);
  // ERA5 says cold core while the best track has a hurricane: reanalysis missed the warm core
  function conflicts(p){
    if(!cur || p[4] == null) return false;
    const tp = cur.pts[p[4]], k = phOf(p);
    return (k === 'ac' || k === 'sc') && tp && tp[TCV.ix.nat] === 'TS' && tp[TCV.ix.vmax] >= 64;
  }

  const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const fmt = t => `${MON[+t.slice(4,6)-1]} ${+t.slice(6,8)} ${t.slice(8,10)}Z`;
  const ep = t => Date.UTC(+t.slice(0,4), +t.slice(4,6)-1, +t.slice(6,8), +t.slice(8,10), +t.slice(10,12)||0);
  function nearest(t){        // CPS point at or within 3 h of track time t
    if(!cur) return null;
    const ex = cur.byT.get(t); if(ex) return ex;
    const e = ep(t); let best = null, bd = 3*3600e3 + 1;
    for(const p of cur.cps){ const d = Math.abs(ep(p[0]) - e); if(d < bd){ bd = d; best = p; } }
    return best;
  }
  const fx = v => (Math.round(v*10)/10).toFixed(1).replace(/\.0$/, '');   // −12.3, 5, 0.4

  // ---- styles + link + window -------------------------------------------------------------
  const css = `
  .cps-back{position:fixed;inset:0;z-index:9000;background:rgba(5,9,14,.55);display:flex;align-items:center;justify-content:center;padding:16px}
  .cps-back[hidden]{display:none}
  .cps-back.dock{background:none;pointer-events:none;justify-content:flex-start;align-items:flex-start;padding:12px}
  .cps-back.dock .cps-win{pointer-events:auto;max-width:min(980px,calc(100vw - 330px));max-height:calc(100vh - 24px)}
  .cps-win{width:100%;max-width:980px;max-height:calc(100vh - 32px);overflow:auto;background:#16212e;color:#e6edf3;border:1px solid #2a3a4d;
    border-radius:14px;box-shadow:0 18px 48px rgba(0,0,0,.5);padding:16px 18px 14px;font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;position:relative}
  .cps-win h2{margin:0;padding-right:28px;font-size:17px;font-weight:650}
  .cps-win .cps-sub{margin:2px 0 10px;color:#9fb0c0;font-size:12.5px}
  .cps-hart{margin:-6px 0 10px;font-size:12.5px;color:#c9d6e2}
  .cps-hart:empty{display:none}
  .cps-hart a{color:#7fb8ff}
  .cps-x{position:absolute;top:8px;right:10px;background:none;border:none;color:#9fb0c0;font-size:22px;line-height:1;padding:4px 6px;cursor:pointer}
  .cps-x:hover,.cps-x:focus-visible{color:#fff}
  .cps-plots{display:flex;gap:16px}
  .cps-plots>div{flex:1 1 0;min-width:0}
  .cps-plots svg{width:100%;height:auto;display:block;background:#0e1722;border:1px solid #2a3a4d;border-radius:6px}
  .cps-plots svg .pt{cursor:pointer}
  .cps-ptitle{font-size:12px;color:#9fb0c0;margin:0 0 4px}
  .cps-now{margin:10px 0 4px;min-height:20px;font-size:13px}
  .cps-now b{font-weight:650}
  .cps-bar{position:relative;height:16px;border-radius:4px;overflow:hidden;background:#0e1722;border:1px solid #2a3a4d;cursor:pointer}
  .cps-bar span{position:absolute;top:0;bottom:0}
  .cps-bar i{position:absolute;top:-2px;bottom:-2px;width:2px;background:#ffe000;display:none}
  .cps-barx{position:relative;height:13px;font-size:10px;color:#8aa0b4}
  .cps-barx span{position:absolute;transform:translateX(-50%);white-space:nowrap}
  .cps-leg{display:flex;flex-wrap:wrap;gap:4px 14px;margin-top:6px;font-size:11.5px;color:#9fb0c0}
  .cps-leg b{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px;vertical-align:-1px}
  .cps-leg b.h{background:none !important;border:1.5px solid #9fb0c0;border-radius:50%}
  .cps-et{margin-top:6px;font-size:12px;color:#c9d6e2}
  .cps-note{margin-top:10px;font-size:11.5px;color:#8597aa;line-height:1.5}
  .cps-note a{color:#7fb8ff}
  .cps-warn{color:${MUTED};font-size:11px;font-weight:400}
  @media (max-width:720px){ .cps-plots{flex-direction:column} .cps-plots svg text{font-size:13px} }`;
  let back, linkEl, lastFocus;
  const docked = () => window.innerWidth >= 1100;          // wide screens: keep the map and pop-up visible
  function ensureUI(){
    if(back) return;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    back = document.createElement('div'); back.className = 'cps-back'; back.hidden = true;
    back.innerHTML = `<div class="cps-win" role="dialog" aria-labelledby="cps-title">
      <button type="button" class="cps-x" aria-label="Close">×</button>
      <h2 id="cps-title">${NAME}</h2><div class="cps-sub"></div><div class="cps-hart"></div>
      <div class="cps-plots"><div><div class="cps-ptitle">Thermal asymmetry (B) vs. lower-level warm/cold core (−V<sub>T</sub><sup>L</sup>)</div><div class="cps-p1"></div></div>
        <div><div class="cps-ptitle">Upper (−V<sub>T</sub><sup>U</sup>) vs. lower (−V<sub>T</sub><sup>L</sup>) warm/cold core</div><div class="cps-p2"></div></div></div>
      <div class="cps-now" aria-live="polite"></div>
      <div class="cps-bar" role="img" aria-label="Phase over the storm's life"></div><div class="cps-barx"></div>
      <div class="cps-leg">${Object.values(PH).map(p => `<span><b style="background:${p.c}"></b>${p.l} <span style="opacity:.75">(${p.s})</span></span>`).join('')}
        <span><b class="h"></b>hollow = end of track (not smoothed)</span></div>
      <div class="cps-et"></div>
      <div class="cps-note">Hart (2003) cyclone phase space: <b>B</b> = 900&ndash;600&nbsp;hPa thickness asymmetry across the storm along its motion (frontal-like when &ge;&nbsp;10&nbsp;m);
        <b>&minus;V<sub>T</sub><sup>L</sup></b> and <b>&minus;V<sub>T</sub><sup>U</sup></b> = thermal wind in the 900&ndash;600 and 600&ndash;300&nbsp;hPa layers (&gt;&nbsp;0 = warm core).
        <b>These are not Bob Hart&rsquo;s own analyses</b>: values are centred 24-hour running means computed from the <b>ERA5 reanalysis</b> along the storm&rsquo;s
        ERA5 track (TRACK tracker) by <a href="https://github.com/Huracan-project/RABTracks" target="_blank" rel="noopener">RABTracks</a> (Bourdin et al., 2026,
        <a href="https://essd.copernicus.org/preprints/essd-2026-403/" target="_blank" rel="noopener">ESSD preprint</a>; GPL-3.0), 1940&ndash;2025.
        Times when the ERA5 track is more than 400&nbsp;km from the best-track position are left out.
        ERA5 smooths small, intense cores, so warm cores are often weaker than in
        <a href="https://moe.met.fsu.edu/cyclonephase/" target="_blank" rel="noopener">Hart&rsquo;s real-time and archived diagrams</a>, and it can show a cold core
        while the best track has a hurricane (shown greyed out in the point pop-up).
        Types use Hart&rsquo;s B&nbsp;&ge;&nbsp;10&nbsp;m; the extratropical-transition times are RABTracks&rsquo; own flags (|B|&nbsp;15&nbsp;m threshold).
        Click a point or the timeline to select that time on the map.</div></div>`;
    document.body.appendChild(back);
    back.querySelector('.cps-x').onclick = closeWin;
    back.addEventListener('mousedown', e => { if(e.target === back && !docked()) closeWin(); });
    document.addEventListener('keydown', e => {
      if(!back || back.hidden) return;
      if(e.key === 'Escape'){ closeWin(); return; }
      if(e.key === 'Tab' && !docked()){                       // modal on small screens: keep focus inside
        const f = [...back.querySelectorAll('button,a[href]')], i = f.indexOf(document.activeElement);
        if(e.shiftKey && i <= 0){ e.preventDefault(); f[f.length-1].focus(); }
        else if(!e.shiftKey && i === f.length-1){ e.preventDefault(); f[0].focus(); }
      }
    });
    back.addEventListener('click', e => {
      const g = e.target.closest('[data-i]'); if(!g || !window.TCV || !TCV.select) return;
      const i = g.getAttribute('data-i'); if(i !== '') TCV.select(+i);
    });
    back.querySelector('.cps-bar').addEventListener('click', e => {
      if(!cur || !TCV.select) return;
      const r = e.currentTarget.getBoundingClientRect(), f = (e.clientX - r.left) / r.width;
      const t0 = ep(cur.cps[0][0]), t1 = ep(cur.cps[cur.cps.length-1][0]), tt = t0 + f*(t1 - t0);
      let best = cur.cps[0]; for(const p of cur.cps) if(Math.abs(ep(p[0]) - tt) < Math.abs(ep(best[0]) - tt)) best = p;
      if(best[4] != null) TCV.select(best[4]);
    });
    window.addEventListener('resize', () => { if(back && !back.hidden) back.classList.toggle('dock', docked()); });
  }
  function ensureLink(){
    if(linkEl && document.body.contains(linkEl)) return linkEl;
    const imp = document.getElementById('impLink'); if(!imp) return null;
    linkEl = document.createElement('a'); linkEl.className = 'slink'; linkEl.href = '#'; linkEl.hidden = true;
    linkEl.style.display = 'block'; linkEl.style.color = '#c58cff';
    linkEl.textContent = NAME + ' →';
    linkEl.addEventListener('click', e => { e.preventDefault(); openWin(); });
    imp.insertAdjacentElement('afterend', linkEl);
    const s = document.createElement('style'); s.textContent = '.slink[hidden]{display:none !important}'; document.head.appendChild(s);
    return linkEl;
  }

  // ---- diagrams ----
  function plot(kind){
    const c = cur.cps, W = 440, H = 400, m = {l:46, r:12, t:12, b:34};
    const xs = c.map(p => p[2]), ys = c.map(p => kind === 1 ? p[1] : p[3]);
    let [x0, x1] = [-600, 300], [y0, y1] = kind === 1 ? [-25, 125] : [-600, 300];
    x0 = Math.min(x0, Math.floor(Math.min(...xs)/100)*100); x1 = Math.max(x1, Math.ceil(Math.max(...xs)/100)*100);
    if(kind === 1){ y0 = Math.min(y0, Math.floor(Math.min(...ys)/25)*25); y1 = Math.max(y1, Math.ceil(Math.max(...ys)/25)*25); }
    else { y0 = Math.min(y0, Math.floor(Math.min(...ys)/100)*100); y1 = Math.max(y1, Math.ceil(Math.max(...ys)/100)*100); }
    const X = v => m.l + (v - x0)/(x1 - x0)*(W - m.l - m.r), Y = v => H - m.b - (v - y0)/(y1 - y0)*(H - m.t - m.b);
    const xstep = 100, ystep = kind === 1 ? 25 : 100;
    let g = '';
    for(let v = Math.ceil(x0/xstep)*xstep; v <= x1; v += xstep)
      g += `<line x1="${X(v)}" y1="${m.t}" x2="${X(v)}" y2="${H-m.b}" stroke="#1b2735"/><text x="${X(v)}" y="${H-m.b+13}" fill="#8aa0b4" font-size="10" text-anchor="middle">${v}</text>`;
    for(let v = Math.ceil(y0/ystep)*ystep; v <= y1; v += ystep)
      g += `<line x1="${m.l}" y1="${Y(v)}" x2="${W-m.r}" y2="${Y(v)}" stroke="#1b2735"/><text x="${m.l-5}" y="${Y(v)+3.5}" fill="#8aa0b4" font-size="10" text-anchor="end">${v}</text>`;
    const yref = kind === 1 ? 10 : 0;
    g += `<line x1="${X(0)}" y1="${m.t}" x2="${X(0)}" y2="${H-m.b}" stroke="#55687d" stroke-width="1.3"/>`;
    g += `<line x1="${m.l}" y1="${Y(yref)}" x2="${W-m.r}" y2="${Y(yref)}" stroke="#55687d" stroke-width="1.3"/>`;
    const q = (x, y, t, anchor) => `<text x="${x}" y="${y}" fill="#6f8296" font-size="10.5" font-style="italic" text-anchor="${anchor}">${t}</text>`;
    if(kind === 1){
      g += q(m.l+6, m.t+14, 'Asymmetric cold core', 'start') + q(W-m.r-6, m.t+14, 'Asymmetric warm core', 'end')
         + q(m.l+6, H-m.b-7, 'Symmetric cold core', 'start') + q(W-m.r-6, H-m.b-7, 'Symmetric warm core', 'end');
    } else {
      g += q(W-m.r-6, m.t+14, 'Deep warm core', 'end') + q(W-m.r-6, H-m.b-7, 'Shallow warm core', 'end')
         + q(m.l+6, H-m.b-7, 'Deep cold core', 'start');
    }
    const vt = u => `−V<tspan dy="3" font-size="8">T</tspan><tspan dy="-7" font-size="8">${u}</tspan><tspan dy="4"> </tspan>`;
    g += `<text x="${(m.l+W-m.r)/2}" y="${H-4}" fill="#9fb0c0" font-size="11" text-anchor="middle">${vt('L')}(900–600 hPa thermal wind, m)</text>`;
    g += `<text transform="translate(13 ${(m.t+H-m.b)/2}) rotate(-90)" fill="#9fb0c0" font-size="11" text-anchor="middle">${kind === 1 ? 'B (900–600 hPa thickness asymmetry, m)' : vt('U') + '(600–300 hPa thermal wind, m)'}</text>`;
    // track (gaps of > 12 h, e.g. from dropped mismatched points, break the line)
    const P = c.map(p => [X(p[2]), Y(kind === 1 ? p[1] : p[3])]);
    g += `<path d="${P.map((p,i) => ((i && ep(c[i][0]) - ep(c[i-1][0]) <= 12*3600e3) ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ')}" fill="none" stroke="#7d8fa3" stroke-width="1.2" stroke-opacity=".7"/>`;
    c.forEach((p, i) => {
      const col = PH[phOf(p)].c, r = (i === 0 || i === c.length-1) ? 5 : 3.6;
      const fill = p[5] ? `fill="none" stroke="${col}" stroke-width="1.6"` : `fill="${col}" stroke="#0b1119" stroke-width=".8"`;
      g += `<circle class="pt" data-i="${p[4] ?? ''}" cx="${P[i][0].toFixed(1)}" cy="${P[i][1].toFixed(1)}" r="${r}" ${fill}><title>${fmt(p[0])}: ${PH[phOf(p)].l}; B ${fx(p[1])}, −VTL ${fx(p[2])}, −VTU ${fx(p[3])} m${p[5] ? ' (not smoothed)' : ''}</title></circle>`;
    });
    const lab = (i, t) => `<text x="${P[i][0]+7}" y="${P[i][1]-6}" fill="#e6edf3" font-size="10.5" font-weight="600" paint-order="stroke" stroke="#0e1722" stroke-width="3">${t}</text>`;
    g += lab(0, 'Start ' + fmt(c[0][0]).slice(0,-4)) + lab(c.length-1, 'End ' + fmt(c[c.length-1][0]).slice(0,-4));
    g += `<circle class="cps-sel" r="8" fill="none" stroke="#ffe000" stroke-width="2.2" style="display:none"/>`;
    const lbl = kind === 1 ? 'B versus lower-level thermal wind' : 'upper- versus lower-level thermal wind';
    return {svg: `<svg viewBox="0 0 ${W} ${H}" data-k="${kind}" role="img" aria-label="Phase-space diagram, ${lbl}, ${c.length} points">${g}</svg>`, X, Y};
  }
  let axes = null;
  function render(){
    if(!back || !cur) return;
    const s = cur.storm, nm = s.name && s.name !== 'UNNAMED' ? s.name.replace(/\w\S*/g, t => t[0] + t.slice(1).toLowerCase()) : 'Unnamed';
    back.querySelector('#cps-title').textContent = `${NAME} — ${nm} (${s.year})`;
    back.querySelector('.cps-sub').textContent = `${fmt(cur.cps[0][0])} ${cur.cps[0][0].slice(0,4)} – ${fmt(cur.cps[cur.cps.length-1][0])} · ${cur.cps.length} six-hourly points · ERA5 via RABTracks`;
    const hl = back.querySelector('.cps-hart'); hl.innerHTML = '';
    loadHart().then(H => {
      const h = H[s.sid]; if(!h || !cur || cur.storm !== s) return;
      const lk = (u, t) => u ? `<a href="${u}" target="_blank" rel="noopener">${t}</a>` : '';
      hl.innerHTML = `Bob Hart&rsquo;s own diagrams for this storm (${SRC[h.src] || h.src} analysis): ` +
        [lk(h.a, 'B vs &minus;V<sub>T</sub><sup>L</sup>'), lk(h.b, '&minus;V<sub>T</sub><sup>U</sup> vs &minus;V<sub>T</sub><sup>L</sup>')].filter(Boolean).join(' &middot; ') + ' &#8599;';
    });
    const a = plot(1), b = plot(2); axes = [a, b];
    back.querySelector('.cps-p1').innerHTML = a.svg; back.querySelector('.cps-p2').innerHTML = b.svg;
    // phase timeline bar
    const c = cur.cps, t0 = ep(c[0][0]), t1 = ep(c[c.length-1][0]), span = Math.max(1, t1 - t0);
    let bar = '';
    for(let i = 0; i < c.length; i++){
      const a0 = i ? Math.max((ep(c[i-1][0]) + ep(c[i][0]))/2, ep(c[i][0]) - 3*3600e3) : t0;
      const a1 = i < c.length-1 ? Math.min((ep(c[i][0]) + ep(c[i+1][0]))/2, ep(c[i][0]) + 3*3600e3) : t1;
      bar += `<span title="${fmt(c[i][0])}: ${PH[phOf(c[i])].l}" style="left:${((a0-t0)/span*100).toFixed(2)}%;width:${((a1-a0)/span*100+0.05).toFixed(2)}%;background:${PH[phOf(c[i])].c}"></span>`;
    }
    back.querySelector('.cps-bar').innerHTML = bar + '<i></i>';
    const day = 86400e3, step = Math.max(1, Math.ceil(span/day/8))*day; let xl = '';
    for(let t = Math.ceil(t0/day)*day; t <= t1; t += step){ const d = new Date(t);
      xl += `<span style="left:${((t-t0)/span*100).toFixed(2)}%">${MON[d.getUTCMonth()]} ${d.getUTCDate()}</span>`; }
    back.querySelector('.cps-barx').innerHTML = xl;
    const [on, end] = cur.et || [];
    const everTC = c.some(p => { const k = phOf(p); return k === 'sdw' || k === 'ssw'; });
    back.querySelector('.cps-et').innerHTML = on
      ? `Extratropical transition (RABTracks): <b>begins ${fmt(on)}</b> (last time ERA5 has a symmetric, intensifying warm core)` +
        (end ? `, <b>complete ${fmt(end)}</b> (first asymmetric cold core).` : '; completion not within the best-track period.')
      : end ? `Extratropical transition (RABTracks): <b>complete ${fmt(end)}</b> (first asymmetric cold core).`
      : everTC ? 'No extratropical transition flagged by RABTracks during the best-track period.'
      : 'ERA5 never shows this storm as a symmetric warm core, so no extratropical transition is assessed.';
    mark();
  }
  function mark(){
    if(!back || back.hidden || !cur || !axes) return;
    const p = sel != null && cur.pts[sel] ? nearest(cur.pts[sel][TCV.ix.t]) : null;
    back.querySelectorAll('.cps-sel').forEach((el, k) => {
      if(!p){ el.style.display = 'none'; return; }
      el.setAttribute('cx', axes[k].X(p[2])); el.setAttribute('cy', axes[k].Y(k === 0 ? p[1] : p[3])); el.style.display = '';
    });
    const bi = back.querySelector('.cps-bar i'), c = cur.cps, t0 = ep(c[0][0]), t1 = ep(c[c.length-1][0]);
    if(p){ bi.style.left = `calc(${((ep(p[0])-t0)/Math.max(1,t1-t0)*100).toFixed(2)}% - 1px)`; bi.style.display = 'block'; } else bi.style.display = 'none';
    const ph = p && PH[phOf(p)], bad = p && conflicts(p);
    back.querySelector('.cps-now').innerHTML = p
      ? `<b>${fmt(p[0])}</b>: <b style="color:${bad ? MUTED : ph.c}">${ph.l}</b> (${ph.s})` +
        (bad ? ' <span class="cps-warn">&mdash; but the best track has a hurricane here; ERA5 likely misses its warm core</span>' : '') +
        ` &middot; B ${fx(p[1])} m &middot; &minus;V<sub>T</sub><sup>L</sup> ${fx(p[2])} m &middot; &minus;V<sub>T</sub><sup>U</sup> ${fx(p[3])} m` +
        (p[5] ? ' <span class="cps-warn">(end of track, not smoothed)</span>' : '')
      : '<span style="color:#9fb0c0">Click a point on the map or in a diagram to see its phase.</span>';
  }
  function openWin(){
    if(!cur) return; ensureUI();
    lastFocus = document.activeElement;
    back.classList.toggle('dock', docked()); back.hidden = false; render();
    back.querySelector('.cps-x').focus();
  }
  function closeWin(){
    if(!back || back.hidden) return;
    back.hidden = true;
    if(lastFocus && lastFocus.focus && document.body.contains(lastFocus)) lastFocus.focus();
  }

  // ---- point pop-up rows (index.html calls TCV.popupRows(d) inside the pop-up table) ----
  const VT = u => `&minus;V<sub>T</sub><sup>${u}</sup>`;
  const SEP = 'border-top:1px solid #2a3a4d;padding-top:5px';
  const KEY = `Type <span class="quad">(Hart phase <span style="white-space:nowrap">space - RAB)</span></span>`;
  function popupRows(d){
    if(!cur) return '';                                   // storm has no phase-space data
    const p = nearest(d.t), link = '<a href="#" onclick="window.__cpsOpen();return false" style="color:#c58cff;font-weight:400">diagram</a>';
    if(!p) return `<tr><td class="k" style="vertical-align:top;white-space:normal;${SEP}">${KEY}</td><td class="v" style="${SEP}">&mdash; (${link})</td></tr>`;
    const ph = PH[phOf(p)], bad = conflicts(p);
    const lab = bad ? `<span style="color:${MUTED}">${ph.l}</span><br><span class="cps-warn" style="color:${MUTED};font-size:11px;font-weight:400">ERA5 likely misses this hurricane&rsquo;s warm core</span>`
                    : `<span style="color:${ph.c}">${ph.l}</span>`;
    return `<tr><td class="k" style="vertical-align:top;white-space:normal;${SEP}">${KEY}</td><td class="v" style="white-space:normal;${SEP}">${lab} (${link})</td></tr>
        <tr><td class="k">B, ${VT('L')}</td><td class="v">${fx(p[1])}, ${fx(p[2])} m</td></tr>
        <tr><td class="k">${VT('L')}, ${VT('U')}</td><td class="v">${fx(p[2])}, ${fx(p[3])} m</td></tr>`;
  }
  window.__cpsOpen = openWin;

  async function onStorm(det){
    cur = null; sel = null;
    const L = ensureLink(); if(L) L.hidden = true;
    if(back && !back.hidden) closeWin();
    if(!det || !det.storm || !det.storm.sid) return;
    const {storm, pts} = det;
    const D = await load(storm.basin);
    if(!window.TCV || TCV.current !== det) return;               // superseded by another storm
    let rec = (D.storms || {})[storm.sid]; if(!rec) return;
    if(Array.isArray(rec)) rec = {p: rec};                      // old file format
    if(!rec.p || rec.p.length < 2) return;
    // each CPS point -> the track point at the same time, else the nearest one in time (within 3 h)
    const te = pts.map(p => ep(p[TCV.ix.t]));
    const cps = rec.p.map(p => {
      const e = ep(p[0]); let bi = null, bd = 3*3600e3 + 1;
      for(let i = 0; i < te.length; i++){ const dd = Math.abs(te[i] - e); if(dd < bd){ bd = dd; bi = i; } }
      return [p[0], p[1], p[2], p[3], bi, p[4] ? 1 : 0];
    });
    cur = {storm, pts, cps, byT: new Map(cps.map(p => [p[0], p])), et: rec.et || []};
    if(L) L.hidden = false;
    if(sel != null && TCV.select) TCV.select(sel);              // a point was picked while loading: refresh its pop-up
  }
  function hook(){
    if(!window.TCV){ return setTimeout(hook, 200); }
    TCV.popupRows = popupRows;
    if(TCV.current) onStorm(TCV.current);
  }
  document.addEventListener('tcv:storm', e => onStorm(e.detail));
  document.addEventListener('tcv:select', e => { sel = e.detail; mark(); });
  hook();
})();
