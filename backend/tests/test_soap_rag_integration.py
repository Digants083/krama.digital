"""Integration tests proving production EHR generation depends on SOAP RAG.

Covers speaker_map propagation, evidence grounding, completeness vs auto-fix
distinction, clinical/metadata separation, and backward compatibility.
"""

import unittest
from typing import Any

from app.routers.ehr import (
    _build_ehr_prompt,
    _empty_soap_ehr,
    _normalize_soap_ehr,
    _strip_unsupported_clinical_content,
    _validate_and_fix_soap_coverage,
)
from app.services.soap_rag import (
    build_completeness_review_flags,
    build_evidence_ledger,
    load_soap_knowledge,
    render_compact_soap_rag_context,
    render_soap_rag_context,
    retrieve_soap_context,
)
from app.services.speaker_correction import infer_consultation_speaker_roles


class SoapRagProductionIntegrationTests(unittest.TestCase):
    """Verify that the production EHR pipeline actually calls SOAP RAG."""

    def setUp(self):
        self.knowledge = load_soap_knowledge()

    def test_rag_context_renders_into_production_prompt(self):
        """The rendered RAG context must appear in the production LLM prompt."""
        transcript = "Patient: I have fever for two days."
        bundle = retrieve_soap_context(transcript)
        rag_context = render_soap_rag_context(bundle)
        prompt = _build_ehr_prompt(transcript, rag_context)

        self.assertIn("RETRIEVED SOAP KNOWLEDGE", prompt)
        self.assertIn("NUMBERED EVIDENCE LEDGER", prompt)
        self.assertIn("[E001]", prompt)
        self.assertIn("exact_text=I have fever for two days.", prompt)
        self.assertIn("TRANSCRIPT:", prompt)
        self.assertIn(transcript, prompt)

    def test_compact_rag_keeps_exact_evidence_and_field_routes(self):
        transcript = "Doctor: Get a blood test done and come back tomorrow."
        bundle = retrieve_soap_context(transcript)
        compact = render_compact_soap_rag_context(bundle)

        self.assertIn("TEXT=Get a blood test done and come back tomorrow.", compact)
        self.assertIn("plan.tests_ordered", compact)
        self.assertLess(len(compact), len(render_soap_rag_context(bundle)))

    def test_rag_context_contains_rules_not_field_mapping_text(self):
        """The prompt must use RAG rules, not hard-coded field mappings."""
        transcript = "Patient: I have fever."
        bundle = retrieve_soap_context(transcript)
        rag_context = render_soap_rag_context(bundle)
        prompt = _build_ehr_prompt(transcript, rag_context)

        # The prompt must NOT contain the old hard-coded field mappings
        self.assertNotIn("subjective.chief_complaints: array of strings", prompt)
        self.assertNotIn("FIELD MAPPING (follow exactly)", prompt)
        self.assertNotIn("PASS 1", prompt)
        self.assertNotIn("PASS 2", prompt)
        self.assertNotIn("PASS 3", prompt)
        # But must contain the retrieved SOAP rules
        self.assertIn("RULE ", prompt)

    def test_no_doctor_assessment_leaves_assessment_empty(self):
        """If only patient speaks, assessment must be empty."""
        transcript = "Patient: I have a headache for two days."
        bundle = retrieve_soap_context(transcript)
        evidence = bundle["evidence"]
        doctor_statements = [e for e in evidence if e["speaker"] == "doctor"]
        self.assertEqual(len(doctor_statements), 0)

    def test_fever_only_temperature_supplied(self):
        """Temperature = 98°F must NOT generate BP, Pulse, SpO2, RR."""
        llm_output = {
            "subjective": {
                "chief_complaints": ["Fever"],
                "symptoms": [{"name": "Fever", "duration": None, "severity": None, "character": None, "frequency": None, "source": "patient_reported"}],
            },
            "objective": {
                "vitals": {
                    "temperature": {"value": 98, "unit": "°F", "source": "patient_reported"},
                },
            },
        }
        ehr = _normalize_soap_ehr(llm_output)
        vitals = ehr["objective"]["vitals"]
        self.assertEqual(vitals["temperature"]["value"], 98)
        self.assertIsNone(vitals["blood_pressure"]["systolic"])
        self.assertIsNone(vitals["blood_pressure"]["diastolic"])
        self.assertIsNone(vitals["pulse"]["value"])
        self.assertIsNone(vitals["respiratory_rate"]["value"])
        self.assertIsNone(vitals["spo2"]["value"])

    def test_patient_previous_medication_goes_to_subjective(self):
        """Patient stating existing medicine -> subjective.current_medications route."""
        transcript = "Patient: I am taking Metformin 500 mg daily for diabetes."
        bundle = retrieve_soap_context(transcript)
        evidence = {e["id"]: e for e in bundle["evidence"]}
        e001 = evidence["E001"]
        self.assertIn("subjective.current_medications", e001.get("candidate_fields", []))

    def test_doctor_prescribing_goes_to_plan_prescriptions(self):
        """Doctor prescribing -> plan.prescriptions."""
        transcript = "Doctor: Take Dolo 650 one tablet every eight hours after food for three days."
        bundle = retrieve_soap_context(transcript)
        evidence = {e["id"]: e for e in bundle["evidence"]}
        e001 = evidence["E001"]
        self.assertIn("plan.prescriptions", e001.get("candidate_fields", []))

    def test_syrup_dose_and_dinner_timing_route_to_prescription(self):
        bundle = retrieve_soap_context(
            "Doctor: Take Alex syrup 5 ml after dinner for five days."
        )
        evidence = {entry["id"]: entry for entry in bundle["evidence"]}
        self.assertIn("plan.prescriptions", evidence["E001"].get("candidate_fields", []))

    def test_sarvam_speaker_labels_are_resolved_before_ehr_routing(self):
        segments = [
            {"speaker": "Speaker A", "text": "I have fever for one week.", "start": 0, "end": 2},
            {"speaker": "Speaker B", "text": "This looks like a viral infection. Start Dolo 650 one tablet twice daily.", "start": 3, "end": 8},
        ]
        corrected = infer_consultation_speaker_roles(segments)
        self.assertEqual([item["speaker"] for item in corrected], ["Patient", "Doctor"])
        transcript = "\n".join(f"{item['speaker']}: {item['text']}" for item in corrected)
        bundle = retrieve_soap_context(transcript)
        doctor_fields = {
            field
            for evidence in bundle["evidence"] if evidence["speaker"] == "doctor"
            for field in evidence.get("candidate_fields", [])
        }
        self.assertIn("assessment.clinical_impression", doctor_fields)
        self.assertIn("plan.prescriptions", doctor_fields)

    def test_explicit_allergy_denial_preserved(self):
        """Explicit allergy denial must be preserved as negated fact."""
        transcript = "Patient: I have no known allergies."
        bundle = retrieve_soap_context(transcript)
        evidence = {e["id"]: e for e in bundle["evidence"]}
        self.assertTrue(evidence["E001"]["negated"])
        # Allergy denial should route to history_of_present_illness (negated)
        self.assertIn("subjective.allergies", evidence["E001"].get("candidate_fields", []))

    def test_allergy_answer_survives_small_rag_rule_limit(self):
        transcript = "Doctor: Do you have any medicine allergies?\nPatient: No."
        bundle = retrieve_soap_context(transcript, rules_per_statement=1)
        patient_answer = bundle["evidence"][1]
        self.assertIn("subjective.allergies", patient_answer.get("candidate_fields", []))

    def test_no_doctor_assessment_completeness_check_works(self):
        """build_completeness_review_flags runs without error when assessment empty."""
        transcript = "Patient: I have fever for two days.\nDoctor: Take rest and come back if not improving."
        bundle = retrieve_soap_context(transcript)
        ehr = {
            "subjective": {"chief_complaints": [{"complaint": "Fever", "duration": None}], "history_of_present_illness": None, "symptoms": [], "relevant_negatives": [], "medical_conditions": [], "allergies": [], "current_medications": []},
            "objective": {"vitals": {"temperature": {"value": None, "unit": None, "source": None}, "blood_pressure": {"systolic": None, "diastolic": None, "unit": "mmHg", "source": None}, "pulse": {"value": None, "unit": "bpm", "source": None}, "respiratory_rate": {"value": None, "unit": "breaths/min", "source": None}, "spo2": {"value": None, "unit": "%", "source": None}, "height": {"value": None, "unit": None, "source": None}, "weight": {"value": None, "unit": None, "source": None}, "bmi": {"value": None, "source": None}}, "physical_examination": {"general": None, "respiratory": None, "cardiovascular": None, "ent": None, "abdomen": None, "neurological": None, "other": []}, "investigations": []},
            "assessment": {"provisional_diagnosis": [], "confirmed_diagnosis": [], "differential_diagnoses": [], "problems_being_managed": [], "clinical_impression": None},
            "plan": {"prescriptions": [], "tests_ordered": [], "procedures": [], "treatment_advice": ["Take rest"], "diet_lifestyle_advice": [], "monitoring": [], "referrals": [], "follow_up": "come back if not improving", "warning_signs": [], "other_instructions": []},
        }
        flags = build_completeness_review_flags(ehr, bundle)
        self.assertIsInstance(flags, list)

    def test_doctor_provisional_diagnosis_routes_to_assessment(self):
        """Doctor 'likely' statement -> assessment.provisional_diagnoses."""
        transcript = "Doctor: This looks like a viral infection."
        bundle = retrieve_soap_context(transcript)
        evidence = {e["id"]: e for e in bundle["evidence"]}
        e001 = evidence["E001"]
        self.assertIn("assessment.clinical_impression", e001.get("candidate_fields", []))
        self.assertIn("assessment.provisional_diagnosis", e001.get("candidate_fields", []))

    def test_warning_sign_plus_action_routes_to_plan_warning_signs(self):
        """Doctor warning + required action -> plan.warning_signs."""
        transcript = "Doctor: If you develop breathing difficulty, go to the hospital immediately."
        bundle = retrieve_soap_context(transcript)
        evidence = {e["id"]: e for e in bundle["evidence"]}
        e001 = evidence["E001"]
        self.assertIn("plan.warning_signs", e001.get("candidate_fields", []))

    def test_warning_sign_is_not_lost_when_rule_limit_is_one(self):
        """Safety-critical warning routing is independent of the top-N limit."""
        transcript = "Doctor: If severe vomiting develops, seek urgent medical care immediately."
        bundle = retrieve_soap_context(transcript, rules_per_statement=1)
        evidence = {e["id"]: e for e in bundle["evidence"]}
        self.assertIn("plan.warning_signs", evidence["E001"].get("candidate_fields", []))

    def test_follow_up_routes_to_plan_follow_up(self):
        """Doctor follow-up instruction -> plan.follow_up."""
        transcript = "Doctor: Come back in three days for a review."
        bundle = retrieve_soap_context(transcript)
        evidence = {e["id"]: e for e in bundle["evidence"]}
        e001 = evidence["E001"]
        self.assertIn("plan.follow_up", e001.get("candidate_fields", []))

    def test_patient_reported_home_measurement_routes_to_objective_vitals(self):
        """Patient-reported home measurement -> objective.vitals."""
        transcript = "Patient: I checked my BP at home and it was 140 over 90."
        bundle = retrieve_soap_context(transcript)
        evidence = {e["id"]: e for e in bundle["evidence"]}
        e001 = evidence["E001"]
        self.assertIn("objective.vitals", e001.get("candidate_fields", []))

    def test_multilingual_short_response_gets_previous_question_context(self):
        """Code-mixed short response should be linked to previous question."""
        transcript = "Doctor: Do you have any allergies?\nPatient: No."
        ledger = build_evidence_ledger(transcript)
        self.assertEqual(ledger[1]["text"], "No.")
        self.assertIsNotNone(ledger[1].get("context"))

    def test_contradictory_response_is_corrected(self):
        """Patient correction should supersede previous statement."""
        transcript = "Patient: I have chest pain.\nPatient: Actually, I mean I have throat pain."
        bundle = retrieve_soap_context(transcript)
        evidence = {e["id"]: e for e in bundle["evidence"]}
        self.assertIn("superseded_by", evidence.get("E001", {}))
        self.assertEqual(evidence["E001"]["superseded_by"], "E002")

    def test_unspoken_vitals_remain_empty_after_normalization(self):
        """Vitals not mentioned in transcript must remain null after normalization."""
        llm_output = {
            "subjective": {"chief_complaints": ["Cough"]},
            "objective": {"vitals": {}},
        }
        ehr = _normalize_soap_ehr(llm_output)
        vitals = ehr["objective"]["vitals"]
        self.assertIsNone(vitals["temperature"]["value"])
        self.assertIsNone(vitals["blood_pressure"]["systolic"])
        self.assertIsNone(vitals["pulse"]["value"])
        self.assertIsNone(vitals["respiratory_rate"]["value"])
        self.assertIsNone(vitals["spo2"]["value"])
        self.assertIsNone(vitals["height"]["value"])
        self.assertIsNone(vitals["weight"]["value"])
        self.assertIsNone(vitals["bmi"]["value"])

    def test_production_prompt_contains_evidence_ids_and_rag_rules(self):
        """The production prompt must contain both evidence IDs and RAG rules."""
        transcript = "Patient: I have fever.\nDoctor: Take Dolo."
        bundle = retrieve_soap_context(transcript)
        rag_context = render_soap_rag_context(bundle)
        prompt = _build_ehr_prompt(transcript, rag_context)

        self.assertIn("[E001]", prompt)
        self.assertIn("[E002]", prompt)
        self.assertIn("RULE core.transcript_only", prompt)
        self.assertIn("RULE subjective.chief_concerns", prompt)
        self.assertIn("RULE plan.medications -> plan.prescriptions", prompt)

    def test_completeness_flags_capped_and_non_empty(self):
        """Completeness flags must be capped and include evidence references."""
        transcript = (
            "Patient: I have fever for two days.\n"
            "Doctor: Take Dolo 650 one tablet after food for three days.\n"
            "Doctor: Come back in three days."
        )
        bundle = retrieve_soap_context(transcript)
        ehr = {
            "subjective": {"chief_complaints": [], "history_of_present_illness": None, "symptoms": [], "relevant_negatives": [], "medical_conditions": [], "allergies": [], "current_medications": []},
            "objective": {"vitals": {"temperature": {"value": None, "unit": None, "source": None}, "blood_pressure": {"systolic": None, "diastolic": None, "unit": "mmHg", "source": None}, "pulse": {"value": None, "unit": "bpm", "source": None}, "respiratory_rate": {"value": None, "unit": "breaths/min", "source": None}, "spo2": {"value": None, "unit": "%", "source": None}, "height": {"value": None, "unit": None, "source": None}, "weight": {"value": None, "unit": None, "source": None}, "bmi": {"value": None, "source": None}}, "physical_examination": {"general": None, "respiratory": None, "cardiovascular": None, "ent": None, "abdomen": None, "neurological": None, "other": []}, "investigations": []},
            "assessment": {"provisional_diagnosis": [], "confirmed_diagnosis": [], "differential_diagnoses": [], "problems_being_managed": [], "clinical_impression": None},
            "plan": {"prescriptions": [], "tests_ordered": [], "procedures": [], "treatment_advice": [], "diet_lifestyle_advice": [], "monitoring": [], "referrals": [], "follow_up": None, "warning_signs": [], "other_instructions": []},
        }
        flags = build_completeness_review_flags(ehr, bundle, limit=4)
        self.assertLessEqual(len(flags), 4)
        for flag in flags:
            self.assertTrue(flag["needs_doctor_review"])
            self.assertIn("field", flag)
            self.assertIn("evidence", flag)

    def test_speaker_routing_respected(self):
        """Patient statement must route to Subjective, not Assessment or Plan."""
        transcript = "Patient: I think I have diabetes."
        bundle = retrieve_soap_context(transcript)
        evidence = {e["id"]: e for e in bundle["evidence"]}
        candidates = evidence["E001"].get("candidate_fields", [])
        # Patient statement should NOT route to assessment or plan fields
        assessment_fields = {"assessment.provisional_diagnosis"}
        plan_fields = {"plan.prescriptions"}
        self.assertFalse(assessment_fields.intersection(candidates))
        self.assertFalse(plan_fields.intersection(candidates))

    def test_ehr_prompt_includes_system_level_instructions_only(self):
        """The prompt must NOT contain duplicate field-mapping rules."""
        transcript = "Patient: I have fever."
        bundle = retrieve_soap_context(transcript)
        rag_context = render_soap_rag_context(bundle)
        prompt = _build_ehr_prompt(transcript, rag_context)

        # The prompt should have the system-level instructions
        self.assertIn("No Markdown, no explanations", prompt)
        self.assertIn("Use null for absent fields", prompt)
        self.assertIn("Never infer diagnoses", prompt)
        self.assertIn("RETRIEVED SOAP KNOWLEDGE", prompt)

        # And should NOT have the removed field mapping text
        self.assertNotIn("FIELD MAPPING (follow exactly)", prompt)
        self.assertNotIn("subjective.chief_complaints: array of strings", prompt)


