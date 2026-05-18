ALTER TABLE appointments
    ADD COLUMN IF NOT EXISTS serving_started_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS session_id INTEGER;

ALTER TABLE qr_appointments
    ADD COLUMN IF NOT EXISTS serving_started_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS session_id INTEGER;

ALTER TABLE completed_appointments
    ADD COLUMN IF NOT EXISTS doctor_id VARCHAR,
    ADD COLUMN IF NOT EXISTS session_id INTEGER,
    ADD COLUMN IF NOT EXISTS serving_started_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS service_duration_seconds INTEGER,
    ADD COLUMN IF NOT EXISTS consultation_duration_minutes INTEGER;

UPDATE completed_appointments
SET completed_at = finished_at
WHERE completed_at IS NULL
  AND finished_at IS NOT NULL;

UPDATE completed_appointments
SET serving_started_at = served_at
WHERE serving_started_at IS NULL
  AND served_at IS NOT NULL;

UPDATE completed_appointments
SET consultation_duration_minutes = GREATEST(1, CEIL(service_duration_seconds / 60.0)::INTEGER)
WHERE consultation_duration_minutes IS NULL
  AND service_duration_seconds IS NOT NULL
  AND service_duration_seconds > 0;

CREATE INDEX IF NOT EXISTS idx_appointments_queue_eta
    ON appointments(clinic_id, date, slot_id, status, queue_position);

CREATE INDEX IF NOT EXISTS idx_appointments_serving_started_at
    ON appointments(serving_started_at);

CREATE INDEX IF NOT EXISTS idx_appointments_session_id
    ON appointments(session_id);

CREATE INDEX IF NOT EXISTS idx_qr_appointments_queue_eta
    ON qr_appointments(clinic_id, date, slot_id, status, queue_position);

CREATE INDEX IF NOT EXISTS idx_qr_appointments_serving_started_at
    ON qr_appointments(serving_started_at);

CREATE INDEX IF NOT EXISTS idx_qr_appointments_session_id
    ON qr_appointments(session_id);

CREATE INDEX IF NOT EXISTS idx_completed_appointments_eta_history
    ON completed_appointments(clinic_id, date, slot_id, completed_at DESC);

CREATE INDEX IF NOT EXISTS idx_completed_appointments_serving_started_at
    ON completed_appointments(serving_started_at);

CREATE INDEX IF NOT EXISTS idx_completed_appointments_status
    ON completed_appointments(status);

CREATE INDEX IF NOT EXISTS idx_completed_appointments_session_id
    ON completed_appointments(session_id);

CREATE INDEX IF NOT EXISTS idx_completed_appointments_doctor_id
    ON completed_appointments(doctor_id);

CREATE INDEX IF NOT EXISTS idx_doctor_sessions_doctor_id
    ON doctor_sessions(doctor_id);

CREATE INDEX IF NOT EXISTS idx_doctor_sessions_eta
    ON doctor_sessions(clinic_id, slot_id, session_date, status);
