import { describe, expect, it } from "vitest";
import {
  EVENT_REGULAR_MIN_HEIGHT,
  EVENT_ROOMY_MIN_HEIGHT,
  eventVisualLayout
} from "../../src/day/eventLayout";

describe("timeline event visual density", () => {
  it("keeps only the title when the rendered card cannot fit metadata", () => {
    expect(eventVisualLayout(34)).toEqual({ density: "compact", showMetadata: false });
    expect(eventVisualLayout(EVENT_REGULAR_MIN_HEIGHT - 0.01)).toEqual({ density: "compact", showMetadata: false });
  });

  it("shows title and metadata once their measured height fits", () => {
    expect(eventVisualLayout(EVENT_REGULAR_MIN_HEIGHT)).toEqual({ density: "regular", showMetadata: true });
    expect(eventVisualLayout(EVENT_ROOMY_MIN_HEIGHT - 0.01)).toEqual({ density: "regular", showMetadata: true });
  });

  it("preserves whitespace without adding information to roomy cards", () => {
    expect(eventVisualLayout(EVENT_ROOMY_MIN_HEIGHT)).toEqual({ density: "roomy", showMetadata: true });
    expect(eventVisualLayout(120)).toEqual({ density: "roomy", showMetadata: true });
  });
});