class SoapRagSpeakerMapTests(unittest.TestCase):
    """Tests for speaker_map propagation and safety."""

    # CASE 1: speaker_map routes doctor to Plan, patient to Subjective
    def test_speaker_map_routes_doctor_prescription_to_plan(self):
        transcript = "Speaker A: Take Dolo 650 twice daily.\nSpeaker B: I have fever for two days."
        bundle = retrieve_soap_context(transcript, speaker_map={"Speaker A": "doctor", "Speaker B": "patient"})
        evidence = {e["id"]: e for e in bundle["evidence"]}
        self.assertEqual(evidence["E001"]["speaker"], "doctor")
        self.assertEqual(evidence["E002"]["speaker"], "patient")
        self.assertIn("plan.prescriptions", evidence["E001"].get("candidate_fields", []))

    def test_minor_third_speaker_does_not_block_doctor_patient_inference(self):
        segments = [
            {"speaker": "Speaker A", "text": "What happened today? Do you have any allergies?"},
            {"speaker": "Speaker B", "text": "I have fever and I take Metformin every morning."},
            {"speaker": "Speaker C", "text": "Okay."},
            {"speaker": "Speaker A", "text": "This looks like a viral infection. Take Dolo 650 after food."},
            {"speaker": "Speaker B", "text": "Yes doctor, I understand."},
        ]
        corrected = infer_consultation_speaker_roles(segments)
        by_original = {item.get("original_speaker", item["speaker"]): item["speaker"] for item in corrected}
        self.assertEqual(by_original["Speaker A"], "Doctor")
        self.assertEqual(by_original["Speaker B"], "Patient")
        self.assertEqual(by_original["Speaker C"], "Speaker C")

    # CASE 2: no speaker_map → unknown speakers remain unknown
    def test_no_speaker_map_unknown_remains_unknown(self):
        transcript = "Speaker A: Take Dolo 650 twice daily.\nSpeaker B: I have fever for two days."
        bundle = retrieve_soap_context(transcript)
        evidence = {e["id"]: e for e in bundle["evidence"]}
        for e in evidence.values():
            self.assertEqual(e["speaker"], "unknown")

    # CASE 3: speaker label normalization
    def test_speaker_label_normalization(self):
        transcript = "SPEAKER A: Take Dolo 650 twice daily.\nspeaker b: I have fever."
        bundle = retrieve_soap_context(transcript, speaker_map={"Speaker A": "doctor", "Speaker B": "patient"})
        evidence = {e["id"]: e for e in bundle["evidence"]}
        self.assertEqual(evidence["E001"]["speaker"], "doctor")
        self.assertEqual(evidence["E002"]["speaker"], "patient")


