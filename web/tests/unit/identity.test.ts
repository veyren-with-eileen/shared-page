import { describe, expect, it } from "vitest";
import { DISPLAY_NAME } from "../../src/theme/identity";
import { EVENT_TYPE_LABEL, eventTypeLabel } from "../../src/theme/eventType";

describe("display identity", () => {
  it("maps stable calendar authors to the Month View names", () => {
    expect(DISPLAY_NAME).toEqual({ kitty: "Eileen", master: "Veyren", system: "AUTO" });
    expect(Object.values(DISPLAY_NAME)).not.toContain("USER");
    expect(Object.values(DISPLAY_NAME)).not.toContain("ASSISTANT");
  });

  it("keeps special-day labels separate from author identity", () => {
    expect(EVENT_TYPE_LABEL).toEqual({ anniversary: "紀念日", birthday: "生日" });
    expect(eventTypeLabel("custom")).toBeNull();
  });
});
