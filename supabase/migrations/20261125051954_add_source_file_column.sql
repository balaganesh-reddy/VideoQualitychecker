/*
# Add source_file column to sd_card_records

## Purpose
When a real SD card is connected via the browser file picker, each video file
imported from the card is stored as a record. `source_file` keeps the original
file name (e.g. "clip_001.mp4") so re-connecting the same card does not create
duplicate records.

## Modified Tables
### `sd_card_records`
- `source_file` (text, nullable) — original video file name on the SD card

## Security
No policy changes; the column inherits the existing RLS policies.
*/

ALTER TABLE sd_card_records ADD COLUMN IF NOT EXISTS source_file text;