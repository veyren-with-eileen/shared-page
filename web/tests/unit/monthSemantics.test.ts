import { describe, expect, it } from "vitest";
import { SPECIAL_DAY_TYPES } from "../../src/domain/calendar";

describe("Month View special-day semantics", () => {
  it("reserves the heart stamp for anniversary and birthday only", () => {
    expect([...SPECIAL_DAY_TYPES].sort()).toEqual(["anniversary", "birthday"]);
    expect(SPECIAL_DAY_TYPES.has("holiday")).toBe(false);
    expect(SPECIAL_DAY_TYPES.has("period")).toBe(false);
  });
});
