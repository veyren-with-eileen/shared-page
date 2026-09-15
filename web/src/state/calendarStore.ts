import type { CalendarGateway } from "../api/calendarAPI";
import { CalendarApiError } from "../api/calendarAPI";
import type { CalendarMonth, CalendarNote, CalendarSpan, EventDTO, EventDraft, EventWritePayload, MonthPayload, NoteWritePayload, SpanDraft } from "../domain/calendar";
import { materializeEvents, materializeNotes } from "../domain/calendarDTO";
import { eventWritePayload, optimisticEvent, provisionalEvent } from "../domain/eventWrite";
import { apiMonthRange, monthKey } from "../domain/calendarTime";
import {
  optimisticSpan,
  provisionalSpan,
  removeSpanDayPlan,
  spanCreatePayload,
  spanPatchPayload
} from "../domain/spanWrite";
import { createNotePayload, noteFromDTO, provisionalNote } from "../domain/noteWrite";
import { materializeDay } from "../domain/calendarDTO";
import { NOOP_PAGE_DIRTY, eventRenderedDayKeys, markEventTransition, type PageDirtySink } from "../snapshot/pageDirty";

export type LoadStatus = "idle" | "loading" | "ready" | "error";

interface MonthState {
  status: LoadStatus;
  dtos: EventDTO[];
  notes: CalendarNote[];
  message: string;
  requestSequence: number;
  controller?: AbortController;
}

interface PendingSpanCreate {
  intent?: { kind: "update"; payload: EventWritePayload } | { kind: "delete" };
}

interface PendingNoteCreate { delete?: boolean; initial: NoteWritePayload }

export interface CalendarSnapshot {
  status: LoadStatus;
  dtos: EventDTO[];
  payload: MonthPayload;
  notesByDay: Map<number, CalendarNote[]>;
  unseenDays: Set<string>;
  message: string;
  mutationMessage: string | null;
}

function emptyPayload(): MonthPayload {
  return { events: new Map(), spans: [], periods: [] };
}

function loadErrorMessage(error: unknown): string {
  if (!(error instanceof CalendarApiError)) return "couldn't load · tap to retry";
  switch (error.kind) {
    case "unauthorized": return "token rejected · check connection";
    case "not-found": return "calendar route not found";
    case "bad-request": return "calendar request was rejected";
    default: return "couldn't load · tap to retry";
  }
}

function mutationErrorMessage(error: unknown): string {
  if (!(error instanceof CalendarApiError)) return "couldn't save · your change was restored";
  if (error.kind === "unauthorized") return "token rejected · your change was restored";
  if (error.kind === "bad-request") return error.message || "calendar rejected this change";
  return "couldn't save · your change was restored";
}

function active(dto: EventDTO): boolean {
  return (dto.status ?? "active") === "active" && dto.deletedAt === null;
}

function overlapsMonth(dto: EventDTO, month: CalendarMonth): boolean {
  if (!active(dto)) return false;
  const range = apiMonthRange(month);
  const start = Date.parse(dto.startsAt);
  const end = Date.parse(dto.endsAt ?? dto.startsAt);
  return Number.isFinite(start) && Number.isFinite(end) && start < Date.parse(range.to) && end > Date.parse(range.from);
}

export class CalendarStore {
  private readonly months = new Map<string, MonthState>();
  private readonly listeners = new Set<() => void>();
  private readonly mutationGenerations = new Map<string, number>();
  private readonly mutationQueues = new Map<string, Promise<void>>();
  private readonly canonicalEvents = new Map<string, EventDTO>();
  private readonly mutatedAtVersion = new Map<string, number>();
  private readonly optimisticDeletes = new Set<string>();
  private readonly pendingSpanCreates = new Map<string, PendingSpanCreate>();
  private readonly pendingSpanSplits = new Set<string>();
  private readonly canonicalNotes = new Map<string, CalendarNote>();
  private readonly noteMutationGenerations = new Map<string, number>();
  private readonly noteMutationQueues = new Map<string, Promise<void>>();
  private readonly noteMutatedAtVersion = new Map<string, number>();
  private readonly noteTextTimers = new Map<string, number>();
  private readonly pendingNoteCreates = new Map<string, PendingNoteCreate>();
  private readonly seenGenerations = new Map<string, number>();
  private readonly seenAtVersion = new Map<string, number>();
  private unseenDays = new Set<string>();
  private readonly suppressedUnseen = new Map<string, number>();
  private mutationVersion = 0;
  private noteMutationVersion = 0;
  private seenVersion = 0;
  private mutationMessage: string | null = null;

