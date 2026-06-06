# DutyDraft Automated Test Drive

Generated: 2026-06-06T17:57:47.292Z

## Scope

- Current run: 12-month simulation using the safe test server
- Production scheduling, PDF formatting, UI behavior, and live database behavior were not modified

## Server Check

- Test mode: ON
- Test API: http://127.0.0.1:3999
- Health response: {"ok":true,"phase":"setup","draftLive":false,"ts":1780768666275}
- Simulated Marines loaded: 20
- Months simulated: 12
- App state seeded with simulated roster: 20 Marines
- Starting test month: July 2026
- Weekend-style dates detected: 4, 5, 11, 12, 18, 19, 25, 26
- Weekend-style date count: 8
- Expected weekend ratio: E5/below 5, E6 2, E7 1
- Selected E5/below Marines: LCPL PHANTOM, LCPL BLINKY, LCPL INKY, LCPL CLYDE, LCPL HAMLET
- Selected E6 Marines: SSGT ZERO, SSGT BLACKBEARD
- Selected E7 Marines: GYSGT CASPER
- Weekend assignee IDs stored: m16, m17, m18, m19, m20, m4, m5, m1
- Persisted setup phase: review
- Persisted weekend dates: 4, 5, 11, 12, 18, 19, 25, 26
- Simulated preference submissions: 5
- Simulated non-availability submissions: 3
- Review phase reached: review
- Draft order generated: 20 turns
- Draft started: phase draft, live true
- Simulated draft picks submitted: 20
- Draft complete: true
- Final assigned duty days: 31
- Final weekend duty days assigned: 8

## Critical Finding

- Are we actually simulating a year, or one month twelve times? A year.
- Distinct months simulated: 12/12
- Months simulated: July 2026, August 2026, September 2026, October 2026, November 2026, December 2026, January 2027, February 2027, March 2027, April 2027, May 2027, June 2027
- Month rollover loop: ACTIVE via /api/next-month
- Weekend history preserved before months 2-12: YES
- Fairness balancing preserved: YES, weekendBurden history is carried into selectWeekendMarines().
- Each month starts from scratch: NO
- Previous framework gap: runMultipleMonths() called runOneMonth() repeatedly, and runOneMonth() reseeded state each time instead of advancing through /api/next-month.
- Minimum framework fix applied: month 1 seeds the safe test roster, months 2-12 call /api/next-month before setup, and the test helper's previous-month consecutive-day check now matches the server rule.

## History Carry-Forward Evidence

- July 2026: prior weekendBurden counts junior=0, ssgt=0, gysgt=0
- August 2026: prior weekendBurden counts junior=5, ssgt=2, gysgt=1
- September 2026: prior weekendBurden counts junior=11, ssgt=4, gysgt=3
- October 2026: prior weekendBurden counts junior=16, ssgt=6, gysgt=4
- November 2026: prior weekendBurden counts junior=21, ssgt=8, gysgt=6
- December 2026: prior weekendBurden counts junior=26, ssgt=10, gysgt=8
- January 2027: prior weekendBurden counts junior=31, ssgt=12, gysgt=9
- February 2027: prior weekendBurden counts junior=37, ssgt=15, gysgt=10
- March 2027: prior weekendBurden counts junior=42, ssgt=17, gysgt=11
- April 2027: prior weekendBurden counts junior=47, ssgt=19, gysgt=12
- May 2027: prior weekendBurden counts junior=52, ssgt=21, gysgt=13
- June 2027: prior weekendBurden counts junior=58, ssgt=23, gysgt=15

## Annual 12-Month Summary
- Months completed: 12/12 PASS
- Total duty assignments simulated: 365
- Expected duty assignments: 365
- Total weekend assignments simulated: 104
- Expected weekend assignments: 104

## Annual Validation Checks
- Did all 12 months complete successfully? PASS
- Were all duty days assigned? PASS
- Were all weekend days assigned? PASS
- Were approved non-availability requests protected? PASS
- Did weekend burden match intended rank-group ratios within 5 percentage points? PASS
- Did Marines rotate fairly within their rank groups with weekend spread <= 1? FAIL

## Annual Rank-Group Weekend Statistics

| Group | Weekend totals | Expected % | Actual % | Variance | Min | Max | Spread | Average | Result |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Junior Marines (E1-E5) | 63 | 60.0% | 60.6% | +0.6 pts | 5 | 6 | 1 | 5.73 | PASS |
| SSgt (E6) | 25 | 25.0% | 24.0% | -1.0 pts | 3 | 6 | 3 | 4.17 | FAIL |
| GySgt (E7) | 16 | 15.0% | 15.4% | +0.4 pts | 5 | 6 | 1 | 5.33 | PASS |

## Weekend Selector Diagnostics

