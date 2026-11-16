#!/usr/bin/env python3
"""Parse ibtracs.NA.csv into a compact per-storm JSON for the TC size-map web app.

Keeps ALL storms in the record (every season), all valid track points.
Per point we store: ISO time, lat, lon, Vmax (kt), Pmin (mb), SSHS category,
Rmax (nm), translation speed (kt), and the four-quadrant R34/R50/R64 radii (nm).
"""
import csv, json, math, os, sys, ssl, urllib.request, urllib.error, tempfile, shutil, datetime, gzip

_here = os.path.dirname(__file__)
# Official NCEI download for the GLOBAL (all-basins) best-track CSV (updated ~daily,
# includes provisional current-season storms). We use the USA_* columns, which IBTrACS
# fills from the responsible US agency per basin: NHC for the Atlantic & E/C Pacific,
# JTWC for the West Pacific, Indian Ocean and Southern Hemisphere.
# Run "python3 process_storms.py --update" to fetch a fresh copy before rebuilding.
IBTRACS_URL = ("https://www.ncei.noaa.gov/data/"
    "international-best-track-archive-for-climate-stewardship-ibtracs/"
    "v04r01/access/csv/ibtracs.ALL.list.v04r01.csv")

# Look for the IBTrACS CSV in this script's own folder (self-contained). ALL (global)
# preferred; NA accepted as a fallback for backward compatibility / testing.
_names = ["ibtracs.ALL.csv", "ibtracs.ALL.list.v04r01.csv",
          "ibtracs.NA.csv", "ibtracs.NA.list.v04r01.csv"]
DL_DEST = os.path.join(_here, "ibtracs.ALL.list.v04r01.csv")  # where --update downloads to
SRC = next((os.path.join(_here, n) for n in _names
            if os.path.exists(os.path.join(_here, n))),
           DL_DEST)

def download_ibtracs(dest):
    """Download the latest IBTrACS NA CSV to `dest` (atomic replace).

    Uses certifi's CA bundle if available; if TLS verification still fails (common with
    some macOS Python installs that lack a usable cert store), retries without cert
    verification — acceptable here since this is a public NOAA data file.
    """
    print(f"downloading {IBTRACS_URL}")
    tmp = dest + ".tmp"
    try:
        import certifi
        ctx = ssl.create_default_context(cafile=certifi.where())
    except Exception:
        ctx = ssl.create_default_context()
    try:
        resp = urllib.request.urlopen(IBTRACS_URL, timeout=60, context=ctx)
    except (ssl.SSLError, urllib.error.URLError) as e:
        print(f"  (TLS verification failed: {e}; retrying without cert verification)")
        resp = urllib.request.urlopen(IBTRACS_URL, timeout=60,
                                      context=ssl._create_unverified_context())
    total = int(resp.headers.get("Content-Length") or 0)
    done = 0
    with resp as r, open(tmp, "wb") as f:
        while True:
            chunk = r.read(1 << 20)           # 1 MB at a time
            if not chunk:
                break
            f.write(chunk); done += len(chunk)
            msg = f"  {done/1e6:.1f}" + (f"/{total/1e6:.1f}" if total else "") + " MB"
            print("\r" + msg, end="", flush=True)
    print()
    os.replace(tmp, dest)
    print(f"saved {dest} ({os.path.getsize(dest)/1e6:.1f} MB)")

if "--update" in sys.argv or "--download" in sys.argv:
    # always download into this script's own folder (self-contained; never touch siblings)
    download_ibtracs(DL_DEST)
    SRC = DL_DEST
OUT = os.path.join(os.path.dirname(__file__), "storms.json")
OUTJS = os.path.join(os.path.dirname(__file__), "storms.js")
OUTGZ = OUTJS + ".gz"     # the page fetches this and gunzips it in the browser

# columns we need -> read by header name
NEED = ["SID","SEASON","NAME","BASIN","ISO_TIME","LAT","LON","USA_WIND","USA_PRES",
        "USA_SSHS","USA_RMW","STORM_SPEED",
        "USA_R34_NE","USA_R34_SE","USA_R34_SW","USA_R34_NW",
        "USA_R50_NE","USA_R50_SE","USA_R50_SW","USA_R50_NW",
        "USA_R64_NE","USA_R64_SE","USA_R64_SW","USA_R64_NW",
        "NATURE","USA_RECORD","STORM_DIR","DIST2LAND","USA_ATCF_ID",
        "USA_POCI","USA_ROCI"]

