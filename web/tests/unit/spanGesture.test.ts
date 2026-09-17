import { describe, expect, it } from "vitest";
import {
  armSpanGesture,
  beginSpanGesture,
  endSpanGesture,
  hitSpanBand,
  moveSpanGesture,
  SpanGestureSession
} from "../../src/month/spanGesture";

describe("Month View span gesture", () => {
  it("keeps a short tap as day navigation, including a grey-cell target", () => {
    const gesture = beginSpanGesture(1, { x: 5, y: 5 }, "2026-08-31", null, null);
    expect(endSpanGesture(gesture, { x: 7, y: 6 })).toEqual({ type: "open-day", dayKey: "2026-08-31" });
  });

  it("arms an empty current-month cell, previews the dragged range, and opens a draft on release", () => {
    let gesture = beginSpanGesture(1, { x: 5, y: 5 }, "2026-09-15", 15, null);
    gesture = armSpanGesture(gesture).state;
    expect(gesture).toMatchObject({ pickFrom: 15, pickTo: 15 });
    gesture = moveSpanGesture(gesture, { x: 60, y: 5 }, 18);
    expect(gesture.pickTo).toBe(18);
    expect(endSpanGesture(gesture, { x: 60, y: 5 })).toEqual({ type: "new-span", startDay: 15, endDay: 18 });
  });

  it("long-presses an existing visible band into edit without navigation", () => {
    const gesture = beginSpanGesture(1, { x: 5, y: 20 }, "2026-09-15", 15, "cal_span");
    const armed = armSpanGesture(gesture);
    expect(armed.effect).toEqual({ type: "edit-span", id: "cal_span" });
    expect(endSpanGesture(armed.state, { x: 5, y: 20 })).toBeNull();
  });

  it("returns to idle when an editor consumes a long press, then accepts the next tap", () => {
    const session = new SpanGestureSession();
    expect(session.begin(beginSpanGesture(1, { x: 5, y: 20 }, "2026-09-15", 15, "cal_span"))).toBe(true);
    expect(session.arm()?.effect).toEqual({ type: "edit-span", id: "cal_span" });
    expect(session.cancel()).toBe(1);
    expect(session.state).toBeNull();
    expect(session.begin(beginSpanGesture(2, { x: 8, y: 8 }, "2026-09-16", 16, null))).toBe(true);
    expect(session.finish({ x: 8, y: 8 })).toEqual({ type: "open-day", dayKey: "2026-09-16" });
  });

  it("survives repeated long-press edit/cancel cycles without retaining a handled gesture", () => {
    const session = new SpanGestureSession();
    for (let pointerId = 1; pointerId <= 5; pointerId += 1) {
      expect(session.begin(beginSpanGesture(pointerId, { x: 5, y: 20 }, "2026-09-15", 15, "cal_span"))).toBe(true);
      expect(session.arm()?.effect).toEqual({ type: "edit-span", id: "cal_span" });
      session.cancel();
      expect(session.state).toBeNull();
    }
    session.begin(beginSpanGesture(6, { x: 4, y: 4 }, "2026-10-01", 1, null));
    expect(session.finish({ x: 4, y: 4 })).toEqual({ type: "open-day", dayKey: "2026-10-01" });
  });

  it("does not arm after scrolling-sized movement and matches only the first two band lanes", () => {
    const moved = moveSpanGesture(
      beginSpanGesture(1, { x: 0, y: 0 }, "2026-09-15", 15, null),
      { x: 0, y: 20 },
      16
    );
    expect(armSpanGesture(moved).state.pickFrom).toBeNull();
    const spans = [
      { id: "a", author: "kitty" as const, title: "a", startDay: 15, endDay: 17, revision: 1 },
      { id: "b", author: "master" as const, title: "b", startDay: 15, endDay: 16, revision: 1 },
      { id: "c", author: "system" as const, title: "c", startDay: 15, endDay: 15, revision: 1 }
    ];
    expect(hitSpanBand(spans, 15, 20)).toBe("a");
    expect(hitSpanBand(spans, 15, 56)).toBe("b");
    expect(hitSpanBand(spans, 15, 92)).toBeNull();
  });
});
