"""Comprehensive tests for the SOAP RAG evidence ledger and completeness review.

Covers all 14 required cases plus architectural regression tests.
"""

from __future__ import annotations

import json
import unittest
from typing import Any

from app.services.soap_rag import (
    build_completeness_review_flags,
    build_evidence_ledger,
    load_soap_knowledge,
    parse_warning_sign,
    render_soap_rag_context,
    retrieve_soap_context,
)
from app.services.speaker_correction import infer_consultation_speaker_roles


def _empty_ehr() -> dict[str, Any]:
    return {
        "subjective": {
            "chief_concerns": [],
            "history_of_present_illness": None,
            "symptoms": [],
            "relevant_negatives": [],
            "medical_conditions": [],
            "allergies": [],
            "family_history": [],
            "social_history": [],
            "current_medications": [],
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
            "physical_examination": [],
            "investigations": [],
        },
        "assessment": {
            "clinical_impression": [],
            "diagnoses": [],
        },
        "plan": {
            "medications": [],
            "investigations_ordered": [],
            "procedures": [],
            "advice": [],
            "referral": [],
            "follow_up": None,
            "warning_signs": [],
        },
    }


class SoapRagCoreTests(unittest.TestCase):
    """Core knowledge-base and ledger tests."""

    def test_versioned_knowledge_base_contains_all_soap_sections(self):
        knowledge = load_soap_knowledge()
        self.assertEqual(knowledge["version"], "1.1.0")
        sections = {document["section"] for document in knowledge["documents"]}
        self.assertTrue({"CORE", "S", "O", "A", "P"}.issubset(sections))

    def test_evidence_ledger_preserves_exact_text_and_short_answer_context(self):
        ledger = build_evidence_ledger(
            "Doctor: Do you have medicine allergies?\nPatient: No."
        )
        self.assertEqual(ledger[0]["text"], "Do you have medicine allergies?")
        self.assertTrue(ledger[0]["is_question"])
        self.assertEqual(ledger[1]["text"], "No.")
        self.assertEqual(ledger[1]["context"], "Do you have medicine allergies?")

    def test_retrieval_routes_patient_and_doctor_statements_to_relevant_fields(self):
        bundle = retrieve_soap_context(
            "Patient: I have fever for two days.\n"
            "Doctor: Take Dolo 650 one tablet after food for three days."
        )
        evidence = {item["id"]: item for item in bundle["evidence"]}
        self.assertIn("subjective.chief_complaints", evidence["E001"]["candidate_fields"])
        self.assertIn("plan.prescriptions", evidence["E002"]["candidate_fields"])
        rendered = render_soap_rag_context(bundle)
        self.assertIn("exact_text=I have fever for two days.", rendered)
        self.assertIn("RULE plan.medications -> plan.prescriptions", rendered)

    def test_retrieval_routes_family_and_social_history_separately(self):
        bundle = retrieve_soap_context(
            "Patient: My mother has hypertension.\n"
            "Patient: I do not smoke or drink alcohol."
        )
        evidence = {item["id"]: item for item in bundle["evidence"]}
        self.assertIn("subjective.family_history", evidence["E001"]["candidate_fields"])
        self.assertNotIn("subjective.social_history", evidence["E001"]["candidate_fields"])
        self.assertIn("subjective.social_history", evidence["E002"]["candidate_fields"])
        self.assertNotIn("subjective.family_history", evidence["E002"]["candidate_fields"])

    def test_explicit_alternative_diagnoses_bypass_top_n_limit(self):
        bundle = retrieve_soap_context(
            "Doctor: It looks like Condition Alpha, but it could be more, like Condition Beta or Condition Gamma.",
            rules_per_statement=1,
        )
        fields = bundle["evidence"][0]["candidate_fields"]
        self.assertIn("assessment.differential_diagnoses", fields)

    def test_doctor_question_is_context_not_a_patient_fact(self):
        bundle = retrieve_soap_context("Doctor: Are you taking Metformin 500 mg?")
        self.assertEqual(bundle["evidence"][0]["candidate_fields"], [])
        self.assertEqual(bundle["coverage_expectations"], [])

    def test_relevant_negative_routes_to_hpi_not_chief_concern(self):
        bundle = retrieve_soap_context("Patient: I have no chest pain.")
        statement = bundle["evidence"][0]
        self.assertEqual(statement["candidate_fields"][0], "subjective.history_of_present_illness")
        self.assertFalse(any(
            item["field"] == "subjective.chief_concerns"
            for item in bundle["coverage_expectations"]
        ))

    def test_completeness_flags_are_grounded_grouped_and_limited(self):
        transcript = (
            "Patient: I have fever for two days.\n"
            "Doctor: Take Dolo 650 one tablet after food for three days.\n"
            "Doctor: Come back in three days."
        )
        bundle = retrieve_soap_context(transcript)
        ehr = _empty_ehr()
        flags = build_completeness_review_flags(ehr, bundle, limit=2)
        self.assertLessEqual(len(flags), 2)
        self.assertTrue(all(flag["evidence"].startswith("[E") for flag in flags))
        self.assertTrue(all(flag["needs_doctor_review"] for flag in flags))

    def test_diarized_speakers_are_mapped_at_conversation_level(self):
        segments = [
            {"speaker": "Speaker A", "text": "How long have you had fever?", "start": 0, "end": 2},
            {"speaker": "Speaker B", "text": "I have fever for two days.", "start": 2, "end": 4},
            {"speaker": "Speaker A", "text": "Take this tablet after food and come back in three days.", "start": 4, "end": 7},
        ]
        mapped = infer_consultation_speaker_roles(segments)
        self.assertEqual(mapped[0]["speaker"], "Doctor")
        self.assertEqual(mapped[1]["speaker"], "Patient")
        self.assertEqual(mapped[2]["speaker"], "Doctor")


