"""Regression tests for routed hybrid SOAP generation inputs."""

from __future__ import annotations

import asyncio
import json
import unittest
from unittest.mock import patch

from app.routers.ehr import (
    _build_section_prompt,
    _empty_soap_ehr,
    _generate_with_ollama,
    _soap_section_schema,
    _soap_sections_schema,
    _validate_and_fix_soap_coverage,
)
from app.services.soap_rag import (
    build_section_rag_bundle,
    render_section_soap_rag_context,
    retrieve_soap_context,
)


class HybridSoapRoutingTests(unittest.TestCase):
    def test_subjective_high_recall_keeps_patient_allergy_when_classifier_misses(self):
        bundle = {
            "knowledge_version": "test",
            "evidence": [{
                "id": "E001",
                "speaker": "patient",
                "text": "I have dust sensitivity",
                "is_question": False,
                "candidate_fields": [],
            }],
            "rules": [],
            "coverage_expectations": [],
        }

        routed = build_section_rag_bundle(bundle, "subjective")

        self.assertEqual([item["id"] for item in routed["evidence"]], ["E001"])

    def test_doctor_assertions_reach_assessment_and_plan_but_not_objective(self):
        bundle = {
            "knowledge_version": "test",
            "evidence": [{
                "id": "E001",
                "speaker": "doctor",
                "text": "This looks like Condition Alpha",
                "is_question": False,
                "source_type": "doctor_statement",
                "candidate_fields": [],
            }],
            "rules": [],
            "coverage_expectations": [],
        }

        self.assertEqual(len(build_section_rag_bundle(bundle, "assessment")["evidence"]), 1)
        self.assertEqual(len(build_section_rag_bundle(bundle, "plan")["evidence"]), 1)
        self.assertEqual(build_section_rag_bundle(bundle, "objective")["evidence"], [])

    def test_section_renderer_keeps_exact_evidence_and_correction_metadata(self):
        bundle = {
            "knowledge_version": "test",
            "evidence": [{
                "id": "E004",
                "speaker": "doctor",
                "speaker_label": "Doctor",
                "text": "No, change Dolo 650 to two tablets",
                "is_question": False,
                "candidate_fields": ["plan.prescriptions"],
                "medication_action": "CHANGE",
            }],
            "rules": [],
            "coverage_expectations": [],
        }

        rendered = render_section_soap_rag_context(bundle, "plan")

        self.assertIn("exact_text=No, change Dolo 650 to two tablets", rendered)
        self.assertIn("medication_action=CHANGE", rendered)

    def test_each_section_prompt_and_schema_expose_only_one_top_level_section(self):
        bundle = retrieve_soap_context("Patient: I have fever for two days.")
        for section in ("subjective", "objective", "assessment", "plan"):
            schema = _soap_section_schema(section)
            prompt = _build_section_prompt(section, bundle)
            self.assertEqual(schema["required"], [section])
            self.assertEqual(list(schema["properties"]), [section])
            self.assertIn(f"named '{section}'", prompt)


