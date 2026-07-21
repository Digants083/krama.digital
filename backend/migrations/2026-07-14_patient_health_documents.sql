CREATE TABLE IF NOT EXISTS patient_health_documents (
    id SERIAL PRIMARY KEY,
    patient_id VARCHAR NOT NULL,
    source VARCHAR NOT NULL DEFAULT 'patient_upload',
    document_type VARCHAR NOT NULL DEFAULT 'medical_report',
    filename VARCHAR NOT NULL,
    content_type VARCHAR NOT NULL,
    file_data BYTEA NOT NULL,
    processing_status VARCHAR NOT NULL DEFAULT 'uploaded',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_patient_health_documents_patient_id
    ON patient_health_documents(patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_health_documents_status
    ON patient_health_documents(processing_status);
