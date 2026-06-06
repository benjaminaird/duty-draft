# DutyDraft Automated Test Drive

Generated: 2026-06-06T19:19:18.373Z

## Scope

- Current run: 12-month simulation using the safe test server
- Production scheduling, PDF formatting, UI behavior, and live database behavior were not modified

## Server Check

- Test mode: ON
- Test API: http://127.0.0.1:3999
- Health response: {"ok":true,"phase":"setup","draftLive":false,"ts":1780773557478}
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
- Fairness balancing preserved: YES, weekendBurden history is carried into count-based selectWeekendMarines().
- Weekend selector priority count-based: YES
- Voluntary weekend picks counted as weekend burden history: YES
- Voluntary weekend picks free only same-group selected Marines: YES
- User warning for voluntary weekend selections: PRESENT
- Volunteering for a weekend reduces future required weekend priority: YES
- Each month starts from scratch: NO
- Previous framework gap: runMultipleMonths() called runOneMonth() repeatedly, and runOneMonth() reseeded state each time instead of advancing through /api/next-month.
- Minimum framework fix applied: month 1 seeds the safe test roster, months 2-12 call /api/next-month before setup, and the test helper's previous-month consecutive-day check now matches the server rule.

## History Carry-Forward Evidence

- July 2026: prior weekendBurden counts junior=0, ssgt=0, gysgt=0
- August 2026: prior weekendBurden counts junior=5, ssgt=2, gysgt=1
- September 2026: prior weekendBurden counts junior=10, ssgt=5, gysgt=3
- October 2026: prior weekendBurden counts junior=15, ssgt=7, gysgt=4
- November 2026: prior weekendBurden counts junior=20, ssgt=9, gysgt=6
- December 2026: prior weekendBurden counts junior=25, ssgt=11, gysgt=8
- January 2027: prior weekendBurden counts junior=30, ssgt=13, gysgt=9
- February 2027: prior weekendBurden counts junior=36, ssgt=16, gysgt=10
- March 2027: prior weekendBurden counts junior=41, ssgt=18, gysgt=11
- April 2027: prior weekendBurden counts junior=46, ssgt=20, gysgt=12
- May 2027: prior weekendBurden counts junior=51, ssgt=22, gysgt=13
- June 2027: prior weekendBurden counts junior=56, ssgt=25, gysgt=15

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
- Required weekend fairness: PASS
- Voluntary weekend selections allowed: PASS
- User warning for voluntary weekend selections: PRESENT
- Final served equality within weekend spread <= 1: REVIEW
- Final served equality cause: Voluntary weekend selections can add served weekend burden to one Marine while freeing another same-group selected Marine.

## Annual Rank-Group Weekend Statistics

| Group | Weekend totals | Expected % | Actual % | Variance | Min | Max | Spread | Average | Result |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Junior Marines (E1-E5) | 61 | 60.0% | 58.7% | -1.3 pts | 5 | 6 | 1 | 5.55 | PASS |
| SSgt (E6) | 27 | 25.0% | 26.0% | +1.0 pts | 4 | 6 | 2 | 4.50 | REVIEW |
| GySgt (E7) | 16 | 15.0% | 15.4% | +0.4 pts | 5 | 6 | 1 | 5.33 | PASS |

## Weekend Selector Diagnostics

- Selector priority rule: served weekend count first, recency/order only as a tiebreaker.
- Is weekend selector priority count-based? YES

| Group | Required selected min | Required selected max | Required selected spread | Actual min | Actual max | Actual spread |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Junior Marines (E1-E5) | 5 | 7 | 2 | 5 | 6 | 1 |
| SSgt (E6) | 2 | 6 | 4 | 4 | 6 | 2 |
| GySgt (E7) | 4 | 5 | 1 | 5 | 6 | 1 |

### Count-Based Priority Audit

