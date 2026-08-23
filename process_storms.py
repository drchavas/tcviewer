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
          "r64ne","r64se","r64sw","r64nw"]

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
