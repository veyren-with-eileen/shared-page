import { describe, expect, it } from "vitest";
import { materializeNotes, parseNoteList } from "../../src/domain/calendarDTO";

const september = { year: 2026, month: 9 };
function note(overrides: Record<string, unknown> = {}) {
  return { id: "cmt_1", event_id: "cal_1", anchor_date: "2026-09-15", author: "master", body: "hello", y: 120, liked: true, created_at: "2026-09-15T02:30:00Z", updated_at: null, deleted_at: null, ...overrides };
}

describe("note DTO materialization", () => {
  it("maps kitty/master/assistant/other through the shared author system", () => {
    const dtos = parseNoteList({ notes: [note({ id: "a", author: "kitty" }), note({ id: "b", author: "assistant" }), note({ id: "c", author: "robot" })] });
    expect([...materializeNotes(dtos, september).get(15)!].map((n) => n.author)).toEqual(["kitty", "master", "system"]);
  });
  it("buckets anchor_date in the correct day and preserves link and liked", () => {
    expect(materializeNotes(parseNoteList({ notes: [note()] }), september).get(15)?.[0]).toMatchObject({ id: "cmt_1", linkedEventId: "cal_1", liked: true });
  });
  it("defaults missing liked to false", () => {
    expect(parseNoteList({ notes: [note({ liked: undefined })] })[0].liked).toBe(false);
  });
  it("ignores deleted and out-of-month notes", () => {
    const result = materializeNotes(parseNoteList({ notes: [note({ id: "gone", deleted_at: "2026-09-15T03:00:00Z" }), note({ id: "oct", anchor_date: "2026-10-01" })] }), september);
    expect(result.size).toBe(0);
  });
  it("sorts same-day notes by y", () => {
    const result = materializeNotes(parseNoteList({ notes: [note({ id: "low", y: 200 }), note({ id: "high", y: 40 })] }), september);
    expect(result.get(15)?.map((n) => n.id)).toEqual(["high", "low"]);
  });
});
