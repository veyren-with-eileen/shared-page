import type {
  CalendarMonth,
  CalendarSpan,
  CalendarSpanClip,
  EventDTO,
  EventWritePayload,
  SpanDraft
} from "./calendar";
import { adjacentDayKey, dayKey, daysInMonth } from "./calendarTime";

function midnight(day: string): string {
  return `${day}T00:00:00+08:00`;
}

function normalizedDays(startDay: number, endDay: number, month: CalendarMonth) {
  const last = daysInMonth(month);
  const start = Math.max(1, Math.min(last, Math.min(startDay, endDay)));
  const end = Math.max(1, Math.min(last, Math.max(startDay, endDay)));
  return { start, end };
}

function keepClip(clip: CalendarSpanClip | undefined, head: boolean, tail: boolean): CalendarSpanClip | undefined {
  if (!clip) return undefined;
  const kept: CalendarSpanClip = {
    ...(head && clip.headStart ? { headStart: clip.headStart } : {}),
    ...(tail && clip.tailEnd ? { tailEnd: clip.tailEnd } : {})
  };
  return Object.keys(kept).length ? kept : undefined;
}

export function normalizeSpanDraft(draft: SpanDraft): SpanDraft {
  const range = normalizedDays(draft.startDay, draft.endDay, draft.month);
  return { ...draft, title: draft.title.trim(), startDay: range.start, endDay: range.end };
}

function visibleRangePayload(title: string, month: CalendarMonth, startDay: number, endDay: number): EventWritePayload {
  const start = dayKey(month, startDay);
  const last = dayKey(month, endDay);
  return {
    title,
    starts_at: midnight(start),
    ends_at: midnight(adjacentDayKey(last, 1)!),
    precision: "day",
    event_type: "custom"
  };
}

export function spanCreatePayload(draft: SpanDraft): EventWritePayload {
  const normalized = normalizeSpanDraft(draft);
  if (!normalized.title) throw new Error("Please give these days a title.");
  return {
    ...visibleRangePayload(normalized.title, normalized.month, normalized.startDay, normalized.endDay),
    metadata: { kind: "span" }
  };
}

export function spanPatchPayload(span: CalendarSpan, draft: SpanDraft): EventWritePayload {
  const normalized = normalizeSpanDraft(draft);
  if (!normalized.title) throw new Error("Please give these days a title.");
  const payload = visibleRangePayload(
    normalized.title,
    normalized.month,
    normalized.startDay,
    normalized.endDay
  );
  if (span.clip?.headStart && normalized.startDay === 1) payload.starts_at = span.clip.headStart;
  if (span.clip?.tailEnd && normalized.endDay === daysInMonth(normalized.month)) payload.ends_at = span.clip.tailEnd;
  return payload;
}

export function draftFromSpan(span: CalendarSpan, month: CalendarMonth): SpanDraft {
  return { title: span.title, month, startDay: span.startDay, endDay: span.endDay };
}

export function provisionalSpan(payload: EventWritePayload, id: string, createdBy = "kitty"): EventDTO {
  return {
    id,
    title: payload.title,
    description: null,
    startsAt: payload.starts_at,
    endsAt: payload.ends_at,
    timezone: "Asia/Taipei",
    precision: "day",
    eventType: null,
    source: "manual",
    createdBy,
    revision: null,
    status: "active",
    metadata: payload.metadata ?? { kind: "span" },
    createdAt: null,
    updatedAt: null,
    deletedAt: null
  };
}

export function optimisticSpan(before: EventDTO, payload: EventWritePayload): EventDTO {
  return {
    ...before,
    title: payload.title,
    startsAt: payload.starts_at,
    endsAt: payload.ends_at,
    precision: "day"
  };
}

export type RemoveSpanDayPlan =
  | { kind: "delete" }
  | { kind: "patch"; patch: EventWritePayload }
  | { kind: "split"; create: EventWritePayload; patch: EventWritePayload };

function segmentPayload(
  title: string,
  startsAt: string,
  endsAt: string,
  create: boolean
): EventWritePayload {
  return {
    title,
    starts_at: startsAt,
    ends_at: endsAt,
    precision: "day",
    event_type: "custom",
    ...(create ? { metadata: { kind: "span" } } : {})
  };
}

function hiddenPiece(span: CalendarSpan, month: CalendarMonth, removingDay: number): EventWritePayload | null {
  if (
    removingDay === span.startDay &&
    span.startDay === 1 &&
    span.clip?.headStart
  ) {
    return segmentPayload(
      span.title,
      span.clip.headStart,
      midnight(dayKey(month, removingDay)),
      true
    );
  }
  if (
    removingDay === span.endDay &&
    span.endDay === daysInMonth(month) &&
    span.clip?.tailEnd
  ) {
    return segmentPayload(
      span.title,
      midnight(adjacentDayKey(dayKey(month, removingDay), 1)!),
      span.clip.tailEnd,
      true
    );
  }
  return null;
}

export function removeSpanDayPlan(span: CalendarSpan, month: CalendarMonth, day: number): RemoveSpanDayPlan {
  const start = Math.min(span.startDay, span.endDay);
  const end = Math.max(span.startDay, span.endDay);
  if (day < start || day > end) throw new Error("The selected day is outside this span.");
  const hidden = hiddenPiece(span, month, day);

  if (start === end) {
    if (!hidden) return { kind: "delete" };
    // The original event becomes the hidden piece. PATCH deliberately omits metadata
    // so unrelated server metadata survives the whole-object PATCH contract.
    const { metadata: _metadata, ...patch } = hidden;
    return { kind: "patch", patch };
  }

  if (day === start || day === end) {
    const nextStart = day === start ? start + 1 : start;
    const nextEnd = day === end ? end - 1 : end;
    const remaining: CalendarSpan = {
      ...span,
      startDay: nextStart,
      endDay: nextEnd,
      clip: keepClip(span.clip, day !== start, day !== end)
    };
    const patch = spanPatchPayload(remaining, draftFromSpan(remaining, month));
    return hidden ? { kind: "split", create: hidden, patch } : { kind: "patch", patch };
  }

  const head: CalendarSpan = {
    ...span,
    startDay: start,
    endDay: day - 1,
    clip: keepClip(span.clip, true, false)
  };
  const tail: CalendarSpan = {
    ...span,
    startDay: day + 1,
    endDay: end,
    clip: keepClip(span.clip, false, true)
  };
  return {
    kind: "split",
    create: spanCreatePayload(draftFromSpan(tail, month)),
    patch: spanPatchPayload(head, draftFromSpan(head, month))
  };
}
