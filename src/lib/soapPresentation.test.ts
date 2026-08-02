import { describe, expect, it } from "vitest";
import { EMPTY_ASSESSMENT_MESSAGE, EMPTY_PLAN_MESSAGE, hasAssessmentContent, hasPlanContent } from "./soapPresentation";

describe("doctor SOAP presentation", () => {
  it("keeps the empty Assessment state explicit", () => {
    expect(hasAssessmentContent({})).toBe(false);
    expect(EMPTY_ASSESSMENT_MESSAGE).toBe("Awaiting doctor assessment.");
  });

  it("keeps the empty Plan state explicit", () => {
    expect(hasPlanContent({})).toBe(false);
    expect(EMPTY_PLAN_MESSAGE).toBe("Awaiting doctor plan.");
  });

  it("recognizes canonical populated Assessment and Plan fields", () => {
    expect(hasAssessmentContent({ provisional_diagnosis: ["Viral infection"] })).toBe(true);
    expect(hasPlanContent({ monitoring: ["Monitor temperature twice daily"] })).toBe(true);
  });
});
