# tcviewer.org — Tropical Cyclone Track & Wind-Field Explorer

Interactive viewer for global tropical-cyclone best tracks and wind fields from NOAA
**IBTrACS v04r01**, using the US agency for each basin (NHC in the Atlantic / E–C Pacific,
JTWC elsewhere). Track coloured by Saffir–Simpson category, with 34/50/64-kt wind-radii swaths
and Rmax; click any track point for its date, position, intensity, size, and size-percentile
vs. that basin's climatology.

Live at **https://tcviewer.org/** (GitHub Pages).

## View modes

A top-of-panel **Mode** dropdown chooses the view; each mode hides the others' controls.

- **Single Storm** (default) — Basin → Year → Storm dropdowns; plots one storm's full track,
  swaths and the lifecycle time-series strip (below). Opens on **Helene (2024)** with its
  03:10 UTC landfall point selected on desktop.
- **Day in History** — a `YYYY / MM / DD` date; plots every storm active that day, full tracks,
  ringing the timesteps that fall on that day.
- **Month in History** — a `YYYY / MM` month; same idea over the whole month.
- **Any date range** — `From` and `To` dates; every storm active anywhere in the window.

Day/Month/Range default the date boxes to Helene's landfall day / month. The `Day`/`Month`/`Range`
number boxes have wrapping steppers (month `1` ↓ → December of the previous year; day `1` ↓ → last
day of the previous month) and are leap-aware (stepping past Feb 28 lands on Feb 29 only in a leap
year), because each step normalises through a `Date.UTC` built with the **actual** year.

A **"White circles = timesteps within the selected …"** hint pill appears at the top of the map in
the three history modes to explain the ringed positions.

## Layout
- `index.html` — the whole app (one file; Leaflet + polygon-clipping from CDN).
- `data/index.json` — storm list for the dropdowns + per-basin climatology (loaded first).
- `data/basin_<B>.json` — `{ sid: [points…] }` for one basin, fetched on demand and cached
  in memory (revisiting a basin is instant). The host CDN compresses these on the fly.
- `process_storms.py`, `update_data.sh` — rebuild the data from IBTrACS.
- `landfall.js` — county wind-exposure add-on (preview; see below).
- `geo/states.topo.json.gz`, `geo/counties.topo.json.gz` — U.S. border TopoJSON (Census cartographic
  boundaries), copied from extremewx.org's `scs/trends/geo/`; gzipped on disk, decompressed in the browser.
- `impacts/`, `build_impacts.py` — the Storm Hazards & Impacts page and its data builder (see below).
- `CNAME` — custom domain for GitHub Pages.

