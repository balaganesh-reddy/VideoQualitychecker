ALTER TABLE sd_card_records
  ADD COLUMN IF NOT EXISTS ic_name text,
  ADD COLUMN IF NOT EXISTS drive_link text,
  ADD COLUMN IF NOT EXISTS vc_comment text,
  ADD COLUMN IF NOT EXISTS ic_comment text;
