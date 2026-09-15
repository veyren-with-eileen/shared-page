import { describe, expect, it, vi } from "vitest";
import type { CalendarGateway } from "../../src/api/calendarAPI";
import type { EventDTO, NoteDTO } from "../../src/domain/calendar";
import { MemoryScrapbookRepository } from "../../src/persistence/scrapbookRepository";
import { CalendarStore } from "../../src/state/calendarStore";
import { ScrapbookStore } from "../../src/state/scrapbookStore";
import type { PageDirtySink } from "../../src/snapshot/pageDirty";

const september = { year: 2026, month: 9 };
const eventDraft = { title: "event", date: "2026-09-15", startTime: "10:00", endTime: "11:00", allDay: false };

class DirtySpy implements PageDirtySink {
  keys: string[] = [];
  markDirty(day: string) { this.keys.push(day); }
  unique() { return [...new Set(this.keys)].sort(); }
  clear() { this.keys = []; }
}

function event(overrides: Partial<EventDTO> = {}): EventDTO {
  return { id: "cal_1", title: "event", description: null, startsAt: "2026-09-15T10:00:00+08:00", endsAt: "2026-09-15T11:00:00+08:00", timezone: "Asia/Taipei", precision: "hour", eventType: null, source: "manual", createdBy: "kitty", revision: 1, status: "active", metadata: {}, createdAt: null, updatedAt: null, deletedAt: null, ...overrides };
}

function note(overrides: Partial<NoteDTO> = {}): NoteDTO {
  return { id: "cmt_1", eventId: null, anchorDate: "2026-09-15", author: "kitty", body: "note", y: 100, liked: false, createdAt: null, updatedAt: null, deletedAt: null, ...overrides };
}

function gateway(events: EventDTO[] = [], notes: NoteDTO[] = []): CalendarGateway {
  return {
    listMonth: vi.fn().mockResolvedValue(events), listNotes: vi.fn().mockResolvedValue(notes), listUnseen: vi.fn().mockResolvedValue(new Set()),
    createEvent: vi.fn().mockImplementation(async (payload) => event({ id: `cal_${Math.random()}`, title: payload.title, startsAt: payload.starts_at, endsAt: payload.ends_at, precision: payload.precision, metadata: payload.metadata ?? {}, revision: 2 })),
    updateEvent: vi.fn().mockImplementation(async (id, payload) => event({ id, title: payload.title, startsAt: payload.starts_at, endsAt: payload.ends_at, precision: payload.precision, revision: 2 })),
    deleteEvent: vi.fn().mockResolvedValue(event({ status: "deleted", deletedAt: "2026-09-15T00:00:00Z" })), markSeen: vi.fn().mockResolvedValue(undefined),
    createNote: vi.fn().mockImplementation(async (payload) => note({ id: "cmt_created", body: payload.body ?? "", anchorDate: payload.anchor_date ?? "2026-09-15", y: payload.y ?? 0, eventId: payload.event_id ?? null })),
    updateNote: vi.fn().mockImplementation(async (id, payload) => note({ id, body: payload.body ?? "note", y: payload.y ?? 100, liked: payload.liked ?? false, eventId: payload.event_id ?? null })),
    deleteNote: vi.fn().mockResolvedValue(note({ deletedAt: "2026-09-15T00:00:00Z" }))
  };
}

describe("calendar dirty-day integration", () => {
  it("marks create, date move and delete without marking GET or seen", async () => {
    const dirty = new DirtySpy();
    const api = gateway();
    const store = new CalendarStore(api, dirty);
    await store.loadMonth(september);
    await store.markSeen("2026-09-15");
    expect(dirty.keys).toEqual([]);
    const created = await store.createEvent(eventDraft);
    expect(dirty.unique()).toEqual(["2026-09-15"]);
    dirty.clear();
    await store.updateEvent(created!.id, { ...eventDraft, date: "2026-10-01" });
    expect(dirty.unique()).toEqual(["2026-09-15", "2026-10-01"]);
    dirty.clear();
    await store.deleteEvent(created!.id);
    expect(dirty.unique()).toEqual(["2026-10-01"]);
  });

  it("marks full span create, old/new update union, and remove-day range", async () => {
    const existing = event({ id: "span_1", precision: "day", startsAt: "2026-09-15T00:00:00+08:00", endsAt: "2026-09-19T00:00:00+08:00", metadata: { kind: "span" } });
    const dirty = new DirtySpy();
    const api = gateway([existing]);
    const store = new CalendarStore(api, dirty);
    await store.loadMonth(september);
    await store.createSpan({ title: "new", month: september, startDay: 5, endDay: 7 });
    expect(dirty.unique()).toEqual(["2026-09-05", "2026-09-06", "2026-09-07"]);
    dirty.clear();
    const span = store.snapshot(september).payload.spans.find((entry) => entry.id === "span_1")!;
    await store.updateSpan(span, { title: "moved", month: september, startDay: 16, endDay: 20 });
    expect(dirty.unique()).toEqual(["2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19", "2026-09-20"]);

    const nextSpan = store.snapshot(september).payload.spans.find((entry) => entry.id === "span_1")!;
    dirty.clear();
    await store.removeSpanDay(nextSpan, september, 16);
    expect(dirty.unique()).toEqual(["2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19", "2026-09-20"]);
  });

  it("marks note text, create, move/link, like and delete", async () => {
    const dirty = new DirtySpy();
    const api = gateway([], [note(), note({ id: "cmt_master", author: "master" })]);
    const store = new CalendarStore(api, dirty);
    await store.loadMonth(september);
    expect(dirty.keys).toEqual([]);
    const blank = store.addBlankNote("2026-09-15", 120);
    expect(dirty.keys).toEqual([]);
    store.setNoteText(blank.id, "new note");
    await store.commitNote(blank.id);
    store.placeNote("cmt_1", 220, null);
    await store.toggleNoteLike("cmt_master");
    await store.deleteNote("cmt_1");
    expect(dirty.unique()).toEqual(["2026-09-15"]);
    store.dispose();
  });
});

describe("scrapbook dirty-day integration", () => {
  it("marks place/move/delete and every day pruned by custom sticker deletion", async () => {
    const dirty = new DirtySpy();
    const store = new ScrapbookStore(new MemoryScrapbookRepository(), dirty);
    await store.hydrate();
    const emoji = await store.placeEmoji("2026-09-15", "🌷", { x: 100, y: 200 });
    await store.updatePlacement(emoji!.id, { x: 200, rotation: 20 });
    await store.removePlacement(emoji!.id);
    const sticker = await store.addCustomSticker({ blob: new Blob(["png"]), width: 100, height: 100, hasAlpha: true });
    await store.placeSticker("2026-09-15", sticker!.id, { x: 100, y: 200 });
    await store.placeSticker("2026-09-16", sticker!.id, { x: 100, y: 200 });
    dirty.clear();
    await store.removeCustomSticker(sticker!.id);
    expect(dirty.unique()).toEqual(["2026-09-15", "2026-09-16"]);
  });
});
