# Citation Tool Test (offline web app)

## What this is
A single-page, client-only web simulation designed to teach *automation bias / automation misuse* in a legal citation-checking context.

- No backend.
- No database.
- All data stays in the browser (localStorage).
- Export results as JSON at the end.

All authorities/cases are **fictionalized** for teaching purposes.

## Instructor tips
- Ask students to export JSON at the end and submit to LMS/email.
- The app is tuned for a ~20 minute session with phased manipulation:
  Phase 1: very reliable assistant
  Phase 2: competition pressure increases
  Phase 3: domain shift (authority weight / jurisdiction)

## Files
- index.html
- styles.css
- app.js
- items.json


## Instructor item bank check
Open `check.html` (served via a local server) to review and edit `items.json`, then export a new `items.json`.
