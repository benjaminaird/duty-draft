#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"

echo "DutyDraft smoke test"
echo "Base URL: $BASE_URL"
echo

echo "1. Checking server health..."
curl -fsS "$BASE_URL/api/health" > /tmp/dutydraft-health.json
cat /tmp/dutydraft-health.json
echo
echo

echo "2. Checking app state endpoint..."
curl -fsS "$BASE_URL/api/state" > /tmp/dutydraft-state.json
python3 - <<'PY'
import json
with open('/tmp/dutydraft-state.json') as f:
    data = json.load(f)
required = ['phase', 'year', 'month', 'marines']
missing = [k for k in required if k not in data]
if missing:
    raise SystemExit(f"Missing expected state keys: {missing}")
print(f"State OK: phase={data.get('phase')} year={data.get('year')} month={data.get('month')} marines={len(data.get('marines', []))}")
PY
echo

echo "3. Checking backup endpoint..."
curl -fsS "$BASE_URL/api/backup" > /tmp/dutydraft-backup.json
python3 - <<'PY'
import json
from pathlib import Path

p = Path('/tmp/dutydraft-backup.json')
data = json.loads(p.read_text())

required = ['exportedAt', 'app', 'state']
missing = [k for k in required if k not in data]
if missing:
    raise SystemExit(f"Backup missing expected keys: {missing}")

state = data['state']
print(f"Backup OK: app={data.get('app')} phase={state.get('phase')} marines={len(state.get('marines', []))}")
PY
echo

echo "4. Checking duty PDF export..."
curl -fsS -X POST "$BASE_URL/api/export-roster" \
  -H "Content-Type: application/json" \
  -d '{
    "year":2026,
    "month_name":"June",
    "month_upper":"JUNE",
    "pub_date":"16 May 26",
    "left_rows":[["1","SGT TEST"],["2","SSGT TEST"]],
    "right_rows":[["16","CPL TEST"],["17","LCPL TEST"]],
    "co_name":"N. D. MORRIS"
  }' > /tmp/dutydraft-duty-export-test.pdf
python3 - <<'PY'
from pathlib import Path
p = Path('/tmp/dutydraft-duty-export-test.pdf')
data = p.read_bytes()
if data[:5] != b'%PDF-':
    raise SystemExit("Duty PDF export did not return a valid PDF header")
print(f"Duty PDF export OK: {p.stat().st_size} bytes")
PY
echo

echo "5. Checking funeral PDF export..."
curl -fsS -X POST "$BASE_URL/api/export-funeral-roster" \
  -H "Content-Type: application/json" \
  -d '{
    "left_rows":[["1","SGT TEST"],["2","SSGT TEST"]],
    "right_rows":[["16","CPL TEST"],["17","LCPL TEST"]],
    "co_name":"N. D. MORRIS"
  }' > /tmp/dutydraft-funeral-export-test.pdf
python3 - <<'PY'
from pathlib import Path
p = Path('/tmp/dutydraft-funeral-export-test.pdf')
data = p.read_bytes()
if data[:5] != b'%PDF-':
    raise SystemExit("Funeral PDF export did not return a valid PDF header")
print(f"Funeral PDF export OK: {p.stat().st_size} bytes")
PY
echo

echo "6. Checking frontend loads..."
curl -fsS "$BASE_URL/" > /tmp/dutydraft-index.html
python3 - <<'PY'
from pathlib import Path
html = Path('/tmp/dutydraft-index.html').read_text(errors='replace')
checks = ['DutyDraft', 'React', 'babel']
missing = [c for c in checks if c not in html]
if missing:
    raise SystemExit(f"Frontend missing expected text: {missing}")
print(f"Frontend OK: {len(html)} bytes")
PY
echo

echo "Smoke test passed."
