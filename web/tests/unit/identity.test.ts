import { describe, expect, it } from "vitest";
import { DISPLAY_NAME } from "../../src/theme/identity";

describe("display identity", () => {
  it("maps stable calendar authors to the Month View names", () => {
    expect(DISPLAY_NAME).toEqual({ kitty: "Eileen", master: "Veyren", system: "AUTO" });
  });
});
