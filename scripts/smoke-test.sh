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

echo "4. Checking frontend loads..."
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