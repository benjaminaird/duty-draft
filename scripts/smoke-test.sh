#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"

# V1 requires auth on /api/state, /api/backup, and the PDF exports. The smoke
# test logs in as an admin and passes a bearer token. Override the credentials
# with DUTYDRAFT_ADMIN_USER / DUTYDRAFT_ADMIN_PASS (defaults match the seed).
ADMIN_USER="${DUTYDRAFT_ADMIN_USER:-baird_master_admin}"
ADMIN_PASS="${DUTYDRAFT_ADMIN_PASS:-SetUpDutyDraft}"

echo "DutyDraft smoke test"
echo "Base URL: $BASE_URL"
echo

echo "0. Logging in as $ADMIN_USER..."
LOGIN_JSON=$(curl -sS -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}" || true)
TOKEN=$(printf '%s' "$LOGIN_JSON" | python3 -c 'import sys,json
try: print(json.load(sys.stdin).get("token",""))
except Exception: print("")' 2>/dev/null || true)
if [ -z "$TOKEN" ]; then
  echo "  ⚠ Could not obtain an admin token. Set DUTYDRAFT_ADMIN_USER / DUTYDRAFT_ADMIN_PASS"
  echo "    (and make sure the admin account is seeded). Authenticated checks will fail below."
else
  echo "  Token acquired."
fi
echo

echo "1. Checking server health (public)..."
curl -fsS "$BASE_URL/api/health" > /tmp/dutydraft-health.json
cat /tmp/dutydraft-health.json
echo
echo

echo "2. Checking app state endpoint (auth)..."
curl -fsS -H "Authorization: Bearer $TOKEN" "$BASE_URL/api/state" > /tmp/dutydraft-state.json
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

echo "3. Checking backup endpoint (admin)..."
curl -fsS -H "Authorization: Bearer $TOKEN" "$BASE_URL/api/backup" > /tmp/dutydraft-backup.json
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

echo "4. Checking duty PDF export (admin)..."
curl -fsS -X POST "$BASE_URL/api/export-roster" \
  -H "Authorization: Bearer $TOKEN" \
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
    raise SystemExit("Duty PDF export did not return a valid PDF header (server may be missing Python reportlab)")
print(f"Duty PDF export OK: {p.stat().st_size} bytes")
PY
echo

echo "5. Checking funeral PDF export (admin)..."
curl -fsS -X POST "$BASE_URL/api/export-funeral-roster" \
  -H "Authorization: Bearer $TOKEN" \
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
    raise SystemExit("Funeral PDF export did not return a valid PDF header (server may be missing Python reportlab)")
print(f"Funeral PDF export OK: {p.stat().st_size} bytes")
PY
echo

echo "6. Checking frontend loads (public)..."
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
