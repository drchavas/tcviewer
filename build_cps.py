#!/usr/bin/env python3
"""build_cps.py — Hart (2003) cyclone phase space (CPS) along each storm's track, for the
"Cyclone phase space" panel on tcviewer.org.

Source: RABTracks (Bourdin et al., ESSD preprint essd-2026-403; GPL-3.0), which matches
IBTrACS storms (track_id = IBTrACS SID) to reanalysis tracks and computes the CPS
parameters along them. We use the TRACK tracker on ERA5 (source "TRACK-ERA5"), 1940-2025:
  B    : 900-600 hPa thickness asymmetry across the storm, m (hemisphere-adjusted)
  VTL  : lower-tropospheric (900-600 hPa) thermal wind, m; > 0 = warm core   (Hart's -VTL)
  VTU  : upper-tropospheric (600-300 hPa) thermal wind, m; > 0 = warm core   (Hart's -VTU)
RABTracks already signs VTL/VTU so that warm core is positive, i.e. they are the -VTL/-VTU
plotted on Hart's diagrams. We keep the 24-h running means (*_roll, as Hart plots), falling
back to the raw value at the two ends of a track, and only the part of the reanalysis track
that falls within the IBTrACS lifetime of the storm.

Output: data/cps_<basin>.json = {"meta": {...}, "storms": {sid: [[t, B, VTL, VTU], ...]}}
with t = "YYYYMMDDHHMM" (same as the track points in data/basin_<basin>.json).
This is a static dataset (RABTracks is not updated in real time), so the 6-hourly refresh
job does not touch it; rerun this script by hand when a new RABTracks version comes out.

The archive is ~160 MB of per-basin .nc.xz files inside one zip; we fetch each basin's entry
with HTTP range requests in parallel (the server is slow per connection) and decompress in
memory. Needs: numpy, netCDF4.   Usage: python3 build_cps.py [BASIN ...]
"""
import os, sys, io, json, struct, zlib, lzma, datetime as dt, urllib.request
from concurrent.futures import ThreadPoolExecutor
import numpy as np, netCDF4 as nc

URL = "https://gws-access.jasmin.ac.uk/public/huracan/RABTracks/rabtracks.zip"
SOURCE = "TRACK-ERA5"
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
UA = {"User-Agent": "tcviewer-build-cps/1.0"}

def get_range(a, b, tries=5):
    for k in range(tries):
        try:
            r = urllib.request.Request(URL, headers={**UA, "Range": f"bytes={a}-{b}"})
            with urllib.request.urlopen(r, timeout=300) as f: d = f.read()
            if len(d) == b - a + 1: return d
        except Exception as e:
            if k == tries - 1: raise
    raise IOError("short read")

def zip_entries():
    with urllib.request.urlopen(urllib.request.Request(URL, method="HEAD", headers=UA)) as f:
        size = int(f.headers["Content-Length"])
    tail = get_range(size - 65536, size - 1)
    i = tail.rfind(b"PK\x05\x06"); n, cds, cdo = struct.unpack("<HII", tail[i+10:i+20])
    cd = get_range(cdo, cdo + cds - 1); p = 0; ents = []
    while p < len(cd):
        csz, usz = struct.unpack("<II", cd[p+20:p+28]); fl, el, cl = struct.unpack("<HHH", cd[p+28:p+34])
        off, = struct.unpack("<I", cd[p+42:p+46]); name = cd[p+46:p+46+fl].decode()
        ents.append((name, off, csz)); p += 46 + fl + el + cl
    return ents

def fetch_entry(off, csz, nparts=16):
    end = off + 30 + 1024 + csz          # local header + name/extra (generous) + data
    L = (end - off) // nparts + 1
    rng = [(off + k*L, min(off + (k+1)*L - 1, end)) for k in range(nparts)]
    with ThreadPoolExecutor(nparts) as ex: raw = b"".join(ex.map(lambda r: get_range(*r), rng))
    fl, el = struct.unpack("<HH", raw[26:30]); raw = raw[30+fl+el:30+fl+el+csz]
    return lzma.decompress(zlib.decompressobj(-15).decompress(raw))

