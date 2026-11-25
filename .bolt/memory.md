# Project memory

## Product intent & audience

- SD Card Validation Dashboard for reviewing video clips and metadata extracted from SD cards.
- Primary users: VCs (validation coordinators) who verify extracted details, mark Pass/Fail/Passed-with-comment, and submit approved records to Google Sheets.
- Workflow: auto-fetch SD card record → review video + metadata → validate → submit to Google Sheet.

## Brand personality & voice

- Practical, professional tooling UI; clarity over flair.
- Status communication should be explicit (badges, counts, confirmations).

## Visual design & UX direction

- Two-column layout: left = records list + pinned video player (top-left); right = SD Card Details tab with metadata grid + validation controls.
- Video player controls: play/pause, mute, restart, seek bar, fullscreen.
- Records list: searchable, with status badges and submission indicators; header shows live counts (pending, validated, submitted).
- Metadata displayed in clean card grid.
- Validation actions: Pass, Fail, Passed with Comment (reveals comment box); selection saves automatically.
- Submit button enabled after validation; pushes to Google Sheets and marks record submitted.
- Stack constraints: Tailwind classes, lucide-react icons, `@/` import alias. Avoid extra UI packages unless necessary.

## Decisions, constraints & rationale

- Backend: Supabase; Google Sheets push via Google Apps Script webhook URL stored as Supabase secret `GOOGLE_SHEET_WEBHOOK_URL`.
- Submission gracefully degrades when webhook not configured (saves locally, notifies user).
- 5 sample records with working video clips preloaded to demonstrate full flow.
- Build and typecheck must pass before delivery.
- Fields captured: Entry Date, VC Name, IC Number (IC-1), Recorded Date, Recorded Time (HH:MM:SS), Mcap files, Duration, Video Status, City, Project IC Name, FO Name, SD Card Count (SD-1), SD Card Duration.

## Open questions & assumptions

- Real data source/schema for SD card records not yet specified; current records are sample data.
- Actual Google Sheet/webhook endpoint and field mapping unconfirmed.
- Auth/role model for VCs not defined.
- Video file storage location/format assumption (hosted clips) may need revisiting for production.