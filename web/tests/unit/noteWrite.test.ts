import { describe, expect, it } from "vitest";
import type { CalendarNote, DayEvent } from "../../src/domain/calendar";
import { clampNoteY, createNotePayload, linkedTimedEventId } from "../../src/domain/noteWrite";

const note: CalendarNote = { id: "local_1", author: "kitty", body: " note ", timestamp: "now", liked: false, linkedEventId: null, y: 120, anchorDate: "2026-09-15" };
const timed: DayEvent = { id: "cal_1", author: "kitty", title: "lunch", description: null, eventType: null, isAllDay: false, isSpan: false, originalStartsAt: "", originalEndsAt: "", startMinute: 600, endMinute: 660, continuesBefore: false, continuesAfter: false, spanIndex: null, spanLength: null, revision: 1 };

describe("note write and placement", () => {
  it("creates the exact body, date, y and explicit null event link", () => {
    expect(createNotePayload(note)).toEqual({ body: "note", anchor_date: "2026-09-15", y: 120, event_id: null });
  });
  it("rejects a blank create", () => expect(() => createNotePayload({ ...note, body: "  " })).toThrow());
  it("links only a timed event whose vertical range contains the note center", () => {
    expect(linkedTimedEventId(110, [timed], () => 100, () => 34)).toBe("cal_1");
    expect(linkedTimedEventId(150, [timed], () => 100, () => 34)).toBeNull();
    expect(linkedTimedEventId(110, [{ ...timed, isAllDay: true }], () => 100, () => 34)).toBeNull();
  });
  it("clamps placement inside the timeline", () => {
    expect(clampNoteY(-10, 1000)).toBe(0);
    expect(clampNoteY(990, 1000)).toBe(904);
  });
});