| Month | Group | Selected | Selected served-count min | Selected served-count max | Lowest unselected served-count | Count priority honored |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| July 2026 | Junior Marines (E1-E5) | 5 | 0 | 0 | 0 | PASS |
| July 2026 | SSgt (E6) | 2 | 0 | 0 | 0 | PASS |
| July 2026 | GySgt (E7) | 1 | 0 | 0 | 0 | PASS |
| August 2026 | Junior Marines (E1-E5) | 6 | 0 | 0 | 1 | PASS |
| August 2026 | SSgt (E6) | 3 | 0 | 0 | 0 | PASS |
| August 2026 | GySgt (E7) | 1 | 0 | 0 | 0 | PASS |
| September 2026 | Junior Marines (E1-E5) | 5 | 0 | 1 | 1 | PASS |
| September 2026 | SSgt (E6) | 2 | 0 | 1 | 1 | PASS |
| September 2026 | GySgt (E7) | 1 | 1 | 1 | 1 | PASS |
| October 2026 | Junior Marines (E1-E5) | 5 | 1 | 1 | 1 | PASS |
| October 2026 | SSgt (E6) | 2 | 0 | 1 | 1 | PASS |
| October 2026 | GySgt (E7) | 2 | 1 | 1 | 2 | PASS |
| November 2026 | Junior Marines (E1-E5) | 5 | 1 | 2 | 2 | PASS |
| November 2026 | SSgt (E6) | 2 | 1 | 1 | 1 | PASS |
| November 2026 | GySgt (E7) | 2 | 2 | 2 | 2 | PASS |
| December 2026 | Junior Marines (E1-E5) | 5 | 2 | 2 | 2 | PASS |
| December 2026 | SSgt (E6) | 2 | 1 | 2 | 2 | PASS |
| December 2026 | GySgt (E7) | 1 | 2 | 2 | 3 | PASS |
| January 2027 | Junior Marines (E1-E5) | 6 | 2 | 3 | 3 | PASS |
| January 2027 | SSgt (E6) | 3 | 2 | 2 | 2 | PASS |
| January 2027 | GySgt (E7) | 1 | 3 | 3 | 3 | PASS |
| February 2027 | Junior Marines (E1-E5) | 5 | 3 | 3 | 3 | PASS |
| February 2027 | SSgt (E6) | 2 | 2 | 2 | 3 | PASS |
| February 2027 | GySgt (E7) | 1 | 3 | 3 | 3 | PASS |
| March 2027 | Junior Marines (E1-E5) | 5 | 3 | 4 | 4 | PASS |
| March 2027 | SSgt (E6) | 2 | 2 | 3 | 3 | PASS |
| March 2027 | GySgt (E7) | 1 | 3 | 3 | 4 | PASS |
| April 2027 | Junior Marines (E1-E5) | 5 | 4 | 4 | 4 | PASS |
| April 2027 | SSgt (E6) | 2 | 3 | 3 | 3 | PASS |
| April 2027 | GySgt (E7) | 1 | 3 | 3 | 4 | PASS |
| May 2027 | Junior Marines (E1-E5) | 6 | 4 | 5 | 5 | PASS |
| May 2027 | SSgt (E6) | 3 | 3 | 3 | 4 | PASS |
| May 2027 | GySgt (E7) | 1 | 4 | 4 | 4 | PASS |
| June 2027 | Junior Marines (E1-E5) | 5 | 4 | 5 | 5 | PASS |
| June 2027 | SSgt (E6) | 2 | 4 | 4 | 4 | PASS |
| June 2027 | GySgt (E7) | 1 | 5 | 5 | 5 | PASS |

## Same-Group Voluntary Weekend Credit Audit

- Voluntary weekend picks observed: 9
- Same-group selected assignees freed by voluntary picks: 7
- Voluntary picks with no same-group selected assignee available to free: 2
- Cross-group frees in voluntary pick responses: 0
- Did voluntary weekend picks free only same-group selected Marines? YES

| Month | Volunteer | Volunteer group | Same-group assignee freed | Cross-group frees | Result |
| --- | --- | --- | --- | ---: | --- |
| July 2026 | SGT SWAYZE | junior | LCPL PHANTOM | 0 | PASS |
| August 2026 | GYSGT MYRTLE | gysgt | None available | 0 | PASS |
| September 2026 | SSGT BEETLEJUICE | ssgt | SSGT BOLEYN | 0 | PASS |
| December 2026 | SSGT ZERO | ssgt | SSGT BEETLEJUICE | 0 | PASS |
| February 2027 | SSGT ZERO | ssgt | SSGT HORSEMAN | 0 | PASS |
| March 2027 | GYSGT CASPER | gysgt | GYSGT MYRTLE | 0 | PASS |
| March 2027 | SSGT ZERO | ssgt | SSGT BLACKBEARD | 0 | PASS |
| May 2027 | GYSGT MYRTLE | gysgt | None available | 0 | PASS |
| June 2027 | SSGT ZERO | ssgt | SSGT BLACKBEARD | 0 | PASS |

