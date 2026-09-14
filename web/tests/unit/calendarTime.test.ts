import { describe, expect, it } from "vitest";
import {
  apiMonthRange,
  daysInMonth,
  leadingBlanks,
  monthGrid,
  nextMonth,
  normalizeMonth,
  parseMonthKey,
  previousMonth,
  weekRows
} from "../../src/domain/calendarTime";

describe("calendar month parity", () => {
  it("normalizes overflow months like CalMonth", () => {
    expect(normalizeMonth(2026, 13)).toEqual({ year: 2027, month: 1 });
    expect(normalizeMonth(2026, 0)).toEqual({ year: 2025, month: 12 });
    expect(previousMonth({ year: 2026, month: 1 })).toEqual({ year: 2025, month: 12 });
    expect(nextMonth({ year: 2026, month: 12 })).toEqual({ year: 2027, month: 1 });
  });

  it("rejects malformed month keys", () => {
    expect(parseMonthKey("2026-08")).toEqual({ year: 2026, month: 8 });
    expect(parseMonthKey("2026-13")).toBeNull();
    expect(parseMonthKey("26-08")).toBeNull();
  });

  it("matches the Monday-first 4-6 row grid", () => {
    expect(daysInMonth({ year: 2026, month: 2 })).toBe(28);
    expect(leadingBlanks({ year: 2026, month: 7 })).toBe(2);
    expect(weekRows({ year: 2026, month: 7 })).toBe(5);
    expect(weekRows({ year: 2026, month: 8 })).toBe(6);
    expect(monthGrid({ year: 2026, month: 7 })).toHaveLength(35);
  });

  it("queries Taipei month boundaries as UTC Z timestamps", () => {
    expect(apiMonthRange({ year: 2026, month: 8 })).toEqual({
      from: "2026-07-31T16:00:00Z",
      to: "2026-08-31T16:00:00Z"
    });
  });
});