class SoapRagCaseTests(unittest.TestCase):
    """The 14 required clinical test cases."""

    # CASE 1: Chief concern/HPI with no diagnosis
    def test_case1_chief_concern_no_diagnosis(self):
        bundle = retrieve_soap_context("Patient: I have fever for two days.")
        evidence = bundle["evidence"]
        self.assertIn("subjective.chief_complaints", evidence[0]["candidate_fields"])
        # No diagnosis-related fields should be candidates for patient speech
        for field in evidence[0].get("candidate_fields", []):
            self.assertFalse(field.startswith("assessment."))

    # CASE 2: Patient-reported measurement with correct source
    def test_case2_patient_reported_measurement_source(self):
        bundle = retrieve_soap_context("Patient: I checked temperature at home, it was 98 degrees F.")
        evidence = bundle["evidence"]
        patient_statements = [e for e in evidence if e["speaker"] == "patient"]
        self.assertTrue(patient_statements)
        self.assertEqual(patient_statements[0]["source_type"], "patient_report")
        self.assertIn("objective.vitals", patient_statements[0].get("candidate_fields", []))

    # CASE 3: Doctor-supplied measurement
    def test_case3_doctor_objective_measurement(self):
        bundle = retrieve_soap_context("Doctor: Temperature is 99 degrees F.")
        evidence = bundle["evidence"]
        doc_stats = [e for e in evidence if e["speaker"] == "doctor"]
        self.assertTrue(doc_stats)
        self.assertEqual(doc_stats[0]["source_type"], "clinic_measurement")

    # CASE 4: Patient current medication — not a new prescription
    def test_case4_current_medication_not_new_prescription(self):
        bundle = retrieve_soap_context("Patient: I take Metformin 500 mg every morning.")
        evidence = bundle["evidence"]
        self.assertEqual(evidence[0]["speaker"], "patient")
        patient_fields = evidence[0].get("candidate_fields", [])
        self.assertIn("subjective.current_medications", patient_fields)
        self.assertNotIn("plan.prescriptions", patient_fields)

    # CASE 5: Doctor says CONTINUE — goes to plan with action CONTINUE
    def test_case5_doctor_continue_medication(self):
        bundle = retrieve_soap_context("Doctor: Continue Metformin 500 mg every morning.")
        evidence = bundle["evidence"]
        doc_stats = [e for e in evidence if e["speaker"] == "doctor"]
        self.assertTrue(doc_stats)
        self.assertIn("plan.prescriptions", doc_stats[0].get("candidate_fields", []))

    # CASE 6: Structured prescription with START action
    def test_case6_structured_prescription_start(self):
        bundle = retrieve_soap_context(
            "Doctor: Start Dolo 650 after food twice daily for three days."
        )
        evidence = bundle["evidence"]
        doc_stats = [e for e in evidence if e["speaker"] == "doctor"]
        self.assertTrue(doc_stats)
        self.assertIn("plan.prescriptions", doc_stats[0].get("candidate_fields", []))

    # CASE 7: Provisional diagnosis
    def test_case7_provisional_diagnosis(self):
        bundle = retrieve_soap_context("Doctor: I suspect viral infection.")
        evidence = bundle["evidence"]
        doc_stats = [e for e in evidence if e["speaker"] == "doctor"]
        self.assertTrue(doc_stats)
        self.assertIn("assessment.provisional_diagnosis", doc_stats[0].get("candidate_fields", []))

    # CASE 8: Doctor gives no diagnosis — assessment empty
    def test_case8_no_diagnosis(self):
        bundle = retrieve_soap_context(
            "Patient: I have fever and cough.\n"
            "Doctor: Take paracetamol and rest."
        )
        evidence = bundle["evidence"]
        for e in evidence:
            for field in e.get("candidate_fields", []):
                self.assertNotIn("assessment.", field)

    # CASE 9: Warning sign with action preserved
    def test_case9_warning_sign_preserves_action(self):
        result = parse_warning_sign(
            "If breathing difficulty develops, go to the hospital immediately."
        )
        self.assertIn("breathing difficulty", result["condition"].lower())
        self.assertIn("go to", result["action"].lower())
        self.assertEqual(result["urgency"], "immediate")

    # CASE 10: Follow-up captured
    def test_case10_follow_up_captured(self):
        bundle = retrieve_soap_context("Doctor: Come back after five days.")
        evidence = bundle["evidence"]
        doc_stats = [e for e in evidence if e["speaker"] == "doctor"]
        self.assertTrue(doc_stats)
        self.assertIn("plan.follow_up", doc_stats[0].get("candidate_fields", []))

    # CASE 11: Allergy denial using prior-question context
    def test_case11_allergy_denial_with_context(self):
        ledger = build_evidence_ledger(
            "Doctor: Any medicine allergy?\nPatient: illa"
        )
        self.assertEqual(ledger[0]["speaker"], "doctor")
        self.assertTrue(ledger[0]["is_question"])
        self.assertEqual(ledger[1]["speaker"], "patient")
        self.assertEqual(ledger[1]["context"], "Any medicine allergy?")
        self.assertTrue(ledger[1]["negated"])

    # CASE 12: Correction handling — later clarification overrides
    def test_case12_correction_handling(self):
        ledger = build_evidence_ledger(
            "Doctor: How long have you had cough?\n"
            "Patient: No cough.\n"
            "Patient: Actually I have dry cough for two days."
        )
        superseded = [s for s in ledger if s.get("superseded_by")]
        self.assertEqual(len(superseded), 1)
        self.assertEqual(superseded[0]["text"], "No cough.")

    def test_wait_a_second_does_not_erase_previous_clinical_statement(self):
        ledger = build_evidence_ledger(
            "Doctor: Wear a mask because it could be a throat infection.\n"
            "Doctor: Wait a second."
        )
        self.assertIsNone(ledger[0].get("superseded_by"))

    # CASE 13: No completeness warning spam for absent unrelated vitals
    def test_case13_patient_vital_is_expected_not_spurious(self):
        """Patient-reported vitals are expected content, not spurious.

        The knowledge base correctly routes patient-reported measurements to
        objective.vitals so the completeness checker can flag when the EHR
        omits explicitly spoken vital information regardless of source.
        """
        bundle = retrieve_soap_context("Patient: Temperature was 98 degrees F at home.")
        ehr = _empty_ehr()
        flags = build_completeness_review_flags(ehr, bundle, limit=10)
        vital_flags = [f for f in flags if "vitals" in f.get("field", "")]
        self.assertEqual(len(vital_flags), 1,
                         "Patient-reported vital should create a completeness expectation")

    # CASE 14: Completeness flags identify omissions without mutating SOAP
    def test_case14_completeness_flag_does_not_mutate(self):
        transcript = (
            "Doctor: Take Dolo 650 one tablet after food for three days.\n"
            "Doctor: Come back in three days."
        )
        bundle = retrieve_soap_context(transcript)
        ehr = _empty_ehr()
        flags = build_completeness_review_flags(ehr, bundle, limit=4)
        self.assertTrue(
            any("prescriptions" in f.get("field", "") for f in flags),
            "Should flag missing medication when doctor explicitly prescribed"
        )
        self.assertEqual(ehr["plan"]["medications"], [])


