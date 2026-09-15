import type { EventDTO, EventDraft, EventWritePayload } from "./calendar";
import {
  adjacentDayKey,
  currentProductDay,
  dayKey,
  parseDayKey,
  productDateParts
} from "./calendarTime";

const CLOCK = /^(\d{2}):(\d{2})$/;

function clock(value: string): { hour: number; minute: number } | null {
  const match = CLOCK.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? { hour, minute } : null;
}

function isoTaipei(day: string, time: string): string {
  return `${day}T${time}:00+08:00`;
}

export function eventWritePayload(draft: EventDraft): EventWritePayload {
  const title = draft.title.trim();
  if (!title) throw new Error("Please give this plan a title.");
  if (!parseDayKey(draft.date)) throw new Error("Please choose a valid date.");

  if (draft.allDay) {
    const tomorrow = adjacentDayKey(draft.date, 1)!;
    return {
      title,
      starts_at: isoTaipei(draft.date, "00:00"),
      ends_at: isoTaipei(tomorrow, "00:00"),
      precision: "day"
    };
  }

  const start = clock(draft.startTime);
  const end = clock(draft.endTime);
  if (!start || !end) throw new Error("Please choose a valid time.");
  const startMinute = start.hour * 60 + start.minute;
  const endMinute = end.hour * 60 + end.minute;
  if (endMinute <= startMinute) throw new Error("End time must be after start time.");

  return {
    title,
    starts_at: isoTaipei(draft.date, draft.startTime),
    ends_at: isoTaipei(draft.date, draft.endTime),
    precision: "hour"
  };
}

function hhmm(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function draftForNewEvent(date = currentProductDay()): EventDraft {
  return { title: "", date, startTime: "09:00", endTime: "10:00", allDay: false };
}

export function draftFromEvent(dto: EventDTO): EventDraft {
  const start = new Date(dto.startsAt);
  const end = new Date(dto.endsAt ?? new Date(start.getTime() + 3_600_000));
  const startParts = productDateParts(start);
  const endParts = productDateParts(end);
  return {
    title: dto.title,
    date: dayKey({ year: startParts.year, month: startParts.month }, startParts.day),
    startTime: hhmm(startParts.hour, startParts.minute),
    endTime: hhmm(endParts.hour, endParts.minute),
    allDay: (dto.precision ?? "hour") === "day"
  };
}

export function provisionalEvent(payload: EventWritePayload, id: string): EventDTO {
  return {
    id,
    title: payload.title,
    description: null,
    startsAt: payload.starts_at,
    endsAt: payload.ends_at,
    timezone: "Asia/Taipei",
    precision: payload.precision,
    eventType: "custom",
    source: "manual",
    createdBy: "kitty",
    revision: null,
    status: "active",
    metadata: {},
    createdAt: null,
    updatedAt: null,
    deletedAt: null
  };
}

export function optimisticEvent(before: EventDTO, payload: EventWritePayload): EventDTO {
  return {
    ...before,
    title: payload.title,
    startsAt: payload.starts_at,
    endsAt: payload.ends_at,
    precision: payload.precision
  };
}
