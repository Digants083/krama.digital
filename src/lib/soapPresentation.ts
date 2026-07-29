export const EMPTY_ASSESSMENT_MESSAGE = "Awaiting doctor assessment.";
export const EMPTY_PLAN_MESSAGE = "Awaiting doctor plan.";
export const EMPTY_PATIENT_SUMMARY_MESSAGE = "No patient instructions were documented for this visit.";

const hasValue = (value: unknown): boolean => {
  if (value == null || value === "") return false;
  if (Array.isArray(value)) return value.some(hasValue);
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).some(hasValue);
  return String(value).trim().length > 0;
};

export const hasAssessmentContent = (assessment: Record<string, unknown>): boolean =>
  ["clinical_impression", "provisional_diagnosis", "confirmed_diagnosis", "differential_diagnoses", "problems_being_managed"]
    .some((field) => hasValue(assessment[field]));

export const hasPlanContent = (plan: Record<string, unknown>): boolean =>
  ["prescriptions", "tests_ordered", "procedures", "treatment_advice", "diet_lifestyle_advice", "monitoring", "referrals", "follow_up", "warning_signs", "other_instructions"]
    .some((field) => hasValue(plan[field]));
