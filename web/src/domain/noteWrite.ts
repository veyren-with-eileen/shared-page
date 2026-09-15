import type { CalendarNote, DayEvent, NoteDTO, NoteWritePayload } from "./calendar";
import { productDateParts } from "./calendarTime";

export const NOTE_WIDTH = 174;
export const NOTE_HEIGHT = 96;

export function provisionalNote(anchorDate: string, y: number): CalendarNote {
  return { id: `local_note_${crypto.randomUUID()}`, author: "kitty", body: "", timestamp: "now", liked: false, linkedEventId: null, y, anchorDate };
}

export function noteFromDTO(dto: NoteDTO): CalendarNote {
  const stamp = dto.createdAt ? new Date(dto.createdAt) : null;
  const p = stamp && !Number.isNaN(stamp.getTime()) ? productDateParts(stamp) : null;
  return {
    id: dto.id,
    author: dto.author === "kitty" ? "kitty" : dto.author === "master" || dto.author === "assistant" ? "master" : "system",
    body: dto.body.slice(0, 40),
    timestamp: p ? `${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")} ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}` : "now",
    liked: dto.liked,
    linkedEventId: dto.eventId,
    y: dto.y,
    anchorDate: dto.anchorDate
  };
}

export function createNotePayload(note: CalendarNote): NoteWritePayload {
  const body = note.body.trim();
  if (!body) throw new Error("Note cannot be blank.");
  return { body, anchor_date: note.anchorDate, y: note.y ?? 0, event_id: note.linkedEventId };
}

export function linkedTimedEventId(centerY: number, timed: DayEvent[], eventTop: (event: DayEvent) => number, eventHeight: (event: DayEvent) => number): string | null {
  return timed.find((event) => !event.isAllDay && centerY >= eventTop(event) && centerY <= eventTop(event) + eventHeight(event))?.id ?? null;
}

export function clampNoteY(y: number, timelineHeight: number): number {
  return Math.min(Math.max(0, y), timelineHeight - NOTE_HEIGHT);
}