def fnum(s):
    s = (s or "").strip()
    if s == "" or s in ("-999","-9999"):
        return None
    try:
        v = float(s)
        return v
    except ValueError:
        return None

def inum(s):
    v = fnum(s)
    return None if v is None else int(round(v))

with open(SRC, newline="") as f:
    rd = csv.reader(f)
    header = next(rd)
    next(rd)  # units row
    ci = {name: header.index(name) for name in NEED}

    storms = {}   # sid -> dict
    order = []    # preserve first-seen order
    for row in rd:
        if not row:
            continue
        sid = row[ci["SID"]].strip()
        lat = fnum(row[ci["LAT"]]); lon = fnum(row[ci["LON"]])
        iso = row[ci["ISO_TIME"]].strip()
        if lat is None or lon is None or not iso:
            continue
        atcf = row[ci["USA_ATCF_ID"]].strip()
        if sid not in storms:
            storms[sid] = {
                "sid": sid,
                "name": (row[ci["NAME"]].strip() or "UNNAMED"),
                "year": inum(row[ci["SEASON"]]),
                "basin": row[ci["BASIN"]].strip(),
                "atcf": atcf,
                "pts": [],
            }
            order.append(sid)
        elif not storms[sid]["atcf"] and atcf:
            storms[sid]["atcf"] = atcf
        def q(col):  # quadrant radius value (nm) or None
            return inum(row[ci[col]])
        r34 = [q("USA_R34_NE"), q("USA_R34_SE"), q("USA_R34_SW"), q("USA_R34_NW")]
        r50 = [q("USA_R50_NE"), q("USA_R50_SE"), q("USA_R50_SW"), q("USA_R50_NW")]
        r64 = [q("USA_R64_NE"), q("USA_R64_SE"), q("USA_R64_SW"), q("USA_R64_NW")]
        storms[sid]["pts"].append({
            "t": iso,
            "lat": round(lat, 3),
            "lon": round(lon, 3),
            "vmax": inum(row[ci["USA_WIND"]]),
            "pmin": inum(row[ci["USA_PRES"]]),
            "sshs": inum(row[ci["USA_SSHS"]]),
            "rmw": inum(row[ci["USA_RMW"]]),
            "spd": inum(row[ci["STORM_SPEED"]]),
            "r34": r34, "r50": r50, "r64": r64,
            "nat": (row[ci["NATURE"]].strip() or ""),
            "lf": 1 if row[ci["USA_RECORD"]].strip() == "L" else 0,  # HURDAT landfall record
            "dir": inum(row[ci["STORM_DIR"]]),
            "poci": inum(row[ci["USA_POCI"]]),
            "roci": inum(row[ci["USA_ROCI"]]),
            "d2l": inum(row[ci["DIST2LAND"]]),
        })

# ---- Extended Best Track (EBTRK) fills storm-size data for NHC storms before 2004 ----
# HURDAT2 / IBTrACS carry NHC's (post-season) best-track wind radii only from 2004 on. CIRA's
# Extended Best Track (Demuth et al. 2006; https://rammb2.cira.colostate.edu/research/
# tropical-cyclones/tc_extended_best_track_dataset/) adds the 34/50/64-kt radii, Rmax and the
# outer closed isobar (POCI/ROCI) for 1988-2003 (Atlantic) and ~1990-2003 (E/C Pacific). Those
# pre-2004 values are NHC's REAL-TIME OPERATIONAL estimates, not post-season analyses, so every
# point that gets any of them is flagged `ebt` = 1 and the page says so. Rules:
#   * matched by ATCF id + synoptic time; skipped if the EBTRK position is > 1 deg from IBTrACS;
#   * only 1988-2003 (EBT_FIRST..EBT_BEFORE): from 2004 IBTrACS has the best-track radii itself,
#     and before 1988 the file's radii are all-zero placeholders, not estimates;
#   * before 2004 the 34/50/64-kt radii come from EBTRK ONLY (decided with Dan 2026-11-15): IBTrACS's
#     2001-03 radii are R34-only real-time values (no R50/R64) that differ from EBTRK at ~27% of
#     shared times, so mixing them would make storms inconsistent and drop the hurricane-force
#     radii. Rmax / POCI / ROCI keep IBTrACS where present (identical to EBTRK wherever both exist)
#     and are filled from EBTRK where missing.
# Files (new format, v3.0.2, ends 2021) are kept gzipped in sources/ebtrk/; see SOURCE.md there.
EBT_DIR = os.path.join(_here, "sources", "ebtrk")
EBT_FIRST, EBT_BEFORE = 1988, 2004   # before 1988 the file's radii are all-zero placeholders

