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
- `geo/states.topo.json.gz`, `geo/counties.topo.json.gz` — U.S. border TopoJSON (Census cartographic
  boundaries), copied from extremewx.org's `scs/trends/geo/`; gzipped on disk, decompressed in the browser.
- `CNAME` — custom domain for GitHub Pages.

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
Storm / Day / Month default 34 & 64 kt on, Rmax off. Turning a layer on rebuilds the current view
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
