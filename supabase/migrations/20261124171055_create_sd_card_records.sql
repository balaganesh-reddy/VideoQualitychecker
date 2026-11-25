/*
# Create SD card records table (single-tenant, no auth)

## Purpose
Stores video clip metadata extracted from SD cards, along with the
validation result (pass / fail / passed with comment) chosen by the VC
after reviewing the clip. Records are submitted to a Google Sheet once
the VC approves them.

## New Tables
### `sd_card_records`
- `id` (uuid, primary key)
- `entry_date` (date) — date the entry was logged (Date-Month)
- `vc_name` (text) — name of the VC (validation checker)
- `ic_number` (text) — IC number, e.g. "IC-1"
- `recorded_date` (date) — date the clip was recorded (Date-Month)
- `recorded_time` (text) — time the clip was recorded, HH:MM:SS
- `mcap_files` (text) — number/list of Mcap files
- `duration` (text) — clip duration
- `video_status` (text) — status of the video
- `city` (text) — city where recorded
- `project_ic_name` (text) — project IC name
- `fo_name` (text) — field officer name
- `sd_card_count` (text) — SD card identifier, e.g. "SD-1"
- `sd_card_duration` (text) — total duration on the SD card
- `video_url` (text) — URL/path of the video file to play
- `status` (text) — validation status: 'pending' | 'pass' | 'fail' | 'passed_with_comment'
- `comment` (text) — optional comment when status is 'passed_with_comment'
- `submitted` (boolean, default false) — whether the record was pushed to Google Sheets
- `created_at` (timestamptz)

## Security
- Enable RLS on `sd_card_records`.
- Grant CRUD to `anon` + `authenticated` (no-auth app).
- Allow anon + authenticated full CRUD because the data is intentionally shared.
*/

CREATE TABLE IF NOT EXISTS sd_card_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_date date,
  vc_name text,
  ic_number text,
  recorded_date date,
  recorded_time text,
  mcap_files text,
  duration text,
  video_status text,
  city text,
  project_ic_name text,
  fo_name text,
  sd_card_count text,
  sd_card_duration text,
  video_url text,
  status text NOT NULL DEFAULT 'pending',
  comment text,
  submitted boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE sd_card_records ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON sd_card_records TO anon, authenticated;

DROP POLICY IF EXISTS "anon_select_sd_card_records" ON sd_card_records;
CREATE POLICY "anon_select_sd_card_records"
ON sd_card_records FOR SELECT
TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_sd_card_records" ON sd_card_records;
CREATE POLICY "anon_insert_sd_card_records"
ON sd_card_records FOR INSERT
TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_sd_card_records" ON sd_card_records;
CREATE POLICY "anon_update_sd_card_records"
ON sd_card_records FOR UPDATE
TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_sd_card_records" ON sd_card_records;
CREATE POLICY "anon_delete_sd_card_records"
ON sd_card_records FOR DELETE
TO anon, authenticated USING (true);