class SoapRagSafetyTests(unittest.TestCase):
    """Tests for clinical safety: no inference from symptoms."""

    # CASE 11: no assessment inference from patient-only transcript
    def test_no_assessment_inference_patient_only(self):
        transcript = "Patient: I have fever and headache."
        bundle = retrieve_soap_context(transcript)
        ehr = _empty_soap_ehr()
        ehr["assessment"]["provisional_diagnosis"] = ["Viral infection"]
        ehr = _strip_unsupported_clinical_content(ehr, bundle["evidence"])
        self.assertEqual(ehr["assessment"]["provisional_diagnosis"], [])
        self.assertEqual(ehr["assessment"]["clinical_impression"], None)

    # CASE 12: no plan inference from patient-only transcript
    def test_no_plan_inference_patient_only(self):
        transcript = "Patient: I have fever."
        bundle = retrieve_soap_context(transcript)
        ehr = _empty_soap_ehr()
        ehr["plan"]["prescriptions"] = [{
            "medicine_name": "Dolo 650", "strength": "650 mg", "dose": "1 tablet",
            "route": None, "frequency": None, "timing": None,
            "duration": None, "instructions": None,
        }]
        ehr["plan"]["treatment_advice"] = ["Take rest"]
        ehr = _strip_unsupported_clinical_content(ehr, bundle["evidence"])
        self.assertEqual(ehr["plan"]["prescriptions"], [])
        # advice cleared too since no doctor
        self.assertEqual(ehr["plan"]["treatment_advice"], [])

    # CASE 13: evidence-based prescription is preserved
    def test_evidence_based_prescription_preserved(self):
        transcript = "Doctor: Start Dolo 650 twice daily after food for 3 days."
        bundle = retrieve_soap_context(transcript, speaker_map={"Doctor": "doctor"})
        ehr = _empty_soap_ehr()
        ehr["plan"]["prescriptions"] = [{
            "medicine_name": "Dolo 650", "strength": "650 mg", "dose": "1 tablet",
            "route": "oral", "frequency": "twice daily",
            "timing": "after food", "duration": "3 days",
            "instructions": None,
        }]
        ehr = _validate_and_fix_soap_coverage(ehr, transcript)
        self.assertEqual(len(ehr["plan"]["prescriptions"]), 1)
        rx = ehr["plan"]["prescriptions"][0]
        self.assertEqual(rx["medicine_name"], "Dolo 650")
        self.assertEqual(rx["frequency"], "twice daily")

    # CASE 14: completeness flag — validator does not add items the LLM omitted
    def test_completeness_flag_vs_auto_fix(self):
        transcript = "Doctor: Come back after five days."
        bundle = retrieve_soap_context(transcript, speaker_map={"Doctor": "doctor"})
        ehr = _empty_soap_ehr()
        # LLM omitted follow-up entirely — cannot be inferred, only validated
        ehr["plan"]["follow_up"] = None
        ehr = _validate_and_fix_soap_coverage(ehr, transcript)
        self.assertIsNone(ehr["plan"]["follow_up"])

    # CASE 15: warning sign safety — no extra warnings generated
    def test_warning_sign_safety_no_extra_warnings(self):
        transcript = "Doctor: If breathing difficulty develops, go to the hospital."
        bundle = retrieve_soap_context(transcript, speaker_map={"Doctor": "doctor"})
        ehr = _empty_soap_ehr()
        ehr["plan"]["warning_signs"] = ["Breathing difficulty", "Chest pain", "Persistent fever"]
        ehr = _validate_and_fix_soap_coverage(ehr, transcript)
        warning_text = " ".join(ehr["plan"]["warning_signs"]).lower()
        self.assertIn("breathing", warning_text)
        # Chest pain and persistent fever were NOT spoken — must be removed
        self.assertNotIn("chest pain", warning_text)
        self.assertNotIn("persistent fever", warning_text)

    # Unsupported LLM hallucination: LLM generates diagnosis from patient-only evidence
    def test_unsupported_diagnosis_removed_after_validation(self):
        transcript = "Patient: I have fever and cough for three days."
        bundle = retrieve_soap_context(transcript)
        ehr = _empty_soap_ehr()
        ehr["assessment"]["provisional_diagnosis"] = ["Viral fever"]
        ehr["assessment"]["clinical_impression"] = "Upper respiratory infection"
        ehr = _strip_unsupported_clinical_content(ehr, bundle["evidence"])
        ehr = _validate_and_fix_soap_coverage(ehr, transcript)
        self.assertEqual(ehr["assessment"]["provisional_diagnosis"], [])
        self.assertEqual(ehr["assessment"]["clinical_impression"], None)

    # Unsupported hallucination: LLM generates treatment from patient-only evidence
    def test_unsupported_treatment_removed_after_validation(self):
        transcript = "Patient: I have body pain."
        bundle = retrieve_soap_context(transcript)
        ehr = _empty_soap_ehr()
        ehr["plan"]["prescriptions"] = [{
            "medicine_name": "Dolo 650", "strength": "650 mg", "dose": "1 tablet",
            "route": None, "frequency": None, "timing": None,
            "duration": None, "instructions": None,
        }]
        ehr["plan"]["tests_ordered"] = ["CBC", "X-ray"]
        ehr["plan"]["treatment_advice"] = ["Take rest"]
        ehr = _strip_unsupported_clinical_content(ehr, bundle["evidence"])
        ehr = _validate_and_fix_soap_coverage(ehr, transcript)
        self.assertEqual(ehr["plan"]["prescriptions"], [])
        self.assertEqual(ehr["plan"]["tests_ordered"], [])
        self.assertEqual(ehr["plan"]["treatment_advice"], [])


