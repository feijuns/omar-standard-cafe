-- Existing D1 databases created before 2026-06-29 need these new receiver fields.
-- Run each ALTER TABLE once. If Cloudflare reports "duplicate column name",
-- that column already exists and can be skipped.

ALTER TABLE orders ADD COLUMN recipient_name TEXT;
ALTER TABLE orders ADD COLUMN recipient_phone TEXT;
