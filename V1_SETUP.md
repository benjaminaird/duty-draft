# DutyDraft V1 — Setup, Auth, and Deployment

This document covers the V1 production-readiness layer added on the
`automated-test-drive` branch: accounts/roles, seeding, environment variables,
data isolation, and how to deploy. It does **not** change the duty draft,
funeral roster, fairness policy, or PDF formatting — those are preserved.

---

## 1. Roles

| Role | What it is | Roster Marine? |
|------|------------|----------------|
| `master` | App owner / setup & troubleshooting account. Sees the Accounts panel, can link accounts, create/edit Marines, and assign the SNCOIC. Not required to draft. | No |
| `sncoic` | The real Duty SNCOIC. Runs the monthly duty workflow and funeral roster. **Also a normal duty Marine** — drafts on their own turn. Exactly one active at a time. | Yes |
| `marine` | Normal user. Submits preferences / non-availability, drafts on their turn, views the calendar and published rosters. | Yes |
| `pending` | Signed up but not yet linked. Sees only the "waiting for admin assignment" screen; cannot use any app function. | No |

Admin = `master` or `sncoic`.

---

## 2. Accounts & login

- **Sign up** (`/api/auth/signup`): username, password, rank (PFC/LCpl/Cpl/Sgt/SSgt/GySgt),
  first name, last name. Always creates a **pending** account. No email.
- **Passwords** are intentionally simple (min 4 chars, no complexity rules),
  hashed with scrypt (Node `crypto`). Users change their own password in
  **Settings → Change Password**. There is no email reset in V1.
- **Sessions** are stateless HMAC bearer tokens (30-day expiry) stored in the
  browser's `localStorage`. "Stay logged in" until logout or expiry.
- **Account management** (admins): link a pending account to an existing roster
  Marine *or* create a new Marine and link in one step; edit a Marine's
  rank/name to fix spelling/matching; assign/transfer SNCOIC; unlink; master
  can delete an account.

Roles are enforced **server-side** (not just hidden in the UI):
- `GET /api/state`, `GET /api/funeral/state` → any linked (non-pending) user.
- Draft pick → only the Marine whose turn it is (admins may pick for the
  current turn while running the draft).
- `POST /api/state` → admins write the full state; a Marine may only write
  **their own** `prefs` / `nonAvail` and **cannot self-approve** N/A.
- All setup/draft-control/funeral-admin/export/backup/reset/next-month routes
  → admin only. Account-management routes → admin; delete-account → master.

---

## 3. Environment variables (Render)

| Var | Required | Purpose |
|-----|----------|---------|
| `DATABASE_URL` | yes (prod) | Postgres connection. When unset, the app uses local JSON files in `.localdata/` (dev only). |
| `SESSION_SECRET` | **strongly recommended** | Signs login tokens. If unset, a random secret is generated and persisted (in `app_meta` / `meta.json`); set it explicitly so tokens stay valid across instances/redeploys. |
| `PORT` | provided by Render | Server port. |
| `DUTYDRAFT_TEST_MODE` | **never set in prod** | `1` only for the automated test drive. See §5. |

Generate a secret: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

---

## 4. First-time production setup (run once)

1. **Set env vars** in Render: `SESSION_SECRET` (and confirm `DATABASE_URL`).
2. **Run the migration** (creates/updates `users` and `app_meta`, makes
   `marine_id` nullable, adds rank/name columns — idempotent and safe to re-run):
   ```
   npm run migrate
   ```
3. **Seed V1 data** (29-Marine roster, 9 funeral buglers, master admin):
   ```
   npm run seed:v1
   ```
   - Safe by design: it will **not** overwrite a real (non-demo) roster without
     `--force`, never duplicates users, and never resets an existing master's
     password. Use `--dry-run` to preview.
4. **Log in** as `baird_master_admin` with the password the seed printed (or the
   one you passed via `--password=`) and **change it immediately**
   (Settings → Change Password).
5. Have **SSgt Weiland** sign up, then (as master) **link** his account to the
   Weiland roster Marine and **assign him SNCOIC** in the Accounts tab.
