import unittest

from app.routers.ehr import _empty_soap_ehr, _validate_and_fix_soap_coverage


class EhrExtractionValidationTests(unittest.TestCase):
    def test_negatives_keep_negation_and_are_removed_from_positive_fields(self):
        ehr = _empty_soap_ehr()
        ehr["subjective"]["relevant_negatives"] = ["Cough", "Diabetes", "No asthma"]
        ehr["subjective"]["symptoms"] = [{
            "name": "Cough", "duration": None, "severity": None,
            "progression": None, "source": "patient_reported",
        }]
        ehr["subjective"]["medical_conditions"] = ["Diabetes"]
        ehr["assessment"]["confirmed_diagnoses"] = ["Asthma"]

        result = _validate_and_fix_soap_coverage(
            ehr,
            "Patient: No cough, diabetes, or asthma.",
        )

        self.assertEqual(
            result["subjective"]["relevant_negatives"],
            ["No cough", "No diabetes", "No asthma"],
        )
        self.assertEqual(result["subjective"]["symptoms"], [])
        self.assertEqual(result["subjective"]["medical_conditions"], [])
        self.assertEqual(result["assessment"]["confirmed_diagnoses"], [])

    def test_each_negative_uses_the_nearest_spoken_negation(self):
        ehr = _empty_soap_ehr()
        ehr["subjective"]["relevant_negatives"] = ["Vomiting", "Diabetes", "Cough"]

        result = _validate_and_fix_soap_coverage(
            ehr,
            "Patient: Denies vomiting, never had diabetes, and does not have cough.",
        )

        self.assertEqual(
            result["subjective"]["relevant_negatives"],
            ["Denies vomiting", "Never had diabetes", "Does not have cough"],
        )

    def test_medicine_name_and_prescription_values_are_transcript_faithful(self):
        ehr = _empty_soap_ehr()
        ehr["plan"]["prescriptions"] = [
            {
                "medicine_name": "Dolo",
                "strength": "650 mg",
                "dose": "1 tablet",
                "schedule": {"morning": "Morning dose", "afternoon": None, "night": None},
                "meal_timing": "After food",
                "specific_timing": "After lunch",
                "frequency": "Every 8 hours",
                "duration": "Maximum 3 days",
                "as_needed": True,
                "indication": "Fever",
                "additional_instructions": "Drink extra water",
                "needs_doctor_review": False,
            },
            {
                "medicine_name": "Exiturazine",
                "strength": None,
                "dose": None,
                "schedule": {"morning": None, "afternoon": None, "night": None},
                "meal_timing": None,
                "specific_timing": None,
                "frequency": None,
                "duration": None,
                "as_needed": None,
                "indication": None,
                "additional_instructions": None,
                "needs_doctor_review": False,
            },
            {
                "medicine_name": "650",
                "strength": "650 mg",
                "dose": None,
                "schedule": {"morning": None, "afternoon": None, "night": None},
                "meal_timing": None,
                "specific_timing": None,
                "frequency": None,
                "duration": None,
                "as_needed": None,
                "indication": None,
                "additional_instructions": None,
                "needs_doctor_review": False,
            },
        ]
        transcript = (
            "Doctor: Take Dolo 650, strength 650 mg, dose 1 tablet every 8 hours "
            "for maximum 3 days, after lunch and after food, as needed for fever. "
            "The other medicine sounded like Exiturazine; I am not sure about that name."
        )

        result = _validate_and_fix_soap_coverage(ehr, transcript)
        prescriptions = result["plan"]["prescriptions"]

        self.assertEqual(len(prescriptions), 2)
        self.assertEqual(prescriptions[0]["medicine_name"], "Dolo 650")
        self.assertEqual(prescriptions[0]["strength"], "650 mg")
        self.assertEqual(prescriptions[0]["dose"], "1 tablet")
        self.assertEqual(prescriptions[0]["frequency"], "Every 8 hours")
        self.assertEqual(prescriptions[0]["duration"], "Maximum 3 days")
        self.assertEqual(prescriptions[0]["specific_timing"], "After lunch")
        self.assertEqual(prescriptions[0]["meal_timing"], "After food")
        self.assertIs(prescriptions[0]["as_needed"], True)
        self.assertEqual(prescriptions[0]["indication"], "Fever")
        self.assertIsNone(prescriptions[0]["additional_instructions"])
        self.assertEqual(
            prescriptions[0]["schedule"],
            {"morning": None, "afternoon": None, "night": None},
        )
        self.assertEqual(prescriptions[1]["medicine_name"], "Exiturazine")
        self.assertIs(prescriptions[1]["needs_doctor_review"], True)

    def test_uncertain_annotation_keeps_heard_name_not_possible_replacement(self):
        ehr = _empty_soap_ehr()
        ehr["plan"]["prescriptions"] = [{
            "medicine_name": "Dolo 650",
            "strength": None,
            "dose": None,
            "schedule": {"morning": None, "afternoon": None, "night": None},
            "meal_timing": None,
            "specific_timing": None,
            "frequency": None,
            "duration": None,
            "as_needed": None,
            "indication": None,
            "additional_instructions": None,
            "needs_doctor_review": False,
        }]

        result = _validate_and_fix_soap_coverage(
            ehr,
            "Doctor: [uncertain: heard 'Go 650', possible 'Dolo 650', needs_review=true]",
        )

        prescription = result["plan"]["prescriptions"][0]
        self.assertEqual(prescription["medicine_name"], "Go 650")
        self.assertIs(prescription["needs_doctor_review"], True)

    def test_follow_up_and_warning_signs_stay_separate_and_exact(self):
        ehr = _empty_soap_ehr()
        follow_up = "Come to the clinic in 2–3 days if symptoms are not improving."
        ehr["plan"]["treatment_advice"] = [follow_up]
        ehr["plan"]["warning_signs"] = [
            "Fever reaches 105°F",
            "Drowsiness",
            "Breathlessness",
            "Vomiting",
            "Fever persists after 3 days",
        ]
        transcript = (
            f"Doctor: {follow_up} Seek urgent help if fever reaches 105°F, "
            "drowsiness, breathlessness, or vomiting."
        )

        result = _validate_and_fix_soap_coverage(ehr, transcript)

        self.assertEqual(result["plan"]["follow_up"], follow_up)
        self.assertNotIn(follow_up, result["plan"]["treatment_advice"])
        self.assertEqual(
            result["plan"]["warning_signs"],
            ["fever reaches 105°F", "drowsiness", "breathlessness", "vomiting"],
        )

    def test_current_symptoms_and_durations_do_not_become_plan_items(self):
        ehr = _empty_soap_ehr()
        ehr["plan"]["follow_up"] = "3 days"
        ehr["plan"]["warning_signs"] = ["Fever", "Drowsiness"]

        result = _validate_and_fix_soap_coverage(
            ehr,
            "Patient: I have had fever for 3 days. Doctor: Seek urgent help if drowsiness develops.",
        )

        self.assertIsNone(result["plan"]["follow_up"])
        self.assertEqual(result["plan"]["warning_signs"], ["drowsiness"])


if __name__ == "__main__":
    unittest.main()
