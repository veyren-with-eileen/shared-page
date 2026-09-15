import { describe, expect, it } from "vitest";
import type { EventDTO } from "../../src/domain/calendar";
import { draftFromEvent, eventWritePayload } from "../../src/domain/eventWrite";

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
    expect(eventWritePayload({ title: " Checkpoint 3A test ", date: "2026-09-15", startTime: "10:00", endTime: "11:00", allDay: false })).toEqual({
      title: "Checkpoint 3A test",
      starts_at: "2026-09-15T10:00:00+08:00",
      ends_at: "2026-09-15T11:00:00+08:00",
      precision: "hour"
    });
  });

  it("uses Taipei midnight and an exclusive next-day end for all-day events", () => {
    expect(eventWritePayload({ title: "all day", date: "2026-09-15", startTime: "09:00", endTime: "10:00", allDay: true })).toEqual({
      title: "all day",
      starts_at: "2026-09-15T00:00:00+08:00",
      ends_at: "2026-09-16T00:00:00+08:00",
      precision: "day"
    });
  });

  it("rejects a timed event whose end is not later than its start", () => {
    expect(() => eventWritePayload({ title: "bad", date: "2026-09-15", startTime: "11:00", endTime: "10:00", allDay: false })).toThrow("End time");
  });

  it("round-trips timed and all-day canonical DTOs into editor drafts", () => {
    expect(draftFromEvent(dto())).toMatchObject({ date: "2026-09-15", startTime: "10:00", endTime: "11:00", allDay: false });
    expect(draftFromEvent(dto({ startsAt: "2026-09-14T16:00:00Z", endsAt: "2026-09-15T16:00:00Z", precision: "day" }))).toMatchObject({ date: "2026-09-15", allDay: true });
  });
});