class SoapRagWarningSignParsingTests(unittest.TestCase):
    """Edge cases for warning sign parsing."""

    def test_parse_immediate_urgency(self):
        result = parse_warning_sign("Go to the hospital immediately.")
        self.assertEqual(result["urgency"], "immediate")

    def test_parse_urgent_but_not_immediate(self):
        result = parse_warning_sign("Seek medical care as soon as possible.")
        self.assertEqual(result["urgency"], "urgent")

    def test_parse_if_condition_then_action(self):
        result = parse_warning_sign("If fever continues, call the doctor.")
        self.assertIn("fever continues", result["condition"].lower())
        self.assertIn("call", result["action"].lower())

    def test_parse_fallback_preserves_full_text(self):
        result = parse_warning_sign("Watch for worsening symptoms.")
        self.assertEqual(result["condition"], "Watch for worsening symptoms.")
        self.assertEqual(result["action"], "See a doctor")


class SoapRagHardeningTests(unittest.TestCase):
    """Focused hardening tests for evidence metadata, routing, and corrections."""

    # TEST 1: speaker map
    def test_speaker_map_resolves_diarization_labels(self):
        ledger = build_evidence_ledger(
            "Speaker A: Any drug allergy?\nSpeaker B: No",
            speaker_map={"Speaker A": "doctor", "Speaker B": "patient"},
        )
        self.assertEqual(ledger[0]["speaker"], "doctor")
        self.assertEqual(ledger[1]["speaker"], "patient")

    # TEST 2: unmapped diarization
    def test_unmapped_diarization_remains_unknown(self):
        ledger = build_evidence_ledger("Speaker A: Hello")
        self.assertEqual(ledger[0]["speaker"], "unknown")

    # TEST 3: multilingual denial (illa)
    def test_multilingual_denial_illa(self):
        bundle = retrieve_soap_context("Doctor: Any drug allergy?\nPatient: illa")
        evidence = {e["id"]: e for e in bundle["evidence"]}
        _, answer = sorted(evidence.values(), key=lambda x: x["sequence_index"])
        self.assertEqual(answer["context"], "Any drug allergy?")
        self.assertTrue(answer["negated"])

    # TEST 4: Kannada denial — exact text preserved
    def test_kannada_denial_preserves_original_text(self):
        ledger = build_evidence_ledger(
            "Doctor: Any medicine allergy?\nPatient: \u0c87\u0cb2\u0ccd\u0cb2"
        )
        self.assertEqual(ledger[1]["text"], "\u0c87\u0cb2\u0ccd\u0cb2")
        self.assertTrue(ledger[1]["negated"])

    # TEST 5: Hindi denial
    def test_hindi_denial_nahi(self):
        bundle = retrieve_soap_context("Doctor: Any surgery?\nPatient: nahi")
        evidence = bundle["evidence"]
        patient_stmts = [e for e in evidence if e["speaker"] == "patient"]
        self.assertTrue(patient_stmts)
        self.assertTrue(patient_stmts[0]["negated"])

    # TEST 6: patient-reported measurement
    def test_patient_reported_measurement_source_type(self):
        bundle = retrieve_soap_context("Patient: My temperature at home was 98\u00b0F.")
        evidence = bundle["evidence"]
        self.assertEqual(evidence[0]["source_type"], "patient_report")

    # TEST 7: clinic measurement
    def test_doctor_clinic_measurement(self):
        bundle = retrieve_soap_context("Doctor: Temperature is 99\u00b0F.")
        evidence = bundle["evidence"]
        self.assertEqual(evidence[0]["source_type"], "clinic_measurement")

    # TEST 8: medication strength is NOT measurement
    def test_medication_strength_not_measurement(self):
        bundle = retrieve_soap_context("Doctor: Take Dolo 650.")
        evidence = bundle["evidence"]
        self.assertEqual(evidence[0]["source_type"], "doctor_statement")

    # TEST 9: follow-up number is NOT measurement
    def test_follow_up_number_not_measurement(self):
        bundle = retrieve_soap_context("Doctor: Come back after 5 days.")
        evidence = bundle["evidence"]
        self.assertEqual(evidence[0]["source_type"], "doctor_statement")

    # TEST 10: medication action START
    def test_medication_action_start(self):
        bundle = retrieve_soap_context("Doctor: Start Dolo 650 twice daily.")
        evidence = bundle["evidence"]
        self.assertEqual(evidence[0].get("medication_action"), "START")

    # TEST 11: CONTINUE
    def test_medication_action_continue(self):
        bundle = retrieve_soap_context("Doctor: Continue Metformin.")
        evidence = bundle["evidence"]
        self.assertEqual(evidence[0].get("medication_action"), "CONTINUE")

    # TEST 12: STOP
    def test_medication_action_stop(self):
        bundle = retrieve_soap_context("Doctor: Stop this tablet.")
        evidence = bundle["evidence"]
        self.assertEqual(evidence[0].get("medication_action"), "STOP")

    # TEST 13: PRN
    def test_medication_action_prn(self):
        bundle = retrieve_soap_context(
            "Doctor: Take this only if fever occurs."
        )
        evidence = bundle["evidence"]
        self.assertEqual(evidence[0].get("medication_action"), "PRN")

    # TEST 14: explicit correction
    def test_explicit_correction_supersedes(self):
        ledger = build_evidence_ledger(
            "Patient: No cough.\n"
            "Patient: Actually I have dry cough for two days."
        )
        superseded = [s for s in ledger if s.get("superseded_by")]
        self.assertEqual(len(superseded), 1)
        self.assertEqual(superseded[0]["text"], "No cough.")

    # TEST 15: completeness ignores superseded
    def test_completeness_ignores_superseded(self):
        bundle = retrieve_soap_context(
            "Patient: No cough.\n"
            "Patient: Actually I have dry cough for two days."
        )
        ehr = _empty_ehr()
        ehr["subjective"]["chief_concerns"] = [
            {"name": "Cough", "duration": "2 days", "severity": None, "progression": None}
        ]
        flags = build_completeness_review_flags(ehr, bundle, limit=10)
        self.assertFalse(
            any("No cough" in f.get("evidence", "") for f in flags),
            "Superseded 'No cough' must not trigger omission flag",
        )

    # TEST 16: rendered RAG context includes metadata
    def test_rendered_context_includes_metadata(self):
        bundle = retrieve_soap_context(
            "Doctor: Continue Metformin 500 mg.\n"
            "Patient: No cough.\n"
            "Patient: Actually I have dry cough for two days."
        )
        rendered = render_soap_rag_context(bundle)
        self.assertIn("[E001]", rendered)
        self.assertIn("source=", rendered)
        self.assertIn("negated=", rendered)
        self.assertIn("medication_action", rendered)
        self.assertIn("superseded_by", rendered)
        self.assertIn("exact_text=", rendered)

    # TEST 17: short answer attaches to correct doctor question
    def test_short_answer_attaches_to_correct_question(self):
        ledger = build_evidence_ledger(
            "Doctor: Any surgery?\n"
            "Patient: No.\n"
            "Doctor: Any allergy?\n"
            "Patient: illa"
        )
        # First short answer should attach to surgery question
        self.assertEqual(ledger[1]["context"], "Any surgery?")
        # Second short answer should attach to allergy question
        self.assertEqual(ledger[3]["context"], "Any allergy?")


