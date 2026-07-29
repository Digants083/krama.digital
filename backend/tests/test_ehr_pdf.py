import re
import unittest
from datetime import datetime

from app.services.ehr_pdf import (
    _medicine_meal_code,
    _medicine_when_to_take,
    build_ehr_pdf,
)


class EhrPdfTests(unittest.TestCase):
    def test_medicine_timing_and_meal_relation_are_separate(self):
        item = {"specific_timing": "after lunch"}
        self.assertEqual(_medicine_when_to_take(item), "Lunch")
        self.assertEqual(_medicine_meal_code(item), "AF")

    def test_unknown_timing_is_not_rendered_as_when_to_take(self):
        self.assertEqual(
            _medicine_when_to_take({"specific_timing": "take with water"}),
            "",
        )

    def test_soap_pdf_uses_three_page_clinical_layout(self):
        ehr_data = {
            "schema_version": "1.0",
            "subjective": {
                "chief_complaints": [
                    {"complaint": "Fever", "duration": "2 days"},
                    {"complaint": "Headache", "duration": "1 day"},
                ],
                "history_of_present_illness": "Fever for 2 days.",
                "symptoms": [
                    {"name": "Fever", "duration": "2 days", "source": "patient_reported"},
                    {"name": "Headache", "duration": "1 day", "severity": "mild", "source": "patient_reported"},
                ],
                "allergies": ["Dust allergy"],
                "current_medications": [{"name": "Metformin"}],
            },
            "objective": {
                "vitals": {"temperature": {"value": "99", "unit": "F"}},
            },
            "assessment": {
                "clinical_impression": "Viral illness",
                "provisional_diagnosis": ["Viral illness"],
            },
            "plan": {
                "prescriptions": [{
                    "medicine_name": "Dolo 650",
                    "dose": "1 tablet",
                    "specific_timing": "Lunch",
                    "meal_timing": "After food",
                    "duration": "3 days",
                }],
                "follow_up": "Return after 3 days.",
            },
        }

        pdf = build_ehr_pdf(
            encounter={
                "encounter_id": "EHR-TEST",
                "status": "approved",
                "approved_at": datetime(2026, 7, 26, 10, 30),
            },
            ehr_data=ehr_data,
            clinic={"name": "Krama Clinic", "address": "Bengaluru"},
            patient={"name": "Test Patient", "patient_id": "PA-TEST", "phone": "9999999999"},
            doctor={"name": "Test Doctor"},
            visit={"date": "2026-07-26", "time": "10:00"},
        )

        self.assertTrue(pdf.startswith(b"%PDF-"))
        self.assertEqual(len(re.findall(rb"/Type\s*/Page\b", pdf)), 3)


if __name__ == "__main__":
    unittest.main()
