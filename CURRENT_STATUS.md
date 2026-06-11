# DutyDraft Current Status

Last updated: June 2026

## Current state

DutyDraft is stable and deployed (demo mode).

A **V1 production-readiness layer** is staged on the `automated-test-drive`
branch (NOT yet merged or deployed): username/password login, roles
(master / SNCOIC / marine / pending), a seeded real roster + funeral buglers,
server-side role enforcement, and an admin Accounts panel. The duty draft,
funeral roster, fairness policy, auto-pick, and PDF formatting are unchanged.
See **V1_SETUP.md** for setup, env vars, seeding, and deployment.

Live app:

https://dutydraft.onrender.com

GitHub repo:

https://github.com/benjaminaird/duty-draft

Rollback tags:

- stable-working-demo (original demo baseline)
- pre-v1-readiness (branch state just before the V1 work)

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