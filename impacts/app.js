/* Storm Hazards & Impacts — tcviewer.org/impacts/
   Reads data/index.json (storm list) and data/storms/<slug>.json (built by ../build_impacts.py),
   plus the shared county geometry & population in ../geo/. Public-facing units throughout:
   mph, inches, feet, local time. */
(async function(){
'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

// ---------------------------------------------------------------- units & words
const mph = kt => kt == null ? null : Math.round(kt * 1.15078 / 5) * 5;           // NHC-style 5-mph rounding
const m2ft = m => m * 3.28084;
const n0 = n => Math.round(n).toLocaleString('en-US');
function money(x, short){
  if(x == null) return '—';
  if(x >= 1e9) return '$' + (x/1e9).toFixed(x >= 1e10 ? 0 : 1) + (short ? 'B' : ' billion');
  if(x >= 1e6) return '$' + (x/1e6).toFixed(x >= 1e7 ? 0 : 1) + (short ? 'M' : ' million');
  if(x >= 1e3) return '$' + Math.round(x/1e3) + (short ? 'K' : ' thousand');
  return '$' + Math.round(x);
}
function people(n, short){
  if(n == null) return '—';
  if(short && n >= 1e6) return (n/1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M';
  if(short && n >= 1e4) return Math.round(n/1e3) + 'K';
  return n0(n);
}
const plural = (n, w, ws) => `${n} ${n === 1 ? w : (ws || w + 's')}`;
function catPhrase(s, vmax){                    // "a Category 4 hurricane (140 mph)"
  const w = vmax != null ? ` (${mph(vmax)} mph)` : '';
  if(s >= 1) return `a Category ${s} hurricane${w}`;
  if(s === 0) return `a tropical storm${w}`;
  if(s === -1) return `a tropical depression${w}`;
  if(s === -2) return `a subtropical storm${w}`;
  return `a post-tropical storm${w}`;
}
function stormTitle(s){
  const nm = s.name && s.name !== 'UNNAMED' ? titleCase(s.name) : null;
  const kind = s.sshs >= 1 ? 'Hurricane' : s.sshs === 0 ? 'Tropical Storm' : s.sshs === -1 ? 'Tropical Depression'
             : s.sshs === -2 ? 'Subtropical Storm' : 'Storm';
  return nm ? `${kind} ${nm}` : `Unnamed ${kind.toLowerCase()} (${s.year})`;
}
const titleCase = s => s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
const catShort = s => s >= 1 ? `Cat ${s}` : s === 0 ? 'TS' : s === -1 ? 'TD' : s === -2 ? 'SS' : '';

// time zones — by state, with the Florida panhandle west of the Apalachicola on Central time
const TZ = {AL:'America/Chicago',MS:'America/Chicago',LA:'America/Chicago',TX:'America/Chicago',AR:'America/Chicago',
  OK:'America/Chicago',TN:'America/Chicago',KY:'America/New_York',IL:'America/Chicago',MO:'America/Chicago',
  IA:'America/Chicago',WI:'America/Chicago',MN:'America/Chicago',KS:'America/Chicago',NE:'America/Chicago',
  HI:'Pacific/Honolulu',PR:'America/Puerto_Rico',VI:'America/St_Thomas',CA:'America/Los_Angeles',AZ:'America/Phoenix',
  NV:'America/Los_Angeles',NM:'America/Denver',CO:'America/Denver',UT:'America/Denver'};
const FL_CENTRAL = new Set(['12033','12113','12091','12131','12059','12133','12005','12063','12013','12045']);
const tzOf = (geoid, st) => FL_CENTRAL.has(geoid) ? 'America/Chicago' : (TZ[st] || 'America/New_York');
const utc = t => new Date(Date.UTC(+t.slice(0,4), +t.slice(4,6)-1, +t.slice(6,8), +t.slice(8,10), +t.slice(10,12)));
function localTime(t, tz){
  const d = utc(t);
  const time = new Intl.DateTimeFormat('en-US', {timeZone:tz, hour:'numeric', minute:'2-digit', timeZoneName:'short'})
    .format(d).replace(' AM',' am').replace(' PM',' pm');
  const day = new Intl.DateTimeFormat('en-US', {timeZone:tz, weekday:'long', month:'long', day:'numeric'}).format(d);
  return `${time} on ${day}`;
}
function dateRange(t0, t1){
  const a = utc(t0), b = utc(t1), M = d => d.toLocaleString('en-US',{month:'short', timeZone:'UTC'}).replace('Sep','Sept');
  const y = b.getUTCFullYear();
  return a.getUTCMonth() === b.getUTCMonth()
    ? `${M(a)} ${a.getUTCDate()}–${b.getUTCDate()}, ${y}`
    : `${M(a)} ${a.getUTCDate()} – ${M(b)} ${b.getUTCDate()}, ${y}`;
}

// ---------------------------------------------------------------- data
async function gzJSON(url){
  const r = await fetch(url); if(!r.ok) throw new Error(url + ' ' + r.status);
  const buf = await r.arrayBuffer();
  try{ const st = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
       return JSON.parse(await new Response(st).text()); }
  catch(e){ return JSON.parse(new TextDecoder().decode(buf)); }
}
const [IDX, ctopo, stopo, POPJ] = await Promise.all([
  fetch('data/index.json').then(r => r.json()),
  gzJSON('../geo/counties.topo.json.gz'), gzJSON('../geo/states.topo.json.gz'),
  fetch('../geo/county_pop.json').then(r => r.json()).catch(() => ({pop:{}}))
]);
const POP = POPJ.pop || {};
const cObj = ctopo.objects[Object.keys(ctopo.objects)[0]];
const CF = {};                                            // GEOID -> feature
for(const f of topojson.feature(ctopo, cObj).features) CF[f.properties.GEOID] = f;
$('#built').textContent = 'Data built ' + IDX.built;
const BYSLUG = Object.fromEntries(IDX.storms.map(s => [s.slug, s]));

// ---------------------------------------------------------------- layers
const COL = {haz:'#5cc9d6', imp:'#ff8a7a', exp:'#a9abe6'};
const RAMP = {
  wind: ['#7b4a8c','#b85aa8','#f08cc8'],
  rain: ['#173b4b','#165770','#1a7493','#2393b0','#3cb2c7','#69ccd6','#9de2e3','#d0f3ef'],
  flood:['#1f3561','#284c8d','#3466b8','#4f86e0','#7eaaf8','#b9d1ff'],
  tor:  ['#5a3b0d','#8b5c12','#c0841b','#eda92a','#ffd57a'],
  dead: ['#5e1d1d','#8c2525','#bb3232','#e04b4b','#ff7d70','#ffb8ad'],
  dmg:  ['#433611','#665417','#8e751d','#bb9a25','#e5c13d','#f8e38c'],
  pop:  ['#2d2f4b','#40436c','#575b93','#7477b8','#9b9ed8','#cdcff3'],
};
function classOf(v, bins){ if(v == null || !(v >= bins[0])) return -1; let k = 0; while(k+1 < bins.length && v >= bins[k+1]) k++; return k; }
const LAYERS = [
  {k:'wind', short:'Wind', ticks:['39+','58+','74+'], unit:'mph sustained', grp:'Hazards', label:'Wind — strongest sustained wind reached',
   get: c => c.w ? (c.w[2] > 0 ? 2 : c.w[1] > 0 ? 1 : c.w[0] > 0 ? 0 : null) : null, cat:true,
   classes:['Tropical-storm-force · 39–57 mph','58–73 mph','Hurricane-force · 74+ mph'], ramp:RAMP.wind,
   note:'Counties any part of which was inside the storm’s wind field, from the best-track wind radii.'},
  {k:'rain', short:'Rain', ticks:['1','2','4','6','8','10','15','20+'], unit:'in, storm total', grp:'Hazards', label:'Rain — storm total (highest in county)', get: c => c.r ? c.r[1] : null,
   bins:[1,2,4,6,8,10,15,20], labels:['1–2 in','2–4 in','4–6 in','6–8 in','8–10 in','10–15 in','15–20 in','20+ in'], ramp:RAMP.rain,
   note:'PRISM 4-km daily precipitation over the storm’s path (lower 48 states only).', needs:'rain'},
  {k:'flood', short:'Flooding', ticks:['<1','1','3','6','9','12+'], unit:'ft above ground', grp:'Hazards', label:'Flooding — high-water marks (deepest above ground)',
   get: c => c.h ? Math.max(c.h.hc ?? -1, c.h.hr ?? -1) : null,
   bins:[0.01,1,3,6,9,12], labels:['under 1 ft','1–3 ft','3–6 ft','6–9 ft','9–12 ft','12+ ft'], ramp:RAMP.flood,
   note:'USGS-surveyed high-water marks; dots show each mark (coastal surge and river flooding).', needs:'hwm'},
  {k:'tor', short:'Tornadoes', ticks:['1','2','3','5','10+'], unit:'per county', grp:'Hazards', label:'Tornadoes', get: c => c.se && c.se.tor ? c.se.tor : null,
   bins:[1,2,3,5,10], labels:['1','2','3–4','5–9','10+'], ramp:RAMP.tor,
   note:'Tornadoes in NCEI Storm Events tied to this storm; triangles mark where each touched down.', needs:'tor'},
  {k:'dead', short:'Deaths', ticks:['1','2','5','10','25','50+'], unit:'per county', grp:'Impacts', label:'Deaths — direct + indirect (Storm Events)',
   get: c => c.se ? (c.se.dd + c.se.di) || null : null,
   bins:[0.5,1.5,4.5,9.5,24.5,49.5], labels:['1','2–4','5–9','10–24','25–49','50+'], ramp:RAMP.dead,
   note:'Deaths in NCEI Storm Events reports tied to this storm. Zone reports are split across their counties.', needs:'se'},
  {k:'inj', short:'Injuries', ticks:['1','2','5','10','25','50+'], unit:'per county', grp:'Impacts', label:'Injuries (Storm Events)', get: c => c.se ? (c.se.id + c.se.ii) || null : null,
   bins:[0.5,1.5,4.5,9.5,24.5,49.5], labels:['1','2–4','5–9','10–24','25–49','50+'], ramp:RAMP.dead,
   note:'Injuries in NCEI Storm Events reports tied to this storm.', needs:'se'},
  {k:'dmg', short:'Damage', ticks:['10K','100K','1M','10M','100M','1B+'], unit:'$ reported', grp:'Impacts', label:'Damage — reported property + crop (Storm Events)',
   get: c => c.se ? (c.se.pd + c.se.cd) || null : null,
   bins:[1e4,1e5,1e6,1e7,1e8,1e9], labels:['$10K+','$100K+','$1M+','$10M+','$100M+','$1B+'], ramp:RAMP.dmg,
   note:'Damage as reported to NCEI at the time (not inflation-adjusted; often incomplete).', needs:'se'},
  {k:'out', short:'Power outages', ticks:['1%','5%','10%','25%','50%','75%+'], unit:'peak % of customers out', grp:'Impacts',
   label:'Power outages — peak share of customers without power (EAGLE-I)',
   get: c => c.o ? (c.o.pct ?? null) : null,
   bins:[0.01,0.05,0.10,0.25,0.50,0.75], labels:['1%+','5%+','10%+','25%+','50%+','75%+'],
   ramp:['#4a2610','#6e3512','#9a4814','#c65f17','#ee7d22','#ffab5c'],
   note:'DOE/ORNL EAGLE-I: highest share of a county\u2019s customers without power while the storm was over the U.S. (2015 on).', needs:'out'},
  {k:'pop', short:'Population', ticks:['10K','30K','100K','300K','1M','3M+'], unit:'people', grp:'Exposure', label:'Population of counties in the wind field',
   get: c => c.w && c.w[0] > 0 ? POPOF(c) : null,
   bins:[1e4,3e4,1e5,3e5,1e6,3e6], labels:['10K+','30K+','100K+','300K+','1M+','3M+'], ramp:RAMP.pop,
   note:'Census 2024 estimates (today’s population) for counties reached by 39+ mph winds.'},
];
let POPOF = () => null;
const LBYK = Object.fromEntries(LAYERS.map(l => [l.k, l]));
const GCOL = {Hazards:COL.haz, Impacts:COL.imp, Exposure:COL.exp, Backdrop:'#c3c9d1'};
/* Backdrops — the same menu as extremewx.org's scsdash: whole-map tiles underneath the county layers.
   Topography is Esri's World_Physical_Map (hypsometric tint + relief; native to z8). Night lights are
   NASA's VIIRS Black Marble (radiance, a proxy for where people are, not a population count). */
const PLAIN = {url:'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
               attr:'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ'};
/* Backdrops toggle independently and are blended, not just stacked. Night lights are recoloured in the
   browser into a warm glow whose transparency follows brightness (black sky → fully transparent), so
   they read over the light topography too; highways use "multiply" (white paper drops out, roads and
   labels stay). Order bottom→top: dark canvas, topography, night lights, highways. */
const BASES = {
  topo: {label:'Topography', sw:'linear-gradient(135deg,#7fa36b,#d9c99a)', z:210, blend:'normal', url:'https://server.arcgisonline.com/ArcGIS/rest/services/World_Physical_Map/MapServer/tile/{z}/{y}/{x}',
         maxNative:8, attr:'Physical map tiles &copy; Esri, U.S. National Park Service', light:true,
         note:'Topography: Esri World Physical Map (elevation tint and relief)'},
  lights:{label:'Night lights', sw:'radial-gradient(circle,#fff3c4 20%,#ffb347 45%,#2a2f3a 75%)', z:220, blend:'normal', glow:true, url:'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png',
         maxNative:8, attr:'Night lights: NASA GIBS &middot; VIIRS Black Marble (2016)', light:false,
         note:'Night lights: NASA VIIRS Black Marble 2016 — where people are; light, not a population count'},
  road: {label:'Highways', sw:'linear-gradient(135deg,#efe9dc 45%,#e2733a 50%,#efe9dc 55%)', z:230, blend:'multiply', url:'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
         maxNative:16, attr:'Street tiles &copy; Esri, HERE, Garmin', light:true,
         note:'Highways: Esri World Street Map (roads, towns, place names)'},
};

// ---------------------------------------------------------------- map
const map = L.map('map', {worldCopyJump:false}).setView([32,-85], 5);
const bgParam = new URLSearchParams(location.search).get('bg');
const DEFAULT_BG = ['topo', 'lights'];
let bases = new Set(bgParam == null ? DEFAULT_BG : bgParam.split(',').filter(k => BASES[k]));
let bgOpac = Math.min(1, Math.max(0, (+new URLSearchParams(location.search).get('bgop') || 100) / 100));
const baseTiles = {};
const pane = (n, z, pe) => { map.createPane(n); map.getPane(n).style.zIndex = z; if(!pe) map.getPane(n).style.pointerEvents = 'none'; };
pane('pbg', 250); pane('pfill', 300, true); pane('psel', 325); pane('pmesh', 320); pane('pswath', 330); pane('ptrack', 420); pane('ppts', 440, true);
const fillR = L.canvas({pane:'pfill', padding:0.3});
const meshR = L.canvas({pane:'pmesh', padding:0.3});
const cMesh = L.geoJSON(topojson.mesh(ctopo, cObj), {pane:'pmesh', renderer:meshR, interactive:false,
  style:{color:'#d6e0ea', weight:0.4, opacity:0.22}}).addTo(map);
const sMesh = L.geoJSON(topojson.mesh(stopo, stopo.objects[Object.keys(stopo.objects)[0]]), {pane:'pmesh', renderer:meshR, interactive:false,
  style:{color:'#d6e0ea', weight:1.1, opacity:0.6}}).addTo(map);
L.tileLayer(PLAIN.url, {attribution:PLAIN.attr, maxZoom:16}).addTo(map);      // always underneath
for(const [k, b] of Object.entries(BASES)){
  pane('pb_' + k, b.z); map.getPane('pb_' + k).style.mixBlendMode = b.blend;
}
// Night-light tiles -> warm glow, alpha from brightness (GIBS sends CORS headers, so pixels are readable)
const GlowTiles = L.TileLayer.extend({
  createTile(coords, done){
    const sz = this.getTileSize(), c = document.createElement('canvas'); c.width = sz.x; c.height = sz.y;
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => {
      const g = c.getContext('2d'); g.drawImage(img, 0, 0, sz.x, sz.y);
      try{
        const d = g.getImageData(0, 0, sz.x, sz.y), a = d.data;
        for(let i = 0; i < a.length; i += 4){
          const l = (0.3 * a[i] + 0.59 * a[i+1] + 0.11 * a[i+2]) / 255;
          const t = Math.min(1, Math.max(0, (l - 0.07) * 2.3));
          a[i] = 255; a[i+1] = 120 + 110 * t; a[i+2] = 20 + 130 * t * t; a[i+3] = Math.round(255 * Math.min(1, t * 1.6));
        }
        g.putImageData(d, 0, 0);
      }catch(e){ /* tainted canvas: leave the raw tile */ }
      done(null, c);
    };
    img.onerror = e => done(e, c);
    img.src = this.getTileUrl(coords);
    return c;
  }
});
const isLight = () => bgOpac >= 0.5 && [...bases].some(k => BASES[k].light);
function applyBases(){
  for(const [k, b] of Object.entries(BASES)){
    const on = bases.has(k);
    if(on && !baseTiles[k]) baseTiles[k] = new (b.glow ? GlowTiles : L.TileLayer)(b.url, {pane:'pb_' + k, attribution:b.attr, maxZoom:16, maxNativeZoom:b.maxNative});
    if(baseTiles[k]){ if(on) baseTiles[k].addTo(map); else map.removeLayer(baseTiles[k]); }
    map.getPane('pb_' + k).style.opacity = bgOpac;
  }
  // light backdrops need dark lines
  const lt = isLight();
  cMesh.setStyle(lt ? {color:'#2b3440', weight:0.4, opacity:0.35} : {color:'#d6e0ea', weight:0.4, opacity:0.22});
  sMesh.setStyle(lt ? {color:'#1f2630', weight:1.2, opacity:0.75} : {color:'#d6e0ea', weight:1.1, opacity:0.6});
  document.getElementById('map').classList.toggle('lightbase', lt);
}
applyBases();
let fills = [], selLayer = null, ptsLayer = null, overLayer = L.layerGroup().addTo(map);

// ---------------------------------------------------------------- state
let S = null, cur = null, selC = null, sortK = null, sortDir = -1;
const params = new URLSearchParams(location.search);
let active = (params.get('layers') || params.get('layer') || 'wind').split(',').filter(k => LBYK[k] && !LBYK[k].bg);
let opac = Math.min(1, Math.max(0.15, (+params.get('op') || 75) / 100));

// ---------------------------------------------------------------- picker
const sel = $('#stormSel'), q = $('#q');
{
  let y = null, og = null;
  for(const s of IDX.storms){
    if(s.year !== y){ og = document.createElement('optgroup'); og.label = s.year; sel.appendChild(og); y = s.year; }
    const o = document.createElement('option'); o.value = s.slug;
    o.textContent = `${s.name !== 'UNNAMED' ? titleCase(s.name) : 'Unnamed'}${s.sshs >= 1 ? ' · Cat ' + s.sshs : s.sshs === 0 ? ' · TS' : ''}`;
    og.appendChild(o);
  }
  const dl = $('#qlist');
  for(const s of IDX.storms){ const o = document.createElement('option'); o.value = `${titleCase(s.name)} ${s.year}`; dl.appendChild(o); }
  const pick = () => {
    const v = q.value.trim().toLowerCase(); if(!v) return;
    const m = IDX.storms.find(s => `${s.name} ${s.year}`.toLowerCase() === v)
           || IDX.storms.find(s => `${s.name} ${s.year}`.toLowerCase().startsWith(v))
           || IDX.storms.find(s => s.name.toLowerCase() === v);
    if(m){ loadStorm(m.slug); q.value = ''; q.blur(); }
  };
  q.addEventListener('change', pick); q.addEventListener('keydown', e => { if(e.key === 'Enter') pick(); });
  sel.addEventListener('change', () => loadStorm(sel.value));
  const NOTABLE = ['helene-2024','milton-2024','ian-2022','ida-2021','laura-2020','michael-2018','florence-2018',
                   'harvey-2017','irma-2017','maria-2017','sandy-2012','ike-2008','katrina-2005'];
  const nb = $('#notables'); nb.innerHTML = '<span>Notable:</span>';
  for(const k of NOTABLE) if(BYSLUG[k]){
    const b = document.createElement('button'); b.className = 'chip'; b.dataset.slug = k;
    b.textContent = `${titleCase(BYSLUG[k].name)} ${BYSLUG[k].year}`; b.onclick = () => loadStorm(k); nb.appendChild(b);
  }
}
{
  const box = $('#layerBox'); let grp = null, gdiv = null;
  for(const l of LAYERS){
    if(l.grp !== grp){ gdiv = document.createElement('div'); gdiv.className = 'lgrp';
      gdiv.innerHTML = `<b style="color:${GCOL[l.grp]}">${l.grp}</b>`; box.appendChild(gdiv); grp = l.grp; }
    const sw = l.ramp ? l.ramp[l.ramp.length - 1] : 'linear-gradient(90deg,#466540,#a69280,#f0eeec)';
    const b = document.createElement('button'); b.className = 'lchip'; b.dataset.k = l.k; b.title = l.note || '';
    b.innerHTML = `<i style="background:${sw}"></i>${l.short}`;
    b.onclick = () => toggleLayer(l.k); gdiv.appendChild(b);
  }
  const bdiv = document.createElement('div'); bdiv.className = 'lgrp';
  bdiv.innerHTML = `<b style="color:${GCOL.Backdrop}">Backdrop</b>`; box.appendChild(bdiv);
  for(const [k, b] of Object.entries(BASES)){
    const c = document.createElement('button'); c.className = 'lchip bchip'; c.dataset.base = k; c.title = b.note;
    c.innerHTML = `<i style="background:${b.sw}"></i>${b.label}`;
    c.onclick = () => { bases.has(k) ? bases.delete(k) : bases.add(k); applyBases(); drawOverlays(); renderLegend(); syncChips(); syncURL(); };
    bdiv.appendChild(c);
  }
  const bo = $('#bgopac'); bo.value = Math.round(bgOpac * 100);
  bo.addEventListener('input', () => {
    const wasLight = isLight(); bgOpac = bo.value / 100; applyBases();
    if(isLight() !== wasLight) drawOverlays();
    syncURL();
  });
  const op = $('#opac'); op.value = Math.round(opac * 100);
  op.addEventListener('input', () => { opac = op.value / 100; for(const f of fills) f.setStyle({fillOpacity:opac}); syncURL(); });
}
function toggleLayer(k){
  const l = LBYK[k];
  if(layerUnavailable(l)) return;
  if(active.includes(k)) active = active.filter(x => x !== k); else { active.push(k); sortK = null; }
  syncChips(); drawLayers(); renderTable(); syncURL();
}
function syncChips(){
  document.querySelectorAll('.bchip').forEach(b => b.classList.toggle('on', bases.has(b.dataset.base)));
  document.querySelectorAll('.lchip:not(.bchip)').forEach(b => {
    const l = LBYK[b.dataset.k], u = layerUnavailable(l);
    const on = active.includes(l.k);
    b.classList.toggle('on', on); b.classList.toggle('dis', !!u);
    b.title = u ? `${l.short}: ${u} for this storm` : (l.note || '');
    const n = active.indexOf(l.k);
    b.dataset.n = (active.length > 1 && n >= 0) ? n + 1 : '';
  });
}

// ---------------------------------------------------------------- load a storm
async function loadStorm(slug){
  $('#loading').style.display = 'flex';
  let d;
  try{ d = await fetch(`data/storms/${slug}.json`).then(r => { if(!r.ok) throw new Error(r.status); return r.json(); }); }
  catch(e){ $('#loading').textContent = 'Could not load this storm.'; return; }
  S = d; cur = BYSLUG[slug]; selC = null; sortK = null;
  POPOF = c => POP[c._g] ?? null;
  for(const [g, c] of Object.entries(S.counties)) c._g = g;
  sel.value = slug;
  document.querySelectorAll('.chip').forEach(b => b.classList.toggle('on', b.dataset.slug === slug));
  active = active.filter(k => !layerUnavailable(LBYK[k]));
  syncChips();
  renderHead(); renderTiles(); drawOverlays(); drawLayers(); fitStorm();
  const pc = !loadStorm.done && params.get('county');
  if(pc && S.counties[pc]) selectCounty(pc, true); else renderSummary();
  renderTable(); loadStorm.done = true; syncURL();
  $('#loading').style.display = 'none';
  document.title = `${stormTitle(cur)} (${cur.year}) — hazards & impacts by county | tcviewer.org`;
}
function layerUnavailable(l){
  if(!S || !l || !l.needs) return null;
  if(l.needs === 'rain' && !S.rain) return 'no data';
  if(l.needs === 'hwm' && !(S.hwm && S.hwm.length)) return 'not surveyed';
  if(l.needs === 'tor' && !(S.se && S.se.tor)) return 'none reported';
  if(l.needs === 'se' && !S.se) return 'no reports';
  if(l.needs === 'out' && !S.outage) return S.year < 2015 ? 'from 2015 on' : 'no data';
  return null;
}
function syncURL(){
  if(!cur) return;
  const p = new URLSearchParams({storm:cur.slug});
  if(active.join(',') !== 'wind') p.set('layers', active.join(',') || 'none');
  const bg = [...bases].sort().join(',');
  if(bg !== [...DEFAULT_BG].sort().join(',')) p.set('bg', bg || 'none');
  if(Math.round(bgOpac * 100) !== 100) p.set('bgop', Math.round(bgOpac * 100));
  if(Math.round(opac * 100) !== 75) p.set('op', Math.round(opac * 100));
  if(selC) p.set('county', selC);
  history.replaceState(null, '', '?' + p.toString());
}

// ---------------------------------------------------------------- header + tiles
function renderHead(){
  $('#title').textContent = stormTitle(cur);
  const parts = [dateRange(S.t[0], S.t[1])];
  if(cur.sshs >= 1) parts.push(`peaked as a Category ${cur.sshs} (${mph(cur.vmax)} mph)`);
  else parts.push(`peak winds ${mph(cur.vmax)} mph`);
  parts.push(cur.basin === 'NA' ? 'Atlantic' : 'Eastern/Central Pacific');
  $('#sub').textContent = parts.join(' · ');
  const lf = S.landfalls || [];
  let line;
  if(lf.length){
    const bits = lf.map((x, i) => {
      const tz = tzOf(x.county, x.st);
      return `${i ? 'then ' : ''}in ${esc(x.cname)} ${x.st === 'LA' ? 'Parish' : x.st === 'PR' ? '' : 'County'}, ${x.st} as ${catPhrase(x.sshs, x.vmax)} at ${localTime(x.t, tz)}`
        .replace(/\s+,/, ',');
    });
    line = `Made U.S. landfall ${bits.join('; ')}.`;
  } else {
    line = `Did not make U.S. landfall, but brought tropical-storm-force winds to ${plural(cur.n34, 'county', 'counties')} in ${listStates(cur.states)}.`;
  }
  $('#lfline').innerHTML = line;
  $('#links').innerHTML = `<a href="../?sid=${encodeURIComponent(S.sid)}">See the meteorology (track, wind radii, intensity) →</a>`
    + (S.fatalities && S.fatalities.src ? `<a href="${esc(S.fatalities.src)}" target="_blank" rel="noopener">NHC report ↗</a>` : '');
}
const STN = {AL:'Alabama',AZ:'Arizona',CA:'California',CT:'Connecticut',DE:'Delaware',DC:'D.C.',FL:'Florida',GA:'Georgia',HI:'Hawaii',
  IL:'Illinois',IN:'Indiana',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MS:'Mississippi',NH:'New Hampshire',
  NJ:'New Jersey',NY:'New York',NC:'North Carolina',OH:'Ohio',PA:'Pennsylvania',PR:'Puerto Rico',RI:'Rhode Island',SC:'South Carolina',
  TN:'Tennessee',TX:'Texas',VT:'Vermont',VA:'Virginia',WV:'West Virginia',AR:'Arkansas',OK:'Oklahoma',MO:'Missouri',NV:'Nevada',
  NM:'New Mexico',UT:'Utah',WI:'Wisconsin',MI:'Michigan',IA:'Iowa',KS:'Kansas',NE:'Nebraska',MN:'Minnesota',CO:'Colorado'};
function listStates(a){
  const n = a.map(s => STN[s] || s);
  return n.length <= 2 ? n.join(' and ') : n.slice(0, -1).join(', ') + ', and ' + n[n.length-1];
}
function tile(v, l, s, na){
  return `<div class="tile${na ? ' na' : ''}"><div class="v">${v}</div><div class="l">${l}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`;
}
function renderTiles(){
  const t = [];
  // hazards
  const lf = S.landfalls || [];
  const lfMax = lf.reduce((a, x) => (x.vmax || 0) > (a?.vmax || 0) ? x : a, null);
  const H = [];
  H.push(lfMax ? tile(`${mph(lfMax.vmax)} <small>mph</small>`, 'Peak wind at U.S. landfall', `${catShort(lfMax.sshs)} · ${esc(lfMax.cname)}, ${lfMax.st}`)
               : tile(`${mph(cur.vmax)} <small>mph</small>`, 'Peak wind (at sea)', 'no U.S. landfall'));
  const kl = (S.landfall_table || []).filter(x => x.surge_obs != null);
  const ks = kl.reduce((a, x) => x.surge_obs > (a?.surge_obs || 0) ? x : a, null);
  const hwmMax = (S.hwm || []).reduce((a, p) => p[2] != null && p[2] > (a?.[2] ?? -1) ? p : a, null);
  if(ks) H.push(tile(`${m2ft(ks.surge_obs).toFixed(0)} <small>ft</small>`, 'Highest storm surge observed', `${ks.st} · Klotzbach et al. 2026`));
  else if(hwmMax) H.push(tile(`${hwmMax[2].toFixed(1)} <small>ft</small>`, 'Deepest flooding (high-water mark)', `above ground · ${esc(CF[hwmMax[5]] ? CF[hwmMax[5]].properties.NAME + ', ' + CF[hwmMax[5]].properties.STUSPS : '')}`));
  else H.push(tile('No survey', 'Storm surge / flood marks', '', true));
  const offCONUS = cur.states.some(s => ['PR','HI','VI','AK'].includes(s));
  if(S.rain) H.push(tile(`${S.rain.peak.in.toFixed(1)} <small>in</small>`, offCONUS ? 'Most rain in the lower 48' : 'Most rain (4-km grid)', rainWhere()));
  else H.push(tile('—', 'Rain', 'not available (outside lower 48)', true));
  H.push(tile(`${S.se ? S.se.tor : 0}`, 'Tornadoes reported', S.se && S.se.tor ? torMax() : ''));
  t.push(group('Hazards', COL.haz, H));
  // impacts
  const I = [];
  if(S.fatalities && !offCONUS) I.push(tile(n0(S.fatalities.total), 'Direct deaths', 'Muller et al. 2026 · lower 48'));
  else if(S.se && S.fatalities) I.push(tile(n0(S.se.dd), 'Direct deaths reported', `all areas · Storm Events · ${n0(S.fatalities.total)} in the lower 48 (Muller et al.)`));
  else if(S.se) I.push(tile(n0(S.se.dd), 'Direct deaths reported', `+ ${n0(S.se.di)} indirect · Storm Events`));
  else I.push(tile('—', 'Deaths', 'no reports', true));
  const dn = (S.landfall_table || []).reduce((a, x) => a + (x.dmg || 0), 0);
  if(dn) I.push(tile(money(dn, true), 'Damage, normalized to today', '2024 $ · Mooney et al. 2026'));
  else if(S.se) I.push(tile(money(S.se.pd + S.se.cd, true), 'Damage reported', 'Storm Events, as reported'));
  else I.push(tile('—', 'Damage', 'no reports', true));
  if(S.outage){
    const pk = S.outage.peak, d = utc(pk.t);
    I.push(tile(people(pk.n, true), 'Peak customers without power',
      `${d.toLocaleString('en-US', {month:'short', day:'numeric', timeZone:'UTC'}).replace('Sep ', 'Sept ')} · EAGLE-I`));
  }
  if(S.se) I.push(tile(n0(S.se.id + S.se.ii), 'Injuries reported', 'Storm Events'));
  if(S.se && S.fatalities && !S.outage) I.push(tile(n0(S.se.dd + S.se.di), 'Deaths in county reports', `${n0(S.se.dd)} direct · ${n0(S.se.di)} indirect`));
  else if(S.se && dn) I.push(tile(money(S.se.pd + S.se.cd, true), 'Damage reported', 'Storm Events, as reported'));
  t.push(group('Impacts', COL.imp, I));
  // exposure
  const E = [];
  E.push(tile(`${cur.n64}`, 'Counties with hurricane-force winds', cur.n64 ? `${people(cur.pop64, true)} people live there today` : ''));
  E.push(tile(`${cur.n34}`, 'Counties with 39+ mph winds', listStates(cur.states)));
  t.push(group('Exposure', COL.exp, E));
  $('#tiles').innerHTML = t.join('');
}
function group(name, col, tiles){
  return `<div class="tgroup"><h3><i style="background:${col}"></i>${name}</h3><div class="tgrid">${tiles.join('')}</div></div>`;
}
function rainWhere(){
  let best = null;
  for(const [g, c] of Object.entries(S.counties)) if(c.r && (!best || c.r[1] > best[1])) best = [g, c.r[1]];
  return best && CF[best[0]] ? `${CF[best[0]].properties.NAME}, ${CF[best[0]].properties.STUSPS}` : '';
}
function torMax(){
  const ef = Math.max(...(S.tor || []).map(t => t[2]));
  return ef >= 0 ? `strongest EF${ef}` : '';
}

// ---------------------------------------------------------------- overlays: track, swaths, landfalls
function drawOverlays(){
  overLayer.clearLayers();
  const sw = S.swaths || {};
  const drawSw = (k, style) => (sw[k] || []).forEach(poly =>
    L.polygon(poly.map(r => r.map(([x, y]) => [y, x])), Object.assign({pane:'pswath', interactive:false, fill:false}, style)).addTo(overLayer));
  const lt = isLight();
  drawSw('r34', {color:lt ? '#1d2b3a' : '#cfe3f5', weight:1.2, opacity:lt ? 0.7 : 0.55, dashArray:'5 5'});
  drawSw('r64', {color:lt ? '#0b1119' : '#ffffff', weight:1.4, opacity:lt ? 0.8 : 0.7});
  const ll = S.track.map(p => [p[1], p[2]]);
  L.polyline(ll, {pane:'ptrack', color:lt ? '#ffffff' : '#0b1119', weight:5, opacity:lt ? 0.85 : 0.6, interactive:false}).addTo(overLayer);
  L.polyline(ll, {pane:'ptrack', color:lt ? '#0b1119' : '#ffffff', weight:2, opacity:0.9, interactive:false}).addTo(overLayer);
  for(const p of S.track){
    if(p[0].slice(8) === '0000'){
      const d = utc(p[0]);
      L.circleMarker([p[1], p[2]], {pane:'ptrack', radius:2.5, color:'#fff', weight:1, fillColor:'#fff', fillOpacity:1, interactive:false}).addTo(overLayer);
      L.marker([p[1], p[2]], {pane:'ptrack', interactive:false, icon:L.divIcon({className:'', iconSize:[0,0],
        html:`<div class="lflabel" style="transform:translate(7px,-7px)">${d.toLocaleString('en-US',{month:'short',day:'numeric',timeZone:'UTC'})}</div>`})}).addTo(overLayer);
    }
  }
  for(const x of S.landfalls || []){
    L.circleMarker([x.lat, x.lon], {pane:'ppts', radius:7, color:'#0b1119', weight:2, fillColor:'#ffe14d', fillOpacity:1})
      .bindTooltip(`<b>Landfall</b><br>${esc(x.cname)}, ${x.st}<br>${catPhrase(x.sshs, x.vmax).replace(/^a /,'')}<br>${localTime(x.t, tzOf(x.county, x.st))}`, {className:'tt'})
      .addTo(overLayer);
  }
}
function fitStorm(){
  const gs = Object.keys(S.counties).filter(g => S.counties[g].w && S.counties[g].w[0] > 0 && CF[g]);
  if(!gs.length) return;
  let b = null;
  for(const g of gs){ const bb = L.geoJSON(CF[g]).getBounds(); b = b ? b.extend(bb) : bb; }
  map.fitBounds(b.pad(0.06), {animate:false, maxZoom:9});
}

// ---------------------------------------------------------------- choropleth
function valOf(c, l, g){ return l.get(c || {}, g); }
function colorOf(v, l){
  if(l.cat) return v == null ? null : l.ramp[v];
  const k = classOf(v, l.bins); return k < 0 ? null : l.ramp[k];
}
function drawLayers(){
  for(const f of fills) map.removeLayer(f);
  fills = [];
  if(selLayer){ map.removeLayer(selLayer); selLayer = null; }
  if(ptsLayer){ map.removeLayer(ptsLayer); ptsLayer = null; }
  for(const k of active){                                   // drawn in the order turned on
    const l = LBYK[k], fs = [];
    for(const g of Object.keys(S.counties)){
      const col = colorOf(valOf(S.counties[g], l, g), l);
      if(col && CF[g]) fs.push({type:'Feature', properties:{g, col}, geometry:CF[g].geometry});
    }
    const lyr = L.geoJSON({type:'FeatureCollection', features:fs}, {pane:'pfill', renderer:fillR,
      style: f => ({stroke:false, fill:true, fillColor:f.properties.col, fillOpacity:opac}),
      onEachFeature: (f, lyr) => {
        lyr.bindTooltip(() => tipHtml(f.properties.g), {sticky:true, className:'tt'});
        lyr.on('click', () => selectCounty(f.properties.g));
      }}).addTo(map);
    fills.push(lyr);
  }
  if(selC && CF[selC]) selLayer = L.geoJSON(CF[selC], {pane:'psel', interactive:false,
    style:{color:'#ffe14d', weight:2.6, opacity:1, fill:false}}).addTo(map);
  ptsLayer = L.layerGroup().addTo(map);
  if(active.includes('flood')) drawHWM();
  if(active.includes('tor')) drawTor();
  renderLegend();
}
function drawHWM(){
  const l = LBYK.flood;
  for(const p of S.hwm || []){
    const [la, lo, hag, el, env, g, q, site] = p;
    const col = hag != null ? (colorOf(Math.max(hag, 0.01), l) || l.ramp[0]) : '#9aa3ab';
    L.circleMarker([la, lo], {pane:'ppts', radius:hag != null && hag >= 6 ? 4.5 : 3.5, color:'#0b1119', weight:0.8,
      fillColor:col, fillOpacity:0.95})
      .bindTooltip(`<b>${env === 'c' ? 'Coastal' : 'Riverine'} high-water mark</b><br>${esc(site)}<br>`
        + (hag != null ? `${hag.toFixed(1)} ft above ground<br>` : '')
        + (el != null ? `water ${el.toFixed(1)} ft above NAVD88<br>` : '')
        + `<span style="color:var(--muted)">quality: ${esc(q || '—')}</span>`, {className:'tt'})
      .addTo(ptsLayer);
  }
  for(const x of S.landfall_table || []){
    if(x.surge_obs == null || x.surge_obs_ll[0] == null) continue;
    L.marker([x.surge_obs_ll[0], x.surge_obs_ll[1]], {pane:'ppts', icon:L.divIcon({className:'', iconSize:[18,18], iconAnchor:[9,9],
      html:'<svg width="18" height="18" viewBox="0 0 18 18"><path d="M9 1.5 L11.2 6.6 L16.7 7.1 L12.5 10.7 L13.8 16.1 L9 13.2 L4.2 16.1 L5.5 10.7 L1.3 7.1 L6.8 6.6 Z" fill="#ffe14d" stroke="#0b1119" stroke-width="1.2"/></svg>'})})
      .bindTooltip(`<b>Peak observed storm surge</b><br>${m2ft(x.surge_obs).toFixed(1)} ft (${x.surge_obs} m), ${x.st}`
        + (x.surge_mod != null ? `<br>modelled peak: ${m2ft(x.surge_mod).toFixed(1)} ft` : '') + '<br><span style="color:var(--muted)">Klotzbach et al. (2026)</span>', {className:'tt'})
      .addTo(ptsLayer);
  }
}
function drawTor(){
  const EFC = ['#ffe9a8','#ffd166','#f4a432','#e2711d','#c1440e','#8f1d0b'];
  for(const [la, lo, ef] of S.tor || []){
    const c = ef >= 0 ? EFC[Math.min(ef, 5)] : '#cfd6dd';
    L.marker([la, lo], {pane:'ppts', icon:L.divIcon({className:'', iconSize:[14,14], iconAnchor:[7,9],
      html:`<svg width="14" height="14" viewBox="0 0 14 14"><path d="M7 1 L13 12.5 L1 12.5 Z" fill="${c}" stroke="#0b1119" stroke-width="1.1"/></svg>`})})
      .bindTooltip(`<b>Tornado</b> · ${ef >= 0 ? 'EF' + ef : 'rating unknown'}`, {className:'tt'}).addTo(ptsLayer);
  }
}
function legendSection(l){
  let extra = '';
  if(l.k === 'flood') extra = '<div class="extra">Dots: each high-water mark (grey = no depth). ★ peak surge.</div>';
  if(l.k === 'tor') extra = '<div class="extra">▲ touchdown, shaded by EF rating</div>';
  return `<div class="lsec"><div class="lt">${esc(l.short)} <span>${esc(l.unit || '')}</span></div><div class="lramp">`
    + l.ramp.map((c, i) => `<span><i style="background:${c}"></i><em>${l.ramp.length > 8 && i % 2 ? '&nbsp;' : l.ticks[i]}</em></span>`).join('') + `</div>${extra}</div>`;
}
function renderLegend(){
  const secs = [...active].reverse().map(k => legendSection(LBYK[k]));
  if(!secs.length) secs.push('<div class="lsec"><div class="lt">No data layers on</div></div>');
  for(const k of Object.keys(BASES)) if(bases.has(k)) secs.push(`<div class="extra">${esc(BASES[k].note)}</div>`);
  const lg = $('#legend');
  lg.innerHTML = '<button class="lhead" type="button">Legend <span>▾</span></button><div class="lbody">' + secs.join('')
    + '<div class="extra">Line: track · dashed: 39+ mph wind area · solid: 74+ mph</div></div>';
  lg.querySelector('.lhead').onclick = () => lg.classList.toggle('min');
}

// ---------------------------------------------------------------- county tooltip & card
function cname(g){ const f = CF[g]; if(!f) return g; const p = f.properties;
  return `${p.NAME}${p.STUSPS === 'LA' ? ' Parish' : p.STUSPS === 'PR' ? '' : ' County'}, ${p.STUSPS}`; }
const windTxt = w => !w ? 'outside the wind field' : w[2] > 0 ? `hurricane-force (74+ mph) over ${pct(w[2])} of the county`
  : w[1] > 0 ? `58+ mph over ${pct(w[1])}` : w[0] > 0 ? `tropical-storm-force (39+ mph) over ${pct(w[0])}` : 'outside the wind field';
const pct = f => f >= 0.995 ? 'all' : f < 0.01 ? '<1%' : Math.round(f * 100) + '%';
const deaths = x => { const r = Math.round(x); return (Math.abs(x - r) > 0.01 ? '≈' : '') + r; };
function layerLine(k, c, g){
  const l = LBYK[k];
  if(k === 'wind') return c.w ? `Wind: ${windTxt(c.w)}` : '';
  if(k === 'rain') return c.r ? `Rain: ${c.r[1].toFixed(1)} in (county average ${c.r[0].toFixed(1)} in)` : '';
  if(k === 'flood') return c.h ? `Flooding: ${fl(c.h)}` : '';
  if(k === 'tor') return c.se && c.se.tor ? `${plural(c.se.tor, 'tornado', 'tornadoes')}${c.se.ef >= 0 ? ', strongest EF' + c.se.ef : ''}` : '';
  if(k === 'dead') return c.se && (c.se.dd + c.se.di) ? `Deaths: ${deaths(c.se.dd)} direct, ${deaths(c.se.di)} indirect` : '';
  if(k === 'inj') return c.se && (c.se.id + c.se.ii) ? `Injuries: ${deaths(c.se.id + c.se.ii)}` : '';
  if(k === 'dmg') return c.se && (c.se.pd + c.se.cd) ? `Damage: ${money(c.se.pd + c.se.cd)} reported` : '';
  if(k === 'pop') return c.w && POP[g] != null ? `Population: ${people(POP[g])} (2024)` : '';
  if(k === 'out') return c.o ? `Power out at peak: ${outTxt(c.o)}` : '';
  return '';
}
function tipHtml(g){
  const c = S.counties[g] || {};
  const keys = [...active].reverse();
  const lines = keys.map(k => layerLine(k, c, g)).filter(Boolean);
  if(!S.counties[g]) lines.unshift('<span style="color:var(--muted)">outside this storm’s footprint</span>');
  return `<b>${esc(cname(g))}</b><br>${lines.join('<br>')}<br><span style="color:var(--muted)">click for everything in this county</span>`;
}
const days = hrs => hrs < 48 ? `${Math.round(hrs)} hours` : `${(hrs / 24).toFixed(1)} days`;
function outTxt(o){
  const pc = o.pct != null ? `${Math.round(o.pct * 100)}% of customers (${people(o.pk, true)})` : `${people(o.pk, true)} customers`;
  const r = o.rest != null ? `, back under 10% of that after ${days(o.rest)}` : o.cens != null ? `, still above 10% after ${days(o.cens)}` : '';
  return pc + r;
}
function fl(h){
  const a = [];
  if(h.hc != null) a.push(`coastal ${h.hc.toFixed(1)} ft`); if(h.hr != null) a.push(`inland ${h.hr.toFixed(1)} ft`);
  return a.length ? `deepest water above ground: ${a.join(', ')}` : (h.ec != null || h.er != null ? 'marks surveyed (no depth above ground)' : '');
}
function selectCounty(g, noZoom){
  selC = g; drawLayers();
  renderCard(g);
  document.querySelectorAll('#ctab tr').forEach(tr => tr.classList.toggle('sel', tr.dataset.g === g));
  if(!noZoom && window.innerWidth <= 1050) $('#card').scrollIntoView({behavior:'smooth', block:'start'});
  syncURL();
}
function row(k, v){ return `<tr><td class="k">${k}</td><td class="v">${v}</td></tr>`; }
function renderCard(g){
  const c = S.counties[g] || {}, pop = POP[g];
  const h = [];
  h.push(`<button class="back" id="backBtn">← Storm overview</button>`);
  const area = CF[g] && CF[g].properties.AREA, dens = pop != null && area ? pop / (area / 2.58999) : null;
  h.push(`<h3>${esc(cname(g))}</h3><div class="csub">${pop ? people(pop) + ' people (2024)' : ''}${dens != null ? ' · ' + n0(dens) + ' per sq mi' : ''}</div>`);
  // hazards
  h.push(`<h4><i style="background:${COL.haz}"></i>Hazards</h4><table>`);
  if(c.w) h.push(row('Strongest wind', c.w[2] > 0 ? 'Hurricane-force (74+ mph)' : c.w[1] > 0 ? '58–73 mph' : c.w[0] > 0 ? 'Tropical-storm-force (39–57 mph)' : '—'),
                 row('Share of county reached', `39+ mph: ${pct(c.w[0])} · 58+: ${pct(c.w[1])} · 74+: ${pct(c.w[2])}`));
  else h.push(row('Wind', 'outside the 39+ mph wind area'));
  if(c.r) h.push(row('Rain, storm total', `${c.r[1].toFixed(1)} in max · ${c.r[0].toFixed(1)} in average`));
  else if(S.rain) h.push(row('Rain, storm total', 'under 0.5 in'));
  if(c.h){
    if(c.h.hc != null) h.push(row('Coastal flooding', `${c.h.hc.toFixed(1)} ft above ground`));
    if(c.h.hr != null) h.push(row('Inland flooding', `${c.h.hr.toFixed(1)} ft above ground`));
    if(c.h.ec != null) h.push(row('Highest coastal water level', `${c.h.ec.toFixed(1)} ft above NAVD88`));
    if(c.h.er != null && c.h.hr == null) h.push(row('Highest inland water level', `${c.h.er.toFixed(1)} ft above NAVD88`));
    h.push(row('High-water marks surveyed', c.h.n));
  }
  if(c.se && c.se.tor) h.push(row('Tornadoes', `${c.se.tor}${c.se.ef >= 0 ? ' (strongest EF' + c.se.ef + ')' : ''}`));
  h.push('</table>');
  // impacts
  if(c.o){
    const lt = utc(c.o.t), tz = tzOf(g, CF[g] ? CF[g].properties.STUSPS : '');
    h.push(`<h4><i style="background:${COL.imp}"></i>Power outages (EAGLE-I)</h4><table>`,
      row('Peak without power', `${people(c.o.pk)}${c.o.pct != null ? ' · ' + Math.round(c.o.pct * 100) + '% of customers' : ''}`),
      row('Peak at', localTime(c.o.t, tz)),
      row('Back under 10% of peak', c.o.rest != null ? `after ${days(c.o.rest)}` : c.o.cens != null ? `not within ${days(c.o.cens)}` : '—'),
      row('Customer-hours without power', n0(c.o.ch)), '</table>');
  } else if(S.outage) h.push(`<h4><i style="background:${COL.imp}"></i>Power outages (EAGLE-I)</h4><div class="note">No storm-period outage above 1% of customers recorded here.</div>`);
  h.push(`<h4><i style="background:${COL.imp}"></i>Impacts (NCEI Storm Events)</h4>`);
  if(c.se){
    h.push('<table>', row('Deaths', `${deaths(c.se.dd)} direct · ${deaths(c.se.di)} indirect`),
      row('Injuries', `${deaths(c.se.id)} direct · ${deaths(c.se.ii)} indirect`),
      row('Property damage', money(c.se.pd)), row('Crop damage', money(c.se.cd)),
      row('Reports', `${c.se.n}: ` + Object.entries(c.se.types).map(([k, n]) => `${esc(k)}${n > 1 ? ' ×' + n : ''}`).join(', ')), '</table>');
    if([c.se.dd, c.se.di, c.se.pd].some(x => Math.abs(x - Math.round(x)) > 0.01))
      h.push('<div class="note">≈: part of a report filed for a forecast zone covering several counties, split evenly between them.</div>');
  } else h.push('<div class="note">No Storm Events reports tied to this storm in this county.</div>');
  $('#card').innerHTML = h.join('');
  $('#backBtn').onclick = () => { selC = null; drawLayers(); renderSummary(); renderTable(); syncURL(); };
}
function outageChart(){
  const O = S.outage, v = O.series.v, n = v.length;
  if(n < 2) return '';
  const W = 340, H = 120, L = 6, R = 6, T = 14, B = 20, max = Math.max(...v) || 1;
  const t0 = utc(O.series.t0).getTime(), step = O.series.step_h * 3600e3;
  const X = i => L + (W - L - R) * i / (n - 1), Y = x => T + (H - T - B) * (1 - x / max);
  let d = `M${X(0)},${Y(v[0])}`; for(let i = 1; i < n; i++) d += `L${X(i).toFixed(1)},${Y(v[i]).toFixed(1)}`;
  const area = d + `L${X(n - 1)},${Y(0)}L${X(0)},${Y(0)}Z`;
  // day ticks at 00 UTC
  let ticks = '';
  const first = Math.ceil(t0 / 86400e3) * 86400e3, span = (n - 1) * step, every = span > 10 * 86400e3 ? 4 : span > 5 * 86400e3 ? 2 : 1;
  for(let t = first, k = 0; t <= t0 + span; t += 86400e3, k++){
    if(k % every) continue;
    const x = L + (W - L - R) * (t - t0) / span, lab = new Date(t).toLocaleString('en-US', {month:'short', day:'numeric', timeZone:'UTC'});
    ticks += `<line x1="${x}" x2="${x}" y1="${H - B}" y2="${H - B + 3}" stroke="var(--faint)"/><text x="${x}" y="${H - 6}" text-anchor="middle">${lab}</text>`;
  }
  const pi = v.indexOf(max);
  return `<h4><i style="background:${COL.imp}"></i>Customers without power</h4>
    <div class="ochart" data-t0="${t0}" data-step="${step}"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img"
      aria-label="Customers without power over time, peaking at ${people(max)}">
      <line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" stroke="var(--line)"/>
      <path d="${area}" fill="#ee7d22" fill-opacity=".18"/><path d="${d}" fill="none" stroke="#ee7d22" stroke-width="2" vector-effect="non-scaling-stroke"/>
      <circle cx="${X(pi)}" cy="${Y(max)}" r="3" fill="#ee7d22"/>
      <text x="${Math.min(X(pi) + 5, W - 70)}" y="${Math.max(Y(max) - 3, 10)}" class="pk">${people(max, true)} peak</text>
      ${ticks}<line class="xh" x1="0" x2="0" y1="${T}" y2="${H - B}" stroke="var(--muted)" stroke-dasharray="2 2" visibility="hidden"/>
    </svg><div class="otip"></div></div>
    <div class="note">Summed over the counties the storm affected, after removing routine outages (EAGLE-I covers most but not all utilities${S.year <= 2017 ? '; coverage was patchier before 2018' : ''}${cur.states.includes('PR') ? '; Puerto Rico is not covered' : ''}).</div>`;
}
function wireOutageChart(){
  const box = document.querySelector('#card .ochart'); if(!box) return;
  const svg = box.querySelector('svg'), tip = box.querySelector('.otip'), xh = svg.querySelector('.xh');
  const v = S.outage.series.v, t0 = +box.dataset.t0, step = +box.dataset.step;
  svg.addEventListener('mousemove', e => {
    const r = svg.getBoundingClientRect(), f = Math.min(1, Math.max(0, (e.clientX - r.left - r.width * 6 / 340) / (r.width * 328 / 340)));
    const i = Math.round(f * (v.length - 1)), x = 6 + 328 * i / (v.length - 1);
    xh.setAttribute('x1', x); xh.setAttribute('x2', x); xh.setAttribute('visibility', 'visible');
    const t = new Date(t0 + i * step).toLocaleString('en-US', {month:'short', day:'numeric', hour:'numeric', timeZone:'UTC'});
    tip.textContent = `${people(v[i])} without power · ${t} UTC`; tip.style.visibility = 'visible';
  });
  svg.addEventListener('mouseleave', () => { xh.setAttribute('visibility', 'hidden'); tip.style.visibility = 'hidden'; });
}
function renderSummary(){
  const h = [];
  h.push(`<h3>Storm overview</h3><div class="csub">Click any coloured county on the map, or a row in the table, for its details.</div>`);
  const F = S.fatalities;
  if(F){
    const CAUSE = {surge:'Storm surge', freshwater_floods:'Freshwater flooding', tree_fall:'Falling trees', wind:'Wind', tornado:'Tornadoes',
      rip_current:'Rip currents', surf:'Surf', rough_seas:'Rough seas', lightning:'Lightning', unknown:'Unknown'};
    h.push(`<h4><i style="background:${COL.imp}"></i>Direct deaths by cause</h4>`);
    const tot = Math.max(1, F.total);
    for(const [k, v] of Object.entries(F.by).sort((a, b) => b[1].n - a[1].n)){
      const where = Object.entries(v.where || {}).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${n} ${s}`).join(', ');
      h.push(`<div style="margin:6px 0 2px;display:flex;justify-content:space-between;gap:8px;font-size:13.5px"><span>${CAUSE[k] || k}</span><b>${v.n}</b></div>`
        + `<div class="bar"><i style="width:${100 * v.n / tot}%;background:${COL.imp}"></i></div>`
        + (where ? `<div class="note" style="margin-top:2px">${where}</div>` : ''));
    }
    h.push(`<div class="note">${F.total} direct deaths in the lower 48 (Muller et al. 2026). Indirect deaths (e.g. heat, accidents, carbon monoxide) are not included.</div>`);
  }
  if(S.outage) h.push(outageChart());
  const K = S.landfall_table || [];
  if(K.length){
    h.push(`<h4><i style="background:${COL.imp}"></i>Damage & surge by landfall</h4><table>`);
    for(const x of K){
      const dd = new Date(x.date + 'T12:00:00Z').toLocaleString('en-US', {month:'short', day:'numeric', timeZone:'UTC'}).replace('Sep ', 'Sept ');
      h.push(row(`Landfall ${dd} · ${x.st}`, `${x.dmg ? money(x.dmg) : '—'}`));
      if(x.surge_obs != null) h.push(row('&nbsp;&nbsp;peak surge', `${m2ft(x.surge_obs).toFixed(1)} ft observed` + (x.surge_mod != null ? ` · ${m2ft(x.surge_mod).toFixed(1)} ft modelled` : '')));
    }
    h.push('</table><div class="note">Normalized damage: what the landfall would cost with today’s housing, in 2024 dollars (Mooney et al. 2026). Surge: Klotzbach et al. (2026).</div>');
  }
  if(S.se){
    h.push(`<h4><i style="background:${COL.imp}"></i>NCEI Storm Events reports</h4><table>`,
      row('Deaths', `${n0(S.se.dd)} direct · ${n0(S.se.di)} indirect`), row('Injuries', `${n0(S.se.id)} direct · ${n0(S.se.ii)} indirect`),
      row('Property + crop damage', money(S.se.pd + S.se.cd)), row('Reports', n0(S.se.n)), '</table>');
    const T = Object.entries(S.se.types).slice(0, 8);
    h.push('<table style="margin-top:6px">' + T.map(([k, v]) => row(esc(k), `${v.n}${v.dd + v.di ? ' · ' + (v.dd + v.di) + ' deaths' : ''}${v.pd ? ' · ' + money(v.pd, true) : ''}`)).join('') + '</table>');
    if(S.se.unmapped && S.se.unmapped.n) h.push(`<div class="note">${S.se.unmapped.n} reports (${S.se.unmapped.dd + S.se.unmapped.di} deaths, ${money(S.se.unmapped.pd, true)}) were filed for areas that could not be matched to a county, so they appear in the totals but not on the map.</div>`);
  }
  const top = (title, fn, fmt, n = 6) => {
    const a = Object.entries(S.counties).map(([g, c]) => [g, fn(c)]).filter(x => x[1] != null && x[1] > 0)
      .sort((a, b) => b[1] - a[1]).slice(0, n);
    if(!a.length) return '';
    return `<h4><i style="background:${title.c}"></i>${title.t}</h4><div class="toplist">` +
      a.map(([g, v]) => `<button data-g="${g}"><span>${esc(cname(g))}</span><b>${fmt(v)}</b></button>`).join('') + '</div>';
  };
  h.push(top({t:'Most rain', c:COL.haz}, c => c.r ? c.r[1] : null, v => v.toFixed(1) + ' in'));
  h.push(top({t:'Deepest flooding (above ground)', c:COL.haz}, c => c.h ? Math.max(c.h.hc ?? -1, c.h.hr ?? -1) : null, v => v.toFixed(1) + ' ft'));
  h.push(top({t:'Most deaths (Storm Events)', c:COL.imp}, c => c.se ? c.se.dd + c.se.di : null, v => deaths(v)));
  h.push(top({t:'Most damage (Storm Events)', c:COL.imp}, c => c.se ? c.se.pd + c.se.cd : null, v => money(v, true)));
  h.push(top({t:'Most customers without power', c:COL.imp}, c => c.o ? c.o.pk : null, v => people(v, true)));
  $('#card').innerHTML = h.join('');
  $('#card').querySelectorAll('.toplist button').forEach(b => b.onclick = () => selectCounty(b.dataset.g));
  wireOutageChart();
}

// ---------------------------------------------------------------- table
const COLS = [
  {k:'name', t:'County', grp:'', get:g => cname(g), fmt:v => esc(v), str:true},
  {k:'wind', t:'Wind', grp:'Hazards', get:(g, c) => c.w ? (c.w[2] > 0 ? 3 : c.w[1] > 0 ? 2 : c.w[0] > 0 ? 1 : 0) : 0,
   fmt:(v, g, c) => v === 3 ? '74+ mph' : v === 2 ? '58+ mph' : v === 1 ? '39+ mph' : '—'},
  {k:'rain', t:'Rain (in)', grp:'Hazards', get:(g, c) => c.r ? c.r[1] : null, fmt:v => v == null ? '—' : v.toFixed(1)},
  {k:'flood', t:'Flood (ft)', grp:'Hazards', get:(g, c) => c.h ? Math.max(c.h.hc ?? -1, c.h.hr ?? -1) : null, fmt:v => v == null || v < 0 ? '—' : v < 0.05 ? '<0.1' : v.toFixed(1)},
  {k:'tor', t:'Tornadoes', grp:'Hazards', get:(g, c) => c.se ? c.se.tor : null, fmt:v => v ? v : '—'},
  {k:'dead', t:'Deaths', grp:'Impacts', get:(g, c) => c.se ? c.se.dd + c.se.di : null, fmt:v => v ? deaths(v) : '—'},
  {k:'inj', t:'Injuries', grp:'Impacts', get:(g, c) => c.se ? c.se.id + c.se.ii : null, fmt:v => v ? deaths(v) : '—'},
  {k:'out', t:'Power out', grp:'Impacts', get:(g, c) => c.o ? (c.o.pct ?? null) : null, fmt:v => v == null ? '—' : Math.round(v * 100) + '%'},
  {k:'dmg', t:'Damage', grp:'Impacts', get:(g, c) => c.se ? c.se.pd + c.se.cd : null, fmt:v => v ? money(v, true) : '—'},
  {k:'pop', t:'Population', grp:'Exposure', get:g => POP[g] ?? null, fmt:v => v == null ? '—' : people(v, true)},
];
const L2C = {wind:'wind', rain:'rain', flood:'flood', tor:'tor', dead:'dead', inj:'inj', out:'out', dmg:'dmg', pop:'pop'};
$('#tfilter').addEventListener('input', renderTable);
function renderTable(){
  if(!S) return;
  const sk = sortK || L2C[active[active.length - 1]] || 'wind';
  const col = COLS.find(c => c.k === sk);
  const filt = $('#tfilter').value.trim().toLowerCase();
  let rows = Object.entries(S.counties).filter(([g]) => CF[g])
    .map(([g, c]) => ({g, c, v:COLS.map(k => k.get(g, c))}));
  if(filt) rows = rows.filter(r => r.v[0].toLowerCase().includes(filt));
  const ci = COLS.indexOf(col);
  rows.sort((a, b) => {
    const x = a.v[ci], y = b.v[ci];
    if(col.str) return sortDir * -1 * String(x).localeCompare(String(y));
    return sortDir * (((x ?? -1) > (y ?? -1)) - ((x ?? -1) < (y ?? -1))) || a.v[0].localeCompare(b.v[0]);
  });
  const MAX = 400;
  $('#tcount').textContent = `${rows.length} counties with data` + (rows.length > MAX ? ` · showing top ${MAX}` : '');
  const grp = `<tr><th class="grp"></th><th class="grp" colspan="4" style="color:${COL.haz}">Hazards</th><th class="grp" colspan="4" style="color:${COL.imp}">Impacts</th><th class="grp" style="color:${COL.exp}">Exposure</th></tr>`;
  const head = '<tr>' + COLS.map(c => `<th data-k="${c.k}" class="${c.k === sk ? 'sorted' : ''}">${c.t}${c.k === sk ? (sortDir < 0 ? ' ▾' : ' ▴') : ''}</th>`).join('') + '</tr>';
  const body = rows.slice(0, MAX).map(r => `<tr data-g="${r.g}" class="${r.g === selC ? 'sel' : ''}">` +
    COLS.map((c, i) => { const s = c.fmt(r.v[i], r.g, r.c); return `<td class="${s === '—' ? 'z' : ''}">${s}</td>`; }).join('') + '</tr>').join('');
  const t = $('#ctab'); t.innerHTML = `<thead>${grp}${head}</thead><tbody>${body}</tbody>`;
  t.querySelectorAll('th[data-k]').forEach(th => th.onclick = () => {
    if(sortK === th.dataset.k || (!sortK && th.dataset.k === sk)) sortDir *= -1; else { sortK = th.dataset.k; sortDir = col.str ? 1 : -1; }
    sortK = th.dataset.k; renderTable();
  });
  t.querySelectorAll('tbody tr').forEach(tr => tr.onclick = () => {
    selectCounty(tr.dataset.g, true);
    const f = CF[tr.dataset.g]; if(f) map.fitBounds(L.geoJSON(f).getBounds().pad(1.2), {maxZoom:9});
    $('.mapsec').scrollIntoView({behavior:'smooth', block:'start'});
  });
}

// ---------------------------------------------------------------- go
const want = params.get('storm');
await loadStorm(want && BYSLUG[want] ? want : (BYSLUG['helene-2024'] ? 'helene-2024' : IDX.storms[0].slug));
})().catch(e => { console.error(e); const l = document.getElementById('loading'); if(l){ l.style.display = 'flex'; l.textContent = 'Could not load: ' + e.message; } });
