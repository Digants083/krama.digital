import { describe, expect, it } from "vitest";
import { medicationMealCode, medicationWhenToTake } from "./medicationDisplay";

describe("medication display formatting", () => {
  it.each([
    ["after breakfast", "Breakfast", "AF"],
    ["before lunch", "Lunch", "BF"],
    ["after dinner", "Dinner", "AF"],
    ["at night", "Dinner", ""],
    ["noon", "Lunch", ""],
  ])("separates %s into meal period and relation", (specificTiming, when, meal) => {
    const medicine = { specific_timing: specificTiming };
    expect(medicationWhenToTake(medicine)).toBe(when);
    expect(medicationMealCode(medicine)).toBe(meal);
  });

  it("prefers explicit meal relation while keeping schedule period", () => {
    const medicine = {
      specific_timing: "Lunch",
      meal_timing: "After food",
      schedule: { afternoon: "Lunch" },
    };
    expect(medicationWhenToTake(medicine)).toBe("Lunch");
    expect(medicationMealCode(medicine)).toBe("AF");
  });

  it("never displays free text in the when-to-take column", () => {
    expect(medicationWhenToTake({ specific_timing: "take with plenty of water" })).toBe("");
  });
});
