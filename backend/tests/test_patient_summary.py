"""Tests for the programmatic patient summary builder.

Verifies that the patient summary derives from SOAP only, does not
reinterpret the raw transcript, and follows all architectural rules.
"""

from __future__ import annotations

import json
import unittest
from typing import Any

from app.services.patient_summary import build_patient_summary


def _make_soap(**overrides: Any) -> dict[str, Any]:
    """Create a baseline empty SOAP record with override support."""
    soap = {
        "schema_version": "1.0",
        "subjective": {
            "chief_complaints": [],
            "history_of_present_illness": None,
            "symptoms": [],
            "associated_symptoms": [],
            "relevant_negatives": [],
            "medical_conditions": [],
            "previous_surgeries": [],
            "allergies": [],
            "current_medicines": [],
            "family_history": [],
            "social_history": [],
        },
        "objective": {
            "vitals": {
                "temperature": {"value": None, "unit": None, "source": None},
                "blood_pressure": {"systolic": None, "diastolic": None, "unit": "mmHg", "source": None},
                "pulse": {"value": None, "unit": "bpm", "source": None},
                "respiratory_rate": {"value": None, "unit": "breaths/min", "source": None},
                "spo2": {"value": None, "unit": "%", "source": None},
                "height": {"value": None, "unit": None, "source": None},
                "weight": {"value": None, "unit": None, "source": None},
                "bmi": {"value": None, "source": None},
            },
            "examination_findings": [],
            "available_test_results": [],
        },
        "assessment": {
            "clinical_impression": [],
            "provisional_diagnoses": [],
            "confirmed_diagnoses": [],
            "differential_diagnoses": [],
            "diagnosis_status": "not_stated",
        },
        "plan": {
            "prescriptions": [],
            "tests_ordered": [],
            "procedures": [],
            "treatment_advice": [],
            "diet_and_hydration_advice": [],
            "referrals": [],
            "follow_up": None,
            "warning_signs": [],
            "other_instructions": [],
        },
        "additional_clinical_information": [],
    }
    for key, val in overrides.items():
        _deep_set(soap, key, val)
    return soap


def _deep_set(obj: Any, path: str, value: Any) -> None:
    parts = path.split(".")
    for part in parts[:-1]:
        obj = obj.get(part, {})
    if isinstance(obj, dict):
        obj[parts[-1]] = value


class PatientSummaryArchitectureTests(unittest.TestCase):
    """Architectural tests — the summary must derive from SOAP, not transcript."""

    def test_summary_is_empty_when_soap_is_empty(self):
        soap = _make_soap()
        summary = build_patient_summary(soap)
        self.assertEqual(summary, {})

    def test_summary_never_invents_diagnosis(self):
        soap = _make_soap()
        summary = build_patient_summary(soap)
        self.assertNotIn("visit_summary", summary)

    def test_summary_derives_visit_summary_from_doctor_assessment(self):
        soap = _make_soap(
            **{"assessment.provisional_diagnoses": ["Viral fever"]}
        )
        summary = build_patient_summary(soap)
        self.assertEqual(summary["visit_summary"], "Viral fever")

    def test_summary_does_not_reinterpret_transcript_independently(self):
        soap = _make_soap(
            **{"assessment.provisional_diagnoses": ["Viral fever"]}
        )
        summary = build_patient_summary(soap)
        self.assertEqual(summary["visit_summary"], "Viral fever")

    def test_empty_assessment_means_no_visit_summary(self):
        soap = _make_soap(
            **{"subjective.chief_complaints": ["Fever", "Cough"]}
        )
        summary = build_patient_summary(soap)
        self.assertNotIn("visit_summary", summary)