def load_ebtrk():
    recs = {}
    if not os.path.isdir(EBT_DIR):
        print("EBTRK: sources/ebtrk/ not found -- skipping"); return recs
    for fn in sorted(os.listdir(EBT_DIR)):
        if not (fn.startswith("EBTRK_") and "new_format" in fn and fn.endswith(".txt.gz")):
            continue
        with gzip.open(os.path.join(EBT_DIR, fn), "rt", encoding="ascii", errors="replace") as f:
            for l in f:
                l = l.rstrip("\n")
                tok = l[:72].split()
                if len(l) < 110 or len(tok) != 12:
                    continue
                atcf, _name, mdh, yr = tok[0], tok[1], tok[2], tok[3]
                if not EBT_FIRST <= int(yr) < EBT_BEFORE:
                    continue
                def v(x):
                    x = int(float(x)); return None if x == -99 else x
                rad = [[v(l[a + i:a + i + 3]) for i in (0, 3, 6, 9)] for a in (72, 85, 98)]
                recs.setdefault(atcf, {})[f"{yr}{mdh}00"] = {
                    "lat": float(tok[4]), "lon": -float(tok[5]),   # file has deg W positive
                    "rmw": v(tok[8]), "poci": v(tok[10]), "roci": v(tok[11]),
                    "r34": rad[0], "r50": rad[1], "r64": rad[2]}
    return recs

_ebt = load_ebtrk()
_ebt_pts = 0; _ebt_storms = set(); _ebt_far = 0; _ebt_cleared = 0; _ebt_nomatch = []
NONE4 = [None] * 4
def _pre2004(p): return int(p["t"][:4]) < EBT_BEFORE
for sid in order:
    s = storms[sid]
    E = _ebt.get(s["atcf"])
    if not E:
        if any(_pre2004(p) and any(x is not None for x in p["r34"] + p["r50"] + p["r64"]) for p in s["pts"]):
            if (s["atcf"] or "")[:2] in ("AL", "EP", "CP"):
                _ebt_nomatch.append(s["atcf"])           # NHC storm with pre-2004 IBTrACS radii but no EBTRK record: kept
        continue
    for p in s["pts"]:
        if not _pre2004(p):
            continue
        e = E.get(p["t"].replace("-", "").replace(":", "").replace(" ", "")[:12])
        if e and (abs(e["lat"] - p["lat"]) > 1 or abs((e["lon"] - p["lon"] + 180) % 360 - 180) > 1):
            _ebt_far += 1
            if os.environ.get("EBT_DEBUG"): print("EBT far", s["atcf"], p["t"], p["lat"], p["lon"], e["lat"], e["lon"])
            e = None
        # Before 2004 the wind radii come from EBTRK only (one consistent source per storm): IBTrACS's
        # 2001-03 radii are R34-only real-time values that often differ from EBTRK, and keeping them
        # would hide EBTRK's R50/R64. Points without an EBTRK match lose their radii.
        had = any(x is not None for x in p["r34"] + p["r50"] + p["r64"])
        if e:
            p["r34"], p["r50"], p["r64"] = list(e["r34"]), list(e["r50"]), list(e["r64"])
        else:
            p["r34"], p["r50"], p["r64"] = list(NONE4), list(NONE4), list(NONE4)
            _ebt_cleared += had
        got = e is not None and any(x is not None for x in e["r34"] + e["r50"] + e["r64"])
        for k in ("rmw", "poci", "roci"):            # these agree with IBTrACS wherever both exist
            if e and p[k] is None and e[k] is not None:
                p[k] = e[k]; got = True
        if got:
            p["ebt"] = 1; _ebt_pts += 1; _ebt_storms.add(sid)
print(f"EBTRK: {len(_ebt)} storms read; {_ebt_pts} points in {len(_ebt_storms)} storms use it; "
      f"{_ebt_cleared} pre-2004 IBTrACS radii points without an EBTRK match cleared; "
      f"{_ebt_far} matched points skipped (> 1 deg apart); "
      f"NHC storms with pre-2004 IBTrACS radii but no EBTRK record (kept as is): {_ebt_nomatch}")

