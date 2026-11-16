# Extended Best Track (EBTRK) — wind radii, Rmax and outer closed isobar for NHC storms

Downloaded 2026-11-14 from CIRA/RAMMB:
https://rammb2.cira.colostate.edu/research/tropical-cyclones/tc_extended_best_track_dataset/
(version 3.0.2, Oct 2022; covers through the 2021 season). "New format" files, gzipped here,
otherwise unchanged:

| file (gzipped) | md5 of the original .txt |
|---|---|
| EBTRK_AL_final_1851-2021_new_format_02-Sep-2022-1.txt | 71b70f17fb70962a390f70dbd6d60697 |
| EBTRK_EP_final_1949-2021_new_format_02-Sep-2022.txt   | c659acba56ee32205fd12510a7292012 |
| EBTRK_CP_final_1950-2021_new_format_02-Sep-2022-1.txt | b9de9b8600989afdf677688f416aaa23 |
| EBTRK_README_v3.0.2_16-Oct-2022.txt (format + history) | 6b6301ed9c963f8872de23d6c080ff72 |

Cite as: Demuth, J., M. DeMaria, and J. A. Knaff, 2006: Improvement of advanced microwave
sounder unit tropical cyclone intensity and size estimation algorithms. J. Appl. Meteor., 45,
1573–1581.

How tcviewer uses it (process_storms.py, "Extended Best Track" block):
- Only 1988–2003. From 2004 IBTrACS/HURDAT2 already carries NHC's post-season best-track radii;
  before 1988 the file's radii are all-zero placeholders, not estimates.
- Pre-2004 values are NHC's REAL-TIME OPERATIONAL estimates (not post-season analyses). Each point
  that receives any of them gets `ebt` = 1 and the page labels it.
- Matched to IBTrACS by ATCF id + synoptic time; skipped if > 1° apart (one storm, EP121989, is a
  different system in EBTRK and is skipped this way).
- Before 2004 the 34/50/64-kt radii come from EBTRK only (decided 2026-11-15). IBTrACS's 2001–03
  radii are R34-only real-time values (no R50/R64) that differ from EBTRK at ~27% of shared 6-hourly
  times (only 16 of 87 storms identical), so mixing would make storms inconsistent and drop the
  hurricane-force radii. IBTrACS points with radii but no EBTRK match (mostly 3-hourly) lose them.
- Rmax / POCI / ROCI keep IBTrACS where present (identical to EBTRK at all 1,223 shared 2001–03 times)
  and are filled from EBTRK where missing.
- Atlantic radii start 1988 (1988–89 only where aircraft data existed); E/C Pacific radii start 1990.
