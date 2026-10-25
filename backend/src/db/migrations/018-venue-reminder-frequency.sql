-- File: Adds selectable Venue Staff reminder cadences while preserving the existing daily default.
BEGIN;
ALTER TABLE venue_notification_preferences
  ADD COLUMN IF NOT EXISTS reminder_frequency_days INTEGER NOT NULL DEFAULT 1;
ALTER TABLE venue_notification_preferences
  DROP CONSTRAINT IF EXISTS venue_notification_preferences_frequency_check;
ALTER TABLE venue_notification_preferences
  ADD CONSTRAINT venue_notification_preferences_frequency_check
  CHECK (reminder_frequency_days IN (1, 3, 7));
COMMIT;