EXPECTED_CORE_RULE_IDS = {
    "core.transcript_only",
    "core.speaker_routing",
    "core.blank_fields",
    "core.negation",
    "core.provenance",
    "core.correction",
    "core.history_vs_plan",
    "core.no_diagnosis_inference",
}
OBSOLETE_FIELD_PATHS = {
    "subjective.chief_complaints",
    "objective.examination_findings",
    "assessment.provisional_diagnoses",
    "assessment.confirmed_diagnoses",
    "plan.diet_and_hydration_advice",
    "plan.monitoring_instructions",
}
REQUIRED_FIELD_PATHS = {
    "subjective.chief_concerns",
    "subjective.current_medications",
    "subjective.allergies",
    "subjective.family_history",
    "subjective.social_history",
    "objective.vitals",
    "objective.physical_examination",
    "objective.investigations",
    "assessment.clinical_impression",
    "assessment.provisional_diagnosis",
    "plan.medications",
    "plan.investigations_ordered",
    "plan.advice",
    "plan.monitoring",
    "plan.referral",
    "plan.follow_up",
    "plan.warning_signs",
}

# Rules that have a dotted field path (non-CORE, non-all)
ALL_EXPECTED_FIELD_PATHS = {
    "subjective.chief_concerns",
    "subjective.history_of_present_illness",
    "subjective.past_medical_history",
    "subjective.current_medications",
    "subjective.allergies",
    "subjective.family_history",
    "subjective.social_history",
    "objective.vitals",
    "objective.physical_examination",
    "objective.investigations",
    "assessment.clinical_impression",
    "assessment.provisional_diagnosis",
    "assessment.problems_being_managed",
    "plan.medications",
    "plan.investigations_ordered",
    "plan.procedures",
    "plan.monitoring",
    "plan.advice",
    "plan.referral",
    "plan.follow_up",
    "plan.warning_signs",
}