## Weekend History Accounting Audit

- Production rollover code path: /api/next-month copies final assignments into allAsgn, then pushes every isWkDate(day, appState) assignment into history.weekendBurden for that Marine's burden group.
- Audit method: for each simulated month, compare final weekend assignment IDs against the next month's history.weekendBurden delta. The 12th month is verified by one final safe-mode /api/next-month rollover after the 12 simulated drafts.
- Are voluntary weekend picks counted as weekend burden? YES

| Month | Group | Required selected | Voluntary weekend picks | Final weekend assignments | History delta | Counted in history |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| July 2026 | Junior Marines (E1-E5) | 5 | 1 | 5 | 5 | PASS |
| July 2026 | SSgt (E6) | 2 | 0 | 2 | 2 | PASS |
| July 2026 | GySgt (E7) | 1 | 0 | 1 | 1 | PASS |
| August 2026 | Junior Marines (E1-E5) | 6 | 0 | 5 | 5 | PASS |
| August 2026 | SSgt (E6) | 3 | 0 | 3 | 3 | PASS |
| August 2026 | GySgt (E7) | 1 | 1 | 2 | 2 | PASS |
| September 2026 | Junior Marines (E1-E5) | 5 | 0 | 5 | 5 | PASS |
| September 2026 | SSgt (E6) | 2 | 1 | 2 | 2 | PASS |
| September 2026 | GySgt (E7) | 1 | 0 | 1 | 1 | PASS |
| October 2026 | Junior Marines (E1-E5) | 5 | 0 | 5 | 5 | PASS |
| October 2026 | SSgt (E6) | 2 | 0 | 2 | 2 | PASS |
| October 2026 | GySgt (E7) | 2 | 0 | 2 | 2 | PASS |
| November 2026 | Junior Marines (E1-E5) | 5 | 0 | 5 | 5 | PASS |
| November 2026 | SSgt (E6) | 2 | 0 | 2 | 2 | PASS |
| November 2026 | GySgt (E7) | 2 | 0 | 2 | 2 | PASS |
| December 2026 | Junior Marines (E1-E5) | 5 | 0 | 5 | 5 | PASS |
| December 2026 | SSgt (E6) | 2 | 1 | 2 | 2 | PASS |
| December 2026 | GySgt (E7) | 1 | 0 | 1 | 1 | PASS |
| January 2027 | Junior Marines (E1-E5) | 6 | 0 | 6 | 6 | PASS |
| January 2027 | SSgt (E6) | 3 | 0 | 3 | 3 | PASS |
| January 2027 | GySgt (E7) | 1 | 0 | 1 | 1 | PASS |
| February 2027 | Junior Marines (E1-E5) | 5 | 0 | 5 | 5 | PASS |
| February 2027 | SSgt (E6) | 2 | 1 | 2 | 2 | PASS |
| February 2027 | GySgt (E7) | 1 | 0 | 1 | 1 | PASS |
| March 2027 | Junior Marines (E1-E5) | 5 | 0 | 5 | 5 | PASS |
| March 2027 | SSgt (E6) | 2 | 1 | 2 | 2 | PASS |
| March 2027 | GySgt (E7) | 1 | 1 | 1 | 1 | PASS |
| April 2027 | Junior Marines (E1-E5) | 5 | 0 | 5 | 5 | PASS |
| April 2027 | SSgt (E6) | 2 | 0 | 2 | 2 | PASS |
| April 2027 | GySgt (E7) | 1 | 0 | 1 | 1 | PASS |
| May 2027 | Junior Marines (E1-E5) | 6 | 0 | 5 | 5 | PASS |
| May 2027 | SSgt (E6) | 3 | 0 | 3 | 3 | PASS |
| May 2027 | GySgt (E7) | 1 | 1 | 2 | 2 | PASS |
| June 2027 | Junior Marines (E1-E5) | 5 | 0 | 5 | 5 | PASS |
| June 2027 | SSgt (E6) | 2 | 1 | 2 | 2 | PASS |
| June 2027 | GySgt (E7) | 1 | 0 | 1 | 1 | PASS |

## SSgt Spread Diagnosis