  constructor(
    private readonly gateway: CalendarGateway,
    private readonly pageDirty: PageDirtySink = NOOP_PAGE_DIRTY
  ) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }

  private state(month: CalendarMonth): MonthState {
    const key = monthKey(month);
    let state = this.months.get(key);
    if (!state) {
      state = { status: "idle", dtos: [], notes: [], message: "tap a day to open it", requestSequence: 0 };
      this.months.set(key, state);
    }
    return state;
  }

  snapshot(month: CalendarMonth): CalendarSnapshot {
    const state = this.state(month);
    return {
      status: state.status,
      dtos: state.dtos,
      payload: state.dtos.length ? materializeEvents(state.dtos, month) : emptyPayload(),
      notesByDay: this.notesForMonth(state.notes, month),
      unseenDays: new Set(this.unseenDays),
      message: state.message,
      mutationMessage: this.mutationMessage
    };
  }

  pageState(dayKey: string) {
    const ids = new Set<string>(this.canonicalEvents.keys());
    for (const state of this.months.values()) for (const dto of state.dtos) ids.add(dto.id);
    const dtos = [...ids].map((id) => this.event(id)).filter((dto): dto is EventDTO => dto !== null);
    const noteIds = new Set<string>(this.canonicalNotes.keys());
    for (const state of this.months.values()) for (const note of state.notes) noteIds.add(note.id);
    const notes = [...noteIds]
      .map((id) => this.note(id))
      .filter((note): note is CalendarNote => note !== null && note.anchorDate === dayKey)
      .sort((a, b) => (a.y ?? 0) - (b.y ?? 0));
    return { payload: materializeDay(dtos, dayKey), notes };
  }

  private notesForMonth(notes: CalendarNote[], month: CalendarMonth): Map<number, CalendarNote[]> {
    const prefix = `${monthKey(month)}-`;
    const result = new Map<number, CalendarNote[]>();
    for (const note of notes.filter((item) => item.anchorDate.startsWith(prefix))) {
      const day = Number(note.anchorDate.slice(-2));
      result.set(day, [...(result.get(day) ?? []), note]);
    }
    for (const [day, list] of result) result.set(day, [...list].sort((a, b) => (a.y ?? 0) - (b.y ?? 0)));
    return result;
  }

  async loadMonth(month: CalendarMonth, force = false): Promise<void> {
    const state = this.state(month);
    if (!force && (state.status === "loading" || state.status === "ready")) return;
    state.controller?.abort();
    const controller = new AbortController();
    state.controller = controller;
    const sequence = ++state.requestSequence;
    const mutationAtStart = this.mutationVersion;
    const noteMutationAtStart = this.noteMutationVersion;
    const seenAtStart = this.seenVersion;
    state.status = "loading";
    state.message = "syncing…";
    this.emit();

    try {
      const [events, noteDtos, unseen] = await Promise.all([
        this.gateway.listMonth(month, controller.signal),
        this.gateway.listNotes(month, controller.signal),
        this.gateway.listUnseen(controller.signal)
      ]);
      if (controller.signal.aborted || sequence !== state.requestSequence) return;

      // Merge around event IDs changed after this GET left (or still being written).
      // This preserves unrelated fresh server data without allowing stale rows to win.
      const protectedCurrent = state.dtos.filter((event) =>
        this.isPending(event.id) || (this.mutatedAtVersion.get(event.id) ?? 0) > mutationAtStart
      );
      const protectedIds = new Set(protectedCurrent.map((event) => event.id));
      const fresh = events.filter((event) =>
        !protectedIds.has(event.id) &&
        !this.isPending(event.id) &&
        (this.mutatedAtVersion.get(event.id) ?? 0) <= mutationAtStart
      );
      state.dtos = [...fresh, ...protectedCurrent];
      for (const event of fresh) this.canonicalEvents.set(event.id, event);

      const loadedNotes = [...materializeNotes(noteDtos, month).values()].flat();
      const protectedNotes = state.notes.filter((note) => note.id.startsWith("local_") || this.noteMutationQueues.has(note.id) || this.noteTextTimers.has(note.id) || (this.noteMutatedAtVersion.get(note.id) ?? 0) > noteMutationAtStart);
      const protectedNoteIds = new Set(protectedNotes.map((note) => note.id));
      state.notes = [...loadedNotes.filter((note) => !protectedNoteIds.has(note.id)), ...protectedNotes];
      for (const note of loadedNotes) if (!protectedNoteIds.has(note.id)) this.canonicalNotes.set(note.id, note);

      const filtered = new Set<string>();
      for (const day of unseen) {
        const seenAt = this.seenAtVersion.get(day);
        if (seenAt !== undefined && seenAt > seenAtStart) {
          this.suppressedUnseen.set(day, seenAt);
          continue;
        }
        if (seenAt !== undefined) this.seenAtVersion.delete(day);
        filtered.add(day);
      }
      this.unseenDays = filtered;
      state.status = "ready";
      state.message = "tap a day to open it";
      this.emit();
    } catch (error) {
      if (controller.signal.aborted || sequence !== state.requestSequence) return;
      state.status = "error";
      state.message = loadErrorMessage(error);
      this.emit();
    }
  }

  dispose() {
    for (const state of this.months.values()) state.controller?.abort();
    this.listeners.clear();
    for (const timer of this.noteTextTimers.values()) globalThis.clearTimeout(timer);
    this.noteTextTimers.clear();
  }

  event(id: string): EventDTO | null {
    if (this.optimisticDeletes.has(id)) return null;
    for (const state of this.months.values()) {
      const found = state.dtos.find((dto) => dto.id === id);
      if (found) return found;
    }
    return this.canonicalEvents.get(id) ?? null;
  }

  isPending(id: string): boolean {
    return id.startsWith("local_") || this.mutationQueues.has(id) || this.pendingSpanSplits.has(id);
  }

  clearMutationMessage() {
    this.mutationMessage = null;
    this.emit();
  }

  private replaceEvent(id: string, replacement: EventDTO | null) {
    const before = this.event(id);
    for (const [key, state] of this.months) {
      const monthParts = /^(\d{4})-(\d{2})$/.exec(key)!;
      const month = { year: Number(monthParts[1]), month: Number(monthParts[2]) };
      const without = state.dtos.filter((dto) => dto.id !== id && dto.id !== replacement?.id);
      state.dtos = replacement && overlapsMonth(replacement, month) ? [...without, replacement] : without;
    }
    const version = ++this.mutationVersion;
    this.mutatedAtVersion.set(id, version);
    if (replacement) this.mutatedAtVersion.set(replacement.id, version);
    markEventTransition(this.pageDirty, before, replacement);
    this.emit();
  }

  private replaceNote(id: string, replacement: CalendarNote | null, markDirty = true) {
    const before = this.note(id);
    for (const [key, state] of this.months) {
      const without = state.notes.filter((note) => note.id !== id && note.id !== replacement?.id);
      state.notes = replacement && replacement.anchorDate.startsWith(`${key}-`) ? [...without, replacement] : without;
    }
    const version = ++this.noteMutationVersion;
    this.noteMutatedAtVersion.set(id, version);
    if (replacement) this.noteMutatedAtVersion.set(replacement.id, version);
    if (markDirty) {
      for (const day of new Set([before?.anchorDate, replacement?.anchorDate].filter((value): value is string => Boolean(value)))) {
        this.pageDirty.markDirty(day);
      }
    }
    this.emit();
  }

  note(id: string): CalendarNote | null {
    for (const state of this.months.values()) {
      const found = state.notes.find((note) => note.id === id);
      if (found) return found;
    }
    return this.canonicalNotes.get(id) ?? null;
  }

  private reconcileEventLinks(localId: string, canonicalId: string | null) {
    for (const state of this.months.values()) {
      for (const note of [...state.notes]) {
        if (note.linkedEventId !== localId) continue;
        const updated = { ...note, linkedEventId: canonicalId };
        this.replaceNote(note.id, updated);
        if (!note.id.startsWith("local_")) {
          this.canonicalNotes.set(note.id, updated);
          void this.patchNote(note.id, { event_id: canonicalId }, updated);
        }
      }
    }
  }

  private failMutation(error: unknown, replacement?: { id: string; event: EventDTO | null }) {
    if (replacement) this.replaceEvent(replacement.id, replacement.event);
    this.mutationMessage = mutationErrorMessage(error);
    this.emit();
  }

  private async reloadCanonicalMonth(month: CalendarMonth): Promise<void> {
    const state = this.state(month);
    state.controller?.abort();
    const controller = new AbortController();
    state.controller = controller;
    const sequence = ++state.requestSequence;
    state.status = "loading";
    state.message = "syncing…";
    this.emit();
    try {
      const [events, noteDtos, unseen] = await Promise.all([
        this.gateway.listMonth(month, controller.signal),
        this.gateway.listNotes(month, controller.signal),
        this.gateway.listUnseen(controller.signal)
      ]);
      if (controller.signal.aborted || sequence !== state.requestSequence) return;
      state.dtos = events;
      for (const event of events) this.canonicalEvents.set(event.id, event);
      state.notes = [...materializeNotes(noteDtos, month).values()].flat();
      for (const note of state.notes) this.canonicalNotes.set(note.id, note);
      this.unseenDays = unseen;
      state.status = "ready";
      state.message = "tap a day to open it";
      this.emit();
    } catch (error) {
      if (controller.signal.aborted || sequence !== state.requestSequence) return;
      state.status = "error";
      state.message = loadErrorMessage(error);
      this.emit();
    }
  }

  async createEvent(draft: EventDraft): Promise<EventDTO | null> {
    const payload = eventWritePayload(draft);
    const tempId = `local_${crypto.randomUUID()}`;
    const provisional = provisionalEvent(payload, tempId);
    this.mutationMessage = null;
    this.replaceEvent(tempId, provisional);

    try {
      const canonical = await this.gateway.createEvent(payload);
      this.canonicalEvents.set(canonical.id, canonical);
      this.replaceEvent(tempId, canonical);
      this.reconcileEventLinks(tempId, canonical.id);
      return canonical;
    } catch (error) {
      this.replaceEvent(tempId, null);
      this.reconcileEventLinks(tempId, null);
      this.mutationMessage = mutationErrorMessage(error);
      this.emit();
      return null;
    }
  }

  updateEvent(id: string, draft: EventDraft): Promise<EventDTO | null> {
    const before = this.event(id);
    if (!before || id.startsWith("local_")) return Promise.resolve(null);
    const payload = eventWritePayload(draft);
    const generation = (this.mutationGenerations.get(id) ?? 0) + 1;
    this.mutationGenerations.set(id, generation);
    this.mutationMessage = null;
    const optimistic = optimisticEvent(before, payload);
    this.replaceEvent(id, optimistic);

    let result: EventDTO | null = null;
    const previous = this.mutationQueues.get(id) ?? Promise.resolve();
    const queued = previous.catch(() => undefined).then(async () => {
      try {
        const canonical = await this.gateway.updateEvent(id, payload);
        this.canonicalEvents.set(id, canonical);
        if (this.mutationGenerations.get(id) === generation) {
          this.replaceEvent(id, canonical);
          result = canonical;
        }
      } catch (error) {
        if (this.mutationGenerations.get(id) === generation) {
          this.replaceEvent(id, this.canonicalEvents.get(id) ?? before);
          this.mutationMessage = mutationErrorMessage(error);
          this.emit();
        }
      }
    });
    this.mutationQueues.set(id, queued);
    return queued.finally(() => {
      if (this.mutationQueues.get(id) === queued) {
        this.mutationQueues.delete(id);
        this.emit();
      }
    }).then(() => result);
  }

  deleteEvent(id: string): Promise<boolean> {
    const before = this.event(id);
    if (!before || id.startsWith("local_")) return Promise.resolve(false);
    const generation = (this.mutationGenerations.get(id) ?? 0) + 1;
    this.mutationGenerations.set(id, generation);
    const linkedNotes = [...this.months.values()].flatMap((state) => state.notes).filter((note) => note.linkedEventId === id);
    for (const note of linkedNotes) this.replaceNote(note.id, { ...note, linkedEventId: null });
    this.mutationMessage = null;
    this.replaceEvent(id, null);
    this.optimisticDeletes.add(id);

    let deleted = false;
    const previous = this.mutationQueues.get(id) ?? Promise.resolve();
    const queued = previous.catch(() => undefined).then(async () => {
      try {
        await this.gateway.deleteEvent(id);
        this.canonicalEvents.delete(id);
        this.optimisticDeletes.delete(id);
        await Promise.all(linkedNotes.filter((note) => !note.id.startsWith("local_")).map((note) => {
          const unlinked = { ...note, linkedEventId: null };
          this.canonicalNotes.set(note.id, unlinked);
          return this.patchNote(note.id, { event_id: null }, unlinked);
        }));
        deleted = true;
      } catch (error) {
        if (this.mutationGenerations.get(id) === generation) {
          this.optimisticDeletes.delete(id);
          this.replaceEvent(id, this.canonicalEvents.get(id) ?? before);
          for (const note of linkedNotes) this.replaceNote(note.id, note);
          this.mutationMessage = mutationErrorMessage(error);
          this.emit();
        }
      }
    });
    this.mutationQueues.set(id, queued);
    return queued.finally(() => {
      if (this.mutationQueues.get(id) === queued) {
        this.mutationQueues.delete(id);
        this.emit();
      }
    }).then(() => deleted);
  }

  async createSpan(draft: SpanDraft): Promise<EventDTO | null> {
    const payload = spanCreatePayload(draft);
    const tempId = `local_span_${crypto.randomUUID()}`;
    const pending: PendingSpanCreate = {};
    this.pendingSpanCreates.set(tempId, pending);
    this.mutationMessage = null;
    const provisional = provisionalSpan(payload, tempId);
    this.replaceEvent(tempId, provisional);

    try {
      const created = await this.gateway.createEvent(payload);
      this.canonicalEvents.set(created.id, created);
      const intent = pending.intent;
      if (intent?.kind === "delete") {
        this.replaceEvent(tempId, null);
        try {
          await this.gateway.deleteEvent(created.id);
          this.canonicalEvents.delete(created.id);
          return null;
        } catch (error) {
          this.replaceEvent(tempId, created);
          this.failMutation(error);
          return created;
        }
      }
      if (intent?.kind === "update") {
        this.replaceEvent(tempId, optimisticSpan(created, intent.payload));
        try {
          const updated = await this.gateway.updateEvent(created.id, intent.payload);
          this.canonicalEvents.set(updated.id, updated);
          this.replaceEvent(created.id, updated);
          return updated;
        } catch (error) {
          this.replaceEvent(created.id, created);
          this.failMutation(error);
          return created;
        }
      }
      this.replaceEvent(tempId, created);
      return created;
    } catch (error) {
      this.replaceEvent(tempId, null);
      this.failMutation(error);
      return null;
    } finally {
      this.pendingSpanCreates.delete(tempId);
      this.emit();
    }
  }

  updateSpan(span: CalendarSpan, draft: SpanDraft): Promise<EventDTO | null> {
    const before = this.event(span.id);
    if (!before) return Promise.resolve(null);
    const payload = spanPatchPayload(span, draft);
    const pending = this.pendingSpanCreates.get(span.id);
    if (pending) {
      pending.intent = { kind: "update", payload };
      this.replaceEvent(span.id, optimisticSpan(before, payload));
      return Promise.resolve(this.event(span.id));
    }
    return this.updateSpanPayload(span.id, payload, before);
  }

  private updateSpanPayload(id: string, payload: EventWritePayload, before: EventDTO): Promise<EventDTO | null> {
    const generation = (this.mutationGenerations.get(id) ?? 0) + 1;
    this.mutationGenerations.set(id, generation);
    this.mutationMessage = null;
    this.replaceEvent(id, optimisticSpan(before, payload));
    let result: EventDTO | null = null;
    const previous = this.mutationQueues.get(id) ?? Promise.resolve();
    const queued = previous.catch(() => undefined).then(async () => {
      try {
        const canonical = await this.gateway.updateEvent(id, payload);
        this.canonicalEvents.set(id, canonical);
        if (this.mutationGenerations.get(id) === generation) {
          this.replaceEvent(id, canonical);
          result = canonical;
        }
      } catch (error) {
        if (this.mutationGenerations.get(id) === generation) {
          this.replaceEvent(id, this.canonicalEvents.get(id) ?? before);
          this.failMutation(error);
        }
      }
    });
    this.mutationQueues.set(id, queued);
    return queued.finally(() => {
      if (this.mutationQueues.get(id) === queued) {
        this.mutationQueues.delete(id);
        this.emit();
      }
    }).then(() => result);
  }

  deleteSpan(span: CalendarSpan): Promise<boolean> {
    const pending = this.pendingSpanCreates.get(span.id);
    if (pending) {
      pending.intent = { kind: "delete" };
      this.replaceEvent(span.id, null);
      return Promise.resolve(true);
    }
    return this.deleteEvent(span.id);
  }

  async removeSpanDay(span: CalendarSpan, month: CalendarMonth, day: number): Promise<boolean> {
    const before = this.event(span.id);
    if (!before || span.id.startsWith("local_")) return false;
    for (const key of eventRenderedDayKeys(before)) this.pageDirty.markDirty(key);
    const plan = removeSpanDayPlan(span, month, day);
    if (plan.kind === "delete") return this.deleteSpan(span);
    if (plan.kind === "patch") return (await this.updateSpanPayload(span.id, plan.patch, before)) !== null;

    const tailId = `local_span_${crypto.randomUUID()}`;
    this.pendingSpanSplits.add(span.id);
    this.mutationMessage = null;
    this.replaceEvent(span.id, optimisticSpan(before, plan.patch));
    this.replaceEvent(tailId, provisionalSpan(plan.create, tailId, before.createdBy ?? "kitty"));
    try {
      const tail = await this.gateway.createEvent(plan.create);
      this.canonicalEvents.set(tail.id, tail);
      this.replaceEvent(tailId, tail);
      try {
        const head = await this.gateway.updateEvent(span.id, plan.patch);
        this.canonicalEvents.set(head.id, head);
        this.replaceEvent(span.id, head);
        return true;
      } catch {
        this.mutationMessage = "span split was only partly saved · reloading server truth";
        this.emit();
        await this.reloadCanonicalMonth(month);
        return false;
      }
    } catch (error) {
      this.replaceEvent(tailId, null);
      this.replaceEvent(span.id, before);
      this.failMutation(error);
      return false;
    } finally {
      this.pendingSpanSplits.delete(span.id);
      this.emit();
    }
  }

  addBlankNote(anchorDate: string, y: number): CalendarNote {
    const note = provisionalNote(anchorDate, y);
    this.replaceNote(note.id, note, false);
    return note;
  }

  setNoteText(id: string, body: string) {
    const before = this.note(id);
    if (!before || before.author !== "kitty") return;
    const updated = { ...before, body: body.slice(0, 40) };
    this.replaceNote(id, updated);
    const oldTimer = this.noteTextTimers.get(id);
    if (oldTimer !== undefined) globalThis.clearTimeout(oldTimer);
    if (id.startsWith("local_")) return;
    const timer = globalThis.setTimeout(() => {
      this.noteTextTimers.delete(id);
      const current = this.note(id);
      if (current) void this.patchNote(id, { body: current.body }, before);
    }, 600);
    this.noteTextTimers.set(id, timer);
  }

  async commitNote(id: string): Promise<CalendarNote | null> {
    const note = this.note(id);
    if (!note || !id.startsWith("local_") || !note.body.trim() || this.pendingNoteCreates.has(id)) return note;
    const initial = createNotePayload(note);
    if (initial.event_id?.startsWith("local_")) delete initial.event_id;
    const pending: PendingNoteCreate = { initial };
    this.pendingNoteCreates.set(id, pending);
    try {
      const dto = await this.gateway.createNote(initial);
      const canonical = noteFromDTO(dto);
      this.canonicalNotes.set(canonical.id, canonical);
      if (pending.delete) {
        this.replaceNote(id, null);
        try { await this.gateway.deleteNote(canonical.id); this.canonicalNotes.delete(canonical.id); }
        catch (error) { this.replaceNote(id, canonical); this.failMutation(error); }
        return null;
      }
      const latest = this.note(id);
      if (!latest) return null;
      const reconciled = { ...canonical, body: latest.body, y: latest.y, liked: latest.liked, linkedEventId: latest.linkedEventId };
      this.replaceNote(id, reconciled);
      const sendableEvent = reconciled.linkedEventId?.startsWith("local_") ? undefined : reconciled.linkedEventId;
      const changed = reconciled.body !== canonical.body || reconciled.y !== canonical.y || reconciled.liked !== canonical.liked || reconciled.linkedEventId !== canonical.linkedEventId;
      if (changed) await this.patchNote(canonical.id, { body: reconciled.body, y: reconciled.y ?? 0, liked: reconciled.liked, ...(sendableEvent !== undefined ? { event_id: sendableEvent } : {}) }, canonical);
      return this.note(canonical.id);
    } catch (error) {
      this.replaceNote(id, null);
      this.failMutation(error);
      return null;
    } finally {
      this.pendingNoteCreates.delete(id);
    }
  }

  placeNote(id: string, y: number, eventId: string | null) {
    const before = this.note(id);
    if (!before || before.author !== "kitty") return;
    const updated = { ...before, y, linkedEventId: eventId };
    this.replaceNote(id, updated);
    if (id.startsWith("local_")) return;
    const payload: NoteWritePayload = { y };
    if (!eventId?.startsWith("local_")) payload.event_id = eventId;
    void this.patchNote(id, payload, before);
  }

  async deleteNote(id: string): Promise<boolean> {
    const before = this.note(id);
    if (!before || before.author !== "kitty") return false;
    const timer = this.noteTextTimers.get(id);
    if (timer !== undefined) globalThis.clearTimeout(timer);
    this.noteTextTimers.delete(id);
    this.replaceNote(id, null);
    if (id.startsWith("local_")) {
      const pending = this.pendingNoteCreates.get(id);
      if (pending) pending.delete = true;
      return true;
    }
    try {
      await this.gateway.deleteNote(id);
      this.canonicalNotes.delete(id);
      return true;
    } catch (error) {
      this.replaceNote(id, before);
      this.failMutation(error);
      return false;
    }
  }

  toggleNoteLike(id: string): Promise<CalendarNote | null> {
    const before = this.note(id);
    if (!before || before.author !== "master" || id.startsWith("local_")) return Promise.resolve(null);
    const updated = { ...before, liked: !before.liked };
    this.replaceNote(id, updated);
    return this.patchNote(id, { liked: updated.liked }, before);
  }

  private patchNote(id: string, payload: NoteWritePayload, before: CalendarNote): Promise<CalendarNote | null> {
    const generation = (this.noteMutationGenerations.get(id) ?? 0) + 1;
    this.noteMutationGenerations.set(id, generation);
    let result: CalendarNote | null = null;
    const previous = this.noteMutationQueues.get(id) ?? Promise.resolve();
    const queued = previous.catch(() => undefined).then(async () => {
      try {
        const canonical = noteFromDTO(await this.gateway.updateNote(id, payload));
        this.canonicalNotes.set(id, canonical);
        if (this.noteMutationGenerations.get(id) === generation) {
          this.replaceNote(id, canonical);
          result = canonical;
        }
      } catch (error) {
        if (this.noteMutationGenerations.get(id) === generation) {
          this.replaceNote(id, this.canonicalNotes.get(id) ?? before);
          this.failMutation(error);
        }
      }
    });
    this.noteMutationQueues.set(id, queued);
    return queued.finally(() => {
      if (this.noteMutationQueues.get(id) === queued) this.noteMutationQueues.delete(id);
    }).then(() => result);
  }

  async markSeen(day: string): Promise<void> {
    const generation = (this.seenGenerations.get(day) ?? 0) + 1;
    this.seenGenerations.set(day, generation);
    const wasUnseen = this.unseenDays.delete(day);
    const version = ++this.seenVersion;
    this.seenAtVersion.set(day, version);
    this.emit();

    try {
      await this.gateway.markSeen(day);
      this.suppressedUnseen.delete(day);
    } catch {
      if (this.seenGenerations.get(day) === generation) {
        this.seenAtVersion.delete(day);
        const suppressedAt = this.suppressedUnseen.get(day);
        this.suppressedUnseen.delete(day);
        if (wasUnseen || suppressedAt === version) this.unseenDays.add(day);
        this.emit();
      }
    }
  }
}
