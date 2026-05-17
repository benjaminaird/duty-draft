# DutyDraft

DutyDraft is a web app for managing monthly duty roster drafting and funeral bugler roster generation.

Live app:

https://dutydraft.onrender.com

## Current status

DutyDraft is stable and deployed.

The current safety baseline is documented in:

- CURRENT_STATUS.md
- STABILITY_NOTES.md

Known-good rollback tag:

stable-working-demo

## Quick checks

Run basic code checks:

npm run check

Run smoke test against the live Render app:

BASE_URL=https://dutydraft.onrender.com npm run smoke

The smoke test checks:

- Health endpoint
- State endpoint
- Backup endpoint
- Duty PDF export
- Funeral PDF export
- Frontend load

## Local development

Start the app locally:

npm start

Then, in a second Terminal:

npm run smoke

Note: local PDF smoke checks require Python reportlab to be installed and working.

## Backup

Before risky changes, download the current app state:

https://dutydraft.onrender.com/api/backup

## Do not casually modify

These areas are sensitive and currently working:

- generate_roster.py
- PDF layout, coordinates, fonts, and spacing
- Core draft flow
- Funeral roster generation logic
