#!/usr/bin/env python3
"""
build_impacts.py — build the data behind tcviewer.org/impacts/ ("Storm Hazards & Impacts").

For every Atlantic / East-Pacific storm since 2004 whose 34-kt wind radii touched a U.S. county,
writes impacts/data/storms/<slug>.json with county-level hazards and impacts, plus
impacts/data/index.json (the storm list with headline numbers).

    python3 build_impacts.py                 # build everything (downloads are cached)
    python3 build_impacts.py --only helene-2024 ian-2022
    python3 build_impacts.py --skip-rain     # skip the PRISM rainfall step (slowest download)
    python3 build_impacts.py --terrain       # also rebuild impacts/data/terrain_conus.png

Inputs (all public; cached under .impacts_cache/, which is git-ignored):
  wind      data/basin_NA.json, data/basin_EP.json (IBTrACS, built by process_storms.py):
            34/50/64-kt wind-radii swaths, built exactly like the main viewer draws them
  rain      PRISM daily precipitation, 4 km (PRISM Group, Oregon State Univ.), CONUS only
  surge     USGS STN high-water marks (flood height above ground; coastal vs riverine),
            plus the peak observed / modeled surge per landfall from Klotzbach et al. (2026)
  impacts   NCEI Storm Events (county deaths, injuries, property & crop damage, tornadoes),
            Muller et al. (2026) CONUS direct-fatality database (deaths by state & cause),
            normalized damage per landfall (Mooney et al. 2026, via Klotzbach et al. 2026)
  people    geo/county_pop.json (Census Vintage 2024)
"""
import argparse, datetime as dt, gzip, io, json, math, os, re, sys, time, urllib.request, zipfile
from collections import defaultdict

import numpy as np

try:
    import shapely
    from shapely.geometry import Polygon, MultiPolygon, Point, shape, mapping
    from shapely.ops import unary_union
    from shapely.strtree import STRtree
except ImportError:
    sys.exit("needs shapely >= 2:  pip install shapely")

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, ".impacts_cache")
OUT = os.path.join(HERE, "impacts", "data")
YEAR0 = 2004                         # wind radii are routinely analysed from ~2004 on
UA = {"User-Agent": "tcviewer.org impacts builder (Purdue Chavas lab)"}

KLOTZBACH_XLSX = "44304_2026_257_MOESM2_ESM1.xlsx"   # Klotzbach et al. (2026) supplementary table
MULLER_URL = ("https://raw.githubusercontent.com/DrJoMuller/CONUS-TC-Fatalities-1963-2024/main/"
              "GitHub_CONUS%20TC%20Fatalities%201963%E2%80%932024.xlsx")
SE_LIST = "https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/"
ZONES_URL = "https://www.weather.gov/source/gis/Shapefiles/County/bp16ap26.dbx"
STN = "https://stn.wim.usgs.gov/STNServices/"
PRISM = "https://services.nacse.org/prism/data/get/us/4km/ppt/{ymd}"


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def fetch(url, dest, timeout=300, retries=3):
    """Download url to dest (cached)."""
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return dest
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    for k in range(retries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=timeout) as r, open(dest + ".tmp", "wb") as f:
                while True:
                    b = r.read(1 << 20)
                    if not b:
                        break
                    f.write(b)
            os.replace(dest + ".tmp", dest)
            return dest
        except Exception as e:
            log(f"  fetch failed ({k+1}/{retries}) {url}: {e}")
            time.sleep(3 * (k + 1))
    return None


# ----------------------------------------------------------------------------------------------
# geography
# ----------------------------------------------------------------------------------------------
def topo_features(path):
    topo = json.loads(gzip.open(path).read())
    obj = topo["objects"][next(iter(topo["objects"]))]
    tr = topo.get("transform")
    arcs = []
    for a in topo["arcs"]:
        if tr:
            (sx, sy), (tx, ty) = tr["scale"], tr["translate"]
            x = y = 0; pts = []
            for p in a:
                x += p[0]; y += p[1]; pts.append((x * sx + tx, y * sy + ty))
        else:
            pts = [tuple(p) for p in a]
        arcs.append(pts)

    def ring(idx):
        pts = []
        for i in idx:
            a = arcs[i] if i >= 0 else arcs[~i][::-1]
            pts.extend(a if not pts else a[1:])
        return pts

    out = []
    for g in obj["geometries"]:
        if g["type"] == "Polygon":
            polys = [g["arcs"]]
        elif g["type"] == "MultiPolygon":
            polys = g["arcs"]
        else:
            continue
        parts = []
        for p in polys:
            rings = [ring(r) for r in p]
            if len(rings[0]) >= 4:
                parts.append(Polygon(rings[0], [r for r in rings[1:] if len(r) >= 4]))
        geom = shapely.make_valid(MultiPolygon(parts) if len(parts) > 1 else parts[0])
        out.append((g.get("properties", {}), geom))
    return out


class Counties:
    def __init__(self):
        feats = topo_features(os.path.join(HERE, "geo", "counties.topo.json.gz"))
        pop = json.load(open(os.path.join(HERE, "geo", "county_pop.json")))["pop"]
        self.ids = [p["GEOID"] for p, _ in feats]
        self.name = {p["GEOID"]: p["NAME"] for p, _ in feats}
        self.st = {p["GEOID"]: p["STUSPS"] for p, _ in feats}
        self.geom = [g for _, g in feats]
        self.idx = {g: i for i, g in enumerate(self.ids)}
        self.pop = {g: pop.get(g) for g in self.ids}
        self.tree = STRtree(self.geom)
        self.area = np.array([g.area for g in self.geom])
        self.cent = np.array([[g.representative_point().x, g.representative_point().y] for g in self.geom])
        for g in self.geom:
            shapely.prepare(g)
        # name lookup for zone fallback: (state, normalised county name) -> GEOID
        self.by_name = {}
        for g in self.ids:
            self.by_name[(self.st[g], norm_name(self.name[g]))] = g

    def at(self, lon, lat, tol=0.0):
        """GEOID of the county containing (lon, lat); with tol>0 also the nearest within tol deg."""
        pt = Point(lon, lat)
        hit = self.tree.query(pt, predicate="intersects")
        if len(hit):
            return self.ids[int(hit[0])]
        if tol > 0:
            near = self.tree.query(pt.buffer(tol))
            if len(near):
                best = min(near, key=lambda i: self.geom[i].distance(pt))
                return self.ids[int(best)]
        return None


