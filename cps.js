/* cps.js — Hart (2003) cyclone phase space for tcviewer.org (single-storm view).
   Data: data/cps_<basin>.json, built by build_cps.py from RABTracks (TRACK tracker on ERA5, 1940–2025):
   {storms: {sid: [[t, B, VTL, VTU], ...]}}, VTL/VTU > 0 = warm core (Hart's −VTL/−VTU), 24-h running means, m.
   Adds: a "Cyclone phase space" link under the storm title, phase rows in the point pop-up, and a
   pop-up window with Hart's two diagrams that stays in sync with the selected track point. */
(function(){
  if(window.__cpsLoaded) return; window.__cpsLoaded = true;
  const cache = {};
  const load = b => cache[b] || (cache[b] = fetch('data/cps_' + b + '.json')
    .then(r => r.ok ? r.json() : {storms:{}}).catch(() => ({storms:{}})));
  let cur = null;        // {storm, pts, cps:[[t,B,VTL,VTU,trackIndex]], byT:Map}
  let sel = null;        // selected track index

  // ---- phase categories (Hart 2003: symmetric if B < 10 m; warm core if −VTL > 0; deep if −VTU > 0 too)
  const PH = {
    sdw: {l:'Symmetric deep warm core',    s:'tropical',              c:'#ff6b4a'},
    ssw: {l:'Symmetric shallow warm core', s:'tropical, shallow core', c:'#ffb14e'},
    aw:  {l:'Asymmetric warm core',        s:'hybrid / transitioning', c:'#c58cff'},
    ac:  {l:'Asymmetric cold core',        s:'extratropical',         c:'#46a3ff'},
    sc:  {l:'Symmetric cold core',         s:'cold-core low',         c:'#5fd0c0'}
  };
  function phase(B, L, U){
    if(L > 0) return B >= 10 ? 'aw' : (U > 0 ? 'sdw' : 'ssw');
    return B >= 10 ? 'ac' : 'sc';
  }
  // Evans & Hart (2003): ET begins when B first exceeds 10 m, ends when −VTL turns negative.
  function etTimes(c){
    let i0 = c.findIndex(p => p[1] < 10 && p[2] > 0); if(i0 < 0) return {};
    let on = -1; for(let i = i0; i < c.length; i++) if(c[i][1] >= 10){ on = i; break; }
    if(on < 0) return {};
    let end = -1; for(let i = on; i < c.length; i++) if(c[i][2] < 0){ end = i; break; }
    return {on, end};
  }

  function fmt(t){
    const M = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${M[+t.slice(4,6)-1]} ${+t.slice(6,8)} ${t.slice(8,10)}Z`;
  }
  const ep = t => Date.UTC(+t.slice(0,4), +t.slice(4,6)-1, +t.slice(6,8), +t.slice(8,10), +t.slice(10,12)||0);
  function nearest(t){        // CPS point at or within 3 h of track time t
    if(!cur) return null;
    const ex = cur.byT.get(t); if(ex) return ex;
    const e = ep(t); let best = null, bd = 3*3600e3 + 1;
    for(const p of cur.cps){ const d = Math.abs(ep(p[0]) - e); if(d < bd){ bd = d; best = p; } }
    return best;
  }

  // ---- styles + link + window -------------------------------------------------------------
  const css = `
  .cps-back{position:fixed;inset:0;z-index:9000;background:rgba(5,9,14,.55);display:flex;align-items:center;justify-content:center;padding:16px}
  .cps-back[hidden]{display:none}
  .cps-win{width:100%;max-width:980px;max-height:calc(100vh - 32px);overflow:auto;background:#16212e;color:#e6edf3;border:1px solid #2a3a4d;
    border-radius:14px;box-shadow:0 18px 48px rgba(0,0,0,.5);padding:16px 18px 14px;font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;position:relative}
  .cps-win h2{margin:0;padding-right:28px;font-size:17px;font-weight:650}
  .cps-win .cps-sub{margin:2px 0 10px;color:#9fb0c0;font-size:12.5px}
  .cps-x{position:absolute;top:8px;right:10px;background:none;border:none;color:#9fb0c0;font-size:22px;line-height:1;padding:4px 6px;cursor:pointer}
  .cps-x:hover{color:#fff}
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
  .cps-et{margin-top:6px;font-size:12px;color:#c9d6e2}
  .cps-note{margin-top:10px;font-size:11.5px;color:#8597aa;line-height:1.5}
  .cps-note a{color:#7fb8ff}
  @media (max-width:720px){ .cps-plots{flex-direction:column} }`;
  let back, linkEl;
  function ensureUI(){
    if(back) return;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    back = document.createElement('div'); back.className = 'cps-back'; back.hidden = true;
    back.innerHTML = `<div class="cps-win" role="dialog" aria-modal="true" aria-labelledby="cps-title">
      <button type="button" class="cps-x" aria-label="Close">×</button>
      <h2 id="cps-title">Cyclone phase space</h2><div class="cps-sub"></div>
      <div class="cps-plots"><div><div class="cps-ptitle">Thermal asymmetry (B) vs. lower-level warm/cold core (−V<sub>T</sub><sup>L</sup>)</div><div class="cps-p1"></div></div>
        <div><div class="cps-ptitle">Upper (−V<sub>T</sub><sup>U</sup>) vs. lower (−V<sub>T</sub><sup>L</sup>) warm/cold core</div><div class="cps-p2"></div></div></div>
      <div class="cps-now"></div>
      <div class="cps-bar"></div><div class="cps-barx"></div>
      <div class="cps-leg">${Object.values(PH).map(p => `<span><b style="background:${p.c}"></b>${p.l} <span style="opacity:.75">(${p.s})</span></span>`).join('')}</div>
      <div class="cps-et"></div>
      <div class="cps-note">Hart (2003) cyclone phase space: <b>B</b> = 900&ndash;600&nbsp;hPa thickness asymmetry across the storm along its motion (frontal-like when &ge;&nbsp;10&nbsp;m);
        <b>&minus;V<sub>T</sub><sup>L</sup></b> and <b>&minus;V<sub>T</sub><sup>U</sup></b> = thermal wind in the 900&ndash;600 and 600&ndash;300&nbsp;hPa layers (&gt;&nbsp;0 = warm core).
        Values are 24-hour running means from the <b>ERA5 reanalysis</b> along the storm&rsquo;s reanalysis track (TRACK tracker), from
        <a href="https://github.com/Huracan-project/RABTracks" target="_blank" rel="noopener">RABTracks</a> (Bourdin et al., 2026,
        <a href="https://essd.copernicus.org/preprints/essd-2026-403/" target="_blank" rel="noopener">ESSD preprint</a>; GPL-3.0); available 1940&ndash;2025 for most named storms.
        Reanalysis smooths small, intense cores, so warm-core strengths are often weaker than in
        <a href="https://moe.met.fsu.edu/cyclonephase/" target="_blank" rel="noopener">Bob Hart&rsquo;s real-time and archived diagrams</a>.
        ET start/end follow Evans &amp; Hart (2003). Click a point to show that time on the map.</div></div>`;
    document.body.appendChild(back);
    const close = () => { back.hidden = true; };
    back.querySelector('.cps-x').onclick = close;
    back.addEventListener('mousedown', e => { if(e.target === back) close(); });
    document.addEventListener('keydown', e => { if(e.key === 'Escape' && !back.hidden) close(); });
    back.addEventListener('click', e => {
      const g = e.target.closest('[data-i]'); if(!g || !window.TCV || !TCV.select) return;
      TCV.select(+g.getAttribute('data-i'));
    });
    back.querySelector('.cps-bar').addEventListener('click', e => {
      if(!cur || !TCV.select) return;
      const r = e.currentTarget.getBoundingClientRect(), f = (e.clientX - r.left) / r.width;
      const t0 = ep(cur.cps[0][0]), t1 = ep(cur.cps[cur.cps.length-1][0]), tt = t0 + f*(t1 - t0);
      let best = cur.cps[0]; for(const p of cur.cps) if(Math.abs(ep(p[0]) - tt) < Math.abs(ep(best[0]) - tt)) best = p;
      if(best[4] != null) TCV.select(best[4]);
    });
  }
  function ensureLink(){
    if(linkEl && document.body.contains(linkEl)) return linkEl;
    const imp = document.getElementById('impLink'); if(!imp) return null;
    linkEl = document.createElement('a'); linkEl.className = 'slink'; linkEl.href = '#'; linkEl.hidden = true;
    linkEl.style.display = 'block'; linkEl.style.color = '#c58cff';
    linkEl.textContent = 'Cyclone phase space (Hart) →';
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
    // track
    const P = c.map(p => [X(p[2]), Y(kind === 1 ? p[1] : p[3])]);
    g += `<path d="${P.map((p,i) => (i?'L':'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ')}" fill="none" stroke="#7d8fa3" stroke-width="1.2" stroke-opacity=".7"/>`;
    c.forEach((p, i) => {
      const col = PH[phase(p[1], p[2], p[3])].c, ti = p[4];
      const r = (i === 0 || i === c.length-1) ? 5 : 3.6;
      g += `<circle class="pt" data-i="${ti ?? ''}" cx="${P[i][0].toFixed(1)}" cy="${P[i][1].toFixed(1)}" r="${r}" fill="${col}" stroke="#0b1119" stroke-width=".8"><title>${fmt(p[0])}: B ${p[1]}, −VTL ${p[2]}, −VTU ${p[3]} m</title></circle>`;
    });
    const lab = (i, t) => `<text x="${P[i][0]+7}" y="${P[i][1]-6}" fill="#e6edf3" font-size="10.5" font-weight="600" paint-order="stroke" stroke="#0e1722" stroke-width="3">${t}</text>`;
    g += lab(0, 'Start ' + fmt(c[0][0]).slice(0,-4)) + lab(c.length-1, 'End ' + fmt(c[c.length-1][0]).slice(0,-4));
    g += `<circle class="cps-sel" r="8" fill="none" stroke="#ffe000" stroke-width="2.2" style="display:none"/>`;
    return {svg: `<svg viewBox="0 0 ${W} ${H}" data-k="${kind}">${g}</svg>`, X, Y};
  }
  let axes = null;
  function render(){
    if(!back || !cur) return;
    const s = cur.storm, nm = s.name && s.name !== 'UNNAMED' ? s.name.replace(/\w\S*/g, t => t[0] + t.slice(1).toLowerCase()) : 'Unnamed';
    back.querySelector('#cps-title').textContent = `Cyclone phase space — ${nm} (${s.year})`;
    back.querySelector('.cps-sub').textContent = `${fmt(cur.cps[0][0])} ${cur.cps[0][0].slice(0,4)} – ${fmt(cur.cps[cur.cps.length-1][0])} · ${cur.cps.length} six-hourly points · ERA5`;
    const a = plot(1), b = plot(2); axes = [a, b];
    back.querySelector('.cps-p1').innerHTML = a.svg; back.querySelector('.cps-p2').innerHTML = b.svg;
    // phase timeline bar
    const c = cur.cps, t0 = ep(c[0][0]), t1 = ep(c[c.length-1][0]), span = Math.max(1, t1 - t0);
    let bar = '';
    for(let i = 0; i < c.length; i++){
      const a0 = i ? (ep(c[i-1][0]) + ep(c[i][0]))/2 : t0, a1 = i < c.length-1 ? (ep(c[i][0]) + ep(c[i+1][0]))/2 : t1;
      bar += `<span style="left:${((a0-t0)/span*100).toFixed(2)}%;width:${((a1-a0)/span*100+0.05).toFixed(2)}%;background:${PH[phase(c[i][1], c[i][2], c[i][3])].c}"></span>`;
    }
    back.querySelector('.cps-bar').innerHTML = bar + '<i></i>';
    const day = 86400e3, step = Math.max(1, Math.ceil(span/day/8))*day; let xl = '';
    for(let t = Math.ceil(t0/day)*day; t <= t1; t += step){ const d = new Date(t);
      xl += `<span style="left:${((t-t0)/span*100).toFixed(2)}%">${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getUTCMonth()]} ${d.getUTCDate()}</span>`; }
    back.querySelector('.cps-barx').innerHTML = xl;
    const et = etTimes(c);
    back.querySelector('.cps-et').innerHTML = et.on == null ? 'No extratropical transition in the phase-space record (Evans &amp; Hart 2003 criteria).'
      : `Extratropical transition: <b>begins ${fmt(c[et.on][0])}</b> (B &ge; 10 m)` + (et.end >= 0 ? `, <b>complete ${fmt(c[et.end][0])}</b> (&minus;V<sub>T</sub><sup>L</sup> &lt; 0)` : ', not completed while tracked');
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
    const ph = p && PH[phase(p[1], p[2], p[3])];
    back.querySelector('.cps-now').innerHTML = p
      ? `<b>${fmt(p[0])}</b>: <b style="color:${ph.c}">${ph.l}</b> (${ph.s}) &middot; B ${p[1]} m &middot; &minus;V<sub>T</sub><sup>L</sup> ${p[2]} m &middot; &minus;V<sub>T</sub><sup>U</sup> ${p[3]} m`
      : '<span style="color:#9fb0c0">Click a point on the map or in a diagram to see its phase.</span>';
  }
  function openWin(){ if(!cur) return; ensureUI(); back.hidden = false; render(); }

  // ---- point pop-up rows (index.html calls TCV.popupRows(d) inside the pop-up table) ----
  const VT = u => `&minus;V<sub>T</sub><sup>${u}</sup>`;
  function popupRows(d){
    if(!cur) return '';                                   // storm has no phase-space data
    const p = nearest(d.t), link = '<a href="#" onclick="window.__cpsOpen();return false" style="color:#c58cff;font-weight:400">diagram</a>';
    if(!p) return `<tr><td class="k">Type<br><span class="quad">(phase space)</span></td><td class="v">&mdash; (${link})</td></tr>`;
    const ph = PH[phase(p[1], p[2], p[3])];
    return `<tr><td class="k" style="vertical-align:top">Type<br><span class="quad">(phase space)</span></td><td class="v" style="white-space:normal"><span style="color:${ph.c}">${ph.l}</span> (${link})</td></tr>
        <tr><td class="k">B, ${VT('L')}</td><td class="v">${p[1]}, ${p[2]} m</td></tr>
        <tr><td class="k">${VT('L')}, ${VT('U')}</td><td class="v">${p[2]}, ${p[3]} m</td></tr>`;
  }
  window.__cpsOpen = openWin;

  async function onStorm(det){
    cur = null; sel = null;
    const L = ensureLink(); if(L) L.hidden = true;
    if(back && !back.hidden) back.hidden = true;
    if(!det || !det.storm || !det.storm.sid) return;
    const {storm, pts} = det;
    const D = await load(storm.basin);
    if(!window.TCV || TCV.current !== det) return;               // superseded by another storm
    const raw = (D.storms || {})[storm.sid]; if(!raw || raw.length < 2) return;
    const ti = new Map(pts.map((p, i) => [p[TCV.ix.t], i]));
    const cps = raw.map(p => [p[0], p[1], p[2], p[3], ti.has(p[0]) ? ti.get(p[0]) : null]);
    cur = {storm, pts, cps, byT: new Map(cps.map(p => [p[0], p]))};
    if(L) L.hidden = false;
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
