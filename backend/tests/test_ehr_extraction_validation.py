"""Tests for EHR extraction validation and patient summary generation.

Verifies that:
- SOAP normalization is correct
- Validation fixes transcript-grounding issues
- Patient summary derives correctly from SOAP
- Completeness review does not mutate SOAP
"""

from __future__ import annotations

import unittest
from typing import Any

from app.routers.ehr import (
    _build_doctor_ehr_view,
    _doctor_texts,
    _empty_patient_summary,
    _empty_soap_ehr,
    _generate_patient_summary_from_soap,
    _is_supported_by_doctor_evidence,
    _normalize_soap_ehr,
    _normalize_patient_summary,
    _strip_unsupported_clinical_content,
    _validate_and_fix_soap_coverage,
)
from app.services.soap_rag import retrieve_soap_context


def _empty_ehr() -> dict[str, Any]:
    return _empty_soap_ehr()


class EhrNormalizationTests(unittest.TestCase):
    """Tests for basic SOAP normalization."""

    def test_empty_soap_has_all_required_sections(self):
        ehr = _empty_soap_ehr()
        self.assertEqual(ehr["schema_version"], "1.2")
        self.assertIn("subjective", ehr)
        self.assertIn("objective", ehr)
        self.assertIn("assessment", ehr)
        self.assertIn("plan", ehr)
        self.assertIn("visit_details", ehr)
        self.assertIn("approval", ehr)
        self.assertEqual(ehr["subjective"]["family_history"], [])
        self.assertEqual(ehr["subjective"]["social_history"], [])

    def test_normalize_soap_cleans_none_and_null_strings(self):
        raw = {
            "subjective": {
                "chief_complaints": ["Fever", None, "null", "Cough", ""],
                "history_of_present_illness": "Fever for 2 days",
                "symptoms": [],
            },
            "objective": {"vitals": {}, "examination_findings": [], "available_test_results": []},
            "assessment": {},
            "plan": {},
        }
        result = _normalize_soap_ehr(raw)
        self.assertEqual(
            result["subjective"]["chief_complaints"],
            [
                {"complaint": "Fever", "duration": None},
                {"complaint": "Cough", "duration": None},
            ],
        )
        self.assertNotIn("symptoms", result["subjective"])

    def test_normalize_merges_legacy_symptoms_into_structured_chief_complaints(self):
        raw = {
            "subjective": {
                "chief_complaints": [
                    {"complaint": "Fever", "severity": "severe", "course": "continuous", "duration": "one week"},
                    {"complaint": "Headache", "severity": "mild", "duration": "one week"},
                ],
                "symptoms": [
                    {"name": "Headache", "frequency": "intermittent"},
                    {"name": "Throat infection", "duration": None},
                ],
            }
        }
        result = _normalize_soap_ehr(raw)
        self.assertEqual(result["subjective"]["chief_complaints"], [
            {"complaint": "Fever", "duration": "one week"},
            {"complaint": "Headache", "duration": "one week"},
            {"complaint": "Throat infection", "duration": None},
        ])
        self.assertNotIn("symptoms", result["subjective"])

    def test_normalize_removes_legacy_severity_and_course_fields(self):
        result = _normalize_soap_ehr({
            "subjective": {"chief_complaints": [{
                "complaint": "Headache", "severity": "slight", "course": "fluctuating", "duration": None,
            }]}
        })
        self.assertEqual(result["subjective"]["chief_complaints"], [{
            "complaint": "Headache", "duration": None,
        }])

    def test_normalize_soap_handles_empty_input(self):
        result = _normalize_soap_ehr({})
        self.assertEqual(result["subjective"]["chief_complaints"], [])
        self.assertIsNone(result["subjective"]["history_of_present_illness"])


