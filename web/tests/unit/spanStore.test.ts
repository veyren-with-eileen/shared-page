import { describe, expect, it, vi } from "vitest";
import type { CalendarGateway } from "../../src/api/calendarAPI";
import type { CalendarSpan, EventDTO, EventWritePayload } from "../../src/domain/calendar";
import { CalendarStore } from "../../src/state/calendarStore";

const september = { year: 2026, month: 9 };
const draft = { title: "Checkpoint 3B span", month: september, startDay: 15, endDay: 18 };

function dto(overrides: Partial<EventDTO> = {}): EventDTO {
  return {
    id: "span_1", title: "Trip", description: null,
    startsAt: "2026-09-15T00:00:00+08:00", endsAt: "2026-09-19T00:00:00+08:00",
    timezone: "Asia/Taipei", precision: "day", eventType: null, source: "manual",
    createdBy: "kitty", revision: 1, status: "active", metadata: { kind: "span", color: "rose" },
    createdAt: null, updatedAt: null, deletedAt: null, ...overrides
  };
}

function canonical(payload: EventWritePayload, id = "span_1", revision = 2): EventDTO {
  return dto({ id, title: payload.title, startsAt: payload.starts_at, endsAt: payload.ends_at, revision, metadata: payload.metadata ?? dto().metadata });
}

function span(overrides: Partial<CalendarSpan> = {}): CalendarSpan {
  return { id: "span_1", author: "kitty", title: "Trip", startDay: 15, endDay: 18, revision: 1, ...overrides };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((ok, no) => { resolve = ok; reject = no; });
  return { promise, resolve, reject };
}

function gateway(events: EventDTO[] = [dto()]): CalendarGateway {
  return {
    listMonth: vi.fn().mockResolvedValue(events), listUnseen: vi.fn().mockResolvedValue(new Set()),
    createEvent: vi.fn(), updateEvent: vi.fn(), deleteEvent: vi.fn(), markSeen: vi.fn()
  };
}

describe("CalendarStore span create and update", () => {
  it("replaces a provisional span with its canonical ID and rolls back a failed create", async () => {
    const create = deferred<EventDTO>();
    const api = gateway([]);
    vi.mocked(api.createEvent).mockReturnValueOnce(create.promise).mockRejectedValueOnce(new Error("offline"));
    const store = new CalendarStore(api);
    await store.loadMonth(september);
    const pending = store.createSpan(draft);
    expect(store.snapshot(september).dtos[0].id).toMatch(/^local_span_/);
    create.resolve(dto({ id: "span_server", title: draft.title, revision: 8 }));
    await pending;
    expect(store.snapshot(september).dtos[0]).toMatchObject({ id: "span_server", revision: 8 });
    await store.createSpan({ ...draft, title: "fails" });
    expect(store.snapshot(september).dtos.map((event) => event.title)).not.toContain("fails");
  });

  it("defers an in-flight edit until the canonical ID exists", async () => {
    const create = deferred<EventDTO>();
    const api = gateway([]);
    vi.mocked(api.createEvent).mockReturnValue(create.promise);
    vi.mocked(api.updateEvent).mockImplementation(async (id, payload) => canonical(payload, id, 3));
    const store = new CalendarStore(api);
    await store.loadMonth(september);
    const creating = store.createSpan(draft);
    const local = store.snapshot(september).payload.spans[0];
    await store.updateSpan(local, { ...draft, title: "latest" });
    expect(api.updateEvent).not.toHaveBeenCalled();
    create.resolve(dto({ id: "span_server", title: draft.title }));
    await creating;
    expect(api.updateEvent).toHaveBeenCalledWith("span_server", expect.objectContaining({ title: "latest" }));
    expect(store.event("span_server")).toMatchObject({ title: "latest", revision: 3 });
  });

  it("deletes a just-created canonical span instead of sending its local ID", async () => {
    const create = deferred<EventDTO>();
    const api = gateway([]);
    vi.mocked(api.createEvent).mockReturnValue(create.promise);
    vi.mocked(api.deleteEvent).mockResolvedValue(dto({ status: "deleted" }));
    const store = new CalendarStore(api);
    await store.loadMonth(september);
    const creating = store.createSpan(draft);
    await store.deleteSpan(store.snapshot(september).payload.spans[0]);
    create.resolve(dto({ id: "span_server" }));
    await creating;
    expect(api.deleteEvent).toHaveBeenCalledWith("span_server");
    expect(store.snapshot(september).dtos).toHaveLength(0);
  });

  it("uses the canonical revision on update, preserves metadata, and rolls failure back", async () => {
    const api = gateway();
    vi.mocked(api.updateEvent).mockImplementationOnce(async (id, payload) => canonical(payload, id, 9)).mockRejectedValueOnce(new Error("offline"));
    const store = new CalendarStore(api);
    await store.loadMonth(september);
    await store.updateSpan(span(), { ...draft, title: "Updated", startDay: 20, endDay: 16 });
    expect(api.updateEvent).toHaveBeenLastCalledWith("span_1", expect.not.objectContaining({ metadata: expect.anything() }));
    expect(store.event("span_1")).toMatchObject({ revision: 9, title: "Updated" });
    await store.updateSpan(span({ title: "Updated", startDay: 16, endDay: 20, revision: 9 }), { ...draft, title: "fails" });
    expect(store.event("span_1")?.title).toBe("Updated");
  });

  it("whole-delete removes the complete cross-month server event", async () => {
    const cross = dto({ startsAt: "2026-08-29T00:00:00+08:00", endsAt: "2026-09-04T00:00:00+08:00" });
    const api = gateway([cross]);
    vi.mocked(api.deleteEvent).mockResolvedValue({ ...cross, status: "deleted" });
    const store = new CalendarStore(api);
    await store.loadMonth(september);
    await store.deleteSpan(store.snapshot(september).payload.spans[0]);
    expect(api.deleteEvent).toHaveBeenCalledWith("span_1");
    expect(store.event("span_1")).toBeNull();
  });
});

