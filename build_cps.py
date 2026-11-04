#!/usr/bin/env python3
"""build_cps.py — Hart (2003) cyclone phase space (CPS) along each storm's track, for the
"Cyclone phase space" window and pop-up rows on tcviewer.org (cps.js).

Source: RABTracks (Bourdin et al., ESSD preprint essd-2026-403; GPL-3.0), which matches
IBTrACS storms (track_id = IBTrACS SID) to reanalysis tracks and computes the CPS
parameters along them. We use the TRACK tracker on ERA5 (source "TRACK-ERA5"), 1940-2025:
  B    : 900-600 hPa thickness asymmetry across the storm, m (hemisphere-adjusted)
  VTL  : lower-tropospheric (900-600 hPa) thermal wind, m; > 0 = warm core   (Hart's -VTL)
  VTU  : upper-tropospheric (600-300 hPa) thermal wind, m; > 0 = warm core   (Hart's -VTU)
RABTracks already signs VTL/VTU so that warm core is positive, i.e. they are the -VTL/-VTU
plotted on Hart's diagrams.

Processing (per storm):
  * keep the centred 24-h running means (*_roll, as Hart plots); at the two ends of a track,
    where the running mean is undefined, use the raw value and flag the point (5th element 1);
  * keep only reanalysis points within the storm's IBTrACS lifetime;
  * drop points where the ERA5 centre is > MAX_KM from the IBTrACS position at that time
    (linearly interpolated between IBTrACS fixes) — the reanalysis track occasionally jumps
    to a different system;
  * values rounded to 0.1 m (so near-zero thermal winds keep their sign);
  * extratropical transition from RABTracks' own ET flag (+1 = onset: last time the ERA5
    storm is a symmetric, intensifying warm core; -1 = complete: first time it is an
    asymmetric cold core), kept only when that time survives the filtering above;
  * storms whose RABTracks SID is not in tcviewer (provisional IBTrACS SIDs change) are
    matched by basin + name + start date (or start position for unnamed storms).

Output: data/cps_<basin>.json =
  {"meta": {...}, "storms": {sid: {"p": [[t, B, VTL, VTU(, raw)], ...], "et": [on, end]}}}
with t = "YYYYMMDDHHMM" (same as the track points in data/basin_<basin>.json); "et" entries
are times or null, and "et" is omitted when neither exists.

This is a static dataset (RABTracks is not updated in real time), so the 6-hourly refresh
job does not touch it; rerun by hand when RABTracks is updated (and after big IBTrACS SID
changes). Needs: numpy, netCDF4.
  python3 build_cps.py                    # all basins
  python3 build_cps.py NA EP              # some basins (merged into the existing files)
  python3 build_cps.py --cache DIR ...    # keep downloads + per-basin conversions in DIR, so a
                                          # long build can be split across runs (resumable)
  python3 build_cps.py --cache DIR --fetch-only NA   # just download
"""
import os, sys, json, struct, zlib, lzma, math, datetime as dt, urllib.request
from concurrent.futures import ThreadPoolExecutor
import numpy as np, netCDF4 as nc

URL = "https://gws-access.jasmin.ac.uk/public/huracan/RABTracks/rabtracks.zip"
SOURCE = "TRACK-ERA5"
MAX_KM = 400
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
UA = {"User-Agent": "tcviewer-build-cps/2.0"}
T0 = dt.datetime(1900, 1, 1)
SIZE = None

# ---------------------------------------------------------------- download
def get_range(a, b, tries=5):
    for k in range(tries):
        try:
            r = urllib.request.Request(URL, headers={**UA, "Range": f"bytes={a}-{b}"})
            with urllib.request.urlopen(r, timeout=300) as f: d = f.read()
            if len(d) == b - a + 1: return d
        except Exception:
            if k == tries - 1: raise
    raise IOError("short read")

def zip_entries():
    with urllib.request.urlopen(urllib.request.Request(URL, method="HEAD", headers=UA)) as f:
        size = int(f.headers["Content-Length"])
    global SIZE; SIZE = size
    tail = get_range(size - 65536, size - 1)
    i = tail.rfind(b"PK\x05\x06"); n, cds, cdo = struct.unpack("<HII", tail[i+10:i+20])
    cd = get_range(cdo, cdo + cds - 1); p = 0; ents = []
    while p < len(cd):
        csz, = struct.unpack("<I", cd[p+20:p+24]); fl, el, cl = struct.unpack("<HHH", cd[p+28:p+34])
        off, = struct.unpack("<I", cd[p+42:p+46]); name = cd[p+46:p+46+fl].decode()
        ents.append((name.split("_")[-1].split(".")[0], off, csz)); p += 46 + fl + el + cl
    return ents

