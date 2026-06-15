#!/usr/bin/env bash
# Builds the CO COA-comparison brief end to end:
#   1. runs the engine + 12-month simulation -> coa-brief-data.json
#   2. renders a print-ready HTML brief
#   3. converts it to PDF with headless Chrome
# Output: DutyDraft-COA-Brief.pdf (and .html) in the repo root.
set -e
cd "$(dirname "$0")/.."

node scripts/coa-brief-data.js
node scripts/coa-brief-html.js

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if [ ! -x "$CHROME" ]; then
  echo "Chrome not found at expected path; open DutyDraft-COA-Brief.html and Print → Save as PDF."
  exit 0
fi

"$CHROME" --headless --disable-gpu --no-pdf-header-footer \
  --print-to-pdf="$PWD/DutyDraft-COA-Brief.pdf" \
  "file://$PWD/DutyDraft-COA-Brief.html" >/dev/null 2>&1

echo "Wrote $PWD/DutyDraft-COA-Brief.pdf"