- Diagnosis: Final served weekend spread remains high after count-based required selection.
- SSgt selected weekend-obligation spread: 4
- SSgt actual weekend-duty spread: 2
- Selected SSgt weekend obligations that failed to pick a weekend: 0
- SSgt double-duty months: 0
- SSgt approved weekend non-availability constraints: 0
- Consecutive-day rule impact: no selected SSgt weekend obligation failed to land on a weekend, so there is no evidence that consecutive-day blocking caused the SSgt spread.
- SSgt actual weekend picks from preferences: 5
- SSgt actual weekend picks from simulator fallback: 22
- SSgt voluntary weekend picks while not selected for weekend obligation: 5
- SSgt selected weekend turns freed before pick by another Marine's voluntary weekend: 5
- Did annual final SSgt weekend spread improve after the count-based selector change? YES; previous baseline spread was 3, current spread is 2.
- Interpretation: double-duty, approved N/A, and consecutive-day blocking did not drive the SSgt spread in this run. The selector now uses served weekend counts first and honors that priority each month, and production history accounting counts final weekend assignments including voluntary picks. The spread remains because actual draft choices can add weekend duty to one Marine while voluntary weekend picks can free another selected Marine before they serve one.
- Does final annual spread become fair once voluntary weekends are counted? NO; voluntary weekends are already counted in final annual burden, and SSgt final spread remains 2.
- Final served equality status: REVIEW. Cause: Voluntary weekend selections can add served weekend burden to one Marine while freeing another same-group selected Marine.
- Did voluntary weekend picks free only same-group selected Marines? YES.

| SSgt | Selected weekend obligations | Actual weekend duties | Delta | Preference weekends | Fallback weekends | Voluntary weekends | Freed selected turns | Double-duty months | Approved weekend NA |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SSGT ZERO | 2 | 6 | +4 | 5 | 1 | 4 | 0 | 0 | 0 |
| SSGT BLACKBEARD | 6 | 4 | -2 | 0 | 4 | 0 | 2 | 0 | 0 |
| SSGT MARLEY | 5 | 5 | +0 | 0 | 5 | 0 | 0 | 0 | 0 |
| SSGT BEETLEJUICE | 4 | 4 | +0 | 0 | 4 | 1 | 1 | 0 | 0 |
| SSGT HORSEMAN | 5 | 4 | -1 | 0 | 4 | 0 | 1 | 0 | 0 |
| SSGT BOLEYN | 5 | 4 | -1 | 0 | 4 | 0 | 1 | 0 | 0 |

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
- SSGT MARLEY: 24 total, 5 weekend
- SSGT BEETLEJUICE: 24 total, 4 weekend
- SSGT HORSEMAN: 24 total, 4 weekend
- SSGT BOLEYN: 23 total, 4 weekend
- SGT BARON: 23 total, 6 weekend
- SGT BINNS: 19 total, 6 weekend
- SGT SWAYZE: 12 total, 6 weekend
- CPL WILLIS: 12 total, 6 weekend
- CPL CRANE: 12 total, 6 weekend
- CPL BANQUO: 12 total, 5 weekend
- LCPL PHANTOM: 12 total, 5 weekend
- LCPL BLINKY: 12 total, 6 weekend
- LCPL INKY: 12 total, 5 weekend
- LCPL CLYDE: 12 total, 5 weekend
- LCPL HAMLET: 12 total, 5 weekend

## Conclusion

- Required fairness: PASS
- Final served equality: REVIEW
- Cause: Voluntary weekend selections can add served weekend burden to one Marine while freeing another same-group selected Marine.
- Is the required weekend selector count-priority fair? YES
- Voluntary weekend selections allowed? YES
- User warning for voluntary weekend selections: PRESENT
- Are voluntary weekend picks counted as weekend burden? YES
- Did voluntary weekend picks free only same-group selected Marines? YES
- Does volunteering for a weekend reduce future required weekend priority? YES
- Did annual final weekend spread improve after the change? YES; SSgt spread is 2 versus prior baseline 3.
- Does final annual spread become fair once voluntary weekends are counted? NO
- Why is final served equality under review? SSgt selector priority is count-based, but final served weekend burden remains spread 2 because voluntary/fallback weekend choices can add weekend burden to one Marine and free another selected Marine before they serve one.
- Fairness criteria: all drafts complete, all duty and weekend days assigned, approved N/A protected, rank-group weekend variance within 5 percentage points, and within-group weekend spread <= 1.
- Month helper loaded: January through December

Status: test server completed the annual automated test drive in safe test mode without touching the live database.