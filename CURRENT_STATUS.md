# DutyDraft Current Status

Last updated: May 2026

## Current state

DutyDraft is stable and deployed.

Live app:

https://dutydraft.onrender.com

GitHub repo:

https://github.com/benjaminaird/duty-draft

Known-good rollback tag:

stable-working-demo

## Current safety baseline

The live Render app passes:

BASE_URL=https://dutydraft.onrender.com npm run smoke

The smoke test checks:

- Health endpoint
- State endpoint
- Backup endpoint
- Duty PDF export
- Funeral PDF export
- Frontend load

## Before future changes

Run:

git status
npm run check
BASE_URL=https://dutydraft.onrender.com npm run smoke

Use the backup endpoint before risky changes:

https://dutydraft.onrender.com/api/backup

## Do not casually modify

- generate_roster.py
- PDF layout/coordinates/fonts
- Core draft flow
- Funeral roster generation logic

## Suggested next safe improvements

1. Add a visible Download Backup button in Settings.
2. Add confirmation warnings before Full Reset and Next Month.
3. Add a lightweight README.
4. Review UI/UX without changing logic.