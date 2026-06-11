# DutyDraft

DutyDraft is a web app for managing monthly duty roster drafting and funeral bugler roster generation.

Live app:

https://dutydraft.onrender.com

## Current status

DutyDraft is stable and deployed in demo mode. A V1 production-readiness layer
(login, roles, seeded roster, account management) is staged on the
`automated-test-drive` branch — see **V1_SETUP.md**.

The current safety baseline is documented in:

- CURRENT_STATUS.md
- STABILITY_NOTES.md
- V1_SETUP.md (V1 accounts, seeding, env vars, deployment)

Known-good rollback tags:

- stable-working-demo (original demo baseline)
- pre-v1-readiness (just before the V1 work)

## V1 accounts (new)

V1 adds username/password login with roles (master / SNCOIC / marine / pending).
One-time production setup (details in V1_SETUP.md):

    npm run migrate     # create/upgrade the users + app_meta tables (idempotent)
    npm run seed:v1     # seed the real roster, funeral buglers, master admin

Set `SESSION_SECRET` in the environment for stable login tokens. The seed
creates the master account `baird_master_admin` and prints a random password
(or pass `--password=...`); log in and change it immediately.

## Quick checks

Run basic code checks:

npm run check

Run smoke test against the live Render app (logs in as an admin; override creds
with DUTYDRAFT_ADMIN_USER / DUTYDRAFT_ADMIN_PASS):

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