# ---- size trim (keeps the global file small enough for the web) ----
# The global record is ~725k points / 45 MB uncompressed. To shrink it we drop the
# interpolated 3-hourly points (the swaths interpolate between points anyway) and keep:
#   * synoptic times (00/06/12/18 UTC) — the standard 6-hourly best-track,
#   * plus any landfall point or any point that carries wind-radii data.
# All storms / all seasons are retained. -> ~26 MB, all basins.
def keep_point(p):
    hh, mm = p["t"][11:13], p["t"][14:16]
    if mm == "00" and hh in ("00", "06", "12", "18"):
        return True
    if p["lf"] == 1:
        return True
    return any(x for x in (p["r34"] + p["r64"]) if x)   # has wind radii

# build output list, apply the trim, drop storms left with no points
out = []
for sid in order:
    s = storms[sid]
    s["pts"] = [p for p in s["pts"] if keep_point(p)]
    if len(s["pts"]) >= 1:
        out.append(s)

# sort by year then name for stable dropdowns
out.sort(key=lambda s: (s["year"] or 0, s["name"], s["sid"]))

years = sorted({s["year"] for s in out if s["year"] is not None})

# ---- compact flat-array encoding ----
# Field order puts the always/usually-present values first and the radii (mostly empty
# before ~2004) LAST, so trailing nulls can be dropped per point -> much smaller file.
# Reader looks up fields by name, so a shorter array just yields undefined (== null).
# t encoded as "YYYYMMDDHHmm" (12 chars); missing numeric -> null
FIELDS = ["t","lat","lon","vmax","pmin","sshs","spd","dir","nat","lf","d2l",
          "rmw","poci","roci",
          "r34ne","r34se","r34sw","r34nw","r50ne","r50se","r50sw","r50nw",
          "r64ne","r64se","r64sw","r64nw",
          "ebt"]   # 1 = size fields on this point include EBTRK real-time operational estimates (pre-2004)

def tcode(iso):  # "2012-10-21 18:00:00" -> "201210211800"
    d = iso.replace("-","").replace(":","").replace(" ","")
    return d[:12]

def trim(arr):  # drop trailing None to shrink the row (reader treats missing as null)
    i = len(arr)
    while i > 11 and arr[i-1] is None:   # keep at least the 11 leading fields
        i -= 1
    return arr[:i]

cstorms = []
for s in out:
    cpts = []
    for p in s["pts"]:
        row = [
            tcode(p["t"]), p["lat"], p["lon"], p["vmax"], p["pmin"], p["sshs"],
            p["spd"], p["dir"], p["nat"], p["lf"], p["d2l"],
            p["rmw"], p["poci"], p["roci"], *p["r34"], *p["r50"], *p["r64"],
            p.get("ebt"),
        ]
        cpts.append(trim(row))
    cstorms.append({"sid": s["sid"], "name": s["name"], "year": s["year"],
                    "basin": s["basin"], "atcf": s["atcf"], "pts": cpts})

# ---- size climatology ----
# Distribution of each size metric over "clean" open-ocean hurricane points:
#   NATURE == "TS" (tropical), Vmax >= 64 kt (hurricane strength, sizes better estimated),
#   DIST2LAND >= 100 km (centre well over water), value present, 2004..latest full season.
def mean_nz(vals):
    v = [x for x in vals if x is not None and x > 0]
    return (sum(v)/len(v)) if v else None

CLIM_MIN_D2L = 100
CLIM_Y0 = 2004                 # wind radii routinely analysed from 2004 on
CLIM_Y1 = years[-1] - 1        # latest FULL season (exclude the current operational year)
CLIM_METRICS = ["rmax","r34","r50","r64","roci"]
# collect per basin (each basin's storms compared only against that basin)
clim_vals = {}   # basin -> metric -> [values]
for s in out:
    if s["year"] is None or s["year"] < CLIM_Y0 or s["year"] > CLIM_Y1:
        continue
    basin = s["basin"] or "??"
    bv = clim_vals.setdefault(basin, {m: [] for m in CLIM_METRICS})
    for p in s["pts"]:
        if p["nat"] != "TS":
            continue
        if p["vmax"] is None or p["vmax"] < 64:      # hurricane-strength only (sizes better estimated)
            continue
        if p["d2l"] is None or p["d2l"] < CLIM_MIN_D2L:
            continue
        cand = {"rmax": p["rmw"], "r34": mean_nz(p["r34"]), "r50": mean_nz(p["r50"]),
                "r64": mean_nz(p["r64"]), "roci": p["roci"]}
        for m, v in cand.items():
            if v is not None and v > 0:
                bv[m].append(float(v))