def norm_name(s):
    s = s.upper().replace("SAINT ", "ST ").replace("ST. ", "ST ").replace(".", "").replace("'", "")
    for w in (" COUNTY", " PARISH", " BOROUGH", " CENSUS AREA", " MUNICIPIO", " CITY AND BOROUGH"):
        s = s.replace(w, "")
    return re.sub(r"\s+", " ", s).strip()


# ----------------------------------------------------------------------------------------------
# wind-radii swaths — a port of the viewer's footprint()/swathPolys() (index.html)
# ----------------------------------------------------------------------------------------------
R_EARTH, NM2KM = 6371.0, 1.852


def dest(lat, lon, brg, dist_nm):
    d = dist_nm * NM2KM / R_EARTH
    br = math.radians(brg); la1 = math.radians(lat); lo1 = math.radians(lon)
    la2 = math.asin(math.sin(la1) * math.cos(d) + math.cos(la1) * math.sin(d) * math.cos(br))
    lo2 = lo1 + math.atan2(math.sin(br) * math.sin(d) * math.cos(la1), math.cos(d) - math.sin(la1) * math.sin(la2))
    d2 = (math.degrees(lo2) - lon + 540) % 360 - 180
    return math.degrees(la2), lon + d2


def radius_at(b, v):
    b %= 360
    x = (b - 45 + 360) % 360
    seg = int(x // 90); t = (x - seg * 90) / 90
    return v[seg] * (1 - t) + v[(seg + 1) % 4] * t


def footprint(lat, lon, radii):
    v = [0 if (r is None or r < 0) else r for r in radii]
    if not any(x > 0 for x in v):
        return None
    pts = []
    for b in range(0, 360, 3):
        r = radius_at(b, v)
        if r > 0:
            la, lo = dest(lat, lon, b, r); pts.append((lo, la))
        else:
            pts.append((lon, lat))
    if len(pts) < 3:
        return None
    p = Polygon(pts)
    return p if p.is_valid else p.buffer(0)


def hav_nm(la1, lo1, la2, lo2):
    p = math.pi / 180
    a = math.sin((la2 - la1) * p / 2) ** 2 + math.cos(la1 * p) * math.cos(la2 * p) * math.sin((lo2 - lo1) * p / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(min(1, a))) / NM2KM


def min_pos(r):
    v = [x for x in r if x is not None and x > 0]
    return min(v) if v else 0


def swath(items):
    """items[i] = (lat, lon, [ne,se,sw,nw]) or None -> shapely geometry (union) or None."""
    polys = []
    for i, a in enumerate(items):
        if not a:
            continue
        f = footprint(*a)
        if f is not None and not f.is_empty:
            polys.append(f)
        b = items[i + 1] if i + 1 < len(items) else None
        if not b:
            continue
        dnm = hav_nm(a[0], a[1], b[0], b[1])
        sc = min(min_pos(a[2]), min_pos(b[2]))
        if sc <= 0:
            continue
        n = min(200, max(0, math.ceil(dnm / (sc * 0.33)) - 1))
        for k in range(1, n + 1):
            t = k / (n + 1)
            rad = [((x or 0) + ((y or 0) - (x or 0)) * t) for x, y in zip(a[2], b[2])]
            f = footprint(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, rad)
            if f is not None and not f.is_empty:
                polys.append(f)
    if not polys:
        return None
    u = unary_union(polys)
    return u if not u.is_empty else None


# ----------------------------------------------------------------------------------------------
# storms
# ----------------------------------------------------------------------------------------------
def load_storms():
    idx = json.load(open(os.path.join(HERE, "data", "index.json")))
    F = idx["meta"]["fields"]; ix = {k: i for i, k in enumerate(F)}
    basins = {b: json.load(open(os.path.join(HERE, "data", f"basin_{b}.json"))) for b in ("NA", "EP")}
    out = []
    for s in idx["storms"]:
        if s["basin"] not in basins or (s.get("year") or 0) < YEAR0:
            continue
        pts = basins[s["basin"]].get(s["sid"])
        if not pts:
            continue
        P = []
        for p in pts:
            g = lambda k: p[ix[k]] if ix[k] < len(p) else None
            P.append({"t": g("t"), "lat": g("lat"), "lon": g("lon"), "vmax": g("vmax"), "pmin": g("pmin"),
                      "sshs": g("sshs"), "nat": g("nat"), "lf": g("lf"),
                      "r34": [g("r34ne"), g("r34se"), g("r34sw"), g("r34nw")],
                      "r50": [g("r50ne"), g("r50se"), g("r50sw"), g("r50nw")],
                      "r64": [g("r64ne"), g("r64se"), g("r64sw"), g("r64nw")]})
        out.append({**s, "pts": P})
    return out


def tparse(t):
    return dt.datetime.strptime(t, "%Y%m%d%H%M").replace(tzinfo=dt.timezone.utc)


def near_us(p):
    la, lo = p["lat"], p["lon"]
    if la is None or lo is None:
        return False
    return ((14 <= la <= 52 and -128 <= lo <= -60) or (16 <= la <= 25 and -165 <= lo <= -150))


def slugify(name, year, sid):
    n = name.lower() if name and name != "UNNAMED" else sid.lower()
    return re.sub(r"[^a-z0-9]+", "-", n).strip("-") + f"-{year}"


def wind_stage(s, C):
    """Swaths, county wind fractions, U.S. time window, landfalls. None if no U.S. county touched."""
    P = [p for p in s["pts"] if p["lon"] is not None and p["lon"] < 0]
    if not any(near_us(p) for p in P):
        return None
    def items(k):
        return [((p["lat"], p["lon"], p[k]) if any(x and x > 0 for x in p[k]) else None) for p in P]
    u34 = swath(items("r34"))
    if u34 is None:
        return None
    cand = C.tree.query(u34, predicate="intersects")
    if not len(cand):
        return None
    u = {"r34": u34, "r50": swath(items("r50")), "r64": swath(items("r64"))}
    counties = {}
    for i in cand:
        g = C.geom[i]; a = C.area[i]
        f = []
        for k in ("r34", "r50", "r64"):
            f.append(0.0 if u[k] is None or not u[k].intersects(g) else round(g.intersection(u[k]).area / a, 4))
        if f[0] > 0:
            counties[C.ids[i]] = {"w": f}
    if not counties:
        return None
    us = unary_union([C.geom[C.idx[g]] for g in counties]); shapely.prepare(us)
    tin = []
    for p in P:
        if any(x and x > 0 for x in p["r34"]):
            fp = footprint(p["lat"], p["lon"], p["r34"])
            if fp is not None and us.intersects(fp):
                tin.append(p["t"])
    if not tin:
        tin = [P[0]["t"], P[-1]["t"]]
    lfs = []
    for p in P:
        if p["lf"] == 1:
            g = C.at(p["lon"], p["lat"], tol=0.3)
            if g:
                lfs.append({"t": p["t"], "lat": p["lat"], "lon": p["lon"], "vmax": p["vmax"], "pmin": p["pmin"],
                            "sshs": p["sshs"], "county": g, "st": C.st[g], "cname": C.name[g]})
    return {"u": u, "counties": counties, "t0": min(tin), "t1": max(tin), "landfalls": lfs, "P": P}


def geo_out(g, tol=0.02):
    """Simplified geometry -> list of polygons, each a list of rings of [lon,lat] (3 decimals)."""
    if g is None:
        return []
    g = g.simplify(tol, preserve_topology=True)
    polys = [g] if g.geom_type == "Polygon" else [x for x in getattr(g, "geoms", []) if x.geom_type == "Polygon"]
    out = []
    for p in polys:
        if p.area < 1e-4:
            continue
        rings = [p.exterior] + list(p.interiors)
        out.append([[[round(x, 3), round(y, 3)] for x, y in r.coords] for r in rings])
    return out


# ----------------------------------------------------------------------------------------------
# NCEI Storm Events: deaths, injuries, damage, tornadoes per county
# ----------------------------------------------------------------------------------------------
TC_TYPES = {"Hurricane", "Hurricane (Typhoon)", "Tropical Storm", "Tropical Depression", "Storm Surge/Tide"}
SE_COLS = ["BEGIN_YEARMONTH", "BEGIN_DAY", "BEGIN_TIME", "EVENT_ID", "EPISODE_ID", "STATE_FIPS", "EVENT_TYPE",
           "CZ_TYPE", "CZ_FIPS", "CZ_NAME", "CZ_TIMEZONE", "INJURIES_DIRECT", "INJURIES_INDIRECT",
           "DEATHS_DIRECT", "DEATHS_INDIRECT", "DAMAGE_PROPERTY", "DAMAGE_CROPS", "TOR_F_SCALE",
           "BEGIN_LAT", "BEGIN_LON", "EPISODE_NARRATIVE", "EVENT_NARRATIVE", "MAGNITUDE", "STATE"]
KEYWORDS = re.compile(r"hurricane|tropical|remnant|post-tropical|subtropical", re.I)
ZONE_WORDS = re.compile(r"\b(COASTAL|INLAND|NORTHERN|SOUTHERN|EASTERN|WESTERN|CENTRAL|UPPER|LOWER|INTERIOR|"
                        r"MAINLAND|NORTHWEST|NORTHEAST|SOUTHWEST|SOUTHEAST|NORTH|SOUTH|EAST|WEST|OUTER|"
                        r"BARRIER ISLANDS?|ISLANDS?|BEACHES|COUNTY|PARISH|LOWLANDS|MOUNTAINS|PIEDMONT|TIDAL|HIGHER ELEVATIONS)\b")


def money(v):
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return 0.0
    s = str(v).strip().upper()
    if not s:
        return 0.0
    m = re.match(r"^([0-9.]*)\s*([KMBH]?)$", s)
    if not m:
        return 0.0
    x = float(m.group(1)) if m.group(1) not in ("", ".") else (1.0 if m.group(2) else 0.0)
    return x * {"": 1, "H": 100, "K": 1e3, "M": 1e6, "B": 1e9}[m.group(2)]


def load_storm_events(C):
    import pandas as pd
    cache = os.path.join(CACHE, "se_tc.pkl")
    files = sorted(f for f in os.listdir(os.path.join(CACHE, "se")) if f.endswith(".csv.gz")) \
        if os.path.isdir(os.path.join(CACHE, "se")) else []
    have_years = {int(re.search(r"_d(\d{4})_", f).group(1)) for f in files}
    lst = urllib.request.urlopen(urllib.request.Request(SE_LIST, headers=UA), timeout=60).read().decode()
    names = sorted(set(re.findall(r"StormEvents_details-ftp_v1\.0_d(\d{4})_c(\d{8})\.csv\.gz", lst)))
    want = {}
    for y, c in names:
        if int(y) >= YEAR0:
            want[int(y)] = f"StormEvents_details-ftp_v1.0_d{y}_c{c}.csv.gz"
    stale = False
    for y, f in want.items():
        p = os.path.join(CACHE, "se", f)
        if not os.path.exists(p):
            for old in [x for x in files if f"_d{y}_" in x]:
                os.remove(os.path.join(CACHE, "se", old))
            log(f"  Storm Events {y}: downloading {f}")
            fetch(SE_LIST + f, p); stale = True
    if os.path.exists(cache) and not stale:
        return pd.read_pickle(cache)
    parts = []
    for y, f in sorted(want.items()):
        d = pd.read_csv(os.path.join(CACHE, "se", f), usecols=lambda c: c in SE_COLS, dtype=str, low_memory=False)
        narr = (d["EPISODE_NARRATIVE"].fillna("") + " " + d["EVENT_NARRATIVE"].fillna(""))
        keep = d["EVENT_TYPE"].isin(TC_TYPES) | narr.str.contains(KEYWORDS)
        parts.append(d[keep])
    d = pd.concat(parts, ignore_index=True)
    # UTC begin time
    tz = d["CZ_TIMEZONE"].fillna("").str.extract(r"(-?\d+)")[0].astype(float).fillna(-5)
    hhmm = d["BEGIN_TIME"].fillna("0").astype(int)
    loc = pd.to_datetime(d["BEGIN_YEARMONTH"] + d["BEGIN_DAY"].str.zfill(2), format="%Y%m%d") \
        + pd.to_timedelta(hhmm // 100, unit="h") + pd.to_timedelta(hhmm % 100, unit="m")
    d["T"] = (loc - pd.to_timedelta(tz, unit="h")).dt.tz_localize("UTC")
    d["NARR"] = d["EPISODE_NARRATIVE"].fillna("") + " \n " + d["EVENT_NARRATIVE"].fillna("")
    for c in ("INJURIES_DIRECT", "INJURIES_INDIRECT", "DEATHS_DIRECT", "DEATHS_INDIRECT"):
        d[c] = pd.to_numeric(d[c], errors="coerce").fillna(0)
    d["PD"] = d["DAMAGE_PROPERTY"].map(money); d["CD"] = d["DAMAGE_CROPS"].map(money)
    d["GEOIDS"] = map_counties(d, C)
    d = d.drop(columns=["EPISODE_NARRATIVE", "EVENT_NARRATIVE", "DAMAGE_PROPERTY", "DAMAGE_CROPS"])
    d.to_pickle(cache)
    return d


def map_counties(d, C):
    """Storm Events county ('C') or forecast-zone ('Z') -> list of GEOIDs."""
    zfile = fetch(ZONES_URL, os.path.join(CACHE, os.path.basename(ZONES_URL)))
    zmap = defaultdict(set)
    for line in open(zfile, encoding="latin-1"):
        f = line.rstrip("\n").split("|")
        if len(f) > 6 and f[6].strip():
            zmap[(f[0], int(f[1]))].add(f[6].strip().zfill(5))
    st_of = {}
    for g in C.ids:
        st_of[g[:2]] = C.st[g]
    out, miss = [], 0
    for sf, typ, cz, nm in zip(d["STATE_FIPS"], d["CZ_TYPE"], d["CZ_FIPS"], d["CZ_NAME"]):
        try:
            sf2 = str(int(float(sf))).zfill(2); czi = int(float(cz))
        except Exception:
            out.append([]); continue
        if typ == "C":
            g = sf2 + str(czi).zfill(3)
            out.append([g] if g in C.idx else []); continue
        if typ != "Z":
            out.append([]); continue
        st = st_of.get(sf2)
        gs = [g for g in zmap.get((st, czi), ()) if g in C.idx]
        if not gs and st and isinstance(nm, str):          # zone renumbered since: match by name
            base = ZONE_WORDS.sub(" ", nm.upper().replace("/", " ").replace("-", " "))
            for part in re.split(r"\bAND\b|,", base):
                g = C.by_name.get((st, norm_name(part)))
                if g:
                    gs.append(g)
        if not gs:
            miss += 1
        out.append(sorted(set(gs)))
    log(f"  Storm Events zone->county: {miss} zone rows unmapped of {len(out)}")
    return out


def name_regex(name):
    n = re.escape(name.title())
    ctx = (r"(?:hurricane|tropical storm|tropical depression|post-tropical(?: cyclone)?|potential tropical cyclone|"
           r"subtropical storm|tropical cyclone|remnants? of(?: former)?(?: hurricane| tropical storm| tropical depression)?|"
           r"remnant low|ex-|former)\s*")
    return re.compile(rf"(?:(?i:{ctx}){n}\b|\b{n}(?:'s|’s)?\s+(?i:remnants|moved|made landfall|came ashore|brought|produced|caused|tracked|passed|weakened))")


def km_to_track(lat, lon, tlat, tlon):
    """min great-circle distance (km) from each (lat,lon) to any track point."""
    la = np.radians(np.asarray(lat, float))[:, None]; lo = np.radians(np.asarray(lon, float))[:, None]
    ta = np.radians(np.asarray(tlat, float))[None, :]; to = np.radians(np.asarray(tlon, float))[None, :]
    a = np.sin((ta - la) / 2) ** 2 + np.cos(la) * np.cos(ta) * np.sin((to - lo) / 2) ** 2
    return (2 * 6371 * np.arcsin(np.sqrt(np.clip(a, 0, 1)))).min(axis=1)


def match_storm_events(storms, d, C):
    """Assign Storm Events rows to storms. Returns {slug: DataFrame}."""
    import pandas as pd
    d = d.sort_values("T").reset_index(drop=True)
    T = d["T"].values
    best = {}                                     # row -> (score, -dist, slug)
    for s in storms:
        W = s["W"]
        t0 = pd.Timestamp(tparse(W["t0"])); t1 = pd.Timestamp(tparse(W["t1"]))
        lo_i = np.searchsorted(T, (t0 - pd.Timedelta(hours=48)).to_datetime64())
        hi_i = np.searchsorted(T, (t1 + pd.Timedelta(hours=120)).to_datetime64())
        if hi_i <= lo_i:
            continue
        sub = d.iloc[lo_i:hi_i]
        P = W["P"]
        tla = [p["lat"] for p in P]; tlo = [p["lon"] for p in P]
        lat = []; lon = []
        for gs, bla, blo in zip(sub["GEOIDS"], sub["BEGIN_LAT"], sub["BEGIN_LON"]):
            if gs:
                c = C.cent[C.idx[gs[0]]]; lat.append(c[1]); lon.append(c[0])
            else:
                try:
                    lat.append(float(bla)); lon.append(float(blo))
                except Exception:
                    lat.append(np.nan); lon.append(np.nan)
        dist = km_to_track(lat, lon, tla, tlo)
        rx = name_regex(s["name"]) if s["name"] not in ("UNNAMED", "") else None
        named = sub["NARR"].str.contains(rx) if rx is not None else pd.Series(False, index=sub.index)
        inA = sub["EVENT_TYPE"].isin(TC_TYPES) & (sub["T"] >= t0 - pd.Timedelta(hours=24)) & \
            (sub["T"] <= t1 + pd.Timedelta(hours=24)) & (np.nan_to_num(dist, nan=9e9) <= 400)
        inB = named & (np.nan_to_num(dist, nan=0) <= 1200)
        for ri, a, b, dd in zip(sub.index, inA, inB, dist):
            if not (a or b):
                continue
            sc = (2 if b else 1, -(0 if np.isnan(dd) else dd))
            if ri not in best or sc > best[ri][:2]:
                best[ri] = (sc[0], sc[1], s["slug"])
    out = defaultdict(list)
    for ri, (_, _, slug) in best.items():
        out[slug].append(ri)
    return {k: d.loc[sorted(v)] for k, v in out.items()}


def se_summarise(rows, C):
    """County aggregates + storm totals + tornado points from matched Storm Events rows."""
    cty = defaultdict(lambda: {"dd": 0.0, "di": 0.0, "id": 0.0, "ii": 0.0, "pd": 0.0, "cd": 0.0,
                               "n": 0, "tor": 0, "ef": -1, "types": defaultdict(int)})
    tot = {"dd": 0, "di": 0, "id": 0, "ii": 0, "pd": 0.0, "cd": 0.0, "n": 0, "tor": 0,
           "unmapped": {"dd": 0, "di": 0, "pd": 0.0, "n": 0}}
    types = defaultdict(lambda: {"n": 0, "dd": 0, "di": 0, "pd": 0.0})
    tors = []
    for _, r in rows.iterrows():
        gs = r["GEOIDS"]; k = len(gs)
        dd, di, ij, ii, pdm, cdm = (r["DEATHS_DIRECT"], r["DEATHS_INDIRECT"], r["INJURIES_DIRECT"],
                                    r["INJURIES_INDIRECT"], r["PD"], r["CD"])
        et = r["EVENT_TYPE"]
        tot["dd"] += dd; tot["di"] += di; tot["id"] += ij; tot["ii"] += ii; tot["pd"] += pdm; tot["cd"] += cdm
        tot["n"] += 1
        types[et]["n"] += 1; types[et]["dd"] += dd; types[et]["di"] += di; types[et]["pd"] += pdm
        ef = -1
        if et == "Tornado":
            tot["tor"] += 1
            m = re.search(r"(\d)", str(r["TOR_F_SCALE"]))
            ef = int(m.group(1)) if m else -1
            try:
                tors.append([round(float(r["BEGIN_LAT"]), 3), round(float(r["BEGIN_LON"]), 3), ef])
            except Exception:
                pass
        if not k:
            u = tot["unmapped"]; u["dd"] += dd; u["di"] += di; u["pd"] += pdm; u["n"] += 1
            continue
        for g in gs:
            c = cty[g]
            c["dd"] += dd / k; c["di"] += di / k; c["id"] += ij / k; c["ii"] += ii / k
            c["pd"] += pdm / k; c["cd"] += cdm / k; c["n"] += 1; c["types"][et] += 1
            if et == "Tornado":
                c["tor"] += 1; c["ef"] = max(c["ef"], ef)
    cout = {}
    for g, c in cty.items():
        cout[g] = {"dd": round(c["dd"], 2), "di": round(c["di"], 2), "id": round(c["id"], 2), "ii": round(c["ii"], 2),
                   "pd": round(c["pd"]), "cd": round(c["cd"]), "n": c["n"], "tor": c["tor"], "ef": c["ef"],
                   "types": dict(sorted(c["types"].items(), key=lambda x: -x[1]))}
    tot["types"] = {k: {**v, "pd": round(v["pd"])} for k, v in sorted(types.items(), key=lambda x: -x[1]["n"])}
    for k in ("dd", "di", "id", "ii"):
        tot[k] = int(round(tot[k]))
    tot["pd"] = round(tot["pd"]); tot["cd"] = round(tot["cd"])
    tot["unmapped"] = {k: (round(v) if isinstance(v, float) else int(v)) for k, v in tot["unmapped"].items()}
    return cout, tot, tors


# ----------------------------------------------------------------------------------------------
# USGS STN high-water marks (flood height above ground, coastal & riverine)
# ----------------------------------------------------------------------------------------------
HWM_MAX_FT = 40      # deepest plausible flood above ground; larger values are data-entry errors


def stn_events():
    p = fetch(STN + "Events.json", os.path.join(CACHE, "stn", "events.json"))
    ev = {}
    for e in json.load(open(p)):
        m = re.match(r"^(\d{4})\s+([A-Za-z]+)$", (e.get("event_name") or "").strip())
        if m and e.get("event_type_id") == 2:
            ev[(int(m.group(1)), m.group(2).upper())] = e["event_id"]
    return ev


def stn_stage(s, C, ev):
    eid = ev.get((s["year"], s["name"]))
    if not eid:
        return None
    p = fetch(STN + f"HWMs/FilteredHWMs.json?Event={eid}", os.path.join(CACHE, "stn", f"hwm_{eid}.json"))
    if not p:
        return None
    pts, cty = [], {}
    for h in json.load(open(p)):
        la, lo = h.get("latitude_dd") or h.get("latitude"), h.get("longitude_dd") or h.get("longitude")
        if la is None or lo is None:
            continue
        hag, el = h.get("height_above_gnd"), h.get("elev_ft")
        if hag is not None and not (-1 <= hag <= HWM_MAX_FT):
            hag = None                                 # obvious entry errors (e.g. 152 ft above ground)
        if el is not None and not (-20 <= el <= 2000):
            el = None
        env = "c" if (h.get("hwm_environment") or "").lower().startswith("coast") else "r"
        g = C.at(lo, la, tol=0.05)
        q = (h.get("hwmQualityName") or "").split(":")[0]
        pts.append([round(la, 4), round(lo, 4), None if hag is None else round(hag, 1),
                    None if el is None else round(el, 1), env, g, q, (h.get("siteDescription") or "")[:60]])
        if el is not None and "NAVD" not in (h.get("verticalDatumName") or ""):
            el = None                                  # only compare elevations on one datum
            pts[-1][3] = None
        if g and (hag is not None or el is not None):
            c = cty.setdefault(g, {"hc": None, "hr": None, "ec": None, "er": None, "n": 0})
            for k, v in (("h" + env, hag), ("e" + env, el)):
                if v is not None:
                    c[k] = v if c[k] is None else max(c[k], v)
            c["n"] += 1
    return {"event": eid, "pts": pts, "cty": cty}


# ----------------------------------------------------------------------------------------------
# storm-level tables: Muller et al. (2026) fatalities; Klotzbach et al. (2026) landfalls
# ----------------------------------------------------------------------------------------------
def load_muller():
    import openpyxl
    p = fetch(MULLER_URL, os.path.join(CACHE, "muller_fat.xlsx"))
    rows = list(openpyxl.load_workbook(p, read_only=True, data_only=True).worksheets[0].iter_rows(values_only=True))
    H = rows[0]; out = {}
    causes = ["surge", "surf", "rough_seas", "rip_current", "freshwater_floods", "wind", "tree_fall",
              "tornado", "lightning", "unknown"]
    for r in rows[1:]:
        if not r or not r[1]:
            continue
        rec = dict(zip(H, r))
        tot = rec.get("Direct Deaths CONUS")
        try:
            tot = int(tot)
        except Exception:
            continue
        by = {}
        for c in causes:
            n = rec.get(c)
            try:
                n = int(n)
            except Exception:
                continue
            if n <= 0:
                continue
            by[c] = {"n": n, "where": parse_where(rec.get(c + "_location"), n)}
        out[str(rec["HURDAT Code"]).strip().upper()] = {"total": tot, "by": by,
                                                         "src": (rec.get("Source Link") or "").strip()}
    return out


def parse_where(s, n):
    """'78 NC, 15 TN, 2 SC' -> {'NC':78,...}; 'FL' -> {'FL': n}."""
    if not s:
        return {}
    s = str(s); out = {}
    for part in re.split(r"[,;]", s):
        m = re.match(r"^\s*(\d+)\s+([A-Z]{2})\b", part.strip())
        if m:
            out[m.group(2)] = out.get(m.group(2), 0) + int(m.group(1))
    if not out:
        sts = re.findall(r"\b([A-Z]{2})\b", s)
        if len(sts) == 1:
            out[sts[0]] = n
    return out


def load_klotzbach():
    import openpyxl
    p = os.path.join(HERE, "impacts", "sources", KLOTZBACH_XLSX)
    if not os.path.exists(p):
        log("  (Klotzbach et al. landfall table not found at impacts/sources/ — skipping)")
        return {}
    rows = list(openpyxl.load_workbook(p, read_only=True, data_only=True)["Raw Data"].iter_rows(values_only=True))
    H = rows[0]; out = defaultdict(list)
    for r in rows[1:]:
        if not r or not r[0]:
            continue
        x = dict(zip(H, r))
        f = lambda k: (None if x.get(k) in (None, "", "NA") else x.get(k))
        out[str(x["ATCF"]).upper()].append({
            "date": f"{x['Landfall_Year']}-{int(x['Landfall_Month']):02d}-{int(x['Landfall_Day']):02d}",
            "st": x["Landfall_State"], "lat": f("Landfall_Lat"), "lon": f("Landfall_Lon"),
            "vmax": f("Landfall Wind_Kt"), "pmin": f("Landfall_MSLP_hPa"),
            "dmg": f("Muller Current Damage ($2024, MMH)"),
            "surge_obs": f("Observed Surge (m)"), "surge_obs_ll": [f("Obs_Surge_Lat"), f("Obs_Surge_Lon")],
            "surge_mod": f("Modeled Max Surge (m)"), "surge_mod_ll": [f("Mod_Surge_Lat"), f("Mod_Surge_Lon")],
            "deaths": f("Direct Fatalities"), "deaths_surge": f("Surge Fatalities")})
    return out


# ----------------------------------------------------------------------------------------------
# PRISM daily precipitation (CONUS, 4 km): storm-period totals per county
# ----------------------------------------------------------------------------------------------
def rain_days(W):
    """Dates covering the storm's U.S. period. PRISM's day is the 24 h ending 12 UTC on the date,
    so take the first date after the storm reaches the U.S. through 2 days after it leaves."""
    d0 = tparse(W["t0"]).date(); d1 = (tparse(W["t1"]) + dt.timedelta(hours=12)).date() + dt.timedelta(days=2)
    out = []
    while d0 <= d1:
        out.append(d0.strftime("%Y%m%d")); d0 += dt.timedelta(days=1)
    return out


def prism_get(ymd):
    return fetch(PRISM.format(ymd=ymd), os.path.join(CACHE, "prism", f"{ymd}.zip"), timeout=120)


def prism_read(path):
    import tifffile
    z = zipfile.ZipFile(path)
    tn = next(n for n in z.namelist() if n.endswith(".tif"))
    with tifffile.TiffFile(io.BytesIO(z.read(tn))) as t:
        p = t.pages[0]; a = p.asarray().astype(np.float32)
        sx, sy = p.tags[33550].value[:2]; tp = p.tags[33922].value
    a[a < -9000] = np.nan
    return a, (tp[3], tp[4], sx, sy)            # x0 (west edge), y0 (north edge), dx, dy


class RainGrid:
    """Maps PRISM cells to counties once (cell centre in county)."""
    def __init__(self, C, shape, gt):
        cache = os.path.join(CACHE, "prism_county_index.npy")
        H, Wd = shape; x0, y0, dx, dy = gt
        if os.path.exists(cache):
            self.cid = np.load(cache)
        else:
            xs = x0 + (np.arange(Wd) + 0.5) * dx; ys = y0 - (np.arange(H) + 0.5) * dy
            X, Y = np.meshgrid(xs, ys)
            pts = shapely.points(X.ravel(), Y.ravel())
            pi, gi = C.tree.query(pts, predicate="intersects")
            cid = np.full(H * Wd, -1, np.int32); cid[pi] = gi
            self.cid = cid.reshape(H, Wd); np.save(cache, self.cid)
        self.gt = gt


RAIN_KM = 500        # count a day's rain only within this distance of the storm centre that day


def rain_stage(W, C, grid_holder):
    """Storm-total rain: sum PRISM days, each masked to cells within RAIN_KM of where the storm
    centre was from 6 h before that PRISM day (24 h ending 12 UTC) to 30 h after it — the rain shield
    (and any predecessor rain event) runs well ahead of the centre."""
    days = rain_days(W)
    tot = None; any_day = False
    P = [p for p in W["P"] if p["lat"] is not None]
    pt = np.array([tparse(p["t"]).timestamp() for p in P])
    for ymd in days:
        p = prism_get(ymd)
        if not p:
            return None
        a, gt = prism_read(p)
        if grid_holder.get("g") is None:
            grid_holder["g"] = RainGrid(C, a.shape, gt)
            H, Wd = a.shape; x0, y0, dx, dy = gt
            grid_holder["lat"] = np.repeat(y0 - (np.arange(H) + 0.5) * dy, Wd)
            grid_holder["lon"] = np.tile(x0 + (np.arange(Wd) + 0.5) * dx, H)
        end = dt.datetime.strptime(ymd, "%Y%m%d").replace(hour=12, tzinfo=dt.timezone.utc).timestamp()
        sel = (pt >= end - 30 * 3600) & (pt <= end + 30 * 3600)   # +30 h: rain runs ahead of the centre
        if tot is None:
            tot = np.zeros_like(a)
        if not sel.any():
            continue
        tla = np.array([P[i]["lat"] for i in np.nonzero(sel)[0]]); tlo = np.array([P[i]["lon"] for i in np.nonzero(sel)[0]])
        la = grid_holder["lat"]; lo = grid_holder["lon"]
        box = (la > tla.min() - 5) & (la < tla.max() + 5) & (lo > tlo.min() - 6) & (lo < tlo.max() + 6)
        idx = np.nonzero(box & ~np.isnan(a.ravel()))[0]
        if not len(idx):
            continue
        dkm = km_to_track(la[idx], lo[idx], tla, tlo)
        keep = idx[dkm <= RAIN_KM]
        flat = tot.ravel(); flat[keep] += a.ravel()[keep]; any_day = True
    if not any_day:
        return None
    G = grid_holder["g"]
    mm = np.nan_to_num(tot, nan=-1)
    cid = G.cid.ravel(); v = mm.ravel()
    ok = (cid >= 0) & (v >= 0)
    cid = cid[ok]; v = v[ok]
    n = np.bincount(cid, minlength=len(C.ids)); s = np.bincount(cid, weights=v, minlength=len(C.ids))
    mx = np.full(len(C.ids), -1.0); np.maximum.at(mx, cid, v)
    out = {}
    for i in np.nonzero(n)[0]:
        mean_in = s[i] / n[i] / 25.4; max_in = mx[i] / 25.4
        if max_in >= 0.5:
            out[C.ids[i]] = [round(mean_in, 2), round(max_in, 2)]
    if not out:
        return None
    # storm-wide peak cell
    k = int(np.nanargmax(tot)); r, c = divmod(k, tot.shape[1]); x0, y0, dx, dy = G.gt
    peak = {"in": round(float(tot[r, c]) / 25.4, 1), "lat": round(y0 - (r + 0.5) * dy, 3),
            "lon": round(x0 + (c + 0.5) * dx, 3)}
    # coarse grid for a map overlay: 0.25 deg max-pool, inches, only cells >= 1"
    f = 6
    Hc, Wc = tot.shape[0] // f, tot.shape[1] // f
    blk = np.nan_to_num(tot[:Hc * f, :Wc * f], nan=0).reshape(Hc, f, Wc, f).mean(axis=(1, 3)) / 25.4
    cells = [[round(y0 - (i + 0.5) * f * dy, 3), round(x0 + (j + 0.5) * f * dx, 3), round(float(blk[i, j]), 1)]
             for i, j in zip(*np.nonzero(blk >= 1.0))]
    return {"days": [days[0], days[-1]], "cty": out, "peak": peak,
            "grid": {"res": round(f * dx, 4), "cells": cells}}


# ----------------------------------------------------------------------------------------------
# static background: shaded elevation for the lower 48 (one Web-Mercator PNG overlay)
# ----------------------------------------------------------------------------------------------
TERRAIN_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"   # AWS Terrain Tiles
TERRAIN_Z = 6
# hypsometric stops (metres -> colour); shading multiplies these
HYPSO = [(0, (52, 82, 58)), (150, (70, 101, 64)), (300, (95, 112, 66)), (600, (126, 122, 74)),
         (1000, (143, 119, 86)), (1500, (155, 129, 104)), (2000, (166, 146, 128)), (2500, (186, 173, 161)),
         (3000, (214, 208, 202)), (4000, (240, 238, 236))]


def build_terrain(C, out_dir):
    from PIL import Image
    z = TERRAIN_Z; n = 2 ** z
    def tx(lon): return int((lon + 180) / 360 * n)
    def ty(lat):
        r = math.radians(lat); return int((1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * n)
    x0, x1, y0, y1 = tx(-125.5), tx(-66.5), ty(49.6), ty(24.2)
    W, H = (x1 - x0 + 1) * 256, (y1 - y0 + 1) * 256
    dem = np.zeros((H, W), np.float32)
    for X in range(x0, x1 + 1):
        for Y in range(y0, y1 + 1):
            p = fetch(TERRAIN_URL.format(z=z, x=X, y=Y), os.path.join(CACHE, "terrain", f"{z}_{X}_{Y}.png"), timeout=60)
            a = np.asarray(Image.open(p).convert("RGB")).astype(np.float32)
            dem[(Y - y0) * 256:(Y - y0 + 1) * 256, (X - x0) * 256:(X - x0 + 1) * 256] = a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
    # pixel centres -> lon/lat (Web Mercator)
    px = (np.arange(W) + 0.5) / 256 + x0; py = (np.arange(H) + 0.5) / 256 + y0
    lon = px / n * 360 - 180
    lat = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * py / n))))
    # land = inside a lower-48 county (drops ocean, Canada, Mexico)
    conus = [i for i, g in enumerate(C.ids) if C.st[g] not in ("AK", "HI", "PR", "VI", "GU", "AS", "MP")]
    LON, LAT = np.meshgrid(lon, lat)
    pts = shapely.points(LON.ravel(), LAT.ravel())
    land = np.zeros(W * H, bool)
    sub = STRtree([C.geom[i] for i in conus])
    pi, _ = sub.query(pts, predicate="intersects"); land[pi] = True
    land = land.reshape(H, W)
    # hillshade (sun from NW, 45 deg), 2x vertical exaggeration
    res = 40075016.0 / (256 * n) * np.cos(np.radians(lat))[:, None]
    gy, gx = np.gradient(dem * 2.0)
    dzdx = gx / res; dzdy = gy / res
    slope = np.arctan(np.hypot(dzdx, dzdy)); aspect = np.arctan2(-dzdx, dzdy)
    az, alt = math.radians(315), math.radians(45)
    shade = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect)
    shade = np.clip(shade, 0, 1)
    e = np.clip(dem, 0, None)
    stops = np.array([s[0] for s in HYPSO], float); cols = np.array([s[1] for s in HYPSO], float)
    rgb = np.stack([np.interp(e, stops, cols[:, k]) for k in range(3)], -1)
    rgb *= (0.45 + 0.75 * shade)[..., None]
    img = np.zeros((H, W, 4), np.uint8)
    img[..., :3] = np.clip(rgb, 0, 255).astype(np.uint8); img[..., 3] = np.where(land, 235, 0)
    im = Image.fromarray(img, "RGBA").quantize(colors=128, method=Image.Quantize.FASTOCTREE)
    os.makedirs(out_dir, exist_ok=True)
    im.save(os.path.join(out_dir, "terrain_conus.png"), optimize=True)
    def tile2lat(Y): return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * Y / n))))
    meta = {"bounds": [[tile2lat(y1 + 1), x0 / n * 360 - 180], [tile2lat(y0), (x1 + 1) / n * 360 - 180]],
            "stops_m": [s[0] for s in HYPSO], "colors": ["#%02x%02x%02x" % s[1] for s in HYPSO],
            "source": "AWS Terrain Tiles (Mapzen terrarium; USGS 3DEP/SRTM/ETOPO), zoom %d" % z}
    json.dump(meta, open(os.path.join(out_dir, "terrain_conus.json"), "w"))
    log(f"  terrain: {W}x{H} px -> {os.path.getsize(os.path.join(out_dir, 'terrain_conus.png')) / 1e6:.1f} MB")


