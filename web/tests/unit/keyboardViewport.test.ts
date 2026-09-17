import { describe, expect, it } from "vitest";
import { timelineVisibility } from "../../src/day/keyboardViewport";

describe("Day keyboard viewport ownership", () => {
  it("uses the full Timeline when no visual viewport is active", () => {
    expect(timelineVisibility({ top: 150, bottom: 800, width: 390 }, 402, 670, null)).toEqual({
      scale: 390 / 402,
      topInset: 0,
      visibleHeight: 670,
      bottomOcclusion: 0
    });
  });

  it("turns keyboard occlusion into Timeline-only scroll allowance", () => {
    const result = timelineVisibility(
      { top: 150, bottom: 800, width: 390 },
      402,
      670,
      { height: 500, offsetTop: 0 }
    );

    expect(result.topInset).toBe(0);
    expect(result.visibleHeight).toBeCloseTo(350 / result.scale);
    expect(result.bottomOcclusion).toBeCloseTo(670 - 350 / result.scale);
  });

  it("accounts for visual viewport panning without moving the Day canvas", () => {
    const result = timelineVisibility(
      { top: 150, bottom: 800, width: 390 },
      402,
      670,
      { height: 420, offsetTop: 190 }
    );

    expect(result.topInset).toBeCloseTo(40 / result.scale);
    expect(result.visibleHeight).toBeCloseTo(420 / result.scale);
  });
});
