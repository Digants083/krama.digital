ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS report_pdf_filename VARCHAR,
  ADD COLUMN IF NOT EXISTS report_pdf_content_type VARCHAR,
  ADD COLUMN IF NOT EXISTS report_pdf_data BYTEA;

ALTER TABLE completed_reports
  ADD COLUMN IF NOT EXISTS report_pdf_filename VARCHAR,
  ADD COLUMN IF NOT EXISTS report_pdf_content_type VARCHAR,
  ADD COLUMN IF NOT EXISTS report_pdf_data BYTEA;
