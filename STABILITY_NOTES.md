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
2. Run `node --check server.js`.
3. Run `python3 -m py_compile generate_roster.py`.
4. Start the app locally if possible.
5. Confirm the main page5. Confirm the main page5. Confirm tti5. Confirm the main page5. Confirm tort still works.
8. Confirm draft flow still works or was not touched.
9. Commit with a clear message.
10. Push.