6. Other Marines sign up; an admin links each to their roster Marine.

### The master admin account
- Created only by `npm run seed:v1` (username `baird_master_admin`). The seed
  prints a random password on creation; or set one with
  `node scripts/seed-v1.js --password=YOURPASS`. Never commit the value.
- It is a row in the `users` table with `role='master'`, `marine_id=NULL`.
- **To change it:** log in and change the password, or update the row directly.
- **To remove it later:** delete that row from the `users` table.

---

## 5. Test-mode / data isolation (production safety)

- `DUTYDRAFT_TEST_MODE=1` makes **all** storage go to JSON files under
  `test-drive-output/` (never Postgres) **and** bypasses auth. It is used only
  by `npm run test-drive`, which spawns its own server on port 3999. It cannot
  touch the production database.
- Storage backend is chosen at load: `DUTYDRAFT_TEST_MODE=1` → test files;
  else no `DATABASE_URL` → `.localdata/` files (local dev, auth ON); else
  Postgres. Auth bypass is tied **only** to `DUTYDRAFT_TEST_MODE`, so local
  file-mode dev still exercises real login/roles.
- ⚠️ The repo `.env` contains the **production** `DATABASE_URL`. Running
  `node server.js` locally connects to prod. For local testing, force file mode:
  `DATABASE_URL= PORT=3010 node server.js`.
- Backups: `GET /api/backup` (admin) still downloads the full state as JSON.
  Take one before any risky change.

---

## 6. Schema changes

`users` table (created/upgraded by `npm run migrate`):

| column | notes |
|--------|-------|
| `id` | serial PK |
| `username` | unique |
| `password_hash` | scrypt |
| `role` | pending / marine / sncoic / master (default pending) |
| `marine_id` | **nullable** (was previously UNIQUE NOT NULL — fixed) |
| `rank`, `first_name`, `last_name` | captured at signup (added columns) |
| `created_at` | timestamptz |

`app_meta(key, value)` — small key/value table (holds the generated
`session_secret` when `SESSION_SECRET` is not set in env).

`app_state` (the existing single-row JSON blob) is unchanged. Password hashes
live **only** in `users`, never in `app_state`, so `/api/state` cannot leak them.

---

## 7. Deployment

There is no `render.yaml` in the repo, so the deploy branch is configured in the
Render dashboard. GitHub's default branch is `main`; this work is on
`automated-test-drive`, which is well ahead of `main` (it also carries the
recent fairness commits). **Confirm which branch your Render service watches**
before deploying.

Either way, **run the migration and seed against production once** (§4), and set
`SESSION_SECRET`, as part of the rollout.

- **If Render deploys from `main`:** open a PR and merge after approval —
  ```
  git push origin automated-test-drive
  gh pr create --base main --head automated-test-drive \
    --title "DutyDraft V1: accounts, roles, seeded roster" --body "See V1_SETUP.md"
  # after approval:
  gh pr merge --merge        # or merge in the GitHub UI
  ```
  Render then auto-deploys `main`.
- **If Render deploys from `automated-test-drive`:** just push —
  ```
  git push origin automated-test-drive
  ```
  Render then auto-deploys this branch. Verify the deploy in the Render
  dashboard; do not assume success.

After deploy, smoke-test the live app (logs in as admin, set creds via env):
```
DUTYDRAFT_ADMIN_USER=baird_master_admin DUTYDRAFT_ADMIN_PASS='...' \
  BASE_URL=https://dutydraft.onrender.com npm run smoke
```

---

## 8. What was deliberately NOT changed

generate_roster.py, PDF layout/coordinates/fonts, the core draft flow, funeral
roster generation logic, the auto-pick fallback, and the weekend fairness policy
(rank-group ratios, count-based required selection, voluntary weekend credit +
warning, same-group freeing). The 12-month test drive still reports **Required
fairness PASS** with the voluntary warning present and same-group credit intact.

Notifications: the tab is hidden for V1; the backend notification code is
retained (used during the draft).
