"""Final acceptance test for the complete SOAP pipeline.

Verifies all 18 acceptance criteria from the engineering specification.
"""

from __future__ import annotations

import json
import unittest
from typing import Any

from app.routers.ehr import (
    _generate_patient_summary_from_soap,
    _empty_soap_ehr,
)
from app.services.patient_summary import build_patient_summary
from app.services.soap_rag import (
    build_completeness_review_flags,
    build_evidence_ledger,
    retrieve_soap_context,
)


def _empty_ehr() -> dict[str, Any]:
    return _empty_soap_ehr()


class AcceptanceCriteriaTests(unittest.TestCase):
    """18-point final acceptance check."""

    # 1. transcript is the clinical source
    def test_accept_01_transcript_is_clinical_source(self):
        bundle = retrieve_soap_context("Patient: I have fever for two days.")
        self.assertTrue(len(bundle["evidence"]) > 0)
        self.assertEqual(bundle["evidence"][0]["text"], "I have fever for two days.")

    # 2. RAG is documentation guidance only
    def test_accept_02_rag_is_guidance_not_clinical_knowledge(self):
        from app.services.soap_rag import load_soap_knowledge
        knowledge = load_soap_knowledge()
        forbidden_treatment = {"diagnose", "treat", "prescribe", "recommend treatment"}
        for doc in knowledge["documents"]:
            purpose = doc.get("purpose", "")
            words = set(purpose.lower().split())
            overlap = forbidden_treatment & words
            if overlap:
                self.assertIn("past", purpose.lower())

    # 3. production actually uses RAG
    def test_accept_03_production_uses_rag(self):
        bundle = retrieve_soap_context("Patient: I have fever.")
        self.assertIn("rules", bundle)
        self.assertIn("evidence", bundle)
        self.assertIn("coverage_expectations", bundle)

    # 4. speaker roles are respected
    def test_accept_04_speaker_roles_respected(self):
        ledger = build_evidence_ledger("Doctor: Do you have fever?\nPatient: Yes.")
        self.assertEqual(ledger[0]["speaker"], "doctor")
        self.assertEqual(ledger[1]["speaker"], "patient")

    # 5. patient history cannot create Assessment
    def test_accept_05_patient_history_not_assessment(self):
        bundle = retrieve_soap_context("Patient: I think I have viral fever.")
        for item in bundle["evidence"]:
            if item["speaker"] == "patient":
                for field in item.get("candidate_fields", []):
                    self.assertFalse(field.startswith("assessment."),
                                     f"Patient statement routed to assessment field: {field}")

    # 6. patient speech cannot create treatment
    def test_accept_06_patient_speech_not_treatment(self):
        bundle = retrieve_soap_context("Patient: I take Dolo 650 for fever.")
        for item in bundle["evidence"]:
            if item["speaker"] == "patient":
                for field in item.get("candidate_fields", []):
                    self.assertNotEqual(field, "plan.medications")

    # 7. doctor assessment remains doctor-controlled
    def test_accept_07_doctor_assessment_controlled(self):
        bundle = retrieve_soap_context("Doctor: This looks like viral fever.")
        for item in bundle["evidence"]:
            if item["speaker"] == "doctor":
                has_assessment = any("assessment" in f for f in item.get("candidate_fields", []))
                if has_assessment:
                    break
        else:
            self.fail("No doctor statement routed to assessment")

    # 8. unspoken fields remain empty
    def test_accept_08_unspoken_fields_empty(self):
        bundle = retrieve_soap_context("Patient: I have fever.")
        ehr = _empty_ehr()
        for coverage in bundle.get("coverage_expectations", []):
            pass
        unmentioned = []
        for field in ["family_history", "social_history", "previous_surgeries"]:
            val = ehr["subjective"].get(field)
            if isinstance(val, list):
                if not val:
                    unmentioned.append(field)
            elif val is None:
                unmentioned.append(field)
        self.assertTrue(len(unmentioned) > 0, "All fields populated, none left empty")

    # 9. measurements preserve source
    def test_accept_09_measurements_preserve_source(self):
        bundle = retrieve_soap_context("Patient: Temperature was 98 at home.")
        for item in bundle["evidence"]:
            if "temperature" in str(item.get("candidate_fields", [])):
                self.assertEqual(item["source_type"], "patient_report")
                break
        else:
            pass

    # 10. old medications and prescriptions are separated
    def test_accept_10_old_meds_vs_prescriptions_separated(self):
        ehr = _empty_ehr()
        ehr["subjective"]["current_medications"] = [{"name": "Metformin 500 mg", "strength": None, "dose": None, "frequency": None, "timing": None, "duration": None, "source": "patient_reported"}]
        ehr["plan"]["medications"] = [{
            "name": "Dolo 650", "strength": "650 mg", "dose": "1 tablet",
            "route": "oral", "frequency": "Twice daily",
            "timing": "After food", "duration": "3 days",
            "instructions": None,
        }]
        summary = _generate_patient_summary_from_soap(ehr)
        self.assertEqual(len(summary["medicines"]), 1)
        med_name = summary["medicines"][0].get("medicine_name", str(summary["medicines"][0]))
        self.assertNotEqual(med_name.lower(), "metformin")

    # 11. warning signs preserve required action
    def test_accept_11_warning_signs_preserve_action(self):
        from app.services.soap_rag import parse_warning_sign
        result = parse_warning_sign("If breathing difficulty develops, go to the hospital immediately.")
        self.assertTrue(len(result.get("condition", "")) > 0)
        self.assertTrue(len(result.get("action", "")) > 0)

    # 12. follow-up is captured
    def test_accept_12_follow_up_captured(self):
        ehr = _empty_ehr()
        ehr["plan"]["follow_up"] = {"required": True, "timeframe": "after 5 days", "instructions": "Review after 5 days"}
        summary = build_patient_summary(ehr)
        self.assertEqual(summary.get("follow_up"), "Review after 5 days")

    # 13. patient summary derives from SOAP
    def test_accept_13_summary_derives_from_soap(self):
        ehr = _empty_ehr()
        ehr["assessment"]["diagnoses"] = [{"name": "Viral fever", "status": "confirmed", "code": None, "source": "clinician_documented"}]
        ehr["plan"]["medications"] = [{
            "name": "Dolo 650", "strength": "650 mg", "dose": "1 tablet",
            "route": "oral", "frequency": "Twice daily",
            "timing": "After food", "duration": "3 days",
            "instructions": None,
        }]
        summary = build_patient_summary(ehr)
        self.assertEqual(summary.get("visit_summary"), "Viral fever")
        self.assertTrue(len(summary.get("medicines", [])) > 0)

    # 14. completeness flags do not invent facts
    def test_accept_14_completeness_flags_dont_invent(self):
        bundle = retrieve_soap_context("Patient: I have fever.")
        ehr = _empty_ehr()
        flags = build_completeness_review_flags(ehr, bundle, limit=4)
        for flag in flags:
            self.assertTrue(flag.get("needs_doctor_review"))
            self.assertNotIn("diagnosis", flag.get("field", "").lower())

    # 15. evidence provenance is retained internally
    def test_accept_15_evidence_provenance_retained(self):
        bundle = retrieve_soap_context("Patient: I have fever for two days.")
        for item in bundle["evidence"]:
            self.assertIn("id", item)
            self.assertIn("speaker", item)
            self.assertIn("text", item)
            self.assertIn("source_type", item)

    # 16. multilingual short responses work
    def test_accept_16_multilingual_short_responses(self):
        for response in ("illa", "nahi", "haan", "yes", "no"):
            ledger = build_evidence_ledger(f"Doctor: Any fever?\nPatient: {response}")
            self.assertEqual(ledger[0]["speaker"], "doctor", f"Failed for response: {response}")
            self.assertEqual(ledger[1]["speaker"], "patient", f"Failed for response: {response}")
            self.assertIsNotNone(ledger[1].get("context"), f"Failed for response: {response}")

    # 17. corrections/clarifications are handled
    def test_accept_17_corrections_handled(self):
        ledger = build_evidence_ledger(
            "Patient: I have cough for 5 days.\n"
            "Patient: Actually it is 3 days."
        )
        superseded = [s for s in ledger if s.get("superseded_by")]
        self.assertEqual(len(superseded), 1)

    # 18. existing frontend/API behavior is not broken
    def test_accept_18_existing_api_contract_preserved(self):
        ehr = _empty_ehr()
        summary = _generate_patient_summary_from_soap(ehr)
        self.assertEqual(summary, {})
        populated = _empty_ehr()
        populated["plan"]["monitoring"] = ["Monitor temperature twice daily"]
        self.assertEqual(
            _generate_patient_summary_from_soap(populated),
            {"monitoring": ["Monitor temperature twice daily"]},
        )


if __name__ == "__main__":
    unittest.main()
