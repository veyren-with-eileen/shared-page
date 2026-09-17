import { describe, expect, it } from "vitest";
import type { EventDTO } from "../../src/domain/calendar";
import { draftFromEvent, eventWritePayload, selectDraftEventType } from "../../src/domain/eventWrite";

function dto(overrides: Partial<EventDTO> = {}): EventDTO {
  return {
    id: "cal_test", title: "test", description: null,
    startsAt: "2026-09-15T02:00:00Z", endsAt: "2026-09-15T03:00:00Z",
    timezone: "Asia/Taipei", precision: "hour", eventType: "custom", source: "manual",
    createdBy: "kitty", revision: 1, status: "active", metadata: {}, createdAt: null,
    updatedAt: null, deletedAt: null, ...overrides
  };
}

describe("event write parity", () => {
  it("builds the iOS-compatible timed event request shape", () => {
    expect(eventWritePayload({ title: " Checkpoint 3A test ", date: "2026-09-15", startTime: "10:00", endTime: "11:00", allDay: false, eventType: null })).toEqual({
      title: "Checkpoint 3A test",
      starts_at: "2026-09-15T10:00:00+08:00",
      ends_at: "2026-09-15T11:00:00+08:00",
      precision: "hour",
      event_type: "custom"
    });
  });

  it("uses Taipei midnight and an exclusive next-day end for all-day events", () => {
    expect(eventWritePayload({ title: "all day", date: "2026-09-15", startTime: "09:00", endTime: "10:00", allDay: true, eventType: null })).toEqual({
      title: "all day",
      starts_at: "2026-09-15T00:00:00+08:00",
      ends_at: "2026-09-16T00:00:00+08:00",
      precision: "day",
      event_type: "custom"
    });
  });

  it("persists anniversary and birthday through the existing event_type contract", () => {
    expect(eventWritePayload({ title: "our day", date: "2026-07-25", startTime: "09:00", endTime: "10:00", allDay: true, eventType: "anniversary" })).toMatchObject({
      precision: "day",
      event_type: "anniversary"
    });
    expect(eventWritePayload({ title: "birthday", date: "2026-10-03", startTime: "09:00", endTime: "10:00", allDay: true, eventType: "birthday" })).toMatchObject({
      precision: "day",
      event_type: "birthday"
    });
  });

  it("rejects a timed event whose end is not later than its start", () => {
    expect(() => eventWritePayload({ title: "bad", date: "2026-09-15", startTime: "11:00", endTime: "10:00", allDay: false, eventType: null })).toThrow("End time");
  });

  it("round-trips timed and all-day canonical DTOs into editor drafts", () => {
    expect(draftFromEvent(dto())).toMatchObject({ date: "2026-09-15", startTime: "10:00", endTime: "11:00", allDay: false, eventType: null });
    expect(draftFromEvent(dto({ startsAt: "2026-09-14T16:00:00Z", endsAt: "2026-09-15T16:00:00Z", precision: "day", eventType: "birthday" }))).toMatchObject({ date: "2026-09-15", allDay: true, eventType: "birthday" });
  });

  it("forces special days all-day and restores valid times when switching back", () => {
    const normal = { title: "day", date: "2026-09-15", startTime: "00:00", endTime: "00:00", allDay: false, eventType: null } as const;
    const special = selectDraftEventType(normal, "anniversary");
    expect(special).toMatchObject({ eventType: "anniversary", allDay: true });
    expect(selectDraftEventType(special, "birthday")).toMatchObject({ eventType: "birthday", allDay: true });
    expect(selectDraftEventType(special, null)).toMatchObject({ eventType: null, allDay: false, startTime: "09:00", endTime: "10:00" });
  });
});
