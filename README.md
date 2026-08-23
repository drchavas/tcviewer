# tcviewer.org — Tropical Cyclone Track & Wind-Field Explorer

Interactive viewer for global tropical-cyclone best tracks and wind fields from NOAA
**IBTrACS v04r01**, using the US agency for each basin (NHC in the Atlantic / E–C Pacific,
JTWC elsewhere). Pick a basin, year, and storm to plot its track (coloured by Saffir–Simpson
category) with 34/50/64-kt wind-radii swaths and Rmax; click any track point for its date,
position, intensity, size, and size-percentile vs. that basin's climatology.

Live at **https://tcviewer.org/** (GitHub Pages).

## Layout
- `index.html` — the whole app (one file; Leaflet + polygon-clipping from CDN).
- `data/index.json` — storm list for the dropdowns + per-basin climatology (loaded first).
- `data/basin_<B>.json` — `{ sid: [points…] }` for one basin, fetched on demand and cached
  in memory (revisiting a basin is instant). The host CDN compresses these on the fly.
- `process_storms.py`, `update_data.sh` — rebuild the data from IBTrACS.
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
