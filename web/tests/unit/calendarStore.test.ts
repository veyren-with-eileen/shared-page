import { describe, expect, it, vi } from "vitest";
import type { CalendarGateway } from "../../src/api/calendarAPI";
import type { EventDTO } from "../../src/domain/calendar";
import { materializeDay } from "../../src/domain/calendarDTO";
import { CalendarStore } from "../../src/state/calendarStore";

const september = { year: 2026, month: 9 };
const draft = { title: "Checkpoint 3A test", date: "2026-09-15", startTime: "10:00", endTime: "11:00", allDay: false, eventType: null } as const;

function event(overrides: Partial<EventDTO> = {}): EventDTO {
  return {
    id: "cal_1", title: "before", description: null,
    startsAt: "2026-09-15T02:00:00Z", endsAt: "2026-09-15T03:00:00Z",
    timezone: "Asia/Taipei", precision: "hour", eventType: "custom", source: "manual",
    createdBy: "kitty", revision: 1, status: "active", metadata: {}, createdAt: null,
    updatedAt: null, deletedAt: null, ...overrides
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((ok, no) => { resolve = ok; reject = no; });
  return { promise, resolve, reject };
}

function gateway(events: EventDTO[] = [event()], unseen = new Set<string>()): CalendarGateway {
  return {
    listMonth: vi.fn().mockResolvedValue(events),
    listUnseen: vi.fn().mockResolvedValue(unseen),
    listNotes: vi.fn().mockResolvedValue([]),
    createEvent: vi.fn(), updateEvent: vi.fn(), deleteEvent: vi.fn(), markSeen: vi.fn(),
    createNote: vi.fn(), updateNote: vi.fn(), deleteNote: vi.fn()
  };
}

describe("CalendarStore optimistic mutations", () => {
  it("replaces a provisional create with the server canonical DTO", async () => {
    const created = deferred<EventDTO>();
    const api = gateway([]);
    vi.mocked(api.createEvent).mockReturnValue(created.promise);
    const store = new CalendarStore(api);
    await store.loadMonth(september);
    const pending = store.createEvent(draft);
    expect(store.snapshot(september).dtos[0].id).toMatch(/^local_/);
    created.resolve(event({ title: draft.title, revision: 7 }));
    await pending;
    expect(store.snapshot(september).dtos).toEqual([event({ title: draft.title, revision: 7 })]);
  });

  it("rolls a failed create back", async () => {
    const api = gateway([]);
    vi.mocked(api.createEvent).mockRejectedValue(new Error("offline"));
    const store = new CalendarStore(api);
    await store.loadMonth(september);
    await store.createEvent(draft);
    expect(store.snapshot(september).dtos).toHaveLength(0);
    expect(store.snapshot(september).mutationMessage).toContain("restored");
  });

  it("updates title, time, precision, date and accepts only the server revision", async () => {
    const api = gateway();
    vi.mocked(api.listMonth).mockImplementation(async (month) => month.month === 9 ? [event()] : []);
    vi.mocked(api.updateEvent).mockImplementation(async (_id, payload) => event({
      title: payload.title, startsAt: payload.starts_at, endsAt: payload.ends_at,
      precision: payload.precision, eventType: payload.event_type === "custom" ? null : payload.event_type, revision: 12
    }));
    const store = new CalendarStore(api);
    await store.loadMonth(september);
    await store.loadMonth({ year: 2026, month: 10 });

    await store.updateEvent("cal_1", { ...draft, title: "moved", date: "2026-10-01", startTime: "13:30", endTime: "14:30" });
    expect(store.snapshot(september).dtos).toHaveLength(0);
    expect(vi.mocked(api.updateEvent).mock.calls[0][1]).toMatchObject({ precision: "hour", starts_at: "2026-10-01T13:30:00+08:00" });

    expect(store.event("cal_1")?.revision).toBe(12);
  });

  it("supports timed to all-day and all-day to timed payloads", async () => {
    const api = gateway();
    vi.mocked(api.updateEvent).mockImplementation(async (_id, payload) => event({ title: payload.title, startsAt: payload.starts_at, endsAt: payload.ends_at, precision: payload.precision, eventType: payload.event_type === "custom" ? null : payload.event_type, revision: 2 }));
    const store = new CalendarStore(api);
    await store.loadMonth(september);
    await store.updateEvent("cal_1", { ...draft, allDay: true });
    expect(vi.mocked(api.updateEvent).mock.calls[0][1]).toMatchObject({ precision: "day", ends_at: "2026-09-16T00:00:00+08:00" });
    await store.updateEvent("cal_1", { ...draft, startTime: "13:30", endTime: "14:30" });
    expect(vi.mocked(api.updateEvent).mock.calls[1][1]).toMatchObject({ precision: "hour", starts_at: "2026-09-15T13:30:00+08:00" });
  });

  it("preserves special-day type through optimistic create and update payloads", async () => {
    const api = gateway([]);
    vi.mocked(api.createEvent).mockImplementation(async (payload) => event({ title: payload.title, startsAt: payload.starts_at, endsAt: payload.ends_at, precision: payload.precision, eventType: payload.event_type, revision: 1 }));
    vi.mocked(api.updateEvent).mockImplementation(async (_id, payload) => event({ title: payload.title, startsAt: payload.starts_at, endsAt: payload.ends_at, precision: payload.precision, eventType: payload.event_type, revision: 2 }));
    const store = new CalendarStore(api);
    await store.loadMonth(september);
    const created = await store.createEvent({ ...draft, allDay: true, eventType: "anniversary" });
    expect(api.createEvent).toHaveBeenCalledWith(expect.objectContaining({ precision: "day", event_type: "anniversary" }));
    expect(created?.eventType).toBe("anniversary");
    await store.updateEvent(created!.id, { ...draft, title: "birthday", allDay: true, eventType: "birthday" });
    expect(api.updateEvent).toHaveBeenCalledWith(created!.id, expect.objectContaining({ event_type: "birthday" }));
  });

  it("rolls back a failed update", async () => {
    const api = gateway();
    vi.mocked(api.updateEvent).mockRejectedValue(new Error("offline"));
    const store = new CalendarStore(api);
    await store.loadMonth(september);
    await store.updateEvent("cal_1", { ...draft, title: "changed" });
    expect(store.event("cal_1")?.title).toBe("before");
  });

  it("optimistically removes, rolls back failure, and never materializes a successful delete", async () => {
    const deletion = deferred<EventDTO>();
    const api = gateway();
    vi.mocked(api.deleteEvent).mockReturnValueOnce(deletion.promise).mockResolvedValueOnce(event({ status: "deleted", deletedAt: "2026-09-15T04:00:00Z" }));
    const store = new CalendarStore(api);
    await store.loadMonth(september);
    const failed = store.deleteEvent("cal_1");
    expect(store.event("cal_1")).toBeNull();
    deletion.reject(new Error("offline"));
    expect(await failed).toBe(false);
    expect(store.event("cal_1")?.title).toBe("before");
    expect(await store.deleteEvent("cal_1")).toBe(true);
    expect(materializeDay(store.snapshot(september).dtos, "2026-09-15").timed).toHaveLength(0);
  });

  it("does not let a stale GET overwrite a completed create", async () => {
    const listing = deferred<EventDTO[]>();
    const api = gateway([]);
    vi.mocked(api.listMonth).mockReturnValue(listing.promise);
    vi.mocked(api.createEvent).mockResolvedValue(event({ title: draft.title, revision: 1 }));
    const store = new CalendarStore(api);
    const load = store.loadMonth(september);
    await store.createEvent(draft);
    listing.resolve([event({ title: "stale" })]);
    await load;
    expect(store.event("cal_1")?.title).toBe(draft.title);
  });

  it("serializes rapid updates and ignores the older response", async () => {
    const first = deferred<EventDTO>();
    const second = deferred<EventDTO>();
    const api = gateway();
    vi.mocked(api.updateEvent).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const store = new CalendarStore(api);
    await store.loadMonth(september);
    const one = store.updateEvent("cal_1", { ...draft, title: "first" });
    const two = store.updateEvent("cal_1", { ...draft, title: "second" });
    expect(api.updateEvent).toHaveBeenCalledTimes(0);
    await vi.waitFor(() => expect(api.updateEvent).toHaveBeenCalledTimes(1));
    first.resolve(event({ title: "first", revision: 2 }));
    await one;
    expect(store.event("cal_1")?.title).toBe("second");
    await vi.waitFor(() => expect(api.updateEvent).toHaveBeenCalledTimes(2));
    second.resolve(event({ title: "second", revision: 3 }));
    await two;
    expect(store.event("cal_1")).toMatchObject({ title: "second", revision: 3 });
  });

  it("rolls a failed newer update back to the last server-confirmed response", async () => {
    const first = deferred<EventDTO>();
    const api = gateway();
    vi.mocked(api.updateEvent).mockReturnValueOnce(first.promise).mockRejectedValueOnce(new Error("offline"));
    const store = new CalendarStore(api);
    await store.loadMonth(september);
    const one = store.updateEvent("cal_1", { ...draft, title: "confirmed" });
    const two = store.updateEvent("cal_1", { ...draft, title: "fails" });
    await vi.waitFor(() => expect(api.updateEvent).toHaveBeenCalledTimes(1));
    first.resolve(event({ title: "confirmed", revision: 2 }));
    await one;
    await two;
    expect(store.event("cal_1")).toMatchObject({ title: "confirmed", revision: 2 });
  });
});

describe("CalendarStore mark seen", () => {
  it("clears the opened day, restores it on failure, and sends the exact date", async () => {
    const api = gateway([], new Set(["2026-09-15"]));
    const call = deferred<void>();
    vi.mocked(api.markSeen).mockReturnValue(call.promise);
    const store = new CalendarStore(api);
    await store.loadMonth(september);
    const marking = store.markSeen("2026-09-15");
    expect(store.snapshot(september).unseenDays.has("2026-09-15")).toBe(false);
    call.reject(new Error("offline"));
    await marking;
    expect(store.snapshot(september).unseenDays.has("2026-09-15")).toBe(true);
    expect(api.markSeen).toHaveBeenCalledWith("2026-09-15");
  });

  it("treats repeated calls and changing days as safe independent idempotent calls", async () => {
    const api = gateway([], new Set(["2026-09-15", "2026-09-16"]));
    vi.mocked(api.markSeen).mockResolvedValue();
    const store = new CalendarStore(api);
    await store.loadMonth(september);
    await store.markSeen("2026-09-15");
    await store.markSeen("2026-09-15");
    await store.markSeen("2026-09-16");
    expect(api.markSeen).toHaveBeenNthCalledWith(1, "2026-09-15");
    expect(api.markSeen).toHaveBeenNthCalledWith(2, "2026-09-15");
    expect(api.markSeen).toHaveBeenNthCalledWith(3, "2026-09-16");
    expect(store.snapshot(september).unseenDays.size).toBe(0);
  });

  it("restores unseen when a pre-existing GET is suppressed and mark-seen later fails", async () => {
    const unseen = deferred<Set<string>>();
    const marking = deferred<void>();
    const api = gateway([]);
    vi.mocked(api.listUnseen).mockReturnValue(unseen.promise);
    vi.mocked(api.markSeen).mockReturnValue(marking.promise);
    const store = new CalendarStore(api);
    const loading = store.loadMonth(september);
    const seen = store.markSeen("2026-09-15");
    unseen.resolve(new Set(["2026-09-15"]));
    await loading;
    expect(store.snapshot(september).unseenDays.has("2026-09-15")).toBe(false);
    marking.reject(new Error("offline"));
    await seen;
    expect(store.snapshot(september).unseenDays.has("2026-09-15")).toBe(true);
  });

  it("does not revive an older suppressed receipt when a later idempotent call fails", async () => {
    const unseen = deferred<Set<string>>();
    const api = gateway([]);
    vi.mocked(api.listUnseen).mockReturnValue(unseen.promise);
    vi.mocked(api.markSeen).mockResolvedValueOnce().mockRejectedValueOnce(new Error("offline"));
    const store = new CalendarStore(api);
    const loading = store.loadMonth(september);
    await store.markSeen("2026-09-15");
    unseen.resolve(new Set(["2026-09-15"]));
    await loading;
    await store.markSeen("2026-09-15");
    expect(store.snapshot(september).unseenDays.has("2026-09-15")).toBe(false);
  });
});
