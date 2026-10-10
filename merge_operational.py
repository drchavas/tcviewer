#!/usr/bin/env python3
"""
merge_operational.py — top up data/ with NHC's operational best track for recent storms.

NOAA updates IBTrACS only every few days to a week, so a storm making landfall today is
usually missing its last days. NHC publishes its working best track ("b-deck") for every
Atlantic / East & Central Pacific storm, updated every 6 h, with the same fields we use
(position, Vmax, Pmin, RMW, POCI/ROCI, 34/50/64-kt radii by quadrant). This script:

  * reads the b-decks of this year's storms that changed in the last LOOKBACK_DAYS,
  * appends every b-deck time AFTER the storm's last IBTrACS point (IBTrACS stays the
    reference wherever it exists), or adds the storm if IBTrACS doesn't have it yet,
  * marks those storms as operational in data/index.json ("op": last operational time).

Run after process_storms.py (the daily Action does both) and on its own every 6 h.
Standard library only. Re-running is safe: it always starts from the IBTrACS points.
    python3 merge_operational.py            # merge + write data/
    python3 merge_operational.py --dry-run  # report only
"""
import datetime as dt, json, math, os, re, sys, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
BTK = "https://ftp.nhc.noaa.gov/atcf/btk/"
LOOKBACK_DAYS = 21
UA = {"User-Agent": "tcviewer.org operational merge"}
BASIN = {"al": "NA", "ep": "EP", "cp": "EP"}        # IBTrACS files CP storms under EP


def get(url, timeout=60):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout).read().decode("latin-1")


def sshs(vmax, ty):
    if ty in ("SD", "SS"):
        return -2
    if ty in ("EX", "LO", "PT"):
        return -4
    if ty in ("DB", "WV", "XX"):
        return -3
    if vmax is None:
        return None
    for cat, lo in ((5, 137), (4, 113), (3, 96), (2, 83), (1, 64), (0, 34)):
        if vmax >= lo:
            return cat
    return -1


NATURE = {"TD": "TS", "TS": "TS", "HU": "TS", "TY": "TS", "ST": "TS", "TC": "TS",
          "SD": "SS", "SS": "SS", "EX": "ET", "LO": "DS", "DB": "DS", "WV": "DS", "PT": "ET"}


def num(s):
    s = s.strip()
    try:
        v = int(s)
    except ValueError:
        return None
    return v


def parse_bdeck(text):
    """-> (atcf_id, name, [points sorted by time]); point = dict of our fields."""
    pts = {}; name = None; atcf = None
    for line in text.splitlines():
        f = [x.strip() for x in line.split(",")]
        if len(f) < 11 or f[4] != "BEST":
            continue
        atcf = f"{f[0]}{f[1]}{f[2][:4]}".upper()
        t = f[2] + "00"                                   # YYYYMMDDHH -> YYYYMMDDHHMM
        if len(f[2]) != 10:
            continue
        lat = int(f[6][:-1]) / 10 * (1 if f[6][-1] == "N" else -1)
        lon = int(f[7][:-1]) / 10 * (-1 if f[7][-1] == "W" else 1)
        p = pts.setdefault(t, {"t": t, "lat": lat, "lon": lon, "vmax": num(f[8]), "pmin": num(f[9]),
                               "ty": f[10], "r34": [None] * 4, "r50": [None] * 4, "r64": [None] * 4,
                               "poci": None, "roci": None, "rmw": None})
        if len(f) > 16 and f[11] in ("34", "50", "64") and f[12] in ("NEQ", "AAA", ""):
            q = [num(x) for x in f[13:17]]
            if f[12] == "NEQ":
                p["r" + f[11]] = [x if x else 0 for x in q]
        if len(f) > 19:
            p["poci"] = num(f[17]) or p["poci"]; p["roci"] = num(f[18]) or p["roci"]; p["rmw"] = num(f[19]) or p["rmw"]
        if len(f) > 27 and f[27] and f[27] not in ("INVEST", "GENESIS"):
            name = f[27].upper()
    return atcf, name, [pts[k] for k in sorted(pts)]


def motion(a, b):
    """translation speed (kt) and heading (deg, toward) from point a to b."""
    ta = dt.datetime.strptime(a["t"], "%Y%m%d%H%M"); tb = dt.datetime.strptime(b["t"], "%Y%m%d%H%M")
    h = (tb - ta).total_seconds() / 3600
    if h <= 0:
        return None, None
    la1, la2 = math.radians(a["lat"]), math.radians(b["lat"]); dlo = math.radians(b["lon"] - a["lon"])
    d = 2 * math.asin(math.sqrt(math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin(dlo / 2) ** 2))
    nm = d * 6371 / 1.852
    brg = (math.degrees(math.atan2(math.sin(dlo) * math.cos(la2),
                                   math.cos(la1) * math.sin(la2) - math.sin(la1) * math.cos(la2) * math.cos(dlo))) + 360) % 360
    return round(nm / h), round(brg)