def fetch_entry(b, off, csz, cache=None, nparts=16):
    """Raw (still deflated) bytes of one zip entry, incl. its local header."""
    end = min(off + 30 + 1024 + csz, SIZE - 1)      # header slack, but not past end of file
    L = (end - off) // nparts + 1
    rng = [(off + k*L, min(off + (k+1)*L - 1, end)) for k in range(nparts)]
    if not cache:
        with ThreadPoolExecutor(nparts) as ex: return b"".join(ex.map(lambda r: get_range(*r), rng))
    os.makedirs(cache, exist_ok=True)
    def part(k):                                         # resumable per-part download
        a, e = rng[k]; p = os.path.join(cache, f"{b}.{k}")
        have = os.path.getsize(p) if os.path.exists(p) else 0
        if have < e - a + 1:
            with open(p, "ab") as f: f.write(get_range(a + have, e))
        return open(p, "rb").read()
    with ThreadPoolExecutor(nparts) as ex: return b"".join(ex.map(part, range(nparts)))

def decompress(raw, csz):
    fl, el = struct.unpack("<HH", raw[26:30]); raw = raw[30+fl+el:30+fl+el+csz]
    return lzma.decompress(zlib.decompressobj(-15).decompress(raw))

# ---------------------------------------------------------------- convert
def hav_km(la1, lo1, la2, lo2):
    la1, lo1, la2, lo2 = map(np.radians, (la1, lo1, la2, lo2))
    a = np.sin((la2-la1)/2)**2 + np.cos(la1)*np.cos(la2)*np.sin((lo2-lo1)/2)**2
    return 6371 * 2 * np.arcsin(np.sqrt(np.clip(a, 0, 1)))

def tstr(s): return (T0 + dt.timedelta(seconds=float(s))).strftime("%Y%m%d%H%M")

def convert(mem, stats):
    """-> {sid: {"p": [...], "et": [...], "name": str, "lat0", "lon0"}}"""
    D = nc.Dataset("x", memory=mem)
    src = list(D["source"][:]); i = src.index(SOURCE); ib = src.index("IBTrACS")
    tid = np.array(D["track_id"][:]); names = np.array(D["name"][:])
    t = np.ma.filled(D["time"][:].astype(float), np.nan)
    g = lambda v, k: np.ma.filled(D[v][k, :].astype(float), np.nan)
    ilat, ilon = g("lat", ib), g("lon", ib)
    elat, elon = g("lat", i), g("lon", i)
    vals, raw = [], np.zeros(len(t), bool)
    for v in ("b", "vtl", "vtu"):
        r, x = g(v + "_roll", i), g(v, i)
        raw |= ~np.isfinite(r) & np.isfinite(x); vals.append(np.where(np.isfinite(r), r, x))
    B, L, U = vals
    ET = np.ma.filled(D["ET"][i, :].astype(float), 0)
    ok = np.isfinite(B) & np.isfinite(L) & np.isfinite(U) & np.isfinite(t) & np.isfinite(elat)
    has_ib = np.isfinite(ilat) & np.isfinite(ilon) & np.isfinite(t)
    order = np.argsort(tid, kind="stable"); uniq, starts = np.unique(tid[order], return_index=True)
    out = {}
    for s, a, e in zip(uniq, starts, list(starts[1:]) + [len(order)]):
        idx = order[a:e]; ibx = idx[has_ib[idx]]
        if not len(ibx): continue
        ibx = ibx[np.argsort(t[ibx])]
        ti, la, lo = t[ibx], ilat[ibx], np.degrees(np.unwrap(np.radians(ilon[ibx])))
        sel = idx[ok[idx] & (t[idx] >= ti[0]) & (t[idx] <= ti[-1])]
        sel = sel[np.argsort(t[sel], kind="stable")]
        if not len(sel): continue
        d = hav_km(np.interp(t[sel], ti, la), np.interp(t[sel], ti, lo), elat[sel], elon[sel])
        stats["pts"] += len(sel); stats["far"] += int((d > MAX_KM).sum())
        sel = sel[d <= MAX_KM]
        pts, et, last = [], [None, None], None
        for j in sel:
            ts = tstr(t[j])
            if ts == last: continue
            last = ts
            p = [ts, round(float(B[j]), 1), round(float(L[j]), 1), round(float(U[j]), 1)]
            if raw[j]: p.append(1)
            pts.append(p)
            if ET[j] > 0 and et[0] is None: et[0] = ts
            if ET[j] < 0 and et[1] is None: et[1] = ts
        if et[1] and et[0] and et[1] < et[0]: et[1] = None     # completion must follow onset
        if len(pts) < 2: stats["short"] += 1; continue
        rec = {"p": pts, "name": str(names[idx[0]]).strip().upper(), "t0": tstr(ti[0]),
               "lat0": float(la[0]), "lon0": float(ilon[ibx[0]])}
        if et[0] or et[1]: rec["et"] = et
        out[str(s)] = rec
    D.close(); return out