class PatientSummaryMedicinesTests(unittest.TestCase):
    """Tests for medicine display logic."""

    def test_new_prescription_shows_in_medicines(self):
        soap = _make_soap(
            **{"plan.prescriptions": [{
                "medicine_name": "Dolo 650",
                "strength": "650 mg",
                "dose": "1 tablet",
                "frequency": "Twice daily",
                "meal_timing": "After food",
                "duration": "3 days",
                "action": "START",
            }]}
        )
        summary = build_patient_summary(soap)
        self.assertIn("medicines", summary)
        self.assertEqual(len(summary["medicines"]), 1)
        med = summary["medicines"][0]
        self.assertEqual(med["medicine_name"], "Dolo 650")
        self.assertEqual(med["strength"], "650 mg")
        self.assertEqual(med["dose"], "1 tablet")
        self.assertEqual(med["meal_timing"], "After food")
        self.assertEqual(med["action"], "START")

    def test_patient_medicine_summary_omits_instruction_column_data(self):
        soap = _make_soap(**{"plan.prescriptions": [{
            "medicine_name": "Dolo 650",
            "dosage_form": "tablet",
            "dose": "one tablet",
            "route": "oral",
            "specific_timing": "at night",
            "meal_timing": "after food",
            "instructions": "swallow with water",
        }]})
        med = build_patient_summary(soap)["medicines"][0]
        self.assertEqual(med["dosage_form"], "tablet")
        self.assertEqual(med["route"], "oral")
        self.assertEqual(med["specific_timing"], "at night")
        self.assertEqual(med["meal_timing"], "after food")
        self.assertNotIn("instructions", med)

    def test_patient_medicine_fields_exactly_mirror_plan_prescription(self):
        prescription = {
            "medicine_name": "Dolo 650",
            "dose": "one tablet",
            "specific_timing": "Lunch",
            "meal_timing": "After food",
            "schedule": {"morning": None, "afternoon": "Lunch", "night": None},
            "duration": "for three days",
        }
        soap = _make_soap(**{"plan.prescriptions": [prescription]})

        medicine = build_patient_summary(soap)["medicines"][0]

        for field in (
            "medicine_name", "dose", "specific_timing", "meal_timing", "duration"
        ):
            self.assertEqual(medicine[field], prescription[field])
        self.assertEqual(
            medicine["schedule"],
            {"afternoon": prescription["schedule"]["afternoon"]},
        )

    def test_patient_current_medication_does_not_appear_as_new_prescription(self):
        soap = _make_soap(
            **{"subjective.current_medicines": ["Metformin 500 mg every morning"]}
        )
        summary = build_patient_summary(soap)
        if "medicines" in summary:
            for med in summary["medicines"]:
                self.assertNotEqual(med.get("medicine", "").lower(), "metformin")

    def test_no_medicines_when_prescriptions_empty(self):
        soap = _make_soap()
        summary = build_patient_summary(soap)
        self.assertNotIn("medicines", summary)

    def test_prn_indication_included_when_present(self):
        soap = _make_soap(
            **{"plan.prescriptions": [{
                "medicine_name": "Paracetamol",
                "strength": "500 mg",
                "dose": "1 tablet",
                "as_needed": True,
                "indication": "For fever when needed",
            }]}
        )
        summary = build_patient_summary(soap)
        self.assertEqual(len(summary["medicines"]), 1)
        self.assertIn("prn_condition", summary["medicines"][0])

    def test_missing_attributes_not_fabricated(self):
        soap = _make_soap(
            **{"plan.prescriptions": [{
                "medicine_name": "Dolo 650",
                "strength": None,
                "dose": None,
                "frequency": None,
                "meal_timing": None,
                "duration": None,
            }]}
        )
        summary = build_patient_summary(soap)
        med = summary["medicines"][0]
        self.assertEqual(med["medicine_name"], "Dolo 650")
        self.assertNotIn("strength", med)
        self.assertNotIn("dose", med)
        self.assertNotIn("frequency", med)
        self.assertNotIn("meal_relation", med)
        self.assertNotIn("duration", med)


class PatientSummarySectionsTests(unittest.TestCase):
    """Tests for section population logic."""

    def test_tests_section_from_plan(self):
        soap = _make_soap(
            **{"plan.tests_ordered": ["CBC", "Chest X-ray"]}
        )
        summary = build_patient_summary(soap)
        self.assertEqual(summary["tests"], ["CBC", "Chest X-ray"])

    def test_diet_and_care_combines_treatment_and_diet_advice(self):
        soap = _make_soap(
            **{
                "plan.treatment_advice": ["Rest", "Steam inhalation"],
                "plan.diet_and_hydration_advice": ["Drink warm fluids", "Avoid spicy food"],
            }
        )
        summary = build_patient_summary(soap)
        self.assertIn("diet_and_care", summary)
        self.assertIn("Rest", summary["diet_and_care"])
        self.assertIn("Drink warm fluids", summary["diet_and_care"])

    def test_empty_sections_are_omitted(self):
        soap = _make_soap(
            **{"plan.follow_up": "Review after 5 days"}
        )
        summary = build_patient_summary(soap)
        self.assertNotIn("tests", summary)
        self.assertNotIn("medicines", summary)
        self.assertNotIn("diet_and_care", summary)
        self.assertNotIn("monitoring", summary)
        self.assertNotIn("when_to_seek_help", summary)
        self.assertEqual(summary["follow_up"], "Review after 5 days")

    def test_monitoring_section_from_plan_monitoring(self):
        soap = _make_soap(
            **{"plan.monitoring": ["Monitor temperature twice daily"]}
        )
        summary = build_patient_summary(soap)
        self.assertIn("monitoring", summary)
        self.assertIn("Monitor temperature twice daily", summary["monitoring"])

    def test_monitoring_not_invented_from_treatment_advice(self):
        soap = _make_soap(
            **{"plan.treatment_advice": ["Monitor temperature twice daily"]}
        )
        summary = build_patient_summary(soap)
        self.assertNotIn("monitoring", summary)

    def test_remaining_patient_facing_plan_sections_are_preserved(self):
        soap = _make_soap(**{
            "plan.procedures": ["Steam inhalation in clinic"],
            "plan.referrals": ["See the cardiologist"],
            "plan.other_instructions": ["Bring previous reports"],
        })
        summary = build_patient_summary(soap)
        self.assertEqual(summary["procedures"], ["Steam inhalation in clinic"])
        self.assertEqual(summary["referrals"], ["See the cardiologist"])
        self.assertEqual(summary["other_instructions"], ["Bring previous reports"])

    def test_approved_soap_full_plan_maps_to_only_patient_sections(self):
        soap = _make_soap(**{
            "assessment.provisional_diagnosis": ["Viral infection"],
            "plan.prescriptions": [{"medicine_name": "Dolo 650", "frequency": "Twice daily", "meal_timing": "After food", "duration": "3 days", "action": "START"}],
            "plan.diet_lifestyle_advice": ["Drink plenty of fluids"],
            "plan.monitoring": ["Monitor temperature twice daily"],
            "plan.warning_signs": ["If breathing difficulty develops, go to the hospital"],
            "plan.follow_up": "Come back after five days",
        })
        summary = build_patient_summary(soap)
        self.assertEqual(set(summary), {"visit_summary", "medicines", "diet_and_care", "monitoring", "when_to_seek_help", "follow_up"})
        self.assertNotIn("not mentioned", json.dumps(summary).lower())


