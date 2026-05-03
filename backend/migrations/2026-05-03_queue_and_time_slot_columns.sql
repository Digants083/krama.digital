ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS notification_stage VARCHAR DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS slot_id INTEGER,
  ADD COLUMN IF NOT EXISTS push_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS queue_position INTEGER;

ALTER TABLE qr_appointments
  ADD COLUMN IF NOT EXISTS slot_id INTEGER,
  ADD COLUMN IF NOT EXISTS queue_position INTEGER;

ALTER TABLE completed_appointments
  ADD COLUMN IF NOT EXISTS slot_id INTEGER,
  ADD COLUMN IF NOT EXISTS finished_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS status VARCHAR DEFAULT 'served',
  ADD COLUMN IF NOT EXISTS wait_time_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS outcome VARCHAR DEFAULT 'served',
  ADD COLUMN IF NOT EXISTS served BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS push_count INTEGER DEFAULT 0;

ALTER TABLE clinic_time_slots
  ADD COLUMN IF NOT EXISTS slots JSON DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS slot VARCHAR[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS last_slot_change_date TIMESTAMP,
  ADD COLUMN IF NOT EXISTS daily_toggle_counts JSON DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS last_toggle_date TIMESTAMP;

UPDATE clinic_time_slots
SET slots = '[]'
WHERE slots IS NULL;

UPDATE clinic_time_slots
SET slot = '{}'
WHERE slot IS NULL;

UPDATE clinic_time_slots
SET daily_toggle_counts = '[]'
WHERE daily_toggle_counts IS NULL;
