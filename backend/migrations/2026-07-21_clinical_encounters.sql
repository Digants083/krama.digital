CREATE TABLE IF NOT EXISTS clinical_encounters (
    id SERIAL PRIMARY KEY,
    encounter_id VARCHAR UNIQUE NOT NULL,
    clinic_id VARCHAR NOT NULL,
    patient_id VARCHAR NOT NULL,
    doctor_id VARCHAR,
    appointment_id INTEGER,
    patient_name VARCHAR NOT NULL,
    patient_phone VARCHAR,
    patient_email VARCHAR,
    transcript_text TEXT NOT NULL,
    transcript_segments JSON NOT NULL DEFAULT '[]',
    ehr_data JSON NOT NULL DEFAULT '{}',
    patient_summary JSON NOT NULL DEFAULT '{}',
    status VARCHAR NOT NULL DEFAULT 'draft',
    model_name VARCHAR,
    generation_error TEXT,
    approved_at TIMESTAMP,
    approved_by VARCHAR,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_clinical_encounters_clinic_patient
    ON clinical_encounters(clinic_id, patient_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_clinical_encounters_appointment
    ON clinical_encounters(appointment_id);
CREATE INDEX IF NOT EXISTS idx_clinical_encounters_doctor
    ON clinical_encounters(doctor_id);

CREATE TABLE IF NOT EXISTS ehr_audit_events (
    id SERIAL PRIMARY KEY,
    encounter_id VARCHAR NOT NULL,
    clinic_id VARCHAR NOT NULL,
    patient_id VARCHAR NOT NULL,
    actor_type VARCHAR NOT NULL,
    actor_id VARCHAR,
    action VARCHAR NOT NULL,
    snapshot JSON NOT NULL DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ehr_audit_encounter
    ON ehr_audit_events(encounter_id, created_at DESC);
