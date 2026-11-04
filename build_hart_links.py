#!/usr/bin/env python3
"""build_hart_links.py — links from tcviewer storms to Bob Hart's own phase-space diagrams.

Hart's FSU archive (https://moe.met.fsu.edu/cyclonephase/archive/) has one page per year/decade
listing a curated set of cyclones, each with full-track PNG diagrams ("a" = B vs -VTL,
"b" = -VTU vs -VTL) from one or more analyses (GFS/AVN, ERA5, ECMWF, NCEP, ...). This script reads
those pages, matches each cyclone to a tcviewer storm by year + name (fuzzy spelling;
ocean to break ties) and writes data/hart_links.json:
    {sid: {"src": analysis, "a": url, "b": url}}
cps.js shows these as "Hart's own diagrams for this storm". Non-tropical cases (nor'easters,
"Superstorm 1993", ...) have no tcviewer storm and are skipped.
Names come from the directory names (e.g. gifs/katrina2005/).

The FSU server sends only its leaf TLS certificate, so pass a CA bundle that also contains the
Sectigo intermediate (http://crt.sectigo.com/SectigoPublicServerAuthenticationCAOVR36.crt):
    python3 build_hart_links.py --cacert bundle.pem
Static: rerun when Hart adds a year.
"""
import os, re, sys, json, ssl, difflib, urllib.request

BASE = "https://moe.met.fsu.edu/cyclonephase/archive/"
HERE = os.path.dirname(os.path.abspath(__file__))
PERIODS = [""] + ["1950s", "1960s", "1970s", "1980s", "1990s"] + [str(y) for y in range(1997, 2021)]
PREF = ["era5", "gfs", "avn", "ec", "ncep", "erai", "merra", "cmc", "ngp", "ukm", "jma"]
OCEAN = {"south atlantic": "SA", "south pacific": "SP", "atlantic": "NA", "gulf": "NA", "east pacific": "EP", "eastern pacific": "EP", "central pacific": "EP",
         "west pacific": "WP", "western pacific": "WP", "south pacific": "SP"}
norm = lambda s: re.sub(r"[^a-z]", "", s.lower())

def get(url, ctx):
    req = urllib.request.Request(url, headers={"User-Agent": "tcviewer-hart-links/1.0"})
    with urllib.request.urlopen(req, timeout=60, context=ctx) as f: return f.read().decode("latin-1")

def rows(ctx):
    """One entry per diagram directory (e.g. gifs/katrina2005/). The archive's HTML tables are not
    always well formed (one <tr> can hold several storms), so the storm name and year come from the
    directory name, and the table row only supplies the ocean (for ties)."""
    by = {}
    for p in PERIODS:
        s = get(BASE + (p + "/" if p else ""), ctx)
        for tr in re.split(r"(?i)<tr", s)[1:]:
            cells = re.split(r"(?i)<td", tr)[1:]
            ocean = re.sub(r"<[^>]*>", " ", "<" + cells[3]).strip() if len(cells) > 3 else ""
            for l in re.findall(r"(?i)href=[\"']?([^ \"'>]*gifs/[^ \"'>]*)", tr):
                m = re.search(r"gifs/([a-z_-]+?)(\d{4})/", l, re.I)
                if not m: continue
                e = by.setdefault(m.group(1).lower() + m.group(2), {"name": m.group(1), "year": m.group(2), "ocean": ocean, "links": []})
                e["links"].append(l)
    return by.values()

def main():
    ctx = ssl.create_default_context()
    if "--cacert" in sys.argv: ctx = ssl.create_default_context(cafile=sys.argv[sys.argv.index("--cacert") + 1])
    idx = json.load(open(os.path.join(HERE, "data", "index.json")))["storms"]
    out, miss = {}, []
    for r in rows(ctx):
        ys = re.findall(r"\d{4}", r["year"])
        if not ys: continue
        y = int(ys[0]); nm = norm(r["name"])
        if len(nm) < 3: miss.append((y, r["name"])); continue
        cands = [s for s in idx if s["year"] == y and norm(s["name"]) == nm]
        if not cands:   # spelling variants (Phillipe/Philippe)
            cands = [s for s in idx if s["year"] == y and difflib.SequenceMatcher(None, norm(s["name"]), nm).ratio() >= 0.85]
        if len(cands) > 1:
            b = next((v for k, v in OCEAN.items() if k in r["ocean"].lower()), None)
            cands = [s for s in cands if s["basin"] == b] or cands
        if not cands: miss.append((y, r["name"])); continue
        L = r["links"]; pick = None
        for src in PREF:
            a = [l for l in L if f".a.{src}." in l and l.endswith(".png")]
            b = [l for l in L if f".b.{src}." in l and l.endswith(".png")]
            if a: pick = (src, a[0], b[0] if b else None); break
        if not pick: continue
        https = lambda u: u and u.replace("http://", "https://")
        out[cands[0]["sid"]] = {"src": pick[0], "a": https(pick[1]), "b": https(pick[2])}
    p = os.path.join(HERE, "data", "hart_links.json")
    json.dump(out, open(p, "w"), separators=(",", ":"), sort_keys=True)
    print(f"wrote {p}: {len(out)} storms; not matched ({len(miss)}): {miss}")

if __name__ == "__main__":
    main()