class PatientSummaryWarningSignsTests(unittest.TestCase):
    """Warning signs must preserve condition + action."""

    def test_warning_sign_preserves_condition_and_action(self):
        soap = _make_soap(
            **{"plan.warning_signs": [
                "If breathing difficulty develops, go to the hospital immediately."
            ]}
        )
        summary = build_patient_summary(soap)
        self.assertIn("when_to_seek_help", summary)
        ws = summary["when_to_seek_help"][0]
        self.assertEqual(ws["condition"].lower(), "breathing difficulty develops")
        self.assertIn("go to", ws["action"].lower())
        self.assertEqual(ws["urgency"], "immediate")

    def test_warning_sign_never_reduces_to_just_condition(self):
        soap = _make_soap(
            **{"plan.warning_signs": [
                "Difficulty breathing -> Go to the hospital immediately."
            ]}
        )
        summary = build_patient_summary(soap)
        self.assertIn("when_to_seek_help", summary)
        ws = summary["when_to_seek_help"][0]
        self.assertIsNone(ws.get("action"))
        self.assertIsNone(ws.get("condition"))
        self.assertEqual(ws["raw_instruction"], "Difficulty breathing -> Go to the hospital immediately.")

    def test_multiple_warning_signs_all_preserved(self):
        soap = _make_soap(
            **{"plan.warning_signs": [
                "If fever worsens, seek medical attention",
                "If chest pain develops, go to emergency",
            ]}
        )
        summary = build_patient_summary(soap)
        self.assertEqual(len(summary["when_to_seek_help"]), 2)

    def test_warning_sign_with_urgency_immediate(self):
        soap = _make_soap(
            **{"plan.warning_signs": [
                "If breathing difficulty develops, go to the hospital immediately."
            ]}
        )
        summary = build_patient_summary(soap)
        ws = summary["when_to_seek_help"][0]
        self.assertEqual(ws["urgency"], "immediate")

    def test_warning_sign_unparseable_preserves_raw_instruction(self):
        soap = _make_soap(
            **{"plan.warning_signs": ["High fever"]}
        )
        summary = build_patient_summary(soap)
        ws = summary["when_to_seek_help"][0]
        self.assertIsNone(ws["condition"])
        self.assertIsNone(ws["action"])
        self.assertEqual(ws["raw_instruction"], "High fever")


class PatientSummaryFollowUpTests(unittest.TestCase):
    """Follow-up clarity tests."""

    def test_follow_up_included_when_present(self):
        soap = _make_soap(
            **{"plan.follow_up": "Review after 5 days"}
        )
        summary = build_patient_summary(soap)
        self.assertEqual(summary["follow_up"], "Review after 5 days")

    def test_follow_up_absent_when_not_stated(self):
        soap = _make_soap()
        summary = build_patient_summary(soap)
        self.assertNotIn("follow_up", summary)

    def test_conditional_earlier_return_in_follow_up(self):
        soap = _make_soap(
            **{"plan.follow_up": "Review after 5 days. Return earlier if fever worsens."}
        )
        summary = build_patient_summary(soap)
        self.assertIn("5 days", summary["follow_up"])
        self.assertIn("fever worsens", summary["follow_up"])


