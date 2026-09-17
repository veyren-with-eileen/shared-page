import { describe, expect, it } from "vitest";
import type { CalendarSpan, EventDTO } from "../../src/domain/calendar";
import {
  draftFromSpan,
  optimisticSpan,
  removeSpanDayPlan,
  spanCreatePayload,
  spanPatchPayload
} from "../../src/domain/spanWrite";

const september = { year: 2026, month: 9 };
const base: CalendarSpan = {
  id: "cal_span",
  author: "kitty",
  title: "trip",
  startDay: 15,
  endDay: 19,
  revision: 1
};

function dto(overrides: Partial<EventDTO> = {}): EventDTO {
  return {
    id: "cal_span", title: "trip", description: null,
    startsAt: "2026-09-15T00:00:00+08:00", endsAt: "2026-09-20T00:00:00+08:00",
    timezone: "Asia/Taipei", precision: "day", eventType: null, source: "manual",
    createdBy: "kitty", revision: 1, status: "active",
    metadata: { kind: "span", preserved: true }, createdAt: null, updatedAt: null, deletedAt: null,
    ...overrides
  };
}

describe("span wire payloads", () => {
  it("creates one-day and multi-day spans at Taipei midnight with an exclusive end", () => {
    expect(spanCreatePayload({ title: "one", month: september, startDay: 15, endDay: 15 })).toEqual({
      title: "one",
      starts_at: "2026-09-15T00:00:00+08:00",
      ends_at: "2026-09-16T00:00:00+08:00",
      precision: "day",
      event_type: "custom",
      metadata: { kind: "span" }
    });
    expect(spanCreatePayload({ title: "many", month: september, startDay: 15, endDay: 17 }).ends_at)
      .toBe("2026-09-18T00:00:00+08:00");
  });

  it("normalizes reversed ranges and never sends metadata on PATCH", () => {
    const payload = spanPatchPayload(base, { title: " changed ", month: september, startDay: 20, endDay: 16 });
    expect(payload).toEqual({
      title: "changed",
      starts_at: "2026-09-16T00:00:00+08:00",
      ends_at: "2026-09-21T00:00:00+08:00",
      precision: "day",
      event_type: "custom"
    });
    expect(optimisticSpan(dto(), payload).metadata).toEqual({ kind: "span", preserved: true });
  });

  it("preserves hidden head and tail while their visible boundary remains attached", () => {
    const cross: CalendarSpan = {
      ...base,
      startDay: 1,
      endDay: 30,
      clip: { headStart: "2026-08-29T16:00:00Z", tailEnd: "2026-10-03T16:00:00Z" }
    };
    const titleOnly = spanPatchPayload(cross, { ...draftFromSpan(cross, september), title: "renamed" });
    expect(titleOnly.starts_at).toBe(cross.clip?.headStart);
    expect(titleOnly.ends_at).toBe(cross.clip?.tailEnd);

    const changed = spanPatchPayload(cross, { title: "changed", month: september, startDay: 2, endDay: 29 });
    expect(changed.starts_at).toBe("2026-09-02T00:00:00+08:00");
    expect(changed.ends_at).toBe("2026-09-30T00:00:00+08:00");
  });
});

describe("remove day mutation plans", () => {
  it("deletes a visible-only one-day span", () => {
    expect(removeSpanDayPlan({ ...base, startDay: 15, endDay: 15 }, september, 15)).toEqual({ kind: "delete" });
  });

  it("patches the head and tail with exclusive ends", () => {
    expect(removeSpanDayPlan({ ...base, startDay: 15, endDay: 17 }, september, 15)).toMatchObject({
      kind: "patch", patch: { starts_at: "2026-09-16T00:00:00+08:00", ends_at: "2026-09-18T00:00:00+08:00" }
    });
    expect(removeSpanDayPlan({ ...base, startDay: 15, endDay: 17 }, september, 17)).toMatchObject({
      kind: "patch", patch: { starts_at: "2026-09-15T00:00:00+08:00", ends_at: "2026-09-17T00:00:00+08:00" }
    });
  });

  it("splits the middle by creating the tail before patching the head", () => {
    expect(removeSpanDayPlan(base, september, 17)).toEqual({
      kind: "split",
      create: {
        title: "trip", starts_at: "2026-09-18T00:00:00+08:00",
        ends_at: "2026-09-20T00:00:00+08:00", precision: "day", event_type: "custom", metadata: { kind: "span" }
      },
      patch: {
        title: "trip", starts_at: "2026-09-15T00:00:00+08:00",
        ends_at: "2026-09-17T00:00:00+08:00", precision: "day", event_type: "custom"
      }
    });
  });

  it("preserves a hidden piece instead of deleting a visible-only boundary day", () => {
    const hiddenHead: CalendarSpan = {
      ...base, startDay: 1, endDay: 1,
      clip: { headStart: "2026-08-29T16:00:00Z" }
    };
    expect(removeSpanDayPlan(hiddenHead, september, 1)).toEqual({
      kind: "patch",
      patch: {
        title: "trip", starts_at: "2026-08-29T16:00:00Z",
        ends_at: "2026-09-01T00:00:00+08:00", precision: "day", event_type: "custom"
      }
    });
  });

  it("creates a hidden boundary piece before patching the visible remainder", () => {
    const hiddenHead: CalendarSpan = {
      ...base, startDay: 1, endDay: 3,
      clip: { headStart: "2026-08-29T16:00:00Z" }
    };
    const plan = removeSpanDayPlan(hiddenHead, september, 1);
    expect(plan).toMatchObject({
      kind: "split",
      create: { starts_at: "2026-08-29T16:00:00Z", ends_at: "2026-09-01T00:00:00+08:00", metadata: { kind: "span" } },
      patch: { starts_at: "2026-09-02T00:00:00+08:00", ends_at: "2026-09-04T00:00:00+08:00" }
    });
  });
});