# ----------------------------------------------------------------------------------------------
# assemble
# ----------------------------------------------------------------------------------------------
def r1(x, n=2):
    return None if x is None else round(float(x), n)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--only", nargs="*", help="slugs to (re)build, e.g. helene-2024")
    ap.add_argument("--skip-rain", action="store_true")
    ap.add_argument("--terrain", action="store_true", help="rebuild the static terrain background")
    a = ap.parse_args()
    os.makedirs(os.path.join(OUT, "storms"), exist_ok=True)
    log("counties…"); C = Counties()
    if a.terrain or not os.path.exists(os.path.join(OUT, "terrain_conus.png")):
        log("terrain (static background)…"); build_terrain(C, OUT)
    log("storms & wind swaths…")
    storms = []
    for s in load_storms():
        W = wind_stage(s, C)
        if W:
            s["W"] = W; s["slug"] = slugify(s["name"], s["year"], s["sid"]); storms.append(s)
    seen = defaultdict(int)                       # unique slugs (e.g. two UNNAMED in a year)
    for s in storms:
        seen[s["slug"]] += 1
        if seen[s["slug"]] > 1:
            s["slug"] += f"-{seen[s['slug']]}"
    log(f"  {len(storms)} storms touched U.S. counties with 34-kt winds since {YEAR0}")
    todo = [s for s in storms if not a.only or s["slug"] in a.only]

    log("Storm Events…"); SE = load_storm_events(C); SEM = match_storm_events(storms, SE, C)
    log("USGS high-water marks, fatality and landfall tables…")
    ev = stn_events(); MUL = load_muller(); KLO = load_klotzbach()

    if not a.skip_rain:                           # fetch PRISM days in parallel first
        from concurrent.futures import ThreadPoolExecutor
        days = sorted({d for s in todo for d in rain_days(s["W"])})
        need = [d for d in days if not os.path.exists(os.path.join(CACHE, "prism", f"{d}.zip"))]
        log(f"PRISM: {len(days)} days needed, {len(need)} to download…")
        with ThreadPoolExecutor(4) as ex:
            for i, _ in enumerate(ex.map(prism_get, need)):
                if i % 50 == 49:
                    log(f"  {i+1}/{len(need)}")
    gh = {}
    index = []
    old = {}
    ip = os.path.join(OUT, "index.json")
    if a.only and os.path.exists(ip):
        old = {x["slug"]: x for x in json.load(open(ip))["storms"]}
    for s in storms:
        if s not in todo:
            if s["slug"] in old:
                index.append(old[s["slug"]])
            continue
        W = s["W"]; P = W["P"]
        log(f"  {s['slug']}")
        cty = {g: dict(v) for g, v in W["counties"].items()}
        se_c, se_t, tors = ({}, None, [])
        if s["slug"] in SEM:
            se_c, se_t, tors = se_summarise(SEM[s["slug"]], C)
        for g, v in se_c.items():
            cty.setdefault(g, {})["se"] = v
        stn = stn_stage(s, C, ev)
        if stn:
            for g, v in stn["cty"].items():
                cty.setdefault(g, {})["h"] = {k: r1(x, 1) for k, x in v.items()}
        rain = None
        if not a.skip_rain and any(C.st[g] not in ("PR", "HI", "AK", "VI") for g in W["counties"]):
            try:
                rain = rain_stage(W, C, gh)
            except Exception as e:
                log(f"    rain failed: {e}")
        if rain:
            for g, v in rain["cty"].items():
                cty.setdefault(g, {})["r"] = v
            rain_out = {k: rain[k] for k in ("days", "peak", "grid")}
        else:
            rain_out = None
        atcf = (s.get("atcf") or "").upper()
        mul = MUL.get(atcf); klo = KLO.get(atcf, [])
        smax = max([p["sshs"] for p in P if p["sshs"] is not None] or [-1])
        vmax = max([p["vmax"] for p in P if p["vmax"] is not None] or [0])
        pmin = min([p["pmin"] for p in P if p["pmin"] is not None] or [None]) if any(p["pmin"] for p in P) else None
        lf = W["landfalls"]
        n64 = [g for g, v in W["counties"].items() if v["w"][2] > 0]
        rec = {
            "v": 1, "slug": s["slug"], "sid": s["sid"], "atcf": atcf, "name": s["name"], "year": s["year"],
            "basin": s["basin"], "t": [P[0]["t"], P[-1]["t"]], "us": [W["t0"], W["t1"]],
            "peak": {"vmax": vmax, "pmin": pmin, "sshs": smax},
            "track": [[p["t"], p["lat"], p["lon"], p["vmax"], p["pmin"], p["sshs"], p["nat"]] for p in P],
            "swaths": {k: geo_out(W["u"][k]) for k in ("r34", "r50", "r64")},
            "landfalls": lf, "counties": cty,
            "hwm": stn["pts"] if stn else [], "stn_event": stn["event"] if stn else None,
            "tor": tors, "rain": rain_out, "se": se_t, "fatalities": mul, "landfall_table": klo,
        }
        with open(os.path.join(OUT, "storms", s["slug"] + ".json"), "w") as f:
            json.dump(rec, f, separators=(",", ":"))
        dmg = sum(x["dmg"] for x in klo if x.get("dmg")) or None
        surge = max([x["surge_obs"] for x in klo if x.get("surge_obs")] or [None]) if klo else None
        hwmx = max([p[2] for p in (stn["pts"] if stn else []) if p[2] is not None] or [None]) if stn else None
        hwme = max([p[3] for p in (stn["pts"] if stn else []) if p[3] is not None and p[4] == "c"] or [None]) if stn else None
        index.append({
            "slug": s["slug"], "name": s["name"], "year": s["year"], "basin": s["basin"], "atcf": atcf,
            "t": rec["t"], "sshs": smax, "vmax": vmax,
            "lf": [{"st": x["st"], "sshs": x["sshs"], "vmax": x["vmax"], "t": x["t"], "cname": x["cname"]} for x in lf],
            "states": sorted({C.st[g] for g in W["counties"]}),
            "n34": len(W["counties"]), "n64": len(n64), "pop64": sum(C.pop.get(g) or 0 for g in n64),
            "deaths": mul["total"] if mul else (se_t["dd"] if se_t else None),
            "deaths_src": "muller" if mul else ("se" if se_t else None),
            "dmg_norm": dmg, "dmg_se": (se_t["pd"] + se_t["cd"]) if se_t else None,
            "rain": rain["peak"]["in"] if rain else None, "surge_m": surge, "hwm_ft": hwmx, "hwm_elev": hwme,
            "tor": se_t["tor"] if se_t else 0,
        })
    index.sort(key=lambda x: (x["t"][0]), reverse=True)
    with open(ip, "w") as f:
        json.dump({"built": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
                   "year0": YEAR0, "storms": index}, f, separators=(",", ":"))
    log(f"wrote {len(index)} storms -> {os.path.relpath(OUT, HERE)}")


if __name__ == "__main__":
    main()