## Operational (near-real-time) data
NOAA updates IBTrACS only every few days to a week (e.g. files dated Thu 8 Oct 2026 09 UTC ended Isaias
at 8 Oct 00Z, before its landfall). `merge_operational.py` (stdlib only) tops up data/ with NHC's
operational best track ("b-deck", https://ftp.nhc.noaa.gov/atcf/btk/, updated every 6 h) for this year's
Atlantic / E & C Pacific storms whose b-deck changed in the last 21 days: it appends b-deck times after
each storm's last IBTrACS point (IBTrACS stays the reference where it exists), adds storms IBTrACS doesn't
have yet (provisional SID built IBTrACS-style from the first point), and records `op` / `n_ibtracs` per
storm and `meta.op_through`, shown in the header stamp. Re-running is safe (it truncates back to the
IBTrACS points first). Not merged: landfall flags (`lf`) and distance-to-land (`d2l`), which b-decks
don't carry; JTWC basins (W Pacific, Indian Ocean, S Hemisphere) stay at IBTrACS's pace.
The GitHub Action `.github/workflows/refresh-data.yml` now runs **every 6 h** (03/09/15/21:17 UTC):
IBTrACS download + rebuild, then `merge_operational.py`, committing only if storm data changed.

## Update the data
```
python3 process_storms.py --update    # download latest IBTrACS + rebuild data/*.json
git add -A && git commit -m "data refresh" && git push   # GitHub Pages redeploys
```
`--update` downloads the global IBTrACS CSV into this folder (git-ignored; ~330 MB) and
rebuilds `data/`. Plain `process_storms.py` reuses a local CSV if present.

## Data notes
- All basins, entire record, at synoptic (6-hourly) resolution plus landfall and wind-radii
  points (interpolated 3-hourly points dropped to keep files small).
- Wind radii (R34/R50/R64), Rmax, POCI and ROCI are routinely analysed only from ~2004 on;
  earlier storms usually lack them. The most recent season is provisional/operational.

## Rendering decisions worth not undoing

These were each reached deliberately; changing one is easy to do without realising.

### Antimeridian (180°) handling
Raw IBTrACS longitudes near the dateline jump 179 → −179 (and `USA_LON` can even read >180, e.g.
180.70), which made tracks and — worse — the wind-footprint polygons smear across the entire map.
Two coordinated pieces fix it:
- **`dest()` returns longitude continuous with its input** (no `((lon+540)%360)−180` wrap), so a
  footprint centred near ±180 stays a small local polygon instead of one spanning ~357°.
- **`unwrapLons(pts)`** makes each storm's longitudes continuous (…178,179,180,181…) *and*
  re-centres the whole track so its **median** longitude lands in [−180,180] — i.e. places the
  storm on whichever side of the dateline holds most of it. Track, dots, labels, footprint centres
  and the clicked-point highlight all use these unwrapped longitudes (`curULon`). Single-storm view
  is then coherent (panned onto the wrapped map copy); the global history modes stay essentially
  within −180…180, a straddler overhanging a few degrees. Fully containing a 50/50 straddler would
  need antimeridian polygon splitting — not done.
- **Dashed red date lines** are drawn at ±180 (and ±540 for the wrapped copies) as a reference.

### Lifecycle time-series strip (single-storm only)
Below the map: three small-multiple SVG charts — **Vmax (kt)**, **Pmin (mb)**, **Size (nm)** with
R34 / R64 / Rmax lines (R50 deliberately omitted here; still in the click popup). A yellow vertical
marker tracks the selected timestep and each panel prints that timestep's values; clicking a chart
selects the nearest point on the map. Charts use `preserveAspectRatio="none"` with
`vector-effect="non-scaling-stroke"` so they stretch to fill without distorting line weight, and all
tick labels are HTML overlays (SVG text would stretch). Hidden in the history modes and on
small/short screens.

### View lock / global framing
The map auto-frames a selected storm until the user takes over. The **first** time a date is entered
it snaps to a global view and then the domain stays fixed (subsequent date/storm changes don't move
it); any manual zoom/pan also locks it. A **"Zoom to global"** button resets it. Returning to Single
Storm unlocks and re-frames the storm. Programmatic moves are guarded so they don't count as a user
zoom.

### Wind-footprint performance
Building the swath unions (polygon-clipping) is by far the slowest step, so **only checked layers
are built** — hidden layers cost nothing (previously Rmax was computed on every load despite being
off by default). **Range mode defaults all footprint boxes off** for a fast initial load; Single
Storm / Day / Month default 34 & 64 kt on; 50 kt (added 2026-10) and Rmax default off. Turning a layer on rebuilds the current view
and shows a **"Loading 34 kt wind footprints…"** message (painted before the blocking rebuild, same
trick the date-change message uses). The checkbox is the single source of truth — there is no
hidden "too many storms" override.

### U.S. state & county borders
Two legend checkboxes (both default on). Drawn with `topojson.mesh` (each shared border once, no
fills, non-interactive) on a canvas in pane `pborder` (z 260: above the graticule, below footprints
and tracks), with copies at ±360° so Alaska/Hawaii keep outlines on wrapped map copies. Counties
show only at zoom ≥ 4 (`COUNTY_MINZOOM`); below that the legend says "(zoom in)". The `.gz` files
are fetched raw and un-gzipped with `DecompressionStream`, falling back to plain JSON if a host
ever serves them with `Content-Encoding: gzip`.

### County wind exposure ("Landfall", preview — `?landfall=1`)
`landfall.js` loads only when the URL has `?landfall=1`, so the public page is unchanged. For the
storm on screen (Single Storm mode) it rasterises the 34/50/64 kt wind-radii swath unions — the same
polygons the map draws, shared via `TCV.swathUnion()` and cached per storm — and every U.S. county
onto one ~0.02° lat/lon grid, then counts cells to get the **share of each county's area** inside each
swath. Counties are coloured by the strongest level reached (one magenta hue, brighter = stronger);
a Threshold select (34/50/64 kt) and a "counts if" rule (any part / ≥25% / ≥50% of area) drive the
outlines, the summary (counties, states, population, area-weighted population) and the sortable list
(click a row to zoom). Hover a coloured county for its shares and population. ~0.6–0.9 s per storm.
- Hooks in `index.html`: `window.TCV` (`map`, `ix`, `current`, `swathUnion`, `countyTopo`, `geoReady`)
  and a `tcv:storm` event after each single-storm render (`detail:null` in the history modes).
- `geo/county_pop.json` — Census Vintage 2024 county estimates (PR municipios from prm-est2024; CT's 8
  former counties, which the county file uses, from Vintage 2020 scaled to CT's 2024 total).
- Next: tcwindprofile-based peak wind & duration per county (precomputed), Storm Events impacts.

## Storm Hazards & Impacts page (`impacts/`, preview)
A separate, public-facing page (tcviewer.org/impacts/) for people who care about **impacts** rather than
meteorology: pick a storm, see what it did to each U.S. county. Plain units (mph, inches, feet, local
time). Shareable URLs: `impacts/?storm=helene-2024&layer=rain&county=37021`.
- **Files**: `impacts/index.html` (markup + CSS), `impacts/app.js` (all logic), `impacts/data/index.json`
  (storm list + headline numbers), `impacts/data/storms/<slug>.json` (one per storm, 30–300 KB),
  `impacts/sources/` (Klotzbach et al. 2026 supplementary landfall table, CC BY 4.0). Shares
  `geo/counties.topo.json.gz`, `geo/states.topo.json.gz`, `geo/county_pop.json` with the main page.
- **Storms**: every Atlantic / East-Pacific storm since 2004 whose 34-kt wind radii touched a U.S. county
  (133 as of Oct 2026). 2004 is when wind radii became routine.
- **Layout**: header with landfall sentence(s) in local time → Hazards / Impacts / Exposure headline tiles →
  map with **layer chips that toggle independently and stack** (Hazards: wind, rain, flooding, tornadoes ·
  Impacts: deaths, injuries, damage, power outages · Exposure: population) — each newly turned-on layer draws on top (numbered
  badges), one opacity slider, stacked collapsible legend, tooltip lists every active layer — plus a one-of
  **Backdrop** set (same sources as extremewx.org's scsdash) that toggle independently and blend, over an
  always-on Esri dark grey canvas: Topography (Esri World_Physical_Map, native z8), Night lights (NASA GIBS
  VIIRS Black Marble 2016, native z8 — recoloured client-side by `GlowTiles` into an amber glow whose alpha
  follows brightness, so the black sky is transparent; GIBS sends CORS headers), Highways (Esri
  World_Street_Map, `mix-blend-mode: multiply`). **Default: Topography + Night lights.** A second slider sets
  backdrop strength. Light backdrops switch the track/outline/mesh colours to dark. Map is full-width, directly
  under the layer bar; clicking a county opens a small popup card over the map's top-right corner (× or Esc
  closes it; bottom sheet on phones) → headline-number tiles → storm overview (deaths by cause, outage curve,
  damage/surge by landfall, Storm Events, top-county lists in flowing columns) → sortable county table
  (sorted by the newest layer) → sources.
  URL: `?storm=&layers=wind,rain&bg=topo,lights&op=75&bgop=100&county=` (`bg=none` for the plain map).
- **Main page link**: `../?sid=<IBTrACS SID>` opens that storm in the track explorer (added to index.html).

### Rebuilding the data: `python3 build_impacts.py`
Needs `shapely` (≥2), `numpy`, `pandas`, `openpyxl`, `tifffile`, `imagecodecs` (`pip install shapely tifffile imagecodecs openpyxl`).
Downloads are cached in `.impacts_cache/` (git-ignored; ~1.3 GB, mostly PRISM). First run ~10 min, then ~3 min.
`--only helene-2024 …` rebuilds selected storms; `--skip-rain` skips PRISM. Rebuilt automatically on the 3rd of each month by `.github/workflows/refresh-impacts.yml` (download cache kept between runs; commits only if storm data changed); run it by hand from the Actions tab after a big storm.
| Layer | Source | How it's tied to the storm |
|---|---|---|
| Wind | IBTrACS radii in `data/basin_{NA,EP}.json` | port of the viewer's `footprint()`/`swathPolys()` in shapely; county = any part inside (fractions stored) |
| Rain | PRISM daily 4-km ppt (services.nacse.org) | each PRISM day (24 h ending 12 UTC) counts only cells within 500 km of the centre from 6 h before to 30 h after that day (captures rain ahead of the storm, excludes unrelated systems). Lower 48 only |
| Flooding | USGS STN high-water marks (`FilteredHWMs.json?Event=`) | STN hurricane events matched by "YYYY Name"; per county max height above ground (coastal/riverine) and max water elevation (NAVD88 only); marks >40 ft above ground dropped as entry errors |
| Deaths, injuries, damage, tornadoes | NCEI Storm Events details files | (a) tropical-storm/hurricane/TD/storm-surge reports within 24 h of the U.S. period and 400 km of the track, or (b) any report whose narrative names the storm in a tropical context, within −48 h/+120 h and 1200 km. One storm per report (name match wins, then distance). Zone reports → counties via NWS zone–county correlation (`bp16ap26.dbx`, name fallback), split evenly. Puerto Rico's pre-2023 zones don't map, so PR reports count in totals but not on the map |
| Direct deaths by cause/state | Muller et al. (2026) GitHub dataset | by ATCF id; lower 48, Atlantic only |
| Normalized damage, peak surge | Klotzbach et al. (2026) supp. table (Mooney et al. 2026 damage) | by ATCF id; CONUS hurricane landfalls |
| Power outages | DOE/ORNL EAGLE-I (Figshare 24237376, CC BY 4.0): county customers out every 15 min, Nov 2014–2025 (~13 GB raw; the 2023 file names the column `sum`) | each year is streamed once and cut to its storms' windows ([U.S. arrival − 4 d, departure + 12 d]); the raw file is then deleted (set `KEEP_EAGLEI_RAW=1` to keep it) and only the small extract cached. Per county: gaps ≤ 2 h forward-filled (a missing report isn't a restoration), 75-min running median (single-report spikes), routine pre-storm outages (median of days −4…−1) subtracted, capped at EAGLE-I's modeled customer count. Counted if the peak falls between 12 h before U.S. arrival and 2 d after departure, is ≥ 100 customers and ≥ 1 %, in a county the storm touched (wind, ≥ 1 in rain, Storm Events or high-water marks). Stored: peak, % of customers, customer-hours, hours until back under 10 % of peak; plus an hourly storm-wide total. Checks: Irma 7.1 M peak, Milton 3.2 M, Ian 2.5 M, Ida 1.1 M, Beryl 2.7 M. Coverage gaps: Puerto Rico in early years, parts of coastal Texas in 2017 (Harvey undercounted); nothing before 2015 or for the current year until EAGLE-I publishes it |
| Population | `geo/county_pop.json` (Census V2024) | counties in the 34-kt area |

## Basemap
Esri **`World_Dark_Gray_Base`** canvas tiles (key-free), attribution to Esri. CARTO's key-free dark
tiles now stamp "API key required" across every tile, which is why this was swapped. **Esri tile
URLs are `{z}/{y}/{x}` (row before column)** — using `{z}/{x}/{y}` silently serves scrambled tiles.

## Deploy & hosting
Publish with **`../deploy_tcviewer.sh`** (in `Personal Website/`, sibling of the Purdue
`deploy.sh`/`publish.sh`): it git-adds, commits (auto message from the diff via the Claude CLI) and
pushes this repo; `--data` first runs `process_storms.py --update`. GitHub Pages redeploys on push.
DNS is **Cloudflare DNS-only (grey cloud), not proxied** — A `@` → the four GitHub Pages IPs
(185.199.108–111.153) and `www` CNAME → `drchavas.github.io`; custom domain + Enforce HTTPS in the
repo's Pages settings. Cloudflare never caches, so the only wait after a push is the Pages build.

## SEO / discoverability
Public and indexable (no `noindex`). `index.html` carries a keyword-rich title/description,
`robots` (index,follow), `canonical`, Open Graph / Twitter tags and **JSON-LD** (a `WebApplication`
plus the IBTrACS `Dataset`, attributed to Dan Chavas). `robots.txt` and `sitemap.xml` sit at the
repo root.

The header meta line shows a **"Data last updated"** stamp (from `meta.built` in `index.json`) and a
credit to Michael Fischer's **tcatlas.org** for radar/satellite storm visualisation.
