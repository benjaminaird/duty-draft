#!/usr/bin/env node
// Renders scripts/coa-brief-data.json into a print-ready HTML brief
// (DutyDraft-COA-Brief.html). Convert to PDF with Chrome headless:
//   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
//     --headless --disable-gpu --no-pdf-header-footer \
//     --print-to-pdf="DutyDraft-COA-Brief.pdf" "file://.../DutyDraft-COA-Brief.html"
// (scripts/make-coa-brief.sh does both steps.)

const fs = require('fs');
const path = require('path');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'coa-brief-data.json'), 'utf8'));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const luckRows = [
  ['COA 1 — Weighted Seniority', data.luck.c1, 'Every pick traceable to rank + earned burden. No chance.'],
  ['COA 3 — Hybrid', data.luck.c3, 'Bounded chance: only the top five slots are a draw.'],
  ['COA 2 — Weighted Lottery', data.luck.c2, 'Roughly ' + Math.round(data.luck.c2) + ' positions of pure chance layered on top of the rules.'],
].map(([n, v, m]) => `<tr><td>${esc(n)}</td><td class="num ${v === 0 ? 'good' : v < 4 ? 'warn' : 'bad'}">${v} ${v === 1 ? 'spot' : 'spots'}</td><td>${esc(m)}</td></tr>`).join('');

const ddRows = data.ddRotation.map((r) => `<tr><td>${esc(r.month)}</td><td>${esc(r.marines)}</td></tr>`).join('');

const perMarineRows = data.perMarine.map((r) => `<tr><td class="c">${r.sen}</td><td>${esc(r.name)}</td><td class="num">${esc(r.c1)}</td><td class="num">${esc(r.c2)}</td><td class="num">${esc(r.c3)}</td><td class="c">${r.weekends}</td></tr>`).join('');

const oneMonthRows = data.oneMonth.rows.map((r) => `<tr><td class="c">${r.pick}</td><td>${esc(r.c1)}</td><td>${esc(r.c2)}</td><td>${esc(r.c3)}</td></tr>`).join('');

const ex = data.example;
const exC1 = ex.c1.join(', ');
const exC2 = ex.c2.join(', ');

const scorecard = [
  ['Every pick explainable to the Marine', 'Yes', 'No — “the draw”', 'Mostly'],
  ['Seniority respected', 'Yes', 'Odds only', 'Yes'],
  ['Recent burden compensated', 'Yes', 'Odds only', 'Yes'],
  ['Outcome decided by chance', 'No', `Yes (~${Math.round(data.luck.c2)} spots)`, 'Top 5 only'],
  ['A Marine can land at the bottom repeatedly by luck', 'No', 'Yes', 'Only near the top'],
].map((r) => `<tr><td>${esc(r[0])}</td><td class="c">${esc(r[1])}</td><td class="c bad-cell">${esc(r[2])}</td><td class="c">${esc(r[3])}</td></tr>`).join('');

