import { describe, expect, it } from "vitest";
import { showsConnectionControl } from "../../src/app/appPresentation";

describe("app route presentation", () => {
  it("keeps connection settings on Month View and out of Day View flow", () => {
    expect(showsConnectionControl("month")).toBe(true);
    expect(showsConnectionControl("day")).toBe(false);
  });
});
