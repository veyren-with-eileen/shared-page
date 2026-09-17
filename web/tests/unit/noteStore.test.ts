import { afterEach, describe, expect, it, vi } from "vitest";
import type { CalendarGateway } from "../../src/api/calendarAPI";
import type { EventDTO, NoteDTO, NoteWritePayload } from "../../src/domain/calendar";
import { CalendarStore } from "../../src/state/calendarStore";

const september = { year: 2026, month: 9 };
function event(overrides: Partial<EventDTO> = {}): EventDTO { return { id: "cal_1", title: "Lunch", description: null, startsAt: "2026-09-15T10:00:00+08:00", endsAt: "2026-09-15T11:00:00+08:00", timezone: "Asia/Taipei", precision: "hour", eventType: null, source: "manual", createdBy: "kitty", revision: 1, status: "active", metadata: {}, createdAt: null, updatedAt: null, deletedAt: null, ...overrides }; }
function note(overrides: Partial<NoteDTO> = {}): NoteDTO { return { id: "cmt_1", eventId: null, anchorDate: "2026-09-15", author: "kitty", body: "before", y: 100, liked: false, createdAt: "2026-09-15T02:00:00Z", updatedAt: null, deletedAt: null, ...overrides }; }
function response(before: NoteDTO, patch: NoteWritePayload): NoteDTO { return { ...before, body: patch.body ?? before.body, y: patch.y ?? before.y, liked: patch.liked ?? before.liked, eventId: Object.prototype.hasOwnProperty.call(patch, "event_id") ? patch.event_id ?? null : before.eventId }; }
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason?: unknown) => void; const promise = new Promise<T>((ok, no) => { resolve = ok; reject = no; }); return { promise, resolve, reject }; }
function gateway(notes: NoteDTO[] = [], events: EventDTO[] = [event()]): CalendarGateway { return { listMonth: vi.fn().mockResolvedValue(events), listNotes: vi.fn().mockResolvedValue(notes), listUnseen: vi.fn().mockResolvedValue(new Set()), createEvent: vi.fn(), updateEvent: vi.fn(), deleteEvent: vi.fn(), markSeen: vi.fn(), createNote: vi.fn(), updateNote: vi.fn(), deleteNote: vi.fn() }; }
afterEach(() => { vi.useRealTimers(); });