def row(F, p, prev):
    spd, dr = motion(prev, p) if prev else (None, None)
    v = {"t": p["t"], "lat": p["lat"], "lon": p["lon"], "vmax": p["vmax"], "pmin": p["pmin"],
         "sshs": sshs(p["vmax"], p["ty"]), "spd": spd, "dir": dr, "nat": NATURE.get(p["ty"], "NR"),
         "lf": 0, "d2l": None, "rmw": p["rmw"], "poci": p["poci"], "roci": p["roci"]}
    for k in ("34", "50", "64"):
        for q, qq in zip(("ne", "se", "sw", "nw"), p["r" + k]):
            v[f"r{k}{q}"] = qq
    r = [v.get(k) for k in F]
    while r and r[-1] is None:
        r.pop()
    return r


def sid_for(p, year):
    doy = dt.datetime.strptime(p["t"][:8], "%Y%m%d").timetuple().tm_yday
    return f"{year}{doy:03d}{'N' if p['lat'] >= 0 else 'S'}{abs(round(p['lat'])):02d}{round(p['lon']) % 360:03d}"


def main():
    dry = "--dry-run" in sys.argv
    idx = json.load(open(os.path.join(HERE, "data", "index.json")))
    F = idx["meta"]["fields"]; ix = {k: i for i, k in enumerate(F)}
    basins = {b: json.load(open(os.path.join(HERE, "data", f"basin_{b}.json"))) for b in ("NA", "EP")}
    by_atcf = {(s.get("atcf") or "").upper(): s for s in idx["storms"] if s.get("atcf")}
    year = dt.datetime.now(dt.timezone.utc).year
    listing = get(BTK)
    cutoff = dt.datetime.now(dt.timezone.utc).replace(tzinfo=None) - dt.timedelta(days=LOOKBACK_DAYS)
    files = []
    for fn, stamp in re.findall(r'href="(b(?:al|ep|cp)\d{2}' + str(year) + r'\.dat)">.*?</a>\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2})', listing):
        if int(fn[3:5]) >= 90:                             # skip invests (90-99)
            continue
        if dt.datetime.strptime(stamp, "%Y-%m-%d %H:%M") >= cutoff:
            files.append(fn)
    changed = []; op_latest = None
    for fn in sorted(files):
        atcf, name, P = parse_bdeck(get(BTK + fn))
        if not P or not atcf:
            continue
        basin = BASIN[fn[1:3]]
        s = by_atcf.get(atcf)
        if s:
            pts = basins[s["basin"]][s["sid"]]
            # drop anything a previous run appended, then append b-deck times past IBTrACS
            n_ib = s.get("n_ibtracs", len(pts))
            pts = pts[:n_ib]
            last = pts[-1][ix["t"]] if pts else "0"
            prev = None
            if pts:
                q = pts[-1]; prev = {"t": q[ix["t"]], "lat": q[ix["lat"]], "lon": q[ix["lon"]]}
            add = []
            for p in P:
                if p["t"] > last:
                    add.append(row(F, p, prev)); prev = p
            if not add and "op" not in s:
                continue
            basins[s["basin"]][s["sid"]] = pts + add
            s["n_ibtracs"] = n_ib
            s["t1"] = int((add[-1][0] if add else last)[:8])
            if name and s.get("name") in (None, "", "UNNAMED", "NOT_NAMED"):
                s["name"] = name
            s["op"] = add[-1][0] if add else s.get("op")
            changed.append(f"{atcf} {s['name']}: +{len(add)} NHC points after {last}")
        else:                                              # not in IBTrACS yet
            sid = sid_for(P[0], year)
            rows = []; prev = None
            for p in P:
                rows.append(row(F, p, prev)); prev = p
            basins[basin][sid] = rows
            s = {"sid": sid, "name": name or "UNNAMED", "year": int(P[0]["t"][:4]), "basin": basin, "atcf": atcf,
                 "t0": int(P[0]["t"][:8]), "t1": int(P[-1]["t"][:8]), "n_ibtracs": 0, "op": P[-1]["t"]}
            idx["storms"].append(s); by_atcf[atcf] = s
            changed.append(f"{atcf} {s['name']}: new storm, {len(rows)} NHC points")
        if s.get("op") and (op_latest is None or s["op"] > op_latest):
            op_latest = s["op"]
    for c in changed:
        print("  " + c)
    if not changed:
        print("  no operational updates"); return
    if op_latest:
        idx["meta"]["op_through"] = op_latest
    if dry:
        print("  (dry run: nothing written)"); return
    for b, d in basins.items():
        with open(os.path.join(HERE, "data", f"basin_{b}.json"), "w") as f:
            json.dump(d, f, separators=(",", ":"))
    with open(os.path.join(HERE, "data", "index.json"), "w") as f:
        json.dump(idx, f, separators=(",", ":"))
    print(f"  wrote data/ (operational through {op_latest})")


if __name__ == "__main__":
    main()
