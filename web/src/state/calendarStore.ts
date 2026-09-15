import type { CalendarGateway } from "../api/calendarAPI";
import { CalendarApiError } from "../api/calendarAPI";
import type { CalendarMonth, CalendarSpan, EventDTO, EventDraft, EventWritePayload, MonthPayload, SpanDraft } from "../domain/calendar";
import { materializeEvents } from "../domain/calendarDTO";
import { eventWritePayload, optimisticEvent, provisionalEvent } from "../domain/eventWrite";
import { apiMonthRange, monthKey } from "../domain/calendarTime";
import {
  optimisticSpan,
  provisionalSpan,
  removeSpanDayPlan,
  spanCreatePayload,
  spanPatchPayload
} from "../domain/spanWrite";

export type LoadStatus = "idle" | "loading" | "ready" | "error";

interface MonthState {
  status: LoadStatus;
  dtos: EventDTO[];
  message: string;
  requestSequence: number;
  controller?: AbortController;
}

interface PendingSpanCreate {
  intent?: { kind: "update"; payload: EventWritePayload } | { kind: "delete" };
}

export interface CalendarSnapshot {
  status: LoadStatus;
  dtos: EventDTO[];
  payload: MonthPayload;
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
  private readonly seenGenerations = new Map<string, number>();
  private readonly seenAtVersion = new Map<string, number>();
  private unseenDays = new Set<string>();
  private readonly suppressedUnseen = new Map<string, number>();
  private mutationVersion = 0;
  private seenVersion = 0;
  private mutationMessage: string | null = null;

  constructor(private readonly gateway: CalendarGateway) {}

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
      state = { status: "idle", dtos: [], message: "tap a day to open it", requestSequence: 0 };
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
      unseenDays: new Set(this.unseenDays),
      message: state.message,
      mutationMessage: this.mutationMessage
    };
  }

  async loadMonth(month: CalendarMonth, force = false): Promise<void> {
    const state = this.state(month);
    if (!force && (state.status === "loading" || state.status === "ready")) return;
    state.controller?.abort();
    const controller = new AbortController();
    state.controller = controller;
    const sequence = ++state.requestSequence;
    const mutationAtStart = this.mutationVersion;
    const seenAtStart = this.seenVersion;
    state.status = "loading";
    state.message = "syncing…";
    this.emit();

    try {
      const [events, unseen] = await Promise.all([
        this.gateway.listMonth(month, controller.signal),
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
    for (const [key, state] of this.months) {
      const monthParts = /^(\d{4})-(\d{2})$/.exec(key)!;
      const month = { year: Number(monthParts[1]), month: Number(monthParts[2]) };
      const without = state.dtos.filter((dto) => dto.id !== id && dto.id !== replacement?.id);
      state.dtos = replacement && overlapsMonth(replacement, month) ? [...without, replacement] : without;
    }
    const version = ++this.mutationVersion;
    this.mutatedAtVersion.set(id, version);
    if (replacement) this.mutatedAtVersion.set(replacement.id, version);
    this.emit();
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
      const [events, unseen] = await Promise.all([
        this.gateway.listMonth(month, controller.signal),
        this.gateway.listUnseen(controller.signal)
      ]);
      if (controller.signal.aborted || sequence !== state.requestSequence) return;
      state.dtos = events;
      for (const event of events) this.canonicalEvents.set(event.id, event);
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
      return canonical;
    } catch (error) {
      this.replaceEvent(tempId, null);
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
    this.replaceEvent(id, optimisticEvent(before, payload));

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
    this.optimisticDeletes.add(id);
    this.mutationMessage = null;
    this.replaceEvent(id, null);

    let deleted = false;
    const previous = this.mutationQueues.get(id) ?? Promise.resolve();
    const queued = previous.catch(() => undefined).then(async () => {
      try {
        await this.gateway.deleteEvent(id);
        this.canonicalEvents.delete(id);
        this.optimisticDeletes.delete(id);
        deleted = true;
      } catch (error) {
        if (this.mutationGenerations.get(id) === generation) {
          this.optimisticDeletes.delete(id);
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
    }).then(() => deleted);
  }

  async createSpan(draft: SpanDraft): Promise<EventDTO | null> {
    const payload = spanCreatePayload(draft);
    const tempId = `local_span_${crypto.randomUUID()}`;
    const pending: PendingSpanCreate = {};
    this.pendingSpanCreates.set(tempId, pending);
    this.mutationMessage = null;
    this.replaceEvent(tempId, provisionalSpan(payload, tempId));

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
