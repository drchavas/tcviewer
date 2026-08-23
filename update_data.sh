#!/usr/bin/env bash
# Refresh IBTrACS data and rebuild data/*.json in this folder, then commit & push so
# GitHub Pages redeploys. Only re-downloads the ~330 MB CSV when the local copy is
# missing or older than MAXAGE_HOURS; otherwise it just rebuilds.
set -euo pipefail
cd "$(dirname "$0")"

CSV="ibtracs.ALL.list.v04r01.csv"
MAXAGE_HOURS=12

need_dl=1
if [ -f "$CSV" ]; then
  age=$(( $(date +%s) - $(stat -f %m "$CSV") ))     # macOS/BSD stat
  [ "$age" -lt $(( MAXAGE_HOURS * 3600 )) ] && need_dl=0
fi

if [ "$need_dl" -eq 1 ]; then
  echo "  → downloading latest IBTrACS CSV + rebuilding data/"
  python3 process_storms.py --update
else
  echo "  → IBTrACS CSV is <${MAXAGE_HOURS}h old; rebuilding data/ from it"
  python3 process_storms.py
fi

# publish to GitHub Pages if anything changed
if [ -n "$(git status --porcelain data 2>/dev/null)" ]; then
  git add -A data
  git commit -m "data refresh $(date -u '+%Y-%m-%d %H:%M UTC')"
  git push
  echo "  → pushed updated data to GitHub (Pages will redeploy)"
else
  echo "  → data unchanged; nothing to push"
fi
