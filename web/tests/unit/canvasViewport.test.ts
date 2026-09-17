import { describe, expect, it } from "vitest";
import { canvasViewportMetrics } from "../../src/app/CanvasViewport";

describe("canvas viewport metrics", () => {
  it("keeps the canonical canvas on a roomy desktop", () => {
    expect(canvasViewportMetrics(1280, 900, 874, true)).toEqual({ scale: 1, canvasHeight: 874 });
  });

  it("fits a Day View into an iPhone SE viewport while preserving 402px coordinates", () => {
    const metrics = canvasViewportMetrics(375, 667, 874, true);

    expect(metrics.scale).toBeCloseTo(375 / 402);
    expect(metrics.canvasHeight * metrics.scale).toBeCloseTo(667);
  });

  it("does not shorten fixed-height Month View canvases", () => {
    const metrics = canvasViewportMetrics(375, 667, 874, false);

    expect(metrics.canvasHeight).toBe(874);
    expect(metrics.canvasHeight * metrics.scale).toBeGreaterThan(667);
  });

  it("fits the complete Month canvas to a short phone without changing canonical geometry", () => {
    const metrics = canvasViewportMetrics(375, 667, 874, false, true);

    expect(metrics.scale).toBeCloseTo(667 / 874);
    expect(metrics.canvasHeight).toBe(874);
    expect(metrics.canvasHeight * metrics.scale).toBeCloseTo(667);
  });

  it("fits Month View to the safe-area-adjusted stage rather than the raw device viewport", () => {
    const rawViewportHeight = 852;
    const safeAreaAdjustedHeight = 793;
    const metrics = canvasViewportMetrics(390, safeAreaAdjustedHeight, 874, false, true);

    expect(metrics.scale).toBeCloseTo(safeAreaAdjustedHeight / 874);
    expect(metrics.canvasHeight * metrics.scale).toBeCloseTo(safeAreaAdjustedHeight);
    expect(metrics.canvasHeight * metrics.scale).toBeLessThan(rawViewportHeight);
  });
});
