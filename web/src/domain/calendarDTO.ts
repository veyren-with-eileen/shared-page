import {
  type Author,
  type CalendarEvent,
  type CalendarMonth,
  type CalendarSpan,
  type DayEvent,
  type DayPayload,
  type DayRange,
  type EventDTO,
  type JsonValue,
  type MonthPayload
} from "./calendar";
import {
  dayIndex,
  daySerialFromKey,
  daysInMonth,
  monthFirstSerial,
  productDateParts,
  productDayRange,
  productDaySerial
} from "./calendarTime";

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function jsonValue(value: unknown): JsonValue | null {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(jsonValue) as JsonValue[];
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, jsonValue(item)])
    ) as JsonValue;
  }
  return null;
}

export function parseEventDTO(input: unknown): EventDTO {
  if (!input || typeof input !== "object") throw new Error("event must be an object");
  const raw = input as Record<string, unknown>;
  if (typeof raw.id !== "string") throw new Error("event.id must be a string");
  if (typeof raw.title !== "string") throw new Error("event.title must be a string");
  if (typeof raw.starts_at !== "string" || Number.isNaN(Date.parse(raw.starts_at))) {
    throw new Error("event.starts_at must be an ISO datetime");
  }

  return {
    id: raw.id,
    title: raw.title,
    description: nullableString(raw.description),
    startsAt: raw.starts_at,
    endsAt: nullableString(raw.ends_at),
    timezone: nullableString(raw.timezone),
    precision: nullableString(raw.precision),
    eventType: nullableString(raw.event_type),
    source: nullableString(raw.source),
    createdBy: nullableString(raw.created_by),
    revision: nullableNumber(raw.revision),
    status: nullableString(raw.status),
    metadata: jsonValue(raw.metadata),
    createdAt: nullableString(raw.created_at),
    updatedAt: nullableString(raw.updated_at),
    deletedAt: nullableString(raw.deleted_at)
  };
}

export function parseEventList(input: unknown): EventDTO[] {
  if (!input || typeof input !== "object" || !Array.isArray((input as { events?: unknown }).events)) {
    throw new Error("calendar response must contain an events array");
  }
  return (input as { events: unknown[] }).events.map(parseEventDTO);
}

export function authorFromWire(createdBy: string | null): Author {
  switch ((createdBy ?? "").toLowerCase()) {
    case "kitty":
      return "kitty";
    case "master":
    case "assistant":
      return "master";
    default:
      return "system";
  }
}

function metadataKind(metadata: JsonValue | null): string | null {
  if (!metadata || Array.isArray(metadata) || typeof metadata !== "object") return null;
  return typeof metadata.kind === "string" ? metadata.kind : null;
}

function clipRange(start: number, end: number, month: CalendarMonth): DayRange | null {
  const clipped = { start: Math.max(1, start), end: Math.min(daysInMonth(month), end) };
  return clipped.start <= clipped.end ? clipped : null;
}

function effectiveEndDayIndex(ends: Date, month: CalendarMonth, isAllDay: boolean): number {
  if (isAllDay) {
    return productDaySerial(ends) - 1 - monthFirstSerial(month) + 1;
  }
  return dayIndex(new Date(ends.getTime() - 1000), month);
}

function eventEnd(dto: EventDTO, starts: Date, isAllDay: boolean): Date {
  const fallbackDuration = isAllDay ? 86_400_000 : 3_600_000;
  const parsed = dto.endsAt ? new Date(dto.endsAt) : new Date(starts.getTime() + fallbackDuration);
  return Number.isNaN(parsed.getTime()) ? new Date(starts.getTime() + fallbackDuration) : parsed;
}

function isActive(dto: EventDTO): boolean {
  return (dto.status ?? "active") === "active" && dto.deletedAt === null;
}