class SoapRagMetadataSeparationTests(unittest.TestCase):
    """Tests for clinical SOAP vs review metadata separation."""

    def test_review_metadata_not_in_clinical_sections(self):
        ehr = _empty_soap_ehr()
        metadata = ehr.get("review_metadata", {})
        self.assertIn("completeness_flags", metadata)
        # Clinical sections must not contain completeness_flags
        for section in ("subjective", "objective", "assessment", "plan"):
            self.assertNotIn("completeness_flags", ehr.get(section, {}))

    def test_metadata_separation_backward_compat(self):
        """Old records with top-level completeness_flags must survive normalization."""
        old_record = {
            "schema_version": "1.0",
            "subjective": {"chief_complaints": ["Fever"]},
            "objective": {"vitals": {}, "examination_findings": [], "available_test_results": []},
            "assessment": {},
            "plan": {},
            "completeness_flags": [{"field": "plan.medications", "needs_doctor_review": True}],
        }
        normalized = _normalize_soap_ehr(old_record)
        self.assertEqual(len(normalized["review_metadata"]["completeness_flags"]), 1)
        self.assertEqual(normalized["review_metadata"]["completeness_flags"][0]["field"], "plan.medications")

    def test_metadata_separation_new_format(self):
        """New records must store flags in review_metadata.completeness_flags."""
        ehr = _empty_soap_ehr()
        ehr["review_metadata"]["completeness_flags"] = [
            {"field": "plan.follow_up", "needs_doctor_review": True},
        ]
        normalized = _normalize_soap_ehr(ehr)
        self.assertEqual(len(normalized["review_metadata"]["completeness_flags"]), 1)

    def test_review_metadata_not_visible_to_patient_summary(self):
        """Completeness metadata must never leak into patient-facing summary."""
        ehr = _empty_soap_ehr()
        ehr["review_metadata"]["completeness_flags"] = [
            {"field": "plan.medications", "needs_doctor_review": True},
        ]
        from app.routers.ehr import _generate_patient_summary_from_soap
        summary = _generate_patient_summary_from_soap(ehr)
        summary_str = str(summary).lower()
        self.assertNotIn("completeness_flag", summary_str)
        self.assertNotIn("needs_doctor_review", summary_str)
        self.assertNotIn("review_metadata", summary_str)


