import { describe, expect, it } from "vitest";
import {
  BUILT_IN_STICKERS,
  boundedImageSize,
  canonicalTimelinePoint,
  clampPlacedPoint,
  firstGrapheme,
  normalizeAngleDelta,
  placedGestureIntent,
  pointInRect,
  recentPlacedItems,
  stickerBaseSize,
  stripGestureIntent,
  transformStep,
  type PlacedItem
} from "../../src/domain/scrapbook";

function placed(id: string, placedAt: string): PlacedItem {
  return { id, dayKey: "2026-09-15", kind: "emoji", emoji: "✨", x: 201, y: 200, scale: 1, rotation: 0, placedAt };
}

describe("scrapbook coordinates and gestures", () => {
  it("maps desktop coordinates 1:1 into the canonical timeline", () => {
    expect(canonicalTimelinePoint({ x: 211, y: 150 }, { left: 10, top: 50, width: 402, height: 500 }, 0)).toEqual({ x: 201, y: 100 });
  });

  it("reverses narrow viewport scaling and includes scrollTop", () => {
    expect(canonicalTimelinePoint({ x: 100.5, y: 200 }, { left: 0, top: 100, width: 201, height: 300 }, 300)).toEqual({ x: 201, y: 500 });
  });

  it("clamps centers so an item remains recoverable", () => {
    expect(clampPlacedPoint({ x: -400, y: 9999 })).toEqual({ x: 8, y: 1034 });
  });

  it("classifies quick movement as scrolling until an item is armed", () => {
    expect(placedGestureIntent(false, false, 3)).toBe("pending");
    expect(placedGestureIntent(false, false, 12)).toBe("scroll");
    expect(placedGestureIntent(false, true, 0)).toBe("drag");
    expect(placedGestureIntent(true, false, 0)).toBe("drag");
  });

  it("distinguishes horizontal strip scroll from vertical sticker lift", () => {
    expect(stripGestureIntent(3, 2)).toBe("undecided");
    expect(stripGestureIntent(12, 4)).toBe("scroll");
    expect(stripGestureIntent(3, -12)).toBe("lift");
    expect(pointInRect({ x: 20, y: 20 }, { left: 0, top: 0, width: 40, height: 40 })).toBe(true);
    expect(pointInRect({ x: 20, y: -2 }, { left: 0, top: 0, width: 40, height: 40 })).toBe(false);
  });

  it("clamps transform scale and accumulates rotation across ±180°", () => {
    expect(transformStep(1, 10, 100, 10, 0, 0).scale).toBe(0.35);
    expect(transformStep(1, 10, 100, 900, 0, 0).scale).toBe(3);
    expect(normalizeAngleDelta(-179 - 179)).toBe(2);
    expect(transformStep(1, 40, 100, 100, 179, -179).rotation).toBe(42);
  });
});

describe("scrapbook sources and thumbnails", () => {
  it("keeps the five iOS built-in sticker IDs stable and unique", () => {
    expect(BUILT_IN_STICKERS).toHaveLength(5);
    expect(new Set(BUILT_IN_STICKERS.map((item) => item.id)).size).toBe(5);
    expect(BUILT_IN_STICKERS[0].id).toBe("5713ca70-0000-4000-a000-000000000001");
  });

  it("normalizes sticker art to a 92px long side", () => {
    const size = stickerBaseSize(BUILT_IN_STICKERS[2]);
    expect(size.x).toBe(92);
    expect(size.y).toBeCloseTo(54.52, 2);
  });

  it("returns only the newest three thumbnails with newest rendered last", () => {
    const items = [
      placed("one", "2026-09-15T01:00:00Z"), placed("four", "2026-09-15T04:00:00Z"),
      placed("two", "2026-09-15T02:00:00Z"), placed("three", "2026-09-15T03:00:00Z")
    ];
    expect(recentPlacedItems(items).map((item) => item.id)).toEqual(["two", "three", "four"]);
  });

  it("preserves multi-codepoint emoji grapheme clusters", () => {
    expect(firstGrapheme("👨‍👩‍👧‍👦✨")).toBe("👨‍👩‍👧‍👦");
    expect(firstGrapheme("🇹🇼abc")).toBe("🇹🇼");
    expect(firstGrapheme("👍🏽👍")).toBe("👍🏽");
  });

  it("bounds camera images without upscaling small sources", () => {
    expect(boundedImageSize(4032, 3024)).toEqual({ x: 1600, y: 1200 });
    expect(boundedImageSize(800, 600)).toEqual({ x: 800, y: 600 });
  });
});
