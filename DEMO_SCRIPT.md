# DutyDraft Demo Script

## Purpose

This demo shows DutyDraft as a working command-approval prototype for the monthly duty roster and funeral bugler roster process.

The point of the demo is not to show every button. The point is to show that the app can take the current manual process and make it faster, fairer, more transparent, and easier to publish.

## Opening

DutyDraft was built to solve a real unit-level scheduling problem.

The current duty process depends heavily on manual tracking, individual memory, fairness judgment, and repeated formatting work. DutyDraft turns that process into a guided workflow.

This demo uses ghost names only. Real names and user accounts would be added only after approval for a controlled pilot.

## Demo path

### 1. Open the live app

Open:

https://dutydraft.onrender.com

Point out:

- Demo Mode label
- NCOIC/admin view
- Phase progress bar
- Current month/cycle
- Settings backup button exists for safety

Suggested line:

“This is the live deployed app. It is currently in demo mode with ghost names so no real personnel data is exposed.”

### 2. Show setup concept

Go to the Admin/Setup area.

Show:

- Roster in seniority order
- Rank structure
- NCOIC controls
- Draft timer setting if visible

Suggested line:

“The NCOIC starts with the roster in seniority order. This matters because the draft order is based on seniority, while the fairness engine handles weekend burden and other constraints.”

### 3. Show calendar controls

Show the calendar setup area.

Point out:

- Blackout dates
- Weekend-equivalent dates
- Workday overrides
- Pre-assigned duties

Suggested line:

“The calendar can account for real unit conditions: holidays, special liberty periods, workday overrides, and dates that should not receive duty assignments.”

### 4. Show preferences and non-availability

Show the preferred dates / non-availability concept.

Point out:

- Marines submit preferred dates
- Marines submit non-availability with reasons
- NCOIC reviews and approves/denies requests

Suggested line:

“Instead of the NCOIC trying to collect preferences across text messages or conversations, DutyDraft gives every Marine a structured way to submit preferences and conflicts.”

### 5. Show the draft

Go to the Draft tab.

Point out:

- Draft order
- Current turn
- Timer
- Picked dates updating the calendar
- Weekend duty logic if visible

Suggested line:

“The draft gives Marines more ownership over their duty date while still enforcing the unit’s rules. The server tracks whose turn it is and now rejects invalid picks on the backend.”

### 6. Show published roster

Go to the Roster tab.

Point out:

- Published roster view
- Official roster formatting
- PDF export
- Calendar export if visible

Suggested line:

“After the draft, the NCOIC can review the final roster and publish it in the expected format. The PDF export preserves the official roster layout.”

### 7. Show funeral roster

Go to the Funeral tab.

Point out:

- Separate funeral bugler roster
- Conflict handling
- Fairness/burden tracking
- PDF export

Suggested line:

“The funeral bugler roster is handled separately because it has its own constraints. The app prevents same-day conflicts and helps spread the burden fairly.”

### 8. Show safety features

Go to Settings.

Point out:

- Download Backup button
- Full Reset confirmation
- Next Month confirmation
- Smoke test exists outside the app

Suggested line:

“Before reset, rollover, or any risky change, the current app state can be downloaded as a backup. The app also has a smoke test that checks the live server, state, backup, PDF exports, and frontend load.”

### 9. Explain production readiness

Suggested line:

“This version is ready for demonstration and command discussion. Before using real names and real duty data, the next step would be a controlled pilot with authenticated accounts and role-based access.”

## What is working now

- Live deployed app
- NCOIC/admin workflow
- Duty roster draft workflow
- Preference and non-availability workflow
- Weekend fairness logic
- Published roster view
- Duty PDF export
- Funeral roster workflow
- Funeral PDF export
- Calendar export
- Backup endpoint
- Download Backup button
- Smoke test for live app stability

## What would be added before real use

- Real login accounts
- Role-based access
- Real roster data
- Admin handoff process
- Pilot SOP
- One shadow month alongside the current manual process

## Closing

DutyDraft is meant to support, not replace, the SNCOIC/NCOIC decision process.

The final approval flow remains the same:

SNCOIC reviews the roster, presents the completed roster to command, and only then is it published.

DutyDraft simply makes the process faster, more transparent, easier to audit, and easier to repeat each month.