def convert(mem):
    D = nc.Dataset("x", memory=mem)
    i = list(D["source"][:]).index(SOURCE)
    tid = np.array(D["track_id"][:]); t = np.ma.filled(D["time"][:].astype(float), np.nan)
    has_ib = np.array([len(str(x)) > 0 and str(x) != "nan" for x in D["nature"][:]]) & np.isfinite(t)
    f = lambda v: np.ma.filled(D[v][i, :].astype(float), np.nan)
    pick = lambda v: np.where(np.isfinite(f(v + "_roll")), f(v + "_roll"), f(v))
    B, L, U = pick("b"), pick("vtl"), pick("vtu")
    ok = np.isfinite(B) & np.isfinite(L) & np.isfinite(U) & np.isfinite(t)
    order = np.argsort(tid, kind="stable"); uniq, starts = np.unique(tid[order], return_index=True)
    T0 = dt.datetime(1900, 1, 1); out = {}
    for s, a, e in zip(uniq, starts, list(starts[1:]) + [len(order)]):
        idx = order[a:e]; ib = idx[has_ib[idx]]
        if not len(ib): continue
        sel = idx[ok[idx] & (t[idx] >= t[ib].min()) & (t[idx] <= t[ib].max())]
        sel = sel[np.argsort(t[sel])]; pts = []; last = None
        for j in sel:
            ts = (T0 + dt.timedelta(seconds=float(t[j]))).strftime("%Y%m%d%H%M")
            if ts == last: continue
            last = ts; pts.append([ts, round(float(B[j]), 1), int(round(L[j])), int(round(U[j]))])
        if len(pts) >= 2: out[str(s)] = pts
    D.close(); return out

def main():
    want = set(sys.argv[1:])
    allcps = {}
    for name, off, csz in zip_entries():
        b = name.split("_")[-1].split(".")[0]
        if want and b not in want: continue
        print(f"{b}: fetching {csz/1e6:.1f} MB", flush=True)
        part = convert(fetch_entry(off, csz)); allcps.update(part)
        print(f"{b}: {len(part)} storms", flush=True)
    write(allcps)

def write(allcps):
    """Split by the basin tcviewer files each storm under (data/basin_*.json)."""
    meta = {"source": "RABTracks (Bourdin et al. 2026), TRACK tracker on ERA5; Hart (2003) cyclone phase space",
            "fields": ["t", "B", "VTL", "VTU"],
            "note": "24-h running means; VTL/VTU > 0 = warm core (Hart's -VTL/-VTU); units m",
            "built": dt.datetime.utcnow().strftime("%Y-%m-%d")}
    n = 0
    for fn in sorted(os.listdir(DATA)):
        if not (fn.startswith("basin_") and fn.endswith(".json")): continue
        b = fn[6:-5]; sids = json.load(open(os.path.join(DATA, fn))).keys()
        st = {s: allcps[s] for s in sids if s in allcps}
        if not st: continue
        p = os.path.join(DATA, f"cps_{b}.json")
        if len(sys.argv) > 1 and os.path.exists(p):          # partial rebuild: merge into existing
            old = json.load(open(p))["storms"]; old.update(st); st = old
        json.dump({"meta": meta, "storms": st}, open(p, "w"), separators=(",", ":"))
        n += len(st); print(f"wrote {p}: {len(st)} storms, {os.path.getsize(p)/1e6:.2f} MB")
    print("total storms with CPS:", n)

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--from-raw":   # dev: merge pre-converted cps_raw_*.json
        allcps = {}
        for p in sys.argv[2:]: allcps.update(json.load(open(p)))
        sys.argv = sys.argv[:1]; write(allcps)
    else:
        main()
