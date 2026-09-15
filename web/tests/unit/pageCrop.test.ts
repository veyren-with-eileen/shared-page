import { describe, expect, it } from "vitest";
import type { CalendarNote, DayEvent } from "../../src/domain/calendar";
import type { PlacedItem } from "../../src/domain/scrapbook";
import { PAGE_ROW_HEIGHT, computePageCrop, pageTimelineY } from "../../src/snapshot/pageCrop";

function event(startMinute: number, endMinute: number): DayEvent {
  return { id: "e", author: "kitty", title: "event", description: null, eventType: null, isAllDay: false, isSpan: false, originalStartsAt: "2026-09-15T10:00:00+08:00", originalEndsAt: "2026-09-15T11:00:00+08:00", startMinute, endMinute, continuesBefore: false, continuesAfter: false, spanIndex: null, spanLength: null, revision: 1 };
}

function note(y: number | null): CalendarNote {
  return { id: "n", author: "kitty", body: "note", timestamp: "now", liked: false, linkedEventId: null, y, anchorDate: "2026-09-15" };
}

function placed(kind: PlacedItem["kind"], y: number, scale = 1): PlacedItem {
  return { id: kind, dayKey: "2026-09-15", kind, ...(kind === "emoji" ? { emoji: "🌷" } : kind === "sticker" ? { stickerId: "s" } : { photoKey: "p" }), x: 201, y, scale, rotation: 0, placedAt: "2026-09-15T00:00:00Z" };
}

describe("PageCrop", () => {
  it("keeps the original compact empty-day region", () => expect(computePageCrop([], [], [])).toEqual({ top: 54, height: 176 }));
  it("crops around a single early event", () => expect(computePageCrop([event(6 * 60 + 15, 7 * 60)], [], []).top).toBe(2));
  it("keeps a late event near the 23:00 clamp", () => expect(computePageCrop([event(22 * 60, 23 * 60)], [], []).height).toBeGreaterThanOrEqual(PAGE_ROW_HEIGHT));
  it("covers a long event", () => expect(computePageCrop([event(9 * 60, 15 * 60)], [], []).height).toBeGreaterThan(6 * PAGE_ROW_HEIGHT));
  it("uses fallback note y", () => expect(computePageCrop([], [note(null)], []).top).toBe(2));
  it("uses explicit note y", () => expect(computePageCrop([], [note(420)], []).top).toBe(pageTimelineY(13) - 8));
  it.each(["sticker", "photo", "emoji"] as const)("covers a %s", (kind) => expect(computePageCrop([], [], [placed(kind, 400)]).height).toBeGreaterThanOrEqual(PAGE_ROW_HEIGHT));
  it("applies placed scale", () => expect(computePageCrop([], [], [placed("photo", 400, 2)]).height).toBeGreaterThan(computePageCrop([], [], [placed("photo", 400, 1)]).height));
  it("uses half-diagonal coverage regardless of rotation", () => expect(computePageCrop([], [], [{ ...placed("photo", 400), rotation: 47 }])).toEqual(computePageCrop([], [], [placed("photo", 400)])));
  it("never returns less than one row", () => expect(computePageCrop([event(10 * 60, 10 * 60 + 1)], [], []).height).toBeGreaterThanOrEqual(PAGE_ROW_HEIGHT));
  it("clamps content before 06:00", () => expect(computePageCrop([event(0, 90)], [], []).top).toBe(2));
  it("clamps content after 23:00", () => expect(computePageCrop([], [], [placed("emoji", 1030)]).top).toBeLessThan(1030));
});