export function materializeEvents(dtos: EventDTO[], month: CalendarMonth): MonthPayload {
  const payload: MonthPayload = {
    events: new Map(),
    spans: [],
    periods: []
  };

  for (const dto of dtos) {
    if (!isActive(dto)) continue;

    const starts = new Date(dto.startsAt);
    if (Number.isNaN(starts.getTime())) continue;

    const isAllDay = (dto.precision ?? "hour") === "day";
    const ends = eventEnd(dto, starts, isAllDay);
    const start = dayIndex(starts, month);
    const end = Math.max(start, effectiveEndDayIndex(ends, month, isAllDay));
    const isPeriod = (dto.eventType ?? "") === "period";
    const spanShaped =
      isPeriod ||
      metadataKind(dto.metadata) === "span" ||
      (isAllDay && end > start);

    if (spanShaped) {
      const range = clipRange(start, end, month);
      if (!range) continue;

      if (isPeriod) {
        payload.periods.push(range);
      } else {
        const clip: CalendarSpan["clip"] = {};
        if (start < 1) clip.headStart = dto.startsAt;
        if (end > daysInMonth(month)) clip.tailEnd = dto.endsAt ?? undefined;
        payload.spans.push({
          id: dto.id,
          author: authorFromWire(dto.createdBy),
          title: dto.title,
          startDay: range.start,
          endDay: range.end,
          clip: Object.keys(clip).length ? clip : undefined,
          revision: dto.revision
        });
      }
      continue;
    }

    if (start < 1 || start > daysInMonth(month)) continue;

    const parts = productDateParts(starts);
    const event: CalendarEvent = {
      id: dto.id,
      author: authorFromWire(dto.createdBy),
      title: dto.title,
      startHour: isAllDay ? 0 : parts.hour,
      startMinute: isAllDay ? 0 : parts.minute,
      durationMinutes: isAllDay ? 0 : Math.max(1, Math.floor((ends.getTime() - starts.getTime()) / 60_000)),
      isAllDay,
      isAutoSuggestion: false,
      eventType: dto.eventType,
      revision: dto.revision,
      source: dto.source
    };

    const dayEvents = payload.events.get(start) ?? [];
    dayEvents.push(event);
    payload.events.set(start, dayEvents);
  }

  for (const [day, events] of payload.events) {
    payload.events.set(
      day,
      [...events].sort(
        (a, b) => a.startHour * 60 + a.startMinute - (b.startHour * 60 + b.startMinute)
      )
    );
  }

  payload.spans.sort((a, b) => {
    if (a.startDay === b.startDay) return b.endDay - b.startDay - (a.endDay - a.startDay);
    return a.startDay - b.startDay;
  });
  payload.periods.sort((a, b) => a.start - b.start);

  return payload;
}

export function materializeDay(dtos: EventDTO[], selectedDay: string): DayPayload {
  const range = productDayRange(selectedDay);
  const selectedSerial = daySerialFromKey(selectedDay);
  if (!range || selectedSerial === null) throw new Error("selected day must be YYYY-MM-DD");

  const payload: DayPayload = { allDay: [], timed: [] };

  for (const dto of dtos) {
    if (!isActive(dto) || dto.eventType === "period") continue;

    const starts = new Date(dto.startsAt);
    if (Number.isNaN(starts.getTime())) continue;

    const allDay = (dto.precision ?? "hour") === "day";
    const ends = eventEnd(dto, starts, allDay);
    if (ends.getTime() <= starts.getTime()) continue;

    const common = {
      id: dto.id,
      author: authorFromWire(dto.createdBy),
      title: dto.title,
      description: dto.description,
      eventType: dto.eventType,
      originalStartsAt: dto.startsAt,
      originalEndsAt: dto.endsAt,
      revision: dto.revision
    };

    if (allDay) {
      const startSerial = productDaySerial(starts);
      const endExclusiveSerial = Math.max(startSerial + 1, productDaySerial(ends));
      if (selectedSerial < startSerial || selectedSerial >= endExclusiveSerial) continue;
      const spanLength = endExclusiveSerial - startSerial;
      payload.allDay.push({
        ...common,
        isAllDay: true,
        isSpan: metadataKind(dto.metadata) === "span" || spanLength > 1,
        startMinute: 0,
        endMinute: 1440,
        continuesBefore: selectedSerial > startSerial,
        continuesAfter: selectedSerial + 1 < endExclusiveSerial,
        spanIndex: spanLength > 1 ? selectedSerial - startSerial + 1 : null,
        spanLength: spanLength > 1 ? spanLength : null
      });
      continue;
    }

    if (starts.getTime() >= range.end.getTime() || ends.getTime() <= range.start.getTime()) continue;
    const clippedStart = Math.max(starts.getTime(), range.start.getTime());
    const clippedEnd = Math.min(ends.getTime(), range.end.getTime());

    payload.timed.push({
      ...common,
      isAllDay: false,
      isSpan: false,
      startMinute: Math.max(0, Math.floor((clippedStart - range.start.getTime()) / 60_000)),
      endMinute: Math.min(1440, Math.ceil((clippedEnd - range.start.getTime()) / 60_000)),
      continuesBefore: starts.getTime() < range.start.getTime(),
      continuesAfter: ends.getTime() > range.end.getTime(),
      spanIndex: null,
      spanLength: null
    });
  }

  payload.allDay.sort((a, b) => {
    if (a.isSpan !== b.isSpan) return a.isSpan ? -1 : 1;
    return a.title.localeCompare(b.title);
  });
  payload.timed.sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute);
  return payload;
}