class PatientSummaryNoHallucinationTests(unittest.TestCase):
    """The summary must not fabricate information."""

    def test_no_extra_medical_advice(self):
        soap = _make_soap(
            **{"assessment.provisional_diagnoses": ["Viral fever"]}
        )
        summary = build_patient_summary(soap)
        text = json.dumps(summary).lower()
        self.assertNotIn("drink water", text)
        self.assertNotIn("take rest", text)

    def test_no_newly_created_warning_signs(self):
        soap = _make_soap(
            **{"plan.follow_up": "Review after 5 days"}
        )
        summary = build_patient_summary(soap)
        self.assertNotIn("when_to_seek_help", summary)

    def test_no_evidence_ids_in_summary(self):
        soap = _make_soap(
            **{"plan.warning_signs": ["If breathing difficulty, go to hospital"]}
        )
        summary = build_patient_summary(soap)
        text = json.dumps(summary)
        self.assertNotIn("E001", text)
        self.assertNotIn("evidence", text)

    def test_no_soap_terminology_in_output(self):
        soap = _make_soap(
            **{"assessment.provisional_diagnoses": ["Viral fever"]}
        )
        summary = build_patient_summary(soap)
        text = json.dumps(summary).lower()
        self.assertNotIn("subjective", text)
        self.assertNotIn("objective", text)
        self.assertNotIn("assessment", text)



class PatientSummaryHardeningTests(unittest.TestCase):
    """Hardening pass — safety and edge-case tests."""

    def test_clinical_impression_included_when_no_diagnoses(self):
        soap = _make_soap(
            **{"assessment.clinical_impression": ["Fever likely viral"]}
        )
        summary = build_patient_summary(soap)
        self.assertEqual(summary["visit_summary"], "Fever likely viral")

    def test_confirmed_diagnosis_takes_priority(self):
        soap = _make_soap(
            **{
                "assessment.confirmed_diagnoses": ["Viral fever"],
                "assessment.provisional_diagnoses": ["Typhoid suspected"],
                "assessment.clinical_impression": ["Fever likely viral"],
            }
        )
        summary = build_patient_summary(soap)
        self.assertEqual(summary["visit_summary"], "Viral fever")

    def test_visit_summary_excludes_differential_diagnoses(self):
        soap = _make_soap(
            **{
                "assessment.confirmed_diagnoses": ["Viral fever"],
                "assessment.differential_diagnoses": ["Typhoid", "UTI"],
            }
        )
        summary = build_patient_summary(soap)
        self.assertNotIn("Typhoid", summary["visit_summary"])
        self.assertNotIn("UTI", summary["visit_summary"])

    def test_empty_assessment_means_no_visit_summary(self):
        soap = _make_soap(
            **{"assessment.confirmed_diagnoses": []}
        )
        summary = build_patient_summary(soap)
        self.assertNotIn("visit_summary", summary)

    def test_monitoring_trusts_plan_field_directly(self):
        soap = _make_soap(
            **{"plan.monitoring": ["Check blood sugar daily", "Weigh yourself weekly"]}
        )
        summary = build_patient_summary(soap)
        self.assertEqual(summary["monitoring"], ["Check blood sugar daily", "Weigh yourself weekly"])

    def test_monitoring_not_invented_from_non_monitoring_plan_content(self):
        soap = _make_soap(
            **{"plan.treatment_advice": ["Take rest", "Steam inhalation"]}
        )
        summary = build_patient_summary(soap)
        self.assertNotIn("monitoring", summary)

    def test_warning_sign_fallback_preserves_raw_text_no_invented_action(self):
        soap = _make_soap(
            **{"plan.warning_signs": ["If fever continues"]}
        )
        summary = build_patient_summary(soap)
        ws = summary["when_to_seek_help"][0]
        self.assertIsNone(ws["action"])
        self.assertEqual(ws["raw_instruction"], "If fever continues")

    def test_no_see_a_doctor_anywhere(self):
        soap = _make_soap(
            **{"plan.warning_signs": ["Watch for worsening symptoms."]}
        )
        summary = build_patient_summary(soap)
        text = json.dumps(summary).lower()
        self.assertNotIn("see a doctor", text)
        self.assertNotIn("see your doctor", text)
        self.assertNotIn("consult a doctor", text)

    def test_visit_summary_deduplicates_near_identical(self):
        soap = _make_soap(
            **{
                "assessment.confirmed_diagnoses": ["Viral fever", "Viral Fever"],
                "assessment.provisional_diagnoses": ["viral fever"],
            }
        )
        summary = build_patient_summary(soap)
        parts = summary["visit_summary"].split("; ")
        self.assertEqual(len(parts), 1)
        self.assertEqual(summary["visit_summary"], "Viral fever")


if __name__ == "__main__":
    unittest.main()
