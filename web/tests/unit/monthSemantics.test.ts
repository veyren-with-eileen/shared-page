import { describe, expect, it } from "vitest";
import { SPECIAL_DAY_TYPES, isSpecialDayType } from "../../src/domain/calendar";
import { hasSpecialDay } from "../../src/month/monthSemantics";

describe("Month View special-day semantics", () => {
  it("reserves the heart stamp for anniversary and birthday only", () => {
    expect([...SPECIAL_DAY_TYPES].sort()).toEqual(["anniversary", "birthday"]);
    expect(isSpecialDayType("holiday")).toBe(false);
    expect(isSpecialDayType("period")).toBe(false);
  });

  it("renders at most one day-level stamp even when multiple special events exist", () => {
    expect(hasSpecialDay([{ eventType: "anniversary" }, { eventType: "birthday" }])).toBe(true);
    expect(hasSpecialDay([{ eventType: "custom" }, { eventType: null }])).toBe(false);
  });
});