class EhrValidationTests(unittest.TestCase):
    """Tests for transcript-grounding validation."""

    def test_doctor_question_is_not_a_patient_fact(self):
        ehr = _empty_ehr()
        transcript = (
            "Doctor: Are you taking Telmisartan 40 mg?\n"
            "Patient: I did not answer that question."
        )
        result = _validate_and_fix_soap_coverage(ehr, transcript)
        self.assertTrue(
            all("telmisartan" not in str(item).lower() for item in result.get("subjective", {}).get("current_medications", []))
        )

    def test_prescription_keeps_only_spoken_details(self):
        ehr = _empty_ehr()
        ehr["plan"]["prescriptions"] = [{
            "medicine_name": "Dolo 650", "strength": "650 mg", "dose": "1 tablet",
            "route": None, "frequency": "Every 8 hours", "schedule": {"morning": None, "afternoon": None, "night": None},
            "specific_timing": None, "meal_timing": None, "dosage_form": None,
            "duration": "3 days", "prn_condition": None, "indication": None,
            "instructions": None, "action": "START",
        }]
        transcript = (
            "Doctor: Take Dolo 650 one tablet every 8 hours after food for 3 days."
        )
        result = _validate_and_fix_soap_coverage(ehr, transcript)
        self.assertEqual(len(result["plan"]["prescriptions"]), 1)
        rx = result["plan"]["prescriptions"][0]
        self.assertEqual(rx["medicine_name"], "Dolo 650")
        self.assertEqual(rx["dose"], "one tablet")

    def test_explicit_diet_advice_is_routed_without_changing_text(self):
        transcript = "Doctor: Drink plenty of fluids. Avoid oily food. Take adequate rest."
        ehr = _empty_ehr()
        ehr["plan"]["treatment_advice"] = [
            "Drink plenty of fluids.", "Avoid oily food.", "Take adequate rest."
        ]
        evidence = retrieve_soap_context(transcript)["evidence"]
        result = _validate_and_fix_soap_coverage(ehr, transcript, evidence)
        self.assertEqual(result["plan"]["diet_lifestyle_advice"], [
            "Drink plenty of fluids.", "Avoid oily food."
        ])
        self.assertEqual(result["plan"]["treatment_advice"], ["Take adequate rest."])

    def test_doctor_medication_action_and_warning_instruction_are_preserved(self):
        transcript = (
            "Doctor: Start Dolo 650 twice daily after food for three days.\n"
            "Doctor: If breathing difficulty develops, go to the hospital immediately."
        )
        ehr = _empty_ehr()
        ehr["plan"]["prescriptions"] = [{
            "medicine_name": "Dolo 650", "frequency": "twice daily",
            "meal_timing": "after food", "duration": "three days", "action": "START",
        }]
        ehr["plan"]["warning_signs"] = ["Breathing difficulty"]
        evidence = retrieve_soap_context(transcript)["evidence"]
        result = _validate_and_fix_soap_coverage(ehr, transcript, evidence)
        self.assertEqual(result["plan"]["prescriptions"][0]["action"], "START")
        self.assertEqual(
            result["plan"]["warning_signs"][0],
            "If breathing difficulty develops, go to the hospital immediately.",
        )

    def test_follow_up_and_warning_signs_stay_separate(self):
        ehr = _empty_ehr()
        ehr["plan"]["follow_up"] = "Come back in 3 days if not improving."
        ehr["plan"]["warning_signs"] = ["Breathing difficulty", "Persistent vomiting"]
        transcript = (
            "Doctor: Come back in 3 days if not improving. "
            "Seek urgent care for breathing difficulty or persistent vomiting."
        )
        result = _validate_and_fix_soap_coverage(ehr, transcript)
        self.assertIsNotNone(result["plan"]["follow_up"])
        self.assertTrue(result["plan"]["warning_signs"])

    def test_relevant_negatives_remain_negated(self):
        ehr = _empty_ehr()
        ehr["subjective"]["relevant_negatives"] = ["No breathing difficulty", "No diabetes"]
        transcript = "Patient: I have no breathing difficulty. I do not have diabetes."
        result = _validate_and_fix_soap_coverage(ehr, transcript)
        self.assertTrue(all(
            any(neg in item.lower() for neg in ("no", "not", "never", "denies", "denied"))
            for item in result["subjective"]["relevant_negatives"]
        ))

    def test_conditional_prescription_is_prn(self):
        ehr = _empty_ehr()
        ehr["plan"]["prescriptions"] = [{
            "medicine_name": "Dolo 650", "strength": "650 mg", "dose": "one tablet",
            "route": None, "frequency": "every eight hours", "schedule": {"morning": None, "afternoon": None, "night": None},
            "specific_timing": None, "meal_timing": None, "dosage_form": None,
            "duration": "three days", "prn_condition": None, "indication": None,
            "instructions": None, "action": "START",
        }]
        transcript = (
            "Doctor: This sounds like a viral illness. "
            "Take Dolo 650 one tablet every eight hours after food for three days if fever persists."
        )
        result = _validate_and_fix_soap_coverage(ehr, transcript)
        self.assertEqual(len(result["plan"]["prescriptions"]), 1)

    def test_unchanged_ehr_preserves_original_structure(self):
        ehr = _empty_ehr()
        original_cc = [{"complaint": "Fever", "duration": None}]
        ehr["subjective"]["chief_complaints"] = original_cc
        result = _validate_and_fix_soap_coverage(ehr, "Patient: I have fever.")
        self.assertEqual(result["subjective"]["chief_complaints"], original_cc)