class SoapRagConsistencyTests(unittest.TestCase):
    """Knowledge-base contract: prevent silent drift between soap_rules.json and soap_rag.py."""

    def test_core_rule_ids_exist_in_json(self):
        """Every CORE_RULE_ID configured in soap_rag.py must exist in soap_rules.json."""
        from app.services.soap_rag import CORE_RULE_IDS
        knowledge = load_soap_knowledge()
        json_ids = {doc["id"] for doc in knowledge["documents"]}
        missing = CORE_RULE_IDS - json_ids
        self.assertFalse(missing, f"CORE_RULE_IDs missing from JSON: {missing}")

    def test_json_core_rules_match_core_rule_ids(self):
        """Every core rule in the JSON knowledge base must be declared in CORE_RULE_IDS."""
        from app.services.soap_rag import CORE_RULE_IDS
        knowledge = load_soap_knowledge()
        json_core_ids = {doc["id"] for doc in knowledge["documents"] if doc["section"] == "CORE"}
        extra = json_core_ids - CORE_RULE_IDS
        self.assertFalse(extra, f"Core rules in JSON not in CORE_RULE_IDS: {extra}")

    def test_no_duplicate_rule_ids(self):
        """No duplicate rule IDs in the knowledge base."""
        knowledge = load_soap_knowledge()
        ids = [doc["id"] for doc in knowledge["documents"]]
        duplicates = {rid for rid in ids if ids.count(rid) > 1}
        self.assertFalse(duplicates, f"Duplicate rule IDs found: {duplicates}")

    def test_no_obsolete_field_paths_in_json(self):
        """No renamed SOAP field paths remain in the knowledge base."""
        knowledge = load_soap_knowledge()
        json_fields = {doc.get("field") for doc in knowledge["documents"] if doc.get("field") and doc["field"] != "all"}
        found_obsolete = json_fields & OBSOLETE_FIELD_PATHS
        self.assertFalse(found_obsolete, f"Obsolete field paths still present in JSON: {found_obsolete}")

    def test_required_field_paths_exist_in_json(self):
        """All expected SOAP field paths are present in the knowledge base."""
        knowledge = load_soap_knowledge()
        json_fields = {doc.get("field") for doc in knowledge["documents"] if doc.get("field") and doc["field"] != "all"}
        missing = ALL_EXPECTED_FIELD_PATHS - json_fields
        self.assertFalse(missing, f"Expected field paths missing from JSON: {missing}")

    def test_minimal_transcript_retrieves_all_core_rules(self):
        """A minimal transcript must retrieve every core documentation rule."""
        bundle = retrieve_soap_context("Patient: Fever for two days.")
        retrieved_ids = {rule["id"] for rule in bundle["rules"]}
        self.assertTrue(
            EXPECTED_CORE_RULE_IDS.issubset(retrieved_ids),
            f"Missing core rules in retrieval: {EXPECTED_CORE_RULE_IDS - retrieved_ids}",
        )

    def test_render_includes_all_core_rules(self):
        """render_soap_rag_context must contain every core rule's ID."""
        bundle = retrieve_soap_context("Patient: Fever for two days.")
        rendered = render_soap_rag_context(bundle)
        for rid in sorted(EXPECTED_CORE_RULE_IDS):
            self.assertIn(f"RULE {rid}", rendered, f"Core rule {rid} not found in rendered output")

    def test_completeness_fields_uses_chief_concerns(self):
        """COMPLETENESS_FIELDS must use chief_concerns, not chief_complaints."""
        from app.services.soap_rag import COMPLETENESS_FIELDS
        self.assertIn("subjective.chief_concerns", COMPLETENESS_FIELDS)
        self.assertNotIn("subjective.chief_complaints", COMPLETENESS_FIELDS)


if __name__ == "__main__":
    unittest.main()