# ---------------------------------------------------------------- write
def write(allcps, partial):
    idx = json.load(open(os.path.join(DATA, "index.json")))["storms"]
    tv = {s["sid"]: s for s in idx}
    # re-key storms whose RABTracks SID isn't a tcviewer SID (provisional IBTrACS SIDs)
    remap = {}
    for sid, r in allcps.items():
        if sid in tv: continue
        y = int(sid[:4]); best = None
        for s in idx:
            if s["year"] != y or s["sid"] in allcps: continue
            dday = abs((dt.datetime.strptime(str(s["t0"]), "%Y%m%d") -
                        dt.datetime.strptime(r["t0"][:8], "%Y%m%d")).days)
            if r["name"] not in ("", "UNNAMED", "NOT_NAMED") and s["name"] == r["name"] and dday <= 3:
                best = s["sid"]; break
            if dday <= 1 and s["sid"][7] == sid[7] and abs(int(s["sid"][8:10]) - int(sid[8:10])) <= 3 and \
               abs(int(s["sid"][10:13]) - int(sid[10:13])) <= 3:
                best = best or s["sid"]                      # unnamed: SID encodes start lat/lon
        if best and best not in remap.values(): remap[sid] = best
    for a, b in remap.items(): allcps[b] = allcps.pop(a)
    print(f"re-keyed {len(remap)} storms by name/date/position; "
          f"{sum(1 for s in allcps if s not in tv)} RABTracks storms still not in tcviewer")
    meta = {"source": "RABTracks (Bourdin et al. 2026), TRACK tracker on ERA5; Hart (2003) cyclone phase space",
            "fields": ["t", "B", "VTL", "VTU", "raw"],
            "note": f"centred 24-h running means (raw=1: end of track, unsmoothed); VTL/VTU > 0 = warm core "
                    f"(Hart's -VTL/-VTU); units m; points > {MAX_KM} km from the IBTrACS position dropped; "
                    "et = RABTracks ET onset/completion",
            "built": dt.datetime.utcnow().strftime("%Y-%m-%d")}
    n = 0
    for fn in sorted(os.listdir(DATA)):
        if not (fn.startswith("basin_") and fn.endswith(".json")): continue
        b = fn[6:-5]; sids = json.load(open(os.path.join(DATA, fn))).keys()
        st = {s: {k: v for k, v in allcps[s].items() if k in ("p", "et")} for s in sids if s in allcps}
        p = os.path.join(DATA, f"cps_{b}.json")
        if partial:
            if not st: continue
            if os.path.exists(p):
                old = json.load(open(p))["storms"]
                if old and isinstance(next(iter(old.values())), dict): old.update(st); st = old
        if not st: continue
        json.dump({"meta": meta, "storms": st}, open(p, "w"), separators=(",", ":"))
        n += len(st); print(f"wrote {p}: {len(st)} storms, {os.path.getsize(p)/1e6:.2f} MB")
    print("total storms with CPS:", n)

def main():
    args = sys.argv[1:]; cache = None; fetch_only = "--fetch-only" in args
    if "--cache" in args: k = args.index("--cache"); cache = args[k+1]; del args[k:k+2]
    args = [a for a in args if a != "--fetch-only"]
    want = set(args); allcps = {}; stats = {"pts": 0, "far": 0, "short": 0}
    for b, off, csz in zip_entries():
        if want and b not in want: continue
        conv = cache and os.path.join(cache, f"conv_{b}.json")
        if conv and os.path.exists(conv) and not fetch_only:     # converted earlier (see --cache)
            part = json.load(open(conv)); allcps.update(part); print(f"{b}: {len(part)} storms (cached)"); continue
        print(f"{b}: {csz/1e6:.1f} MB", flush=True)
        raw = fetch_entry(b, off, csz, cache)
        if fetch_only: continue
        part = convert(decompress(raw, csz), stats); allcps.update(part); del raw
        if conv: json.dump(part, open(conv, "w"))
        print(f"{b}: {len(part)} storms", flush=True)
    if fetch_only: return
    print(f"points {stats['pts']}, dropped > {MAX_KM} km: {stats['far']}, storms with < 2 points left: {stats['short']}")
    write(allcps, partial=bool(want))

if __name__ == "__main__":
    main()