class EhrPatientSummaryTests(unittest.TestCase):
    """Tests for patient summary generation from SOAP."""

    def test_summary_derives_assessment_from_doctor_diagnosis(self):
        ehr = _empty_ehr()
        ehr["assessment"]["provisional_diagnosis"] = ["Viral fever"]
        summary = _generate_patient_summary_from_soap(ehr)
        self.assertEqual(summary["visit_summary"], "Viral fever")

    def test_summary_shows_empty_assessment_when_no_diagnosis(self):
        ehr = _empty_ehr()
        ehr["subjective"]["chief_complaints"] = [{"complaint": "Fever", "duration": None}]
        summary = _generate_patient_summary_from_soap(ehr)
        self.assertNotIn("visit_summary", summary)

    def test_summary_medicines_from_prescriptions(self):
        ehr = _empty_ehr()
        ehr["plan"]["prescriptions"] = [{
            "medicine_name": "Dolo 650", "strength": "650 mg", "dose": "1 tablet",
            "route": None, "frequency": "Twice daily", "schedule": {"morning": None, "afternoon": None, "night": None},
            "specific_timing": None, "meal_timing": None, "dosage_form": None,
            "duration": "3 days", "prn_condition": None, "indication": None,
            "instructions": None, "action": "START",
        }]
        summary = _generate_patient_summary_from_soap(ehr)
        self.assertEqual(len(summary["medicines"]), 1)

    def test_summary_diet_and_hydration_advice(self):
        ehr = _empty_ehr()
        ehr["plan"]["treatment_advice"] = ["Drink warm fluids"]
        summary = _generate_patient_summary_from_soap(ehr)
        self.assertEqual(summary["diet_and_care"], ["Care instructions: Drink warm fluids."])

    def test_summary_follow_up_from_plan(self):
        ehr = _empty_ehr()
        ehr["plan"]["follow_up"] = "Review after 5 days"
        summary = _generate_patient_summary_from_soap(ehr)
        self.assertEqual(summary["follow_up"], "Review after 5 days")

    def test_summary_warning_signs_preserved(self):
        ehr = _empty_ehr()
        ehr["plan"]["warning_signs"] = ["If breathing difficulty, go to hospital"]
        summary = _generate_patient_summary_from_soap(ehr)
        self.assertTrue(len(summary["when_to_seek_help"]) > 0)

    def test_empty_summary_contract(self):
        summary = _empty_patient_summary()
        self.assertEqual(summary, {})

    def test_draft_summary_does_not_contain_null_strings(self):
        ehr = _empty_ehr()
        summary = _generate_patient_summary_from_soap(ehr)
        text = str(summary).lower()
        self.assertNotIn(" 'null'", text)
        self.assertNotIn(" 'none'", text)


class EhrNormalizePatientSummaryTests(unittest.TestCase):
    """Tests for patient summary normalization."""

    def test_normalize_patient_summary_new_format(self):
        summary = {
            "reason_for_visit": "Fever",
            "what_the_doctor_assessed": "Viral fever",
            "medicines": ["Dolo 650"],
            "tests": [],
            "diet_and_hydration_advice": ["Rest"],
            "doctor_instructions": [],
            "follow_up": "3 days",
            "when_to_seek_help": [],
        }
        result = _normalize_patient_summary(summary)
        self.assertEqual(result["visit_summary"], "Viral fever")

    def test_normalize_patient_summary_old_format_exclusive(self):
        summary = {
            "visit_overview": "Fever for 2 days",
            "diet_advice": ["Rest"],
            "doctor_suggestions": ["Take rest"],
            "warning_signs": ["Breathing difficulty"],
        }
        result = _normalize_patient_summary(summary)
        self.assertEqual(result["visit_summary"], "Fever for 2 days")
        self.assertIn("Take rest", result["diet_and_care"])

    def test_normalize_patient_summary_empty(self):
        result = _normalize_patient_summary(None)
        self.assertEqual(result, {})

    def test_normalize_patient_summary_non_dict(self):
        result = _normalize_patient_summary("invalid")
        self.assertEqual(result, {})



