# DutyDraft Stability Notes

## Known-good checkpoint

The current working demo version is tagged in Git as:

`stable-working-demo`

Use this tag as the rollback/reference point before making risky changes.

## Do not casually change

These areas are working and should be treated as locked unless there is a specific bug to fix:

- `generate_roster.py`
  - PDF formatting has been manually tuned and approved.
  - Do not change coordinates, fonts, margins, spacing, column split, title placement, signature block, or roster layout casually.

- Draft workflow logic in `server.js`
  - The live draft is currently working.
  - Only make small, well-tested backend safety fixes.

- Funeral roster generation
  - The current generation behavior is good.
  - Avoid rewriting the solver/assignment behavior unless intentionally doing a dedicated upgrade.

## Safe improvement categories

Preferred stability work:

- Add smoke tests.
- Add backend validation.
- Add backups/export tools.
- Add be- Add be- Add be- Add be- Add bd documentation.
- Add pre-depl- Add pre-depl Frontend ca- Add pre-depl- Add pre-depl Frontend ca- Add pre-deact- Add pre-deend. Avoid - Add pre-depl- Add pre-derectly in this file until the app is migrated to a proper build system such as Vite.

Small wording/CSS edits are okay, but test carefully after every change.

## Pre-deploy checklist

Before pushing future changes:

1. Run `git status`.
2. Run `npm run check`.
3. Start the app locally if possible.
4. Run `npm run smoke`.
5. Confirm duty PDF export still works if PDF code was touched.
6. Confirm funeral PDF export still works if PDF code was touched.
7. Confirm draft flow still works if draft code was touched.
8. Commit with a clear message.
9. Push.

## Render deployment note

A GitHub push may not always auto-deploy immediately on Render.

After pushing important changes, verify the Render service is live on the expected commit.

If needed:

Render Dashboard → DutyDraft service → Manual Deploy → Deploy latest commit

## Smoke tests

Local smoke test:

```bash
npm start
# In a second Terminal:
npm run smoke
```

Live Render smoke test:

```bash
BASE_URL=https://dutydraft.onrender.com npm run smoke
```

The smoke test currently checks:

- Server health endpoint
- App state endpoint
- Backup endpoint
- Duty PDF export returns a valid PDF
- Funeral PDF export returns a valid PDF
- Frontend loads
- Expected React/Babel app markers are present

This test does not verify the full draft workflow or PDF visual formatting. It is a quick safety check before and after changes.

## App state backup

The app exposes a read-only backup endpoint:

```bash
https://dutydraft.onrender.com/api/backup
```

This downloads the current app state as JSON, including:

- Export timestamp
- App name
- Full `appState`

Use this before:

- Full Reset
- Next Month
- Any risky code change
- Any demo where the database state matters