def build_clim(vals, nbins=32):
    vals = sorted(vals)
    n = len(vals)
    if n < 30:
        return None
    q = []  # 101 quantiles (value at each percentile 0..100) for percentile lookup
    for pct in range(101):
        idx = (n-1) * pct/100.0
        lo = int(idx); hi = min(lo+1, n-1); frac = idx-lo
        q.append(round(vals[lo]*(1-frac) + vals[hi]*frac, 1))
    hi = q[99] if q[99] > vals[0] else q[100]          # cap display range at p99
    x0 = 0.0
    dx = (hi - x0)/nbins if hi > 0 else 1.0
    counts = [0]*nbins
    for v in vals:
        b = int((v - x0)/dx)
        counts[min(max(b, 0), nbins-1)] += 1
    return {"n": n, "x0": round(x0,1), "dx": round(dx,4), "counts": counts, "q": q}

# per-basin: {basin: {metric: clim}}; drop metrics/basins with too few points
clim = {}
for basin, mv in clim_vals.items():
    built = {m: build_clim(mv[m]) for m in mv}
    built = {m: c for m, c in built.items() if c}
    if built:
        clim[basin] = built
print("climatology n:", {b: {m: c["n"] for m, c in mv.items()} for b, mv in clim.items()})

meta = {
    "source": "NOAA IBTrACS v04r01, global (US agencies: NHC & JTWC)",
    "n_storms": len(out),
    "year_min": years[0], "year_max": years[-1],
    "fields": FIELDS,
    "clim_label": f"Climo: TC, Vmax≥64kt, {CLIM_Y0}–{CLIM_Y1}",
    "built": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
}
# ---- write split JSON data (the host CDN gzip/brotli-compresses it on the fly) ----
# data/index.json : small — meta, per-basin climatology, and a lightweight storm list
#                   (sid/name/year/basin/atcf, no track points) for the dropdowns.
# data/basin_<B>.json : { sid: [points...] } for one basin, loaded on demand & cached.
DATADIR = os.path.join(_here, "data")
os.makedirs(DATADIR, exist_ok=True)

def write_json(path, obj):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, separators=(",", ":"))
    return os.path.getsize(path)

# each index entry carries the storm's date range (YYYYMMDD ints) so the "day view"
# can find storms active on a chosen date without loading any track data.
index = {"meta": meta, "clim": clim,
         "storms": [{"sid": s["sid"], "name": s["name"], "year": s["year"],
                     "basin": s["basin"], "atcf": s["atcf"],
                     "t0": int(s["pts"][0][0][:8]), "t1": int(s["pts"][-1][0][:8])}
                    for s in cstorms]}
total = write_json(os.path.join(DATADIR, "index.json"), index)
# data/stamp.json : just the build time, for pages that only need "Data last updated"
# (the extremewx.org home page card) without downloading the ~240 KB index.
write_json(os.path.join(DATADIR, "stamp.json"), {"built": meta["built"]})

by_basin = {}
for s in cstorms:
    by_basin.setdefault(s["basin"], {})[s["sid"]] = s["pts"]
for b, d in sorted(by_basin.items()):
    total += write_json(os.path.join(DATADIR, f"basin_{b}.json"), d)

# remove any stale single-file / gzipped outputs so they aren't served
for old in (OUTGZ, OUTJS):
    if os.path.exists(old):
        try: os.remove(old)
        except OSError: pass

print(f"storms: {len(out)}  years: {years[0]}-{years[-1]}  basins: {len(by_basin)}  "
      f"total: {total/1e6:.1f} MB -> {DATADIR}/")
# quick sanity: Sandy 2012
for s in out:
    if s["name"].lower() == "sandy" and s["year"] == 2012:
        print("Sandy 2012:", len(s["pts"]), "pts; first:", s["pts"][0]["t"], s["pts"][0]["lat"], s["pts"][0]["lon"],
              "vmax", s["pts"][0]["vmax"])
        # find a point with r34
        for p in s["pts"]:
            if any(v is not None for v in p["r34"]):
                print("  first R34 pt:", p["t"], "r34", p["r34"], "r64", p["r64"], "rmw", p["rmw"])
                break
        break