class EhrHardeningRegressionTests(unittest.TestCase):
    """Regression tests for presentation hardening fixes."""

    def test_strip_unsupported_clinical_content(self):
        ehr = _empty_ehr()
        ehr["plan"]["warning_signs"] = ["chest pain", "weakness"]
        ehr["plan"]["treatment_advice"] = ["Check blood sugar"]
        # No doctor evidence — both should be cleared
        result = _strip_unsupported_clinical_content(ehr, [])
        self.assertEqual(result["plan"]["warning_signs"], [])
        self.assertEqual(result["plan"]["treatment_advice"], [])

    def test_doctor_ehr_view_strips_null_vitals(self):
        ehr = _empty_ehr()
        vitals = ehr["objective"]["vitals"]
        vitals["temperature"] = {"value": 98.0, "unit": "°F", "source": "patient_reported"}
        # pulse stays null, blood pressure stays null
        view = _build_doctor_ehr_view(ehr)
        self.assertIn("temperature", view["objective"]["vitals"])
        self.assertNotIn("pulse", view["objective"]["vitals"])
        self.assertNotIn("blood_pressure", view["objective"]["vitals"])
        self.assertNotIn("respiratory_rate", view["objective"]["vitals"])
        self.assertNotIn("spo2", view["objective"]["vitals"])

    def test_doctor_ehr_view_assessment_empty_sentinel(self):
        ehr = _empty_ehr()
        view = _build_doctor_ehr_view(ehr)
        self.assertTrue(view["assessment"]["_empty"])

    def test_doctor_ehr_view_assessment_has_content(self):
        ehr = _empty_ehr()
        ehr["assessment"]["clinical_impression"] = "Viral fever suspected"
        view = _build_doctor_ehr_view(ehr)
        self.assertFalse(view["assessment"]["_empty"])
        self.assertEqual(view["assessment"]["clinical_impression"], "Viral fever suspected")

    def test_doctor_ehr_view_plan_omits_empty_sections(self):
        ehr = _empty_ehr()
        ehr["plan"]["follow_up"] = "Review in 5 days"
        ehr["plan"]["prescriptions"] = [{"medicine_name": "Dolo 650", "strength": None, "dosage_form": None, "dose": None, "route": None, "frequency": None, "schedule": {"morning": None, "afternoon": None, "night": None}, "specific_timing": None, "meal_timing": None, "duration": None, "prn_condition": None, "indication": None, "instructions": None, "action": None}]
        view = _build_doctor_ehr_view(ehr)
        self.assertIn("follow_up", view["plan"])
        self.assertIn("prescriptions", view["plan"])
        self.assertNotIn("tests_ordered", view["plan"])
        self.assertNotIn("treatment_advice", view["plan"])
        self.assertNotIn("warning_signs", view["plan"])

    def test_generate_summary_empty_sections_omitted(self):
        ehr = _empty_ehr()
        ehr["plan"]["follow_up"] = "Review after 5 days"
        summary = _generate_patient_summary_from_soap(ehr)
        self.assertEqual(summary["follow_up"], "Review after 5 days")
        self.assertNotIn("medicines", summary)
        self.assertNotIn("tests", summary)
        self.assertNotIn("diet_and_care", summary)