describe("CalendarStore remove-day ordering and failure", () => {
  it("patches head and tail removal, and deletes a true one-day span", async () => {
    const api = gateway();
    vi.mocked(api.updateEvent).mockImplementation(async (id, payload) => canonical(payload, id));
    vi.mocked(api.deleteEvent).mockResolvedValue(dto({ status: "deleted" }));
    const store = new CalendarStore(api);
    await store.loadMonth(september);
    await store.removeSpanDay(span(), september, 15);
    expect(api.updateEvent).toHaveBeenLastCalledWith("span_1", expect.objectContaining({ starts_at: "2026-09-16T00:00:00+08:00" }));
    await store.removeSpanDay(span({ startDay: 16 }), september, 18);
    expect(api.updateEvent).toHaveBeenLastCalledWith("span_1", expect.objectContaining({ ends_at: "2026-09-18T00:00:00+08:00" }));
    await store.removeSpanDay(span({ startDay: 18, endDay: 18 }), september, 18);
    expect(api.deleteEvent).toHaveBeenCalledWith("span_1");
  });

  it("POSTs the tail before PATCHing the original during a middle split", async () => {
    const order: string[] = [];
    const api = gateway();
    vi.mocked(api.createEvent).mockImplementation(async (payload) => { order.push("post"); return canonical(payload, "tail"); });
    vi.mocked(api.updateEvent).mockImplementation(async (id, payload) => { order.push("patch"); return canonical(payload, id); });
    const store = new CalendarStore(api);
    await store.loadMonth(september);
    await store.removeSpanDay(span({ endDay: 19 }), september, 17);
    expect(order).toEqual(["post", "patch"]);
    expect(store.snapshot(september).payload.spans.map((item) => [item.id, item.startDay, item.endDay])).toEqual(expect.arrayContaining([["span_1", 15, 16], ["tail", 18, 19]]));
  });

  it("restores only the original span when tail POST fails", async () => {
    const api = gateway();
    vi.mocked(api.createEvent).mockRejectedValue(new Error("offline"));
    const store = new CalendarStore(api);
    await store.loadMonth(september);
    expect(await store.removeSpanDay(span({ endDay: 19 }), september, 17)).toBe(false);
    expect(api.updateEvent).not.toHaveBeenCalled();
    expect(store.snapshot(september).dtos).toEqual([dto()]);
  });

  it("forces canonical refetch after tail POST succeeds and head PATCH fails", async () => {
    const api = gateway();
    vi.mocked(api.createEvent).mockImplementation(async (payload) => canonical(payload, "tail"));
    vi.mocked(api.updateEvent).mockRejectedValue(new Error("offline"));
    vi.mocked(api.listMonth).mockResolvedValueOnce([dto()]).mockResolvedValueOnce([dto(), dto({ id: "tail", startsAt: "2026-09-18T00:00:00+08:00", endsAt: "2026-09-20T00:00:00+08:00" })]);
    const store = new CalendarStore(api);
    await store.loadMonth(september);
    expect(await store.removeSpanDay(span({ endDay: 19 }), september, 17)).toBe(false);
    expect(api.listMonth).toHaveBeenCalledTimes(2);
    expect(store.snapshot(september).dtos).toHaveLength(2);
  });

  it("preserves a hidden outside-month piece instead of deleting a visible one-day clip", async () => {
    const cross = dto({ startsAt: "2026-08-30T00:00:00+08:00", endsAt: "2026-09-02T00:00:00+08:00" });
    const api = gateway([cross]);
    vi.mocked(api.updateEvent).mockImplementation(async (id, payload) => canonical(payload, id));
    const store = new CalendarStore(api);
    await store.loadMonth(september);
    const clipped = store.snapshot(september).payload.spans[0];
    expect(clipped).toMatchObject({ startDay: 1, endDay: 1, clip: { headStart: cross.startsAt } });
    await store.removeSpanDay(clipped, september, 1);
    expect(api.deleteEvent).not.toHaveBeenCalled();
    expect(api.updateEvent).toHaveBeenCalledWith("span_1", expect.objectContaining({ starts_at: cross.startsAt, ends_at: "2026-09-01T00:00:00+08:00" }));
  });
});