describe("CalendarStore note creation and text", () => {
  it("keeps a blank torn note local and never POSTs it", async () => {
    const api = gateway(); const store = new CalendarStore(api); await store.loadMonth(september);
    const local = store.addBlankNote("2026-09-15", 96);
    await store.commitNote(local.id);
    expect(api.createNote).not.toHaveBeenCalled();
    expect(store.note(local.id)?.body).toBe("");
  });
  it("commits non-empty body/date/y/link and reconciles the canonical ID", async () => {
    const api = gateway(); vi.mocked(api.createNote).mockImplementation(async (p) => note({ id: "cmt_server", body: p.body!, y: p.y!, eventId: p.event_id ?? null }));
    const store = new CalendarStore(api); await store.loadMonth(september); const local = store.addBlankNote("2026-09-15", 96);
    store.setNoteText(local.id, "Checkpoint 4 note"); store.placeNote(local.id, 120, "cal_1"); await store.commitNote(local.id);
    expect(api.createNote).toHaveBeenCalledWith({ body: "Checkpoint 4 note", anchor_date: "2026-09-15", y: 120, event_id: "cal_1" });
    expect(store.note("cmt_server")).toMatchObject({ body: "Checkpoint 4 note", linkedEventId: "cal_1" });
  });
  it("rolls a failed create back without touching other notes", async () => {
    const api = gateway([note()]); vi.mocked(api.createNote).mockRejectedValue(new Error("offline")); const store = new CalendarStore(api); await store.loadMonth(september);
    const local = store.addBlankNote("2026-09-15", 200); store.setNoteText(local.id, "fails"); await store.commitNote(local.id);
    expect(store.note(local.id)).toBeNull(); expect(store.note("cmt_1")?.body).toBe("before");
  });
  it("replays the latest text after an in-flight create without duplicating the note", async () => {
    const create = deferred<NoteDTO>(); const api = gateway(); vi.mocked(api.createNote).mockReturnValue(create.promise); vi.mocked(api.updateNote).mockImplementation(async (_id, p) => response(note({ id: "cmt_server" }), p));
    const store = new CalendarStore(api); await store.loadMonth(september); const local = store.addBlankNote("2026-09-15", 96); store.setNoteText(local.id, "first"); const pending = store.commitNote(local.id); store.setNoteText(local.id, "latest"); create.resolve(note({ id: "cmt_server", body: "first", y: 96 })); await pending;
    expect(api.updateNote).toHaveBeenCalledWith("cmt_server", expect.objectContaining({ body: "latest" })); expect(store.snapshot(september).notesByDay.get(15)).toHaveLength(1);
  });
  it("deletes a create-in-flight note through the canonical ID", async () => {
    const create = deferred<NoteDTO>(); const api = gateway(); vi.mocked(api.createNote).mockReturnValue(create.promise); vi.mocked(api.deleteNote).mockResolvedValue(note({ id: "cmt_server", deletedAt: "now" }));
    const store = new CalendarStore(api); await store.loadMonth(september); const local = store.addBlankNote("2026-09-15", 96); store.setNoteText(local.id, "bye"); const pending = store.commitNote(local.id); await store.deleteNote(local.id); create.resolve(note({ id: "cmt_server", body: "bye" })); await pending;
    expect(api.deleteNote).toHaveBeenCalledWith("cmt_server"); expect(store.snapshot(september).notesByDay.get(15)).toBeUndefined();
  });
  it("debounces body by 600ms and only applies the latest canonical response", async () => {
    vi.useFakeTimers(); const api = gateway([note()]); vi.mocked(api.updateNote).mockImplementation(async (_id, p) => response(note(), p)); const store = new CalendarStore(api); await store.loadMonth(september);
    store.setNoteText("cmt_1", "one"); await vi.advanceTimersByTimeAsync(500); store.setNoteText("cmt_1", "two"); await vi.advanceTimersByTimeAsync(599); expect(api.updateNote).not.toHaveBeenCalled(); await vi.advanceTimersByTimeAsync(1); await Promise.resolve(); await vi.waitFor(() => expect(api.updateNote).toHaveBeenCalledTimes(1));
    expect(api.updateNote).toHaveBeenCalledWith("cmt_1", { body: "two" });
  });
  it("does not let an older in-flight body response overwrite newer text", async () => {
    vi.useFakeTimers(); const first = deferred<NoteDTO>(); const second = deferred<NoteDTO>(); const api = gateway([note()]); vi.mocked(api.updateNote).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise); const store = new CalendarStore(api); await store.loadMonth(september);
    store.setNoteText("cmt_1", "first"); await vi.advanceTimersByTimeAsync(600); await vi.waitFor(() => expect(api.updateNote).toHaveBeenCalledTimes(1)); store.setNoteText("cmt_1", "second"); await vi.advanceTimersByTimeAsync(600); first.resolve(note({ body: "first" })); await vi.waitFor(() => expect(api.updateNote).toHaveBeenCalledTimes(2)); expect(store.note("cmt_1")?.body).toBe("second"); second.resolve(note({ body: "second" })); await vi.waitFor(() => expect(store.note("cmt_1")?.body).toBe("second"));
  });
  it("cancels a pending body debounce when deleted", async () => {
    vi.useFakeTimers(); const api = gateway([note()]); vi.mocked(api.deleteNote).mockResolvedValue(note({ deletedAt: "now" })); const store = new CalendarStore(api); await store.loadMonth(september); store.setNoteText("cmt_1", "later"); await store.deleteNote("cmt_1"); await vi.advanceTimersByTimeAsync(700); expect(api.updateNote).not.toHaveBeenCalled();
  });
});