class PerItemEvidenceTests(unittest.TestCase):
    """Regression tests for per-item doctor evidence validation.

    Ensures patient-only content cannot validate Plan/Assessment items
    and that mixed patient+doctor content is correctly filtered.
    """

    def _ledger(self, entries: list[dict]) -> list[dict]:
        return entries

    # --- Direct unit tests for _is_supported_by_doctor_evidence ---

    def test_doctor_statement_supports_item(self):
        ledger = [
            {"id": "E001", "speaker": "doctor", "text": "I am prescribing Dolo 650.", "is_question": False},
        ]
        self.assertTrue(_is_supported_by_doctor_evidence("Dolo 650", ledger, ""))

    def test_patient_statement_does_not_support_item(self):
        ledger = [
            {"id": "E001", "speaker": "patient", "text": "I take Dolo 650 at home.", "is_question": False},
        ]
        self.assertFalse(_is_supported_by_doctor_evidence("Dolo 650", ledger, ""))

    def test_doctor_question_does_not_support_item(self):
        ledger = [
            {"id": "E001", "speaker": "doctor", "text": "Do you take Dolo 650?", "is_question": True},
        ]
        self.assertFalse(_is_supported_by_doctor_evidence("Dolo 650", ledger, ""))

    def test_superseded_doctor_statement_excluded(self):
        ledger = [
            {"id": "E001", "speaker": "doctor", "text": "Take Medicine X.", "is_question": False, "superseded_by": "E003"},
            {"id": "E002", "speaker": "doctor", "text": "Actually, take Medicine Y instead.", "is_question": False},
        ]
        # E001 is superseded by E003 — its text should not validate items
        self.assertFalse(_is_supported_by_doctor_evidence("Medicine X", ledger, ""))

    def test_doctor_correction_validates_current_advice(self):
        ledger = [
            {"id": "E001", "speaker": "doctor", "text": "Take Medicine X.", "is_question": False, "superseded_by": "E003"},
            {"id": "E002", "speaker": "doctor", "text": "Actually, take Medicine Y instead.", "is_question": False},
        ]
        # E002 is NOT superseded — its text should validate items
        self.assertTrue(_is_supported_by_doctor_evidence("Medicine Y", ledger, ""))

    def test_warning_only_requires_warning_context_in_ledger(self):
        ledger = [
            {"id": "E001", "speaker": "doctor", "text": "If breathing difficulty develops, go to the hospital.", "is_question": False},
        ]
        self.assertTrue(_is_supported_by_doctor_evidence("Breathing difficulty", ledger, "", warning_only=True))

    def test_warning_only_rejects_plain_mention_without_context(self):
        ledger = [
            {"id": "E001", "speaker": "doctor", "text": "The patient has breathing difficulty.", "is_question": False},
        ]
        self.assertFalse(_is_supported_by_doctor_evidence("Breathing difficulty", ledger, "", warning_only=True))

    # --- Integration tests via _validate_and_fix_soap_coverage with evidence_ledger ---

    def test_explicit_medicine_allergy_denial_populates_allergies(self):
        ehr = _empty_ehr()
        transcript = "Doctor: Do you have any medicine allergies?\nPatient: No."
        ledger = retrieve_soap_context(transcript)["evidence"]
        result = _validate_and_fix_soap_coverage(ehr, transcript, ledger)
        self.assertEqual(result["subjective"]["allergies"], ["No known drug allergies"])

    def test_explicit_positive_allergy_statement_is_preserved(self):
        ehr = _empty_ehr()
        transcript = "Patient: I am allergic to penicillin."
        ledger = retrieve_soap_context(transcript)["evidence"]
        result = _validate_and_fix_soap_coverage(ehr, transcript, ledger)
        self.assertEqual(result["subjective"]["allergies"], ["Penicillin allergy"])

    def test_mixed_food_allergy_and_drug_denial_are_separate(self):
        ehr = _empty_ehr()
        transcript = "Patient: There is a slight allergy from milk, but no allergy from other medicines."
        ledger = retrieve_soap_context(transcript)["evidence"]
        result = _validate_and_fix_soap_coverage(ehr, transcript, ledger)
        self.assertEqual(
            result["subjective"]["allergies"],
            ["Milk allergy", "No known drug allergies"],
        )

    def test_family_and_social_history_are_exact_patient_clauses(self):
        ehr = _empty_ehr()
        transcript = "Patient: My father has diabetes and I do not smoke or drink alcohol."
        ledger = retrieve_soap_context(transcript)["evidence"]
        result = _validate_and_fix_soap_coverage(ehr, transcript, ledger)
        self.assertEqual(result["subjective"]["family_history"], ["My father has diabetes"])
        self.assertEqual(result["subjective"]["social_history"], ["I do not smoke or drink alcohol"])

    def test_doctor_history_questions_do_not_become_patient_facts(self):
        ehr = _empty_ehr()
        ehr["subjective"]["family_history"] = ["Father has diabetes"]
        ehr["subjective"]["social_history"] = ["Smokes"]
        transcript = (
            "Doctor: Does your father have diabetes?\n"
            "Doctor: Do you smoke or drink alcohol?"
        )
        ledger = retrieve_soap_context(transcript)["evidence"]
        result = _validate_and_fix_soap_coverage(ehr, transcript, ledger)
        self.assertEqual(result["subjective"]["family_history"], [])
        self.assertEqual(result["subjective"]["social_history"], [])

    def test_doctor_current_medicine_question_does_not_create_patient_history(self):
        ehr = _empty_ehr()
        ehr["subjective"]["current_medications"] = [{"name": "Metformin", "dose": "1 tablet"}]
        transcript = "Doctor: Are you taking Metformin one tablet daily?\nPatient: I did not answer."
        ledger = retrieve_soap_context(transcript)["evidence"]
        result = _validate_and_fix_soap_coverage(ehr, transcript, ledger)
        self.assertEqual(result["subjective"]["current_medications"], [])

    def test_patient_current_medicine_answer_remains_structured(self):
        ehr = _empty_ehr()
        ehr["subjective"]["current_medications"] = [{"name": "Metformin 500 mg", "dose": "1 tablet", "frequency": "daily", "timing": "morning"}]
        transcript = "Patient: I take Metformin 500 mg one tablet daily in the morning."
        ledger = retrieve_soap_context(transcript)["evidence"]
        result = _validate_and_fix_soap_coverage(ehr, transcript, ledger)
        medicine = result["subjective"]["current_medications"][0]
        self.assertEqual(medicine["name"], "Metformin 500 mg")
        self.assertIsNone(medicine["dose"])

    def test_repeated_current_medicine_answer_uses_clear_patient_repetition(self):
        ehr = _empty_ehr()
        ehr["subjective"]["current_medications"] = [
            {"name": "Medfordon", "dose": None, "frequency": None, "timing": None},
            {"name": "Metformin", "dose": "morning and evening", "frequency": None, "timing": None},
            {"name": "Amlodipine", "dose": "for BP", "frequency": None, "timing": None},
            {"name": "Dolo 650", "dose": None, "frequency": None, "timing": None},
        ]
        transcript = (
            "Patient: I take Medfordon and Amlodipine.\n"
            "Doctor: Please repeat the medicine names.\n"
            "Patient: Metformin morning and evening for diabetes and Amlodipine for BP. "
            "And for fever, I took Dolo 650 two or three times."
        )
        ledger = retrieve_soap_context(transcript)["evidence"]
        result = _validate_and_fix_soap_coverage(ehr, transcript, ledger)
        medicines = {item["name"]: item for item in result["subjective"]["current_medications"]}
        self.assertNotIn("Medfordon", medicines)
        self.assertIsNone(medicines["Metformin"]["timing"])
        self.assertIsNone(medicines["Amlodipine"]["dose"])
        self.assertIsNone(medicines["Dolo 650"]["frequency"])

    def test_prescription_doses_stay_scoped_to_the_correct_medicine(self):
        ehr = _empty_ehr()
        ehr["plan"]["prescriptions"] = [
            {"medicine_name": "Dolo 650", "dose": "5 ml"},
            {"medicine_name": "Alex syrup 5 ml", "dose": None, "specific_timing": "after dinner"},
        ]
        transcript = (
            "Doctor: I am suggesting tablets. Take one Dolo 650.\n"
            "Doctor: Take Alex syrup 5 ml after dinner."
        )
        ledger = retrieve_soap_context(transcript)["evidence"]
        result = _validate_and_fix_soap_coverage(ehr, transcript, ledger)
        prescriptions = {item["medicine_name"]: item for item in result["plan"]["prescriptions"]}
        self.assertEqual(prescriptions["Dolo 650"]["dose"], "one tablet")
        self.assertEqual(prescriptions["Alex syrup"]["dose"], "5 ml")
        self.assertEqual(prescriptions["Alex syrup"]["specific_timing"], "after dinner")

    def test_adjacent_prescription_sentences_recover_timing_dose_and_duration(self):
        ehr = _empty_ehr()
        ehr["plan"]["prescriptions"] = [
            {"medicine_name": "Dolo 650"},
            {"medicine_name": "Alex syrup"},
        ]
        transcript = (
            "Doctor: Take Dolo 650 today. After lunch, take Dolo 650 for three days. "
            "After dinner, take Alex syrup. Drink 5 ml of it."
        )
        ledger = retrieve_soap_context(transcript)["evidence"]
        result = _validate_and_fix_soap_coverage(ehr, transcript, ledger)
        prescriptions = {item["medicine_name"]: item for item in result["plan"]["prescriptions"]}
        self.assertEqual(prescriptions["Dolo 650"]["specific_timing"], "Lunch")
        self.assertEqual(prescriptions["Dolo 650"]["meal_timing"], "After food")
        self.assertEqual(prescriptions["Dolo 650"]["duration"], "for three days")
        self.assertIsNone(prescriptions["Dolo 650"]["dose"])
        self.assertEqual(prescriptions["Alex syrup"]["dose"], "5 ml")
        self.assertEqual(prescriptions["Alex syrup"]["specific_timing"], "Dinner")
        self.assertEqual(prescriptions["Alex syrup"]["meal_timing"], "After food")
        self.assertIsNone(prescriptions["Alex syrup"]["duration"])

    def test_unspoken_prescription_duration_is_removed(self):
        ehr = _empty_ehr()
        ehr["plan"]["prescriptions"] = [
            {"medicine_name": "Dolo 650", "duration": "3 days"},
        ]
        transcript = "Doctor: Take Dolo 650 after lunch."
        ledger = retrieve_soap_context(transcript)["evidence"]

        result = _validate_and_fix_soap_coverage(ehr, transcript, ledger)

        prescription = result["plan"]["prescriptions"][0]
        self.assertIsNone(prescription["duration"])

    def test_placeholder_physical_examination_is_cleared(self):
        ehr = _empty_ehr()
        ehr["objective"]["physical_examination"] = {
            "general": "no findings reported",
            "respiratory": "no findings reported",
            "cardiovascular": "no findings reported",
            "ent": "no findings reported",
            "abdomen": "no findings reported",
            "neurological": "no findings reported",
            "other": [],
        }
        transcript = "Doctor: This looks like a viral illness."
        ledger = retrieve_soap_context(transcript)["evidence"]
        result = _validate_and_fix_soap_coverage(ehr, transcript, ledger)
        self.assertFalse(any(result["objective"]["physical_examination"].values()))

    def test_cigarette_social_history_is_concise_and_not_lost(self):
        ehr = _empty_ehr()
        transcript = "Patient: Two or three cigarettes, not even daily, and very rare."
        ledger = retrieve_soap_context(transcript)["evidence"]
        result = _validate_and_fix_soap_coverage(ehr, transcript, ledger)
        self.assertEqual(
            result["subjective"]["social_history"],
            ["Cigarette smoking: Two or three cigarettes; not even daily; very rare"],
        )

    def test_assessment_recovers_explicit_diagnosis_not_emergency_wording(self):
        ehr = _empty_ehr()
        ehr["assessment"]["clinical_impression"] = "more of an emergency"
        transcript = "Doctor: This looks like a throat infection."
        ledger = retrieve_soap_context(transcript)["evidence"]
        result = _validate_and_fix_soap_coverage(ehr, transcript, ledger)
        self.assertEqual(result["assessment"]["clinical_impression"], "throat infection")
        self.assertNotIn("more of an emergency", str(result["assessment"]).lower())

    def test_assessment_separates_main_opinion_and_explicit_alternatives(self):
        ehr = _empty_ehr()
        ehr["assessment"]["clinical_impression"] = "much more"
        ehr["assessment"]["provisional_diagnosis"] = ["much more"]
        transcript = (
            "Doctor: It looks like Condition Alpha, but it could be much more, "
            "like Condition Beta or Condition Gamma."
        )
        ledger = retrieve_soap_context(transcript)["evidence"]
        result = _validate_and_fix_soap_coverage(ehr, transcript, ledger)
        self.assertEqual(result["assessment"]["clinical_impression"], "Condition Alpha")
        self.assertEqual(result["assessment"]["provisional_diagnosis"], ["Condition Alpha"])
        self.assertEqual(
            result["assessment"]["differential_diagnoses"],
            ["Condition Beta", "Condition Gamma"],
        )
        self.assertNotIn("much more", str(result["assessment"]).lower())

    def test_assessment_handles_think_and_possibility_wording(self):
        ehr = _empty_ehr()
        transcript = (
            "Doctor: I think this is viral infection, but there is a possibility "
            "of dengue or malaria."
        )
        ledger = retrieve_soap_context(transcript)["evidence"]

        result = _validate_and_fix_soap_coverage(ehr, transcript, ledger)

        self.assertEqual(result["assessment"]["clinical_impression"], "viral infection")
        self.assertEqual(result["assessment"]["provisional_diagnosis"], ["viral infection"])
        self.assertEqual(result["assessment"]["differential_diagnoses"], ["dengue", "malaria"])

    def test_warning_signs_are_complete_and_removed_from_diet(self):
        ehr = _empty_ehr()
        ehr["plan"]["diet_lifestyle_advice"] = [
            "Drink warm fluids.",
            "If fever reaches 105 F, go to the hospital.",
        ]
        ehr["plan"]["warning_signs"] = ["If fever reaches 105 F, go to the hospital."]
        transcript = (
            "Doctor: Drink warm fluids.\n"
            "Doctor: If fever reaches 105 F, go to the hospital.\n"
            "Doctor: If breathing difficulty develops, go to the hospital immediately."
        )
        ledger = retrieve_soap_context(transcript)["evidence"]

        result = _validate_and_fix_soap_coverage(ehr, transcript, ledger)

        self.assertEqual(result["plan"]["diet_lifestyle_advice"], ["Drink warm fluids."])
        self.assertEqual(result["plan"]["warning_signs"], [
            "If fever reaches 105 F, go to the hospital.",
            "If breathing difficulty develops, go to the hospital immediately.",
        ])

    def test_patient_only_warning_signs_removed(self):
        ehr = _empty_ehr()
        ehr["plan"]["warning_signs"] = ["Chest pain"]
        transcript = "Patient: I have chest pain."
        ledger = [
            {"id": "E001", "speaker": "patient", "text": "I have chest pain.", "is_question": False},
        ]
        result = _validate_and_fix_soap_coverage(ehr, transcript, ledger)
        self.assertEqual(result["plan"]["warning_signs"], [])

    def test_patient_medication_not_prescribed(self):
        ehr = _empty_ehr()
        ehr["plan"]["prescriptions"] = [{"medicine_name": "Paracetamol", "strength": "500mg", "dosage_form": None, "dose": None, "route": None, "frequency": "as needed", "schedule": {"morning": None, "afternoon": None, "night": None}, "specific_timing": None, "meal_timing": None, "duration": None, "prn_condition": None, "indication": None, "instructions": None, "action": "PRN"}]
        transcript = "Patient: I take paracetamol 500mg when I have fever."
        ledger = [
            {"id": "E001", "speaker": "patient", "text": "I take paracetamol 500mg when I have fever.", "is_question": False},
        ]
        result = _validate_and_fix_soap_coverage(ehr, transcript, ledger)
        self.assertEqual(result["plan"]["prescriptions"], [])

    def test_patient_test_history_not_ordered(self):
        ehr = _empty_ehr()
        ehr["plan"]["tests_ordered"] = ["X-ray chest"]
        transcript = "Patient: I had an X-ray chest last month."
        ledger = [
            {"id": "E001", "speaker": "patient", "text": "I had an X-ray chest last month.", "is_question": False},
        ]
        result = _validate_and_fix_soap_coverage(ehr, transcript, ledger)
        self.assertEqual(result["plan"]["tests_ordered"], [])

    def test_advice_preserved_when_doctor_present(self):
        ehr = _empty_ehr()
        ehr["plan"]["treatment_advice"] = ["Check blood sugar daily"]
        transcript = "Doctor: Check blood sugar daily.\nPatient: I check mine daily."
        ledger = [
            {"id": "E001", "speaker": "doctor", "text": "Check blood sugar daily.", "is_question": False},
            {"id": "E002", "speaker": "patient", "text": "I check mine daily.", "is_question": False},
        ]
        result = _validate_and_fix_soap_coverage(ehr, transcript, ledger)
        self.assertEqual(result["plan"]["treatment_advice"], ["Check blood sugar daily"])

    def test_advice_cleared_when_no_doctor_at_all(self):
        """When there are zero doctor statements, advice is cleared by
        _strip_unsupported_clinical_content before validation."""
        ehr = _empty_ehr()
        ehr["plan"]["treatment_advice"] = ["Check blood sugar daily"]
        transcript = "Patient: I check my blood sugar daily at home."
        ledger = [
            {"id": "E001", "speaker": "patient", "text": "I check my blood sugar daily at home.", "is_question": False},
        ]
        result = _strip_unsupported_clinical_content(ehr, ledger)
        self.assertEqual(result["plan"]["treatment_advice"], [])

    def test_patient_proposed_followup_removed(self):
        ehr = _empty_ehr()
        ehr["plan"]["follow_up"] = "Come back in 3 days"
        transcript = "Patient: I think I should come back in 3 days."
        ledger = [
            {"id": "E001", "speaker": "patient", "text": "I think I should come back in 3 days.", "is_question": False},
        ]
        result = _validate_and_fix_soap_coverage(ehr, transcript, ledger)
        self.assertIsNone(result["plan"]["follow_up"])

    def test_doctor_medication_preserved(self):
        ehr = _empty_ehr()
        ehr["plan"]["prescriptions"] = [{"medicine_name": "Dolo 650", "strength": "650mg", "dosage_form": None, "dose": None, "route": None, "frequency": "twice daily", "schedule": {"morning": None, "afternoon": None, "night": None}, "specific_timing": None, "meal_timing": None, "duration": None, "prn_condition": None, "indication": None, "instructions": None, "action": "START"}]
        transcript = "Doctor: I am prescribing Dolo 650 twice daily."
        ledger = [
            {"id": "E001", "speaker": "doctor", "text": "I am prescribing Dolo 650 twice daily.", "is_question": False},
        ]
        result = _validate_and_fix_soap_coverage(ehr, transcript, ledger)
        self.assertEqual(len(result["plan"]["prescriptions"]), 1)
        rx = result["plan"]["prescriptions"][0]
        self.assertEqual(rx.get("medicine_name", "").lower(), "dolo 650")

    def test_mixed_advice_filtered(self):
        ehr = _empty_ehr()
        ehr["plan"]["treatment_advice"] = [
            "Take rest for 3 days",       # doctor says this
            "Drink green tea",             # patient only
        ]
        transcript = (
            "Doctor: Take rest for 3 days.\n"
            "Patient: I think I should also drink green tea."
        )
        ledger = [
            {"id": "E001", "speaker": "doctor", "text": "Take rest for 3 days.", "is_question": False},
            {"id": "E002", "speaker": "patient", "text": "I think I should also drink green tea.", "is_question": False},
        ]
        result = _validate_and_fix_soap_coverage(ehr, transcript, ledger)
        self.assertIn("Take rest for 3 days", result["plan"]["treatment_advice"])
        self.assertNotIn("Drink green tea", result["plan"]["treatment_advice"])

    def test_mixed_assessment_diagnoses_filtered(self):
        ehr = _empty_ehr()
        ehr["assessment"]["provisional_diagnosis"] = [
            "Viral fever",
            "Dengue",
        ]
        transcript = (
            "Doctor: This looks like viral fever.\n"
            "Patient: I think I might have dengue."
        )
        ledger = [
            {"id": "E001", "speaker": "doctor", "text": "This looks like viral fever.", "is_question": False},
            {"id": "E002", "speaker": "patient", "text": "I think I might have dengue.", "is_question": False},
        ]
        result = _validate_and_fix_soap_coverage(ehr, transcript, ledger)
        self.assertIn("viral fever", result["assessment"]["provisional_diagnosis"])
        self.assertNotIn("Dengue", result["assessment"]["provisional_diagnosis"])

    def test_superseded_doctor_instruction_not_validated(self):
        """If doctor corrected themselves, the superseded instruction cannot
        independently validate stale LLM output."""
        ehr = _empty_ehr()
        ehr["plan"]["treatment_advice"] = ["Take Medicine A"]
        transcript = "Doctor: Take Medicine A. Actually, take Medicine B instead."
        ledger = [
            {"id": "E001", "speaker": "doctor", "text": "Take Medicine A.", "is_question": False, "superseded_by": "E003"},
            {"id": "E002", "speaker": "doctor", "text": "Actually, take Medicine B instead.", "is_question": False},
        ]
        result = _validate_and_fix_soap_coverage(ehr, transcript, ledger)
        # "Take Medicine A" is only supported by superseded E001 — should be removed
        self.assertNotIn("Take Medicine A", result["plan"]["treatment_advice"])
        # "Take Medicine B" is NOT in the LLM output, so it won't appear
        self.assertEqual(result["plan"]["treatment_advice"], [])


if __name__ == "__main__":
    unittest.main()