| Group | Selected min | Selected max | Selected spread | Actual min | Actual max | Actual spread | Selector result |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Junior Marines (E1-E5) | 5 | 6 | 1 | 5 | 6 | 1 | PASS |
| SSgt (E6) | 4 | 5 | 1 | 3 | 6 | 3 | PASS |
| GySgt (E7) | 4 | 5 | 1 | 5 | 6 | 1 | PASS |

## SSgt Spread Diagnosis

- Diagnosis: Downstream draft-simulation driven after weekend selection, not a weekend-selector history failure.
- SSgt selected weekend-obligation spread: 1
- SSgt actual weekend-duty spread: 3
- Selected SSgt weekend obligations that failed to pick a weekend: 0
- SSgt double-duty months: 0
- SSgt approved weekend non-availability constraints: 0
- Consecutive-day rule impact: no selected SSgt weekend obligation failed to land on a weekend, so there is no evidence that consecutive-day blocking caused the SSgt spread.
- SSgt actual weekend picks from preferences: 5
- SSgt actual weekend picks from simulator fallback: 20
- SSgt voluntary weekend picks while not selected for weekend obligation: 3
- Interpretation: double-duty, approved N/A, and consecutive-day blocking did not drive the SSgt spread in this run. The selector used carried-forward history correctly; the spread appears after the draft simulation because preferences and fallback picks can add voluntary weekend duty beyond selected weekend obligations.

| SSgt | Selected weekend obligations | Actual weekend duties | Delta | Preference weekends | Fallback weekends | Voluntary weekends | Double-duty months | Approved weekend NA |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SSGT ZERO | 5 | 6 | +1 | 5 | 1 | 2 | 0 | 0 |
| SSGT BLACKBEARD | 5 | 4 | -1 | 0 | 4 | 0 | 0 | 0 |
| SSGT MARLEY | 5 | 3 | -2 | 0 | 3 | 0 | 0 | 0 |
| SSGT BEETLEJUICE | 4 | 5 | +1 | 0 | 5 | 1 | 0 | 0 |
| SSGT HORSEMAN | 4 | 4 | +0 | 0 | 4 | 0 | 0 | 0 |
| SSGT BOLEYN | 4 | 3 | -1 | 0 | 3 | 0 | 0 | 0 |

## Month 1 Per-Marine Assignment Summary
- GYSGT CASPER: 2 total, 1 weekend
- GYSGT SLIMER: 2 total, 0 weekend
- GYSGT MYRTLE: 2 total, 0 weekend
- SSGT ZERO: 2 total, 1 weekend
- SSGT BLACKBEARD: 2 total, 1 weekend
- SSGT MARLEY: 2 total, 0 weekend
- SSGT BEETLEJUICE: 2 total, 0 weekend
- SSGT HORSEMAN: 2 total, 0 weekend
- SSGT BOLEYN: 2 total, 0 weekend
- SGT BARON: 2 total, 0 weekend
- SGT BINNS: 2 total, 0 weekend
- SGT SWAYZE: 1 total, 1 weekend
- CPL WILLIS: 1 total, 0 weekend
- CPL CRANE: 1 total, 0 weekend
- CPL BANQUO: 1 total, 0 weekend
- LCPL PHANTOM: 1 total, 0 weekend
- LCPL BLINKY: 1 total, 1 weekend
- LCPL INKY: 1 total, 1 weekend
- LCPL CLYDE: 1 total, 1 weekend
- LCPL HAMLET: 1 total, 1 weekend

## Annual Per-Marine Assignment Summary
- GYSGT CASPER: 24 total, 6 weekend
- GYSGT SLIMER: 24 total, 5 weekend
- GYSGT MYRTLE: 24 total, 5 weekend
- SSGT ZERO: 24 total, 6 weekend
- SSGT BLACKBEARD: 24 total, 4 weekend
- SSGT MARLEY: 24 total, 3 weekend
- SSGT BEETLEJUICE: 24 total, 5 weekend
- SSGT HORSEMAN: 24 total, 4 weekend
- SSGT BOLEYN: 23 total, 3 weekend
- SGT BARON: 23 total, 6 weekend
- SGT BINNS: 19 total, 6 weekend
- SGT SWAYZE: 12 total, 6 weekend
- CPL WILLIS: 12 total, 6 weekend
- CPL CRANE: 12 total, 6 weekend
- CPL BANQUO: 12 total, 5 weekend
- LCPL PHANTOM: 12 total, 6 weekend
- LCPL BLINKY: 12 total, 5 weekend
- LCPL INKY: 12 total, 6 weekend
- LCPL CLYDE: 12 total, 6 weekend
- LCPL HAMLET: 12 total, 5 weekend

## Conclusion

- Is the existing scheduling algorithm fair over a full year? FAIL
- Fairness criteria: all drafts complete, all duty and weekend days assigned, approved N/A protected, rank-group weekend variance within 5 percentage points, and within-group weekend spread <= 1.
- Month helper loaded: January through December

Status: test server completed the annual automated test drive in safe test mode without touching the live database.