/*
# Create sheet_submissions table (single-tenant, no auth)

## Purpose
Durably stores every submission attempt so data is never lost even if the
Google Sheet webhook is temporarily unavailable or misconfigured. Each row
records the full payload sent and the response received from the sheet.

## New Tables
### `sheet_submissions`
- `id` (uuid, primary key)
- `record_id` (uuid, foreign key to sd_card_records)
- `payload` (jsonb) — the full row data sent to the sheet
- `sheet_status` (text) — 'pending' | 'pushed' | 'failed'
- `sheet_response` (text) — response text from the Google Sheet webhook
- `attempts` (int, default 0) — number of push attempts
- `created_at` (timestamptz)

## Security
- Enable RLS on `sheet_submissions`.
- Grant CRUD to `anon` + `authenticated` (no-auth app).
*/

CREATE TABLE IF NOT EXISTS sheet_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id uuid REFERENCES sd_card_records(id) ON DELETE CASCADE,
  payload jsonb,
  sheet_status text NOT NULL DEFAULT 'pending',
  sheet_response text,
  attempts int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE sheet_submissions ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON sheet_submissions TO anon, authenticated;

DROP POLICY IF EXISTS "anon_select_sheet_submissions" ON sheet_submissions;
CREATE POLICY "anon_select_sheet_submissions"
ON sheet_submissions FOR SELECT
TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_sheet_submissions" ON sheet_submissions;
CREATE POLICY "anon_insert_sheet_submissions"
ON sheet_submissions FOR INSERT
TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_sheet_submissions" ON sheet_submissions;
CREATE POLICY "anon_update_sheet_submissions"
ON sheet_submissions FOR UPDATE
TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_sheet_submissions" ON sheet_submissions;
CREATE POLICY "anon_delete_sheet_submissions"
ON sheet_submissions FOR DELETE
TO anon, authenticated USING (true);