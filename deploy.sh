#!/usr/bin/env bash
#
# deploy.sh — publish tcviewer.org to GitHub Pages.
#
# tcviewer.org is served by GitHub Pages from this repo (github.com/drchavas/tcviewer),
# so "deploying" just means committing whatever changed and pushing. This script stages
# everything, writes a commit message for you (from the files that changed), and pushes;
# GitHub Pages then redeploys the site in a minute or two.
#
# Usage:
#   ./deploy.sh                 Commit & push whatever changed (auto commit message)
#   ./deploy.sh -m "message"    …but use your own commit message
#   ./deploy.sh --data          Refresh IBTrACS data first (download + rebuild data/),
#                               then commit & push everything
#   ./deploy.sh --dry-run       Show what would be committed; don't touch git
#
set -euo pipefail
cd "$(dirname "$0")"

MSG=""
DATA=0
DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    -m|--message) MSG="${2:-}"; shift 2 ;;
    --data)       DATA=1; shift ;;
    --dry-run)    DRY=1; shift ;;
    -h|--help)    awk 'NR>1{ if($0 ~ /^#/){ s=$0; sub(/^# ?/,"",s); print s } else exit }' "$0"; exit 0 ;;
    *) echo "Unknown option: $1 (try --help)"; exit 2 ;;
  esac
done

# Optional: refresh the IBTrACS data and rebuild data/ before publishing.
if [ "$DATA" -eq 1 ]; then
  CSV="ibtracs.ALL.list.v04r01.csv"; MAXAGE_HOURS=12; need_dl=1
  if [ -f "$CSV" ]; then
    age=$(( $(date +%s) - $(stat -f %m "$CSV") ))     # macOS/BSD stat
    [ "$age" -lt $(( MAXAGE_HOURS * 3600 )) ] && need_dl=0
  fi
  if [ "$need_dl" -eq 1 ]; then
    echo "→ downloading latest IBTrACS CSV + rebuilding data/…"
    python3 process_storms.py --update
  else
    echo "→ IBTrACS CSV is <${MAXAGE_HOURS}h old; rebuilding data/ from it…"
    python3 process_storms.py
  fi
fi

# Anything to publish?
if [ -z "$(git status --porcelain)" ]; then
  echo "✓ Nothing changed — tcviewer.org is already up to date."
  exit 0
fi

echo "Changes to publish:"
git -c color.status=always status -s | sed 's/^/  /'

if [ "$DRY" -eq 1 ]; then
  echo "(dry run — nothing was committed or pushed)"
  exit 0
fi

git add -A

# Auto commit message from the changed top-level paths, unless one was given.
if [ -z "$MSG" ]; then
  changed=$(git diff --cached --name-only | awk -F/ '{print $1}' | sort -u | paste -sd ', ' -)
  n=$(git diff --cached --name-only | wc -l | tr -d ' ')
  MSG="Update ${changed} (${n} file$([ "$n" -ne 1 ] && echo s)) — $(date -u '+%Y-%m-%d %H:%M UTC')"
fi

git commit -m "$MSG"
git push
echo "✓ Pushed: \"$MSG\""
echo "  GitHub Pages will redeploy — live shortly at https://tcviewer.org/"