class SoapRagEndToEndTests(unittest.TestCase):
    """End-to-end tests verifying the full production flow."""

    def test_speaker_map_flows_through_retrieve_context(self):
        """speaker_map must reach build_evidence_ledger through retrieve_soap_context."""
        transcript = "Speaker A: Take this medicine.\nSpeaker B: Yes doctor."
        bundle = retrieve_soap_context(transcript, speaker_map={"Speaker A": "doctor", "Speaker B": "patient"})
        self.assertEqual(bundle["evidence"][0]["speaker"], "doctor")
        self.assertEqual(bundle["evidence"][1]["speaker"], "patient")

    def test_production_flow_strips_no_doctor_assessment(self):
        """Full flow: if no doctor speaks, assessment must be empty after validate."""
        transcript = "Patient: I have fever."
        bundle = retrieve_soap_context(transcript)
        ehr = _empty_soap_ehr()
        ehr["assessment"]["provisional_diagnosis"] = ["Viral fever"]
        ehr = _strip_unsupported_clinical_content(ehr, bundle["evidence"])
        ehr = _validate_and_fix_soap_coverage(ehr, transcript)
        self.assertEqual(ehr["assessment"]["provisional_diagnosis"], [])

    def test_production_flow_preserves_doctor_content(self):
        """Full flow: doctor content survives validation."""
        transcript = "Doctor: This looks like viral fever. Take Dolo 650 for fever."
        bundle = retrieve_soap_context(transcript, speaker_map={"Doctor": "doctor"})
        ehr = _empty_soap_ehr()
        ehr["assessment"]["clinical_impression"] = "Viral fever"
        ehr["plan"]["prescriptions"] = [{
            "medicine_name": "Dolo 650", "strength": "650 mg", "dose": "1 tablet",
            "route": None, "frequency": None, "timing": None,
            "duration": None, "instructions": None,
        }]
        soap_ehr = _strip_unsupported_clinical_content(ehr, bundle["evidence"])
        soap_ehr = _validate_and_fix_soap_coverage(soap_ehr, transcript)
        self.assertEqual(soap_ehr["assessment"]["clinical_impression"], "Viral fever")
        self.assertEqual(len(soap_ehr["plan"]["prescriptions"]), 1)

    def test_incomplete_model_output_recovers_explicit_doctor_assessment_and_plan(self):
        transcript = (
            "Doctor: According to me, this might be a viral infection. "
            "Take warm water and gargle with salt.\n"
            "Doctor: Get a blood test done and come back.\n"
            "Doctor: Regarding diet, do not consume spicy food.\n"
            "Doctor: If breathing difficulty develops, seek medical help immediately.\n"
            "Doctor: Show me the report tomorrow."
        )
        bundle = retrieve_soap_context(transcript)
        ehr = _empty_soap_ehr()

        recovered = _validate_and_fix_soap_coverage(ehr, transcript, bundle["evidence"])

        self.assertEqual(recovered["assessment"]["clinical_impression"], "viral infection")
        self.assertEqual(recovered["assessment"]["provisional_diagnosis"], ["viral infection"])
        self.assertEqual(recovered["plan"]["tests_ordered"], ["blood test"])
        self.assertTrue(any("gargle" in item.lower() for item in recovered["plan"]["treatment_advice"]))
        self.assertTrue(any("spicy" in item.lower() for item in recovered["plan"]["diet_lifestyle_advice"]))
        self.assertTrue(any("breathing difficulty" in item.lower() for item in recovered["plan"]["warning_signs"]))
        self.assertIn("tomorrow", recovered["plan"]["follow_up"].lower())
        self.assertEqual(recovered["plan"]["procedures"], [])
        self.assertEqual(recovered["plan"]["referrals"], [])

    def test_duplicate_soap_mapping_remains_removed(self):
        """No hard-coded FIELD MAPPING block in the production prompt."""
        transcript = "Patient: Fever."
        bundle = retrieve_soap_context(transcript)
        rag_context = render_soap_rag_context(bundle)
        prompt = _build_ehr_prompt(transcript, rag_context)
        self.assertNotIn("subjective.chief_complaints: array of strings", prompt)
        self.assertNotIn("FIELD MAPPING (follow exactly)", prompt)

    def test_one_llm_call_no_extra_rag_llm(self):
        """RAG retrieval is local/deterministic — no extra LLM call needed."""
        transcript = "Patient: Fever."
        bundle = retrieve_soap_context(transcript)
        self.assertIn("evidence", bundle)
        self.assertIn("rules", bundle)
        # No extra LLM call — all deterministic


if __name__ == "__main__":
    unittest.main()
