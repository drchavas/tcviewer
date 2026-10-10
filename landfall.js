/* landfall.js — County wind exposure (preview). Loaded by index.html only when the URL has
   ?landfall=1, so the public page is unaffected while this is being developed.

   For the storm on screen it finds which U.S. counties fall inside the 34 / 50 / 64 kt
   wind-radii swaths — the same swath polygons the map draws (TCV.swathUnion) — and how much
   of each county's area each one covers. Counties are coloured by the strongest threshold
   whose swath covers at least the chosen share of the county, and listed with population.

   Method: the swaths and each county are rasterised onto one lat/lon grid (~2 km cells) and
   counted cell by cell, so "share of area" is an area fraction, not a centroid test. A
   county too small to contain a cell centre is sampled at its bounding-box centre.
   Population: Census Vintage 2024 estimates (geo/county_pop.json). */
(function(){
  const T = window.TCV;
  if(!T || !window.topojson){ console.warn('landfall.js: viewer hooks missing'); return; }
  const map = T.map;

  // ---- levels: one sequential hue (magenta), brighter = stronger, on the dark basemap ----
  const LV = [
    {k:'r34', kt:34, name:'34 kt', long:'34 kt (tropical-storm force)', color:'#7b4a8c'},
    {k:'r50', kt:50, name:'50 kt', long:'50 kt',                        color:'#b85aa8'},
    {k:'r64', kt:64, name:'64 kt', long:'64 kt (hurricane force)',      color:'#f08cc8'},
  ];

  // ---- styles ----
  const css = document.createElement('style');
  css.textContent = `
  #lfPanel{bottom:24px;right:10px;width:300px;max-height:calc(50% - 30px);overflow-y:auto}
  #info{max-height:calc(50% - 14px)}
  #lfPanel .beta{font-size:9.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;
    color:#0b1119;background:#f08cc8;border-radius:3px;padding:1px 4px;margin-left:6px;vertical-align:1px}
  #lfPanel .lfrow{display:flex;gap:6px;align-items:center;margin:5px 0;font-size:11.5px}
  #lfPanel .lfrow label{color:var(--muted);font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;min-width:66px}
  #lfPanel select{flex:1;min-width:0}
  #lfPanel .lfsum{font-size:12px;line-height:1.5;margin:8px 0 6px}
  #lfPanel .lfsum b{color:var(--text)}
  #lfPanel table{width:100%;border-collapse:collapse;font-size:11px;font-variant-numeric:tabular-nums}
  #lfPanel th{color:var(--muted);font-weight:600;text-align:right;padding:2px 3px;position:sticky;top:0;background:var(--panel)}
  #lfPanel th:first-child,#lfPanel td:first-child{text-align:left}
  #lfPanel td{padding:2px 3px;text-align:right;border-top:1px solid var(--line);cursor:pointer}
  #lfPanel tr:hover td{background:rgba(255,255,255,.05)}
  #lfPanel .lfsw{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:5px;vertical-align:0}
  #lfPanel .lftbl{max-height:190px;overflow-y:auto;margin-top:4px}
  .lftip{font-size:11.5px;line-height:1.45}
  @media (max-width:640px), (max-height:540px){ #lfPanel{width:auto;max-width:260px;right:8px;bottom:8px;max-height:36%}
    body.info-open #lfPanel{display:none} }`;
  document.head.appendChild(css);

  // ---- panel ----
  const panel = document.createElement('details');
  panel.id = 'lfPanel'; panel.className = 'ctl';
  const compact = window.innerWidth <= 640 || window.innerHeight <= 540;
  if(!compact) panel.open = true;
  panel.innerHTML = `
    <summary>County wind exposure<span class="beta">preview</span></summary>
    <label class="legrow" style="margin-top:6px;cursor:pointer"><input type="checkbox" id="lfOn" checked> Colour counties on the map</label>
    <div class="lfrow"><label for="lfThr">Threshold</label><select id="lfThr">
      ${LV.map((l,i)=>`<option value="${i}"${i===2?' selected':''}>≥ ${l.long}</option>`).join('')}</select></div>
    <div class="lfrow"><label for="lfCov">Counts if</label><select id="lfCov">
      <option value="0">any part of the county</option>
      <option value="0.25">≥ 25% of its area</option>
      <option value="0.5">≥ 50% of its area</option></select></div>
    <div id="lfLegend" style="margin-top:4px"></div>
    <div class="lfsum" id="lfSum"></div>
    <div class="lftbl" id="lfTbl"></div>
    <div class="note">From the 34/50/64&nbsp;kt wind-radii swaths drawn on the map (best-track radii,
      routinely analysed from ~2004). A county is in a level when that swath covers the chosen share of
      its area. Population: Census 2024 estimates, i.e. today's residents, not those at the time.</div>`;
  document.getElementById('mapwrap').appendChild(panel);
  ['mousedown','wheel','dblclick','touchstart'].forEach(ev=>
    panel.addEventListener(ev, e=>e.stopPropagation(), {passive:true}));
  const elOn = panel.querySelector('#lfOn'), elThr = panel.querySelector('#lfThr'),
        elCov = panel.querySelector('#lfCov'), elSum = panel.querySelector('#lfSum'),
        elTbl = panel.querySelector('#lfTbl');
  panel.querySelector('#lfLegend').innerHTML = LV.map(l=>
    `<div class="legrow"><span class="sw" style="background:${l.color};opacity:.8"></span> reached ${l.long}</div>`).join('');

  // ---- county geometry + population ----
  let C = null;          // [{id,name,st,pop,polys:[[ring[[lon,lat]]]],bb:[x0,y0,x1,y1]}]
  let POP = null;
  const ready = (async ()=>{
    const [topo, pj] = await Promise.all([
      T.geoReady,
      fetch('geo/county_pop.json').then(r=>r.ok?r.json():{pop:{}}).catch(()=>({pop:{}}))
    ]);
    POP = pj.pop || {};
    const obj = topo.objects[Object.keys(topo.objects)[0]];
    C = topojson.feature(topo, obj).features.map(f=>{
      const g=f.geometry, polys = g.type==='Polygon' ? [g.coordinates] : g.coordinates;
      let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
      for(const poly of polys) for(const [x,y] of poly[0]){
        if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y; }
      const p=f.properties;
      return {id:p.GEOID, name:p.NAME, st:p.STUSPS, pop:POP[p.GEOID]??null, polys, bb:[x0,y0,x1,y1]};
    });
  })();

  // ---- scanline rasteriser (even-odd, so holes work) ----
  // grid: {x0,y1,res,W,H,a:Uint8Array}; cell (i,j) centre = (x0+(i+.5)res, y1-(j+.5)res)
  function spans(rings, g, dx, cb){      // cb(j, iStart, iEnd) for each covered run of cells
    let ymin=1e9,ymax=-1e9;
    for(const r of rings) for(const p of r){ if(p[1]<ymin)ymin=p[1]; if(p[1]>ymax)ymax=p[1]; }
    const j0=Math.max(0, Math.ceil((g.y1-ymax)/g.res-0.5)), j1=Math.min(g.H-1, Math.floor((g.y1-ymin)/g.res-0.5));
    const xs=[];
    for(let j=j0;j<=j1;j++){
      const y=g.y1-(j+0.5)*g.res; xs.length=0;
      for(const r of rings){
        for(let k=0,n=r.length,m=n-1;k<n;m=k++){
          const ya=r[k][1], yb=r[m][1];
          if((ya>y)!==(yb>y)) xs.push(r[k][0]+dx + (y-ya)*(r[m][0]-r[k][0])/(yb-ya));
        }
      }
      if(xs.length<2) continue;
      xs.sort((a,b)=>a-b);
      for(let q=0;q+1<xs.length;q+=2){
        const i0=Math.max(0, Math.ceil((xs[q]-g.x0)/g.res-0.5)), i1=Math.min(g.W-1, Math.floor((xs[q+1]-g.x0)/g.res-0.5));
        if(i1>=i0) cb(j,i0,i1);
      }
    }
  }

  // ---- compute exposure for the current storm ----
  let RES = null;        // {rows:[{c, f:[f34,f50,f64]}], key}
  function compute(cur){
    const unions = LV.map(l=>T.swathUnion(cur.pts, cur.ulon, l.k));
    if(!unions[0]) return {rows:[], noRadii:true};
    // grid over the 34 kt swath (the largest)
    let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
    for(const poly of unions[0]) for(const [x,y] of poly[0]){
      if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y; }
    const area=(x1-x0)*(y1-y0), res=Math.max(0.02, Math.sqrt(area/4e6));
    const W=Math.ceil((x1-x0)/res)+1, H=Math.ceil((y1-y0)/res)+1;
    const g={x0, y1, res, W, H, a:new Uint8Array(W*H)};
    unions.forEach((u,li)=>{ if(!u) return; const v=li+1;
      for(const poly of u) spans(poly, g, 0, (j,i0,i1)=>{ const o=j*W; for(let i=i0;i<=i1;i++) if(g.a[o+i]<v) g.a[o+i]=v; });
    });
    const rows=[];
    for(const c of C){
      // put the county in the storm's (possibly dateline-unwrapped) longitude frame
      let dx=null;
      for(const s of [0,-360,360]) if(c.bb[0]+s<=x1 && c.bb[2]+s>=x0 && c.bb[1]<=y1 && c.bb[3]>=y0){ dx=s; break; }
      if(dx===null) continue;
      const n=[0,0,0,0];               // total cells, cells >=34, >=50, >=64
      for(const poly of c.polys) spans(poly, g, dx, (j,i0,i1)=>{ const o=j*W;
        for(let i=i0;i<=i1;i++){ const v=g.a[o+i]; n[0]++; if(v>=1)n[1]++; if(v>=2)n[2]++; if(v>=3)n[3]++; } });
      if(n[0]===0){                    // county smaller than a cell: sample its bbox centre
        const i=Math.floor(((c.bb[0]+c.bb[2])/2+dx-x0)/res), j=Math.floor((y1-(c.bb[1]+c.bb[3])/2)/res);
        if(i<0||j<0||i>=W||j>=H) continue;
        const v=g.a[j*W+i]; n[0]=1; if(v>=1)n[1]=1; if(v>=2)n[2]=1; if(v>=3)n[3]=1;
      }
      if(n[1]===0) continue;
      rows.push({c, dx, f:[n[1]/n[0], n[2]/n[0], n[3]/n[0]]});
    }
    return {rows};
  }

  // level reached by a county under the chosen coverage rule (-1 = none)
  function levelOf(r, cov){
    for(let li=2; li>=0; li--) if(cov>0 ? r.f[li]>=cov : r.f[li]>0) return li;
    return -1;
  }

  // ---- map layer + hover ----
  map.createPane('plf'); map.getPane('plf').style.zIndex = 397;   // above the swath fills, below Rmax & track
  map.getPane('plf').style.pointerEvents = 'none';
  const lfRenderer = L.canvas({pane:'plf', padding:0.5});
  let layer = null;
  function draw(){
    if(layer){ map.removeLayer(layer); layer=null; }
    if(!RES || !RES.rows.length || !elOn.checked) return;
    const cov=+elCov.value, thr=+elThr.value, fs=[];
    for(const r of RES.rows){
      const li=levelOf(r,cov); if(li<0) continue;
      const polys = r.dx ? r.c.polys.map(p=>p.map(ring=>ring.map(([x,y])=>[x+r.dx,y]))) : r.c.polys;
      fs.push({type:'Feature', properties:{li, hit:li>=thr}, geometry:{type:'MultiPolygon', coordinates:polys}});
    }
    layer = L.geoJSON({type:'FeatureCollection', features:fs}, {
      pane:'plf', renderer:lfRenderer, interactive:false,
      style:f=>({stroke:f.properties.hit, color:'#ffe3f2', weight:0.9, opacity:0.75,
                 fill:true, fillColor:LV[f.properties.li].color, fillOpacity:[0.34,0.5,0.68][f.properties.li]})
    }).addTo(map);
  }

  function inRing(x,y,r){ let ins=false;
    for(let i=0,j=r.length-1;i<r.length;j=i++){ const xi=r[i][0],yi=r[i][1],xj=r[j][0],yj=r[j][1];
      if(((yi>y)!==(yj>y)) && x<(xj-xi)*(y-yi)/(yj-yi)+xi) ins=!ins; }
    return ins; }
  function rowAt(ll){
    if(!RES) return null;
    for(const r of RES.rows){
      const x=ll.lng-r.dx, y=ll.lat, b=r.c.bb;
      if(x<b[0]||x>b[2]||y<b[1]||y>b[3]) continue;
      for(const poly of r.c.polys){ if(!inRing(x,y,poly[0])) continue;
        let hole=false; for(let h=1;h<poly.length;h++) if(inRing(x,y,poly[h])) hole=true;
        if(!hole) return r; }
    }
    return null;
  }
  const pct = f => f>=0.995 ? '100%' : f<0.005 ? (f>0?'<1%':'0%') : Math.round(f*100)+'%';
  const fmtPop = n => n==null ? '—' : n>=1e6 ? (n/1e6).toFixed(n>=1e7?0:1)+'M' : n>=1e3 ? Math.round(n/1e3)+'k' : String(n);
  function tipHtml(r){
    const c=r.c;
    return `<b>${c.name}, ${c.st}</b><br>`+
      LV.map((l,li)=>`${l.name}: ${pct(r.f[li])} of area`).join('<br>')+
      `<br>Population (2024): ${c.pop==null?'—':c.pop.toLocaleString()}`;
  }
  const tip = L.tooltip({sticky:false, direction:'top', offset:[0,-8], className:'lftip', opacity:0.95});
  let raf=0, lastLL=null;
  map.on('mousemove', e=>{ lastLL=e.latlng; if(raf) return;
    raf=requestAnimationFrame(()=>{ raf=0;
      const r = (elOn.checked && layer) ? rowAt(lastLL) : null;
      if(r && levelOf(r,+elCov.value)>=0){ tip.setLatLng(lastLL).setContent(tipHtml(r)); if(!map.hasLayer(tip)) map.openTooltip(tip); }
      else if(map.hasLayer(tip)) map.closeTooltip(tip);
    });
  });
  map.on('mouseout', ()=>{ if(map.hasLayer(tip)) map.closeTooltip(tip); });

  // ---- summary + table ----
  function summarise(){
    if(!T.current){ elSum.innerHTML='Available in <b>Single Storm</b> mode.'; elTbl.innerHTML=''; return; }
    if(!RES){ elSum.textContent='Computing…'; elTbl.innerHTML=''; return; }
    if(RES.noRadii){ elSum.innerHTML='This storm has no 34&nbsp;kt wind radii in the best track (routinely analysed from ~2004 on).'; elTbl.innerHTML=''; return; }
    const thr=+elThr.value, cov=+elCov.value;
    const hit = RES.rows.filter(r=>levelOf(r,cov)>=thr);
    if(!RES.rows.length){ elSum.innerHTML='No U.S. county is inside this storm’s 34&nbsp;kt wind radii.'; elTbl.innerHTML=''; return; }
    const states=[...new Set(hit.map(r=>r.c.st))].sort();
    const pop=hit.reduce((a,r)=>a+(r.c.pop||0),0);
    const popIn=hit.reduce((a,r)=>a+(r.c.pop||0)*r.f[thr],0);
    const covTxt = cov>0 ? ` over ≥${cov*100}% of their area` : '';
    elSum.innerHTML = hit.length
      ? `<b>${hit.length}</b> ${hit.length===1?'county':'counties'} in <b>${states.length}</b> ${states.length===1?'state':'states'} reached <b>≥${LV[thr].name}</b>${covTxt}`+
        ` (${states.join(', ')}).<br>Population of those counties: <b>${fmtPop(pop)}</b>; `+
        `area-weighted share inside the ${LV[thr].name} swath: <b>≈${fmtPop(Math.round(popIn))}</b>.`
      : `No county reached ≥${LV[thr].name}${covTxt}. ${RES.rows.length} reached a lower level.`;
    hit.sort((a,b)=> b.f[thr]-a.f[thr] || (b.c.pop||0)-(a.c.pop||0));
    elTbl.innerHTML = hit.length ? `<table><thead><tr><th>County</th><th>${LV[thr].name} area</th><th>Peak</th><th>Pop.</th></tr></thead><tbody>`+
      hit.map((r,i)=>{ const li=levelOf(r,cov);
        return `<tr data-i="${RES.rows.indexOf(r)}"><td><span class="lfsw" style="background:${LV[li].color}"></span>${r.c.name}, ${r.c.st}</td>`+
               `<td>${pct(r.f[thr])}</td><td>${LV[li].kt}</td><td>${fmtPop(r.c.pop)}</td></tr>`; }).join('')+
      '</tbody></table>' : '';
  }
  elTbl.addEventListener('click', e=>{
    const tr=e.target.closest('tr[data-i]'); if(!tr) return;
    const r=RES.rows[+tr.dataset.i]; const b=r.c.bb;
    map.fitBounds([[b[1],b[0]+r.dx],[b[3],b[2]+r.dx]], {maxZoom:9, padding:[30,30]});
  });

  // ---- wiring ----
  let token=0;
  async function update(cur){
    const my=++token; RES=null; draw(); summarise();
    if(!cur) return;
    await ready;
    window.__loadmsg && window.__loadmsg.show('Computing county wind exposure…');
    await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
    if(my!==token) return;
    try{ RES = compute(cur); }catch(e){ console.error('landfall compute failed', e); RES={rows:[], noRadii:false}; }
    window.__loadmsg && window.__loadmsg.hide();
    if(my!==token) return;
    draw(); summarise();
  }
  document.addEventListener('tcv:storm', e=>update(e.detail));
  [elOn, elThr, elCov].forEach(el=>el.addEventListener('change', ()=>{ draw(); summarise(); }));
  update(T.current);
})();