describe("CalendarStore note placement, deletion and likes", () => {
  it("sends y with an explicit null unlink but never sends a provisional event ID", async () => {
    const api = gateway([note()]); vi.mocked(api.updateNote).mockImplementation(async (_id, p) => response(note(), p)); const store = new CalendarStore(api); await store.loadMonth(september);
    store.placeNote("cmt_1", 200, null); await vi.waitFor(() => expect(api.updateNote).toHaveBeenCalledTimes(1));
    store.placeNote("cmt_1", 220, "local_event"); await vi.waitFor(() => expect(api.updateNote).toHaveBeenCalledTimes(2));
    expect(api.updateNote).toHaveBeenNthCalledWith(1, "cmt_1", { y: 200, event_id: null }); expect(api.updateNote).toHaveBeenNthCalledWith(2, "cmt_1", { y: 220 });
  });
  it("deletes a never-created note locally and rolls a canonical delete failure back precisely", async () => {
    const api = gateway([note(), note({ id: "other", body: "other" })]); vi.mocked(api.deleteNote).mockRejectedValue(new Error("offline")); const store = new CalendarStore(api); await store.loadMonth(september);
    const local = store.addBlankNote("2026-09-15", 300); await store.deleteNote(local.id); expect(api.deleteNote).not.toHaveBeenCalled(); await store.deleteNote("cmt_1"); expect(store.note("cmt_1")?.body).toBe("before"); expect(store.note("other")?.body).toBe("other");
  });
  it("toggles only ASSISTANT notes and PATCHes liked alone with rollback", async () => {
    const assistant = note({ author: "master" }); const api = gateway([assistant, note({ id: "mine" })]); vi.mocked(api.updateNote).mockImplementationOnce(async (_id, p) => response(assistant, p)).mockRejectedValueOnce(new Error("offline")); const store = new CalendarStore(api); await store.loadMonth(september);
    await store.toggleNoteLike("mine"); expect(api.updateNote).not.toHaveBeenCalled(); await store.toggleNoteLike("cmt_1"); expect(api.updateNote).toHaveBeenCalledWith("cmt_1", { liked: true }); expect(store.note("cmt_1")?.liked).toBe(true); await store.toggleNoteLike("cmt_1"); expect(store.note("cmt_1")?.liked).toBe(true);
  });
  it("supports unlike and prevents body edits on ASSISTANT notes", async () => {
    const assistant = note({ author: "master", liked: true }); const api = gateway([assistant]); vi.mocked(api.updateNote).mockImplementation(async (_id, p) => response(assistant, p)); const store = new CalendarStore(api); await store.loadMonth(september); store.setNoteText("cmt_1", "forbidden"); expect(store.note("cmt_1")?.body).toBe("before"); await store.toggleNoteLike("cmt_1"); expect(api.updateNote).toHaveBeenCalledWith("cmt_1", { liked: false }); expect(store.note("cmt_1")?.liked).toBe(false);
  });
  it("replaces a provisional event link with the canonical ID and PATCHes the note", async () => {
    const create = deferred<EventDTO>(); const linked = note(); const api = gateway([linked], []); vi.mocked(api.createEvent).mockReturnValue(create.promise); vi.mocked(api.updateNote).mockImplementation(async (_id, p) => response(linked, p)); const store = new CalendarStore(api); await store.loadMonth(september);
    const creating = store.createEvent({ title: "new", date: "2026-09-15", startTime: "13:30", endTime: "14:30", allDay: false, eventType: null }); const localEvent = store.snapshot(september).dtos[0].id; store.placeNote("cmt_1", 300, localEvent); create.resolve(event({ id: "cal_server", title: "new" })); await creating; await vi.waitFor(() => expect(api.updateNote).toHaveBeenCalledWith("cmt_1", { event_id: "cal_server" })); expect(store.note("cmt_1")?.linkedEventId).toBe("cal_server");
  });
  it("unlinks notes on event delete and restores links if delete rolls back", async () => {
    const linked = note({ eventId: "cal_1" }); const api = gateway([linked]); vi.mocked(api.deleteEvent).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(event({ status: "deleted" })); vi.mocked(api.updateNote).mockImplementation(async (_id, p) => response(linked, p)); const store = new CalendarStore(api); await store.loadMonth(september);
    await store.deleteEvent("cal_1"); expect(store.note("cmt_1")?.linkedEventId).toBe("cal_1"); await store.deleteEvent("cal_1"); expect(store.note("cmt_1")?.linkedEventId).toBeNull(); await vi.waitFor(() => expect(api.updateNote).toHaveBeenCalledWith("cmt_1", { event_id: null }));
  });
  it("does not let a stale GET overwrite a newer body mutation", async () => {
    vi.useFakeTimers(); const listing = deferred<NoteDTO[]>(); const api = gateway([note()]); const store = new CalendarStore(api); await store.loadMonth(september); vi.mocked(api.listNotes).mockReturnValue(listing.promise); vi.mocked(api.updateNote).mockImplementation(async (_id, p) => response(note(), p)); const loading = store.loadMonth(september, true); store.setNoteText("cmt_1", "newer"); listing.resolve([note({ body: "stale" })]); await loading; expect(store.note("cmt_1")?.body).toBe("newer");
  });
});
