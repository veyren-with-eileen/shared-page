import { afterEach, describe, expect, it, vi } from "vitest";
import { createCalendarEvent, createCalendarNote, deleteCalendarEvent, listCalendarNotes, markCalendarDaySeen, updateCalendarEvent, updateCalendarNote } from "../../src/api/calendarAPI";

const config = { apiBaseUrl: "/api/v1/calendar", token: "secret" };
const response = {
  id: "cal_1", title: "test", starts_at: "2026-09-15T02:00:00Z", ends_at: "2026-09-15T03:00:00Z",
  precision: "hour", created_by: "kitty", revision: 1, status: "active", metadata: {}
};

afterEach(() => vi.unstubAllGlobals());

describe("calendar mutation API", () => {
  it("sends POST and PATCH bodies without retrying or inventing fields", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(response), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...response, revision: 2 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const payload = { title: "test", starts_at: "2026-09-15T10:00:00+08:00", ends_at: "2026-09-15T11:00:00+08:00", precision: "hour" as const, event_type: "anniversary" as const };

    await createCalendarEvent(config, payload);
    await updateCalendarEvent(config, "cal_1", payload);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/calendar/events");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST", body: JSON.stringify(payload) });
    expect(fetchMock.mock.calls[1][0]).toBe("/api/v1/calendar/events/cal_1");
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "PATCH", body: JSON.stringify(payload) });
  });

  it("uses DELETE and the existing idempotent mark-seen payload", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...response, status: "deleted" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, cleared: 1 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await deleteCalendarEvent(config, "cal_1");
    await markCalendarDaySeen(config, "2026-09-15");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "DELETE" });
    expect(fetchMock.mock.calls[1][0]).toBe("/api/v1/calendar/unseen/seen");
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "POST", body: JSON.stringify({ date: "2026-09-15" }) });
  });
});

describe("note API", () => {
  it("uses a half-open month query and preserves tri-state PATCH fields", async () => {
    const noteResponse = { id: "cmt_1", event_id: null, anchor_date: "2026-09-15", author: "kitty", body: "note", y: 10, liked: false, created_at: null, updated_at: null, deleted_at: null };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ notes: [noteResponse] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(noteResponse), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(noteResponse), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await listCalendarNotes(config, { year: 2026, month: 9 }, new AbortController().signal);
    await createCalendarNote(config, { body: "note", anchor_date: "2026-09-15", y: 10, event_id: null });
    await updateCalendarNote(config, "cmt_1", { y: 20 });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/calendar/notes?from=2026-09-01&to=2026-10-01");
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "POST" });
    expect(fetchMock.mock.calls[2][1]).toMatchObject({ body: JSON.stringify({ y: 20 }) });
  });
});