const html = `<!doctype html><html><head><meta charset="utf-8"><title>DutyDraft COA Brief</title>
<style>
@page { size: Letter; margin: 0.7in 0.75in; }
* { box-sizing: border-box; }
body { font-family: Georgia, 'Times New Roman', serif; color: #1a1a1a; font-size: 10.5pt; line-height: 1.45; margin: 0; }
h1 { font-size: 19pt; margin: 0 0 2px; letter-spacing: .3px; }
h2 { font-size: 13pt; margin: 22px 0 6px; padding-bottom: 3px; border-bottom: 2px solid #2c3e50; color: #2c3e50; }
h2.first { margin-top: 8px; }
.sub { color: #555; font-size: 9.5pt; }
.meta { color:#555; font-size: 9pt; margin-top: 4px; }
.rule { height:3px; background:#8a6d3b; margin:10px 0 4px; }
p { margin: 6px 0; }
ul { margin: 6px 0 6px 18px; padding: 0; }
li { margin: 2px 0; }
table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 9.5pt; }
th, td { border: 1px solid #cfcfcf; padding: 4px 7px; text-align: left; vertical-align: top; }
th { background: #2c3e50; color: #fff; font-family: Helvetica, Arial, sans-serif; font-size: 8.5pt; letter-spacing:.3px; }
td.num, td.c { font-family: 'Courier New', monospace; }
td.c { text-align: center; }
td.num { text-align: left; }
.good { color: #1a7a3a; font-weight: bold; }
.warn { color: #9a6b00; font-weight: bold; }
.bad  { color: #b02020; font-weight: bold; }
.bad-cell { color:#b02020; }
.callout { background:#f5f1e6; border-left: 4px solid #8a6d3b; padding: 8px 12px; margin: 10px 0; }
.q { background:#eef2f6; border:1px solid #d4dde6; padding:8px 12px; margin:8px 0; }
.small { font-size: 8.5pt; color:#666; }
.page { page-break-before: always; }
.foot { margin-top: 6px; font-size: 8pt; color:#888; }
.mono { font-family:'Courier New',monospace; }
.tag { display:inline-block; font-family:Helvetica,Arial,sans-serif; font-size:8pt; padding:1px 6px; border-radius:3px; color:#fff; }
</style></head><body>

<h1>DutyDraft — Draft-Order Course of Action (COA) Comparison</h1>
<div class="sub">Decision brief for the Commanding Officer · The Commandant&rsquo;s Own</div>
<div class="meta">Prepared by SNCOIC (GySgt Aird) · ${esc(data.meta.generated)} · Internal decision document</div>
<div class="rule"></div>

<h2 class="first">Purpose &amp; the decision</h2>
<p>DutyDraft schedules monthly duty by <strong>fixed rules — not AI and not chance</strong>. One policy decision remains: <strong>how the monthly draft order is generated</strong>. Weekend burden is already distributed <strong>equally</strong> across every Marine and is unaffected by this choice. This brief compares the four candidate methods using a <strong>12-month simulation on the real ${data.meta.rosterSize}-Marine roster</strong> (${esc(data.meta.startLabel)} – ${esc(data.meta.endLabel)}).</p>
<div class="q"><strong>Questions for command as you read:</strong>
<ul>
<li>Can leadership explain <em>every</em> Marine&rsquo;s pick, every month?</li>
<li>Does seniority still mean something?</li>
<li>Is recent burden (weekends, double duty) actually compensated?</li>
<li>Can a Marine end up at the bottom of the order <em>by chance</em> — and be told only &ldquo;the draw&rdquo;?</li>
</ul></div>

<h2>How this was tested (assumptions)</h2>
<ul>
<li>The real roster and 12 consecutive real months were used; the same engine that runs the live draft generated every order.</li>
<li>Weekend days each month were assigned <strong>equally</strong> (least recent burden first) — the system the unit already uses.</li>
<li><strong>Double duty rotates up the seniority line</strong>: when a month has more duty days than Marines, the most-junior Marines on rotation stand it (and pick first that month as compensation). No Marine is hit twice before all are hit once.</li>
<li>The two random methods (COA 2 &amp; 3) were each simulated 400× to report expected outcomes, not a single lucky draw.</li>
</ul>

<h2>Finding 1 — Weekend burden is equal, under every COA</h2>
<p>Over 12 months every Marine stood between <strong>${data.weekend.min} and ${data.weekend.max} weekends</strong> (about ${data.weekend.avg} each) — a spread of just <strong>${data.weekend.spread}</strong>. This is <strong>identical under all four COAs</strong>, because weekend assignment never touches the draft order. <em>The COA decision does not affect weekend fairness — that is already solved.</em></p>

<h2>Finding 2 — Explainability: how much of the order is chance</h2>
<p>The key measure is the <strong>&ldquo;luck swing&rdquo;</strong>: on average, how many positions a Marine&rsquo;s monthly pick lands away from the order the rules alone would have given (rank + earned burden). <strong>Zero means every pick is explainable.</strong></p>
<table><thead><tr><th style="width:34%">Method</th><th style="width:18%">Luck swing</th><th>What it means in practice</th></tr></thead><tbody>${luckRows}</tbody></table>
<p class="small">Per Marine, per month, averaged over the 12-month simulation. COA 1 is the rules-based baseline, so it is 0 by definition.</p>

<div class="page"></div>
<h2 class="first">Finding 3 — What it feels like to the Marine (trust &amp; morale)</h2>
<p>Consider <strong>${esc(ex.name)}</strong> — same Marine, same earned burden, across the 12 months. Only the method changes:</p>
<table><thead><tr><th style="width:26%">Method</th><th>Monthly draft pick (Jul → Jun)</th></tr></thead><tbody>
<tr><td>COA 1 — Weighted Seniority</td><td class="mono">${esc(exC1)}</td></tr>
<tr><td>COA 2 — Weighted Lottery</td><td class="mono">${esc(exC2)}</td></tr>
</tbody></table>
<div class="callout"><p>Under the rules-based order this senior Marine drafts in the single digits every month — exactly what his seniority earns. Under the lottery, <strong>the same Gunnery Sergeant is dropped as deep as #${ex.c2Worst}</strong>, repeatedly, by chance. There is no reason to give him beyond &ldquo;the draw.&rdquo;</p>
<p>A rules-based order gives <strong>every</strong> Marine a reliable path to good picks: senior Marines through rank, junior Marines through their double-duty compensation month. A lottery removes that guarantee — a Marine can sit near the bottom month after month with no recourse and no explanation. <strong>A duty tool the Marines do not trust will not be used.</strong></p></div>

<h2>Double-duty rotation (climbs the seniority line, fairly)</h2>
<p>Proof the compensation rotates and no one is hit twice before all are hit once:</p>
<table><thead><tr><th style="width:18%">Month</th><th>Stands double duty (→ picks first that month)</th></tr></thead><tbody>${ddRows}</tbody></table>

<div class="page"></div>
<h2 class="first">One month, side by side — the real ${esc(data.oneMonth.label)} draft</h2>
<p>The actual order each method would produce next month. <span class="small">(×2 = double-duty Marine, two picks.)</span></p>
<table><thead><tr><th style="width:8%">Pick</th><th>COA 1 — Weighted Seniority</th><th>COA 2 — Weighted Lottery</th><th>COA 3 — Hybrid</th></tr></thead><tbody>${oneMonthRows}</tbody></table>

<div class="page"></div>
<h2 class="first">12-month outcome per Marine</h2>
<p>Average pick <span class="mono">[best–worst]</span> over the 12 months, by method, plus weekends stood. <span class="small">Sen = seniority rank.</span></p>
<table><thead><tr><th style="width:6%">Sen</th><th style="width:24%">Marine</th><th>COA 1</th><th>COA 2</th><th>COA 3</th><th style="width:8%">Wknds</th></tr></thead><tbody>${perMarineRows}</tbody></table>

<h2>Scorecard &amp; the decision</h2>
<table><thead><tr><th style="width:40%">&nbsp;</th><th>COA 1</th><th>COA 2</th><th>COA 3</th></tr></thead><tbody>${scorecard}</tbody></table>
<p><strong>The choice is purely how much chance to introduce into the draft order</strong> — weekend burden is equal regardless. COA 1 maximizes explainability and trust; every pick can be defended to the Marine standing it. COA 2 maximizes opportunity for junior Marines, at the cost of explainability and seniority. COA 3 is a middle path: a rules-based order with a small, bounded lottery for the top five slots.</p>
<p class="foot">Generated from the DutyDraft draft-order engine and 12-month fairness simulation. All figures are live model output, not estimates. Seed-stable and reproducible.</p>

</body></html>`;

const outPath = path.join(__dirname, '..', 'DutyDraft-COA-Brief.html');
fs.writeFileSync(outPath, html);
console.log('Wrote ' + outPath);