class HybridMedicationReconciliationTests(unittest.TestCase):
    def test_explicit_complaint_severity_and_course_are_recovered(self):
        transcript = "Patient: My fever is severe and getting worse for two days."
        ehr = _empty_soap_ehr()
        ehr["subjective"]["chief_complaints"] = [{
            "complaint": "fever",
            "severity": None,
            "course": None,
            "duration": "two days",
        }]
        evidence = retrieve_soap_context(transcript)["evidence"]

        result = _validate_and_fix_soap_coverage(ehr, transcript, evidence)

        complaint = result["subjective"]["chief_complaints"][0]
        self.assertEqual(complaint["severity"], "severe")
        self.assertEqual(complaint["course"], "worsening")

    def test_complaint_name_does_not_duplicate_severity_course_and_duration(self):
        transcript = "Patient: My fever is severe and getting worse for two days."
        ehr = _empty_soap_ehr()
        ehr["subjective"]["chief_complaints"] = [{
            "complaint": "My fever is severe and getting worse for two days.",
            "severity": "severe",
            "course": "worsening",
            "duration": "two days",
        }]
        evidence = retrieve_soap_context(transcript)["evidence"]

        result = _validate_and_fix_soap_coverage(ehr, transcript, evidence)

        complaint = result["subjective"]["chief_complaints"][0]
        self.assertEqual(complaint["complaint"], "Fever")
        self.assertEqual(complaint["severity"], "severe")
        self.assertEqual(complaint["course"], "worsening")
        self.assertEqual(complaint["duration"], "two days")

    def test_unspoken_complaint_severity_and_course_remain_blank(self):
        transcript = "Patient: I have fever for two days."
        ehr = _empty_soap_ehr()
        ehr["subjective"]["chief_complaints"] = [{
            "complaint": "fever",
            "severity": "severe",
            "course": "worsening",
            "duration": "two days",
        }]
        evidence = retrieve_soap_context(transcript)["evidence"]

        result = _validate_and_fix_soap_coverage(ehr, transcript, evidence)

        complaint = result["subjective"]["chief_complaints"][0]
        self.assertIsNone(complaint["severity"])
        self.assertIsNone(complaint["course"])

    def test_generic_after_food_is_recovered_for_prescription(self):
        transcript = "Doctor: Take Dolo 650 one tablet after food."
        ehr = _empty_soap_ehr()
        ehr["plan"]["prescriptions"] = [{"medicine_name": "Dolo 650"}]
        evidence = retrieve_soap_context(transcript)["evidence"]

        result = _validate_and_fix_soap_coverage(ehr, transcript, evidence)

        prescription = result["plan"]["prescriptions"][0]
        self.assertEqual(prescription["dose"], "one tablet")
        self.assertEqual(prescription["meal_timing"], "After food")
        self.assertIsNone(prescription["specific_timing"])

    def test_before_breakfast_populates_period_and_meal_relation(self):
        transcript = "Doctor: Take Dolo 650 one tablet before breakfast."
        ehr = _empty_soap_ehr()
        ehr["plan"]["prescriptions"] = [{"medicine_name": "Dolo 650"}]
        evidence = retrieve_soap_context(transcript)["evidence"]

        result = _validate_and_fix_soap_coverage(ehr, transcript, evidence)

        prescription = result["plan"]["prescriptions"][0]
        self.assertEqual(prescription["specific_timing"], "Breakfast")
        self.assertEqual(prescription["meal_timing"], "Before food")

    def test_complementary_timing_survives_repeated_medicine_mention(self):
        transcript = (
            "Doctor: Take Dolo 650 one tablet after lunch.\n"
            "Doctor: Please repeat it.\n"
            "Doctor: Take Dolo 650 one tablet."
        )
        ehr = _empty_soap_ehr()
        ehr["plan"]["prescriptions"] = [{"medicine_name": "Dolo 650"}]
        evidence = retrieve_soap_context(transcript)["evidence"]

        result = _validate_and_fix_soap_coverage(ehr, transcript, evidence)

        prescription = result["plan"]["prescriptions"][0]
        self.assertEqual(prescription["dose"], "one tablet")
        self.assertEqual(prescription["specific_timing"], "Lunch")
        self.assertEqual(prescription["meal_timing"], "After food")

    def test_repeated_one_tablet_mentions_never_become_two_tablets(self):
        transcript = (
            "Doctor: Take Dolo 650 one tablet.\n"
            "Doctor: Please repeat the instruction.\n"
            "Doctor: Take Dolo 650 one tablet."
        )
        ehr = _empty_soap_ehr()
        ehr["plan"]["prescriptions"] = [{
            "medicine_name": "Dolo 650",
            "dose": "two tablets",
        }]
        evidence = retrieve_soap_context(transcript)["evidence"]

        result = _validate_and_fix_soap_coverage(ehr, transcript, evidence)

        self.assertEqual(len(result["plan"]["prescriptions"]), 1)
        self.assertEqual(result["plan"]["prescriptions"][0]["dose"], "one tablet")

    def test_explicit_dose_correction_is_not_treated_as_repetition(self):
        transcript = (
            "Doctor: Take Dolo 650 one tablet.\n"
            "Doctor: No, I mean take Dolo 650 two tablets."
        )
        ehr = _empty_soap_ehr()
        ehr["plan"]["prescriptions"] = [{
            "medicine_name": "Dolo 650",
            "dose": "two tablets",
        }]
        evidence = retrieve_soap_context(transcript)["evidence"]

        result = _validate_and_fix_soap_coverage(ehr, transcript, evidence)

        self.assertEqual(result["plan"]["prescriptions"][0]["dose"], "two tablets")

    def test_allergy_recovery_runs_after_section_merge(self):
        transcript = "Doctor: Do you have any allergies?\nPatient: I have dust allergy."
        ehr = _empty_soap_ehr()
        evidence = retrieve_soap_context(transcript)["evidence"]

        result = _validate_and_fix_soap_coverage(ehr, transcript, evidence)

        self.assertEqual(result["subjective"]["allergies"], ["Dust allergy"])

    def test_allergy_is_scoped_when_another_fact_precedes_it(self):
        transcript = "Patient: I have fever for two days and I have dust allergy."
        ehr = _empty_soap_ehr()
        evidence = retrieve_soap_context(transcript)["evidence"]

        result = _validate_and_fix_soap_coverage(ehr, transcript, evidence)

        self.assertEqual(result["subjective"]["allergies"], ["Dust allergy"])


class HybridGenerationConcurrencyTests(unittest.IsolatedAsyncioTestCase):
    async def test_generation_uses_two_grouped_calls_with_maximum_two_in_flight(self):
        state = {"active": 0, "maximum": 0, "started": []}

        class FakeResponse:
            def __init__(self, sections: tuple[str, ...]):
                self.sections = sections
                self.status = 200

            async def __aenter__(self):
                state["active"] += 1
                state["maximum"] = max(state["maximum"], state["active"])
                state["started"].append(self.sections)
                return self

            async def __aexit__(self, exc_type, exc, tb):
                state["active"] -= 1

            async def text(self):
                await asyncio.sleep(0.01)
                content = json.dumps({section: _empty_soap_ehr()[section] for section in self.sections})
                return json.dumps({"done": True, "message": {"content": content}})

        class FakeSession:
            def __init__(self, *args, **kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, tb):
                return None

            def post(self, url, json):
                return FakeResponse(tuple(json["format"]["required"]))

        bundle = retrieve_soap_context("Patient: I have fever for two days.")
        with patch("app.routers.ehr.aiohttp.ClientSession", FakeSession):
            ehr, model, flags = await _generate_with_ollama(
                "Patient: I have fever for two days.", bundle
            )

        self.assertEqual(
            set(state["started"]),
            {("subjective", "objective"), ("assessment", "plan")},
        )
        self.assertEqual(len(state["started"]), 2)
        self.assertEqual(state["maximum"], 2)
        self.assertEqual(ehr["subjective"]["chief_complaints"], [])
        self.assertIsInstance(flags, list)
        self.assertTrue(model)

    def test_group_schema_contains_only_requested_sections(self):
        schema = _soap_sections_schema(("subjective", "objective"))
        self.assertEqual(schema["required"], ["subjective", "objective"])
        self.assertEqual(set(schema["properties"]), {"subjective", "objective"})


if __name__ == "__main__":
    unittest.main()
