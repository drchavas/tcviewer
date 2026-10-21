"""One-off helper: add Mooney et al. (2026) normalized damage to already-built impacts/data without a full rebuild.
Uses the same load_mooney()/damage_norm_for() as build_impacts.py (extracted from it, stdlib only).
    python3 impacts/sources/mooney2026/apply_to_built_data.py"""
import os, re, sys, json, glob
R = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
src = open(os.path.join(R, "build_impacts.py")).read()
code = src[src.index("MOONEY_DIR = "):src.index("def load_klotzbach")]
g = {"os": os, "re": re, "HERE": R, "log": lambda *a: print(*a, file=sys.stderr)}
exec(code, g)
MOO = g["load_mooney"]()
D = os.path.join(R, "impacts", "data"); ip = os.path.join(D, "index.json"); idx = json.load(open(ip))
I = {s["slug"]: s for s in idx["storms"]}
n = 0; src_n = {"mooney": 0, "klotzbach": 0}
for f in sorted(glob.glob(os.path.join(D, "storms", "*.json"))):
    raw = open(f).read(); d = json.loads(raw)
    m = g["damage_norm_for"](MOO, (d.get("atcf") or "").upper(), d.get("name"), d.get("year"), d.get("landfall_table") or [])
    d["damage_norm"] = m
    if m: src_n[m["src"]] += 1
    out = json.dumps(d, separators=(",", ":"), allow_nan=False)
    if out != raw:
        open(f, "w").write(out); n += 1
    if d["slug"] in I: I[d["slug"]]["dmg_norm"] = m["total"] if m else None
json.dump(idx, open(ip, "w"), separators=(",", ":"), allow_nan=False)
print(f"{n} storm files updated; normalized damage from Mooney et al.: {src_n['mooney']}, Klotzbach et al. (2024 $): {src_n['klotzbach']}")
