function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function medicationWhenToTake(value: unknown): "Breakfast" | "Lunch" | "Dinner" | "" {
  const item = record(value);
  const schedule = record(item.schedule);
  const timing = String(item.specific_timing || item.timing || "").trim().toLowerCase();

  if (/(?:\bbreakfast\b|\bmorning\b)/i.test(timing) || schedule.morning) return "Breakfast";
  if (/(?:\blunch\b|\bnoon\b|\bafternoon\b)/i.test(timing) || schedule.afternoon) return "Lunch";
  if (/(?:\bdinner\b|\bnight\b)/i.test(timing) || schedule.night) return "Dinner";
  return "";
}

export function medicationMealCode(value: unknown): "AF" | "BF" | "" {
  const item = record(value);
  const mealTiming = String(item.meal_timing || item.meal_relation || "").trim();
  const specificTiming = String(item.specific_timing || item.timing || "").trim();
  const text = mealTiming || specificTiming;

  if (/\bafter\b/i.test(text)) return "AF";
  if (/\bbefore\b/i.test(text)) return "BF";
  return "";
}
